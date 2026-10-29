import SwiftUI

/// One line for how someone feels right now (QuickSymptom.tsx) — a runny nose, a cough, red eyes —
/// or for a treatment or checkup they had: teeth cleaning, an eye exam. Pick from both lists (the
/// ones this person already records come first; the pick decides symptom or procedure) or type
/// another and say which it is, optionally rate a symptom and add a note, save. Date and time are
/// now. The symptom's structured details and anything else (another date, the side of the body)
/// belong in the full form.
struct QuickSymptom: View {
    @ObservedObject var store: HealthStore
    /// The person in scope, or "" to pick one here.
    let initialPerson: String

    /// Picker tags that are not a preset id: nothing chosen yet, and "something else".
    private static let unchosen = ""
    private static let custom = "*"

    @State private var personId = ""
    @State private var choice = QuickSymptom.unchosen
    @State private var typed = ""
    /// What typed text is saved as; a preset brings its own kind.
    @State private var custom = HealthKind.symptom
    @State private var severity: Int?
    @State private var note = ""
    @State private var asking = false
    @State private var ticked = ConsentChecks.unticked(.importDocument)
    @State private var saved: String?
    @State private var failure: String?

    private var order: [HealthPreset] {
        HealthPresets.presetOrder(
            [.symptom, .procedure], store.entries.filter { personId.isEmpty || $0.personId == personId }
        )
    }

    private var typedName: String { typed.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// A typed name that is a known one, or one of its synonyms, is saved as that preset.
    private var preset: HealthPreset? {
        guard choice == QuickSymptom.custom else { return HealthPresets.find(choice) }
        return order.first { HealthPresets.presetOf(kind: $0.kind, title: typedName) == $0 }
    }

    private var kind: HealthKind { preset?.kind ?? custom }

    private var finalTitle: String { preset?.title ?? (choice == QuickSymptom.custom ? typedName : "") }
    private var shownName: String { preset.map { t("preset.\($0.id)") } ?? finalTitle }
    private var valid: Bool { !personId.isEmpty && !finalTitle.isEmpty }

    var body: some View {
        QuickBar(label: t("quickSymptom.label")) {
            HStack {
                if store.persons.count > 1 {
                    Picker(t("healthPage.colPerson"), selection: $personId) {
                        Text(t("healthForm.pickPerson")).tag("")
                        ForEach(store.persons) { p in Text(p.displayName).tag(p.id) }
                    }
                }
                Picker(t("quickSymptom.symptom"), selection: Binding(
                    get: { choice },
                    set: { id in
                        choice = id
                        typed = ""
                    }
                )) {
                    Text("—").tag(QuickSymptom.unchosen)
                    ForEach(order) { p in Text(t("preset.\(p.id)")).tag(p.id) }
                    Text(t("quick.custom")).tag(QuickSymptom.custom)
                }
            }
            .pickerStyle(.menu)
            if choice == QuickSymptom.custom {
                TextField(t("quickSymptom.placeholder"), text: $typed).textFieldStyle(.roundedBorder)
                if preset == nil {
                    Picker(t("healthLog.kind"), selection: $custom) {
                        ForEach([HealthKind.symptom, .procedure]) { k in Text(t("kind.\(k.rawValue)")).tag(k) }
                    }
                    .pickerStyle(.segmented)
                }
            }
            HStack {
                if kind == .symptom {
                    Picker(t("healthLog.severity"), selection: $severity) {
                        Text("—").tag(Int?.none)
                        ForEach(1...10, id: \.self) { n in
                            Text(t("healthLog.outOfTen", ["n": n])).tag(Int?.some(n))
                        }
                    }
                    .pickerStyle(.menu)
                }
                Spacer()
                Button(t("quick.save")) { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!valid)
            }
            TextField(t("quick.note"), text: $note).textFieldStyle(.roundedBorder)
            if let saved {
                Text(t("quick.saved", ["what": saved])).font(.caption).foregroundStyle(.tint)
            }
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.red)
            }
        }
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

    private func save() {
        guard valid else { return }
        do {
            guard try store.hasDocumentConsent(personId) else {
                ticked = ConsentChecks.unticked(.importDocument)
                asking = true
                return
            }
            let clock = Calendar.current.dateComponents([.hour, .minute], from: Date())
            try store.add(HealthEntry(
                id: "", personId: personId, date: HealthLog.localDate(),
                time: String(format: "%02ld:%02ld", clock.hour ?? 0, clock.minute ?? 0),
                kind: kind, title: finalTitle, body: note.trimmingCharacters(in: .whitespacesAndNewlines), source: "",
                bodyPart: preset?.bodyPart ?? "", severity: kind == .symptom ? severity : nil, tags: preset?.tags ?? [],
                value: nil, value2: nil, unit: "", createdAt: ""
            ))
            saved = shownName
            choice = QuickSymptom.unchosen
            typed = ""
            severity = nil
            note = ""
            failure = nil
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }
}
