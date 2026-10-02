# Implementation rules and gameplay contracts

The runtime code is the source of truth for implemented behaviour. `.claude/rules.md` indexes the numeric contracts verified in the code, while `GAME_DESIGN.md` describes the experience and keeps the historical notes. When the documentation differs from the code, bring the documentation into line with the runtime value; do not change the code's behaviour in a documentation task.

## HARD rules

### R-001 — Roger's critical safety from the tornado
**Rule:** Never let the tornado kill Roger. The tornado may daze him or throw him out of a car, but it is not a lethal condition. **Source:** `GAME_DESIGN.md`, "Death conditions", extracted from the sentence "The tornado never kills Roger. Its edge dazes him ... and it can throw him out of a car." **Why:** this is a critical safety/design rule that stops the core hazard from becoming an unavoidable death.

### R-002 — The opening message
**Rule:** Keep the threshold of 4 abductions for the opening message and the message duration of 7 s. **Source:** `GAME_DESIGN.md`, "The opening", extracted from "before they abduct 4 people" and "(7 s)". **Why:** it sets the game's objective and introductory pacing.

### R-003 — Arrivals and population
**Rule:** Start with 165 people; add 20 every 30 s, up to 420 alive at once. Armed arrivals begin at minute 2. **Source:** `GAME_DESIGN.md`, "The town and its people", extracted from "165 people at the start", "20 new arrivals every 30 s", "up to 420 alive" and "minute 2". **Why:** changes alter the simulation's density, the CPU pressure and the balance between people and invaders.

### R-004 — The second funnel and the hunt
**Rule:** Call the second funnel 30 s after the first, once only and only while a single one is active; the survivor hunt begins after 30 s. Fujiwhara adds the third funnel after 60 s. **Source:** `GAME_DESIGN.md`, "The storm" and "Automatic events in a run", extracted from "30 seconds", "once per run", "first 30 s" and "after a minute". **Why:** these control the storm's escalation and compatibility with modes that require a single funnel.

### R-005 — Storm controls and presets
**Rule:** Keep the ranges: intensity 0–1; wind 20–320 mph; radius 10–50 m (default 30 m, 60 m above); rotation 0.5–6 rad/s; debris count 10–50; debris size 0.4–2.5×. The presets remain Calm (0.25, 80 mph, 14 m, 1.5 rad/s, 15, 0.8×), Severe (0.75, 220 mph, 30 m, 3.5 rad/s, 40, 1.0×) and Monster (1.0, 320 mph, 44 m, 5.5 rad/s, 50, 1.6×). **Source:** `GAME_DESIGN.md`, "The storm", extracted from the slider ranges and the "Presets" table. **Why:** these ranges and combinations define the tornado's power, scale and legibility.

### R-006 — Buildings and Fujiwhara
**Rule:** A building collapses after losing 3 walls. Two funnels can merge when they come within about 30 m; the result is 2.4× the size and awards the +1500 bonus. **Source:** `GAME_DESIGN.md`, "The storm", extracted from "loses 3 walls", "within about 30 m", "2.4×" and "+1500". **Why:** the thresholds control chain collapses, how the merge reads and the reward.

### R-007 — Power line EMP
**Rule:** After the funnel brings a line down, it stays charged for 10 s and emits an EMP wave every 3.5 s. **Source:** `GAME_DESIGN.md`, "Power lines", extracted from "EMP-charged for 10 s" and "every 3.5 s". **Why:** the EMP is one of the lethal answers to Terminators and must have a predictable rhythm.

### R-008 — Explosive reactions
**Rule:** Keep the 5 explosive tankers in total, of which 4 are parked about 118 m from the centre; do not include the nuclear plants in the list of ordinary explosive targets. **Source:** `GAME_DESIGN.md`, "Destruction and fire" and the original "Explosions" section, extracted from "fuel tankers (all five)", "Four parked tankers" and "118 m". **Why:** the plants have a separate destruction contract, and the number and placement of the tankers support the explosion chains.

