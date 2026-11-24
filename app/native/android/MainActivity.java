package com.leapmore.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(LeapVaultPlugin.class);
        registerPlugin(LeapAuthPlugin.class);
        registerPlugin(LeapWidgetPlugin.class);
        registerPlugin(LeapSettingsPlugin.class);
        registerPlugin(LeapRecorderPlugin.class);
        super.onCreate(state);
        getWindow().getDecorView().post(() -> LeapWidget.publishPickerPreviews(this));
    }
}
