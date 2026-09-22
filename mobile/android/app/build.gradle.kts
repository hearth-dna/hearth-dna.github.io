import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versionProps = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}

// Build inputs that must not live in the repository: the store identity and the release signing
// credentials. A -P property wins over an environment variable, and nothing is ever read from a
// committed gradle.properties — this repository is public, so a keystore password has no file here
// it could live in. `make` fills these from the gitignored root .env; CI fills them from secrets.
fun buildProp(name: String): String? =
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv(name)?.takeIf { it.isNotBlank() }

val releaseKeystoreFile: File? = buildProp("RELEASE_KEYSTORE_PATH")?.let { path ->
    listOf(file(path), rootProject.file(path)).firstOrNull { it.exists() }
}

// The web build is copied in by `make mobile-web` and is not tracked in git (see .gitignore).
// Warn rather than fail: a clean checkout must still be able to run `gradle test`.
if (!file("src/main/assets/web/index.html").exists()) {
    logger.warn("mobile/android: src/main/assets/web/ is empty - run `make mobile-web` before building an APK")
}

android {
    namespace = "com.hearth"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        // The published identity comes from outside the repository, and the committed default is a
        // placeholder: `.example` is the reserved TLD, so it can never collide with a real listing,
        // and the repository stays free of a domain anyone actually owns (root CLAUDE.md,
        // "open-source ready").
        //
        // Whoever publishes sets HEARTH_APPLICATION_ID in their own .env (or as a -P flag, or a CI
        // secret) to the reverse-DNS of a domain they own. It must be right *before the first
        // upload*: Play fixes the package name permanently at that point, and it can then only be
        // replaced by a new listing with no installs, reviews or upgrade path.
        //
        // The Kotlin namespace above stays `com.hearth`: it is the R/BuildConfig package and has
        // nothing to do with store identity.
        applicationId = buildProp("HEARTH_APPLICATION_ID") ?: "example.hearth.app"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = versionProps.getProperty("VERSION_CODE").trim().toInt()
        versionName = versionProps.getProperty("VERSION_NAME").trim()

        // Cloud backup buttons (Cloud.kt, docs/runbook/cloud-backups.md). Both off unless set, so a
        // clean checkout builds without accounts. Google needs no id in the app — only an Android
        // OAuth client for this package and signing certificate, registered by the publisher — so
        // its switch is just "that registration exists". Dropbox's app key is public by design.
        val dropboxKey = buildProp("HEARTH_DROPBOX_APP_KEY") ?: ""
        buildConfigField("boolean", "GOOGLE_DRIVE", (buildProp("HEARTH_GOOGLE_DRIVE") == "1").toString())
        buildConfigField("String", "DROPBOX_APP_KEY", "\"$dropboxKey\"")
        manifestPlaceholders["dropboxScheme"] = "db-${dropboxKey.ifEmpty { "unset" }}"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (releaseKeystoreFile != null) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = buildProp("RELEASE_KEYSTORE_PASSWORD")
                keyAlias = buildProp("RELEASE_KEY_ALIAS")
                keyPassword = buildProp("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            // R8 on a single Activity buys little and can only break the JavascriptInterface
            // bridge, whose method names are reached from JavaScript by string. Shrinking the
            // resources is where the size actually is, and that is safe.
            isMinifyEnabled = false
            isShrinkResources = false
            if (releaseKeystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    sourceSets {
        getByName("main") { java.srcDirs("src/main/kotlin") }
        getByName("test") { java.srcDirs("src/test/kotlin") }
    }

    // The .gitignore keeps the synced web build out of git; this keeps stale files out of the APK
    // when the frontend drops one.
    packaging {
        resources.excludes += setOf("META-INF/*.version")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.webkit)
    implementation(libs.play.services.auth)


    testImplementation(libs.junit)
}
