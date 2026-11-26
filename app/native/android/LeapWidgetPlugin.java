package com.leapmore.app;

import android.content.Context;
import android.app.StatusBarManager;
import android.content.ComponentName;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LeapWidget")
public class LeapWidgetPlugin extends Plugin {
    static SharedPreferences storage(Context context) {
        return context.getSharedPreferences("leapmore.widget", Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject value = call.getObject("summary");
        if (value == null) { call.reject("缺少车况"); return; }
        storage(getContext()).edit().putString("snapshot", value.toString()).putLong("at", System.currentTimeMillis()).apply();
        LeapWidget.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void publishQuick(PluginCall call) {
        JSObject tiles = call.getObject("tiles");
        if (tiles == null) { call.reject("缺少磁贴配置"); return; }
        storage(getContext()).edit().putString("tiles", tiles.toString()).apply();
        VehicleTile.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void addTile(PluginCall call) {
        VehicleTile.Action action = VehicleTile.Action.byKey(call.getString("slot"));
        if (action == null) { call.reject("无效的磁贴"); return; }
        if (Build.VERSION.SDK_INT < 33) {
            call.resolve(new JSObject().put("message", "请在系统快捷设置的编辑面板添加磁贴。"));
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getContext().getSystemService(StatusBarManager.class).requestAddTileService(
                    new ComponentName(getContext(), action.service), action.title, Icon.createWithResource(getContext(), action.icon),
                    getContext().getMainExecutor(), result -> {
                        String message = result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ? "已添加到快捷设置" :
                            result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED ? "磁贴已在快捷设置中" : "未添加磁贴，可在系统快捷设置中添加";
                        call.resolve(new JSObject().put("message", message));
                    });
            } catch (RuntimeException failure) { call.reject("请在系统快捷设置中添加磁贴"); }
        });
    }

    @PluginMethod
    public void takeDemo(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            var prefs = storage(getContext());
            String effects = prefs.getString("quick-demo", "[]");
            prefs.edit().remove("quick-demo").apply();
            call.resolve(new JSObject().put("effects", effects));
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        storage(getContext()).edit().remove("snapshot").remove("at").remove("tiles").remove("quick-demo").apply();
        VehicleTile.refresh(getContext());
        LeapWidget.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void closeControl(PluginCall call) {
        if (getActivity() instanceof WidgetControlActivity activity) {
            call.resolve();
            activity.runOnUiThread(activity::finishAndRemoveTask);
        } else call.reject("当前没有桌面控车窗口");
    }
}
