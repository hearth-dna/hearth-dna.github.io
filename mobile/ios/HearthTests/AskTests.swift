import XCTest
@testable import Hearth

/// Mirrors the tests in frontend/src/ask (through the Android AskTest). The first pack is compared
/// with the web's own snapshot (ask/__snapshots__/contextPack.test.ts.snap), read through
/// `#filePath`, so a drift in either app fails here.
final class AskTests: XCTestCase {
    private static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .deletingLastPathComponent() // repository root

    private static let kb: Kb = {
        let data = (try? Data(contentsOf: root.appendingPathComponent("frontend/public/kb.json"))) ?? Data()
        return (try? Kb.parse(data)) ?? .empty
    }()

    private var kb: Kb { AskTests.kb }

    private let entry = KbEntry(
        rsid: "rs4244285", gene: "CYP2C19", name: "CYP2C19*2", riskAllele: "A", evidence: "A",
        summary: "Loss-of-function allele.",
        genotypes: ["AG": KbGenotype(label: "*1/*2 intermediate metaboliser", magnitude: 2)],
        sources: ["https://cpicpgx.org/x"], drugs: [], conditions: [], topic: "pharmacogenomics", generatedBy: "human"
    )

    private var finding: Finding {
        Finding(
            entry: entry, genotype: "AG", call: Call(rsid: "rs4244285", chromosome: "10", position: 1, a1: "A", a2: "G"),
            match: entry.genotypes["AG"], riskCopies: 1
        )
    }

    private let vova = Person(
        id: "p1", label: "vova", displayName: "Vova", sex: "male", birthYear: 1984, notes: "", createdAt: "t"
    )

    private func h(
        _ id: String, _ date: String, _ kind: HealthKind, _ title: String, body: String = "", time: String = "",
        bodyPart: String = "", severity: Int? = nil, tags: [String] = [], value: Double? = nil, value2: Double? = nil,
        unit: String = "", personId: String = "p1"
    ) -> HealthEntry {
        HealthEntry(
            id: id, personId: personId, date: date, time: time, kind: kind, title: title, body: body, source: "",
            bodyPart: bodyPart, severity: severity, tags: tags, value: value, value2: value2, unit: unit, createdAt: "t"
        )
    }

    // MARK: - Context pack

    func testPackMatchesTheWebSnapshot() throws {
        let pack = ContextPack.build(PackOptions(
            question: "Clopidogrel?", people: [PackPerson(person: vova, findings: [finding])], realNames: false, year: 2026
        ))
        let snap = try String(contentsOf: AskTests.root.appendingPathComponent("frontend/src/ask/__snapshots__/contextPack.test.ts.snap"))
        let regex = try NSRegularExpression(pattern: "deterministic 1`\\] = `\\n\"(.*)\"\\n`;", options: [.dotMatchesLineSeparators])
        let ns = snap as NSString
        let m = try XCTUnwrap(regex.firstMatch(in: snap, range: NSRange(location: 0, length: ns.length)))
        XCTAssertEqual(pack, ns.substring(with: m.range(at: 1)))
        XCTAssertFalse(pack.contains("Vova"))
    }

    func testRealNamesExactAgeAndTheTemplate() {
        let pack = ContextPack.build(PackOptions(
            question: "q", people: [PackPerson(person: vova, findings: [finding])], realNames: true, year: 2026,
            template: Prompts.all[2]
        ))
        XCTAssertTrue(pack.contains("## Vova, male, 42"))
        XCTAssertTrue(pack.contains(Prompts.all[2].text))
    }

