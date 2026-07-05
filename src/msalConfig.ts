// src/msalConfig.ts — MSAL config for "Sign in with Microsoft" staff login on
// the web deployment (pdf.bcim.in). Reuses the same Azure app registration as
// SendDrive/OneDrive/Graph, with a Single-page application platform + redirect
// URI added in Azure Portal for this app's URL.
//
// IMPORTANT CAVEAT: this app has no backend of its own, so this check is
// enforced entirely client-side — a technically sophisticated person could
// bypass it by editing the served JS. What it DOES guarantee is that getting
// past the login screen requires a real, valid company Microsoft account
// (MSAL talks to Microsoft's actual login servers), which stops casual/
// opportunistic access by anyone who just finds the URL. The Electron desktop
// build skips this gate entirely (see App.tsx) since it only runs on
// already-managed company machines.
export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID as string,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage' as const,
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};
