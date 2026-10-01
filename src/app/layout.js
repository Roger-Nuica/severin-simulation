import './tornado/tornado.css';

// Metadata rendered into <head> — this is the Next.js App Router
// replacement for a hand-written <title> tag; no client code needed for it.
export const metadata = {
  title: 'Simulator Tornadă',
  description: 'Interactive 3D tornado simulator built with Three.js',
};

// RootLayout is a Server Component (no 'use client') — this app has only
// one page, so it just provides the <html>/<body> shell and the global
// stylesheet.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#4A9EFF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Tornado Simulator" />
        <link rel="apple-touch-icon" href="/tornado-icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/tornado-icon-192.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