### R-009 — Fuel station: phases and propagation
**Rule:** Keep the 3 stations and the 3 phases of each: leak 4 s, fire 2.5 s, then an explosion with smoke for 16 s. A secondary explosion can skip the leak and detonate after 1–1.5 s; a station within 60 m can follow. **Source:** `GAME_DESIGN.md`, "Destruction and fire", extracted from "Fuel stations (three in town)", "three acts", "Leak (4 s)", "Fire (2.5 s)", "smoke ... 16 s", "1–1.5 s" and "within 60 m". **Why:** altering the phases can remove the visual/audio warning or break the order of the chain reactions.

### R-010 — Fuel station: distances and score
**Rule:** Keep the station's effect radii: buildings 34 m, thrown objects 42 m, people killed 11 m, tankers/gas mains/lines triggered 22 m; award +900 for these. **Source:** `GAME_DESIGN.md`, the original "Explosions > Fuel stations" section, extracted from the sentence about the blast and "(+900)". **Why:** the radii set the local risk zone and how the explosion is prevented or propagates.

### R-011 — Explosion chain limits
**Rule:** Limit a reaction to depth 3, to 14 secondaries pending, to 5 cars set off by one blast and to 2 cars set off by each secondary car. **Source:** `GAME_DESIGN.md`, "Destruction and fire", extracted from "at most 5", "set off 2 cars", "depth 3" and "at most 14 secondaries". **Why:** it bounds the cascading explosion and the number of effects processed at once.

### R-012 — Lightning targeting
**Rule:** One click calls 3–5 strikes; holding in place repeats the volley every 0.5 s. A strike electrocutes within a radius of about 4 m. **Source:** `GAME_DESIGN.md`, "Lightning and other disasters", extracted from "3–5 rapid strikes", "every half second" and "within about 4 m". **Why:** these values define the density of fire and the danger area for people.

### R-013 — Accepted damage types
**Rule:** Keep the specific immunities: Terminators are stopped by EMP/Lightning and by the MEGA BEAM in Hero Mode; aliens are killed by plasma, lightning, the Firenado and the Terminator's strike only when fire is present; the Cyber Yeti takes damage from fire, EMP only stuns it, and the Black Hole Gun consumes it separately. Nuclear plants can be destroyed only by the mothership, alien ships after 5 hits, the MEGA BEAM or the Electric Tornado. Samurai ignore people, Roger and the Yeti; only Roger's weapons can kill them. **Source:** `GAME_DESIGN.md`, "Aliens and enemies", "Landing Support" and the original "Who kills what" section, extracted from the sentences for Terminators, Aliens, Yeti, Samurai and Nuclear plants. **Why:** the `enemies.js` registry filters by accepted type and the handlers own different effects; a weapon's visuals do not grant vulnerability.

### R-014 — The abduction window and target
**Rule:** Abductions happen every 10 s during the ship's 120 s window; after 4 people are taken, call the mothership. **Source:** `GAME_DESIGN.md`, "Aliens and enemies" and the original "Abduction UFO" section, extracted from "every 10 s" and "After 4 abductions"; the window's duration is defined by `src/app/tornado/engine/aliens/config.js:45-47`. **Why:** it determines the pace of the invasion and the threshold for the mothership phase.

### R-015 — Alien and hunter ship: hull and timing
**Rule:** The UFO has 6 hull points; the hunter ship has 4. A normal hit does 1, the MEGA BEAM does 5. Hunter ships arrive at 90 s, there are 2, they keep 38 m from the plants and fire at them every 3.5–5 s. The UFO starts firing at a plant 30 s after it has settled and repeats every 14 s. **Source:** `GAME_DESIGN.md`, "Aliens and enemies" and the original "Hunter ships"/"Abduction UFO" sections; `src/app/tornado/engine/aliens/config.js:110-135`. **Why:** the values define the ships' health, the pressure on the plants and the escalation of the fight.

