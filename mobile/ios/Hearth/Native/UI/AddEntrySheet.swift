import SwiftUI

/// Add one entry, type first, like the web's HealthEntryForm: pick what it is, then fill only the
/// fields that make sense for that type, with its presets as one-tap chips. The first entry for a
/// person asks for the document consent (design §13.1) and records it as the web does.
///
/// A document the model read arrives as a draft to review, with `source` naming the model and the
/// files; picked files (or the pages the reader kept) are attached once the entry is saved.
struct AddEntrySheet: View {
    @ObservedObject var store: HealthStore
    /// The model and files a draft came from; "" for an entry typed here.
    private let source: String
    /// Called after saving with one message per file that could not be kept.
    private let onSaved: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var personId: String
    /// Whether `personId` has the document consent; nil until known or when no one is picked.
    @State private var consented: Bool?
    @State private var ticked: Set<String> = []
    @State private var kind: HealthKind?
    @State private var preset = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var title = ""
    @State private var value = ""
    @State private var value2 = ""
    @State private var unit = ""
    @State private var bodyPart = ""
    @State private var severity: Int?
    @State private var tags = ""
    @State private var text = ""
    @State private var failure: String?
    @State private var files: [PickedFile]
    @State private var pickingFiles = false

    init(
        store: HealthStore, personId: String, draft: HealthDraft? = nil, source: String = "",
        initialFiles: [PickedFile] = [], onSaved: @escaping ([String]) -> Void = { _ in }
    ) {
        _store = ObservedObject(wrappedValue: store)
        _personId = State(initialValue: personId)
        self.source = source
        self.onSaved = onSaved
        _files = State(initialValue: initialFiles)
        if let draft {
            _kind = State(initialValue: draft.kind)
            _title = State(initialValue: draft.title)
            _text = State(initialValue: draft.body)
            _date = State(initialValue: HealthLog.parseDate(draft.date) ?? Date())
        }
    }

    /// Kinds usually recorded as they happen; the others mostly come from paper with no time on it.
    private static let timed: Set<HealthKind> = [.symptom, .measurement, .medication]

    /// Which optional fields each type shows (the web's FIELDS); title, date, tags and text always.
    private struct Fields {
        var value = false
        var bodyPart = false
        var severity = false
    }

