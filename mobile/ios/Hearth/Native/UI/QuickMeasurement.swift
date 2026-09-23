import SwiftUI

/// One line for the numbers people record over and over (QuickMeasurement.tsx): pick the parameter,
/// type the number, save. Date and time are now, the unit comes from the preset, and the parameters
/// this person already records come first. Anything more belongs in the full form.
struct QuickMeasurement: View {
    @ObservedObject var store: HealthStore
    /// The person in scope, or "" to pick one here.
    let initialPerson: String

    /// The tag of "something else": a title and unit typed here.
    private static let custom = ""

    @State private var personId = ""
    @State private var presetId: String?
    @State private var title = ""
    @State private var unit = ""
    @State private var value = ""
    @State private var value2 = ""
    @State private var asking = false
    @State private var ticked = ConsentChecks.unticked(.importDocument)
    @State private var saved: String?
    @State private var failure: String?

    private var order: [HealthPreset] {
        HealthPresets.measurementOrder(store.entries.filter { personId.isEmpty || $0.personId == personId })
    }

    private var selectedId: String { presetId ?? order.first?.id ?? QuickMeasurement.custom }
    private var preset: HealthPreset? { HealthPresets.find(selectedId) }
    private var pair: [String]? { preset?.pair }
    private var finalTitle: String { preset?.title ?? title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var finalUnit: String { preset?.unit ?? unit.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var valid: Bool {
        !personId.isEmpty && !finalTitle.isEmpty && QuickMeasurement.number(value) != nil
            && (pair == nil || QuickMeasurement.number(value2) != nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("quick.label")).font(.subheadline.weight(.semibold))
            HStack {
                if store.persons.count > 1 {
                    Picker(t("healthPage.colPerson"), selection: $personId) {
                        Text(t("healthForm.pickPerson")).tag("")
                        ForEach(store.persons) { p in Text(p.displayName).tag(p.id) }
                    }
                }
                Picker(t("quick.parameter"), selection: Binding(
                    get: { selectedId },
                    set: { id in
                        presetId = id
                        value = ""
                        value2 = ""
                    }
                )) {
                    ForEach(order) { p in Text(t("preset.\(p.id)")).tag(p.id) }
                    Text(t("quick.custom")).tag(QuickMeasurement.custom)
                }
            }
            .pickerStyle(.menu)
            if preset == nil {
                HStack {
                    TextField(t("quick.customPlaceholder"), text: $title)
                    TextField(t("healthLog.unitPlaceholder"), text: $unit).frame(maxWidth: 100)
                }
                .textFieldStyle(.roundedBorder)
            }
            HStack {
                TextField(pair.map { t("preset.pair.\($0[0])") } ?? t("healthLog.value"), text: $value)
                    .keyboardType(.decimalPad)
                if let pair, pair.count > 1 {
                    TextField(t("preset.pair.\(pair[1])"), text: $value2)
                        .keyboardType(.decimalPad)
                }
                if let preset, let unit = preset.unit {
                    Text(unit).foregroundStyle(.secondary)
                }
                Button(t("quick.save")) { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!valid)
            }
            .textFieldStyle(.roundedBorder)
            if let saved {
                Text(t("quick.saved", ["what": saved])).font(.caption).foregroundStyle(.tint)
            }
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.red)
            }
        }
        .padding(12)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .onAppear { if personId.isEmpty { personId = initialPerson } }
        .onChange(of: initialPerson) { _, id in personId = id }
        .sheet(isPresented: $asking) { consentSheet }
    }

    /// The person's first entry asks for the document consent, as the full form does.
    private var consentSheet: some View {
        NavigationStack {
            Form {
                ConsentChecks(kind: .importDocument, ticked: $ticked, header: t(ConsentKind.importDocument.titleKey))
                Section {
                    Button(t("consentForm.confirm")) {
                        do {
                            try store.grantDocumentConsent(personId)
                            asking = false
                            save()
                        } catch {
                            failure = t("native.error", ["error": error.localizedDescription])
                        }
                    }
                    .disabled(!ConsentChecks.allTicked(ticked, .importDocument))
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { asking = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// A number as typed: either decimal separator, since a decimal pad offers the locale's own.
    private static func number(_ text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, let n = Double(cleaned), n.isFinite else { return nil }
        return n
    }

    private func save() {
        guard valid else { return }
        do {
            guard try store.hasDocumentConsent(personId) else {
                ticked = ConsentChecks.unticked(.importDocument)
                asking = true
                return
            }
            let v = QuickMeasurement.number(value)
            let v2 = pair != nil ? QuickMeasurement.number(value2) : nil
            let clock = Calendar.current.dateComponents([.hour, .minute], from: Date())
            let entry = try store.add(HealthEntry(
                id: "", personId: personId, date: HealthLog.localDate(),
                time: String(format: "%02ld:%02ld", clock.hour ?? 0, clock.minute ?? 0),
                kind: .measurement, title: finalTitle, body: "", source: "", bodyPart: preset?.bodyPart ?? "",
                severity: nil, tags: preset?.tags ?? [], value: v, value2: v2, unit: finalUnit, createdAt: ""
            ))
            saved = "\(finalTitle) \(HealthLog.formatValue(entry))"
            value = ""
            value2 = ""
            failure = nil
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }
}
