import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Ask (AskPage.tsx): the question is classified on the phone, which picks a prompt template and
/// suggests records; the user can search the health log and DNA for anything else. Only records the
/// user includes go into the pack, previewed exactly as copied. The app sends nothing: every copy
/// to the clipboard is confirmed and written to the sharing log.
struct AskScreen: View {
    let repo: Repo
    let kb: Kb

    @State private var persons: [Person] = []
    @State private var question = ""
    /// Selected person ids, in the order they were picked.
    @State private var selected: [String] = []
    @State private var data = AskData()
    /// Person ids whose findings and health log are loaded or loading.
    @State private var requested: Set<String> = []
    /// Included record keys, in the order they were added.
    @State private var included: [String] = []
    @State private var realNames = false
    @State private var compact = true
    @State private var evidence = true
    @State private var templateId = Prompts.all[0].id
    @State private var templateChosen = false
    @State private var confirming = false
    @State private var notice: String?

    // MARK: - Derived

    private var people: [Person] { persons.filter { selected.contains($0.id) } }

    private var intents: [Intent] { IntentClassifier.classify(question, kb, peopleSelected: selected.count) }

    private var suggestions: [Suggestion] {
        let records = selected.compactMap { id -> PersonRecords? in
            guard let findings = data.findingsBy[id] else { return nil }
            return PersonRecords(personId: id, findings: findings, health: data.healthBy[id] ?? [])
        }
        return Recommend.recommend(kb, question, intents, records)
    }

    /// People whose name the question uses as a word.
    private var named: [Person] {
        let lower = question.lowercased()
        let range = NSRange(location: 0, length: (lower as NSString).length)
        return persons.filter { p in
            guard p.displayName.count >= 2 else { return false }
            let pattern = #"\b"# + NSRegularExpression.escapedPattern(for: p.displayName.lowercased()) + #"\b"#
            return (try? NSRegularExpression(pattern: pattern))?.firstMatch(in: lower, range: range) != nil
        }
    }

    private var packed: [PackPerson] { AskItems.packPeople(included, data, persons, selected) }

    private var template: PromptTemplate? { Prompts.all.first { $0.id == templateId } }

    private func pack(_ packed: [PackPerson]) -> String {
        ContextPack.build(PackOptions(
            question: question, people: packed, realNames: realNames,
            year: Calendar.current.component(.year, from: Date()),
            template: template, compact: compact, evidence: evidence
        ))
    }

    // MARK: - Body

    var body: some View {
        let packed = self.packed
        let pack = self.pack(packed)
        let stats = ContextPack.stats(packed, pack)
        let intents = self.intents
        return NavigationStack {
            Form {
                questionSection
                suggestionsSection(intents)
                if !people.isEmpty {
                    FindRecords(
                        repo: repo, kb: kb, people: people, data: data, included: included,
                        onToggle: toggle, onRaw: addRaw
                    )
                }
                packSection(packed, stats)
                previewSection(pack, stats, empty: packed.isEmpty)
            }
            .navigationTitle(t("askPage.title"))
            .alert(t("askPage.confirmTitle"), isPresented: $confirming) {
                Button(t("askPage.confirmCopy")) { copy(pack, packed) }
                Button(t("common.cancel"), role: .cancel) {}
            } message: {
                Text(confirmMessage(packed, stats))
            }
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
        }
        .onAppear(perform: loadPersons)
        .onChange(of: selected, initial: true) { _, ids in load(ids) }
        // Follow the question's type until the user picks a template themselves.
        .onChange(of: intents.first?.type) { _, type in
            if !templateChosen, let type { templateId = type.template }
        }
    }