    private static func fields(_ kind: HealthKind) -> Fields {
        switch kind {
        case .symptom, .other: return Fields(bodyPart: true, severity: true)
        case .measurement: return Fields(value: true, bodyPart: true)
        case .imaging, .diagnosis: return Fields(bodyPart: true)
        case .lab, .medication, .letter: return Fields()
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if store.persons.count > 1 {
                    Section {
                        Picker(t("healthPage.colPerson"), selection: $personId) {
                            Text(t("healthForm.pickPerson")).tag("")
                            ForEach(store.persons) { person in
                                Text(person.displayName).tag(person.id)
                            }
                        }
                    }
                }
                if consented == false {
                    consentSection
                } else if let kind {
                    entrySections(kind)
                } else {
                    kindPicker
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("healthLog.saveEntry")) { save() }
                        .disabled(!valid || consented != true)
                }
            }
            .onChange(of: personId, initial: true) { checkConsent() }
            .fileImporter(isPresented: $pickingFiles, allowedContentTypes: documentTypes, allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls):
                    for url in urls {
                        do {
                            files.append(try PickedFile.read(url))
                        } catch {
                            failure = t("attachments.saveFailed", ["name": url.lastPathComponent])
                        }
                    }
                case .failure(let error):
                    failure = t("native.error", ["error": error.localizedDescription])
                }
            }
            .alert(failure ?? "", isPresented: failureShown) {
                Button(t("common.close"), role: .cancel) {}
            }
        }
    }

    private var navigationTitle: String {
        guard let kind else { return t("healthForm.whatToAdd") }
        return t("healthForm.newEntry", ["kind": t("kind.\(kind.rawValue)")])
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    // MARK: - Consent

    /// One switch per statement; the confirmation is enabled only when all are on (ConsentForm).
    private var consentSection: some View {
        let consent = ConsentKind.importDocument
        return Section {
            ForEach(consent.statementKeys, id: \.self) { key in
                Toggle(isOn: Binding(
                    get: { ticked.contains(key) },
                    set: { on in
                        if on { ticked.insert(key) } else { ticked.remove(key) }
                    }
                )) {
                    Text(t(key))
                }
            }
            Button(t("consentForm.confirm")) { grantConsent() }
                .disabled(ticked.count < consent.statementKeys.count)
        } header: {
            Text(t(consent.titleKey))
        } footer: {
            Text(t("consentForm.recorded", ["version": consent.version]))
        }
    }

    private func checkConsent() {
        ticked = []
        guard !personId.isEmpty else {
            consented = nil
            return
        }
        do {
            consented = try store.hasDocumentConsent(personId)
        } catch {
            consented = nil
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }

    private func grantConsent() {
        do {
            try store.grantDocumentConsent(personId)
            consented = true
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }

    // MARK: - Type

    private var kindPicker: some View {
        Section {
            ForEach(HealthKind.allCases) { option in
                Button {
                    choose(option)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Circle().fill(option.color).frame(width: 10, height: 10)
                            Text(t("kind.\(option.rawValue)")).foregroundStyle(.primary)
                        }
                        Text(t("healthForm.hint.\(option.rawValue)"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func choose(_ option: HealthKind) {
        kind = option
        if !hasTime && AddEntrySheet.timed.contains(option) {
            hasTime = true
            time = Date()
        }
    }

    // MARK: - Entry

    @ViewBuilder
    private func entrySections(_ kind: HealthKind) -> some View {
        let fields = AddEntrySheet.fields(kind)
        let presets = HealthPresets.presets(for: kind)
        Section {
            if !presets.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(presets) { p in
                            Chip(label: t("preset.\(p.id)"), selected: preset == p.id) { apply(p) }
                        }
                    }
                }
            }
            Button(t("healthForm.changeType")) { changeType() }
        }
        Section {
            DatePicker(t("healthLog.date"), selection: $date, displayedComponents: .date)
            Toggle(t("healthForm.time"), isOn: $hasTime)
            if hasTime {
                DatePicker(t("healthForm.time"), selection: $time, displayedComponents: .hourAndMinute)
            }
            Button(t("healthForm.now")) {
                date = Date()
                time = Date()
                hasTime = true
            }
            .accessibilityHint(t("healthForm.nowHint"))
        }
        Section {
            TextField(t("healthForm.title.\(kind.rawValue)"), text: $title,
                      prompt: Text(t("healthForm.titlePlaceholder.\(kind.rawValue)")))
        } header: {
            Text(t("healthForm.title.\(kind.rawValue)"))
        }
        if fields.value {
            Section {
                TextField(valueLabel(pair?.first), text: $value)
                    .keyboardType(.decimalPad)
                if let second = pair?.last {
                    TextField(valueLabel(second), text: $value2)
                        .keyboardType(.decimalPad)
                }
                TextField(t("healthLog.unit"), text: $unit, prompt: Text(t("healthLog.unitPlaceholder")))
            } header: {
                Text(t("healthLog.value"))
            }
        }
        if fields.bodyPart || fields.severity {
            Section {
                if fields.bodyPart {
                    HStack {
                        TextField(t("healthLog.bodyPart"), text: $bodyPart,
                                  prompt: Text(t("healthLog.bodyPartPlaceholder")))
                        Menu {
                            ForEach(BODY_PARTS, id: \.self) { part in
                                Button(t("bodyPart.\(part)")) { bodyPart = part }
                            }
                        } label: {
                            Image(systemName: "list.bullet")
                        }
                        .accessibilityLabel(t("healthLog.bodyPart"))
                    }
                }
                if fields.severity {
                    Picker(t("healthLog.severity"), selection: $severity) {
                        Text(t("healthLog.notRated")).tag(Int?.none)
                        ForEach(1...10, id: \.self) { n in
                            Text(t("healthLog.outOfTen", ["n": n])).tag(Int?.some(n))
                        }
                    }
                }
            }
        }
        Section {
            TextField(t("healthLog.tags"), text: $tags, prompt: Text(t("healthLog.tagsPlaceholder")))
                .textInputAutocapitalization(.never)
        } header: {
            Text(t("healthLog.tags"))
        }
        Section {
            TextField(t("healthForm.details.\(kind.rawValue)"), text: $text,
                      prompt: Text(t("healthForm.bodyPlaceholder.\(kind.rawValue)")), axis: .vertical)
                .lineLimit(3...12)
        } header: {
            Text(t("healthForm.details.\(kind.rawValue)"))
        }
        Section {
            Button {
                pickingFiles = true
            } label: {
                Label(t("attachments.add"), systemImage: "paperclip")
            }
            ForEach(files) { f in
                HStack {
                    Label(f.name, systemImage: f.mime == "application/pdf" ? "doc.richtext" : "photo")
                        .lineLimit(1)
                    Spacer()
                    Button {
                        files.removeAll { $0.id == f.id }
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(t("attachments.remove"))
                }
            }
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text(t("attachments.addHint"))
                if !source.isEmpty {
                    Text(t("healthLog.transcribedBy", ["model": source.split(separator: ":").first.map { String($0) } ?? source]))
                }
            }
        }
    }

    private func valueLabel(_ pairName: String?) -> String {
        guard let pairName else { return t("healthLog.value") }
        return t("healthLog.valueOf", ["label": t("preset.pair.\(pairName)")])
    }

    /// A preset fills kind, title, body part, tags and unit; tapping it again only deselects it.
    private func apply(_ p: HealthPreset) {
        if preset == p.id {
            preset = ""
            return
        }
        preset = p.id
        kind = p.kind
        title = p.title
        bodyPart = p.bodyPart ?? bodyPart
        tags = p.tags.map { $0.joined(separator: ", ") } ?? tags
        unit = p.unit ?? ""
        value = ""
        value2 = ""
    }

    /// Back to the type picker with a blank form, keeping the date and time (the web's "change type").
    private func changeType() {
        kind = nil
        preset = ""
        title = ""
        value = ""
        value2 = ""
        unit = ""
        bodyPart = ""
        severity = nil
        tags = ""
        text = ""
    }

    // MARK: - Save

    /// A number as typed: either decimal separator, since a decimal pad offers the locale's own.
    private static func number(_ text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, let n = Double(cleaned), n.isFinite else { return nil }
        return n
    }

    /// The two value names of a paired measurement preset (blood pressure); nil otherwise.
    private var pair: [String]? {
        kind == .measurement ? HealthPresets.find(preset)?.pair : nil
    }

    private var valid: Bool {
        guard !personId.isEmpty, let kind,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return false }
        if AddEntrySheet.fields(kind).value {
            return AddEntrySheet.number(value) != nil && (pair == nil || AddEntrySheet.number(value2) != nil)
        }
        return true
    }

    private func save() {
        guard valid, let kind else { return }
        let fields = AddEntrySheet.fields(kind)
        let clock = Calendar.current.dateComponents([.hour, .minute], from: time)
        let hhmm = String(format: "%02ld:%02ld", clock.hour ?? 0, clock.minute ?? 0)
        let entry = HealthEntry(
            id: "",
            personId: personId,
            date: HealthLog.localDate(date),
            time: hasTime ? hhmm : "",
            kind: kind,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            body: text,
            source: source,
            bodyPart: fields.bodyPart ? bodyPart.trimmingCharacters(in: .whitespacesAndNewlines) : "",
            severity: fields.severity ? severity : nil,
            tags: HealthLog.parseTags(tags),
            value: fields.value ? AddEntrySheet.number(value) : nil,
            value2: pair != nil ? AddEntrySheet.number(value2) : nil,
            unit: fields.value ? unit.trimmingCharacters(in: .whitespacesAndNewlines) : "",
            createdAt: ""
        )
        do {
            let saved = try store.add(entry)
            // The entry is saved first; a file that cannot be kept is reported, not lost silently.
            let failures = store.attach(files, to: saved)
            dismiss()
            onSaved(failures)
        } catch {
            failure = t("native.error", ["error": error.localizedDescription])
        }
    }
}
