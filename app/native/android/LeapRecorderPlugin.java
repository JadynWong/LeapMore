package com.leapmore.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LeapRecorder")
public class LeapRecorderPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Context context = getContext();
            Intent service = new Intent(context, LeapRecordingService.class);
            service.putExtra("delay", call.getInt("delay", 60_000));
            try {
                LeapRecordingService.attach(this);
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
                else context.startService(service);
                call.resolve();
            } catch (RuntimeException ignored) { call.reject("无法开启后台车况轮询"); }
        });
    }

    @PluginMethod
    public void setDelay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LeapRecordingService.setDelay(this, call.getInt("delay", 60_000));
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopService();
            call.resolve();
        });
    }

    private void stopService() {
        if (LeapRecordingService.owns(this)) {
            getContext().stopService(new Intent(getContext(), LeapRecordingService.class));
        }
    }

    @Override
    protected void handleOnDestroy() { stopService(); }

    void poll() { notifyListeners("poll", new JSObject()); }

    void status(boolean running, String reason) {
        notifyListeners("status", new JSObject().put("running", running).put("reason", reason));
    }

    @PluginMethod
    public void clear(PluginCall call) {
        String vehicle = call.getString("vehicle", "");
        Context context = getContext();
        if (!context.getDatabasePath("leapmore-phone.db").exists()) { call.resolve(); return; }
        try (LeapRecordingStore db = new LeapRecordingStore(context)) {
            db.clear(vehicle);
            call.resolve();
        } catch (RuntimeException ignored) { call.reject("无法清理旧版定位采样"); }
    }
}
