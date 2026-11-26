package com.leapmore.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONObject;

@CapacitorPlugin(name = "LeapSettings")
public class LeapSettingsPlugin extends Plugin {
    @PluginMethod
    public void diagnosticEnvironment(PluginCall call) {
        JSObject facts = new JSObject().put("os", "Android " + Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("internetPermission", getContext().checkSelfPermission(android.Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED);
        if (Build.VERSION.SDK_INT >= 26) {
            android.content.pm.PackageInfo webView = android.webkit.WebView.getCurrentWebViewPackage();
            if (webView != null) facts.put("webViewVersion", webView.versionName);
        }
        try {
            android.net.ConnectivityManager network = getContext().getSystemService(android.net.ConnectivityManager.class);
            android.net.Network active = network.getActiveNetwork();
            android.net.NetworkCapabilities caps = network.getNetworkCapabilities(active);
            facts.put("activeNetwork", active != null);
            if (caps != null) {
                facts.put("wifi", caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI))
                    .put("cellular", caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR))
                    .put("ethernet", caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET))
                    .put("vpn", caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN))
                    .put("validated", caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED))
                    .put("captivePortal", caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));
            }
        } catch (SecurityException unavailable) { /* OS version remains available independently. */ }
        call.resolve(facts);
    }

    private ComponentName launcher(String name) {
        return new ComponentName(getContext(), MainActivity.class.getPackage().getName() + ".Launcher" + name);
    }

    @PluginMethod
    public void getAppIcon(PluginCall call) {
        int original = getContext().getPackageManager().getComponentEnabledSetting(launcher("Original"));
        String icon = original == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ? "original" : "simple";
        call.resolve(new JSObject().put("icon", icon).put("canChange", true));
    }

    @PluginMethod
    public void setAppIcon(PluginCall call) {
        String icon = call.getString("icon", "");
        if (!"simple".equals(icon) && !"original".equals(icon)) { call.reject("应用图标无效"); return; }
        boolean useOriginal = "original".equals(icon);
        ComponentName enable = launcher(useOriginal ? "Original" : "Simple");
        ComponentName disable = launcher(useOriginal ? "Simple" : "Original");
        PackageManager manager = getContext().getPackageManager();
        int flags = PackageManager.DONT_KILL_APP;
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                manager.setComponentEnabledSettings(Arrays.asList(
                    new PackageManager.ComponentEnabledSetting(enable, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, flags),
                    new PackageManager.ComponentEnabledSetting(disable, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, flags)));
            } else {
                int previous = manager.getComponentEnabledSetting(enable);
                manager.setComponentEnabledSetting(enable, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, flags);
                try {
                    manager.setComponentEnabledSetting(disable, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, flags);
                } catch (RuntimeException failed) {
                    manager.setComponentEnabledSetting(enable, previous, flags);
                    throw failed;
                }
            }
            call.resolve();
        } catch (RuntimeException failed) { call.reject("系统未能切换应用图标"); }
    }

    @PluginMethod
    public void openAmap(PluginCall call) {
        Uri app = Uri.parse(call.getString("app", ""));
        Uri web = Uri.parse(call.getString("web", ""));
        if (!"amapuri".equals(app.getScheme()) || !"route".equals(app.getHost()) || !"/plan/".equals(app.getPath())
            || !"https".equals(web.getScheme()) || !"uri.amap.com".equals(web.getHost()) || !"/navigation".equals(web.getPath())) {
            call.reject("导航地址无效");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, app).setPackage("com.autonavi.minimap"));
                call.resolve();
            } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
                try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, web)); call.resolve(); }
                catch (RuntimeException ignored) { call.reject("无法打开高德地图"); }
            }
        });
    }

    @PluginMethod
    public void checkBackground(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            NotificationManager notifications = getContext().getSystemService(NotificationManager.class);
            NotificationChannel channel = Build.VERSION.SDK_INT >= 26
                ? notifications.getNotificationChannel(LeapRecordingService.CHANNEL) : null;
            PowerManager power = getContext().getSystemService(PowerManager.class);
            ActivityManager activity = getContext().getSystemService(ActivityManager.class);
            call.resolve(new JSObject()
                .put("manufacturer", Build.MANUFACTURER).put("brand", Build.BRAND)
                .put("sdk", Build.VERSION.SDK_INT).put("release", Build.VERSION.RELEASE)
                .put("notifications", notifications.areNotificationsEnabled()
                    && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE))
                .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(getContext().getPackageName()))
                .put("backgroundRestricted", Build.VERSION.SDK_INT >= 28 ? activity.isBackgroundRestricted() : JSONObject.NULL)
                .put("powerSave", power.isPowerSaveMode()).put("recording", LeapRecordingService.isRunning()));
        });
    }

    @PluginMethod
    public void saveCsv(PluginCall call) { saveText(call); }

    @PluginMethod
    public void saveText(PluginCall call) {
        String name = call.getString("name", "");
        if (!name.matches("[a-zA-Z0-9_-]+\\.(?:csv|txt)") || call.getString("text") == null) {
            call.reject("文件名或文本无效");
            return;
        }
        chooseDocument(call, name, name.endsWith(".txt") ? "text/plain" : "text/csv");
    }

    @PluginMethod
    public void saveRewardImage(PluginCall call) {
        chooseDocument(call, "LeapMore-微信赞赏码.png", "image/png");
    }

    private void chooseDocument(PluginCall call, String name, String mimeType) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.setType(mimeType);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try { startActivityForResult(call, intent, "writeDocument"); }
        catch (RuntimeException ignored) { call.reject("无法打开系统保存窗口"); }
    }

    @ActivityCallback
    private void writeDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri target = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || target == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(target, "wt")) {
            if (output == null) throw new IllegalStateException("Missing output stream");
            if ("saveRewardImage".equals(call.getMethodName())) {
                try (InputStream input = getContext().getAssets().open("public/assets/wechat-reward-qr.png")) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
            } else {
                output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { call.reject("无法写入文件"); return; }
        call.resolve(new JSObject().put("saved", true));
    }

    @PluginMethod
    public void open(PluginCall call) {
        String target = call.getString("target", "app");
        Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        Intent intent = app;
        if ("notifications".equals(target)) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else if ("battery".equals(target)) {
            intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        }
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (RuntimeException ignored) {
            try { getActivity().startActivity(app); call.resolve(); }
            catch (RuntimeException failed) { call.reject("无法打开系统设置"); }
        }
    }
}
