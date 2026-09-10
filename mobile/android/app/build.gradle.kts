import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// -----------------------------------------------------------------------------------------
// RELEASE SIGNING
//
// The scaffold this replaces signed the release build with `signingConfigs.getByName("debug")`
// under a `// TODO`. That is not a placeholder, it is a hazard: the debug keystore ships with
// the Android SDK, its password is public, and the APK it produces is installable and
// distributable. Anyone can sign an update to it.
//
// So there is no fallback. If `key.properties` is absent the release build has NO signing
// config, and Gradle emits `app-release-unsigned.apk` — an artifact that cannot be installed
// and cannot be mistaken for a shippable one. CI can still prove the app compiles without
// holding any secret.
//
// `key.properties` and `*.jks` are both gitignored; the real values live in the gitignored
// CREDENTIALS.md, Section 16.2.
// -----------------------------------------------------------------------------------------
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

// Every field, not just the file. A key.properties missing its password would otherwise reach
// Gradle as a null and fail deep inside the signing task with a message about nothing.
val hasReleaseSigning = keystoreProperties.run {
    listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
        .all { !getProperty(it).isNullOrBlank() } &&
        rootProject.file(getProperty("storeFile")).exists()
}

android {
    namespace = "com.equipcert.equipcert_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.equipcert.equipcert_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release") else null

            // Explicitly false, so the release manifest cannot inherit a debuggable flag from
            // a library manifest merge. Acceptance criterion C4.
            isDebuggable = false

            // Code shrinking is deliberately OFF, and this is a decision rather than an
            // oversight. R8 strips Java/Kotlin reflection targets, which is how plugin
            // registration in image_picker, geolocator and flutter_secure_storage breaks — in
            // release only, at runtime, on a device, long after every gate has gone green.
            // Turning it on is worth doing when there is a device to smoke-test the resulting
            // APK on; doing it blind trades a measurable few MB for an unmeasurable crash.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
