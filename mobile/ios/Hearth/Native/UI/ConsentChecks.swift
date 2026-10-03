import SwiftUI

/// A consent's statements, one switch each, with the "recorded locally" note as the footer
/// (ConsentForm.tsx), as a Form section. `ticked` holds one flag per statement; the caller enables
/// its confirmation when all are on (`ConsentChecks.allTicked`).
struct ConsentChecks: View {
    let kind: ConsentKind
    @Binding var ticked: [Bool]
    var header: String?
    /// The key to show for statement `i`; the first-launch gate words statement 1 for a phone.
    var statementKey: (Int, String) -> String = { _, key in key }

    var body: some View {
        Section {
            ForEach(Array(kind.statementKeys.enumerated()), id: \.offset) { i, key in
                Toggle(isOn: Binding(
                    get: { i < ticked.count && ticked[i] },
                    set: { on in if i < ticked.count { ticked[i] = on } }
                )) {
                    Text(t(statementKey(i, key)))
                }
            }
        } header: {
            if let header { Text(header) }
        } footer: {
            Text(t("consentForm.recorded", ["version": kind.version]))
        }
    }

    /// One unticked flag per statement of `kind`.
    static func unticked(_ kind: ConsentKind) -> [Bool] {
        Array(repeating: false, count: kind.statementKeys.count)
    }

    static func allTicked(_ ticked: [Bool], _ kind: ConsentKind) -> Bool {
        ticked.count == kind.statementKeys.count && ticked.allSatisfy { $0 }
    }
}

/// "delete" → "Delete": the web keeps some button labels lower-case; native buttons are capitalised.
func capitalisedFirst(_ s: String) -> String {
    guard let first = s.first else { return s }
    return first.uppercased() + s.dropFirst()
}

/// "1234567" → "1,234,567" in the phone's locale, as the web's `toLocaleString()` does.
func grouped(_ n: Int) -> String {
    n.formatted()
}

/// A file from the system picker: outside the sandbox, so read inside its security scope. Safe off
/// the main thread.
func readPickedFile(_ url: URL) throws -> Data {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try Data(contentsOf: url)
}
