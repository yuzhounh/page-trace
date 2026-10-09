package com.pagetrace.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.webkit.*;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.graphics.Color;
import android.view.HapticFeedbackConstants;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.credentials.*;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.*;
import com.google.android.libraries.identity.googleid.*;
import org.json.JSONObject;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String HOME = ORIGIN + "/assets/index.html";
    private WebView web;
    private FrameLayout content;
    private boolean ready;
    private boolean signingIn;
    private JSONObject pendingShare;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(248, 250, 252));
        web = new WebView(this);
        content.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // Resize the WebView itself: padding on WebView does not move fixed HTML overlays.
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int handledTypes = WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime();
            Insets safe = insets.getInsets(handledTypes);
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            // Dispatch zero handled insets so WebView cannot apply the same space twice.
            return new WindowInsetsCompat.Builder(insets)
                    .setInsets(handledTypes, Insets.NONE).build();
        });
        setContentView(content);
        WindowCompat.getInsetsController(getWindow(), content).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), content).setAppearanceLightNavigationBars(true);
        ViewCompat.requestApplyInsets(content);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOME.equals(uri.toString())) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception e) { Toast.makeText(MainActivity.this, "未找到可打开链接的浏览器", Toast.LENGTH_LONG).show(); }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm()).setCancelable(false).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel()).setCancelable(false).show();
                return true;
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            new AlertDialog.Builder(this).setMessage("请更新 Android System WebView 或 Chrome 后再使用 PageTrace。")
                    .setPositiveButton("关闭", (d, w) -> finish()).setCancelable(false).show();
            return;
        }
        WebViewCompat.addWebMessageListener(web, "PageTraceNative", Collections.singleton(ORIGIN),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !ORIGIN.equals(origin.toString())) return;
                String data = message.getData();
                if (data == null) return;
                if ("ready".equals(data)) { ready = true; deliverShare(); }
                else if ("signIn".equals(data)) signIn();
                else if ("haptic".equals(data)) web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                else if (data.startsWith("theme:")) applyTheme(data);
                else if (data.startsWith("share:")) shareText(data.substring(6));
            });
        if (state != null) {
            if (state.containsKey("pendingShare")) {
                try { pendingShare = new JSONObject(state.getString("pendingShare")); } catch (Exception ignored) { }
            }
        } else receiveShare(getIntent());
        web.loadUrl(HOME);
    }

    private void receiveShare(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        try {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text == null || text.length() == 0) return;
            pendingShare = new JSONObject().put("text", text.toString()).put("title", subject == null ? "" : subject);
            deliverShare();
        } catch (Exception e) { Toast.makeText(this, "无法读取分享内容，请复制链接后新建速记", Toast.LENGTH_LONG).show(); }
    }

    private void deliverShare() {
        if (!ready || pendingShare == null) return;
        JSONObject shared = pendingShare;
        web.evaluateJavascript("window.PageTraceAndroid.receive(" + shared.toString() + ")", result -> {
            if ("true".equals(result) && pendingShare == shared) pendingShare = null;
        });
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); receiveShare(intent); }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (pendingShare != null) state.putString("pendingShare", pendingShare.toString());
        // The web form persists its draft; do not re-import the original share on rotation.
        getIntent().setAction(Intent.ACTION_MAIN);
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.PageTraceAndroid && window.PageTraceAndroid.back()", handled -> {
            if (!"true".equals(handled)) super.onBackPressed();
        });
    }
    // "theme:<light|dark>:<#rrggbb>" keeps system bars and the window background in step with the page theme.
    private void applyTheme(String data) {
        String[] parts = data.split(":");
        if (parts.length != 3) return;
        boolean dark = "dark".equals(parts[1]);
        try { content.setBackgroundColor(Color.parseColor(parts[2])); } catch (IllegalArgumentException ignored) { }
        androidx.core.view.WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), content);
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
    private void shareText(String text) {
        if (text.isEmpty()) return;
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(send, "分享笔记"));
    }
    private void signIn() {
        if (signingIn) return;
        signingIn = true;
        try {
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(getString(R.string.default_web_client_id)).build();
            CredentialManager.create(this).getCredentialAsync(this,
                new GetCredentialRequest.Builder().addCredentialOption(option).build(),
                new CancellationSignal(), this::runOnUiThread,
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse response) {
                        signingIn = false;
                        try {
                            Credential credential = response.getCredential();
                            if (!(credential instanceof CustomCredential) || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType()))
                                throw new IllegalStateException("Google 返回了无法识别的凭据");
                            String token = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                            web.evaluateJavascript("window.PageTraceAndroid.signedIn(" + JSONObject.quote(token) + ")", null);
                        } catch (Exception e) { authError(e.getMessage()); }
                    }
                    @Override public void onError(GetCredentialException error) {
                        signingIn = false;
                        authError(error instanceof NoCredentialException
                            ? "未找到 Google 账号。请先在手机设置中添加 Google 账号，并确认 Google Play 服务可用。"
                            : "登录未完成，请重试：" + error.getMessage());
                    }
                });
        } catch (Exception e) { signingIn = false; authError(e.getMessage()); }
    }
    private void authError(String message) {
        web.evaluateJavascript("alert(" + JSONObject.quote(message == null ? "Google 登录失败" : message) + ")", null);
    }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
