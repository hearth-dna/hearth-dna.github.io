package com.hearth.health

import com.hearth.data.HealthKind
import java.text.Normalizer

/**
 * Port of frontend/src/health/presets.ts: common situations offered as one-tap starting points for
 * an entry. A preset only prefills the form. `title` is what is stored (English, like the web);
 * the screen shows the translation under `preset.<id>`. Generated from the web list; keep the ids,
 * and keep it in step: PresetsTest compares ids, titles and symptom synonyms with the web's files.
 */
data class HealthPreset(
    val id: String,
    val title: String,
    val kind: HealthKind,
    val bodyPart: String = "",
    val tags: List<String> = emptyList(),
    /** Measurements only. */
    val unit: String = "",
    /** Measurements with two numbers (systolic/diastolic): the i18n suffixes of `preset.pair.*`. */
    val pair: Pair<String, String>? = null,
    val step: Double? = null,
    /**
     * Other names for the same thing, as people type them or documents say them (English, Russian,
     * Ukrainian, German, Spanish, French). The name in the UI language is `preset.<id>`.
     */
    val synonyms: List<String> = emptyList(),
)

val MEASUREMENT_PRESETS = listOf(
    HealthPreset("temperature", "Body temperature", HealthKind.MEASUREMENT, unit = "°C", step = 0.1, synonyms = listOf("temperature", "temp", "body temp", "температура", "t°")),
    HealthPreset("blood-pressure", "Blood pressure", HealthKind.MEASUREMENT, bodyPart = "heart", unit = "mmHg", pair = "systolic" to "diastolic", step = 1.0, synonyms = listOf("bp", "давление", "артериальное давление")),
    HealthPreset("heart-rate", "Heart rate", HealthKind.MEASUREMENT, bodyPart = "heart", unit = "bpm", step = 1.0, synonyms = listOf("pulse", "hr", "resting heart rate", "пульс", "чсс")),
    HealthPreset("spo2", "Blood oxygen (SpO₂)", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "%", step = 1.0, synonyms = listOf("spo2", "oxygen saturation", "blood oxygen", "сатурация")),
    HealthPreset("weight", "Weight", HealthKind.MEASUREMENT, unit = "kg", step = 0.1, synonyms = listOf("body mass", "body weight", "mass", "вес", "масса тела", "масса")),
    HealthPreset("height", "Height", HealthKind.MEASUREMENT, unit = "cm", step = 0.5, synonyms = listOf("body height", "length", "stature", "рост", "длина тела")),
    HealthPreset("glucose", "Blood glucose", HealthKind.MEASUREMENT, unit = "mmol/L", step = 0.1, synonyms = listOf("glucose", "blood sugar", "sugar", "сахар", "глюкоза", "сахар крови")),
    HealthPreset("sleep", "Sleep", HealthKind.MEASUREMENT, unit = "h", step = 0.25, synonyms = listOf("sleep duration", "time asleep", "сон")),
    HealthPreset("peak-flow", "Peak flow", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "L/min", step = 5.0),
    HealthPreset("respiratory-rate", "Breathing rate", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "breaths/min", step = 1.0),
    HealthPreset("waist", "Waist circumference", HealthKind.MEASUREMENT, bodyPart = "abdomen", unit = "cm", step = 0.5, synonyms = listOf("waist", "талия", "обхват талии")),
    HealthPreset("hip", "Hip circumference", HealthKind.MEASUREMENT, bodyPart = "hips", unit = "cm", step = 0.5, synonyms = listOf("hips", "hip", "бедра", "обхват бедер")),
    HealthPreset("body-fat", "Body fat", HealthKind.MEASUREMENT, unit = "%", step = 0.1, synonyms = listOf("body fat percentage", "fat", "жир", "процент жира")),
    HealthPreset("muscle-mass", "Muscle mass", HealthKind.MEASUREMENT, unit = "%", step = 0.1),
    HealthPreset("head-circumference", "Head circumference", HealthKind.MEASUREMENT, bodyPart = "head", unit = "cm", step = 0.5, synonyms = listOf("head", "окружность головы")),
    HealthPreset("steps", "Steps", HealthKind.MEASUREMENT, unit = "steps", step = 100.0, synonyms = listOf("step count", "шаги")),
    HealthPreset("water", "Water drunk", HealthKind.MEASUREMENT, unit = "L", step = 0.1, synonyms = listOf("water", "dietary water", "вода")),
    HealthPreset("mood", "Mood", HealthKind.MEASUREMENT, unit = "/10", step = 1.0, synonyms = listOf("настроение")),
    HealthPreset("stress", "Stress", HealthKind.MEASUREMENT, unit = "/10", step = 1.0, synonyms = listOf("стресс")),
    HealthPreset("inr", "INR (blood clotting)", HealthKind.MEASUREMENT, unit = "ratio", step = 0.1),
)

