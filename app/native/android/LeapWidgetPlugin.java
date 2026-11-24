package com.leapmore.app;

import android.content.Context;
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
    public void clear(PluginCall call) {
        storage(getContext()).edit().remove("snapshot").remove("at").apply();
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
