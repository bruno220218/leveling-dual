plugins {
    id("com.android.application")
}

// Assinatura de lançamento: a chave fica fora do projeto e a senha só existe enquanto o
// script assinar-apk.ps1 roda (ela não é gravada em arquivo nenhum).
val releaseKeystore = System.getenv("LD_KEYSTORE")?.let { file(it) }

android {
    namespace = "com.levelingdual.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.levelingdual.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (releaseKeystore != null && releaseKeystore.exists()) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("LD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LD_KEY_ALIAS") ?: "levelingdual"
                keyPassword = System.getenv("LD_KEY_PASSWORD") ?: System.getenv("LD_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.1")
    testImplementation("junit:junit:4.13.2")
}
