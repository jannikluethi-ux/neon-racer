package com.neonracer.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PAUSE_KEY_EVENT =
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}))";
    private static final String BACKGROUND_EVENT =
        "window.dispatchEvent(new Event('neonracerbackground'))";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        allowIntroAutoplay();
        applyImmersiveMode();

        // Back never finishes the activity. Escape pauses a race, and the
        // cold-start film treats the same key as "skip".
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                evaluateInWebView(PAUSE_KEY_EVENT);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        allowIntroAutoplay();
    }

    @Override
    public void onPause() {
        evaluateInWebView(BACKGROUND_EVENT);
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    private void allowIntroAutoplay() {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView != null) webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
    }

    private void evaluateInWebView(String javascript) {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView != null) webView.evaluateJavascript(javascript, null);
    }

    @SuppressWarnings("deprecation")
    private void applyImmersiveMode() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }
}