### R-016 — Storm and timed disasters
**Rule:** Electric sends an EMP ring every 9 s. Doomsday keeps its sequence: earthquake 0 s, gas mains 6 s, dam 12 s, meteors 19 s, Electric 27 s, sinkhole 33 s, Final Boss 39 s, Ignite 48 s. The Final Boss remains a single-funnel EF5 and refuses Chase Mode, Control Tornado and Fujiwhara while it is active. **Source:** `GAME_DESIGN.md`, "Disasters", extracted from the descriptions of Electric, Doomsday and Final Boss. **Why:** the sequence is the central rhythm of Doomsday mode; the Final Boss cannot coexist with modes that require a different number or control of funnels.

### R-017 — Firenado
**Rule:** The Firenado lasts 13 s; the automatic trigger requires at least 3 buildings on fire within 30 m and can happen once per run; while it burns, damage scoring is ×1.5. **Source:** `GAME_DESIGN.md`, "The storm" and "Disasters > Ignite", extracted from the current values of the Ignite section. **Why:** the duration, threshold and multiplier define its role as a temporary combat/score window.

### R-018 — Earthquake and Lavanado
**Rule:** The earthquake lasts 10 s, with a magnitude of 6.5–8.8; lava appears above 7.9 and the sinkhole above 7.1. **Source:** `GAME_DESIGN.md`, "Disasters > Earthquake", extracted from the "10 s of shaking" paragraph and the Lava/Sinkhole thresholds. **Why:** the thresholds control when the hazards appear and how they combine with the funnel.

### R-019 — Dam break, meteors and downburst
**Rule:** Keep a wave height of about 24 m at the breach and 15 m towards the end; the meteor volley contains 5 rocks; the downburst lasts 32–46 s at 120–165 mph. **Source:** `GAME_DESIGN.md`, "Disasters > Dam Break", "Meteors" and "Downburst", extracted from the numeric descriptions of these events. **Why:** these define the visual scale and the impact zone of the hazards.

### R-020 — Landing Support: Samurai
**Rule:** Keep the 100 m coverage ring, the team of 10 samurai, the 1 s camera glide, a fight time of about 20–30 s, a stay time of 120 s and a cooldown of 60 s. Samurai kill aliens and the T-Rex in the zone, but ignore people, Roger and the Yeti; only Roger's weapons can kill a samurai. **Source:** `GAME_DESIGN.md`, "Landing Support", extracted from "100 m coverage", the Samurai Support description and the constants cited from `engine/spaceship/config.js (SUPPORT)`. **Why:** a change affects the defended area, the team's strength and how often the support is available.

### R-021 — Landing Support: Rocket Strike
**Rule:** Keep the 6 s fall, the impact correction of at most 28 m (with the last second locked), the ring radius of 80 m, the damage of 8 of the mothership's 15 hull, the camera returning after 3 s, the cooldown of 60 s, the automatic departure after 30 s, the touchdown damage within 52 m and the limit of 3 landmark ships. Rocket Strike destroys targets in the zone according to their own rules; the Cyber Yeti takes only the fire damage. **Source:** `GAME_DESIGN.md`, "Landing Support > Rocket Strike", extracted from the sentences about the fall, the nudge, the EMP ring, the hull, the camera, the cooldown and the touchdown. **Why:** any deviation changes the destruction area, the control during the fall or the strength of the strike.

### R-022 — Terminator squad and Smooth Criminal
**Rule:** The Terminator tile calls a squad of 5. Smooth Criminal keeps the 20% light reduction, the shots at 24 m/50 m/260 m, the 7 s camera hold, the dance starting after 2 s and the ascent to 90 m; breaking the peace awards +30000. **Source:** `GAME_DESIGN.md`, "Landing Support and special events" and the original "Terminator"/"Smooth Criminal" sections, extracted from these numeric descriptions. **Why:** the values define the scale of the scene, the moment the state changes and the reward.

