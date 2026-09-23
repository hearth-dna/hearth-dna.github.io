import SwiftUI

/// Everyone, their parents and how many genotypes each has, re-read after every change and
/// whenever the tab appears (the Health tab may have restored a backup meanwhile). Main thread
/// only; the genome imports that change it run in their sheets.
final class PeopleStore: ObservableObject {
    @Published private(set) var persons: [Person] = []
    @Published private(set) var relationships: [Relationship] = []
    @Published private(set) var counts: [String: Int] = [:]
    @Published private(set) var loaded = false

    let repo: Repo

    init(repo: Repo) {
        self.repo = repo
    }

    func reload() throws {
        persons = try repo.persons()
        relationships = try repo.relationships()
        counts = try repo.genotypeCounts()
        loaded = true
    }

    func parents(of id: String) -> [String] {
        relationships.filter { $0.childId == id }.map(\.parentId)
    }

    func name(_ id: String) -> String {
        persons.first { $0.id == id }?.displayName ?? "?"
    }

    func add(label: String, displayName: String, sex: Sex, birthYear: Int?) throws {
        try repo.addPerson(label: label, displayName: displayName, sex: sex, birthYear: birthYear)
        try reload()
    }

    func update(_ id: String, displayName: String, sex: Sex, birthYear: Int?) throws {
        try repo.updatePerson(id: id, displayName: displayName, sex: sex, birthYear: birthYear)
        try reload()
    }

    func delete(_ id: String) throws {
        try repo.deletePerson(id: id)
        try reload()
    }

    func setParent(_ parentId: String, of childId: String) throws {
        try repo.setParent(parentId: parentId, childId: childId)
        try reload()
    }

    func unsetParent(_ parentId: String, of childId: String) throws {
        try repo.unsetParent(parentId: parentId, childId: childId)
        try reload()
    }
}

/// Cards, the table or the family tree; the choice is remembered.
enum PeopleLayout: String {
    case cards, table, tree
}

/// The family (PeoplePage.tsx): everyone with sex, birth year, how many SNPs they have and who their
/// parents are, as cards, a table or a tree. A person is added or edited in a sheet; their DNA file
/// is imported from their card; several files at once make one new person each. A person with
/// genotypes opens their report, pushed onto this tab's stack.
struct PeopleScreen: View {
    @ObservedObject var store: PeopleStore
    let kb: Kb
    /// Opens the Health tab scoped to this person id.
    let onHealthLog: (String) -> Void