val SYMPTOM_PRESETS = listOf(
    HealthPreset("headache", "Headache", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("head ache", "head pain", "головная боль", "болит голова", "головний біль", "болить голова", "kopfschmerzen", "kopfweh", "dolor de cabeza", "cefalea", "mal de tête", "maux de tête", "céphalée")),
    HealthPreset("migraine", "Migraine", HealthKind.SYMPTOM, bodyPart = "head", tags = listOf("migraine"), synonyms = listOf("мигрень", "мігрень", "migräne", "migraña", "jaqueca")),
    HealthPreset("fever", "Fever", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("high temperature", "pyrexia", "жар", "лихорадка", "повышенная температура", "гарячка", "підвищена температура", "fieber", "fiebre", "fièvre")),
    HealthPreset("chills", "Chills", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("shivering", "rigors", "озноб", "знобить", "schüttelfrost", "frösteln", "escalofríos", "frissons")),
    HealthPreset("fatigue", "Fatigue", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("tiredness", "tired", "exhaustion", "усталость", "утомляемость", "слабость", "втома", "слабкість", "müdigkeit", "erschöpfung", "cansancio", "agotamiento", "fatiga", "épuisement")),
    HealthPreset("dizziness", "Dizziness", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("dizzy", "vertigo", "lightheadedness", "головокружение", "кружится голова", "запаморочення", "schwindel", "mareo", "mareos", "vértigo", "vertiges", "étourdissements")),
    HealthPreset("nosebleed", "Nosebleed", HealthKind.SYMPTOM, bodyPart = "nose", synonyms = listOf("nose bleed", "epistaxis", "носовое кровотечение", "кровь из носа", "носова кровотеча", "nasenbluten", "sangrado nasal", "hemorragia nasal", "saignement de nez", "épistaxis")),
    HealthPreset("runny-nose", "Runny or blocked nose", HealthKind.SYMPTOM, bodyPart = "nose", synonyms = listOf("runny nose", "blocked nose", "stuffy nose", "congestion", "насморк", "заложенность носа", "нежить", "закладеність носа", "schnupfen", "verstopfte nase", "secreción nasal", "congestión nasal", "nez qui coule", "nez bouché", "rhume")),
    HealthPreset("sneezing", "Sneezing", HealthKind.SYMPTOM, bodyPart = "nose", tags = listOf("allergy"), synonyms = listOf("sneeze", "чихание", "чхання", "niesen", "estornudos", "éternuements")),
    HealthPreset("loss-of-smell", "Loss of smell or taste", HealthKind.SYMPTOM, bodyPart = "nose", synonyms = listOf("loss of smell", "loss of taste", "anosmia", "потеря обоняния", "потеря вкуса", "не чувствую запахов", "втрата нюху", "втрата смаку", "geruchsverlust", "geschmacksverlust", "pérdida del olfato", "pérdida del gusto", "perte de l'odorat", "perte du goût")),
    HealthPreset("sore-throat", "Sore throat", HealthKind.SYMPTOM, bodyPart = "throat", synonyms = listOf("throat pain", "боль в горле", "болит горло", "біль у горлі", "болить горло", "halsschmerzen", "dolor de garganta", "mal de gorge")),
    HealthPreset("hoarse-voice", "Hoarse voice", HealthKind.SYMPTOM, bodyPart = "throat", synonyms = listOf("hoarseness", "lost voice", "осиплость", "хрипота", "сел голос", "захриплість", "охриплість", "heiserkeit", "ronquera", "afonía", "enrouement", "voix enrouée")),
    HealthPreset("cough", "Cough", HealthKind.SYMPTOM, bodyPart = "lungs", synonyms = listOf("coughing", "кашель", "husten", "tos", "toux")),
    HealthPreset("phlegm", "Phlegm or sputum", HealthKind.SYMPTOM, bodyPart = "lungs", synonyms = listOf("sputum", "mucus in the chest", "мокрота", "мокротиння", "auswurf", "schleim", "flema", "esputo", "crachats", "glaires")),
    HealthPreset("wheezing", "Wheezing", HealthKind.SYMPTOM, bodyPart = "lungs", synonyms = listOf("wheeze", "whistling breath", "свистящее дыхание", "хрипы в груди", "свистяче дихання", "хрипи", "giemen", "pfeifende atmung", "sibilancias", "pitos", "respiration sifflante", "sifflements")),
    HealthPreset("shortness-of-breath", "Shortness of breath", HealthKind.SYMPTOM, bodyPart = "lungs", synonyms = listOf("breathlessness", "dyspnoea", "dyspnea", "одышка", "нехватка воздуха", "задишка", "atemnot", "kurzatmigkeit", "falta de aire", "disnea", "essoufflement", "dyspnée")),
    HealthPreset("chest-pain", "Chest pain", HealthKind.SYMPTOM, bodyPart = "chest", synonyms = listOf("боль в груди", "боль в грудной клетке", "біль у грудях", "brustschmerzen", "dolor de pecho", "dolor torácico", "douleur thoracique", "douleur à la poitrine")),
    HealthPreset("palpitations", "Palpitations", HealthKind.SYMPTOM, bodyPart = "heart", synonyms = listOf("racing heart", "heart pounding", "сердцебиение", "серцебиття", "herzklopfen", "herzrasen", "palpitaciones")),
    HealthPreset("nausea", "Nausea", HealthKind.SYMPTOM, bodyPart = "stomach", synonyms = listOf("feeling sick", "queasy", "тошнота", "подташнивает", "нудота", "übelkeit", "náuseas", "nausée", "nausées")),
    HealthPreset("vomiting", "Vomiting", HealthKind.SYMPTOM, bodyPart = "stomach", synonyms = listOf("being sick", "throwing up", "рвота", "блювання", "erbrechen", "vómitos", "vomissements")),
    HealthPreset("stool", "Stool", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("bowel movement", "poo", "faeces", "stuhl", "stuhlgang", "стул", "кал", "випорожнення", "deposición", "heces", "selles")),
    HealthPreset("diarrhea", "Diarrhea", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("diarrhoea", "loose stools", "диарея", "понос", "діарея", "пронос", "durchfall", "diarrea", "diarrhée")),
    HealthPreset("constipation", "Constipation", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("запор", "закреп", "verstopfung", "estreñimiento")),
    HealthPreset("bloating", "Bloating", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("bloated", "вздутие", "вздутие живота", "здуття", "здуття живота", "blähbauch", "hinchazón abdominal", "ballonnements")),
    HealthPreset("gas", "Wind or gas", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("wind", "gas", "flatulence", "farting", "газы", "метеоризм", "гази", "blähungen", "flatulenz", "gases", "flatulencia", "flatulences", "gaz")),
    HealthPreset("stomach-ache", "Stomach ache", HealthKind.SYMPTOM, bodyPart = "stomach", synonyms = listOf("stomachache", "abdominal pain", "tummy ache", "боль в животе", "болит живот", "біль у животі", "болить живіт", "bauchschmerzen", "magenschmerzen", "dolor de estómago", "dolor abdominal", "mal de ventre", "mal à l'estomac", "douleur abdominale")),
    HealthPreset("loss-of-appetite", "Loss of appetite", HealthKind.SYMPTOM, bodyPart = "stomach", synonyms = listOf("no appetite", "poor appetite", "потеря аппетита", "нет аппетита", "втрата апетиту", "appetitlosigkeit", "pérdida de apetito", "falta de apetito", "perte d'appétit", "manque d’appétit")),
    HealthPreset("heartburn", "Heartburn", HealthKind.SYMPTOM, bodyPart = "chest", synonyms = listOf("acid reflux", "reflux", "изжога", "печія", "sodbrennen", "acidez", "ardor de estómago", "brûlures d'estomac", "pyrosis")),
    HealthPreset("urination", "Urination problems", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("frequent urination", "peeing often", "polyuria", "частое мочеиспускание", "часто в туалет", "часте сечовипускання", "häufiges wasserlassen", "harndrang", "orinar con frecuencia", "micción frecuente", "envies fréquentes d’uriner", "pollakiurie")),
    HealthPreset("thirst", "Excessive thirst", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("thirst", "very thirsty", "polydipsia", "жажда", "сильная жажда", "спрага", "durst", "starker durst", "sed", "sed excesiva", "soif", "soif intense")),
    HealthPreset("dry-mouth", "Dry mouth", HealthKind.SYMPTOM, bodyPart = "mouth", synonyms = listOf("mouth dryness", "xerostomia", "сухость во рту", "сухість у роті", "mundtrockenheit", "trockener mund", "boca seca", "sequedad de boca", "bouche sèche", "sécheresse buccale")),
    HealthPreset("back-pain", "Back pain", HealthKind.SYMPTOM, bodyPart = "back", synonyms = listOf("backache", "боль в спине", "болит спина", "біль у спині", "болить спина", "rückenschmerzen", "dolor de espalda", "mal de dos")),
    HealthPreset("joint-pain", "Joint pain", HealthKind.SYMPTOM, bodyPart = "joints", synonyms = listOf("arthralgia", "aching joints", "боль в суставах", "болят суставы", "біль у суглобах", "gelenkschmerzen", "dolor articular", "dolor de articulaciones", "douleurs articulaires")),
    HealthPreset("muscle-pain", "Muscle pain", HealthKind.SYMPTOM, bodyPart = "muscles", synonyms = listOf("myalgia", "aching muscles", "боль в мышцах", "мышечная боль", "біль у м’язах", "muskelschmerzen", "dolor muscular", "douleurs musculaires")),
    HealthPreset("leg-cramps", "Leg cramps", HealthKind.SYMPTOM, bodyPart = "legs", synonyms = listOf("cramp in the leg", "calf cramp", "судороги в ногах", "сводит ногу", "судоми в ногах", "wadenkrampf", "beinkrämpfe", "calambres en las piernas", "calambre en la pierna", "crampes aux jambes", "crampe au mollet")),
    HealthPreset("rash", "Rash", HealthKind.SYMPTOM, bodyPart = "skin", synonyms = listOf("skin rash", "сыпь", "высыпания", "висип", "ausschlag", "hautausschlag", "sarpullido", "erupción", "éruption cutanée", "boutons")),
    HealthPreset("hives", "Hives", HealthKind.SYMPTOM, bodyPart = "skin", tags = listOf("allergy"), synonyms = listOf("urticaria", "nettle rash", "крапивница", "кропив'янка", "nesselsucht", "urtikaria", "urticaria aguda", "ronchas", "urticaire")),
    HealthPreset("itching", "Itching", HealthKind.SYMPTOM, bodyPart = "skin", synonyms = listOf("itch", "itchy skin", "зуд", "чешется", "свербіж", "juckreiz", "picor", "comezón", "démangeaisons", "prurit")),
    HealthPreset("bruising", "Bruising", HealthKind.SYMPTOM, bodyPart = "skin", synonyms = listOf("bruise", "bruises", "синяки", "синяк", "кровоподтёк", "синці", "blaue flecken", "bluterguss", "moratones", "hematomas", "bleus", "ecchymoses")),
    HealthPreset("cold-sore", "Cold sore", HealthKind.SYMPTOM, bodyPart = "mouth", synonyms = listOf("fever blister", "herpes labialis", "герпес на губах", "простуда на губе", "герпес на губі", "lippenherpes", "fieberbläschen", "herpes labial", "calentura", "bouton de fièvre", "herpès labial")),
    HealthPreset("hair-loss", "Hair loss", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("thinning hair", "alopecia", "выпадение волос", "облысение", "випадіння волосся", "haarausfall", "caída del cabello", "chute de cheveux", "perte de cheveux")),
    HealthPreset("eye-irritation", "Red or irritated eyes", HealthKind.SYMPTOM, bodyPart = "eyes", synonyms = listOf("eye irritation", "red eyes", "itchy eyes", "sore eyes", "раздражение глаз", "красные глаза", "подразнення очей", "augenreizung", "rote augen", "irritación ocular", "ojos rojos", "irritation des yeux", "yeux rouges")),
    HealthPreset("watery-eyes", "Watery eyes", HealthKind.SYMPTOM, bodyPart = "eyes", synonyms = listOf("teary eyes", "tearing", "слезотечение", "слезятся глаза", "сльозотеча", "сльозяться очі", "tränende augen", "ojos llorosos", "lagrimeo", "yeux larmoyants", "larmoiement")),
    HealthPreset("earache", "Earache", HealthKind.SYMPTOM, bodyPart = "ears", synonyms = listOf("ear pain", "боль в ухе", "болит ухо", "біль у вусі", "ohrenschmerzen", "dolor de oído", "mal d'oreille", "douleur à l'oreille")),
    HealthPreset("blocked-ears", "Blocked ears", HealthKind.SYMPTOM, bodyPart = "ears", synonyms = listOf("ear fullness", "plugged ears", "заложенность ушей", "заложило уши", "закладеність вух", "verstopfte ohren", "druck auf den ohren", "oídos tapados", "taponamiento de oídos", "oreilles bouchées")),
    HealthPreset("toothache", "Toothache", HealthKind.SYMPTOM, bodyPart = "mouth", synonyms = listOf("tooth pain", "зубная боль", "болит зуб", "зубний біль", "zahnschmerzen", "dolor de muelas", "dolor de dientes", "mal de dents", "rage de dents")),
    HealthPreset("insomnia", "Trouble sleeping", HealthKind.SYMPTOM, synonyms = listOf("insomnia", "sleeplessness", "can't sleep", "бессонница", "плохой сон", "безсоння", "schlaflosigkeit", "schlafstörungen", "insomnio", "insomnie")),
    HealthPreset("anxiety", "Anxiety", HealthKind.SYMPTOM, synonyms = listOf("anxious", "nervousness", "тревога", "тревожность", "тривога", "тривожність", "angst", "ängstlichkeit", "ansiedad", "anxiété")),
    HealthPreset("low-mood", "Low mood", HealthKind.SYMPTOM, synonyms = listOf("feeling down", "sadness", "плохое настроение", "подавленность", "пригнічений настрій", "niedergeschlagenheit", "gedrückte stimmung", "bajo estado de ánimo", "tristeza", "humeur triste", "déprime")),
    HealthPreset("period-pain", "Period pain", HealthKind.SYMPTOM, bodyPart = "abdomen", synonyms = listOf("menstrual pain", "menstrual cramps", "dysmenorrhoea", "dysmenorrhea", "болезненные месячные", "менструальная боль", "менструальний біль", "regelschmerzen", "menstruationsschmerzen", "dolor menstrual", "cólicos menstruales", "règles douloureuses", "douleurs menstruelles")),
    HealthPreset("night-sweats", "Night sweats", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("sweating at night", "ночная потливость", "потею ночью", "нічна пітливість", "nachtschweiß", "sudores nocturnos", "sueurs nocturnes")),
    HealthPreset("hot-flushes", "Hot flushes", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("flushing", "hot flushes", "hot flashes", "redness of the face", "приливы", "покраснение лица", "припливи", "почервоніння обличчя", "hitzewallungen", "gesichtsrötung", "sofocos", "rubor", "bouffées de chaleur", "rougeur du visage")),
    HealthPreset("swelling", "Swelling", HealthKind.SYMPTOM, synonyms = listOf("oedema", "edema", "swollen", "отёк", "отек", "отёки", "набряк", "schwellung", "ödem", "hinchazón", "gonflement", "œdème")),
    HealthPreset("numbness", "Numbness or tingling", HealthKind.SYMPTOM, synonyms = listOf("numbness", "tingling", "pins and needles", "онемение", "покалывание", "оніміння", "поколювання", "taubheit", "kribbeln", "entumecimiento", "hormigueo", "engourdissement", "picotements", "fourmillements")),
    HealthPreset("blurred-vision", "Blurred vision", HealthKind.SYMPTOM, bodyPart = "eyes", synonyms = listOf("blurry vision", "нечёткое зрение", "размытое зрение", "затуманене зору", "нечіткий зір", "verschwommenes sehen", "sehstörung", "visión borrosa", "vision floue")),
    HealthPreset("cold-intolerance", "Always feeling cold", HealthKind.SYMPTOM, bodyPart = "whole body", synonyms = listOf("cold intolerance", "feeling cold", "зябкость", "постоянно мёрзну", "мерзлякуватість", "kälteempfindlichkeit", "frieren", "intolerancia al frío", "frilosité", "intolérance au froid")),
    HealthPreset("confusion", "Confusion", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("disorientation", "спутанность сознания", "дезориентация", "сплутаність свідомості", "verwirrtheit", "desorientación", "confusión", "désorientation")),
    HealthPreset("difficulty-swallowing", "Difficulty swallowing", HealthKind.SYMPTOM, bodyPart = "throat", synonyms = listOf("trouble swallowing", "dysphagia", "трудно глотать", "затруднённое глотание", "дисфагия", "важко ковтати", "дисфагія", "schluckbeschwerden", "dysphagie", "dificultad para tragar", "disfagia", "difficulté à avaler")),
    HealthPreset("memory-loss", "Forgetfulness", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("memory loss", "memory problems", "забывчивость", "проблемы с памятью", "ухудшение памяти", "забудькуватість", "проблеми з пам’яттю", "vergesslichkeit", "gedächtnisprobleme", "olvidos", "pérdida de memoria", "oublis", "troubles de la mémoire", "perte de mémoire")),
    HealthPreset("mole-change", "New or changing mole", HealthKind.SYMPTOM, bodyPart = "skin", synonyms = listOf("changing mole", "new mole", "изменение родинки", "новая родинка", "зміна родимки", "нова родимка", "muttermal verändert", "neues muttermal", "lunar que cambia", "lunar nuevo", "grain de beauté qui change", "nouveau grain de beauté")),
    HealthPreset("stiffness", "Stiffness", HealthKind.SYMPTOM, bodyPart = "joints", synonyms = listOf("morning stiffness", "stiff joints", "скованность", "утренняя скованность", "скутість", "steifheit", "morgensteifigkeit", "rigidez", "raideur", "raideur matinale")),
    HealthPreset("cramps", "Muscle cramps", HealthKind.SYMPTOM, bodyPart = "muscles", synonyms = listOf("muscle spasms", "судороги", "спазмы мышц", "судоми", "muskelkrämpfe", "wadenkrämpfe", "calambres", "calambres musculares", "crampes", "crampes musculaires")),
    HealthPreset("tinnitus", "Ringing in the ears", HealthKind.SYMPTOM, bodyPart = "ears", synonyms = listOf("tinnitus", "buzzing in the ears", "шум в ушах", "звон в ушах", "шум у вухах", "дзвін у вухах", "ohrensausen", "ohrgeräusche", "zumbido de oídos", "acúfenos", "bourdonnements d'oreille", "acouphènes")),
)

