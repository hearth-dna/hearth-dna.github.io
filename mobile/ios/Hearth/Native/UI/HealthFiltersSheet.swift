import SwiftUI

/// The Filters sheet: person, body part, tag, minimum severity and a date range with quick periods
/// (the web's Filters panel). Changes apply as they are made; "Show N" only closes the sheet.
struct HealthFiltersSheet: View {
    @ObservedObject var store: HealthStore
    @Binding var filter: HealthFilter
    let shownCount: Int
    @Environment(\.dismiss) private var dismiss

    /// Quick ranges in days back from today, today included.
    private static let periods = [7, 30, 90, 365]

    var body: some View {
        let facets = HealthLog.facets(store.entries)
        NavigationStack {
            Form {
                Section {
                    Picker(t("healthPage.filterPerson"), selection: $filter.person) {
                        Text(t("healthPage.anyPerson")).tag("")
                        ForEach(store.persons) { person in
                            Text(person.displayName).tag(person.id)
                        }
                    }
                    Picker(t("healthLog.filterBodyPart"), selection: $filter.bodyPart) {
                        Text(t("healthLog.anyBodyPart")).tag("")
                        ForEach(facets.bodyParts, id: \.self) { part in
                            Text(part).tag(part)
                        }
                    }
                    .disabled(facets.bodyParts.isEmpty)
                    Picker(t("healthLog.filterTag"), selection: $filter.tag) {
                        Text(t("healthLog.anyTag")).tag("")
                        ForEach(facets.tags, id: \.self) { tag in
                            Text(tag).tag(tag)
                        }
                    }
                    .disabled(facets.tags.isEmpty)
                    Picker(t("healthTable.minSeverity"), selection: $filter.minSeverity) {
                        Text(t("healthTable.anySeverity")).tag(Int?.none)
                        ForEach(1...10, id: \.self) { n in
                            Text(t("healthTable.severityAtLeast", ["n": n])).tag(Int?.some(n))
                        }
                    }
                }
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(HealthFiltersSheet.periods, id: \.self) { days in
                                periodChip(days)
                            }
                        }
                    }
                    Toggle(t("healthTable.from"), isOn: isSet(\.from))
                    if !filter.from.isEmpty {
                        DatePicker(t("healthTable.from"), selection: date(\.from), displayedComponents: .date)
                            .labelsHidden()
                    }
                    Toggle(t("healthTable.to"), isOn: isSet(\.to))
                    if !filter.to.isEmpty {
                        DatePicker(t("healthTable.to"), selection: date(\.to), displayedComponents: .date)
                            .labelsHidden()
                    }
                } header: {
                    Text(t("healthTable.period"))
                }
            }
            .navigationTitle(t("healthTable.filters"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.clear")) {
                        filter.person = ""
                        filter.bodyPart = ""
                        filter.tag = ""
                        filter.minSeverity = nil
                        filter.from = ""
                        filter.to = ""
                    }
                    .disabled(filter.panelCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("healthTable.showResults", ["n": shownCount])) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// A quick period is on when `from` is exactly that many days back and `to` is open; tapping it
    /// again turns it off.
    private func periodChip(_ days: Int) -> some View {
        let from = HealthLog.daysBefore(HealthLog.localDate(), days - 1)
        let active = filter.from == from && filter.to.isEmpty
        return Chip(
            label: days == 365 ? t("healthTable.periodYear") : t("healthTable.periodDays", ["n": days]),
            selected: active
        ) {
            filter.from = active ? "" : from
            filter.to = ""
        }
    }

    /// A bound turned on starts at today; turned off it is open-ended again.
    private func isSet(_ bound: WritableKeyPath<HealthFilter, String>) -> Binding<Bool> {
        Binding(
            get: { !filter[keyPath: bound].isEmpty },
            set: { on in filter[keyPath: bound] = on ? HealthLog.localDate() : "" }
        )
    }

    private func date(_ bound: WritableKeyPath<HealthFilter, String>) -> Binding<Date> {
        Binding(
            get: { HealthLog.parseDate(filter[keyPath: bound]) ?? Date() },
            set: { filter[keyPath: bound] = HealthLog.localDate($0) }
        )
    }
}
