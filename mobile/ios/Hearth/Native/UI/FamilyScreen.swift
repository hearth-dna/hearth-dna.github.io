import SwiftUI

/// Family lookup (FamilyPage.tsx): find a marker by rsid, gene, drug or condition, then see every
/// person's genotype at it and, when parents are set, who inherited which allele from whom.
struct FamilyScreen: View {
    let repo: Repo
    let kb: Kb

    @State private var q = ""
    @State private var looked: String?
    @State private var rows: [FamilyCall]?
    @State private var persons: [Person] = []
    @State private var relationships: [Relationship] = []
    @State private var failure: String?

    private static let rsidPattern = try! NSRegularExpression(pattern: #"^rs\d+$"#, options: [.caseInsensitive])

    private var trimmed: String { q.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var isRsid: Bool {
        let s = trimmed
        return FamilyScreen.rsidPattern.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    private var hits: [KbEntry] {
        isRsid ? [] : Array(KbLogic.search(kb, q).prefix(12))
    }

    private var entry: KbEntry? {
        guard let looked else { return nil }
        return kb.entries.first { $0.rsid == looked }
    }

    var body: some View {
        NavigationStack {
            List {
                if isRsid {
                    Section {
                        Button {
                            lookup(trimmed)
                        } label: {
                            Label(t("familyPage.lookUp") + " " + trimmed, systemImage: "magnifyingglass")
                        }
                    }
                }
                if !hits.isEmpty {
                    Section {
                        ForEach(hits) { e in
                            Button {
                                lookup(e.rsid)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.rsid).font(.caption).foregroundStyle(.secondary)
                                    Text(verbatim: "\(e.gene) — \(e.name)").foregroundStyle(.primary)
                                    Text(e.summary).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                    }
                }
                if let found = rows, let looked {
                    result(looked, found)
                }
            }
            .navigationTitle(t("familyPage.title"))
            .searchable(text: $q, prompt: Text(t("familyPage.searchPlaceholder")))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search) { if isRsid { lookup(trimmed) } }
            .alert(failure ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
        }
        .onAppear(perform: load)
    }

    @ViewBuilder
    private func result(_ rsid: String, _ found: [FamilyCall]) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(rsid).font(.title2.weight(.semibold))
                if let entry {
                    Text(verbatim: "\(entry.gene) — \(entry.name)").foregroundStyle(.secondary)
                }
            }
        }
        if !found.isEmpty && !relationships.isEmpty {
            Section {
                InheritanceTree(persons: persons, relationships: relationships, calls: found, entry: entry)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            } header: {
                Text(t("familyPage.whoInherited"))
            }
        }
        if found.isEmpty {
            Section {
                Text(t("familyPage.notGenotyped")).foregroundStyle(.secondary)
            }
        } else {
            Section {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                    GridRow {
                        Text(t("familyPage.person"))
                        Text(t("familyPage.chr"))
                        Text(t("familyPage.position"))
                        Text(t("familyPage.genotype"))
                    }
                    .font(.subheadline.weight(.semibold))
                    Divider()
                    ForEach(persons) { p in
                        let call = found.first { $0.personId == p.id }?.call
                        GridRow {
                            Text(p.displayName)
                            Text(call?.chromosome ?? "–")
                            Text(call.map { String($0.position) } ?? "–").monospacedDigit()
                            if let call {
                                Text(verbatim: "\(call.a1)/\(call.a2)").monospaced()
                            } else {
                                Text(t("familyPage.notOnChip")).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Actions

    /// People and links are re-read whenever the tab appears (they change on the People tab), and
    /// the marker on screen is looked up again against them.
    private func load() {
        do {
            persons = try repo.persons()
            relationships = try repo.relationships()
            if let looked { rows = try repo.familyAt(looked) }
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }

    private func lookup(_ rsid: String) {
        q = rsid
        looked = rsid
        do {
            rows = try repo.familyAt(rsid)
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }
}

/// The pedigree for one rsid (InheritanceTree.tsx): each person's genotype, and on every line the
/// allele that parent passed on. Risk alleles are red, ambiguous lines dashed, impossible ones red.
struct InheritanceTree: View {
    let persons: [Person]
    let relationships: [Relationship]
    let calls: [FamilyCall]
    let entry: KbEntry?

    private var danger: Color { severityColor(7) }
    private var warn: Color { severityColor(4) }

    var body: some View {
        let nodes = Inheritance.layoutPedigree(persons, relationships)
        let callOf = Dictionary(calls.map { ($0.personId, $0.call) }, uniquingKeysWith: { _, last in last })
        let risk = entry?.riskAllele
        let edges = styledEdges(nodes, callOf, risk)
        VStack(alignment: .leading, spacing: 8) {
            Pedigree(nodes: nodes, edges: edges) { n in
                let c = callOf[n.person.id]
                let copies = c.map { call in risk.map { r in [call.a1, call.a2].filter { $0 == r }.count } ?? 0 } ?? 0
                PedigreeBox(
                    sex: n.person.sex,
                    border: copies == 2 ? danger : (copies == 1 ? warn : Color(uiColor: .separator)),
                    lineWidth: copies > 0 ? 2 : 1
                ) {
                    VStack(spacing: 2) {
                        Text(n.person.displayName).font(.subheadline.weight(.semibold)).lineLimit(1)
                        if let c {
                            Text(genotype(c, risk)).font(.body.monospaced())
                        } else {
                            Text(t("inheritanceTree.notTyped")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Text(rich(legend(risk), colors: ["r": danger]))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
        }
    }

    /// Each line with the allele that parent passed on: bold when it names one, dashed when either
    /// parent could have, red when no assignment works, the letter red when it is the risk allele.
    private func styledEdges(_ nodes: [PedigreeNode], _ callOf: [String: Call], _ risk: String?) -> [PedigreeEdge] {
        PedigreeEdge.of(nodes).map { e in
            var styled = e
            let origins = callOf[e.to.person.id].map { child in
                Inheritance.alleleOrigins(child, e.to.parents.map { Inheritance.ParentCall(id: $0, call: callOf[$0]) })
            } ?? []
            let mine = origins.filter { $0.from == e.from.person.id }.map(\.allele)
            let impossible = origins.first?.from == Inheritance.Origin.impossible
            styled.color = impossible ? danger : nil
            styled.width = mine.isEmpty ? 1.2 : 2
            styled.dashed = !origins.isEmpty && !impossible && mine.isEmpty
            styled.label = mine.isEmpty ? nil : mine.joined()
            if let risk, mine.contains(risk) { styled.labelColor = danger }
            return styled
        }
    }

    /// The two alleles, a risk allele bold and red.
    private func genotype(_ c: Call, _ risk: String?) -> AttributedString {
        var out = AttributedString()
        for a in [c.a1, c.a2] {
            var part = AttributedString(a)
            if a == risk {
                part.foregroundColor = danger
                part.inlinePresentationIntent = .stronglyEmphasized
            }
            out += part
        }
        return out
    }

    private func legend(_ risk: String?) -> String {
        var text = t("inheritanceTree.legend")
        if let risk { text += " " + t("inheritanceTree.riskLegend", ["allele": risk]) }
        return text
    }
}
