import Foundation

/// A port of `frontend/src/health/presets.ts`: common situations offered as one-tap starting
/// points for an entry. A preset only prefills the form (kind, title, body part, tags, unit); the
/// title it writes is the English one, as on the web, and the chip shows `preset.<id>`.
struct HealthPreset: Identifiable, Equatable {
    let id: String
    let title: String
    let kind: HealthKind
    var bodyPart: String?
    var tags: [String]?
    /// Measurements only.
    var unit: String?
    /// Measurements with two numbers (systolic/diastolic): the `preset.pair.*` label of each.
    var pair: [String]?
}

enum HealthPresets {
    static let measurements: [HealthPreset] = [
        measurement("temperature", "Body temperature", "°C"),
        measurement("blood-pressure", "Blood pressure", "mmHg", pair: ("systolic", "diastolic"), bodyPart: "heart"),
        measurement("heart-rate", "Heart rate", "bpm", bodyPart: "heart"),
        measurement("spo2", "Blood oxygen (SpO₂)", "%", bodyPart: "lungs"),
        measurement("weight", "Weight", "kg"),
        measurement("height", "Height", "cm"),
        measurement("glucose", "Blood glucose", "mmol/L"),
        measurement("sleep", "Sleep", "h"),
        measurement("peak-flow", "Peak flow", "L/min", bodyPart: "lungs"),
        measurement("respiratory-rate", "Breathing rate", "breaths/min", bodyPart: "lungs"),
        measurement("waist", "Waist circumference", "cm", bodyPart: "abdomen"),
        measurement("hip", "Hip circumference", "cm", bodyPart: "hips"),
        measurement("body-fat", "Body fat", "%"),
        measurement("muscle-mass", "Muscle mass", "%"),
        measurement("head-circumference", "Head circumference", "cm", bodyPart: "head"),
        measurement("steps", "Steps", "steps"),
        measurement("water", "Water drunk", "L"),
        measurement("mood", "Mood", "/10"),
        measurement("stress", "Stress", "/10"),
        measurement("inr", "INR (blood clotting)", "ratio"),
    ]

    static let symptoms: [HealthPreset] = [
        symptom("headache", "Headache", "head"),
        symptom("migraine", "Migraine", "head", tags: ["migraine"]),
        symptom("fever", "Fever", "whole body"),
        symptom("chills", "Chills", "whole body"),
        symptom("fatigue", "Fatigue", "whole body"),
        symptom("dizziness", "Dizziness", "head"),
        symptom("nosebleed", "Nosebleed", "nose"),
        symptom("runny-nose", "Runny or blocked nose", "nose"),
        symptom("sneezing", "Sneezing", "nose", tags: ["allergy"]),
        symptom("sore-throat", "Sore throat", "throat"),
        symptom("cough", "Cough", "lungs"),
        symptom("shortness-of-breath", "Shortness of breath", "lungs"),
        symptom("chest-pain", "Chest pain", "chest"),
        symptom("palpitations", "Palpitations", "heart"),
        symptom("nausea", "Nausea", "stomach"),
        symptom("vomiting", "Vomiting", "stomach"),
        symptom("diarrhea", "Diarrhea", "abdomen"),
        symptom("constipation", "Constipation", "abdomen"),
        symptom("stomach-ache", "Stomach ache", "stomach"),
        symptom("heartburn", "Heartburn", "chest"),
        symptom("back-pain", "Back pain", "back"),
        symptom("joint-pain", "Joint pain", "joints"),
        symptom("muscle-pain", "Muscle pain", "muscles"),
        symptom("rash", "Rash", "skin"),
        symptom("itching", "Itching", "skin"),
        symptom("eye-irritation", "Eye irritation", "eyes"),
        symptom("earache", "Earache", "ears"),
        symptom("toothache", "Toothache", "mouth"),
        symptom("insomnia", "Trouble sleeping", ""),
        symptom("anxiety", "Anxiety", ""),
        symptom("low-mood", "Low mood", ""),
        symptom("period-pain", "Period pain", "abdomen"),
        symptom("swelling", "Swelling", ""),
        symptom("numbness", "Numbness or tingling", ""),
    ]

    static let events: [HealthPreset] = [
        HealthPreset(id: "took-medication", title: "Took medication", kind: .medication),
        HealthPreset(id: "vaccination", title: "Vaccination", kind: .medication, tags: ["vaccine"]),
        HealthPreset(id: "doctor-visit", title: "Doctor visit", kind: .letter),
        HealthPreset(id: "injury", title: "Injury", kind: .symptom, tags: ["injury"]),
        HealthPreset(id: "allergic-reaction", title: "Allergic reaction", kind: .symptom, tags: ["allergy"]),
        HealthPreset(id: "fainting", title: "Fainting", kind: .symptom, bodyPart: "head"),
    ]

    static let all = measurements + symptoms + events

    /// The measurement presets with the ones this person already records first, in the order they
    /// last used them (presets.ts `measurementOrder`); `entries` newest first.
    static func measurementOrder(_ entries: [HealthEntry]) -> [HealthPreset] {
        var used: [HealthPreset] = []
        for e in entries where e.kind == .measurement {
            let title = e.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if let p = measurements.first(where: { $0.title.lowercased() == title }), !used.contains(p) { used.append(p) }
        }
        return used + measurements.filter { !used.contains($0) }
    }

    static func find(_ id: String) -> HealthPreset? {
        all.first { $0.id == id }
    }

    /// Presets that start an entry of this kind, in list order, for the chips above the form.
    static func presets(for kind: HealthKind) -> [HealthPreset] {
        all.filter { $0.kind == kind }
    }

    private static func measurement(
        _ id: String, _ title: String, _ unit: String, pair: (String, String)? = nil, bodyPart: String? = nil
    ) -> HealthPreset {
        HealthPreset(
            id: id, title: title, kind: .measurement, bodyPart: bodyPart, unit: unit,
            pair: pair.map { [$0.0, $0.1] }
        )
    }

    private static func symptom(_ id: String, _ title: String, _ bodyPart: String, tags: [String] = []) -> HealthPreset {
        HealthPreset(id: id, title: title, kind: .symptom, bodyPart: bodyPart, tags: tags)
    }
}
