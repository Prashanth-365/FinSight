package com.finsight.app

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "BiometricAuth")
class BiometricAuthPlugin : Plugin() {

    private val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG

    /** Report whether a fingerprint / face can be used right now. */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val mgr = BiometricManager.from(context)
        val status = mgr.canAuthenticate(authenticators)
        val ret = JSObject()
        ret.put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
        ret.put("reason", reasonFor(status))
        call.resolve(ret)
    }

    /** Show the system biometric prompt; resolves { verified: true } on success. */
    @PluginMethod
    fun authenticate(call: PluginCall) {
        val activity = activity as? FragmentActivity
        if (activity == null) {
            call.reject("No activity available for biometric prompt.")
            return
        }
        val mgr = BiometricManager.from(context)
        if (mgr.canAuthenticate(authenticators) != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Biometric authentication is not available.")
            return
        }

        val title = call.getString("title") ?: "Unlock FinSight"
        val subtitle = call.getString("subtitle") ?: "Confirm your identity"
        val negative = call.getString("negativeButtonText") ?: "Cancel"

        activity.runOnUiThread {
            val executor = ContextCompat.getMainExecutor(context)
            val prompt = BiometricPrompt(activity, executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        val ret = JSObject()
                        ret.put("verified", true)
                        call.resolve(ret)
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        // User cancelled / lockout / hardware error — report cleanly.
                        val ret = JSObject()
                        ret.put("verified", false)
                        ret.put("errorCode", errorCode)
                        ret.put("error", errString.toString())
                        call.resolve(ret)
                    }
                    // onAuthenticationFailed (a single bad read) is intentionally
                    // not terminal — the prompt stays open for another try.
                })

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(negative)
                .setAllowedAuthenticators(authenticators)
                .setConfirmationRequired(false)
                .build()

            prompt.authenticate(info)
        }
    }

    private fun reasonFor(status: Int): String = when (status) {
        BiometricManager.BIOMETRIC_SUCCESS -> "available"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no-hardware"
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "hardware-unavailable"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none-enrolled"
        else -> "unavailable"
    }
}
