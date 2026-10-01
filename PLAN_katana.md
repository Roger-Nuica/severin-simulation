TASK: add a new melee weapon, the Katana, with directional slicing of aliens.

=====================================================
1. WEAPON SETUP
=====================================================
- Add "Katana" to the weapon wheel (mouse wheel switching, same as other weapons). Right-click draws/holsters it.
- No energy cost.
- Katana affects aliens only. Other enemies show a parry (metal clang, sparks) and take no damage, so existing immunity rules are not broken (Yeti, Terminator, T-Rex, etc.).
- Aliens in any state (walking, attacking, in a ship crew) are cuttable. UFOs and the mothership are not.

=====================================================
2. HOW ROGER HOLDS IT (visible in third person)
=====================================================
- Draw animation: Roger pulls the katana out of a sheath on his back/hip with a "shing" sound. Show the sheath on him while the weapon is not drawn.
- Idle stance: two-handed grip, blade held low/forward (a ready stance), with a slight breathing sway.
- Run animation while holding it: blade held back.
- Slash animations: vertical, horizontal and diagonal (both directions).
- Holster animation: the blade returns to the sheath.
- Blade has a thin glowing edge highlight and a light trail (swoosh) during slashes.

=====================================================
3. QUICK SLASH (click + swipe)
=====================================================
- Click and move the mouse (swipe) to slash. The swipe direction decides the cut direction: vertical, horizontal, or diagonal.
- Plain click without movement: automatic combo chain alternating diagonal, horizontal, vertical.
- Melee reach about 3 m, with a small auto-lunge toward the nearest alien in front (up to about 6 m) so it feels responsive.
- Short cooldown between slashes (about 0.35 s).

=====================================================
4. PRECISION CUT: BLADE MODE (hold click)
=====================================================
- Holding click for about 0.25 s enters Blade Mode: the world slows to about 10% speed (player slowed less so aiming stays responsive), the screen gets a subtle vignette and the aliens in range get a faint highlight.
- A glowing cut line follows the mouse. I drag it across an alien in any direction (vertical, horizontal, any diagonal).
- On release, Roger performs the cut along that line. The alien is sliced exactly along it.
- Within the same Blade Mode window I can make up to 3 cuts in a row on the same or different aliens (the world stays slowed until I release or time runs out, max about 4 seconds).
- Exit with Escape or by releasing without drawing a line.

=====================================================
5. SLICING TECHNIQUE (performance-friendly)
=====================================================
- Do NOT do real mesh boolean/geometry slicing. Use Three.js clipping planes:
  1. When an alien is cut, clone its mesh group.
  2. The original and the clone each get the same cutting plane with opposite sides clipped, so each shows one half.
  3. Add a cap on the cut surface: a glowing flat section in the alien's inner color (green/teal) aligned to the plane (stencil or simple plane approach).
  4. Each half becomes a simple physics piece with an impulse away from the cut line, a small spin, then fall, bounce and fade after about 6 seconds.
- Each piece may be cut again, up to 3 cuts per alien (up to about 8 pieces). Cap total live pieces in the scene (for example 60) and recycle the oldest.
- Spawn alien blood: green goo burst along the cut line, drips on the ground and splatter decals that fade. Use the shared particle pool.
- The cut line direction decides the plane (vertical cut = left/right halves, horizontal = top/bottom, diagonal = tilted).

=====================================================
6. FEEL
=====================================================
- Hit-stop of 3 to 5 frames on a successful cut. Small camera shake on cut, bigger on a multi-cut.
- A thin bright slash flash along the cut line.
- Sounds (procedural, same style as other weapons): draw "shing", whoosh per swing, a wet slice on hit, a clang on a parry, holster click.
- Cuts feed the existing combo/score system (a bonus for multi-cuts and for each extra piece cut).
- Aliens react: stagger before dying, pieces tumble.

=====================================================
7. PERFORMANCE
=====================================================
- Hold 60 FPS with 10+ aliens being cut in sequence. Respect the particle budget and entity caps.
- Dispose of cloned meshes and geometry when pieces fade.

=====================================================
GENERAL
=====================================================
- Update HUD (weapon name and hint text), weapon-switch notification, GAME_RULES.md.

=====================================================
TEST
=====================================================
1. Scroll to Katana, right-click: draw animation, katana visible in both hands.
2. Click with a vertical, horizontal, diagonal swipe: the alien is cut accordingly, halves fly apart with a glowing cut surface and green goo.
3. Hold click: Blade Mode, the cut line follows the mouse, release cuts along it. 2 to 3 cuts in a row work.
4. Each piece can be cut again, up to the cap. Pieces fade after about 6 s.
5. T-Rex, Yeti, Terminator: parry sparks, no damage. UFOs are not cuttable.
6. 10+ aliens cut in sequence: 60 FPS holds.