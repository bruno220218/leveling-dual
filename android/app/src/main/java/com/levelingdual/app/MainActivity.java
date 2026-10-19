package com.levelingdual.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.Rational;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.util.Collections;
import java.util.Locale;

/** Leveling Dual para Android: duas contas do Leveling Idle 2D na mesma tela. Baseado no Leveling Dual de bruno220218. */
public class MainActivity extends Activity implements AccountPane.Host, StageLayout.Listener {
    private static final String ACTION_PIP_SWITCH = "com.levelingdual.app.PIP_SWITCH";

    private SharedPreferences prefs;
    private boolean multiProfile, pipSupported, inPip, dark;
    private String lang = "pt";
    private Rules.Mode chosenMode = Rules.Mode.AUTO, resolvedMode = Rules.Mode.TABS;
    private float ratio = 0.5f;
    private int expanded = -1, active = 0;
    private final String[] names = new String[2], colors = new String[2], icons = new String[2];
    private boolean checkUpdates = true, confirmExit = true, economy = true, autoPip = true;
    private String skipVersion = "";

    private AccountPane[] panes;
    private StageLayout stage;
    private LinearLayout bar, tabs, updateBar;
    private TextView brandText, updateText, updateNow, updatePage, reloadBoth, darkButton, pipButton, optionsButton;
    private TextView[] tabViews;
    private FrameLayout darkOverlay;
    private TextView darkText;
    private Updater.Release release;
    private boolean downloading;
    private BroadcastReceiver pipReceiver;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // O jogo precisa da tela ligada: com ela apagada o Android pausa as páginas.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        multiProfile = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
        pipSupported = getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        loadPrefs();
        buildUi();
        panes[0].load();
        panes[1].load();
        applyState();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        registerPipReceiver();
        if (!multiProfile) showWebViewWarning();
        checkForUpdate(false);
    }

    // ---------- preferências ----------
    private void loadPrefs() {
        prefs = getSharedPreferences("dual", MODE_PRIVATE);
        lang = prefs.getString("lang", I18n.fromLocale(Locale.getDefault()));
        try { chosenMode = Rules.Mode.valueOf(prefs.getString("mode", "AUTO")); } catch (IllegalArgumentException e) { chosenMode = Rules.Mode.AUTO; }
        ratio = Rules.clampRatio(prefs.getFloat("ratio", 0.5f));
        active = prefs.getInt("active", 0) == 1 ? 1 : 0;
        for (int i = 0; i < 2; i++) {
            names[i] = prefs.getString("name" + i, "");
            colors[i] = valid(prefs.getString("color" + i, Rules.COLORS[i]), Rules.COLORS, Rules.COLORS[i]);
            icons[i] = valid(prefs.getString("icon" + i, Rules.ICONS[i]), Rules.ICONS, Rules.ICONS[i]);
        }
        checkUpdates = prefs.getBoolean("updates", true);
        confirmExit = prefs.getBoolean("confirmExit", true);
        economy = prefs.getBoolean("economy", true);
        autoPip = prefs.getBoolean("autoPip", true);
        skipVersion = prefs.getString("skipVersion", "");
    }

    private static String valid(String value, String[] allowed, String fallback) {
        for (String a : allowed) if (a.equals(value)) return value;
        return fallback;
    }

    private void savePrefs() {
        SharedPreferences.Editor e = prefs.edit()
            .putString("lang", lang).putString("mode", chosenMode.name()).putFloat("ratio", ratio).putInt("active", active)
            .putBoolean("updates", checkUpdates).putBoolean("confirmExit", confirmExit).putBoolean("economy", economy)
            .putBoolean("autoPip", autoPip).putString("skipVersion", skipVersion);
        for (int i = 0; i < 2; i++) e.putString("name" + i, names[i]).putString("color" + i, colors[i]).putString("icon" + i, icons[i]);
        e.apply();
    }

    private String displayName(int i) {
        return names[i] == null || names[i].trim().isEmpty() ? I18n.t(lang, "account") + " " + (i + 1) : names[i];
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    // ---------- tela ----------
    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0F17);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);

        bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), 0, dp(4), 0);
        bar.setBackgroundColor(0xFF101621);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        bar.addView(logo, new LinearLayout.LayoutParams(dp(30), dp(30)));
        brandText = new TextView(this);
        brandText.setText("LEVELING DUAL");
        brandText.setTextColor(0xFFDCE9F9);
        brandText.setTextSize(13);
        brandText.setLetterSpacing(0.12f);
        brandText.setTypeface(brandText.getTypeface(), android.graphics.Typeface.BOLD);
        brandText.setPadding(dp(10), 0, 0, 0);
        bar.addView(brandText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabViews = new TextView[2];
        for (int i = 0; i < 2; i++) {
            final int index = i;
            TextView tab = new TextView(this);
            tab.setGravity(Gravity.CENTER);
            tab.setTextSize(13);
            tab.setSingleLine(true);
            tab.setEllipsize(android.text.TextUtils.TruncateAt.END);
            tab.setPadding(dp(8), 0, dp(8), 0);
            tab.setOnClickListener(v -> setActive(index, true));
            tabViews[i] = tab;
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(38), 1f);
            lp.setMargins(dp(4), 0, 0, 0);
            tabs.addView(tab, lp);
        }
        bar.addView(tabs, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        reloadBoth = barButton("↻");
        reloadBoth.setOnClickListener(v -> { panes[0].reload(); panes[1].reload(); });
        pipButton = barButton("⧉");
        pipButton.setOnClickListener(v -> enterPip());
        pipButton.setVisibility(pipSupported ? View.VISIBLE : View.GONE);
        darkButton = barButton("🌙");
        darkButton.setOnClickListener(v -> setDark(true));
        optionsButton = barButton("⚙");
        optionsButton.setOnClickListener(v -> showOptions());
        for (TextView b : new TextView[] { reloadBoth, pipButton, darkButton, optionsButton }) bar.addView(b, new LinearLayout.LayoutParams(dp(42), dp(48)));
        column.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        updateBar = new LinearLayout(this);
        updateBar.setGravity(Gravity.CENTER_VERTICAL);
        updateBar.setBackgroundColor(0xFF143327);
        updateBar.setVisibility(View.GONE);
        updateText = new TextView(this);
        updateText.setTextColor(0xFF9FF0C9);
        updateText.setTextSize(13);
        updateText.setPadding(dp(12), dp(8), dp(8), dp(8));
        updateNow = pill();
        updateNow.setOnClickListener(v -> startUpdate());
        updatePage = pill();
        updatePage.setOnClickListener(v -> { if (release != null) openOutside(release.pageUrl); });
        TextView skip = barButton("✕");
        skip.setTextSize(16);
        skip.setOnClickListener(v -> { if (release != null) skipVersion = release.tag; release = null; savePrefs(); updateBar.setVisibility(View.GONE); });
        updateBar.addView(updateText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        updateBar.addView(updateNow);
        updateBar.addView(updatePage);
        updateBar.addView(skip, new LinearLayout.LayoutParams(dp(40), dp(40)));
        column.addView(updateBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        panes = new AccountPane[] { new AccountPane(this, 0, this), new AccountPane(this, 1, this) };
        stage = new StageLayout(this, panes[0], panes[1], this);
        column.addView(stage, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Tela escura: fica preta e com brilho mínimo, mas o jogo continua rodando por baixo.
        darkOverlay = new FrameLayout(this);
        darkOverlay.setBackgroundColor(Color.BLACK);
        darkOverlay.setVisibility(View.GONE);
        darkOverlay.setClickable(true);
        darkOverlay.setOnClickListener(v -> setDark(false));
        darkText = new TextView(this);
        darkText.setTextColor(0xFF2A2F38);
        darkText.setTextSize(14);
        darkText.setGravity(Gravity.CENTER);
        darkOverlay.addView(darkText, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.addView(darkOverlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Barras do sistema e teclado: o conteúdo nunca fica por baixo deles.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                left = bars.left; top = bars.top; right = bars.right; bottom = Math.max(bars.bottom, ime.bottom);
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            if (inPip) column.setPadding(0, 0, 0, 0);
            else column.setPadding(left, top, right, bottom);
            return insets;
        });
        setContentView(root);
    }

    private TextView barButton(String text) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextSize(19);
        b.setTextColor(0xFF99A9C0);
        b.setGravity(Gravity.CENTER);
        b.setBackgroundResource(android.R.drawable.list_selector_background);
        return b;
    }

    private TextView pill() {
        TextView b = new TextView(this);
        b.setTextColor(0xFFE5FFF2);
        b.setTextSize(13);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(12), dp(6), dp(12), dp(6));
        b.setBackground(chip(0xFF3CCF91, 0x333CCF91));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, dp(6), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private void applyState() {
        Configuration c = getResources().getConfiguration();
        resolvedMode = Rules.resolve(chosenMode, c.screenWidthDp, c.screenHeightDp, c.smallestScreenWidthDp);
        boolean tabsMode = resolvedMode == Rules.Mode.TABS;
        if (tabsMode) expanded = -1;
        // na janelinha só aparece a conta ativa, em tela cheia
        int shownExpanded = inPip ? active : expanded;
        bar.setVisibility(inPip ? View.GONE : View.VISIBLE);
        updateBar.setVisibility(!inPip && release != null ? View.VISIBLE : View.GONE);
        tabs.setVisibility(tabsMode ? View.VISIBLE : View.GONE);
        brandText.setVisibility(tabsMode ? View.GONE : View.VISIBLE);
        boolean overlap = tabsMode || shownExpanded >= 0;
        int top = shownExpanded >= 0 ? shownExpanded : active;
        for (int i = 0; i < 2; i++) {
            panes[i].apply(displayName(i), colors[i], icons[i], i == active, expanded == i, !tabsMode);
            panes[i].setHeaderVisible(!inPip);
            // modo economia: só desenha o que está aparecendo
            boolean hidden = (overlap && i != top) || dark;
            panes[i].setPageVisible(!(economy && hidden));
            styleTab(i);
        }
        stage.configure(resolvedMode, ratio, shownExpanded, active);
        reloadBoth.setContentDescription(I18n.t(lang, "reload_both"));
        pipButton.setContentDescription(I18n.t(lang, "pip"));
        darkButton.setContentDescription(I18n.t(lang, "dark"));
        optionsButton.setContentDescription(I18n.t(lang, "options"));
        darkText.setText(I18n.t(lang, "dark_hint") + "\n\n" + I18n.t(lang, "dark_charger"));
        if (release != null && !downloading) updateText.setText(String.format(I18n.t(lang, "update_new"), release.version()));
        updateNow.setText(I18n.t(lang, "update_now"));
        updateNow.setVisibility(release != null && release.apkUrl != null && !downloading ? View.VISIBLE : View.GONE);
        updatePage.setText(I18n.t(lang, "update_page"));
        updatePage.setVisibility(downloading ? View.GONE : View.VISIBLE);
        updatePipParams();
    }

    private void styleTab(int i) {
        TextView tab = tabViews[i];
        int color = Color.parseColor(colors[i]);
        boolean on = i == active;
        tab.setText(icons[i] + "  " + displayName(i));
        tab.setTextColor(on ? 0xFFFFFFFF : 0xFF8696AF);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(8));
        bg.setColor(on ? (color & 0x00FFFFFF) | 0x40000000 : 0xFF121A27);
        bg.setStroke(dp(on ? 2 : 1), on ? color : 0xFF263449);
        tab.setBackground(bg);
    }

    private void setActive(int index, boolean save) {
        if (active == index) return;
        active = index;
        applyState();
        if (save) savePrefs();
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyState();
    }

    private void setDark(boolean on) {
        dark = on;
        darkOverlay.setVisibility(on ? View.VISIBLE : View.GONE);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = on ? 0.01f : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(lp);
        applyState();
    }

    // ---------- janelinha flutuante ----------
    private PictureInPictureParams pipParams() {
        View page = panes[active];
        int[] r = Rules.pipRatio(page.getWidth() > 0 ? page.getWidth() : stage.getWidth(), page.getHeight() > 0 ? page.getHeight() : stage.getHeight());
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(r[0], r[1]));
        Intent switchIntent = new Intent(ACTION_PIP_SWITCH).setPackage(getPackageName());
        PendingIntent pending = PendingIntent.getBroadcast(this, 1, switchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String label = I18n.t(lang, "pip_switch");
        b.setActions(Collections.singletonList(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_next), label, label, pending)));
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(autoPip).setSeamlessResizeEnabled(false);
        return b.build();
    }

    private void updatePipParams() {
        if (!pipSupported || stage == null) return;
        try { setPictureInPictureParams(pipParams()); } catch (Exception ignored) { }
    }

    private void enterPip() {
        if (!pipSupported) { Toast.makeText(this, I18n.t(lang, "pip_unsupported"), Toast.LENGTH_SHORT).show(); return; }
        if (dark) setDark(false);
        try { enterPictureInPictureMode(pipParams()); } catch (Exception e) { Toast.makeText(this, I18n.t(lang, "pip_unsupported"), Toast.LENGTH_SHORT).show(); }
    }

    @Override protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // no Android 12+ o sistema entra sozinho (setAutoEnterEnabled); antes disso entramos aqui
        if (autoPip && pipSupported && Build.VERSION.SDK_INT < 31 && !isFinishing()) enterPip();
    }

    @Override public void onPictureInPictureModeChanged(boolean isInPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPip, newConfig);
        inPip = isInPip;
        getWindow().getDecorView().requestApplyInsets();
        applyState();
    }

    private void registerPipReceiver() {
        pipReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { setActive(1 - active, true); }
        };
        IntentFilter f = new IntentFilter(ACTION_PIP_SWITCH);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(pipReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(pipReceiver, f);
    }

    // ---------- AccountPane.Host ----------
    @Override public String lang() { return lang; }
    @Override public boolean multiProfile() { return multiProfile; }
    @Override public void onActive(int index) { setActive(index, true); }
    @Override public void onExpand(int index) {
        expanded = expanded == index ? -1 : index;
        active = index;
        applyState();
    }
    @Override public void openOutside(String url) {
        if (!Rules.isWebUrl(url)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (ActivityNotFoundException ignored) { }
    }

    // ---------- StageLayout.Listener ----------
    @Override public void onRatioChanged(float value, boolean finished) {
        ratio = value;
        if (finished) savePrefs();
    }
    @Override public void onDividerDoubleTap() {
        ratio = 0.5f;
        applyState();
        savePrefs();
    }

    // ---------- voltar / sair ----------
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (dark) { setDark(false); return; }
        if (expanded >= 0) { expanded = -1; applyState(); return; }
        if (panes[active].goBack()) return;
        if (!confirmExit) { finish(); return; }
        CheckBox dontAsk = new CheckBox(this);
        dontAsk.setText(I18n.t(lang, "exit_dont_ask"));
        FrameLayout box = new FrameLayout(this);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(dontAsk);
        new AlertDialog.Builder(this)
            .setTitle(I18n.t(lang, "exit_title"))
            .setMessage(I18n.t(lang, "exit_message"))
            .setView(box)
            .setNegativeButton(I18n.t(lang, "exit_keep"), null)
            .setPositiveButton(I18n.t(lang, "exit_quit"), (d, w) -> {
                if (dontAsk.isChecked()) { confirmExit = false; savePrefs(); }
                finish();
            })
            .show();
    }

    // ---------- opções ----------
    private void showOptions() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(20), dp(8), dp(20), dp(8));
        scroll.addView(list);
        final AlertDialog[] dialog = new AlertDialog[1];

        list.addView(section(I18n.t(lang, "opt_language")));
        LinearLayout langs = new LinearLayout(this);
        int[] flags = { R.drawable.flag_br, R.drawable.flag_us, R.drawable.flag_es };
        for (int i = 0; i < 3; i++) {
            final String code = I18n.LANGS[i];
            TextView b = new TextView(this);
            b.setText(I18n.t(code, "lang"));
            b.setTextColor(code.equals(lang) ? 0xFFFFFFFF : 0xFFB4C4DB);
            b.setCompoundDrawablesRelativeWithIntrinsicBounds(flags[i], 0, 0, 0);
            b.setCompoundDrawablePadding(dp(6));
            b.setGravity(Gravity.CENTER_VERTICAL);
            b.setPadding(dp(10), dp(8), dp(10), dp(8));
            b.setBackground(chip(code.equals(lang) ? 0xFF409EEC : 0xFF263144, code.equals(lang) ? 0x33409EEC : 0x00000000));
            b.setOnClickListener(v -> { lang = code; savePrefs(); applyState(); dialog[0].dismiss(); showOptions(); });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, dp(6), 0);
            langs.addView(b, lp);
        }
        HorizontalScrollView langScroll = new HorizontalScrollView(this);
        langScroll.addView(langs);
        list.addView(langScroll);

        list.addView(section(I18n.t(lang, "opt_layout")));
        RadioGroup modes = new RadioGroup(this);
        String[] modeKeys = { "layout_auto", "layout_tabs", "layout_side", "layout_stack" };
        for (int i = 0; i < 4; i++) {
            RadioButton r = new RadioButton(this);
            r.setText(I18n.t(lang, modeKeys[i]));
            r.setId(View.generateViewId());
            final Rules.Mode m = Rules.Mode.values()[i];
            modes.addView(r);
            if (m == chosenMode) r.setChecked(true);
            r.setOnCheckedChangeListener((btn, checked) -> { if (checked) { chosenMode = m; expanded = -1; savePrefs(); applyState(); } });
        }
        list.addView(modes);

        list.addView(section(I18n.t(lang, "opt_accounts")));
        final EditText[] nameInputs = new EditText[2];
        for (int i = 0; i < 2; i++) {
            final int index = i;
            TextView title = new TextView(this);
            title.setText(icons[i] + "  " + I18n.t(lang, "account") + " " + (i + 1));
            title.setTextColor(Color.parseColor(colors[i]));
            title.setTextSize(15);
            title.setPadding(0, dp(8), 0, dp(2));
            list.addView(title);
            EditText input = new EditText(this);
            input.setHint(I18n.t(lang, "opt_name"));
            input.setText(names[i]);
            input.setSingleLine(true);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
            input.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(24) });
            nameInputs[i] = input;
            list.addView(input);
            LinearLayout swatches = new LinearLayout(this);
            for (String color : Rules.COLORS) {
                View dot = new View(this);
                GradientDrawable d = new GradientDrawable();
                d.setShape(GradientDrawable.OVAL);
                d.setColor(Color.parseColor(color));
                d.setStroke(dp(3), color.equals(colors[i]) ? Color.WHITE : Color.TRANSPARENT);
                dot.setBackground(d);
                dot.setContentDescription(I18n.t(lang, "opt_color") + " " + color);
                dot.setOnClickListener(v -> { colors[index] = color; keepNames(nameInputs); savePrefs(); applyState(); dialog[0].dismiss(); showOptions(); });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(34), dp(34));
                lp.setMargins(0, dp(4), dp(6), dp(4));
                swatches.addView(dot, lp);
            }
            HorizontalScrollView swScroll = new HorizontalScrollView(this);
            swScroll.addView(swatches);
            list.addView(swScroll);
            LinearLayout iconRow = new LinearLayout(this);
            for (String icon : Rules.ICONS) {
                TextView b = new TextView(this);
                b.setText(icon);
                b.setTextSize(20);
                b.setGravity(Gravity.CENTER);
                b.setBackground(chip(icon.equals(icons[i]) ? Color.parseColor(colors[i]) : 0xFF263144, 0x00000000));
                b.setContentDescription(I18n.t(lang, "opt_icon"));
                b.setOnClickListener(v -> { icons[index] = icon; keepNames(nameInputs); savePrefs(); applyState(); dialog[0].dismiss(); showOptions(); });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(44));
                lp.setMargins(0, dp(2), dp(4), dp(6));
                iconRow.addView(b, lp);
            }
            HorizontalScrollView iconScroll = new HorizontalScrollView(this);
            iconScroll.addView(iconRow);
            list.addView(iconScroll);
        }

        list.addView(section(I18n.t(lang, "opt_general")));
        CheckBox eco = new CheckBox(this);
        eco.setText(I18n.t(lang, "opt_economy"));
        eco.setChecked(economy);
        eco.setOnCheckedChangeListener((b, on) -> { economy = on; savePrefs(); applyState(); });
        list.addView(eco);
        list.addView(hint(I18n.t(lang, "opt_economy_hint")));
        if (pipSupported) {
            CheckBox pip = new CheckBox(this);
            pip.setText(I18n.t(lang, "opt_pip_auto"));
            pip.setChecked(autoPip);
            pip.setOnCheckedChangeListener((b, on) -> { autoPip = on; savePrefs(); updatePipParams(); });
            list.addView(pip);
        }
        CheckBox updates = new CheckBox(this);
        updates.setText(I18n.t(lang, "opt_updates"));
        updates.setChecked(checkUpdates);
        updates.setOnCheckedChangeListener((b, on) -> { checkUpdates = on; savePrefs(); if (on) checkForUpdate(false); else { release = null; applyState(); } });
        list.addView(updates);
        CheckBox exit = new CheckBox(this);
        exit.setText(I18n.t(lang, "opt_confirm"));
        exit.setChecked(confirmExit);
        exit.setOnCheckedChangeListener((b, on) -> { confirmExit = on; savePrefs(); });
        list.addView(exit);
        TextView checkNow = pill();
        checkNow.setText(I18n.t(lang, "update_check"));
        checkNow.setOnClickListener(v -> checkForUpdate(true));
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clp.setMargins(0, dp(8), 0, 0);
        list.addView(checkNow, clp);
        TextView info = hint(I18n.t(lang, "screen_on") + "\n" + I18n.t(lang, "limit") + "\n\n" + I18n.t(lang, "credits") + "\n" + I18n.t(lang, "credits_note")
            + "\nLeveling Dual Android " + BuildConfig.VERSION_NAME);
        info.setPadding(0, dp(12), 0, dp(4));
        list.addView(info);

        dialog[0] = new AlertDialog.Builder(this)
            .setTitle(I18n.t(lang, "options"))
            .setView(scroll)
            .setPositiveButton(I18n.t(lang, "close"), null)
            .setOnDismissListener(d -> { keepNames(nameInputs); savePrefs(); applyState(); })
            .show();
    }

    private void keepNames(EditText[] inputs) {
        for (int i = 0; i < 2; i++) if (inputs[i] != null) names[i] = inputs[i].getText().toString().trim();
    }

    private TextView section(String text) {
        TextView t = new TextView(this);
        t.setText(text.toUpperCase(Locale.ROOT));
        t.setTextColor(0xFF7F8DA3);
        t.setTextSize(12);
        t.setLetterSpacing(0.08f);
        t.setPadding(0, dp(16), 0, dp(6));
        return t;
    }

    private TextView hint(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(0xFF8696AF);
        t.setTextSize(12);
        t.setPadding(dp(32), 0, 0, dp(6));
        return t;
    }

    private GradientDrawable chip(int stroke, int fill) {
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(8));
        d.setColor(fill);
        d.setStroke(dp(1), stroke);
        return d;
    }

    private void showWebViewWarning() {
        new AlertDialog.Builder(this)
            .setTitle(I18n.t(lang, "webview_title"))
            .setMessage(I18n.t(lang, "webview_msg"))
            .setPositiveButton(I18n.t(lang, "webview_update"), (d, w) -> openOutside("https://play.google.com/store/apps/details?id=com.google.android.webview"))
            .setNegativeButton(I18n.t(lang, "close"), null)
            .show();
    }

    // ---------- atualização opcional ----------
    /** Uma consulta pequena às Releases públicas. Não baixa nada sozinho. */
    private void checkForUpdate(boolean manual) {
        if (!checkUpdates && !manual) return;
        new Thread(() -> {
            Updater.Release found = null;
            try { found = Updater.check(BuildConfig.VERSION_NAME, manual ? "" : skipVersion); } catch (Exception ignored) { }
            final Updater.Release r = found;
            runOnUiThread(() -> {
                if (r != null) { release = r; applyState(); }
                else if (manual) Toast.makeText(this, I18n.t(lang, "update_none"), Toast.LENGTH_SHORT).show();
            });
        }, "update-check").start();
    }

    /** Só roda quando a pessoa toca em Atualizar. */
    private void startUpdate() {
        if (release == null || release.apkUrl == null || downloading) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this, I18n.t(lang, "update_allow"), Toast.LENGTH_LONG).show();
            try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (ActivityNotFoundException ignored) { }
            return;
        }
        downloading = true;
        final Updater.Release r = release;
        applyState();
        updateText.setText(String.format(I18n.t(lang, "update_downloading"), r.version(), 0));
        new Thread(() -> {
            try {
                File apk = Updater.download(this, r, pct -> runOnUiThread(() -> updateText.setText(String.format(I18n.t(lang, "update_downloading"), r.version(), pct))));
                if (!Updater.isTrusted(this, apk)) {
                    //noinspection ResultOfMethodCallIgnored
                    apk.delete();
                    runOnUiThread(() -> updateFailed(I18n.t(lang, "update_bad_file")));
                    return;
                }
                runOnUiThread(() -> {
                    updateText.setText(I18n.t(lang, "update_installing"));
                    try { Updater.install(this, apk, () -> runOnUiThread(() -> updateFailed(I18n.t(lang, "update_failed")))); }
                    catch (Exception e) { updateFailed(I18n.t(lang, "update_failed")); }
                });
            } catch (Exception e) {
                runOnUiThread(() -> updateFailed(I18n.t(lang, "update_failed")));
            }
        }, "update-download").start();
    }

    private void updateFailed(String message) {
        downloading = false;
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        applyState();
    }

    // ---------- ciclo de vida ----------
    @Override protected void onPause() {
        super.onPause();
        savePrefs();
        // grava os logins no disco (não pausa as páginas)
        if (multiProfile) {
            for (int i = 0; i < 2; i++) {
                Profile p = ProfileStore.getInstance().getProfile("conta" + (i + 1));
                if (p != null) p.getCookieManager().flush();
            }
        } else {
            CookieManager.getInstance().flush();
        }
    }

    @Override protected void onDestroy() {
        if (pipReceiver != null) try { unregisterReceiver(pipReceiver); } catch (Exception ignored) { }
        if (panes != null) for (AccountPane p : panes) p.destroy();
        super.onDestroy();
    }
}
