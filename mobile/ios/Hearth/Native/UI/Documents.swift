import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Where the user's Gemini key is kept: the Keychain (this device only, after first unlock), never
/// the database or a backup.
enum GeminiSecrets {
    static let key = "gemini_api_key"
    static let model = "gemini_model"
}

/// A file the user picked, read into memory with the name the picker shows. The bytes decide the
/// type; the extension only fills in for what is not sniffed.
struct PickedFile: Identifiable {
    let id = UUID()
    let name: String
    let data: Data
    let mime: String

    static func read(_ url: URL) throws -> PickedFile {
        let data = try readPickedFile(url)
        let guess = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
        return PickedFile(name: url.lastPathComponent, data: data, mime: Attachments.sniffMime(data) ?? guess)
    }
}

/// The picker's types for documents: the same set the reader and the attachments accept.
let documentTypes: [UTType] = [.jpeg, .png, .webP, .heic, .heif, .pdf]

// MARK: - Viewer

/// An attached document shown inside the app: an image as it is, a PDF through PDFKit, both from
/// memory. The bytes are never handed to another app or written anywhere, so nothing else sees the
/// file.
struct AttachmentViewer: View {
    let attachment: Attachment
    let data: Data
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if attachment.mime == "application/pdf" {
                    PDFDocumentView(data: data)
                } else if let image = UIImage(data: data) {
                    ScrollView([.horizontal, .vertical]) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .containerRelativeFrame(.horizontal)
                    }
                } else {
                    ContentUnavailableView(attachment.name, systemImage: "doc")
                }
            }
            .background(Color.black)
            .navigationTitle(attachment.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("common.close")) { dismiss() }
                }
            }
        }
    }
}

/// PDFKit's view on a document read from memory, scaled to the width.
private struct PDFDocumentView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}

/// A shown attachment and its bytes, for `.sheet(item:)`.
struct ViewedAttachment: Identifiable {
    let attachment: Attachment
    let data: Data
    var id: String { attachment.id }
}

// MARK: - Reading a document

/// Reading a photo, scan or PDF with the user's own Gemini key (ReadDocumentDialog.tsx): the key
/// the first time (with the steps to get one), the provider consent once, then the pages and what
/// they are, a confirmation that names the provider and lists the files, and the send. The reply
/// becomes a draft for the add form; the send is recorded in the sharing log, metadata only.
struct ReadDocumentSheet: View {
    let repo: Repo
    let persons: [Person]
    let initialPerson: String
    let onDraft: (Person, HealthDraft, String, [PickedFile]) -> Void

    /// Gemini's inline limit is 20 MB a request; this leaves room for base64 (ReadDocumentDialog.tsx).
    private static let maxSendBytes = 15 * 1024 * 1024

    private enum Stage: Equatable {
        case pick, consent, confirm, sending
        case failed(String)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var personId = ""
    @State private var key: String?
    @State private var keyLoaded = false
    @State private var newKey = ""
    @State private var consented = false
    @State private var consentTicks = ConsentChecks.unticked(.readDocumentByok)
    @State private var files: [PickedFile] = []
    @State private var hint = "auto"
    @State private var keep = true
    @State private var stage = Stage.pick
    @State private var picking = false
    @State private var model = Egress.geminiDefaultModel

    private var person: Person? { persons.first { $0.id == personId } ?? persons.first }
    private var total: Int { files.reduce(0) { $0 + $1.data.count } }
    private var tooBig: Bool { total > ReadDocumentSheet.maxSendBytes }
    private var busy: Bool { stage == .sending }

