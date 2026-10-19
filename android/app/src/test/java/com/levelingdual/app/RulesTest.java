package com.levelingdual.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Locale;
import java.util.Map;

public class RulesTest {
    @Test public void navegacaoSoNoDominioRealDoJogo() {
        assertTrue(Rules.isGameUrl("https://levelingidle2d.com.br/jogar"));
        assertTrue(Rules.isGameUrl("https://www.levelingidle2d.com.br/login"));
        for (String bad : new String[] { "http://levelingidle2d.com.br/jogar", "https://levelingidle2d.com.br.example.com/",
            "https://evil.example/?levelingidle2d.com.br", "javascript:alert(1)", "file:///sdcard/x",
            "https://user:pass@levelingidle2d.com.br/", "intent://x#Intent;end", "invalid url" }) {
            assertFalse(bad, Rules.isGameUrl(bad));
        }
        assertTrue(Rules.isWebUrl("https://discord.gg/x"));
        assertFalse(Rules.isWebUrl("intent://x#Intent;end"));
        assertFalse(Rules.isWebUrl("javascript:alert(1)"));
    }

    @Test public void comparaVersoes() {
        assertTrue(Rules.newer("android-v1.1.0", "1.0.0"));
        assertTrue(Rules.newer("android-v1.0.10", "1.0.9"));
        assertFalse(Rules.newer("android-v1.0.0", "1.0.0"));
        assertFalse(Rules.newer("android-v0.9.0", "1.0.0"));
        assertTrue(Rules.isVersionTag("android-v1.2.0"));
        assertFalse(Rules.isVersionTag("v1.2.0")); // versões do PC não contam
    }

    @Test public void linkDaVersaoSoNasReleases() {
        String ok = "https://github.com/bruno220218/leveling-dual/releases/tag/android-v1.1.0";
        assertEquals(ok, Rules.safeReleaseUrl(ok));
        assertEquals(Rules.RELEASES_PAGE, Rules.safeReleaseUrl("https://evil.example/x"));
        assertEquals(Rules.RELEASES_PAGE, Rules.safeReleaseUrl(null));
    }

    @Test public void apkSoDasReleasesDoBruno() {
        assertTrue(Rules.isReleaseApkUrl("https://github.com/bruno220218/leveling-dual/releases/download/android-v1.1.0/LevelingDual-Android.apk"));
        assertFalse(Rules.isReleaseApkUrl("https://github.com/outro/leveling-dual/releases/download/android-v1.1.0/x.apk"));
        assertFalse(Rules.isReleaseApkUrl("https://github.com/bruno220218/leveling-dual/releases/download/../../evil/x.apk"));
        assertFalse(Rules.isReleaseApkUrl("http://github.com/bruno220218/leveling-dual/releases/download/a/x.apk"));
        assertFalse(Rules.isReleaseApkUrl("https://github.com/bruno220218/leveling-dual/releases/download/a/x.zip"));
        assertFalse(Rules.isReleaseApkUrl(null));
    }

    @Test public void proporcaoDaJanelinhaDentroDoLimiteDoAndroid() {
        assertArrayEquals(new int[] { 400, 700 }, Rules.pipRatio(400, 700));
        assertArrayEquals(new int[] { 100, 239 }, Rules.pipRatio(300, 2000));
        assertArrayEquals(new int[] { 239, 100 }, Rules.pipRatio(3000, 400));
        assertArrayEquals(new int[] { 1, 1 }, Rules.pipRatio(0, 0));
    }

    @Test public void escolheLayoutPeloAparelho() {
        assertEquals(Rules.Mode.TABS, Rules.resolve(Rules.Mode.AUTO, 400, 850, 400));   // celular em pé
        assertEquals(Rules.Mode.SIDE, Rules.resolve(Rules.Mode.AUTO, 850, 400, 400));   // celular deitado
        assertEquals(Rules.Mode.STACK, Rules.resolve(Rules.Mode.AUTO, 800, 1280, 800)); // tablet em pé
        assertEquals(Rules.Mode.SIDE, Rules.resolve(Rules.Mode.AUTO, 1280, 800, 800));  // tablet deitado
        assertEquals(Rules.Mode.STACK, Rules.resolve(Rules.Mode.STACK, 400, 850, 400)); // escolha manual vence
    }

    @Test public void divideSemSobrepor() {
        int[][] side = Rules.split(Rules.Mode.SIDE, 1000, 600, 0.5f, 10, -1);
        assertEquals(side[0][2] + 10, side[1][0]);
        assertEquals(1000, side[1][0] + side[1][2]);
        int[][] stack = Rules.split(Rules.Mode.STACK, 800, 1200, 0.25f, 10, -1);
        assertEquals(stack[0][3] + 10, stack[1][1]);
        assertEquals(1200, stack[1][1] + stack[1][3]);
        // abas e conta ampliada: as duas ocupam a tela inteira (a de trás continua rodando)
        assertArrayEquals(new int[] { 0, 0, 400, 800 }, Rules.split(Rules.Mode.TABS, 400, 800, 0.5f, 10, -1)[1]);
        assertArrayEquals(new int[] { 0, 0, 1000, 600 }, Rules.split(Rules.Mode.SIDE, 1000, 600, 0.5f, 10, 1)[0]);
        assertEquals(0.15f, Rules.clampRatio(-3f), 0f);
        assertEquals(0.85f, Rules.clampRatio(9f), 0f);
    }

    @Test public void tresIdiomasComAsMesmasChaves() {
        Map<String, String> pt = I18n.TEXT.get("pt");
        for (String lang : I18n.LANGS) assertEquals(lang, pt.keySet(), I18n.TEXT.get(lang).keySet());
        assertEquals("es", I18n.fromLocale(new Locale("es", "AR")));
        assertEquals("en", I18n.fromLocale(Locale.US));
        assertEquals("pt", I18n.fromLocale(Locale.JAPAN));
        assertEquals("Recarregar", I18n.t("xx", "reload"));
    }
}
