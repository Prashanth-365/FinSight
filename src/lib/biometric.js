// JS bridge to the native BiometricAuth plugin (fingerprint / face unlock).
// On the web there's no platform biometric here, so everything reports
// "unavailable" and callers fall back to no-lock.
import { Capacitor, registerPlugin } from '@capacitor/core';

const BiometricAuth = registerPlugin('BiometricAuth', {
  web: () => ({
    isAvailable: async () => ({ available: false, reason: 'not-native' }),
    authenticate: async () => ({ verified: false, error: 'not-native' })
  })
});

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';

export async function biometricAvailable() {
  if (!isNativeAndroid()) return { available: false, reason: 'not-native' };
  try {
    return await BiometricAuth.isAvailable();
  } catch (e) {
    return { available: false, reason: e?.message ?? 'error' };
  }
}

export async function biometricAuthenticate(opts = {}) {
  if (!isNativeAndroid()) return false;
  try {
    const r = await BiometricAuth.authenticate({
      title: opts.title ?? 'Unlock FinSight',
      subtitle: opts.subtitle ?? 'Confirm your identity to continue',
      negativeButtonText: opts.negativeButtonText ?? 'Cancel'
    });
    return !!r?.verified;
  } catch {
    return false;
  }
}
