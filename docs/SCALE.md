# The scale of everything

One world unit is **one metre**. Every size in the game is decided in one
file, `src/app/tornado/engine/scale.js`. This page is its overview: what each
element measured when it was audited, what the real thing measures, and what
was chosen, with the reason.

## The rule (so the next size is predictable)

1. Start from the real thing, in metres. A person is 1.8 m, a storey 3.2 m,
   a car 4.5 m.
2. Depart from it only for a stated game reason, by a factor written in
   `scale.js`. Examples: readability from the default camera, or a character
   meant to tower over everyone.
3. Anything sized against a person is derived from `PERSON.height`, never
   typed in. That covers a speech bubble's height, a collision width, a
   camera distance and an eye height.

## What was wrong (the audit, 2026-10-01)

The people were drawn at **3.04×** (`PERSON_SCALE`), which made them
**5.5 m tall**, "for visual impact". Everything built at life size beside
them looked like a toy:

- the bicycles (1.7 m);
- the houses (3.4–4.6 m to the eaves, shorter than a bystander);
- Hank Granite (2.95 m).

Everything built to match the giants was out of proportion with the town:

- the chase car, drawn at 3×, is 11.4 m long;
- Roger runs at 22 m/s;
- the Terminator is 8 m tall.

Some characters overrode the person scale and ended up *smaller* than the
crowd they were meant to tower over:

- Patient Zero is 1.3× a life-size figure (2.4 m against 5.5 m bystanders);
- the Cyber Yeti is 5 m.

## The table

| Element | Measured | Real | Chosen | Why |
|---|---|---|---|---|
| **Person** | 5.5 m (3.04×) | 1.6–1.9 m | **1.8 m** | The yardstick. |
| Person walk / run | 1.3–1.9 / 3.4–4.8 m/s | 1.4 / 5–6 m/s | unchanged | Already real. |
| Roger | ~5.6 m, runs 22 m/s | — | **1.85 m**, ~9 m/s | A person; a hero's sprint. |
| Hank Granite | 2.95 m | — | **2.2 m** | Larger than life, but a man. |
| Terminator | 8.0 m (person × 1.45) | 1.88 m | **2.1 m** | A head over the crowd. |
| Aliens | 5.2 m (person × 0.95) | — | **1.4 m** | The classic small grey. |
| Smooth Criminal dancer | 7.4 m (person × 1.35) | 1.75 m | **1.9 m** | On a stage, so a little more. |
| Patient Zero | 2.4 m | — | **2.3 m** | "A head taller than anyone": now true. |
| Cyber Yeti | 5 m | 2.5–3 m (legend) | **15 m** (was 3.5 m) | A giant, on request: over the houses, as tall as a townhouse. Walks 7.5 m/s, reach 9.4 m, cold gun 55 m. |
| Cyber T-Rex | 15 m | 4 m at hips, 12–13 m long | **18 m tall, 39 m long** (was 6 m) | A giant, in the Yeti's class. Walks 7.3 m/s, flame 60 m, crush 7.5 m. |
| Giant's numbers | — | — | **reach and ranges × size, speed × √size** | `GIANT.ratio`: a bigger animal's stride is longer, not quicker (Froude). The flame stops at 60 m, not 90, so it does not reach across half the town. |
| Captain Spotless | 26 m | — | **30 m** | A giant of light, over the tallest block. |
| Cow | 2 m body | 2.4 m long, 1.5 m tall | **2.4 × 1.5 m** | Real. |
| Shark | ~4 m | 3–6 m | **4.5 m** | A big one. |
| **House** | 5–7 × 5.5–7.5 m, 3.4–4.6 m tall | 9–12 m wide, 1–2 storeys | **8–10.5 × 7.5–9.5 m, 1–2 storeys + roof** | Real; fits the 22 m grid. |
| Townhouse | 6–11 m wide, 5–11 m tall | 3–4 storeys | **8–11 m wide, 3–4 storeys** | Real. |
| Apartment block | 7–10 m wide, 14–22 m tall | 6–9 storeys | **9.5–11.5 m wide, 6–9 storeys (19–29 m)** | Real, within the grid. |
| Shop | 9–12 m wide, 4–5.5 m tall | one tall storey | **11–13 m wide, 4.5 m** | Real, within the grid. |
| Storey | — | 3–3.3 m | **3.2 m** | One row of real 1.1 × 1.4 m windows per storey. |
| Footprint room | — | — | **half the gap to each neighbour, less 1.25 m** | No two buildings overlap (environment/index.js). |
| Parked car | 3.8 × 1.8 m | 4.5 × 1.8 m | **4.5 × 1.8 × 1.45 m** | Real. |
| Chase car | 11.4 m (3×) | 4.5 m | **4.5 m (1×)** | A car. |
| Bicycle | 1.7 m, wheel 0.68 m | same | unchanged | Already real. |
| Hydrant, sign, bin | 0.8 m, 2.3 m, — | same | unchanged | Already real. |
| Trees | 5.8–9.1 m | 6–15 m | unchanged | Real for town trees. |
| Fuel tanker | — | 16 × 2.5 × 3.8 m | real | |
| **Tornado radius** | 20 m (slider 6–30) | 50–500 m across | **30 m (slider 10–50)** | 60 m wide takes a block at a time in a ~180 m town. |
| Funnel height | 46 m to the cloud deck | to cloud base | follows the cloud deck | Kept joined to the deck. |
| Meteors | 9.6–13.8 m rocks, 30–44 m craters | — | unchanged | Already town-scale. |
| Volcano | 32 m tall, 76 m across | — | **50 m tall, 90 m across** | Stands over the 29 m blocks. |
| Dam | 34 m tall, 260 m long | 30–200 m | unchanged | Real; now a closed basin. |
| UFO / mothership | saucer r 15 m / r 105 m | — | unchanged | Already huge. |

## Done (2026-10-01)

All five steps are in. People are life-size, buildings have real storeys, and
the characters, the tornado and the volcano follow the table above. Every
number in the table is read from `engine/scale.js`. The visible effects:

- **Roger's camera** sits at a man's distance (6 m back, 3.2 m up) and is
  pulled in when a building stands behind him.
- **Roger** runs at 9 m/s; the Terminators walk at 2.4 m/s.
- **The ships' laser** crawls at 5 m/s.

`?bench=1&render=0` CPU is about the same: heavy 5.08 ms and hero 5.00 ms,
against 4.90 and 4.87 ms before, on the same container. The fingerprints
change, since the whole town changed (see the findings in PROJECT_HISTORY.md).

## The steps (as planned)

0. **This one.** The basin round the dam. The scale file and this table.
1. **People to life size.** Set `PERSON_SCALE` from `PERSON.height`. Derive
   every number tuned against a 5.5 m figure from it:
   - speech bubbles and dazed stars;
   - collision widths and spacing in `peopleMotion`;
   - Roger's eye height, camera and run speed;
   - the abduction beam and the kill-cam framing.

   The chase car goes to 1×.
2. **Buildings to real storeys**, within the street grid's footprints. Also
   the windows on a 3.2 m grid and the backdrop town to match.
3. **Characters** to the table: Hank, Terminator, aliens, dancer, Patient
   Zero, Yeti, T-Rex, Spotless. Their hitboxes and cameras go with them.
4. **The storm and the disasters**: the tornado's radius and slider, then the
   lift capacities against the new sizes. Also the volcano.
5. **Check the whole game** with a screenshot per area, and record the
   fingerprints and timings in the findings of PROJECT_HISTORY.md.