    private var questionSection: some View {
        Section {
            Text(t("askPage.intro")).font(.subheadline).foregroundStyle(.secondary)
            TextField(t("askPage.question"), text: $question, prompt: Text(t("askPage.questionPlaceholder")), axis: .vertical)
                .lineLimit(3...8)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text(t("askPage.people")).font(.subheadline.weight(.semibold))
                    ForEach(persons) { p in
                        Chip(label: p.displayName, selected: selected.contains(p.id)) {
                            setPerson(p.id, !selected.contains(p.id))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func suggestionsSection(_ intents: [Intent]) -> some View {
        Section(t("askPage.suggestHeading")) {
            if let first = intents.first {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(intents.enumerated()), id: \.offset) { i, intent in
                            Text(t("askPage.type.\(intent.type.id)"))
                                .font(.subheadline.weight(i == 0 ? .semibold : .regular))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color(uiColor: .secondarySystemFill), in: Capsule())
                        }
                    }
                }
                Text(t("askPage.typeHint.\(first.type.id)") + " "
                    + t("askPage.signals", ["words": first.signals.map { "“\($0)”" }.joined(separator: ", ")]))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let recommended = Prompts.all.first(where: { $0.id == first.type.template }), recommended.id != templateId {
                    HStack {
                        Text(t("askPage.templateSuggested", ["title": t(recommended.titleKey)]))
                        Spacer()
                        Button(capitalisedFirst(t("askPage.useTemplate"))) {
                            templateId = recommended.id
                            templateChosen = true
                        }
                        .buttonStyle(.borderless)
                    }
                }
            } else {
                Text(t("askPage.noIntent")).foregroundStyle(.secondary)
            }
            let mentioned = named.filter { !selected.contains($0.id) }
            if !mentioned.isEmpty {
                Text(t("askPage.mentionedPeople"))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(mentioned) { p in
                            Chip(label: "+ \(p.displayName)", selected: false) { setPerson(p.id, true) }
                        }
                    }
                }
            }
            suggestionRows(intents)
        }
    }

    @ViewBuilder
    private func suggestionRows(_ intents: [Intent]) -> some View {
        let suggestions = self.suggestions
        if people.isEmpty {
            Text(t("askPage.pickPeople")).foregroundStyle(.secondary)
        } else if suggestions.isEmpty {
            if !intents.isEmpty { Text(t("askPage.noSuggestions")).foregroundStyle(.secondary) }
        } else {
            let pending = suggestions.filter { !included.contains($0.key) }
            HStack {
                Text(t("askPage.suggestedRecords", ["n": suggestions.count])).font(.headline)
                Spacer()
                if !pending.isEmpty {
                    Button(capitalisedFirst(t("askPage.includeAll", ["n": pending.count]))) {
                        for s in pending { toggle(s.key) }
                    }
                    .buttonStyle(.borderless)
                }
            }
            ForEach(suggestions, id: \.key) { s in
                if let r = AskItems.resolve(s.key, data) {
                    PickRow(
                        on: included.contains(s.key),
                        label: whoPrefix(s.personId) + AskItems.label(r, undescribed: t("askPage.undescribed")),
                        detail: reason(s.reason)
                    ) { toggle(s.key) }
                }
            }
        }
    }

    @ViewBuilder
    private func packSection(_ packed: [PackPerson], _ stats: PackStats) -> some View {
        Section {
            Text(t("askPage.includedStats", [
                "genotypes": stats.genotypes, "healthEntries": stats.healthEntries, "people": packed.count,
            ]))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            if packed.isEmpty {
                Text(t("askPage.nothingIncluded")).foregroundStyle(.secondary)
            }
            ForEach(packed, id: \.person.id) { pp in
                Text(pp.person.displayName).font(.headline)
                ForEach(included.filter { AskKey.parse($0)?.personId == pp.person.id }, id: \.self) { key in
                    if let r = AskItems.resolve(key, data) {
                        HStack {
                            Text(AskItems.label(r, undescribed: t("askPage.undescribed"))).font(.subheadline)
                            Spacer()
                            Button {
                                toggle(key)
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(t("askPage.remove"))
                        }
                    }
                }
            }
            if !included.isEmpty {
                Button(capitalisedFirst(t("askPage.removeAll")), role: .destructive) { included.removeAll() }
            }
            Picker(t("askPage.promptTemplate"), selection: Binding(
                get: { templateId },
                set: { id in
                    templateId = id
                    templateChosen = true
                }
            )) {
                ForEach(Prompts.all) { p in Text(t(p.titleKey)).tag(p.id) }
            }
            Toggle(capitalisedFirst(t("askPage.compact")), isOn: $compact)
            Toggle(capitalisedFirst(t("askPage.evidenceNotes")), isOn: $evidence)
            Toggle(capitalisedFirst(t("askPage.realNames")), isOn: $realNames)
            if !realNames && !named.isEmpty {
                Text(t("askPage.namesWarning", ["names": named.map(\.displayName).joined(separator: ", ")]))
                    .foregroundStyle(severityColor(4))
            }
        } header: {
            Text(t("askPage.includedHeading"))
        }
    }

    private func previewSection(_ pack: String, _ stats: PackStats, empty: Bool) -> some View {
        Section {
            ScrollView([.horizontal, .vertical]) {
                Text(pack)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(8)
            }
            .frame(maxHeight: 480)
            Button(t("askPage.copyButton")) { confirming = true }
                .disabled(empty)
            Text(rich(t("askPage.openAssistant"), links: [
                "chatgpt": URL(string: "https://chatgpt.com")!,
                "claude": URL(string: "https://claude.ai")!,
                "gemini": URL(string: "https://gemini.google.com")!,
            ]))
            .font(.footnote)
            .foregroundStyle(.secondary)
        } header: {
            Text(t("askPage.previewHeading", ["chars": grouped(stats.chars), "tokens": grouped(stats.tokens)]))
        }
    }

    /// An alert shows plain text: the body's markup is dropped, the counts and the log note follow
    /// as the web's list items.
    private func confirmMessage(_ packed: [PackPerson], _ stats: PackStats) -> String {
        let body = String(rich(t("askPage.confirmBody")).characters)
        let counts = t("askPage.confirmCounts", [
            "genotypes": stats.genotypes,
            "healthEntries": stats.healthEntries,
            "people": packed.count,
            "peopleWord": packed.count == 1 ? t("askPage.person") : t("askPage.peopleWord"),
            "naming": realNames ? t("askPage.withRealNames") : t("askPage.pseudonymised"),
        ])
        return "\(body)\n\n• \(counts)\n• \(t("askPage.confirmLogged"))"
    }

    // MARK: - Actions

    private func whoPrefix(_ personId: String) -> String {
        guard people.count > 1, let p = people.first(where: { $0.id == personId }) else { return "" }
        return "\(p.displayName) · "
    }

    private func reason(_ r: Reason) -> String {
        switch r {
        case .recent(let kind): return t("askPage.reason.recent", ["kind": t("kind.\(kind.rawValue)")])
        case .mentioned(let term): return t("askPage.reason.mentioned", ["term": term])
        case .matchesQuestion(let term): return t("askPage.reason.matchesQuestion", ["term": term])
        case .pharmacogenomic: return t("askPage.reason.pharmacogenomic")
        case .notable: return t("askPage.reason.notable")
        case .sharedVariant: return t("askPage.reason.sharedVariant")
        }
    }

    private func toggle(_ key: String) {
        if let i = included.firstIndex(of: key) { included.remove(at: i) } else { included.append(key) }
    }

    private func setPerson(_ id: String, _ on: Bool) {
        if on {
            if !selected.contains(id) { selected.append(id) }
        } else {
            selected.removeAll { $0 == id }
            included.removeAll { AskKey.parse($0)?.personId == id }
        }
    }

    private func addRaw(_ personId: String, _ calls: [Call]) {
        if calls.isEmpty { return }
        var mine = data.rawBy[personId] ?? [:]
        for c in calls { mine[c.rsid] = c }
        data.rawBy[personId] = mine
    }

    private func loadPersons() {
        do {
            persons = try repo.persons()
            if persons.count == 1 && selected.isEmpty { selected = [persons[0].id] }
        } catch {
            notice = t("native.error", ["error": error.localizedDescription])
        }
    }

    /// Findings and the health log, once per selected person, read off the main thread.
    private func load(_ ids: [String]) {
        let missing = ids.filter { !requested.contains($0) }
        if missing.isEmpty { return }
        requested.formUnion(missing)
        let repo = self.repo
        let kb = self.kb
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { () throws -> [(String, [Finding], [HealthEntry])] in
                let log = try repo.healthLog()
                return try missing.map { id in
                    let calls = try repo.personCallsFor(personId: id, rsids: kb.entries.map(\.rsid))
                    return (id, KbLogic.computeFindings(kb, calls), log.filter { $0.personId == id })
                }
            }
            DispatchQueue.main.async {
                switch result {
                case .success(let loaded):
                    for (id, findings, health) in loaded {
                        data.healthBy[id] = health
                        data.findingsBy[id] = findings
                    }
                case .failure(let error):
                    requested.subtract(missing)
                    notice = t("native.error", ["error": error.localizedDescription])
                }
            }
        }
    }

    /// The pack on the clipboard for this device only and for ten minutes, so health data neither
    /// syncs to the user's other devices through Universal Clipboard nor lingers there; then the
    /// copy is recorded in the sharing log and the chat history.
    private func copy(_ pack: String, _ packed: [PackPerson]) {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: pack]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(10 * 60)]
        )
        let message: String
        do {
            try repo.recordCopyOut(
                destination: "clipboard", personIds: packed.map(\.person.id), question: question, pack: pack
            )
            message = t("askPage.copied", ["destination": "clipboard"])
        } catch {
            message = t("native.error", ["error": error.localizedDescription])
        }
        // After the confirmation alert has gone: one alert cannot replace another in the same update.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { notice = message }
    }
}

