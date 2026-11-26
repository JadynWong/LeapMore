package com.leapmore.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Kept in the service process so a suspended WebView cannot hide a native tick. */
final class RecordingDiagnostics {
    private static final long HOUR = 3_600_000L;
    private final SharedPreferences prefs;
    private final String scope;
    private final JSONArray sessions;

    static boolean valid(String scope) { return scope != null && scope.matches("[0-9a-f]{32}"); }

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences("recording-diagnostics", Context.MODE_PRIVATE);
    }

    static JSONArray read(Context context, String scope) {
        if (valid(scope)) {
            try { return new JSONArray(store(context).getString(scope, "[]")); }
            catch (JSONException ignored) {}
        }
        return new JSONArray();
    }

    static JSONArray report(Context context, String scope) {
        JSONArray rows = read(context, scope);
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            int pid = row.optInt("pid");
            row.remove("pid");
            if (Build.VERSION.SDK_INT < 30 || pid <= 0 || row.has("stoppedAt")) continue;
            JSONObject next = rows.optJSONObject(i + 1);
            long end = next == null ? System.currentTimeMillis() : next.optLong("startedAt");
            long last = row.optLong("lastTickAt", row.optLong("startedAt"));
            try {
                ActivityManager manager = context.getSystemService(ActivityManager.class);
                // The OS returns most recent first. Retain the earliest matching death after the last heartbeat.
                for (ApplicationExitInfo exit : manager.getHistoricalProcessExitReasons(context.getPackageName(), pid, 16)) {
                    long at = exit.getTimestamp();
                    if (at < last || at > end || !context.getPackageName().equals(exit.getProcessName())) continue;
                    row.put("processExitAt", at).put("processExitReason", exit.getReason());
                    end = at;
                }
            } catch (RuntimeException | JSONException unavailable) { /* Exit history is optional on OEM builds. */ }
        }
        return rows;
    }

    RecordingDiagnostics(Context context, String scope, int delay) {
        this.scope = scope;
        prefs = store(context);
        sessions = read(context, scope);
        while (sessions.length() >= 4) sessions.remove(0);
        try {
            sessions.put(new JSONObject().put("pid", Process.myPid()).put("startedAt", System.currentTimeMillis()).put("delayMs", delay)
                .put("ticks", 0).put("hours", new JSONArray()));
            save();
        } catch (JSONException ignored) {}
    }

    void tick(int delay) {
        try {
            JSONObject session = sessions.getJSONObject(sessions.length() - 1);
            long now = System.currentTimeMillis();
            long previous = session.optLong("lastTickAt", session.getLong("startedAt"));
            long gap = Math.max(0, now - previous);
            if (gap > session.optLong("maxGapMs")) session.put("maxGapMs", gap).put("maxGapEndedAt", now);
            session.put("lastTickAt", now).put("delayMs", delay).put("ticks", session.optLong("ticks") + 1);
            JSONArray hours = session.getJSONArray("hours");
            long hour = now / HOUR * HOUR;
            JSONObject bucket = hours.optJSONObject(hours.length() - 1);
            if (bucket == null || bucket.optLong("at") != hour) {
                bucket = new JSONObject().put("at", hour);
                hours.put(bucket);
            }
            while (hours.length() > 48) hours.remove(0);
            bucket.put("ticks", bucket.optLong("ticks") + 1);
            save();
        } catch (JSONException ignored) {}
    }

    void stop(String reason) {
        try {
            sessions.getJSONObject(sessions.length() - 1).put("stoppedAt", System.currentTimeMillis()).put("reason", reason);
            save();
        } catch (JSONException ignored) {}
    }

    private void save() {
        if (valid(scope)) prefs.edit().putString(scope, sessions.toString()).apply();
    }
}
