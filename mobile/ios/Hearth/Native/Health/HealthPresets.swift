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
    /// Other names for the same thing, as people type them or documents say them (English, Russian,
    /// Ukrainian, German, Spanish, French). The name in the UI language is `preset.<id>`.
    var synonyms: [String] = []
}

enum HealthPresets {
    static let measurements: [HealthPreset] = [
        measurement("temperature", "Body temperature", "°C", synonyms: ["temperature", "temp", "body temp", "температура", "t°"]),
        measurement("blood-pressure", "Blood pressure", "mmHg", pair: ("systolic", "diastolic"), bodyPart: "heart", synonyms: ["bp", "давление", "артериальное давление"]),
        measurement("heart-rate", "Heart rate", "bpm", bodyPart: "heart", synonyms: ["pulse", "hr", "resting heart rate", "пульс", "чсс"]),
        measurement("spo2", "Blood oxygen (SpO₂)", "%", bodyPart: "lungs", synonyms: ["spo2", "oxygen saturation", "blood oxygen", "сатурация"]),
        measurement("weight", "Weight", "kg", synonyms: ["body mass", "body weight", "mass", "вес", "масса тела", "масса"]),
        measurement("height", "Height", "cm", synonyms: ["body height", "length", "stature", "рост", "длина тела"]),
        measurement("glucose", "Blood glucose", "mmol/L", synonyms: ["glucose", "blood sugar", "sugar", "сахар", "глюкоза", "сахар крови"]),
        measurement("sleep", "Sleep", "h", synonyms: ["sleep duration", "time asleep", "сон"]),
        measurement("peak-flow", "Peak flow", "L/min", bodyPart: "lungs"),
        measurement("respiratory-rate", "Breathing rate", "breaths/min", bodyPart: "lungs"),
        measurement("waist", "Waist circumference", "cm", bodyPart: "abdomen", synonyms: ["waist", "талия", "обхват талии"]),
        measurement("hip", "Hip circumference", "cm", bodyPart: "hips", synonyms: ["hips", "hip", "бедра", "обхват бедер"]),
        measurement("body-fat", "Body fat", "%", synonyms: ["body fat percentage", "fat", "жир", "процент жира"]),
        measurement("muscle-mass", "Muscle mass", "%"),
        measurement("head-circumference", "Head circumference", "cm", bodyPart: "head", synonyms: ["head", "окружность головы"]),
        measurement("steps", "Steps", "steps", synonyms: ["step count", "шаги"]),
        measurement("water", "Water drunk", "L", synonyms: ["water", "dietary water", "вода"]),
        measurement("mood", "Mood", "/10", synonyms: ["настроение"]),
        measurement("stress", "Stress", "/10", synonyms: ["стресс"]),
        measurement("inr", "INR (blood clotting)", "ratio"),
    ]

