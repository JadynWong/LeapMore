package com.leapmore.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LeapVault")
public class LeapVaultPlugin extends Plugin {
    private static final String ALIAS = "leapmore.vault.v1";
    private static final String BIOMETRIC_PREFIX = "remote-control-biometric:";

    private SharedPreferences storage() {
        return getContext().getSharedPreferences("leapmore.vault", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (keys.containsAlias(ALIAS)) return (SecretKey) keys.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    @PluginMethod
    public synchronized void set(PluginCall call) {
        String id = call.getString("key"), value = call.getString("value");
        if (id == null || value == null) { call.reject("参数不完整"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "."
                + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!storage().edit().putString(id, encoded).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) { call.reject("安全存储写入失败"); }
    }

    @PluginMethod
    public synchronized void get(PluginCall call) {
        String id = call.getString("key");
        if (id == null || id.startsWith(BIOMETRIC_PREFIX)) { call.reject("无法读取安全存储"); return; }
        read(call, id);
    }

    private synchronized void read(PluginCall call, String id) {
        String value = storage().getString(id, null);
        if (value == null) { call.resolve(); return; }
        try {
            String[] fragments = value.split("\\.", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(fragments[0], Base64.NO_WRAP)));
            cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
            String decoded = new String(cipher.doFinal(Base64.decode(fragments[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("value", decoded));
        } catch (Exception ignored) { call.reject("安全存储读取失败"); }
    }

    @SuppressWarnings("deprecation")
    private boolean hasBiometrics() {
        if (Build.VERSION.SDK_INT < 28) return false;
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager manager = getContext().getSystemService(BiometricManager.class);
            return manager != null && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS;
        }
        FingerprintManager manager = getContext().getSystemService(FingerprintManager.class);
        return manager != null && manager.isHardwareDetected() && manager.hasEnrolledFingerprints();
    }

    @PluginMethod
    public void biometricsAvailable(PluginCall call) {
        call.resolve(new JSObject().put("available", hasBiometrics()));
    }

    @PluginMethod
    public void getWithBiometrics(PluginCall call) {
        String id = call.getString("key");
        if (id == null || !id.startsWith(BIOMETRIC_PREFIX)) { call.reject("无法读取操作密码"); return; }
        if (!storage().contains(id)) { call.resolve(); return; }
        if (Build.VERSION.SDK_INT < 28 || !hasBiometrics()) { call.reject("本机生物识别不可用"); return; }
        getActivity().runOnUiThread(() -> {
            var executor = getActivity().getMainExecutor();
            var finished = new AtomicBoolean();
            Runnable reject = () -> {
                if (finished.compareAndSet(false, true)) call.reject("生物识别未通过");
            };
            var prompt = new BiometricPrompt.Builder(getActivity()).setTitle("验证身份以控车")
                .setNegativeButton("改用操作密码", executor, (dialog, which) -> reject.run());
            if (Build.VERSION.SDK_INT >= 30) prompt.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            try {
                prompt.build().authenticate(new CancellationSignal(), executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        if (finished.compareAndSet(false, true)) read(call, id);
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) { reject.run(); }
                });
            } catch (RuntimeException ignored) { call.reject("本机生物识别不可用"); }
        });
    }

    @PluginMethod
    public synchronized void remove(PluginCall call) {
        String id = call.getString("key");
        if (id == null) { call.reject("参数不完整"); return; }
        if (storage().edit().remove(id).commit()) call.resolve();
        else call.reject("安全存储删除失败");
    }
}