### R-023 — Chase Mode and camera transitions
**Rule:** Keep the intensity of about EF4 at 36 s and EF5 at 64 s; the top speed is 34; the rescue starts below speed 10 and picks up one person every 0.3 s. The camera transition to a character uses a 1 s glide, a 1.3 s hold and a 1 s return. **Source:** `GAME_DESIGN.md`, "Modes and controls", extracted from Chase Mode/Rescue and the character camera glide description. **Why:** these define the vehicle's handling and the timing of the scripted cameras.

### R-024 — Scale, crowd and roads
**Rule:** Keep the life-size scale: 1 unit = 1 m; houses have 1–2 storeys, townhouses 3–4, blocks 6–9 storeys and 19–29 m in height, at 3.2 m per storey. People are 1.8 m, cars 4.5 m, Roger 1.85 m, Hank 2.2 m, Terminator 2.1 m, alien 1.4 m, Patient Zero 2.3 m, Yeti 10.5 m, T-Rex 18 m and Captain Spotless 30 m. Roger can reach about 288 m from the centre. Crowd: Aggressive about 60%; Leader about 1 in 12; follower radius 28 m; Panic slider 50–100%, speed at 100% +15%; Herd 12 m. The bridge is 10 m high, 160 m long, with 10 cars. **Source:** `GAME_DESIGN.md`, "The town and its people", extracted from the character scale, crowd presets, movement bounds and bridge. **Why:** altering the scale changes collisions, navigation, legibility and gameplay distances.

### R-025 — Armed arrivals and creature alarm
**Rule:** After minute 2, people arrive armed; they shoot at aliens within 38 m every 1–2 s, with a 60% chance to hit. Never allow more than 18 creature voices at once. **Source:** `GAME_DESIGN.md`, "The town and its people" and "Sound and presentation", extracted from "Armed arrivals" and the voice limit. **Why:** these limits influence the combat response, the mix and the audio cost.

### R-026 — Score and combo
**Rule:** The base scores remain: tree 10, car 15, building piece 20, collapse 100 plus 60 per chain collapse; tanker bonuses 2500 and chemical works 6000. The Hero Mode objective doubles the points if Roger also neutralises the tornado. Combo: window 2.5 s, +15% per link, cap +300%. **Source:** `GAME_DESIGN.md`, "Scoring and feel" and "Hero Mode", extracted from the points table, the objective and "Combo". **Why:** these are the numeric reward for destruction and must not be multiplied again on a parallel path.

### R-027 — Enemy registry and score path
**Rule:** Respect each enemy's `accepts` list and `damage` handler; do not treat an accepted hit as a kill. Send the score through `damage.addDamageScore()` and combo events through the existing `gamefeel` system. **Source:** `src/app/tornado/engine/enemies.js:14-16, 122-124`; `src/app/tornado/engine/damage.js:81-97`; `src/app/tornado/engine/gamefeel.js:43-48`; `GAME_DESIGN.md`, "Aliens and enemies" and "Scoring and feel". **Why:** damage, stun, knockdown and consumption are different outcomes, and the shared scorer composes the existing multipliers.

### R-028 — Hero Mode: Terminators
**Rule:** Keep 2 pursuers about 55 m behind Roger; each returns once after being destroyed. The alarm starts within 50 m, plays for 6 s and can replay once all have passed 75 m. **Source:** `GAME_DESIGN.md`, "Hero Mode > The Terminators", extracted from the spawn and alarm description. **Why:** these control the number of threats, the length of the chase and the avoidance of audio repetition.

### R-029 — Minigun and Bullet Time
**Rule:** The minigun fires 18 rounds/s, has 200 rounds, a bullet speed of 320 m/s and limits of 300 bullets/140 casings. Bullet Time costs 20% energy, lasts 7 s, runs the world at 3%, suspends the new bullet after 5 m and requires 30 hits for a Terminator. **Source:** `GAME_DESIGN.md`, "Hero Mode > Weapons > Minigun", extracted from all the values for fire, ammunition, pooling and Bullet Time. **Why:** the values control DPS, consumption, the instanced pools and the slow-motion window.

