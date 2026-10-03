import SwiftUI

/// A person's report (PersonPage.tsx): the files their genome came from, how consistent it is with
/// each parent's (and with both, for a trio), a way into their health log, and what the knowledge
/// base says about the markers they carry, sortable like the web table. Pushed on top of People.
struct PersonScreen: View {
    let repo: Repo
    let kb: Kb
    let person: Person
    let onHealthLog: () -> Void

    /// One Mendelian comparison; `label` is nil for the trio (both parents), named when shown.
    private struct MendelRow: Identifiable {
        let id = UUID()
        let label: String?
        let m: Mendelian
    }

    private struct Loaded {
        var files: [SourceFile] = []
        var mendel: [MendelRow] = []
        var findings: [Finding] = []
        var entries = 0
    }

    /// Nil while it is being read: the Mendelian checks join every genotype of two or three people.
    @State private var loaded: Loaded?
    @State private var failure: String?
    @State private var sortKey = FindingSortKey.magnitude
    @State private var ascending = false

    var body: some View {
        List {
            Section(t("personPage.sources")) {
                if let loaded {
                    if loaded.files.isEmpty {
                        Text(t("personPage.none")).foregroundStyle(.secondary)
                    }
                    ForEach(loaded.files) { f in
                        Text(t("personPage.sourceLine", [
                            "provider": f.provider.label, "build": f.build, "calls": grouped(f.rowCount),
                            "name": f.originalName, "sha": String(f.sha256.prefix(12)),
                        ]))
                        .font(.subheadline)
                    }
                } else {
                    ProgressView()
                }
            }
            if let mendel = loaded?.mendel, !mendel.isEmpty {
                Section(t("personPage.mendelTitle")) {
                    ForEach(mendel) { row in mendelLine(row) }
                }
            }
            Section {
                Button(action: onHealthLog) {
                    HStack {
                        Text(t("healthLog.title")).foregroundStyle(.primary)
                        Spacer()
                        Text(grouped(loaded?.entries ?? 0)).foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
            }
            Section {
                if let loaded {
                    if loaded.findings.isEmpty {
                        Text(t("personPage.noMarkers")).foregroundStyle(.secondary)
                    } else {
                        ForEach(KbLogic.sortFindings(loaded.findings, sortKey, ascending: ascending)) { f in
                            FindingCard(finding: f)
                        }
                    }
                } else {
                    Text(t("personPage.computing")).foregroundStyle(.secondary)
                }
            } header: {
                Text(t("personPage.findingsTitle"))
            } footer: {
                Text(t("personPage.findingsIntro"))
            }
        }
        .navigationTitle(person.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if loaded?.findings.isEmpty == false {
                ToolbarItem(placement: .topBarTrailing) { sortMenu }
            }
        }
        .alert(failure ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button(t("common.close"), role: .cancel) {}
        }
        .task(id: person.id) { load() }
    }

    /// The findings' sort: picking the current column flips the direction, another starts in its own.
    private var sortMenu: some View {
        Menu {
            ForEach(FindingSortKey.allCases) { key in
                Button {
                    if key == sortKey {
                        ascending.toggle()
                    } else {
                        sortKey = key
                        ascending = key.defaultAscending
                    }
                } label: {
                    if key == sortKey {
                        Label(t(key.labelKey), systemImage: ascending ? "arrow.up" : "arrow.down")
                    } else {
                        Text(t(key.labelKey))
                    }
                }
            }
        } label: {
            Label(t(sortKey.labelKey), systemImage: "arrow.up.arrow.down.circle")
        }
    }

    /// "Alex: 1 / 6 shared SNPs (16.67%)", then the verdict: green below 1%, red from 3%.
    private func mendelLine(_ r: MendelRow) -> some View {
        let rate = r.m.rate
        let verdict = rate < 0.01 ? t("personPage.consistent")
            : rate < 0.03 ? t("personPage.borderline") : t("personPage.inconsistent")
        return VStack(alignment: .leading, spacing: 2) {
            Text(t("personPage.mendelLine", [
                "label": r.label ?? t("personPage.bothParents"),
                "violations": grouped(r.m.violations),
                "compared": grouped(r.m.compared),
                "rate": String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), rate * 100),
            ]))
            .font(.subheadline)
            Text(verdict)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(rate < 0.01 ? Color.green : severityColor(7))
        }
    }

    /// Everything is read off the main thread (`Db` serialises access) and shown at once.
    private func load() {
        let repo = self.repo
        let kb = self.kb
        let person = self.person
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { () throws -> Loaded in
                var out = Loaded()
                out.files = try repo.sourceFiles().filter { $0.personId == person.id }
                out.entries = try repo.healthLog().filter { $0.personId == person.id }.count
                let calls = try repo.personCallsFor(personId: person.id, rsids: kb.entries.map(\.rsid))
                out.findings = KbLogic.computeFindings(kb, calls)
                let persons = try repo.persons()
                let parents = try repo.relationships().filter { $0.childId == person.id }.map(\.parentId)
                for pid in parents {
                    let name = persons.first { $0.id == pid }?.displayName ?? pid
                    let m = try repo.mendelian(childId: person.id, parentA: pid)
                    out.mendel.append(MendelRow(label: name, m: m))
                }
                if parents.count == 2 {
                    let trio = try repo.mendelian(childId: person.id, parentA: parents[0], parentB: parents[1])
                    out.mendel.append(MendelRow(label: nil, m: trio))
                }
                return out
            }
            DispatchQueue.main.async {
                switch result {
                case .success(let out): loaded = out
                case .failure(let error):
                    loaded = Loaded()
                    failure = t("native.error", ["error": error.localizedDescription])
                }
            }
        }
    }
}

/// One marker: gene, rsid (a link to dbSNP), evidence grade and impact, then the genotype, its
/// reading and the kb's summary.
private struct FindingCard: View {
    let finding: Finding

    var body: some View {
        let f = finding
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(f.entry.gene).font(.headline)
                // Opens in the browser, as the web's link does; the app itself fetches nothing.
                if let url = URL(string: "https://www.ncbi.nlm.nih.gov/snp/\(f.entry.rsid)") {
                    Link(f.entry.rsid, destination: url).font(.subheadline)
                }
                Spacer(minLength: 0)
                Text(f.entry.evidence)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(evidenceColor(f.entry.evidence))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .overlay(Capsule().strokeBorder(evidenceColor(f.entry.evidence)))
                Text(f.match.map { plainNumber($0.magnitude) } ?? "–")
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(magnitudeColor(f.match?.magnitude))
            }
            if !f.entry.name.isEmpty {
                Text(f.entry.name).font(.caption).foregroundStyle(.secondary)
            }
            Text(verbatim: "\(f.call.a1)/\(f.call.a2) · \(t("personPage.riskCopies", ["n": f.riskCopies]))")
                .font(.subheadline.monospaced())
            Text(f.match?.label ?? t("personPage.genotypeNotDescribed"))
            Text(f.entry.summary).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    /// The web's `.badge.A/B/C`: A in the "ok" green, B in the warning amber, C muted.
    private func evidenceColor(_ e: String) -> Color {
        switch e {
        case "A": return .green
        case "B": return severityColor(4)
        default: return .secondary
        }
    }

    /// The web's `.mag.hi` (3 and up) and `.mag.mid` (2 and up).
    private func magnitudeColor(_ m: Double?) -> Color {
        guard let m else { return .secondary }
        if m >= 3 { return severityColor(7) }
        if m >= 2 { return severityColor(4) }
        return .primary
    }
}