    static let symptoms: [HealthPreset] = [
        symptom("headache", "Headache", "head", synonyms: ["head ache", "head pain", "головная боль", "болит голова", "головний біль", "болить голова", "kopfschmerzen", "kopfweh", "dolor de cabeza", "cefalea", "mal de tête", "maux de tête", "céphalée"]),
        symptom("migraine", "Migraine", "head", tags: ["migraine"], synonyms: ["мигрень", "мігрень", "migräne", "migraña", "jaqueca"]),
        symptom("fever", "Fever", "whole body", synonyms: ["high temperature", "pyrexia", "жар", "лихорадка", "повышенная температура", "гарячка", "підвищена температура", "fieber", "fiebre", "fièvre"]),
        symptom("chills", "Chills", "whole body", synonyms: ["shivering", "rigors", "озноб", "знобить", "schüttelfrost", "frösteln", "escalofríos", "frissons"]),
        symptom("fatigue", "Fatigue", "whole body", synonyms: ["tiredness", "tired", "exhaustion", "усталость", "утомляемость", "слабость", "втома", "слабкість", "müdigkeit", "erschöpfung", "cansancio", "agotamiento", "fatiga", "épuisement"]),
        symptom("dizziness", "Dizziness", "head", synonyms: ["dizzy", "vertigo", "lightheadedness", "головокружение", "кружится голова", "запаморочення", "schwindel", "mareo", "mareos", "vértigo", "vertiges", "étourdissements"]),
        symptom("nosebleed", "Nosebleed", "nose", synonyms: ["nose bleed", "epistaxis", "носовое кровотечение", "кровь из носа", "носова кровотеча", "nasenbluten", "sangrado nasal", "hemorragia nasal", "saignement de nez", "épistaxis"]),
        symptom("runny-nose", "Runny or blocked nose", "nose", synonyms: ["runny nose", "blocked nose", "stuffy nose", "congestion", "насморк", "заложенность носа", "нежить", "закладеність носа", "schnupfen", "verstopfte nase", "secreción nasal", "congestión nasal", "nez qui coule", "nez bouché", "rhume"]),
        symptom("sneezing", "Sneezing", "nose", tags: ["allergy"], synonyms: ["sneeze", "чихание", "чхання", "niesen", "estornudos", "éternuements"]),
        symptom("loss-of-smell", "Loss of smell or taste", "nose", synonyms: ["loss of smell", "loss of taste", "anosmia", "потеря обоняния", "потеря вкуса", "не чувствую запахов", "втрата нюху", "втрата смаку", "geruchsverlust", "geschmacksverlust", "pérdida del olfato", "pérdida del gusto", "perte de l'odorat", "perte du goût"]),
        symptom("sore-throat", "Sore throat", "throat", synonyms: ["throat pain", "боль в горле", "болит горло", "біль у горлі", "болить горло", "halsschmerzen", "dolor de garganta", "mal de gorge"]),
        symptom("hoarse-voice", "Hoarse voice", "throat", synonyms: ["hoarseness", "lost voice", "осиплость", "хрипота", "сел голос", "захриплість", "охриплість", "heiserkeit", "ronquera", "afonía", "enrouement", "voix enrouée"]),
        symptom("cough", "Cough", "lungs", synonyms: ["coughing", "кашель", "husten", "tos", "toux"]),
        symptom("phlegm", "Phlegm or sputum", "lungs", synonyms: ["sputum", "mucus in the chest", "мокрота", "мокротиння", "auswurf", "schleim", "flema", "esputo", "crachats", "glaires"]),
        symptom("wheezing", "Wheezing", "lungs", synonyms: ["wheeze", "whistling breath", "свистящее дыхание", "хрипы в груди", "свистяче дихання", "хрипи", "giemen", "pfeifende atmung", "sibilancias", "pitos", "respiration sifflante", "sifflements"]),
        symptom("shortness-of-breath", "Shortness of breath", "lungs", synonyms: ["breathlessness", "dyspnoea", "dyspnea", "одышка", "нехватка воздуха", "задишка", "atemnot", "kurzatmigkeit", "falta de aire", "disnea", "essoufflement", "dyspnée"]),
        symptom("chest-pain", "Chest pain", "chest", synonyms: ["боль в груди", "боль в грудной клетке", "біль у грудях", "brustschmerzen", "dolor de pecho", "dolor torácico", "douleur thoracique", "douleur à la poitrine"]),
        symptom("palpitations", "Palpitations", "heart", synonyms: ["racing heart", "heart pounding", "сердцебиение", "серцебиття", "herzklopfen", "herzrasen", "palpitaciones"]),
        symptom("nausea", "Nausea", "stomach", synonyms: ["feeling sick", "queasy", "тошнота", "подташнивает", "нудота", "übelkeit", "náuseas", "nausée", "nausées"]),
        symptom("vomiting", "Vomiting", "stomach", synonyms: ["being sick", "throwing up", "рвота", "блювання", "erbrechen", "vómitos", "vomissements"]),
        symptom("stool", "Stool", "abdomen", synonyms: ["bowel movement", "poo", "faeces", "stuhl", "stuhlgang", "стул", "кал", "випорожнення", "deposición", "heces", "selles"]),
        symptom("diarrhea", "Diarrhea", "abdomen", synonyms: ["diarrhoea", "loose stools", "диарея", "понос", "діарея", "пронос", "durchfall", "diarrea", "diarrhée"]),
        symptom("constipation", "Constipation", "abdomen", synonyms: ["запор", "закреп", "verstopfung", "estreñimiento"]),
        symptom("bloating", "Bloating", "abdomen", synonyms: ["bloated", "вздутие", "вздутие живота", "здуття", "здуття живота", "blähbauch", "hinchazón abdominal", "ballonnements"]),
        symptom("gas", "Wind or gas", "abdomen", synonyms: ["wind", "gas", "flatulence", "farting", "газы", "метеоризм", "гази", "blähungen", "flatulenz", "gases", "flatulencia", "flatulences", "gaz"]),
        symptom("stomach-ache", "Stomach ache", "stomach", synonyms: ["stomachache", "abdominal pain", "tummy ache", "боль в животе", "болит живот", "біль у животі", "болить живіт", "bauchschmerzen", "magenschmerzen", "dolor de estómago", "dolor abdominal", "mal de ventre", "mal à l'estomac", "douleur abdominale"]),
        symptom("loss-of-appetite", "Loss of appetite", "stomach", synonyms: ["no appetite", "poor appetite", "потеря аппетита", "нет аппетита", "втрата апетиту", "appetitlosigkeit", "pérdida de apetito", "falta de apetito", "perte d'appétit", "manque d’appétit"]),
        symptom("heartburn", "Heartburn", "chest", synonyms: ["acid reflux", "reflux", "изжога", "печія", "sodbrennen", "acidez", "ardor de estómago", "brûlures d'estomac", "pyrosis"]),
        symptom("urination", "Urination problems", "abdomen", synonyms: ["frequent urination", "peeing often", "polyuria", "частое мочеиспускание", "часто в туалет", "часте сечовипускання", "häufiges wasserlassen", "harndrang", "orinar con frecuencia", "micción frecuente", "envies fréquentes d’uriner", "pollakiurie"]),
        symptom("thirst", "Excessive thirst", "whole body", synonyms: ["thirst", "very thirsty", "polydipsia", "жажда", "сильная жажда", "спрага", "durst", "starker durst", "sed", "sed excesiva", "soif", "soif intense"]),
        symptom("dry-mouth", "Dry mouth", "mouth", synonyms: ["mouth dryness", "xerostomia", "сухость во рту", "сухість у роті", "mundtrockenheit", "trockener mund", "boca seca", "sequedad de boca", "bouche sèche", "sécheresse buccale"]),
        symptom("back-pain", "Back pain", "back", synonyms: ["backache", "боль в спине", "болит спина", "біль у спині", "болить спина", "rückenschmerzen", "dolor de espalda", "mal de dos"]),
        symptom("joint-pain", "Joint pain", "joints", synonyms: ["arthralgia", "aching joints", "боль в суставах", "болят суставы", "біль у суглобах", "gelenkschmerzen", "dolor articular", "dolor de articulaciones", "douleurs articulaires"]),
        symptom("muscle-pain", "Muscle pain", "muscles", synonyms: ["myalgia", "aching muscles", "боль в мышцах", "мышечная боль", "біль у м’язах", "muskelschmerzen", "dolor muscular", "douleurs musculaires"]),
        symptom("leg-cramps", "Leg cramps", "legs", synonyms: ["cramp in the leg", "calf cramp", "судороги в ногах", "сводит ногу", "судоми в ногах", "wadenkrampf", "beinkrämpfe", "calambres en las piernas", "calambre en la pierna", "crampes aux jambes", "crampe au mollet"]),
        symptom("rash", "Rash", "skin", synonyms: ["skin rash", "сыпь", "высыпания", "висип", "ausschlag", "hautausschlag", "sarpullido", "erupción", "éruption cutanée", "boutons"]),
        symptom("hives", "Hives", "skin", tags: ["allergy"], synonyms: ["urticaria", "nettle rash", "крапивница", "кропив'янка", "nesselsucht", "urtikaria", "urticaria aguda", "ronchas", "urticaire"]),
        symptom("itching", "Itching", "skin", synonyms: ["itch", "itchy skin", "зуд", "чешется", "свербіж", "juckreiz", "picor", "comezón", "démangeaisons", "prurit"]),
        symptom("bruising", "Bruising", "skin", synonyms: ["bruise", "bruises", "синяки", "синяк", "кровоподтёк", "синці", "blaue flecken", "bluterguss", "moratones", "hematomas", "bleus", "ecchymoses"]),
        symptom("cold-sore", "Cold sore", "mouth", synonyms: ["fever blister", "herpes labialis", "герпес на губах", "простуда на губе", "герпес на губі", "lippenherpes", "fieberbläschen", "herpes labial", "calentura", "bouton de fièvre", "herpès labial"]),
        symptom("hair-loss", "Hair loss", "head", synonyms: ["thinning hair", "alopecia", "выпадение волос", "облысение", "випадіння волосся", "haarausfall", "caída del cabello", "chute de cheveux", "perte de cheveux"]),
        symptom("eye-irritation", "Red or irritated eyes", "eyes", synonyms: ["eye irritation", "red eyes", "itchy eyes", "sore eyes", "раздражение глаз", "красные глаза", "подразнення очей", "augenreizung", "rote augen", "irritación ocular", "ojos rojos", "irritation des yeux", "yeux rouges"]),
        symptom("watery-eyes", "Watery eyes", "eyes", synonyms: ["teary eyes", "tearing", "слезотечение", "слезятся глаза", "сльозотеча", "сльозяться очі", "tränende augen", "ojos llorosos", "lagrimeo", "yeux larmoyants", "larmoiement"]),
        symptom("earache", "Earache", "ears", synonyms: ["ear pain", "боль в ухе", "болит ухо", "біль у вусі", "ohrenschmerzen", "dolor de oído", "mal d'oreille", "douleur à l'oreille"]),
        symptom("blocked-ears", "Blocked ears", "ears", synonyms: ["ear fullness", "plugged ears", "заложенность ушей", "заложило уши", "закладеність вух", "verstopfte ohren", "druck auf den ohren", "oídos tapados", "taponamiento de oídos", "oreilles bouchées"]),
        symptom("toothache", "Toothache", "mouth", synonyms: ["tooth pain", "зубная боль", "болит зуб", "зубний біль", "zahnschmerzen", "dolor de muelas", "dolor de dientes", "mal de dents", "rage de dents"]),
        symptom("insomnia", "Trouble sleeping", "", synonyms: ["insomnia", "sleeplessness", "can't sleep", "бессонница", "плохой сон", "безсоння", "schlaflosigkeit", "schlafstörungen", "insomnio", "insomnie"]),
        symptom("anxiety", "Anxiety", "", synonyms: ["anxious", "nervousness", "тревога", "тревожность", "тривога", "тривожність", "angst", "ängstlichkeit", "ansiedad", "anxiété"]),
        symptom("low-mood", "Low mood", "", synonyms: ["feeling down", "sadness", "плохое настроение", "подавленность", "пригнічений настрій", "niedergeschlagenheit", "gedrückte stimmung", "bajo estado de ánimo", "tristeza", "humeur triste", "déprime"]),
        symptom("period-pain", "Period pain", "abdomen", synonyms: ["menstrual pain", "menstrual cramps", "dysmenorrhoea", "dysmenorrhea", "болезненные месячные", "менструальная боль", "менструальний біль", "regelschmerzen", "menstruationsschmerzen", "dolor menstrual", "cólicos menstruales", "règles douloureuses", "douleurs menstruelles"]),
        symptom("night-sweats", "Night sweats", "whole body", synonyms: ["sweating at night", "ночная потливость", "потею ночью", "нічна пітливість", "nachtschweiß", "sudores nocturnos", "sueurs nocturnes"]),
        symptom("hot-flushes", "Hot flushes", "whole body", synonyms: ["flushing", "hot flushes", "hot flashes", "redness of the face", "приливы", "покраснение лица", "припливи", "почервоніння обличчя", "hitzewallungen", "gesichtsrötung", "sofocos", "rubor", "bouffées de chaleur", "rougeur du visage"]),
        symptom("swelling", "Swelling", "", synonyms: ["oedema", "edema", "swollen", "отёк", "отек", "отёки", "набряк", "schwellung", "ödem", "hinchazón", "gonflement", "œdème"]),
        symptom("numbness", "Numbness or tingling", "", synonyms: ["numbness", "tingling", "pins and needles", "онемение", "покалывание", "оніміння", "поколювання", "taubheit", "kribbeln", "entumecimiento", "hormigueo", "engourdissement", "picotements", "fourmillements"]),
        symptom("blurred-vision", "Blurred vision", "eyes", synonyms: ["blurry vision", "нечёткое зрение", "размытое зрение", "затуманене зору", "нечіткий зір", "verschwommenes sehen", "sehstörung", "visión borrosa", "vision floue"]),
        symptom("cold-intolerance", "Always feeling cold", "whole body", synonyms: ["cold intolerance", "feeling cold", "зябкость", "постоянно мёрзну", "мерзлякуватість", "kälteempfindlichkeit", "frieren", "intolerancia al frío", "frilosité", "intolérance au froid"]),
        symptom("confusion", "Confusion", "head", synonyms: ["disorientation", "спутанность сознания", "дезориентация", "сплутаність свідомості", "verwirrtheit", "desorientación", "confusión", "désorientation"]),
        symptom("difficulty-swallowing", "Difficulty swallowing", "throat", synonyms: ["trouble swallowing", "dysphagia", "трудно глотать", "затруднённое глотание", "дисфагия", "важко ковтати", "дисфагія", "schluckbeschwerden", "dysphagie", "dificultad para tragar", "disfagia", "difficulté à avaler"]),
        symptom("memory-loss", "Forgetfulness", "head", synonyms: ["memory loss", "memory problems", "забывчивость", "проблемы с памятью", "ухудшение памяти", "забудькуватість", "проблеми з пам’яттю", "vergesslichkeit", "gedächtnisprobleme", "olvidos", "pérdida de memoria", "oublis", "troubles de la mémoire", "perte de mémoire"]),
        symptom("mole-change", "New or changing mole", "skin", synonyms: ["changing mole", "new mole", "изменение родинки", "новая родинка", "зміна родимки", "нова родимка", "muttermal verändert", "neues muttermal", "lunar que cambia", "lunar nuevo", "grain de beauté qui change", "nouveau grain de beauté"]),
        symptom("stiffness", "Stiffness", "joints", synonyms: ["morning stiffness", "stiff joints", "скованность", "утренняя скованность", "скутість", "steifheit", "morgensteifigkeit", "rigidez", "raideur", "raideur matinale"]),
        symptom("cramps", "Muscle cramps", "muscles", synonyms: ["muscle spasms", "судороги", "спазмы мышц", "судоми", "muskelkrämpfe", "wadenkrämpfe", "calambres", "calambres musculares", "crampes", "crampes musculaires"]),
        symptom("tinnitus", "Ringing in the ears", "ears", synonyms: ["tinnitus", "buzzing in the ears", "шум в ушах", "звон в ушах", "шум у вухах", "дзвін у вухах", "ohrensausen", "ohrgeräusche", "zumbido de oídos", "acúfenos", "bourdonnements d'oreille", "acouphènes"]),
    ]