    var body: some View {
        NavigationStack {
            Form {
                if !keyLoaded {
                    EmptyView()
                } else if key == nil {
                    keySection
                } else {
                    switch stage {
                    case .consent:
                        ConsentChecks(kind: .readDocumentByok, ticked: $consentTicks, header: t(ConsentKind.readDocumentByok.titleKey))
                        Section {
                            Button(t("consentForm.confirm")) { grant() }
                                .disabled(!ConsentChecks.allTicked(consentTicks, .readDocumentByok))
                        }
                    case .confirm, .sending:
                        confirmSections
                    case .pick, .failed:
                        pickSections
                    }
                }
            }
            .navigationTitle(t("readDocumentDialog.title", ["name": person?.displayName ?? ""]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }.disabled(busy)
                }
            }
        }
        .interactiveDismissDisabled(busy)
        .fileImporter(isPresented: $picking, allowedContentTypes: documentTypes, allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                files = urls.compactMap { try? PickedFile.read($0) }
            }
        }
        .onAppear(perform: load)
    }

    private var keySection: some View {
        Section {
            Text(t("native.keyNotice"))
            GeminiKeySteps()
            SecureField(t("readDocumentDialog.apiKey"), text: $newKey, prompt: Text(verbatim: "AIza…"))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(t("common.save")) {
                let value = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
                Keychain.write(GeminiSecrets.key, value)
                key = value
                newKey = ""
            }
            .disabled(newKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    @ViewBuilder
    private var pickSections: some View {
        if persons.count > 1 {
            Section {
                Picker(t("healthPage.colPerson"), selection: $personId) {
                    ForEach(persons) { p in Text(p.displayName).tag(p.id) }
                }
            }
        }
        Section {
            Text(t("readDocumentDialog.pickIntro")).font(.subheadline).foregroundStyle(.secondary)
            Button(t("native.chooseFiles")) { picking = true }
            ForEach(files) { f in fileLine(f) }
            Picker(t("readDocumentDialog.whatIsIt"), selection: $hint) {
                ForEach(DocumentDraft.hints, id: \.self) { h in Text(t("readDocumentDialog.hint.\(h)")).tag(h) }
            }
            if tooBig {
                Text(t("readDocumentDialog.tooBig", [
                    "mb": String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), Double(total) / 1024 / 1024),
                    "max": ReadDocumentSheet.maxSendBytes / 1024 / 1024,
                ]))
                .foregroundStyle(.red)
            }
            if case .failed(let message) = stage {
                Text(t("readDocumentDialog.failed", ["message": message])).foregroundStyle(.red)
            }
            Button(t("readDocumentDialog.continue")) { stage = consented ? .confirm : .consent }
                .disabled(files.isEmpty || tooBig)
        }
    }

    @ViewBuilder
    private var confirmSections: some View {
        Section {
            Text(rich(t("readDocumentDialog.confirmIntro", ["model": model])))
            ForEach(files) { f in fileLine(f) }
        }
        Section {
            Toggle(t("readDocumentDialog.keepOriginals"), isOn: $keep)
        } footer: {
            Text(t("readDocumentDialog.keepOriginalsHint"))
        }
        Section {
            Button {
                send()
            } label: {
                HStack {
                    Text(busy ? t("readDocumentDialog.sending") : t("readDocumentDialog.send"))
                    if busy {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(busy)
            Button(t("readDocumentDialog.back")) { stage = .pick }.disabled(busy)
        }
    }

    private func fileLine(_ f: PickedFile) -> some View {
        Text("• " + t("readDocumentDialog.fileLine", ["name": f.name, "kb": f.data.count / 1024]))
    }

    private func load() {
        guard !keyLoaded else { return }
        personId = initialPerson.isEmpty ? (persons.first?.id ?? "") : initialPerson
        key = Keychain.read(GeminiSecrets.key)
        if let saved = Keychain.read(GeminiSecrets.model), !saved.isEmpty { model = saved }
        consented = (try? repo.hasConsent(.readDocumentByok)) ?? false
        keyLoaded = true
    }

    private func grant() {
        do {
            try repo.grantConsent(.readDocumentByok)
            consented = true
            stage = .confirm
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    /// The pages go straight to Gemini through Egress; the sharing log gets the metadata (who, which
    /// files by name, size and hash, what they were said to be, which model), never the content.
    private func send() {
        guard let key, let person else { return }
        stage = .sending
        let files = self.files
        let hint = self.hint
        let model = self.model
        let keep = self.keep
        // On the main actor: only the network wait is long, and it does not block the thread.
        Task { @MainActor in
            do {
                let hashes = files.map { sha256Hex($0.data) }
                let answer = try await Egress.readDocumentWithGemini(
                    key: key, model: model,
                    parts: files.map { Egress.DocumentPart(mime: $0.mime, data: $0.data) },
                    prompt: DocumentDraft.prompt(hint), schema: DocumentDraft.schema(), confirmedAt: nowISO()
                )
                let meta: [String: Any] = [
                    "person": person.label,
                    "files": files.enumerated().map { i, f in
                        ["name": f.name, "type": f.mime, "bytes": f.data.count, "sha256": hashes[i]] as [String: Any]
                    },
                    "hint": hint,
                    "model": model,
                ]
                let payload = try JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
                try repo.logSharing(kind: "document", destination: "gemini:\(answer.model)", payload: String(decoding: payload, as: UTF8.self))
                let draft = try DocumentDraft.fromJSON(answer.text, fallbackDate: HealthLog.localDate())
                let source = "gemini:\(answer.model):\(hashes.joined(separator: "+"))"
                onDraft(person, draft, source, keep ? files : [])
            } catch {
                stage = .failed(error.localizedDescription)
            }
        }
    }
}

/// How to get a Gemini key, in plain steps (GeminiKeySteps.tsx); the link opens in the browser.
struct GeminiKeySteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(t("geminiKeySteps.summary")).font(.subheadline.weight(.semibold))
            ForEach(1...4, id: \.self) { i in
                Text(rich("\(i). " + t("geminiKeySteps.step\(i)"), links: ["a": URL(string: "https://aistudio.google.com/apikey")!]))
                    .font(.subheadline)
            }
            Text(t("native.keyWarning")).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