    func testHealthEntriesUnderThePersonBodyIndented() {
        let people = [PackPerson(person: vova, findings: [], health: [
            h("h1", "2026-05-01", .lab, "Lipid panel", body: "LDL 4.1 mmol/L (ref < 3.0)\nHDL 1.2 mmol/L"),
            h("h2", "2026-04-20", .symptom, "Aching hands in the morning", bodyPart: "hands", severity: 5, tags: ["arthritis"]),
        ])]
        let pack = ContextPack.build(PackOptions(question: "Lipids?", people: people, realNames: false, year: 2026))
        XCTAssertTrue(pack.contains(
            "### Health log (the person's documents and self-reported symptoms, dated)\n- 2026-05-01 · Lab result · Lipid panel\n  LDL 4.1 mmol/L (ref < 3.0)\n  HDL 1.2 mmol/L\n- 2026-04-20 · Symptom · Aching hands in the morning (hands; severity 5/10; arthritis)"
        ))
        XCTAssertEqual(ContextPack.stats(people, pack).healthEntries, 2)
    }

    func testCompactPackFoldsASeriesAndKeepsOneSource() {
        func bp(_ id: String, _ date: String, _ v: Double, _ v2: Double, time: String = "") -> HealthEntry {
            h(id, date, .measurement, "Blood pressure", time: time, value: v, value2: v2, unit: "mmHg")
        }
        let people = [PackPerson(
            person: vova, findings: [finding],
            genotypes: [Call(rsid: "rs999", chromosome: "2", position: 42, a1: "C", a2: "T")],
            health: [
                bp("b2", "2026-09-10", 124, 82, time: "08:05"),
                h("l1", "2026-09-05", .lab, "Lipid panel", body: "LDL 4.1 mmol/L\n\n  HDL 1.2"),
                bp("b1", "2026-09-01", 120, 80),
            ]
        )]
        let pack = ContextPack.build(PackOptions(question: "q", people: people, realNames: false, year: 2026, compact: true))
        XCTAssertTrue(pack.contains([
            "Genotypes:",
            "- CYP2C19 rs4244285 A/G: *1/*2 intermediate metaboliser [evidence A]",
            "- rs999 C/T (chr2:42; not in knowledge base)",
            "Health log:",
            "- Blood pressure, mmHg (2 readings): 2026-09-01 120/80; 2026-09-10 08:05 124/82",
            "- 2026-09-05 lab: Lipid panel — LDL 4.1 mmol/L; HDL 1.2",
        ].joined(separator: "\n")))
        XCTAssertTrue(pack.contains("- CYP2C19*2: Loss-of-function allele. Sources: https://cpicpgx.org/x"))
        let bare = ContextPack.build(PackOptions(
            question: "q", people: [PackPerson(person: vova, findings: [finding])], realNames: false, year: 2026,
            compact: true, evidence: false
        ))
        XCTAssertFalse(bare.contains("Evidence notes"))
        XCTAssertEqual(ContextPack.squeeze("a\n b", 10), "a; b")
        XCTAssertEqual(ContextPack.squeeze("Once a day.\nAfter food", 40), "Once a day. After food")
        XCTAssertEqual(ContextPack.squeeze(String(repeating: "x", count: 20), 10), String(repeating: "x", count: 9) + "…")
        // Windows line ends split like "\n" and leave no stray "\r".
        XCTAssertEqual(ContextPack.squeeze("a\r\nb", 10), "a; b")
    }

    // MARK: - Intent and retrieval

    private func types(_ q: String, _ n: Int = 1) -> [QuestionType] {
        IntentClassifier.classify(q, kb, peopleSelected: n).map(\.type)
    }

    func testClassifiesQuestionsLikeTheWeb() {
        XCTAssertEqual(IntentClassifier.classify("Is clopidogrel ok for me?", kb).first, Intent(type: .medication, signals: ["clopidogrel"]))
        XCTAssertEqual(types("My LDL cholesterol result is high, could it be genetic?"), [.labs, .genetics])
        XCTAssertEqual(types("Pain in both knees since Monday, should I see a doctor?"), [.symptoms, .doctor])
        XCTAssertEqual(IntentClassifier.classify("what dose was prescribed", kb).first?.signals, ["dose", "prescribed"])
        XCTAssertEqual(IntentClassifier.classify("any side effects?", kb).first?.signals, ["side effect"])
        XCTAssertEqual(types("what does rs12345 mean"), [.genetics])
        XCTAssertEqual(IntentClassifier.classify("my lower back", kb).first, Intent(type: .symptoms, signals: ["back", "lower back"]))
        XCTAssertEqual(types("what about CYP2C19", 2), [.family, .genetics])
        XCTAssertEqual(IntentClassifier.classify("hello there", kb), [])
        XCTAssertEqual(IntentClassifier.classify("in a moment, something general", kb), [])
    }