/// One record with a check mark: included or not.
private struct PickRow: View {
    let on: Bool
    let label: String
    var detail: String?
    var disabled = false
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(on ? Color.accentColor : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(disabled ? .secondary : .primary)
                    if let detail {
                        Text(detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .disabled(disabled)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Find any record for the selected people (AskSearch.tsx): the health log by text and kind, DNA by
/// gene, drug, condition or rsid. An rsid the knowledge base does not describe is looked up in the
/// stored genotypes directly, so any SNP from a raw file can go into the pack.
private struct FindRecords: View {
    let repo: Repo
    let kb: Kb
    let people: [Person]
    let data: AskData
    let included: [String]
    let onToggle: (String) -> Void
    let onRaw: (String, [Call]) -> Void

    private enum DnaScope: String, CaseIterable {
        case search, drugs, notable, all
    }

    private static let maxResults = 60

    @State private var dna = false
    @State private var text = ""
    @State private var kind: HealthKind?
    @State private var who = ""
    @State private var dnaQuery = ""
    @State private var dnaScope = DnaScope.search
    @State private var lookedUp: [String] = []

    private var scoped: [Person] { people.filter { who.isEmpty || $0.id == who } }

    private func prefix(_ p: Person) -> String { people.count > 1 ? "\(p.displayName) · " : "" }

    /// rsids typed into the DNA search that the kb does not know: looked up in the genotype table.
    private var rsids: [String] {
        let known = Set(kb.entries.map(\.rsid))
        let lower = dnaQuery.lowercased()
        guard let regex = try? NSRegularExpression(pattern: #"rs\d+"#) else { return [] }
        var out: [String] = []
        for m in regex.matches(in: lower, range: NSRange(location: 0, length: (lower as NSString).length)) {
            let r = (lower as NSString).substring(with: m.range)
            if !known.contains(r) && !out.contains(r) { out.append(r) }
        }
        return out
    }

    var body: some View {
        Section(t("askPage.findHeading")) {
            Picker(t("askPage.findHeading"), selection: $dna) {
                Text(t("askPage.tabHealth")).tag(false)
                Text(t("askPage.tabDna")).tag(true)
            }
            .pickerStyle(.segmented)
            if people.count > 1 {
                Picker(t("healthPage.filterPerson"), selection: $who) {
                    Text(t("askPage.allSelected")).tag("")
                    ForEach(people) { p in Text(p.displayName).tag(p.id) }
                }
            }
            if dna { dnaSearch } else { healthSearch }
        }
        // A short pause after typing, then the lookup (the web's 300 ms debounce).
        .task(id: rsids.joined(separator: ",") + "|" + people.map(\.id).joined(separator: ",")) {
            let wanted = rsids
            if wanted.isEmpty {
                lookedUp = []
                return
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            for p in people {
                if let calls = try? repo.personCallsFor(personId: p.id, rsids: wanted) { onRaw(p.id, calls) }
            }
            lookedUp = wanted
        }
    }

    @ViewBuilder
    private var healthSearch: some View {
        TextField(t("askPage.searchHealth"), text: $text)
        Picker(t("healthLog.kind"), selection: $kind) {
            Text(t("healthTable.allKinds")).tag(HealthKind?.none)
            ForEach(HealthKind.allCases) { k in Text(t("kind.\(k.rawValue)")).tag(HealthKind?.some(k)) }
        }
        let hits = scoped.flatMap { p in
            HealthLog.filter(data.healthBy[p.id] ?? [], HealthFilter(kind: kind, text: text)).map { (p, $0) }
        }
        if hits.isEmpty {
            Text(t("askPage.noHealthHits")).foregroundStyle(.secondary)
        } else {
            Button(capitalisedFirst(t("askPage.includeAll", ["n": hits.count]))) {
                for (p, h) in hits where !included.contains(AskKey.health(p.id, h.id)) { onToggle(AskKey.health(p.id, h.id)) }
            }
            ForEach(Array(hits.prefix(FindRecords.maxResults)), id: \.1.id) { p, h in
                let key = AskKey.health(p.id, h.id)
                PickRow(on: included.contains(key), label: prefix(p) + HealthLog.describeEntry(h)) { onToggle(key) }
            }
            if hits.count > FindRecords.maxResults {
                Text(t("askPage.moreResults", ["n": hits.count - FindRecords.maxResults])).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var dnaSearch: some View {
        TextField(t("askPage.searchDna"), text: Binding(
            get: { dnaQuery },
            set: { q in
                dnaQuery = q
                dnaScope = .search
            }
        ))
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach([DnaScope.drugs, .notable, .all], id: \.self) { s in
                    Chip(label: t("askPage.dnaScope.\(s.rawValue)"), selected: dnaScope == s) {
                        dnaScope = dnaScope == s ? .search : s
                    }
                }
            }
        }
        let entries = dnaEntries
        let rsids = self.rsids
        if entries.isEmpty && rsids.isEmpty {
            Text(dnaQuery.trimmingCharacters(in: .whitespaces).isEmpty ? t("askPage.dnaHint") : t("askPage.noDnaHits"))
                .foregroundStyle(.secondary)
        }
        ForEach(entries) { e in
            ForEach(scoped) { p in dnaRow(e, p) }
        }
        ForEach(lookedUp, id: \.self) { rsid in
            ForEach(scoped) { p in
                if let c = data.rawBy[p.id]?[rsid] {
                    let key = AskKey.genotype(p.id, rsid)
                    PickRow(
                        on: included.contains(key),
                        label: prefix(p) + "\(rsid) \(c.a1)/\(c.a2) (chr\(c.chromosome):\(c.position))",
                        detail: t("askPage.notInKb")
                    ) { onToggle(key) }
                } else {
                    PickRow(on: false, label: prefix(p) + rsid, detail: t("askPage.notGenotyped"), disabled: true) {}
                }
            }
        }
    }

    @ViewBuilder
    private func dnaRow(_ e: KbEntry, _ p: Person) -> some View {
        let f = data.findingsBy[p.id]?.first { $0.entry.rsid == e.rsid }
        if !(dnaScope == .notable && (f?.match?.magnitude ?? 0) < 2) {
            let genotype = f.map { "\($0.call.a1)/\($0.call.a2)" } ?? ""
            let label = prefix(p) + "\(e.gene) \(e.rsid) \(genotype) — \(f?.match?.label ?? e.name) [\(e.evidence)]"
            if f == nil {
                PickRow(on: false, label: label, detail: t("askPage.notGenotyped"), disabled: true) {}
            } else {
                let key = AskKey.finding(p.id, e.rsid)
                PickRow(on: included.contains(key), label: label) { onToggle(key) }
            }
        }
    }

    /// Every word is its own search ("rs429358 warfarin"), in kb order without repeats.
    private var dnaEntries: [KbEntry] {
        switch dnaScope {
        case .search:
            let words = dnaQuery.components(separatedBy: CharacterSet(charactersIn: ",;").union(.whitespacesAndNewlines))
                .filter { $0.count >= 2 }
            let hit = Set(words.flatMap { KbLogic.search(kb, $0).map(\.rsid) })
            return kb.entries.filter { hit.contains($0.rsid) }
        case .drugs:
            return kb.entries.filter { $0.topic == "pharmacogenomics" }
        case .notable, .all:
            return kb.entries
        }
    }
}