### R-030 — Railgun and Fire Gun
**Rule:** The railgun fires at most once every 0.2 s and does not hit anything closer than 9 m to Roger. Fire Gun: 42 m cone, one tick every 0.25 s (4/s), and on the Yeti it applies 1.2 damage/tick out of 30 HP. **Source:** `GAME_DESIGN.md`, "Hero Mode > Weapons > Railgun/Fire Gun", extracted from the current values; `src/app/tornado/engine/hero/fireGun.js` for the tick logic. **Why:** the rhythm and distances define the damage and avoid self-hits.

### R-031 — Black Hole Gun
**Rule:** Keep the cost of 50% energy, the duration of 20 s, the influence radius of 100 m, the no-escape zone of 40 m, the knockdown of people at 70 m and the minimum distance of 12 m from Roger. Allow only one open hole: a new shot closes it and then opens the next. Never consume Roger or the car he is driving. Limit simultaneously pulled objects to 60, dissolving objects to 6 and fragments to 1400, for the documented 60 FPS target. **Source:** `GAME_DESIGN.md`, "Hero Mode > Weapons > Black Hole Gun"; `src/app/tornado/engine/player/blackHole.js:46-60`; `src/app/tornado/engine/player/blackHole/dissolve.js:28-35`. **Why:** the contract covers the weapon's balance, Roger's safety and the effects' maximum cost.

### R-032 — Energy and abilities
**Rule:** The bar has 10 segments and starts at 50%; the Abilities test fills it to 100%; explosions can charge up to 50% once per event. Rewards: tanker/chemical up to 50% within 60 m, station 37% within 47 m, gas main 25%, factory tank 22%, car 6%, factory barrel 3%; the nuclear terminal fills to 100%. Time Slow: 20%, 7 s, cooldown 6 s, world at 30%; Teleport: 10%, 18 m, landing at a minimum of 4 m, cooldown 1.5 s; do not land inside a building, over a chasm or outside the map, and if there is no safe place it refuses at no cost. EMP: 30%, charge 0.8 s, radius 36 m, T-Rex stun 5 s, lines within 20 m, cooldown 5 s; if Roger dies or the run ends during the charge, cancel the effect. No ability affects Roger. **Source:** `GAME_DESIGN.md`, "Hero Mode > Energy and abilities", extracted from the table and the energy description. **Why:** the costs, refusals and cooldowns are part of Hero Mode's control and balance.

### R-033 — Plasma cell and MEGA BEAM
**Rule:** The plasma cell has 100%; a shot consumes 25%, it recharges by 16 percentage points per second (about 6.25 s from empty to full), and the shot cooldown is 0.35 s. The MEGA BEAM requires a 2 s hold and has a width of 3.5×. **Source:** `GAME_DESIGN.md`, "Hero Mode > Combat (plasma rifle)", extracted from "uses 25%" and "hold 2 seconds"; exact values from `src/app/tornado/engine/hero/config.js:59-74`. **Why:** it affects the rate of fire, the recovery time and the threshold between a normal shot and the charged attack.

### R-034 — The full effects in the rifle table
**Rule:** Keep all the results in the table: Alien — normal kill, MEGA BEAM kill in the extended blast; the two Hero Mode Terminators — normal knockdown (code: 2.8 s), MEGA BEAM destroy; Terminator squad — normal knockback, MEGA BEAM destroy; UFO — 1/5 hull damage out of 6; hunter ships — 1/5 out of 4; mothership — 1/5 out of 15; tanker — explodes on both shots; tornado — a normal shot has no effect, the MEGA BEAM neutralises it until the end of Hero Mode; buildings/people/cars/trees — blast radius 7 normal and 18 MEGA BEAM, with surrounding buildings shaken by the MEGA BEAM. **Source:** `GAME_DESIGN.md`, "Hero Mode > What the rifle does", extracted from each row of the table; `src/app/tornado/engine/hero/config.js` for the knockdown. **Why:** the table explicitly defines, target by target, both the gameplay and the damage exceptions.

