plugins {
    id("com.android.application") version "9.4.1" apply false
}

// A pasta do projeto fica no OneDrive, que trava arquivos enquanto sincroniza.
// Por isso os arquivos gerados pelo build ficam fora dele, na pasta do usuário.
allprojects {
    layout.buildDirectory.set(file("${System.getProperty("user.home")}/.leveling-dual-build/${project.name}"))
}
