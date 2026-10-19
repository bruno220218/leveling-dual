package com.levelingdual.app;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Textos do app em português, inglês e espanhol (troca na hora, sem reiniciar). */
public final class I18n {
    private I18n() {}

    public static final String[] LANGS = { "pt", "en", "es" };
    static final Map<String, Map<String, String>> TEXT = new HashMap<>();

    private static void put(String lang, String... pairs) {
        Map<String, String> m = TEXT.computeIfAbsent(lang, k -> new HashMap<>());
        for (int i = 0; i + 1 < pairs.length; i += 2) m.put(pairs[i], pairs[i + 1]);
    }

    static {
        put("pt",
            "lang", "Português", "tagline", "Duas contas. Uma tela.", "account", "Conta",
            "reload", "Recarregar", "reload_both", "Recarregar as duas", "expand", "Ampliar", "back", "Voltar",
            "dark", "Tela escura", "dark_hint", "Tela escura · o jogo continua rodando\nToque para voltar",
            "dark_charger", "Dica: deixe o aparelho no carregador.",
            "options", "Opções", "opt_language", "Idioma", "opt_layout", "Divisão da tela",
            "layout_auto", "Automática", "layout_tabs", "Abas (uma por vez)", "layout_side", "Lado a lado", "layout_stack", "Empilhado",
            "opt_accounts", "Contas", "opt_name", "Nome", "opt_color", "Cor", "opt_icon", "Ícone",
            "opt_general", "Geral", "opt_updates", "Avisar quando sair uma versão nova", "opt_confirm", "Perguntar antes de sair",
            "close", "Fechar", "update_new", "Nova versão %s disponível", "update_skip", "Ignorar",
            "st_opening", "Abrindo jogo…", "st_loading", "Carregando…", "st_open", "Página aberta",
            "st_failed", "Falha ao abrir · toque em Recarregar", "st_crashed", "Página interrompida · recarregando…",
            "exit_title", "Sair do Leveling Dual?", "exit_message", "As duas contas param de rodar quando o app fecha.",
            "exit_keep", "Continuar jogando", "exit_quit", "Sair", "exit_dont_ask", "Não perguntar de novo",
            "webview_title", "Atualize o Android System WebView",
            "webview_msg", "Para ter dois logins separados, o app precisa de uma versão mais nova do Android System WebView. Sem ela, as duas contas dividem o mesmo login.",
            "webview_update", "Atualizar na Play Store", "screen_on", "A tela fica ligada enquanto o app está aberto. Se bloquear o aparelho, as contas param.",
            "limit", "O jogo permite no máximo 2 contas por pessoa.",
            "credits", "Criado por bruno220218 · colaborador SkymerLight", "credits_note", "Aplicativo independente, sem vínculo oficial com o Leveling Idle.");
        put("en",
            "lang", "English", "tagline", "Two accounts. One screen.", "account", "Account",
            "reload", "Reload", "reload_both", "Reload both", "expand", "Expand", "back", "Back",
            "dark", "Dark screen", "dark_hint", "Dark screen · the game keeps running\nTap to go back",
            "dark_charger", "Tip: keep the device on the charger.",
            "options", "Options", "opt_language", "Language", "opt_layout", "Screen layout",
            "layout_auto", "Automatic", "layout_tabs", "Tabs (one at a time)", "layout_side", "Side by side", "layout_stack", "Stacked",
            "opt_accounts", "Accounts", "opt_name", "Name", "opt_color", "Color", "opt_icon", "Icon",
            "opt_general", "General", "opt_updates", "Let me know when a new version is out", "opt_confirm", "Ask before leaving",
            "close", "Close", "update_new", "New version %s available", "update_skip", "Skip",
            "st_opening", "Opening game…", "st_loading", "Loading…", "st_open", "Page open",
            "st_failed", "Failed to open · tap Reload", "st_crashed", "Page stopped · reloading…",
            "exit_title", "Leave Leveling Dual?", "exit_message", "Both accounts stop running when the app closes.",
            "exit_keep", "Keep playing", "exit_quit", "Leave", "exit_dont_ask", "Don't ask again",
            "webview_title", "Update Android System WebView",
            "webview_msg", "To keep two separate logins, the app needs a newer Android System WebView. Without it, both accounts share the same login.",
            "webview_update", "Update on Play Store", "screen_on", "The screen stays on while the app is open. If you lock the device, the accounts stop.",
            "limit", "The game allows at most 2 accounts per person.",
            "credits", "Created by bruno220218 · collaborator SkymerLight", "credits_note", "Independent app, not officially affiliated with Leveling Idle.");
        put("es",
            "lang", "Español", "tagline", "Dos cuentas. Una pantalla.", "account", "Cuenta",
            "reload", "Recargar", "reload_both", "Recargar ambas", "expand", "Ampliar", "back", "Volver",
            "dark", "Pantalla oscura", "dark_hint", "Pantalla oscura · el juego sigue funcionando\nToca para volver",
            "dark_charger", "Consejo: deja el dispositivo en el cargador.",
            "options", "Opciones", "opt_language", "Idioma", "opt_layout", "División de la pantalla",
            "layout_auto", "Automática", "layout_tabs", "Pestañas (una a la vez)", "layout_side", "Lado a lado", "layout_stack", "Apilado",
            "opt_accounts", "Cuentas", "opt_name", "Nombre", "opt_color", "Color", "opt_icon", "Icono",
            "opt_general", "General", "opt_updates", "Avisar cuando salga una versión nueva", "opt_confirm", "Preguntar antes de salir",
            "close", "Cerrar", "update_new", "Nueva versión %s disponible", "update_skip", "Ignorar",
            "st_opening", "Abriendo juego…", "st_loading", "Cargando…", "st_open", "Página abierta",
            "st_failed", "Error al abrir · toca Recargar", "st_crashed", "Página detenida · recargando…",
            "exit_title", "¿Salir de Leveling Dual?", "exit_message", "Las dos cuentas dejan de funcionar cuando se cierra la app.",
            "exit_keep", "Seguir jugando", "exit_quit", "Salir", "exit_dont_ask", "No volver a preguntar",
            "webview_title", "Actualiza Android System WebView",
            "webview_msg", "Para tener dos sesiones separadas, la app necesita una versión más nueva de Android System WebView. Sin ella, las dos cuentas comparten la misma sesión.",
            "webview_update", "Actualizar en Play Store", "screen_on", "La pantalla se mantiene encendida mientras la app está abierta. Si bloqueas el dispositivo, las cuentas se detienen.",
            "limit", "El juego permite como máximo 2 cuentas por persona.",
            "credits", "Creado por bruno220218 · colaborador SkymerLight", "credits_note", "Aplicación independiente, sin vínculo oficial con Leveling Idle.");

        // atualização dentro do app, janelinha flutuante e modo economia
        put("pt",
            "update_now", "Atualizar", "update_page", "Novidades", "update_downloading", "Baixando a versão %s… %d%%",
            "update_installing", "Abrindo o instalador…", "update_failed", "Não deu para atualizar agora. Tente de novo mais tarde.",
            "update_bad_file", "O arquivo baixado não é uma versão oficial deste app. A atualização foi cancelada.",
            "update_allow", "Permita que o Leveling Dual instale atualizações e toque em Atualizar de novo.",
            "update_check", "Procurar versão nova agora", "update_none", "Você já está na versão mais recente.",
            "pip", "Janelinha flutuante", "pip_switch", "Trocar conta", "pip_unsupported", "Este aparelho não tem janelinha flutuante.",
            "opt_pip_auto", "Abrir a janelinha ao sair do app (botão início)",
            "opt_economy", "Modo economia",
            "opt_economy_hint", "Para de desenhar a conta que não está na tela (abas, conta ampliada e janelinha) e as duas na tela escura. Esquenta e gasta menos bateria; o jogo continua rodando, mas a conta escondida pode atualizar a imagem mais devagar.");
        put("en",
            "update_now", "Update", "update_page", "What's new", "update_downloading", "Downloading version %s… %d%%",
            "update_installing", "Opening the installer…", "update_failed", "Couldn't update right now. Try again later.",
            "update_bad_file", "The downloaded file is not an official version of this app. The update was cancelled.",
            "update_allow", "Allow Leveling Dual to install updates, then tap Update again.",
            "update_check", "Check for a new version now", "update_none", "You already have the latest version.",
            "pip", "Floating window", "pip_switch", "Switch account", "pip_unsupported", "This device has no floating window.",
            "opt_pip_auto", "Open the floating window when leaving the app (home button)",
            "opt_economy", "Power saving",
            "opt_economy_hint", "Stops drawing the account that is off screen (tabs, expanded account and floating window) and both on the dark screen. Less heat and battery; the game keeps running, but the hidden account may refresh its picture more slowly.");
        put("es",
            "update_now", "Actualizar", "update_page", "Novedades", "update_downloading", "Descargando la versión %s… %d%%",
            "update_installing", "Abriendo el instalador…", "update_failed", "No se pudo actualizar ahora. Inténtalo más tarde.",
            "update_bad_file", "El archivo descargado no es una versión oficial de esta app. Se canceló la actualización.",
            "update_allow", "Permite que Leveling Dual instale actualizaciones y toca Actualizar otra vez.",
            "update_check", "Buscar una versión nueva ahora", "update_none", "Ya tienes la versión más reciente.",
            "pip", "Ventana flotante", "pip_switch", "Cambiar cuenta", "pip_unsupported", "Este dispositivo no tiene ventana flotante.",
            "opt_pip_auto", "Abrir la ventana flotante al salir de la app (botón de inicio)",
            "opt_economy", "Modo ahorro",
            "opt_economy_hint", "Deja de dibujar la cuenta que no está en pantalla (pestañas, cuenta ampliada y ventana flotante) y las dos en la pantalla oscura. Menos calor y batería; el juego sigue funcionando, pero la cuenta oculta puede actualizar la imagen más despacio.");
    }

    public static String t(String lang, String key) {
        Map<String, String> m = TEXT.get(lang);
        String v = m == null ? null : m.get(key);
        if (v == null) v = TEXT.get("pt").get(key);
        return v == null ? key : v;
    }

    /** Idioma inicial a partir do idioma do aparelho. */
    public static String fromLocale(Locale locale) {
        String l = locale == null ? "pt" : locale.getLanguage();
        if ("es".equals(l)) return "es";
        if ("en".equals(l)) return "en";
        return "pt";
    }
}
