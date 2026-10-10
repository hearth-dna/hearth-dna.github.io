import SwiftUI

/// The DNA tab (DnaPage.tsx): every marker the knowledge base describes, most clinically useful
/// first, with each person's genotype beside it. Filter by person, area of medicine, text and
/// notability; what is shown, or only the markers ticked, becomes a context pack to copy, share or
/// open in an assistant, previewed exactly as it leaves. A marker opens in the family lookup.
struct DnaScreen: View {
    let repo: Repo
    let kb: Kb

    @State private var persons: [Person] = []
    @State private var counts: [String: Int] = [:]
    @State private var findingsBy: [String: [Finding]] = [:]
    @State private var who = ""
    @State private var filter = Viewer.Filter()
    @State private var question = ""
    @State private var realNames = false
    /// Ticked markers (rsids); when any of them is shown, only those go into the pack.
    @State private var picked: Set<String> = []
    @State private var lookup: LookupRequest?
    @State private var failure: String?

    private struct LookupRequest: Identifiable {
        let rsid: String
        var id: String { rsid }
    }

    private static let explain = Prompts.all.first { $0.id == "explain" }

    private var withDna: [Person] { persons.filter { (counts[$0.id] ?? 0) > 0 } }
    private var shown: [Person] { withDna.filter { who.isEmpty || $0.id == who } }

