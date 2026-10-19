package com.levelingdual.app;

import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Regras puras (sem Android) para poderem ser testadas: endereços, versões e escolha do layout. */
public final class Rules {
    private Rules() {}

    public static final String GAME_URL = "https://levelingidle2d.com.br/jogar";
    public static final String RELEASES_API = "https://api.github.com/repos/bruno220218/leveling-dual/releases?per_page=20";
    public static final String RELEASES_PAGE = "https://github.com/bruno220218/leveling-dual/releases";
    /** As versões do Android ficam nas mesmas Releases, com tags "android-v1.0.0". */
    public static final String ANDROID_TAG_PREFIX = "android-v";

    private static final List<String> GAME_HOSTS = Arrays.asList("levelingidle2d.com.br", "www.levelingidle2d.com.br");

    public static final String[] COLORS = { "#409eec", "#8b7bff", "#3ccf91", "#f5a524", "#f25c7a", "#e5484d", "#f0d43a", "#38c7d8" };
    public static final String[] ICONS = { "⚔️", "🛡️", "🏹", "🔮", "🗡️", "👑", "🐉", "💀", "⭐", "🔥", "🌙", "💎" };

    /** Só HTTPS no domínio real do jogo, sem usuário/senha embutidos no endereço. */
    public static boolean isGameUrl(String value) {
        try {
            URI u = new URI(value);
            return "https".equals(u.getScheme()) && u.getRawUserInfo() == null && u.getHost() != null
                && GAME_HOSTS.contains(u.getHost().toLowerCase(Locale.ROOT));
        } catch (Exception e) {
            return false;
        }
    }

    /** Endereços que podem ser abertos no navegador do celular. */
    public static boolean isWebUrl(String value) {
        try {
            String scheme = new URI(value).getScheme();
            return "https".equals(scheme) || "http".equals(scheme);
        } catch (Exception e) {
            return false;
        }
    }

    /** true quando a versão a é mais nova que b ("1.2.0" > "1.1.9"). Aceita prefixos como "v" e "android-v". */
    public static boolean newer(String a, String b) {
        int[] x = parts(a), y = parts(b);
        for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] > y[i];
        return false;
    }

    static int[] parts(String version) {
        String clean = String.valueOf(version).toLowerCase(Locale.ROOT).replaceFirst("^(android-)?v", "");
        String[] p = clean.split("[.-]");
        int[] out = new int[3];
        for (int i = 0; i < 3 && i < p.length; i++) {
            try { out[i] = Integer.parseInt(p[i]); } catch (NumberFormatException e) { out[i] = 0; }
        }
        return out;
    }

    public static boolean isVersionTag(String tag) {
        return tag != null && tag.toLowerCase(Locale.ROOT).matches("^android-v\\d+\\.\\d+.*");
    }

    /** O link da versão nova só pode apontar para as Releases do repositório. */
    public static String safeReleaseUrl(String url) {
        return url != null && url.startsWith(RELEASES_PAGE + "/") ? url : RELEASES_PAGE;
    }

    /** O APK da atualização só pode ser baixado das Releases do repositório (HTTPS do GitHub). */
    public static boolean isReleaseApkUrl(String url) {
        return url != null && url.startsWith(RELEASES_PAGE + "/download/") && url.toLowerCase(Locale.ROOT).endsWith(".apk")
            && !url.contains("..") && !url.contains("@");
    }

    /** Proporção da janelinha flutuante: o Android aceita entre 1:2,39 e 2,39:1. Devolve {largura, altura}. */
    public static int[] pipRatio(int width, int height) {
        int w = Math.max(1, width), h = Math.max(1, height);
        double r = (double) w / h;
        if (r > 2.39) return new int[] { 239, 100 };
        if (r < 1 / 2.39) return new int[] { 100, 239 };
        return new int[] { w, h };
    }

    // ---------- layout ----------
    public enum Mode { AUTO, TABS, SIDE, STACK }

    /**
     * Celular em pé: abas (as duas contas continuam rodando, uma por cima da outra).
     * Celular deitado: lado a lado. Tablet: lado a lado deitado, empilhado em pé.
     */
    public static Mode resolve(Mode chosen, int widthDp, int heightDp, int smallestWidthDp) {
        if (chosen != Mode.AUTO) return chosen;
        boolean tablet = smallestWidthDp >= 600;
        boolean landscape = widthDp > heightDp;
        if (tablet) return landscape ? Mode.SIDE : Mode.STACK;
        return landscape ? Mode.SIDE : Mode.TABS;
    }

    /** Divisória entre 15% e 85%. */
    public static float clampRatio(float ratio) {
        if (Float.isNaN(ratio)) return 0.5f;
        return Math.max(0.15f, Math.min(0.85f, ratio));
    }

    /**
     * Retângulos [x, y, largura, altura] das duas contas dentro do palco.
     * expanded = -1 (nenhuma) ou 0/1: a conta ampliada ocupa tudo e a outra continua rodando por trás.
     */
    public static int[][] split(Mode mode, int width, int height, float ratio, int gap, int expanded) {
        int[] full = { 0, 0, width, height };
        if (mode == Mode.TABS || expanded >= 0) return new int[][] { full.clone(), full.clone() };
        float r = clampRatio(ratio);
        if (mode == Mode.STACK) {
            int first = Math.round((height - gap) * r);
            return new int[][] { { 0, 0, width, first }, { 0, first + gap, width, height - first - gap } };
        }
        int first = Math.round((width - gap) * r);
        return new int[][] { { 0, 0, first, height }, { first + gap, 0, width - first - gap, height } };
    }
}