    @AppStorage("hearth.peopleView") private var layout: PeopleLayout = .cards
    @State private var report: Person?
    @State private var adding = false
    @State private var editing: Person?
    @State private var importing: Person?
    @State private var batch = false
    @State private var deleting: Person?
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            Group {
                if !store.loaded {
                    Color.clear
                } else if store.persons.isEmpty {
                    empty
                } else {
                    list
                }
            }
            .navigationTitle(t("peoplePage.title"))
            .toolbar { toolbar }
            .navigationDestination(item: $report) { person in
                PersonScreen(repo: store.repo, kb: kb, person: person) {
                    report = nil
                    onHealthLog(person.id)
                }
            }
            .sheet(isPresented: $adding) {
                PersonSheet(person: nil) { label, name, sex, year in
                    try store.add(label: label, displayName: name, sex: sex, birthYear: year)
                }
            }
            .sheet(item: $editing) { person in
                PersonSheet(person: person) { _, name, sex, year in
                    try store.update(person.id, displayName: name, sex: sex, birthYear: year)
                }
            }
            .sheet(item: $importing, onDismiss: reload) { person in
                ImportSheet(repo: store.repo, person: person)
            }
            .sheet(isPresented: $batch, onDismiss: reload) {
                BatchImportSheet(repo: store.repo)
            }
            .confirmationDialog(
                deleting.map { t("peoplePage.confirmDelete", ["name": $0.displayName]) } ?? "",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible,
                presenting: deleting
            ) { person in
                Button(t("peoplePage.delete"), role: .destructive) {
                    write { try store.delete(person.id) }
                }
                Button(t("common.cancel"), role: .cancel) {}
            }
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
        }
        .onAppear(perform: reload)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Menu {
                Button {
                    batch = true
                } label: {
                    Label(t("peoplePage.importSeveral"), systemImage: "square.and.arrow.down.on.square")
                }
            } label: {
                Label(t("peoplePage.importSeveral"), systemImage: "ellipsis.circle")
            }
            Button {
                adding = true
            } label: {
                Label(t("peoplePage.addPerson"), systemImage: "plus")
            }
        }
    }

    // MARK: - Content

    private var empty: some View {
        ContentUnavailableView {
            Label(t("peoplePage.title"), systemImage: "person.2")
        } description: {
            Text(t("peoplePage.noOneYet", ["providers": Provider.allCases.map(\.label).joined(separator: ", ")]))
        } actions: {
            Button(t("peoplePage.addPerson")) { adding = true }
                .buttonStyle(.borderedProminent)
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Picker(t("peoplePage.view"), selection: $layout) {
                    Text(t("peoplePage.viewCards")).tag(PeopleLayout.cards)
                    Text(t("peoplePage.viewTable")).tag(PeopleLayout.table)
                    Text(t("peoplePage.viewTree")).tag(PeopleLayout.tree)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                switch layout {
                case .cards:
                    ForEach(store.persons) { person in
                        PersonCard(
                            person: person,
                            parents: store.parents(of: person.id),
                            everyone: store.persons,
                            snps: store.counts[person.id] ?? 0,
                            name: store.name,
                            actions: actions
                        )
                        .padding(.horizontal)
                    }
                case .table:
                    PeopleTable(
                        persons: store.persons,
                        counts: store.counts,
                        parents: store.parents(of:),
                        name: store.name,
                        actions: actions
                    )
                case .tree:
                    FamilyTree(
                        persons: store.persons,
                        relationships: store.relationships,
                        counts: store.counts,
                        onOpen: { report = $0 }
                    )
                }
            }
            .padding(.vertical, 8)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private var actions: PersonActions {
        PersonActions(
            onOpen: { report = $0 },
            onImport: { importing = $0 },
            onEdit: { editing = $0 },
            onDelete: { deleting = $0 },
            onAddParent: { person, parentId in write { try store.setParent(parentId, of: person.id) } },
            onRemoveParent: { person, parentId in write { try store.unsetParent(parentId, of: person.id) } }
        )
    }

    // MARK: - Actions

    private func reload() {
        write { try store.reload() }
    }

    private func write(_ body: () throws -> Void) {
        do {
            try body()
        } catch {
            notice = t("native.error", ["error": error.localizedDescription])
        }
    }
}

/// What a card or a table row can do to its person.
struct PersonActions {
    let onOpen: (Person) -> Void
    let onImport: (Person) -> Void
    let onEdit: (Person) -> Void
    let onDelete: (Person) -> Void
    let onAddParent: (Person, String) -> Void
    let onRemoveParent: (Person, String) -> Void
}

private func sexLabel(_ raw: String) -> String {
    capitalisedFirst(t(Sex.of(raw).labelKey))
}

/// One person: facts, parents as removable chips with an "add parent" menu, and the actions.
struct PersonCard: View {
    let person: Person
    let parents: [String]
    let everyone: [Person]
    let snps: Int
    let name: (String) -> String
    let actions: PersonActions

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(person.displayName).font(.title3.weight(.semibold))
                Text(person.label).font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Menu {
                    Button(capitalisedFirst(t("peoplePage.edit"))) { actions.onEdit(person) }
                    Button(capitalisedFirst(t("peoplePage.delete")), role: .destructive) { actions.onDelete(person) }
                } label: {
                    Image(systemName: "ellipsis.circle").imageScale(.large)
                }
            }
            Text(facts)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(t("peoplePage.parentsHeader")).font(.subheadline.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(parents, id: \.self) { parentId in
                        Chip(label: name(parentId), selected: true, trailingSymbol: "xmark") {
                            actions.onRemoveParent(person, parentId)
                        }
                        .accessibilityLabel(t("peoplePage.removeParent", ["name": name(parentId)]))
                    }
                    let candidates = everyone.filter { $0.id != person.id && !parents.contains($0.id) }
                    if !candidates.isEmpty {
                        Menu {
                            ForEach(candidates) { candidate in
                                Button(candidate.displayName) { actions.onAddParent(person, candidate.id) }
                            }
                        } label: {
                            Text(t("peoplePage.addParent"))
                                .font(.subheadline)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color(uiColor: .secondarySystemFill), in: Capsule())
                        }
                    }
                }
            }
            Divider()
            HStack(spacing: 12) {
                Button(t("peoplePage.importDna")) { actions.onImport(person) }
                    .buttonStyle(.bordered)
                // The report needs genotypes, as on the web.
                Button(t("peoplePage.report")) { actions.onOpen(person) }
                    .buttonStyle(.borderless)
                    .disabled(snps == 0)
            }
        }
        .padding(12)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }

    private var facts: String {
        var parts = [sexLabel(person.sex)]
        if let year = person.birthYear { parts.append(t("peoplePage.born", ["year": year])) }
        parts.append(snps > 0 ? t("peoplePage.snps", ["n": grouped(snps)]) : t("peoplePage.noGenotypes"))
        return parts.joined(separator: " · ")
    }
}

