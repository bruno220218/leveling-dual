package com.levelingdual.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;

/** Uma conta: cabeçalho (ícone, nome, situação, recarregar, ampliar) e o jogo num WebView com perfil próprio. */
@SuppressLint("ViewConstructor")
public class AccountPane extends LinearLayout {
    public interface Host {
        String lang();
        boolean multiProfile();
        void onActive(int index);
        void onExpand(int index);
        void openOutside(String url);
    }

    final int index;
    private final Host host;
    private final LinearLayout header;
    private final TextView badge, name, status, reload, expand;
    WebView web;
    private String statusKey = "st_opening";
    private int color;
    private boolean active, expanded, showExpand = true;

    AccountPane(Context context, int index, Host host) {
        super(context);
        this.index = index;
        this.host = host;
        setOrientation(VERTICAL);
        int p = dp(2);
        setPadding(p, 0, p, p);

        header = new LinearLayout(context);
        header.setOrientation(HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(8), 0, dp(4), 0);
        header.setBackgroundColor(0xFF121A27);
        badge = label(context, 15, 0xFFFFFFFF);
        badge.setPadding(dp(6), dp(2), dp(6), dp(2));
        name = label(context, 13, 0xFFDCE9F9);
        name.setTypeface(name.getTypeface(), android.graphics.Typeface.BOLD);
        name.setPadding(dp(8), 0, dp(8), 0);
        status = label(context, 11, 0xFF8696AF);
        status.setSingleLine(true);
        status.setEllipsize(TextUtils.TruncateAt.END);
        reload = button(context, "⟳");
        expand = button(context, "⛶");
        reload.setOnClickListener(v -> reload());
        expand.setOnClickListener(v -> host.onExpand(index));
        header.addView(badge);
        header.addView(name);
        header.addView(status, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        header.addView(reload, new LayoutParams(dp(40), dp(34)));
        header.addView(expand, new LayoutParams(dp(40), dp(34)));
        addView(header, new LayoutParams(LayoutParams.MATCH_PARENT, dp(36)));
        createWebView();
    }

    private TextView label(Context c, int sp, int textColor) {
        TextView t = new TextView(c);
        t.setTextSize(sp);
        t.setTextColor(textColor);
        return t;
    }

    private TextView button(Context c, String text) {
        TextView t = label(c, 18, 0xFF99A9C0);
        t.setText(text);
        t.setGravity(Gravity.CENTER);
        t.setBackgroundResource(android.R.drawable.list_selector_background);
        return t;
    }

    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @SuppressLint({ "SetJavaScriptEnabled", "ClickableViewAccessibility" })
    private void createWebView() {
        WebView w = new WebView(getContext());
        // O perfil precisa ser escolhido antes de qualquer outra chamada no WebView: cookies e login separados por conta.
        if (host.multiProfile()) {
            String profile = "conta" + (index + 1);
            ProfileStore.getInstance().getOrCreateProfile(profile);
            WebViewCompat.setProfile(w, profile);
        }
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportMultipleWindows(false);
        w.setBackgroundColor(0xFF0B0F17);
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (Rules.isGameUrl(url)) return false;
                if (Rules.isWebUrl(url)) host.openOutside(url);
                return true; // nada fora do jogo abre dentro do app
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { setStatus("st_loading"); }
            @Override public void onPageFinished(WebView view, String url) { setStatus("st_open"); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) setStatus("st_failed");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // A página caiu: troca por um WebView novo, no mesmo perfil (o login continua).
                setStatus("st_crashed");
                post(() -> { replaceWebView(); reload(); });
                return true;
            }
        });
        w.setOnTouchListener((v, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) host.onActive(index);
            return false;
        });
        web = w;
        addView(w, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f));
    }

    private void replaceWebView() {
        WebView old = web;
        removeView(old);
        old.destroy();
        createWebView();
    }

    void load() { web.loadUrl(Rules.GAME_URL); }

    void reload() {
        setStatus("st_loading");
        web.loadUrl(Rules.GAME_URL);
    }

    boolean goBack() {
        if (web.canGoBack()) { web.goBack(); return true; }
        return false;
    }

    void setStatus(String key) {
        statusKey = key;
        status.setText(I18n.t(host.lang(), key));
    }

    /** Atualiza nome, cor, ícone e textos. */
    void apply(String accountName, String colorHex, String icon, boolean isActive, boolean isExpanded, boolean canExpand) {
        color = Color.parseColor(colorHex);
        active = isActive;
        expanded = isExpanded;
        showExpand = canExpand;
        badge.setText(icon);
        GradientDrawable chip = new GradientDrawable();
        chip.setCornerRadius(dp(6));
        chip.setColor((color & 0x00FFFFFF) | 0x33000000);
        chip.setStroke(dp(1), color);
        badge.setBackground(chip);
        name.setText(accountName);
        status.setText(I18n.t(host.lang(), statusKey));
        reload.setContentDescription(I18n.t(host.lang(), "reload"));
        expand.setText(isExpanded ? "🗗" : "⛶");
        expand.setContentDescription(I18n.t(host.lang(), isExpanded ? "back" : "expand"));
        expand.setVisibility(canExpand ? VISIBLE : GONE);
        // borda colorida na conta ativa
        setBackgroundColor(isActive ? color : 0xFF182131);
        header.setBackgroundColor(isActive ? blend(color, 0xFF121A27, 0.18f) : 0xFF121A27);
    }

    private static int blend(int a, int b, float amount) {
        int r = (int) (Color.red(a) * amount + Color.red(b) * (1 - amount));
        int g = (int) (Color.green(a) * amount + Color.green(b) * (1 - amount));
        int bl = (int) (Color.blue(a) * amount + Color.blue(b) * (1 - amount));
        return Color.rgb(r, g, bl);
    }

    /** Na janelinha flutuante o cabeçalho some para sobrar espaço para o jogo. */
    void setHeaderVisible(boolean visible) {
        header.setVisibility(visible ? VISIBLE : GONE);
        setPadding(visible ? dp(2) : 0, 0, visible ? dp(2) : 0, visible ? dp(2) : 0);
    }

    /**
     * Modo economia: a página que não aparece na tela para de ser desenhada (o jogo continua rodando).
     * INVISIBLE mantém o WebView vivo e no lugar; só deixa de pintar a imagem.
     */
    void setPageVisible(boolean visible) {
        int v = visible ? VISIBLE : INVISIBLE;
        if (web.getVisibility() != v) web.setVisibility(v);
    }

    void destroy() {
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent != null) parent.removeView(web);
        web.destroy();
    }
}
