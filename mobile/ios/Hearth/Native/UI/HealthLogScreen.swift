import SwiftUI

/// Cards or the table; the choice is remembered, under the key the web uses for the same thing.
enum HealthLayout: String {
    case cards, table
}

/// The Health log (docs/architecture/native-apps.md, "Health log screen"), the native twin of the
/// web's HealthPage + HealthTable: person scope, search, kind chips with counts, a Filters sheet,
/// removable filter chips, a sort menu, and the log as day-grouped cards or a table.
struct HealthLogScreen: View {
    @ObservedObject var store: HealthStore

    @State private var filter = HealthFilter()
    @State private var sortKey: HealthSortKey = .date
    @State private var sortDir: SortDir = HealthSortKey.date.defaultDir
    @AppStorage("hearth.healthView") private var layout: HealthLayout = .cards
    @State private var showingFilters = false
    @State private var adding = false
    @State private var opened: HealthEntry?
    /// A message for an alert: a failure, or what a restore did.
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            Group {
                if store.persons.isEmpty {
                    RestoreBackupView(store: store) { result in notice = restoredMessage(result) }
                } else {
                    log
                }
            }
            .navigationTitle(t("healthPage.title"))
            .toolbar { toolbar }
            .sheet(isPresented: $showingFilters) {
                HealthFiltersSheet(store: store, filter: $filter, shownCount: shown.count)
            }
            .sheet(isPresented: $adding) {
                AddEntrySheet(store: store, personId: defaultPerson)
            }
            .sheet(item: $opened) { entry in
                EntryDetailSheet(
                    entry: entry,
                    personName: store.personName(entry.personId),
                    attachments: store.attachments[entry.id] ?? []
                ) {
                    opened = nil
                    do {
                        try store.delete(entry)
                    } catch {
                        notice = t("native.error", ["error": error.localizedDescription])
                    }
                }
            }
            .alert(notice ?? "", isPresented: noticeShown) {
                Button(t("common.close"), role: .cancel) {}
            }
        }
    }

    // MARK: - Derived state

    /// The person column and the person on each card only mean something in the Everyone scope.
    private var showPerson: Bool { filter.person.isEmpty }

    private var shown: [HealthEntry] {
        HealthLog.sort(HealthLog.filter(store.entries, filter), sortKey, sortDir, personName: store.personName)
    }

    /// Counts per kind within the person scope, as on the web: the chips say what each would show.
    private var scoped: [HealthEntry] {
        HealthLog.filter(store.entries, HealthFilter(person: filter.person))
    }

    /// Whose entry a new one is: the person in scope, or the only person there is.
    private var defaultPerson: String {
        if !filter.person.isEmpty { return filter.person }
        return store.persons.count == 1 ? store.persons[0].id : ""
    }

    private var noticeShown: Binding<Bool> {
        Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
    }

    private var sortKeys: [HealthSortKey] {
        HealthSortKey.allCases.filter { showPerson || $0 != .person }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if !store.persons.isEmpty {
            ToolbarItem(placement: .topBarLeading) {
                let count = filter.panelCount
                Button {
                    showingFilters = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: count > 0
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                        if count > 0 {
                            Text(String(count)).font(.caption.weight(.bold)).monospacedDigit()
                        }
                    }
                }
                .accessibilityLabel(t("healthTable.filters"))
                .accessibilityValue(count > 0 ? String(count) : "")
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                displayMenu
                Button {
                    adding = true
                } label: {
                    Label(t("healthLog.addEntry"), systemImage: "plus")
                }
            }
        }
    }

    /// Sort key, direction and layout in one menu. Picking a new key starts it in its default
    /// direction (`HEALTH_SORT_DEFAULT_DIR`), as the web's select does.
    private var displayMenu: some View {
        Menu {
            Picker(t("healthTable.sortBy"), selection: Binding(
                get: { sortKey },
                set: { key in
                    sortKey = key
                    sortDir = key.defaultDir
                }
            )) {
                ForEach(sortKeys) { key in
                    Text(sortLabel(key)).tag(key)
                }
            }
            Picker(t("healthTable.sortBy"), selection: $sortDir) {
                Label(t("healthTable.sortAsc"), systemImage: "arrow.up").tag(SortDir.asc)
                Label(t("healthTable.sortDesc"), systemImage: "arrow.down").tag(SortDir.desc)
            }
            Picker(t("healthTable.viewCards"), selection: $layout) {
                Label(t("healthTable.viewCards"), systemImage: "rectangle.grid.1x2").tag(HealthLayout.cards)
                Label(t("healthTable.viewTable"), systemImage: "tablecells").tag(HealthLayout.table)
            }
        } label: {
            Label(t("healthTable.sortBy"), systemImage: "arrow.up.arrow.down.circle")
        }
    }

    // MARK: - Log

    private var log: some View {
        let shown = self.shown
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 12, pinnedViews: [.sectionHeaders]) {
                scopeChips
                if store.entries.isEmpty {
                    Text(t("healthTable.empty"))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                } else {
                    kindChips
                    statusRow(shownCount: shown.count)
                    if shown.isEmpty {
                        Text(t("healthLog.nothingMatches"))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal)
                    } else if layout == .table {
                        HealthTableView(
                            entries: shown,
                            showPerson: showPerson,
                            personName: store.personName,
                            attachments: store.attachments,
                            sortKey: sortKey,
                            sortDir: sortDir,
                            activeTag: filter.tag,
                            onSort: toggleSort,
                            onOpen: { opened = $0 },
                            onTag: toggleTag
                        )
                    } else if sortKey == .date {
                        ForEach(HealthLog.groupByDate(shown)) { group in
                            Section {
                                ForEach(group.entries) { entry in card(entry, grouped: true) }
                            } header: {
                                dayHeader(group)
                            }
                        }
                    } else {
                        ForEach(shown) { entry in card(entry, grouped: false) }
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .searchable(text: $filter.text, prompt: Text(t("healthLog.searchText")))
    }

    /// "Everyone" and then each person: the web's person tabs.
    private var scopeChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(label: t("healthPage.everyone"), selected: filter.person.isEmpty) {
                    filter.person = ""
                }
                ForEach(store.persons) { person in
                    Chip(label: person.displayName, selected: filter.person == person.id) {
                        filter.person = person.id
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    private var kindChips: some View {
        let scoped = self.scoped
        var counts: [HealthKind: Int] = [:]
        for entry in scoped { counts[entry.kind, default: 0] += 1 }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(label: t("healthTable.allKinds"), count: scoped.count, selected: filter.kind == nil) {
                    filter.kind = nil
                }
                ForEach(HealthKind.allCases.filter { counts[$0] != nil }) { kind in
                    Chip(
                        label: t("kind.\(kind.rawValue)"),
                        count: counts[kind],
                        dot: kind.color,
                        selected: filter.kind == kind
                    ) {
                        filter.kind = filter.kind == kind ? nil : kind
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    /// The active panel filters as removable chips, so a closed sheet still says what is hidden;
    /// then "n of m" and clear.
    private func statusRow(shownCount: Int) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if !filter.person.isEmpty {
                    removable(store.personName(filter.person)) { filter.person = "" }
                }
                if !filter.bodyPart.isEmpty {
                    removable(filter.bodyPart) { filter.bodyPart = "" }
                }
                if !filter.tag.isEmpty {
                    removable("#" + filter.tag) { filter.tag = "" }
                }
                if let least = filter.minSeverity {
                    removable(t("healthTable.severityAtLeast", ["n": least])) { filter.minSeverity = nil }
                }
                if !filter.from.isEmpty || !filter.to.isEmpty {
                    removable(periodLabel) {
                        filter.from = ""
                        filter.to = ""
                    }
                }
                Text(t("healthLog.shownOf", ["n": shownCount, "m": store.entries.count]))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if filter.isFiltering {
                    Button(t("common.clear")) { filter = HealthFilter() }
                        .font(.subheadline)
                }
            }
            .padding(.horizontal)
        }
    }

    private var periodLabel: String {
        let from = filter.from.isEmpty ? "…" : filter.from
        let to = filter.to.isEmpty ? "…" : filter.to
        return "\(from) – \(to)"
    }

    private func removable(_ label: String, clear: @escaping () -> Void) -> some View {
        Chip(label: label, selected: true, trailingSymbol: "xmark", action: clear)
            .accessibilityLabel(t("healthTable.removeFilter", ["label": label]))
    }

    private func dayHeader(_ group: DayGroup) -> some View {
        HStack(spacing: 4) {
            Text(dayHeading(group.date)).font(.headline)
            Text(verbatim: "· \(group.entries.count)").foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private func card(_ entry: HealthEntry, grouped: Bool) -> some View {
        EntryCard(
            entry: entry,
            personName: showPerson ? store.personName(entry.personId) : nil,
            grouped: grouped,
            attachmentCount: store.attachments[entry.id]?.count ?? 0,
            activeTag: filter.tag,
            onTag: toggleTag
        )
        .padding(.horizontal)
        .onTapGesture { opened = entry }
    }

    // MARK: - Actions

    /// A table header: the same key flips direction, another starts in its default.
    private func toggleSort(_ key: HealthSortKey) {
        if sortKey == key {
            sortDir = sortDir.flipped
        } else {
            sortKey = key
            sortDir = key.defaultDir
        }
    }

    private func toggleTag(_ tag: String) {
        filter.tag = filter.tag == tag ? "" : tag
    }

    private func sortLabel(_ key: HealthSortKey) -> String {
        switch key {
        case .date: return t("healthTable.colDate")
        case .person: return t("healthPage.colPerson")
        case .kind: return t("healthLog.kind")
        case .title: return t("healthLog.titleField")
        case .value: return t("healthLog.value")
        case .bodyPart: return t("healthLog.bodyPart")
        case .severity: return t("healthLog.severity")
        }
    }

    /// "Today", "Yesterday", or the date in the app's language, with the year only when it is not
    /// this year's: the web's day headings.
    private func dayHeading(_ date: String) -> String {
        let today = HealthLog.localDate()
        if date == today { return t("healthTable.today") }
        if date == HealthLog.daysBefore(today, 1) { return t("healthTable.yesterday") }
        guard let day = HealthLog.parseDate(date) else { return date }
        var style = Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated)
        if date.prefix(4) != today.prefix(4) { style = style.year() }
        return day.formatted(style.locale(Locale(identifier: Strings.shared.language)))
    }

    /** One line for every platform: what came across, and that genomes and files do not yet. */
    private func restoredMessage(_ r: RestoreResult) -> String {
        t("native.restored", ["people": r.people, "entries": r.entries])
    }
}

/// One entry as a card: kind, person, time, title with the value large at the trailing edge, then
/// body part, severity, a text marker and the attachment count, and the tags, each of which filters.
struct EntryCard: View {
    let entry: HealthEntry
    /// Nil when the log is scoped to one person.
    let personName: String?
    /// Under a day heading, which already says the date.
    let grouped: Bool
    let attachmentCount: Int
    let activeTag: String
    let onTag: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                KindBadge(kind: entry.kind)
                if let personName {
                    Text(personName).font(.subheadline.weight(.semibold))
                }
                Spacer(minLength: 0)
                Text(grouped ? entry.time : HealthLog.when(entry))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(entry.title)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if entry.value != nil {
                    Text(HealthLog.formatValue(entry))
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                }
            }
            if !entry.bodyPart.isEmpty || entry.severity != nil || !entry.body.isEmpty || attachmentCount > 0 {
                HStack(spacing: 12) {
                    if !entry.bodyPart.isEmpty {
                        Text(entry.bodyPart)
                    }
                    if let severity = entry.severity {
                        HStack(spacing: 4) {
                            Text(t("healthLog.severity"))
                            Text(verbatim: "\(severity)/10")
                                .fontWeight(.semibold)
                                .foregroundStyle(severityColor(severity))
                        }
                    }
                    if !entry.body.isEmpty {
                        Image(systemName: "text.alignleft")
                    }
                    if attachmentCount > 0 {
                        Label(String(attachmentCount), systemImage: "paperclip")
                            .accessibilityLabel(t("healthTable.hasAttachments", ["n": attachmentCount]))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if !entry.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(entry.tags, id: \.self) { tag in
                            Chip(label: tag, selected: tag == activeTag) { onTag(tag) }
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityAddTraits(.isButton)
    }
}

/// The table: the web's columns in a grid that scrolls sideways. A header sorts by its column.
struct HealthTableView: View {
    let entries: [HealthEntry]
    let showPerson: Bool
    let personName: (String) -> String
    let attachments: [String: [Attachment]]
    let sortKey: HealthSortKey
    let sortDir: SortDir
    let activeTag: String
    let onSort: (HealthSortKey) -> Void
    let onOpen: (HealthEntry) -> Void
    let onTag: (String) -> Void

    private struct Column: Identifiable {
        let id: String
        /// Nil for the tags column, which does not sort (as on the web).
        let key: HealthSortKey?
        let title: String
        let width: CGFloat
    }

    private var columns: [Column] {
        var all = [Column(id: "date", key: .date, title: t("healthTable.colDate"), width: 130)]
        if showPerson {
            all.append(Column(id: "person", key: .person, title: t("healthPage.colPerson"), width: 110))
        }
        all += [
            Column(id: "kind", key: .kind, title: t("healthLog.kind"), width: 140),
            Column(id: "title", key: .title, title: t("healthLog.titleField"), width: 220),
            Column(id: "value", key: .value, title: t("healthLog.value"), width: 120),
            Column(id: "bodyPart", key: .bodyPart, title: t("healthLog.bodyPart"), width: 120),
            Column(id: "severity", key: .severity, title: t("healthLog.severity"), width: 90),
            Column(id: "tags", key: nil, title: t("healthTable.colTags"), width: 200),
        ]
        return all
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(columns) { column in header(column) }
                }
                Divider()
                ForEach(entries) { entry in
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        ForEach(columns) { column in
                            cell(column.id, entry)
                                .frame(width: column.width, alignment: .leading)
                                .padding(.horizontal, 6)
                        }
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                    .onTapGesture { onOpen(entry) }
                    Divider()
                }
            }
            .padding(.horizontal)
        }
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }

    @ViewBuilder
    private func header(_ column: Column) -> some View {
        Group {
            if let key = column.key {
                Button {
                    onSort(key)
                } label: {
                    HStack(spacing: 4) {
                        Text(column.title)
                        Image(systemName: sortKey == key
                              ? (sortDir == .asc ? "chevron.up" : "chevron.down")
                              : "chevron.up.chevron.down")
                            .imageScale(.small)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Text(column.title)
            }
        }
        .font(.subheadline.weight(.semibold))
        .frame(width: column.width, alignment: .leading)
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func cell(_ id: String, _ entry: HealthEntry) -> some View {
        switch id {
        case "date":
            HStack(spacing: 4) {
                Text(entry.date)
                if !entry.time.isEmpty { Text(entry.time).foregroundStyle(.secondary) }
            }
            .monospacedDigit()
        case "person":
            Text(personName(entry.personId))
        case "kind":
            KindBadge(kind: entry.kind)
        case "title":
            HStack(spacing: 4) {
                Text(entry.title)
                if !entry.body.isEmpty { Image(systemName: "text.alignleft").foregroundStyle(.secondary) }
                if let count = attachments[entry.id]?.count, count > 0 {
                    Label(String(count), systemImage: "paperclip")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        case "value":
            Text(HealthLog.formatValue(entry)).monospacedDigit()
        case "bodyPart":
            Text(entry.bodyPart)
        case "severity":
            if let severity = entry.severity {
                Text(verbatim: "\(severity)/10")
                    .fontWeight(.semibold)
                    .foregroundStyle(severityColor(severity))
            }
        default:
            HStack(spacing: 4) {
                ForEach(entry.tags, id: \.self) { tag in
                    Chip(label: tag, selected: tag == activeTag) { onTag(tag) }
                }
            }
        }
    }
}
