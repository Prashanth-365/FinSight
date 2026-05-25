// Google Sign-In via Google Identity Services (ID token / "Sign in with Google" button).
// Reuses the same OAuth Client ID configured for Drive sync — no extra console setup.
// We do NOT validate the JWT signature locally; for a client-only PWA where the `sub`
// is used as a local identifier (not as authorization to a server), this is acceptable.
// We do validate iss / aud / exp claims.

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let _gisReady = null;
let _currentClientId = null;
let _callback = null;

function loadGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(s);
  });
  return _gisReady;
}

function decodeJwt(token) {
  const seg = token.split('.')[1];
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return JSON.parse(json);
}

function validateClaims(claims, clientId) {
  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new Error('Google sign-in: bad issuer.');
  }
  if (claims.aud !== clientId) {
    throw new Error('Google sign-in: token audience does not match this Client ID.');
  }
  if (Number(claims.exp) * 1000 < Date.now()) {
    throw new Error('Google sign-in: token expired. Please try again.');
  }
  return claims;
}

/**
 * Initialise the GIS client and render the official "Sign in with Google" button
 * into the given DOM element. Calls `onCredential({ sub, email, name, picture })` on success.
 */
export async function renderSignInButton(element, clientId, onCredential, onError) {
  if (!element) return;
  if (!clientId) throw new Error('Google OAuth Client ID required.');
  await loadGis();

  _callback = (resp) => {
    try {
      if (!resp?.credential) throw new Error('Google did not return a credential.');
      const claims = validateClaims(decodeJwt(resp.credential), clientId);
      onCredential?.({
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        picture: claims.picture,
        givenName: claims.given_name,
        emailVerified: !!claims.email_verified
      });
    } catch (e) {
      onError?.(e);
    }
  };

  // (Re-)initialise only when client id changes
  if (_currentClientId !== clientId) {
    _currentClientId = clientId;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (r) => _callback?.(r),
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
      use_fedcm_for_prompt: true
    });
  }

  element.innerHTML = '';
  const dark = document.documentElement.classList.contains('dark');
  window.google.accounts.id.renderButton(element, {
    type: 'standard',
    theme: dark ? 'filled_black' : 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    width: element.offsetWidth || 320
  });
}

/** Programmatic prompt (One Tap). Optional — the rendered button is enough. */
export async function promptOneTap(clientId, onCredential, onError) {
  if (!clientId) return;
  await loadGis();
  if (_currentClientId !== clientId) {
    _currentClientId = clientId;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (r) => {
        try {
          const claims = validateClaims(decodeJwt(r.credential), clientId);
          onCredential?.(claims);
        } catch (e) {
          onError?.(e);
        }
      },
      auto_select: false,
      use_fedcm_for_prompt: true
    });
  }
  window.google.accounts.id.prompt();
}

export async function signOutGoogle() {
  if (window.google?.accounts?.id) {
    try { window.google.accounts.id.disableAutoSelect(); } catch {}
  }
}
