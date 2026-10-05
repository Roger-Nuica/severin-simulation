'use client';

import { useEffect, useState } from 'react';

/**
 * The install button is switched off for now (on request, 2026-10-05: the
 * lower corner shows the session clock instead). The service worker still
 * registers; set this to true to offer the install again.
 */
const OFFER_INSTALL = false;

/**
 * Registers the service worker (production only, so dev hot reload is not
 * cached) and shows an install button once the browser offers the install
 * prompt.
 *
 * @returns {import('react').JSX.Element | null} The install button, or null when not installable.
 */
export default function PwaSupport() {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed', err));
    }
    const onPrompt = (e) => {
      // Kept from showing the browser's own install bar too while switched off.
      e.preventDefault();
      if (OFFER_INSTALL) setInstallPrompt(e);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  /** @returns {Promise<void>} Resolves once the user answers the prompt. */
  const install = async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return installPrompt ? (
    <button className="pwa-install" type="button" onClick={install} aria-label="Install the app" title="Install the app">
      <span aria-hidden="true">📱</span><span className="pwa-label">Install App</span>
    </button>
  ) : null;
}
