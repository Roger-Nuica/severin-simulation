// Shared JSDoc types, visible in every engine file without an import, for
// `npx tsc -p jsconfig.json` (files marked // @ts-check) and the editor.

type SimObject = import('./src/app/tornado/engine/context.js').SimObject;
type DebrisKind = import('./src/app/tornado/engine/context.js').DebrisKind;
type Alien = import('./src/app/tornado/engine/aliens/config.js').Alien;
type Abductee = import('./src/app/tornado/engine/aliens/config.js').Abductee;

// Next inlines process.env.NODE_ENV at build time; there is no Node in the
// browser, and no @types/node in this project.
declare const process: { env: { NODE_ENV?: string; NEXT_PUBLIC_RELAY_URL?: string } };

declare module '*.css';

interface Window {
  /** Dev-only handle onto the running simulation (tornadoEngine.js). */
  __tornadoDebug?: { Sim: unknown, ctx: unknown };
}
