package com.finsight.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        registerPlugin(BiometricAuthPlugin.class);
        registerPlugin(FileExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
