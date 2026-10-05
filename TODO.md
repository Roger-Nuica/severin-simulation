# TODO

## Sounds the owner will provide

Drop each file into `public/sounds/` under exactly this name. The code is
already wired for it; until the file is there the game plays the fallback
listed (and the browser console shows one harmless 404 for the missing file).

| File | What it is for | Where it is played | Until it is added |
| --- | --- | --- | --- |
| `jetpack.mp3` | Roger's jetpack burn. It loops for as long as he flies (Space), so a seamless loop of 1–4 s works best. | `src/app/tornado/engine/sound/grappleJet.js` (`JET_URL`) | Silent (on request, 2026-10-05) |
| `patient-zero.mp3` | Patient Zero making a clone. Only its first 2 s are played, once per clone. | `src/app/tornado/engine/sound/replicator.js` (`CLONE_URL`) | The old synthesised cue |

Wanted but not wired to a file name yet (they use a synthesised stand-in;
send a file and it will be hooked up):

| Sound | Where it would go | Today |
| --- | --- | --- |
| Plasma rifle shot | `sound/hero.js` (`PLASMA_SAMPLE_URL`, now `null`) | Synthesised zap |
| "Get over here!" shout of the grappling hook | `sound/grappleJet.js` (`SHOUT_SAMPLE_URL`, now `null`) | Synthesised growl and the browser's speech voice |

## Checks only a person can make

- Look, sound and frame rate on a real phone and a real desktop: every
  change of 2026-10-05 was checked headless in Chromium (software
  rendering), which is not a visual or audio check.
