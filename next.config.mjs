/** @type {import('next').NextConfig} */
const nextConfig = {
  // Luigi loads this app inside an <iframe> (see luigi-shell's
  // navigation.js entryPoint for tornado). Next.js does NOT set
  // `X-Frame-Options` or a restrictive Content-Security-Policy by default,
  // so no override is actually needed here — but that fact is easy to
  // break by accident later (e.g. a future security-hardening pass that
  // adds a blanket `X-Frame-Options: DENY` header, or a CSP with no
  // `frame-ancestors` directive, which defaults to allowing framing but is
  // often mistakenly tightened). This empty headers() function exists as a
  // deliberate, documented anchor point:
  //   - If X-Frame-Options is ever added here, it must NOT be
  //     'DENY'/'SAMEORIGIN' (that would block the Luigi shell's iframe).
  //   - If a Content-Security-Policy header is ever added here, it must
  //     include `frame-ancestors http://localhost:4200` (the luigi-shell
  //     dev origin) rather than defaulting to 'none' or 'self'.
  // Verify with: curl -sI http://localhost:3000 | grep -i frame
  // (expect no output — no framing-blocking header present).
  async headers() {
    return [];
  },
};

export default nextConfig;
