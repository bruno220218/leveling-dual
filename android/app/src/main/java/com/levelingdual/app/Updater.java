package com.levelingdual.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/**
 * Atualização opcional: consulta as Releases públicas (uma requisição pequena ao abrir o app),
 * baixa o APK só quando a pessoa toca em Atualizar, confere se ele foi assinado com a mesma chave
 * do app instalado e entrega ao instalador do Android, que sempre pede confirmação.
 */
final class Updater {
    static final class Release {
        final String tag, pageUrl, apkUrl;
        Release(String tag, String pageUrl, String apkUrl) { this.tag = tag; this.pageUrl = pageUrl; this.apkUrl = apkUrl; }
        String version() { return tag.replaceFirst("^android-v", ""); }
    }

    interface Progress { void onProgress(int percent); }

    private static final String ACTION_STATUS = "com.levelingdual.app.INSTALL_STATUS";

    private Updater() {}

    /** Roda fora da tela principal. Devolve null quando não há versão nova. */
    static Release check(String currentVersion, String skipTag) throws Exception {
        HttpURLConnection c = open(Rules.RELEASES_API);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        if (c.getResponseCode() != 200) return null;
        JSONArray list = new JSONArray(readAll(c.getInputStream()));
        JSONObject best = null;
        for (int i = 0; i < list.length(); i++) {
            JSONObject rel = list.getJSONObject(i);
            String tag = rel.optString("tag_name");
            if (rel.optBoolean("draft") || !Rules.isVersionTag(tag)) continue;
            if (best == null || Rules.newer(tag, best.optString("tag_name"))) best = rel;
        }
        if (best == null) return null;
        String tag = best.optString("tag_name");
        if (!Rules.newer(tag, currentVersion) || tag.equals(skipTag)) return null;
        String apk = null;
        JSONArray assets = best.optJSONArray("assets");
        for (int i = 0; assets != null && i < assets.length(); i++) {
            String url = assets.getJSONObject(i).optString("browser_download_url");
            if (Rules.isReleaseApkUrl(url)) { apk = url; break; }
        }
        return new Release(tag, Rules.safeReleaseUrl(best.optString("html_url")), apk);
    }

    /** Baixa o APK para a pasta temporária do app. */
    static File download(Context context, Release release, Progress progress) throws Exception {
        if (!Rules.isReleaseApkUrl(release.apkUrl)) throw new IllegalStateException("endereço inválido");
        File dir = new File(context.getCacheDir(), "update");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("sem espaço");
        File out = new File(dir, "LevelingDual.apk");
        HttpURLConnection c = open(release.apkUrl);
        c.setInstanceFollowRedirects(true);
        if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode());
        long total = c.getContentLengthLong();
        try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            long done = 0;
            int n, last = -1;
            while ((n = in.read(buf)) > 0) {
                o.write(buf, 0, n);
                done += n;
                int pct = total > 0 ? (int) (done * 100 / total) : 0;
                if (pct != last) { last = pct; progress.onProgress(pct); }
            }
        }
        return out;
    }

    /** O APK precisa ser deste app, de versão mais nova e assinado com a mesma chave. */
    @SuppressWarnings("deprecation")
    static boolean isTrusted(Context context, File apk) {
        try {
            PackageManager pm = context.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo mine = pm.getPackageInfo(context.getPackageName(), flags);
            PackageInfo other = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
            if (other == null || !context.getPackageName().equals(other.packageName)) return false;
            long mineCode = Build.VERSION.SDK_INT >= 28 ? mine.getLongVersionCode() : mine.versionCode;
            long otherCode = Build.VERSION.SDK_INT >= 28 ? other.getLongVersionCode() : other.versionCode;
            if (otherCode <= mineCode) return false;
            Set<String> a = signers(mine), b = signers(other);
            return !a.isEmpty() && a.equals(b);
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) throws Exception {
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= 28) {
            if (info.signingInfo == null) return new HashSet<>();
            sigs = info.signingInfo.hasMultipleSigners() ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        for (Signature s : sigs) {
            StringBuilder hex = new StringBuilder();
            for (byte x : sha.digest(s.toByteArray())) hex.append(String.format("%02x", x));
            out.add(hex.toString());
        }
        return out;
    }

    /** Entrega o APK ao instalador do Android; ele mostra a confirmação para a pessoa. */
    static void install(Activity activity, File apk, Runnable onFailure) throws Exception {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent confirm = Build.VERSION.SDK_INT >= 33
                            ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                            : legacyIntent(intent);
                        if (confirm != null) {
                            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            activity.startActivity(confirm);
                        }
                        return;
                    }
                    try { activity.unregisterReceiver(this); } catch (Exception ignored) { }
                    if (status != PackageInstaller.STATUS_SUCCESS) onFailure.run();
                }
            };
            IntentFilter filter = new IntentFilter(ACTION_STATUS);
            if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else activity.registerReceiver(receiver, filter);
            Intent status = new Intent(ACTION_STATUS).setPackage(activity.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(activity, id, status, flags).getIntentSender());
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyIntent(Intent intent) { return intent.getParcelableExtra(Intent.EXTRA_INTENT); }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("User-Agent", "LevelingDualAndroid");
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        return c;
    }

    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }
}