/// The web's table: one row per person, scrolling sideways; tapping a row offers the card's actions.
struct PeopleTable: View {
    let persons: [Person]
    let counts: [String: Int]
    let parents: (String) -> [String]
    let name: (String) -> String
    let actions: PersonActions

    private static let widths: [CGFloat] = [180, 96, 96, 180, 104]
    private static let headers = [
        "peoplePage.name", "peoplePage.sex", "peoplePage.birthYear", "peoplePage.parentsHeader", "peoplePage.snpsHeader",
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(PeopleTable.headers.enumerated()), id: \.offset) { i, key in
                        Text(t(key))
                            .font(.subheadline.weight(.semibold))
                            .frame(width: PeopleTable.widths[i], alignment: .leading)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 8)
                    }
                }
                Divider()
                ForEach(persons) { person in
                    Menu {
                        Button(t("peoplePage.importDna")) { actions.onImport(person) }
                        Button(t("peoplePage.report")) { actions.onOpen(person) }
                            .disabled((counts[person.id] ?? 0) == 0)
                        Button(capitalisedFirst(t("peoplePage.edit"))) { actions.onEdit(person) }
                        Button(capitalisedFirst(t("peoplePage.delete")), role: .destructive) { actions.onDelete(person) }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 0) {
                            ForEach(Array(cells(person).enumerated()), id: \.offset) { i, cell in
                                Text(cell)
                                    .frame(width: PeopleTable.widths[i], alignment: .leading)
                                    .padding(.horizontal, 6)
                            }
                        }
                        .padding(.vertical, 10)
                        .foregroundStyle(.primary)
                        .contentShape(Rectangle())
                    }
                    .tint(.primary)
                    Divider()
                }
            }
            .padding(.horizontal)
        }
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private func cells(_ p: Person) -> [String] {
        let ids = parents(p.id)
        return [
            "\(p.displayName) (\(p.label))",
            sexLabel(p.sex),
            p.birthYear.map { String($0) } ?? "–",
            ids.isEmpty ? "–" : ids.map(name).joined(separator: ", "),
            counts[p.id].map(grouped) ?? "–",
        ]
    }
}

/// Add a person (label, display name, sex, birth year) or edit one (the label stays: backups and
/// exports name people by it).
struct PersonSheet: View {
    let person: Person?
    let onSave: (_ label: String, _ name: String, _ sex: Sex, _ year: Int?) throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var name: String
    @State private var sex: Sex
    @State private var year: String
    @State private var failure: String?

    init(person: Person?, onSave: @escaping (_ label: String, _ name: String, _ sex: Sex, _ year: Int?) throws -> Void) {
        self.person = person
        self.onSave = onSave
        _name = State(initialValue: person?.displayName ?? "")
        _sex = State(initialValue: Sex.of(person?.sex ?? "unknown"))
        _year = State(initialValue: person?.birthYear.map { String($0) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if person == nil {
                        TextField(t("peoplePage.shortLabel"), text: $label, prompt: Text(t("peoplePage.shortLabelPlaceholder")))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    TextField(t("peoplePage.displayName"), text: $name, prompt: Text(t("peoplePage.displayNamePlaceholder")))
                        .textInputAutocapitalization(.words)
                    Picker(t("peoplePage.sex"), selection: $sex) {
                        ForEach(Sex.allCases) { s in
                            Text(capitalisedFirst(t(s.labelKey))).tag(s)
                        }
                    }
                    TextField(t("peoplePage.birthYear"), text: $year, prompt: Text(t("peoplePage.birthYearPlaceholder")))
                        .keyboardType(.numberPad)
                        .onChange(of: year) { _, typed in
                            let digits = String(typed.filter(\.isASCIIDigit).prefix(4))
                            if digits != typed { year = digits }
                        }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle(person?.displayName ?? t("peoplePage.addPerson"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(person == nil ? t("peoplePage.add") : t("common.save")) { save() }
                        .disabled(!valid)
                }
            }
        }
    }

    private var yearValue: Int? {
        Int(year.trimmingCharacters(in: .whitespaces))
    }

    private var valid: Bool {
        let blank = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return (person != nil || !blank(label)) && (person == nil || !blank(name)) && (blank(year) || yearValue != nil)
    }

    /// The web's rules: labels are lower-case, and a blank display name is the label.
    private func save() {
        let l = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try onSave(l, n.isEmpty ? label.trimmingCharacters(in: .whitespacesAndNewlines) : n, sex, yearValue)
            dismiss()
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