    func testRetrievesKbEntriesForAQuestion() {
        XCTAssertEqual(
            Retrieve.forQuestion(kb, "Should Vova worry about clopidogrel given his CYP2C19 status? Compare with BVA.").sorted(),
            ["rs12248560", "rs4244285"]
        )
        XCTAssertTrue(Retrieve.forQuestion(kb, "is there anything about diabetes?").contains("rs7903146"))
        XCTAssertTrue(Retrieve.forQuestion(kb, "which statins are safe for me").contains("rs4149056"))
        XCTAssertEqual(Retrieve.questionTerms("should I worry about this with my family"), [])
    }

    // MARK: - Recommendations and items

    private let now = ISO8601DateFormatter().date(from: "2026-09-17T12:00:00Z")!
    private let calls = [
        Call(rsid: "rs4244285", chromosome: "10", position: 1, a1: "A", a2: "G"),
        Call(rsid: "rs7903146", chromosome: "10", position: 2, a1: "C", a2: "T"),
    ]
    private var findings: [Finding] { KbLogic.computeFindings(kb, calls) }
    private var health: [HealthEntry] {
        [
            h("med1", "2026-08-01", .medication, "Aspirin 100 mg", personId: "a"),
            h("lab1", "2025-01-01", .lab, "Lipid panel", personId: "a"),
            h("sym1", "2026-09-15", .symptom, "Stiff hands", bodyPart: "hands", personId: "a"),
            h("sym-old", "2026-01-01", .symptom, "Cold", personId: "a"),
            h("meas1", "2026-09-16", .measurement, "Blood pressure", personId: "a"),
        ]
    }

    private func run(_ q: String, _ people: [PersonRecords]? = nil) -> [Suggestion] {
        let people = people ?? [PersonRecords(personId: "a", findings: findings, health: health)]
        return Recommend.recommend(kb, q, IntentClassifier.classify(q, kb, peopleSelected: people.count), people, now: now)
    }

    func testItemKeysRoundTrip() {
        XCTAssertEqual(AskKey.parse(AskKey.finding("p1", "rs1")), AskKey.Parsed(kind: "f", personId: "p1", id: "rs1"))
        XCTAssertEqual(AskKey.parse(AskKey.genotype("p1", "rs2")), AskKey.Parsed(kind: "g", personId: "p1", id: "rs2"))
        XCTAssertEqual(AskKey.parse(AskKey.health("p1", "a:b")), AskKey.Parsed(kind: "h", personId: "p1", id: "a:b"))
        XCTAssertNil(AskKey.parse("nope"))
    }

    func testRecommendsLikeTheWeb() {
        let clopidogrel = run("Is clopidogrel safe with my other medication?")
        XCTAssertEqual(clopidogrel.map(\.key), ["f:a:rs4244285", "h:a:med1"])
        XCTAssertEqual(clopidogrel.map(\.reason), [.mentioned("CYP2C19"), .recent(.medication)])
        let keys = run("my hands feel stiff").map(\.key)
        XCTAssertTrue(keys.contains("h:a:sym1") && keys.contains("h:a:meas1"))
        XCTAssertFalse(keys.contains("h:a:sym-old") || keys.contains("h:a:lab1"))
        XCTAssertTrue(run("explain my lab results").map(\.key).contains("h:a:lab1"))
        let family = [
            PersonRecords(personId: "a", findings: findings, health: []),
            PersonRecords(personId: "b", findings: KbLogic.computeFindings(kb, [calls[1]]), health: []),
        ]
        XCTAssertEqual(
            run("who carries what", family).filter { $0.reason == .sharedVariant }.map(\.key),
            ["f:a:rs7903146", "f:b:rs7903146"]
        )
        XCTAssertTrue(run("did the hands get better").contains { s in
            if case .matchesQuestion = s.reason { return s.key == "h:a:sym1" }
            return false
        })
        XCTAssertFalse(run("what is the plan").contains { s in
            if case .matchesQuestion = s.reason { return true }
            return false
        })
        XCTAssertEqual(run("hello"), [])
    }

