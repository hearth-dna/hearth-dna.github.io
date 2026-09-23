import SwiftUI

/// Everything about one entry: each field, the full text, the attached documents (opened in the
/// app, removable behind a confirmation, marked when only their metadata is on this phone), who
/// transcribed it, and Delete behind a confirmation.
struct EntryDetailSheet: View {
    let entry: HealthEntry
    let personName: String
    let attachments: [Attachment]
    /// Whether an attachment's bytes are on this device (cheap: no file is read).
    let hasBytes: (Attachment) -> Bool
    /// An attachment's bytes, read when it is opened; nil when they are not on this device.
    let bytes: (Attachment) -> Data?
    let onRemoveAttachment: (Attachment) -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDelete = false
    @State private var viewing: ViewedAttachment?
    @State private var removing: Attachment?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent(t("healthPage.colPerson"), value: personName)
                    LabeledContent(t("healthLog.kind")) { KindBadge(kind: entry.kind) }
                    LabeledContent(t("healthLog.date"), value: entry.date)
                    if !entry.time.isEmpty {
                        LabeledContent(t("healthForm.time"), value: entry.time)
                    }
                    if entry.value != nil {
                        LabeledContent(t("healthLog.value"), value: HealthLog.formatValue(entry))
                    }
                    if !entry.bodyPart.isEmpty {
                        LabeledContent(t("healthLog.bodyPart"), value: entry.bodyPart)
                    }
                    if let severity = entry.severity {
                        LabeledContent(t("healthLog.severity")) {
                            Text(verbatim: "\(severity)/10")
                                .fontWeight(.semibold)
                                .foregroundStyle(severityColor(severity))
                        }
                    }
                    if !entry.tags.isEmpty {
                        LabeledContent(t("healthTable.colTags"), value: HealthLog.formatTags(entry.tags))
                    }
                }
                Section {
                    if entry.body.isEmpty {
                        Text(t("healthTable.noText")).foregroundStyle(.secondary)
                    } else {
                        Text(entry.body).textSelection(.enabled)
                    }
                }
                if !attachments.isEmpty {
                    Section {
                        ForEach(attachments) { attachment in
                            attachmentRow(attachment)
                        }
                    } header: {
                        Text(t("healthTable.hasAttachments", ["n": attachments.count]))
                    }
                }
                if !entry.source.isEmpty {
                    Section {
                        Text(t("healthLog.transcribedBy", ["model": model]))
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    Button(t("common.delete"), role: .destructive) { confirmingDelete = true }
                }
            }
            .navigationTitle(entry.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("common.close")) { dismiss() }
                }
            }
            .confirmationDialog(
                t("healthLog.confirmDelete", ["title": entry.title, "date": entry.date]),
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button(t("common.delete"), role: .destructive, action: onDelete)
                Button(t("common.cancel"), role: .cancel) {}
            }
            .confirmationDialog(
                removing.map { t("attachments.confirmDelete", ["name": $0.name]) } ?? "",
                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                titleVisibility: .visible,
                presenting: removing
            ) { a in
                Button(t("attachments.remove"), role: .destructive) { onRemoveAttachment(a) }
                Button(t("common.cancel"), role: .cancel) {}
            }
            .sheet(item: $viewing) { v in AttachmentViewer(attachment: v.attachment, data: v.data) }
        }
        .presentationDetents([.medium, .large])
    }

    /// Opens in the app when the bytes are here; says so when only the metadata is.
    private func attachmentRow(_ a: Attachment) -> some View {
        let here = hasBytes(a)
        return HStack {
            Button {
                if let data = bytes(a) { viewing = ViewedAttachment(attachment: a, data: data) }
            } label: {
                Label(a.name, systemImage: a.mime == "application/pdf" ? "doc.richtext" : "photo")
                    .lineLimit(1)
            }
            .disabled(!here)
            .buttonStyle(.borderless)
            Spacer()
            if !here {
                Text(t("attachments.missingBytes")).font(.caption).foregroundStyle(.secondary)
            }
            Button {
                removing = a
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(t("attachments.remove"))
        }
    }

    /// The model from a `source` such as `gemini-2.5-flash:2026-07-01`, as the web shows it.
    private var model: String {
        entry.source.split(separator: ":").first.map { String($0) } ?? entry.source
    }
}
