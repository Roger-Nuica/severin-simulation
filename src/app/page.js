import TornadoSimulator from './tornado/TornadoSimulator.js';
import PwaSupport from './tornado/PwaSupport.js';

// page.js stays a Server Component (no 'use client' here) — it does no
// rendering work of its own beyond delegating to TornadoSimulator, which is
// the piece that actually needs the browser (Three.js, DOM refs, Luigi
// Client). Keeping the boundary at TornadoSimulator instead of pushing
// 'use client' up to this file is the smallest possible client bundle.
export default function Page() {
  return (
    <>
      <TornadoSimulator />
      <PwaSupport />
    </>
  );
}
