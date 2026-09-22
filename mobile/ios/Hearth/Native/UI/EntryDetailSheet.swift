import SwiftUI

/// Everything about one entry: each field, the full text, the attached documents by name, who
/// transcribed it, and Delete behind a confirmation.
struct EntryDetailSheet: View {
    let entry: HealthEntry
    let personName: String
    let attachments: [Attachment]
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDelete = false

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
                            Label(attachment.name, systemImage: attachment.mime == "application/pdf" ? "doc.richtext" : "photo")
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
        }
        .presentationDetents([.medium, .large])
    }

    /// The model from a `source` such as `gemini-2.5-flash:2026-07-01`, as the web shows it.
    private var model: String {
        entry.source.split(separator: ":").first.map { String($0) } ?? entry.source
    }
}