val EVENT_PRESETS = listOf(
    HealthPreset("took-medication", "Took medication", HealthKind.MEDICATION),
    HealthPreset("vaccination", "Vaccination", HealthKind.MEDICATION, tags = listOf("vaccine")),
    HealthPreset("doctor-visit", "Doctor visit", HealthKind.LETTER),
    HealthPreset("injury", "Injury", HealthKind.SYMPTOM, tags = listOf("injury"), synonyms = listOf("trauma", "травма", "ушиб", "verletzung", "lesión", "herida", "blessure")),
    HealthPreset("allergic-reaction", "Allergic reaction", HealthKind.SYMPTOM, tags = listOf("allergy"), synonyms = listOf("аллергическая реакция", "аллергия", "алергічна реакція", "алергія", "allergische reaktion", "reacción alérgica", "réaction allergique")),
    HealthPreset("fainting", "Fainting", HealthKind.SYMPTOM, bodyPart = "head", synonyms = listOf("fainted", "passed out", "syncope", "обморок", "потерял сознание", "потеряла сознание", "непритомність", "знепритомнів", "ohnmacht", "desmayo", "síncope", "évanouissement")),
)

private val ALL_PRESETS = MEASUREMENT_PRESETS + SYMPTOM_PRESETS + EVENT_PRESETS

