'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker (production only, so dev hot reload is not
 * cached) and shows an install button once the browser offers the install
 * prompt.
 *
 * @returns {JSX.Element | null} The install button, or null when not installable.
 */
export default function PwaSupport() {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed', err));
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
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
    <button
      onClick={install}
      style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 1000, padding: '8px 14px', borderRadius: 8, border: 0, background: 'linear-gradient(180deg, #8ffff0, #2fd6bd)', color: '#04211c', fontWeight: 700, cursor: 'pointer' }}
    >
      📱 Install App
    </button>
  ) : null;
}
