package com.leapmore.app;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "LeapAuth")
public class LeapAuthPlugin extends Plugin {
    private static final String PATH = "/leapmore-ha";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timeout = Executors.newSingleThreadScheduledExecutor();
    private ServerSocket listener;
    private String callback;

    @PluginMethod
    public synchronized void begin(PluginCall call) {
        String state = call.getString("state");
        if (state == null || !state.matches("[a-f0-9]{64}")) { call.reject("授权参数无效"); return; }
        close(listener);
        callback = null;
        try {
            final ServerSocket server = new ServerSocket(0, 3, InetAddress.getByName("127.0.0.1"));
            listener = server;
            String redirect = "http://127.0.0.1:" + server.getLocalPort() + PATH;
            timeout.schedule(() -> close(server), 10, TimeUnit.MINUTES);
            io.execute(() -> serve(server, redirect, state));
            call.resolve(new JSObject().put("redirect", redirect));
        } catch (IOException ignored) { call.reject("无法启动授权回调"); }
    }

    private void serve(ServerSocket server, String redirect, String state) {
        try {
            while (!server.isClosed()) {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(3000);
                    String line = readLine(socket);
                    String[] spans = line.split(" ");
                    boolean valid = spans.length == 3 && "GET".equals(spans[0]) && spans[1].startsWith(PATH + "?");
                    String candidate = valid ? redirect + spans[1].substring(PATH.length()) : "";
                    Uri uri = Uri.parse(candidate);
                    valid = valid && state.equals(uri.getQueryParameter("state"))
                        && (uri.getQueryParameter("code") != null || uri.getQueryParameter("error") != null);
                    if (valid) {
                        synchronized (this) {
                            if (listener != server) return;
                            callback = candidate;
                        }
                    }
                    String html = valid ? "<meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>返回 LeapMore</title><p><a href='intent://ha-auth#Intent;scheme=com.leapmore.app;package=com.leapmore.app;end'>返回 LeapMore</a></p><p>也可以关闭授权窗口返回应用。</p>" : "Not found";
                    byte[] body = html.getBytes(StandardCharsets.UTF_8);
                    String response = "HTTP/1.1 " + (valid ? "200 OK" : "404 Not Found") + "\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(body);
                    if (valid) break;
                } catch (IOException ignored) {
                    if (server.isClosed()) return;
                }
            }
        } finally { close(server); }
    }

    private static String readLine(Socket socket) throws IOException {
        ByteArrayOutputStream value = new ByteArrayOutputStream();
        for (int i = 0; i < 8192; i++) {
            int c = socket.getInputStream().read();
            if (c < 0 || c == '\n') return value.toString(StandardCharsets.US_ASCII.name()).trim();
            value.write(c);
        }
        return "";
    }
    private static void close(ServerSocket socket) {
        if (socket != null) try { socket.close(); } catch (IOException ignored) {}
    }

    @PluginMethod
    public synchronized void take(PluginCall call) {
        JSObject result = new JSObject();
        if (callback != null) result.put("url", callback);
        callback = null;
        call.resolve(result);
    }

    @Override
    protected synchronized void handleOnDestroy() {
        close(listener);
        io.shutdownNow();
        timeout.shutdownNow();
        callback = null;
    }
}