    var body: some View {
        let rows = Viewer.rows(kb, findingsBy, shown.map(\.id), filter)
        let pickedRows = rows.filter { picked.contains($0.entry.rsid) }
        let packed = Viewer.packPeople(pickedRows.isEmpty ? rows : pickedRows, shown)
        let asked = question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? Viewer.question(kb, filter.areas) : question.trimmingCharacters(in: .whitespacesAndNewlines)
        let pack = ContextPack.build(PackOptions(
            question: asked, people: packed, realNames: realNames,
            year: Calendar.current.component(.year, from: Date()), template: DnaScreen.explain, compact: true
        ))
        return NavigationStack {
            List {
                introSection
                filterSection(rows.count, pickedRows.count)
                if rows.isEmpty {
                    Section { Text(t("dnaPage.noRows")).foregroundStyle(.secondary) }
                }
                ForEach(rows) { row in markerSection(row) }
                Section { Text(t("dnaPage.evidenceLegend")).font(.footnote).foregroundStyle(.secondary) }
                if !shown.isEmpty {
                    sendSection(asked)
                    PackPreviewSection(
                        repo: repo, pack: pack, stats: ContextPack.stats(packed, pack), packed: packed,
                        question: asked, realNames: realNames
                    )
                }
            }
            .navigationTitle(t("dnaPage.title"))
            .alert(failure ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
            .sheet(item: $lookup) { request in
                FamilyScreen(repo: repo, kb: kb, start: request.rsid, onClose: { lookup = nil })
            }
        }
        .onAppear(perform: load)
    }

    // MARK: - Sections

    private var introSection: some View {
        Section {
            Text(t("dnaPage.intro")).font(.subheadline).foregroundStyle(.secondary)
            if withDna.isEmpty {
                Text(t("dnaPage.noDna"))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(label: t("dnaPage.everyone"), selected: who.isEmpty) { who = "" }
                        ForEach(withDna) { p in
                            Chip(label: p.displayName, selected: who == p.id) { who = p.id }
                        }
                    }
                }
            }
        }
    }

    private func filterSection(_ count: Int, _ pickedCount: Int) -> some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(label: t("dnaPage.allAreas"), selected: filter.areas.isEmpty) { filter.areas = [] }
                    ForEach(kb.areas) { a in
                        Chip(label: a.name(Strings.shared.language), selected: filter.areas.contains(a.id)) {
                            if let at = filter.areas.firstIndex(of: a.id) { filter.areas.remove(at: at) } else { filter.areas.append(a.id) }
                        }
                    }
                }
            }
            TextField(t("dnaPage.search"), text: $filter.query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !shown.isEmpty {
                Toggle(t("dnaPage.notable"), isOn: $filter.notable)
            }
            Text(t("dnaPage.count", ["n": count])).font(.footnote).foregroundStyle(.secondary)
            if pickedCount > 0 {
                HStack {
                    Text(t("dnaPage.picked", ["n": pickedCount])).font(.subheadline)
                    Spacer()
                    Button(capitalisedFirst(t("dnaPage.clearPicked"))) { picked = [] }
                }
            }
        }
    }

    private func markerSection(_ row: Viewer.Row) -> some View {
        let e = row.entry
        return Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if !shown.isEmpty {
                        Button {
                            if picked.contains(e.rsid) { picked.remove(e.rsid) } else { picked.insert(e.rsid) }
                        } label: {
                            Image(systemName: picked.contains(e.rsid) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(picked.contains(e.rsid) ? Color.accentColor : .secondary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(t("dnaPage.pick"))
                        .accessibilityAddTraits(picked.contains(e.rsid) ? .isSelected : [])
                    }
                    Text(e.gene).font(.headline)
                    Link(e.rsid, destination: URL(string: "https://www.ncbi.nlm.nih.gov/snp/\(e.rsid)")!)
                        .font(.subheadline)
                    Spacer(minLength: 0)
                    Text(e.evidence)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(evidenceColor(e.evidence), in: RoundedRectangle(cornerRadius: 6))
                        .foregroundStyle(.white)
                }
                if !e.name.isEmpty { Text(e.name).font(.footnote).foregroundStyle(.secondary) }
                HStack(spacing: 6) {
                    ForEach(e.areas, id: \.self) { id in
                        Text(kb.areas.first { $0.id == id }?.name(Strings.shared.language) ?? id)
                            .font(.caption2)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                Text(e.summary).font(.subheadline)
                ForEach(shown) { p in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if shown.count > 1 {
                            Text(p.displayName).foregroundStyle(.secondary).frame(maxWidth: 120, alignment: .leading)
                        }
                        VStack(alignment: .leading, spacing: 0) {
                            if let f = row.findings[p.id] {
                                Text(verbatim: "\(f.call.a1)/\(f.call.a2)")
                                    .font(.body.monospaced().weight(.semibold))
                                    .foregroundStyle(magnitudeColor(f.match?.magnitude ?? 0))
                                Text(f.match?.label ?? t("dnaPage.undescribed")).font(.footnote)
                                    .foregroundStyle(f.match == nil ? .secondary : .primary)
                            } else {
                                Text(t("dnaPage.notGenotyped")).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if e.generatedBy.hasPrefix("llm") {
                    Text(t("dnaPage.draft")).font(.caption2).foregroundStyle(.secondary)
                }
                Button(t("app.navFamily")) { lookup = LookupRequest(rsid: e.rsid) }
                    .buttonStyle(.borderless)
            }
            .padding(.vertical, 4)
        }
    }

    private func sendSection(_ asked: String) -> some View {
        Section {
            Text(t("dnaPage.sendIntro")).font(.subheadline).foregroundStyle(.secondary)
            TextField(t("dnaPage.question"), text: $question, prompt: Text(Viewer.question(kb, filter.areas)), axis: .vertical)
                .lineLimit(3...8)
            Toggle(capitalisedFirst(t("askPage.realNames")), isOn: $realNames)
        } header: {
            Text(t("dnaPage.sendHeading"))
        }
    }

    // MARK: - Loading

    private func load() {
        do {
            persons = try repo.persons()
            counts = try repo.genotypeCounts()
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
            return
        }
        let ids = persons.filter { (counts[$0.id] ?? 0) > 0 }.map(\.id)
        let kb = self.kb
        let repo = self.repo
        DispatchQueue.global(qos: .userInitiated).async {
            let rsids = kb.entries.map(\.rsid)
            let result = Result { () throws -> [String: [Finding]] in
                var out: [String: [Finding]] = [:]
                for id in ids { out[id] = KbLogic.computeFindings(kb, try repo.personCallsFor(personId: id, rsids: rsids)) }
                return out
            }
            DispatchQueue.main.async {
                switch result {
                case .success(let loaded): findingsBy = loaded
                case .failure(let error): failure = t("native.error", ["error": error.localizedDescription])
                }
            }
        }
    }
}