    func testResolvesItemsAndGroupsThemByPerson() throws {
        let f = Finding(
            entry: KbEntry(
                rsid: "rs1", gene: "GENE", name: "n", riskAllele: "", evidence: "A", summary: "", genotypes: [:],
                sources: [], drugs: [], conditions: [], topic: "", generatedBy: ""
            ),
            genotype: "AG", call: Call(rsid: "rs1", chromosome: "1", position: 1, a1: "A", a2: "G"), match: nil, riskCopies: 0
        )
        func e(_ id: String, _ date: String) -> HealthEntry { h(id, date, .lab, id, personId: "b") }
        let data = AskData(
            findingsBy: ["a": [f]],
            healthBy: ["b": [e("new", "2026-02-01"), e("old", "2025-01-01")]],
            rawBy: ["a": ["rs9": Call(rsid: "rs9", chromosome: "3", position: 7, a1: "T", a2: "T")]]
        )
        XCTAssertEqual(AskItems.label(try XCTUnwrap(AskItems.resolve("f:a:rs1", data)), undescribed: "undescribed"), "GENE rs1 A/G — undescribed")
        XCTAssertEqual(AskItems.label(try XCTUnwrap(AskItems.resolve("g:a:rs9", data)), undescribed: ""), "rs9 T/T (chr3:7)")
        XCTAssertNil(AskItems.resolve("h:b:missing", data))
        func person(_ id: String) -> Person {
            Person(id: id, label: id, displayName: id.uppercased(), sex: "unknown", birthYear: nil, notes: "", createdAt: "")
        }
        let people = AskItems.packPeople(
            ["h:b:old", "g:a:rs9", "h:b:new", "f:a:rs1", "f:c:rs1"], data, [person("a"), person("b"), person("c")], ["b", "a"]
        )
        XCTAssertEqual(people.map(\.person.id), ["a", "b"])
        XCTAssertEqual(people.map(\.findings.count), [1, 0])
        XCTAssertEqual(people.map(\.genotypes.count), [1, 0])
        XCTAssertEqual(people.map { $0.health.map(\.id) }, [[], ["new", "old"]])
    }

    func testRecordsACopyOutInTheSharingLogAndTheChats() throws {
        let repo = try makeTestRepo()
        try repo.recordCopyOut(destination: "clipboard", personIds: ["a", "b"], question: "q", pack: "pack")
        let shared = try repo.db.query("SELECT kind, destination, payload FROM sharing_log")
        XCTAssertEqual(shared.map { [$0.text("kind"), $0.text("destination"), $0.text("payload")] }, [["copy-out", "clipboard", "pack"]])
        let chats = try repo.db.query("SELECT person_ids, question, context_pack, tier FROM chat")
        XCTAssertEqual(
            chats.map { [$0.text("person_ids"), $0.text("question"), $0.text("context_pack"), $0.text("tier")] },
            [["a,b", "q", "pack", "copy-out"]]
        )
    }

    func testRichTurnsLinkTagsIntoLinks() {
        let text = rich("Open <chatgpt>ChatGPT</chatgpt> or <b>this</b>", links: ["chatgpt": URL(string: "https://chatgpt.com")!])
        XCTAssertEqual(String(text.characters), "Open ChatGPT or this")
        XCTAssertEqual(text.runs.compactMap(\.link), [URL(string: "https://chatgpt.com")!])
    }
}
