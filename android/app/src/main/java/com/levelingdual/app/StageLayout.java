package com.levelingdual.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;

/**
 * Arruma as duas contas: abas (as duas rodando, a ativa por cima), lado a lado ou empilhadas,
 * com uma faixa arrastável no meio. A conta escondida nunca é destruída nem pausada.
 */
@SuppressLint("ViewConstructor")
public class StageLayout extends ViewGroup {
    public interface Listener {
        void onRatioChanged(float ratio, boolean finished);
        void onDividerDoubleTap();
    }

    private final AccountPane[] panes;
    private final Divider divider;
    private final Listener listener;
    private Rules.Mode mode = Rules.Mode.SIDE;
    private float ratio = 0.5f;
    private int expanded = -1, front = 0;
    private final int gap;

    StageLayout(Context context, AccountPane a, AccountPane b, Listener listener) {
        super(context);
        this.panes = new AccountPane[] { a, b };
        this.listener = listener;
        gap = Math.round(10 * getResources().getDisplayMetrics().density);
        setBackgroundColor(0xFF273045);
        addView(a);
        addView(b);
        divider = new Divider(context);
        addView(divider);
    }

    void configure(Rules.Mode resolved, float ratio, int expanded, int front) {
        this.mode = resolved;
        this.ratio = Rules.clampRatio(ratio);
        this.expanded = expanded;
        this.front = front;
        // em abas/ampliado, a conta da frente fica por cima e a outra continua rodando por trás
        boolean overlap = resolved == Rules.Mode.TABS || expanded >= 0;
        int top = expanded >= 0 ? expanded : front;
        panes[top].setTranslationZ(overlap ? 2f : 0f);
        panes[1 - top].setTranslationZ(0f);
        divider.setVisibility(overlap ? GONE : VISIBLE);
        requestLayout();
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int w = MeasureSpec.getSize(widthSpec), h = MeasureSpec.getSize(heightSpec);
        int[][] r = Rules.split(mode, w, h, ratio, gap, expanded);
        for (int i = 0; i < 2; i++) {
            panes[i].measure(MeasureSpec.makeMeasureSpec(r[i][2], MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(r[i][3], MeasureSpec.EXACTLY));
        }
        divider.measure(MeasureSpec.makeMeasureSpec(mode == Rules.Mode.STACK ? w : gap, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(mode == Rules.Mode.STACK ? gap : h, MeasureSpec.EXACTLY));
        setMeasuredDimension(w, h);
    }

    @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
        int w = r - l, h = b - t;
        int[][] rects = Rules.split(mode, w, h, ratio, gap, expanded);
        for (int i = 0; i < 2; i++) panes[i].layout(rects[i][0], rects[i][1], rects[i][0] + rects[i][2], rects[i][1] + rects[i][3]);
        if (mode == Rules.Mode.STACK) divider.layout(0, rects[0][3], w, rects[0][3] + gap);
        else divider.layout(rects[0][2], 0, rects[0][2] + gap, h);
    }

    /** Faixa entre as contas: arrastar muda o tamanho, toque duplo centraliza. */
    private class Divider extends View {
        private final Paint grip = new Paint(Paint.ANTI_ALIAS_FLAG);
        private long lastTap;
        private boolean dragging;

        Divider(Context c) {
            super(c);
            grip.setColor(0xFF5B6B85);
            setBackgroundColor(0xFF273045);
        }

        @Override protected void onDraw(Canvas canvas) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f, d = getResources().getDisplayMetrics().density;
            grip.setColor(dragging ? 0xFF409EEC : 0xFF5B6B85);
            if (mode == Rules.Mode.STACK) canvas.drawRoundRect(cx - 24 * d, cy - 2 * d, cx + 24 * d, cy + 2 * d, 2 * d, 2 * d, grip);
            else canvas.drawRoundRect(cx - 2 * d, cy - 24 * d, cx + 2 * d, cy + 24 * d, 2 * d, 2 * d, grip);
        }

        @SuppressLint("ClickableViewAccessibility")
        @Override public boolean onTouchEvent(MotionEvent e) {
            StageLayout stage = StageLayout.this;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    long now = System.currentTimeMillis();
                    if (now - lastTap < 300) { listener.onDividerDoubleTap(); lastTap = 0; return true; }
                    lastTap = now;
                    dragging = true;
                    getParent().requestDisallowInterceptTouchEvent(true);
                    invalidate();
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float pos = mode == Rules.Mode.STACK ? e.getRawY() - stageTop() : e.getRawX() - stageLeft();
                    float size = mode == Rules.Mode.STACK ? stage.getHeight() : stage.getWidth();
                    ratio = Rules.clampRatio(pos / Math.max(1f, size));
                    listener.onRatioChanged(ratio, false);
                    stage.requestLayout();
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    dragging = false;
                    invalidate();
                    listener.onRatioChanged(ratio, true);
                    return true;
                default:
                    return super.onTouchEvent(e);
            }
        }

        private float stageTop() { int[] p = new int[2]; StageLayout.this.getLocationOnScreen(p); return p[1]; }
        private float stageLeft() { int[] p = new int[2]; StageLayout.this.getLocationOnScreen(p); return p[0]; }
    }
}