    static let events: [HealthPreset] = [
        HealthPreset(id: "took-medication", title: "Took medication", kind: .medication),
        HealthPreset(id: "vaccination", title: "Vaccination", kind: .medication, tags: ["vaccine"]),
        HealthPreset(id: "doctor-visit", title: "Doctor visit", kind: .letter),
        HealthPreset(id: "injury", title: "Injury", kind: .symptom, tags: ["injury"], synonyms: ["trauma", "травма", "ушиб", "verletzung", "lesión", "herida", "blessure"]),
        HealthPreset(id: "allergic-reaction", title: "Allergic reaction", kind: .symptom, tags: ["allergy"], synonyms: ["аллергическая реакция", "аллергия", "алергічна реакція", "алергія", "allergische reaktion", "reacción alérgica", "réaction allergique"]),
        HealthPreset(id: "fainting", title: "Fainting", kind: .symptom, bodyPart: "head", synonyms: ["fainted", "passed out", "syncope", "обморок", "потерял сознание", "потеряла сознание", "непритомність", "знепритомнів", "ohnmacht", "desmayo", "síncope", "évanouissement"]),
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

    /// The symptom presets with the ones this person already recorded first, most recent first, then
    /// the rest in list order (presets.ts `presetOrder('symptom', …)`); `entries` newest first. An
    /// entry counts under any name it was saved with: "Cough", "кашель".
    static func symptomOrder(_ entries: [HealthEntry]) -> [HealthPreset] {
        var used: [HealthPreset] = []
        for e in entries where e.kind == .symptom {
            if let p = symptomPreset(e.title), !used.contains(p) { used.append(p) }
        }
        return used + symptoms.filter { !used.contains($0) }
    }

    /// The symptom preset (not an event like injury or fainting) a saved title names, by its title or
    /// a synonym (presets.ts `symptomPreset`).
    static func symptomPreset(_ title: String) -> HealthPreset? {
        presetOf(kind: .symptom, title: title).flatMap { p in symptoms.contains(p) ? p : nil }
    }

    static func find(_ id: String) -> HealthPreset? {
        all.first { $0.id == id }
    }

    /// Presets that start an entry of this kind, in list order, for the chips above the form.
    static func presets(for kind: HealthKind) -> [HealthPreset] {
        all.filter { $0.kind == kind }
    }

    private static func measurement(
        _ id: String, _ title: String, _ unit: String, pair: (String, String)? = nil, bodyPart: String? = nil,
        synonyms: [String] = []
    ) -> HealthPreset {
        HealthPreset(
            id: id, title: title, kind: .measurement, bodyPart: bodyPart, unit: unit,
            pair: pair.map { [$0.0, $0.1] }, synonyms: synonyms
        )
    }

    private static func symptom(
        _ id: String, _ title: String, _ bodyPart: String, tags: [String] = [], synonyms: [String] = []
    ) -> HealthPreset {
        HealthPreset(id: id, title: title, kind: .symptom, bodyPart: bodyPart, tags: tags, synonyms: synonyms)
    }
}

extension HealthPresets {
    private static func loose(_ x: String) -> String {
        x.precomposedStringWithCompatibilityMapping.lowercased()
            .replacingOccurrences(of: "’", with: "'").replacingOccurrences(of: "ʼ", with: "'")
            .replacingOccurrences(of: "ё", with: "е")
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// The preset a saved entry names: one of the same kind whose title or a synonym equals the
    /// entry's title (presets.ts `presetOf`). Entries keep the English title they were saved with
    /// ("Headache"), or whatever name the person typed ("головная боль"); this is how both show in
    /// the UI language.
    static func presetOf(kind: HealthKind, title: String) -> HealthPreset? {
        let n = loose(title)
        return all.first { p in p.kind == kind && ([p.title] + p.synonyms).contains { loose($0) == n } }
    }

    /// An entry's title as the screen shows it: the preset's name in the UI language, else as saved.
    static func entryTitle(_ e: HealthEntry, _ t: (String) -> String) -> String {
        presetOf(kind: e.kind, title: e.title).map { t("preset.\($0.id)") } ?? e.title
    }
}
