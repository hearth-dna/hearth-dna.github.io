import Foundation

/// `Sex` in types.ts, as stored in `person.sex`.
enum Sex: String, CaseIterable, Identifiable {
    case unknown, male, female

    var id: String { rawValue }

    /// A value this build does not know shows as unknown.
    static func of(_ raw: String) -> Sex {
        Sex(rawValue: raw) ?? .unknown
    }

    /// i18n key of its label (`peoplePage.json`).
    var labelKey: String {
        switch self {
        case .unknown: return "peoplePage.sexUnknown"
        case .male: return "peoplePage.sexMale"
        case .female: return "peoplePage.sexFemale"
        }
    }
}

/// The raw-data formats Hearth reads (`Provider` and `PROVIDER_LABELS` in types.ts), in the web's
/// order. The labels are product names and are not translated.
enum Provider: String, CaseIterable, Identifiable {
    case ancestryDNA = "ancestrydna"
    case twentyThreeAndMe = "23andme"
    case myHeritage = "myheritage"
    case familyTreeDNA = "familytreedna"
    case livingDNA = "livingdna"
    case genotekVCF = "genotek-vcf"
    case generic

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ancestryDNA: return "AncestryDNA"
        case .twentyThreeAndMe: return "23andMe"
        case .myHeritage: return "MyHeritage"
        case .familyTreeDNA: return "FamilyTreeDNA"
        case .livingDNA: return "Living DNA"
        case .genotekVCF: return "Genotek (VCF)"
        case .generic: return "Generic rsid/chr/pos/genotype text"
        }
    }

    /// An unknown id (from a newer app) reads as generic text rather than failing.
    static func of(_ raw: String) -> Provider {
        Provider(rawValue: raw) ?? .generic
    }
}

/// One genotype call: alleles on the forward strand, `-` for no call.
struct Call: Equatable {
    let rsid: String
    let chromosome: String
    let position: Int
    let a1: String
    let a2: String
}

/// A call with the person it belongs to (the web's `FamilyCall`).
struct FamilyCall: Equatable {
    let personId: String
    let call: Call
}

struct SourceFile: Identifiable, Equatable {
    let id: String
    let personId: String
    let provider: Provider
    let build: String
    let sha256: String
    let originalName: String
    let rowCount: Int
    let importedAt: String
}

struct Relationship: Hashable {
    let parentId: String
    let childId: String
}

/// `mendelianSql`'s result: how many autosomal calls were compared and how many broke the rules.
struct Mendelian: Equatable {
    let compared: Int
    let violations: Int

    var rate: Double { compared == 0 ? 0 : Double(violations) / Double(compared) }
}
