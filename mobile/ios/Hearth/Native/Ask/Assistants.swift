import Foundation

/// A chat assistant a context pack can be opened in with the text already in the box.
struct Assistant: Equatable, Identifiable {
    let id: String
    let name: String
    let base: String

    func url(_ text: String) -> String { base + Assistants.encodeURIComponent(text) }
}

/// A port of frontend/src/ask/assistants.ts. The text rides in the address (`?q=`), so it reaches
/// the provider: the preview confirms and logs each one like a copy. The address is handed to the
/// system browser (`openURL`), never opened by the app, so these do not pass through Egress.
enum Assistants {
    static let all = [
        Assistant(id: "chatgpt", name: "ChatGPT", base: "https://chatgpt.com/?q="),
        Assistant(id: "claude", name: "Claude", base: "https://claude.ai/new?q="),
        Assistant(id: "mistral", name: "Mistral", base: "https://chat.mistral.ai/chat?q="),
        // Google search in AI Mode (udm=50).
        Assistant(id: "google", name: "Google AI Mode", base: "https://www.google.com/search?udm=50&q="),
    ]

    /// Longer addresses are cut or refused by browsers and servers; such a pack is copied instead.
    static let maxURL = 8000

    /// The prefilled address, or nil when the text is too long to travel in one.
    static func url(_ a: Assistant, _ text: String) -> URL? {
        let s = a.url(text)
        return s.utf16.count <= maxURL ? URL(string: s) : nil
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    )

    /// JavaScript's encodeURIComponent: everything but letters, digits and `-_.!~*'()` as %XX of its UTF-8.
    static func encodeURIComponent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }
}