### R-035 — Death conditions and protections
**Rule:** The spawn shield lasts 3 s at the start and after Restart. The alien grab triggers at a distance below 1 m. The tracking laser locks within 100 m, moves at 5 m/s against Roger's speed of 9 m/s, holds for 3.2 s and returns every 3–5 s. The meteor kills within 22 m. Also keep the conditions with no numeric threshold: chasm, alien ray/grab, mothership beam, ship crash, Terminator, EMP on foot and meteor; Roger is protected from EMP when in a car. **Source:** `GAME_DESIGN.md`, "Hero Mode > Death conditions"; `src/app/tornado/engine/aliens/config.js:101, 104-106`; `src/app/tornado/engine/aliens/crew.js:573`; `src/app/tornado/engine/aliens/weapons.js:155-157`; `src/app/tornado/engine/hero/config.js` for the spawn shield and Roger's speed. **Why:** these limits define survival, the laser chase and the telegraphing of dangers.

### R-036 — Abductions, hunter ships and the mothership
**Rule:** The UFO arrives before the tornado, takes a person every 10 s and requires 4 abductions for the mothership; a tornado that touches it brings it down, and the UFO also falls after 6 normal hits or one MEGA BEAM plus one. The second wave arrives after 2 minutes with 20 aliens; hunter ships come after 1:30, 2 of them, and fall at 4 normal shots or one MEGA BEAM. The mothership has 15 hull, falls after 15 normal shots or 3 MEGA BEAMS, holds its beam for 2 minutes, plays a 6 s audio intro, and its crash uses a flash of about 2 s, a kill radius of 110 m, ignitions at 220 m, 46 secondary blasts and a cloud up to 250 m that lingers for about 30 s. After the beam's first pass, each later pass targets the nearest nuclear plant still standing. **Source:** `GAME_DESIGN.md`, "Aliens and enemies", extracted from "Abduction UFO", "Second wave", "Hunter ships" and "Mothership". **Why:** these are the progression thresholds of the invasion and of its ending.

### R-037 — Cows and the Cyber T-Rex
**Rule:** Keep the herd of 8 cows and the pasture of 40 × 22 m at about (58,104). The T-Rex is 18 m tall, 39 m long and has 40 HP; it begins its flame breath at 52 m, holds it for 2.6 s at intervals of 5–8 s, with a 60 m cone; it walks at 7.3 m/s, stomps within a 7.5 m radius, and the shake is heard up to 160 m. Damage: plasma 3, minigun 0.3/round, lightning/railgun 8, EMP 6 and stun 5 s; the MEGA BEAM kills instantly; kill bonus +5000. **Source:** `GAME_DESIGN.md`, "The town and its people > Cows" and "Aliens and enemies > Cyber T-Rex", extracted from the measured descriptions. **Why:** these values define a boss's size, mobility and toughness.

### R-038 — Stalemate and the Cyber Yeti
**Rule:** The Yeti and T-Rex stop at 92 m and the stalemate lasts 15 s. Yeti: 10.5 m, speed 7.5 m/s, storm 14 m, cold cone 38 m, fires from 55 m; the ground frost persists for 9 s, aliens in its frost and enemies in the storm freeze for 4 s; Roger freezes after 1.5 s and stays frozen for 3 s; coming within 9 m kills him. It has 30 HP: fire 1.2/tick; EMP stuns for 3 s, with no damage. Blizzard: radius 1.7× the capture edge, enemies 5 s, Roger 3 s. **Source:** `GAME_DESIGN.md`, "The Yeti/T-Rex stalemate", "Cyber Yeti" and "Blizzard", extracted from the thresholds and values there. **Why:** altering them breaks the intended matchup and the freeze behaviour.

