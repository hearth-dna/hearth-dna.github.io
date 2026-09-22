import Foundation

/// The web app's string catalogue, read from the bundle (ADR 0010: one catalogue, written and
/// translated in `frontend/src/i18n/` only). `make mobile-i18n` copies it into `Hearth/I18n/` as
/// `en.json` (every English key, merged from the per-screen files) and one flat `<code>.json` per
/// other language, with the same keys.
///
/// Lookup is the web's `translate()`: the chosen language, then English, then the key itself, so a
/// half-translated language, or a build without the folder, never shows a blank.
struct Strings {
    /// The language the app speaks: a code of a shipped file, `en` when nothing better matches.
    let language: String
    private let dict: [String: String]
    private let english: [String: String]

    init(language: String, dict: [String: String], english: [String: String]) {
        self.language = language
        self.dict = dict
        self.english = english
    }

    static let shared = Strings.load(bundle: .main, preferred: Locale.preferredLanguages)

    /// The first of the user's languages that ships, matched on the primary subtag as the web's
    /// `detectLanguage` does (`pt-BR` → `pt`, `zh-Hans-CN` → `zh`).
    static func load(bundle: Bundle, preferred: [String]) -> Strings {
        let shipped = Set(
            (bundle.urls(forResourcesWithExtension: "json", subdirectory: "I18n") ?? [])
                .map { $0.deletingPathExtension().lastPathComponent }
        )
        let primary = preferred.compactMap { tag in tag.split(separator: "-").first.map { String($0).lowercased() } }
        let language = primary.first(where: { shipped.contains($0) }) ?? "en"
        let english = read(bundle: bundle, code: "en")
        return Strings(
            language: language,
            dict: language == "en" ? english : read(bundle: bundle, code: language),
            english: english
        )
    }

    /// The message for `key` with its `{name}` placeholders filled in.
    func text(_ key: String, _ params: [String: CustomStringConvertible] = [:]) -> String {
        Strings.interpolate(dict[key] ?? english[key] ?? key, params)
    }

    /// The web's `interpolate`: `{word}` is replaced when `params` has it and left as written when
    /// it does not, so a missing parameter shows up instead of vanishing.
    static func interpolate(_ message: String, _ params: [String: CustomStringConvertible]) -> String {
        if params.isEmpty { return message }
        var out = ""
        var rest = message[...]
        while let open = rest.firstIndex(of: "{") {
            out += rest[..<open]
            let afterOpen = rest.index(after: open)
            guard let close = rest[afterOpen...].firstIndex(of: "}") else { break }
            let name = rest[afterOpen..<close]
            let isWord = !name.isEmpty && name.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
            if isWord, let value = params[String(name)] {
                out += value.description
                rest = rest[rest.index(after: close)...]
            } else {
                // Not a placeholder we fill: keep the brace and look again from the next character.
                out += "{"
                rest = rest[afterOpen...]
            }
        }
        return out + rest
    }

    /// One flat JSON object of strings; empty when the file is missing or unreadable, so lookup
    /// falls through to English and then the key.
    private static func read(bundle: Bundle, code: String) -> [String: String] {
        guard let url = bundle.url(forResource: code, withExtension: "json", subdirectory: "I18n"),
              let data = try? Data(contentsOf: url),
              let dict = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return dict
    }
}

/// `t('key', { n: 3 })` from the web, in the app's language.
func t(_ key: String, _ params: [String: CustomStringConvertible] = [:]) -> String {
    Strings.shared.text(key, params)
}
