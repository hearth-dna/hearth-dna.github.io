import Foundation

/// Word matching shared by kb search, Ask retrieval and condition suggestions: a port of
/// frontend/src/kb/text.ts. Pure.
enum KbText {
    /// Letters and numbers in any script (JavaScript's `\p{L}` and `\p{N}`), and `*`.
    private static func isWordScalar(_ s: Unicode.Scalar) -> Bool {
        if s == "*" { return true }
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    /// Lower-case words of three or more letters, in any script (Cyrillic health notes too).
    static func tokens(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for s in text.lowercased().unicodeScalars {
            if isWordScalar(s) {
                current.unicodeScalars.append(s)
            } else {
                if current.utf16.count >= 3 { out.append(current) }
                current = ""
            }
        }
        if current.utf16.count >= 3 { out.append(current) }
        return out
    }

    /// Whole word, or one word a prefix of the other when it has five letters or more (statin → statins).
    static func tokenMatch(_ a: String, _ b: String) -> Bool {
        a == b || (a.utf16.count >= 5 && b.hasPrefix(a)) || (b.utf16.count >= 5 && a.hasPrefix(b))
    }
}