### R-039 — Patient Zero
**Rule:** Create a clone every 2.5 s, capped at 50 clones. The original has 12 HP; damage per hit: plasma 3, minigun 0.5, lightning 6, EMP 4; the MEGA BEAM kills it. When the original dies, all the clones disappear; the reward is +2000. **Source:** `GAME_DESIGN.md`, "Patient Zero", extracted from the cloning description and the damage table. **Why:** uncontrolled multiplication would hurt performance and change the difficulty greatly.

### R-040 — Hank Granite and Captain Spotless
**Rule:** Hank: a scene of about 14 s, world scale 35%, 5 people, a punch every 2 s and +500 per victim; low gravity for 10 s at 30%, returning in the last 3 s, cars within 45 m. Captain Spotless: once per run, after 120–260 s, crosses in 16 s, radius 22 m and awards +1000. **Source:** `GAME_DESIGN.md`, "Hank Granite" and "Captain Spotless", extracted from the numeric descriptions. **Why:** the timing of the scenes and the rewards must not block or unbalance a run.

### R-041 — Waterspout and sharks
**Rule:** The waterspout lasts 45 s and rises to 110 m; the automatic appearance is once per run at 20–60 s after the Outbreak. The Sharkspout starts after 1.5 s, throws out one shark every 3 s, up to 6 at once, in the 110 m zone; the knockdown impact is 3 m, the shark stays for 4 s, the reward is +200. Keep 5 boats and +300 per boat. **Source:** `GAME_DESIGN.md`, "Waterspout", extracted from the duration, spawn and effects. **Why:** it maintains the event's pace and caps the temporary actors.

### R-042 — Volcano
**Rule:** It grows over 22 s to 50 m in height and 90 m in width; the eruption lasts 60 s; lava bombs can reach 150 m, ignite within 9 m and kill people/Roger within 4 m. **Source:** `GAME_DESIGN.md`, "Volcano", extracted from the growth, eruption and impact. **Why:** the size and radii determine the collision and the safe area.

### R-043 — Missions
**Rule:** Keep the objectives and rewards: Demolition 30 buildings/60 s/+5000; Evacuation 50 people/4 min/+6000; Fire crew 2 min/+7000; Safe house 40 people/90 s/+4000; Air cowboy 4 cows/2 min/+3000. The tracker turns red below 10 s. **Source:** `GAME_DESIGN.md`, "Missions", extracted from the list of objectives and the tracker's rules. **Why:** the targets and timers are the success conditions of each mission.

### R-044 — Nuclear plant and EMP mutation
**Rule:** Keep 2 plants at the approximate coordinates (-100,100) and (102,-104); alien ships need 5 hits for containment. Meltdown: about 2 s critical; flash over 0.5 s and fade 3.5 s; fires at 300 m, kill radius 55 m, 70 secondary blasts, cloud 380 m and +30000. The EMP ring travels at 55 m/s; the mutation lasts 2 s; the limit is 150 active aliens; process at most 8 people/frame, so that 160 people are mutated in about a third of a second. **Source:** `GAME_DESIGN.md`, "Nuclear power plants", extracted from the locations, meltdown, blast and mutation. **Why:** these are the limits of the biggest set piece and of its mass effect.

### R-045 — Nuclear terminals and lighting
**Rule:** The terminal fills energy to 100% within 3 s from zero and has a cooldown of 60 s; the Plug In test starts at 10%. The ambient is 25% above the base scene, then rises by a further 50% over the course of 2 minutes after the first major destruction. **Source:** `GAME_DESIGN.md`, "Nuclear power plants > Plugging in" and "Lighting", extracted from the exact times and levels. **Why:** the terminals and the lighting are persistent feedback on the run's progression.

### R-046 — Numeric limits for UI and sound
**Rule:** Keep the UI animation at 0.2 s and the press at scale 95%; the track crossfade is about 1 s; do not play more than 18 creature voices at once. **Source:** `GAME_DESIGN.md`, "Sound and presentation" and the original "Panel", "Sounds" and "Creature sounds" sections. **Why:** it limits visual and audio clutter and keeps the transitions legible.

