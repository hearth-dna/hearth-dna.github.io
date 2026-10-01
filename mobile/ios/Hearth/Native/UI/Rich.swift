import SwiftUI

private let tagPattern = try! NSRegularExpression(pattern: #"<(\w+)>(.*?)</\1>"#)

/// The web's `rich()` for the few strings that carry markup (`<b>name</b>`, `<r>A</r>`): each tag's
/// text bold, and in the colour given for its tag, if any. A tag named in `links` becomes a link
/// instead, which the system opens in the browser; the link carries nothing from the app.
/// Translations keep the same tags (the i18n test checks), so this never shows a raw tag.
func rich(_ text: String, colors: [String: Color] = [:], links: [String: URL] = [:]) -> AttributedString {
    let ns = text as NSString
    var out = AttributedString()
    var at = 0
    for m in tagPattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        out += AttributedString(ns.substring(with: NSRange(location: at, length: m.range.location - at)))
        var tagged = AttributedString(ns.substring(with: m.range(at: 2)))
        let tag = ns.substring(with: m.range(at: 1))
        if let url = links[tag] {
            tagged.link = url
        } else {
            tagged.inlinePresentationIntent = .stronglyEmphasized
            if let color = colors[tag] { tagged.foregroundColor = color }
        }
        out += tagged
        at = m.range.location + m.range.length
    }
    out += AttributedString(ns.substring(from: at))
    return out
}