fun findPreset(id: String): HealthPreset? = ALL_PRESETS.firstOrNull { it.id == id }

/**
 * The measurement presets with the ones this person already records first, in the order they
 * last used them (presets.ts `measurementOrder`); [entries] newest first.
 */
fun measurementOrder(entries: List<com.hearth.data.HealthEntry>): List<HealthPreset> {
    val used = LinkedHashSet<HealthPreset>()
    for (e in entries) {
        if (e.kind != HealthKind.MEASUREMENT) continue
        MEASUREMENT_PRESETS.firstOrNull { it.title.lowercase() == e.title.trim().lowercase() }?.let { used.add(it) }
    }
    return used.toList() + MEASUREMENT_PRESETS.filter { it !in used }
}

/** Presets that start an entry of this kind, in list order, for the chips above the form. */
fun presetsFor(kind: HealthKind): List<HealthPreset> = ALL_PRESETS.filter { it.kind == kind }

/** Suggestions for the body-part field (`BODY_PARTS` in frontend/src/types.ts); free text is accepted too. */
val BODY_PARTS = listOf(
    "head", "eyes", "ears", "nose", "mouth", "throat", "neck", "chest", "heart", "lungs", "abdomen",
    "stomach", "back", "lower back", "hips", "shoulders", "arms", "elbows", "wrists", "hands",
    "fingers", "legs", "knees", "ankles", "feet", "skin", "joints", "muscles", "whole body",
)

private fun loose(x: String) = Normalizer.normalize(x, Normalizer.Form.NFKC).lowercase()
    .replace('’', '\'').replace('ʼ', '\'').replace('ё', 'е').replace(Regex("\\s+"), " ").trim()

/**
 * The preset a saved entry names: one of the same kind whose title or a synonym equals the entry's
 * title (presets.ts `presetOf`). Entries keep the English title they were saved with ("Headache"),
 * or whatever name the person typed ("головная боль"); this is how both show in the UI language.
 */
fun presetOf(kind: HealthKind, title: String): HealthPreset? {
    val n = loose(title)
    return ALL_PRESETS.firstOrNull { p -> p.kind == kind && (listOf(p.title) + p.synonyms).any { loose(it) == n } }
}

/** An entry's title as the screen shows it: the preset's name in the UI language, else as saved. */
fun entryTitle(e: com.hearth.data.HealthEntry, t: (String) -> String): String =
    presetOf(e.kind, e.title)?.let { t("preset.${it.id}") } ?: e.title