### R-047 — Architecture and lifecycle
**Rule:** Keep mutable state on the `Sim`/`ctx` instance, subsystems on `ctx.systems` and the `init`/`reset`/`dispose` lifecycle order; do not introduce global singletons or parallel systems for existing behaviour. **Source:** `CLAUDE.md`, "Architecture", "Important systems" and "Development rules"; `src/app/tornado/engine/lifecycle.js`. **Why:** simulations must be isolated and resources must be reset/released in the existing order.

### R-048 — Performance limits
**Rule:** Respect the caps: 160 global enemies, 50 Patient Zero clones and 10,000 shared particles. Ask `canSpawn(kind)` before spawning and `particleRoom()` before emitting; reuse the pools and do not allocate objects/arrays in hot loops. **Source:** `src/app/tornado/engine/perf/caps.js:24-31, 66-83`; `src/app/tornado/engine/particlePool.js:75-125`; `CLAUDE.md`, "Performance rules"; `FINDINGS.md`, "Performance budget" and "Particle budget". **Why:** the caps are global and measured; separate local limits do not protect the shared budget.

### R-049 — The weapon cycle and combo
**Rule:** Keep the wheel order (`rifle`, `minigun`, `railgun`, `fire`, `blackhole`, `katana`; `katana` was added as the sixth weapon, an extension approved by the user on 2026-10-01, and the first five keep their order), and the existing wheel/trigger input and HUD. Send scoring through `damage.addDamageScore()` and combo events through `gamefeel.event()`; do not duplicate the scorer or the multipliers. **Source:** `src/app/tornado/engine/heroWeapons.js:52-53, 431-440`; `src/app/tornado/engine/hero/input.js:109-114`; `src/app/tornado/engine/damage.js:81-97`; `src/app/tornado/engine/gamefeel.js:43-48`. **Why:** it prevents divergence between the selected weapon, the HUD, the trigger and the score.

### R-050 — Plan scope
**Rule:** Implement only the approved subtask. Before modifying a system protected here, cite the relevant rule in the plan and report; if the change contradicts it, ask the user for approval before editing. **Source:** `CLAUDE.md`, "AGENT WORKFLOW" and "Business / gameplay rules that must not be broken"; `.claude/agents/coder.md`, "What you may not do". **Why:** it separates planning from implementation and prevents accidental changes to the gameplay contracts.

### R-051 — Katana
**Rule:** The Katana is the sixth weapon, costs no energy, and cuts aliens only (kind `alien`, phases `patrol`, `escort`, `exiting`); every other registered kind (Terminator, T-Rex, Yeti, Patient Zero and so on) parries without damage, and samurai are ignored. Do not modify any `accepts` list; the T-Rex accepts `blade` for the samurai, so the Katana never sends `blade` to a non-alien. Values: reach about 3 m, lunge up to about 6 m, cooldown 0.35 s (real time), hold 0.25 s for Blade Mode, world scale in Blade Mode 0.10 through the `bladeMode` hold (Roger is not slowed; do not use `Post.bulletTime`), at most 4 s and 3 cuts per Blade Mode window, 3 cuts per alien (at most 8 pieces), at most 32 live pieces (the oldest is recycled), life 6 s with a 1.5 s fade, hit-stop 0.065 s through the `katanaHitStop` hold. The score goes only through `gamefeel.event('slice')` followed by a single `damage.addDamageScore()`; the base `ALIENS.killScore` is scored once, in `sliceKill`; multi-cut bonus 50 and 20 per extra piece. Blood: a pool of 600 particles within the limit of 10,000 (checked with `particleRoom()`) and 48 decals. **Source:** `src/app/tornado/engine/hero/katana/config.js`; `src/app/tornado/engine/aliens/crew.js` (`sliceKill`); `src/app/tornado/engine/gamefeel.js` (`slice`); `docs/weapons.md`. **Why:** it preserves the per-kind immunities (R-013, R-020), the draw-call budget (R-048) and the single score/combo (R-049).
