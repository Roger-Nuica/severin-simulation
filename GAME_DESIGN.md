# Tornado Simulator — Gameplay Design

How the game plays today, in plain words: the key behaviour of every mode, disaster, weapon and enemy. Exact numbers and contracts are in `.claude/rules.md`; the runtime code is the source of truth. When a change alters how something plays, update the matching section here in a sentence or two and add a line to the changelog at the end.

## The opening

The camera opens on the aliens' landing site: their ship comes down over open ground and the Chase Mode car is parked nearby. The opening message sets the goal: stop the abductions before the mothership arrives. A clock in the lower left corner shows how long the game has been going (Reset starts it again).

## The storm

The player starts the tornado from its button or a preset; Hero Mode does not start it. The funnel pulls loose things in, lifts and spins them, and flings them out. Trees are uprooted, cars tip and fly, and buildings shed roofs and walls before collapsing, sometimes in a chain. After an opening wander the storm hunts survivors. Fallen power lines can charge it with EMP discharges, and funnels may orbit and merge. Presets set the storm's character and the controls tune it while it runs. Night is dark; Day Mode switches to daylight. Roger's MEGA BEAM can wear a tornado down, and another can be called after it ropes out.

## Destruction and fire

Tankers, chemical works, gas mains, power lines and fuel stations can go up and set each other off. Explosions throw things, damage buildings and start fires that spread until the fire crews arrive. The Firenado is the tornado itself burning: it leaves burning ground and kills the aliens it reaches. A building that falls lies across the street and its rubble stays in heaps; both are solid to Roger and to enemies on foot.

## Disasters and events

The panel offers each event on its own: Electric storm, the Final Boss wedge, Doomsday (disasters in sequence), Fujiwhara, Ignite, earthquake (a chasm, sometimes lava and a Lavanado), dam break (an opaque flood that drains again), meteors, downburst, lightning strikes aimed with a reticle, gas-main rupture, fuel station, volcano, Blizzard (freezes water, lava and the living), Solar Storm (auroras and a blackout street by street: lights out, engines dead, machines and alien ships glitching; Roger's EMP runs down the power lines), the waterspout over the lake (only when called), and Landing Support (Samurai Support or a Rocket Strike at a chosen point). Smooth Criminal stops the fighting: a violet stage rises and townspeople and aliens dance until Roger breaks the peace or the event is chosen again.

## Modes and controls

Control Tornado steers the funnel, Cinematic View orbits it, and Chase Mode puts the player in a car fleeing the storm. The free camera orbits, pans and zooms; W A S D pan only when no mode owns them. Each input goes to the active mode only.

## The town and its people

Life-size town: people flee, seek shelters, pair up and follow crowd presets (panic, herding, shelter-seeking are tunable). New arrivals keep the town populated, and later ones come armed and fight aliens. Fire engines, ambulances and evacuation buses work through the disaster. Before the storm the town lives: cars come and park and leave, gulls circle, the STORM 7 news helicopter flies; once a funnel is down everything reacts to it. The train can derail, the elevated highway's pillars can snap, and cows in the pasture can be carried off.

## Scoring and feel

Destruction earns points, big set pieces earn bonuses, and a quick chain of destruction builds a combo. Heavy events can bring slow motion and the camera shakes with what happened and how close it was.

## Hero Mode

Roger always starts in front of the first nuclear plant, facing the town, and roams freely until he dies or leaves. Two small bars over his head show his health (it regenerates after a few seconds without damage) and energy. Energy comes from explosions and the plants' charging terminals; Invincible (V) is a toggle that stops all harm except Hank Granite's punch.

### Weapons

On the wheel: the plasma rifle (charges into a MEGA BEAM), the minigun (Bullet Time with Q), the railgun (calls lightning), the Fire Gun, the Black Hole Gun, the Katana (melee: draw a line in first person and it cuts along it, aliens and people fall in two) and the Gravitron. The Gravitron opens a gravity rift: a violet vortex on the ground, and everything inside its circle floats up in a violet glow (people, cars, trees, wreckage, street clutter, every enemy, even the alien ships), then gravity slams back with a shock ring. Only the living explode: people and enemies blow up where they land, the ships fall burning, everything else just crashes down. Every weapon hurts every enemy at least a little; real weaknesses are in the rules.

### Energy and abilities

Q Time Slow, E Teleport, R EMP, G grappling hook (pulls an alien in, or zips Roger to a wall or a heavy enemy, shouting GET OVER HERE!), C telekinesis (lift a car and throw it, it explodes on what it hits), T Landing Support, and Space the jetpack: one press flies, with no fuel limit (held climbs, released sinks gently). Roofs, fallen buildings and rubble are ground he can land and walk on. Roger can drive any parked car, which protects him from alien grabs and rays.

### Death conditions

Most threats take health (alien rays, touches, ship lasers, homing missiles, HAVOC's rounds, fire, lava, flood). A few still kill outright, each with its own message: the mothership's beam and crash, the Cyber Yeti up close, the black hole, a nuclear blast, the chasm, big explosions, a meteor, a lava bomb, a falling ship, an EMP wave on foot, Patient Zero and Hank's punch. The tornado, debris and ice only daze or freeze him. A spawn shield protects him at the start. Friendly fire is on.

### Co-op

Two players can share a town (desktop only), each on their own computer. The host runs the world and is the only one who starts storms, disasters, enemies and modes; the guest's panel keeps only the sound settings and the Hero request. Each Roger plays exactly like the single-player one with its own keys, mouse and camera: on foot A and D turn, right-click raises the weapon and then the mouse looks. The guest carries the whole weapon wheel, sees the weapon in hand when aiming, and each player sees the other's weapon in hand; the guest's own movement answers at once instead of waiting on the network. Each sees both health bars, both can be Invincible, they can hurt each other, and both can fight and wreck whatever the host has brought in. A downed player cannot move; the partner revives them by holding F beside them, with a countdown, and the run ends when both are down. The guest now sees the host's world as the host does: every weapon's shots (its own and the host's), the Black Hole, the real tornado with the storm sky, explosions, lightning, the enemies with their real figures and their shots, cars, fires, floods, earthquakes, meteors and the electric storm. It only watches these; what they hurt is decided on the host. Building damage and the town's people can still differ between the two screens.

### On a phone or tablet

Hero Mode clears the screen; a floating joystick on the left moves Roger, the right thumb looks, and buttons fire, aim, switch weapon and use the six abilities, all at least thumb-sized and clear of the HUD. The news line moves to the top, and co-op is hidden.

## Aliens and enemies

### The invasion

The landing ship comes down over open ground, never inside a building or a plant. Its crew walks down the ramp and escorts people up it. After four abductions it calls the mothership, pulls its ramp in, climbs and turns hunter: it circles Roger high up and fires pairs of homing missiles that follow him round corners and over roofs until they reach him, and two more hunter ships come with it. The crew never come up close to Roger: they circle him about 40 m out, always moving, and shoot from there. Their shots are short green bolts you can see fly from the gun, each with its own blaster sound; a ship's shot is a heavier red lance with a deeper sound, and a ship's tracking laser first draws a thin aiming line and a reticle on the ground before it burns as a thick column of light with a halo, with a charging whine and a hum. A shot landing on Roger is a small spark and a ring with a crackle, and many at once stay readable. Hunter ships (the first two after a minute and a half) burn people and attack the nuclear plants; a second wave in sombreros arrives by transport. The mothership sweeps the town with its beam and a downdraft that flattens trees and pushes Roger; it can be shot down. The green EMP of a nuclear blast turns people into aliens.

GHOST flight, three stealth fighters, joins 30 s into a run: they cloak and decloak over the town and take out at most one alien on the ground every five seconds with guns or rockets.

### Other enemies

- **Terminators** come only when sent from the panel: a squad of five round Roger, each from a different side. EMP and lightning are their weakness.
- **HAVOC**, the heavy gunner, has two minigun arms that fire in turn behind red laser sights. A pair comes by itself a minute into the game, more from the 🔫 button. His tracer rounds are slow enough to see; with Time Slow they stop dead round Roger and fly back to him when time runs again.
- **Hank Granite**, the Human Landslide: a granite giant with magma in the cracks who lands as a boulder, filmed from the front, and punches two townspeople across town with the distance counted on screen. In Hero Mode he then hunts Roger as a boss: his punch kills even through Invincible, and he throws rocks at Roger up on a roof or in the air. Afterwards the town has low gravity for a while.
- **The Cyber T-Rex** breathes fire and **the Cyber Yeti** brings an ice storm; both aim at Roger, even up on a roof. When they meet, their beams cancel in a stalemate, then they come for Roger.
- **Patient Zero**, the Replicator, builds clones out of blocks and infects people; at 15 clones they ring Roger 100 m out and close in, and left alive the original evolves into something bigger.
- **Samurai** (Landing Support) fight aliens and the T-Rex and ignore people, Roger and the Yeti; only Roger can kill them. **Captain Spotless** cleans debris and fire and disintegrates enemies.

## Nuclear power plants

Two plants at opposite corners. They take few hits from alien ships, the MEGA BEAM or the Black Hole Gun, and every other weapon only chips them. A meltdown devastates the area and sends out the mutating green EMP wave. Their terminals refill Roger's energy while they stand.

## Sound and presentation

Creature sounds are spatial and synthesised; music runs through play, with its own mix for events and Smooth Criminal. Some sounds wait for recordings from the owner (listed in `TODO.md`; the jetpack is silent until then). The STORM 7 news line along the bottom explains what is happening like a TV lower third (hidden in Hero Mode, where Roger's HUD does that job), and a first-visit explainer (the ? button or H) introduces the game in four cards. The install button is switched off for now.

## Changelog

Short dated notes on how the game changed; the reasoning is in `PROJECT_HISTORY.md` and the numbers in `.claude/rules.md`.

- 2026-10-01: W A S D everywhere (arrow keys removed); Bullet Time, the Fire Gun and the Black Hole Gun; the giants' stalemate; life-size scale.
- 2026-10-02: health bar and damage instead of most instant kills; every weapon hurts every enemy; co-op; the Katana; the Gravitron, the grappling hook, telekinesis and the Solar Storm from the backlog.
- 2026-10-03: no bunker and no automatic Terminators; they come only from the panel.
- 2026-10-04: GHOST flight; HAVOC and stopping bullets in Time Slow; Hank Granite redesigned; the jetpack.
- 2026-10-05 (morning): rubble and fallen buildings are solid; the jetpack flies on one press with no limit; Hank became a fightable boss; the T-Rex and Yeti aim at Roger; Patient Zero dimmed; Fujiwhara, the Final Boss and Doomsday usable in Hero Mode.
- 2026-10-05 (later): the landing ship turns hunter with homing missiles and brings two more hunters, and never lands inside anything; the crew keep their distance; Roger always starts by the first plant; the Gravitron lifts everything and only the living explode; HAVOC got two minigun arms and a pair comes at one minute; the session clock replaced the install button; the jetpack is silent until its recording arrives.
- 2026-10-05 (evening): the aliens' and ships' shots redrawn (flying bolts, lances, soft beams that fade near the camera, small impacts), their own sounds, and the tracking laser warns before it burns.
- 2026-10-05 (night): co-op rebuilt around ownership: the guest's keys, mouse and camera drive only its own Roger, with the single-player controls; a downed Roger no longer reacts to input; the guest can revive a downed host; the guest has Invincible and a panel with only the sound settings.
- 2026-10-05 (late): the ships' tracking lasers are thick glowing columns; the mouse wheel keeps first person when moving onto or off the Katana.
- 2026-10-05 (co-op fixes): the co-op guest raises and sees every weapon on the wheel with shot feedback, each Roger shows the weapon in hand, and the guest's movement is immediate.
- 2026-10-05 (co-op parity): the guest sees its own shots, flames, Black Hole bolt and Katana cut; teleports like the host's Roger (free for the guest); and flies with the jetpack the same way (Space lights it, held climbs, no fuel), seen by both players.
- 2026-10-07 (co-op visibility): each player sees the other's teleport at both ends, jetpack flames and smoke, and Katana swing as a short arc, and the guest sees a red crosshair marker with the +points when its own hit scores.
- 2026-10-10 (co-op mirror): the co-op guest sees the host's world drawn by the same code as single player (weapons, Black Hole, tornado and sky, explosions, enemies and their shots, real figures, several disasters); the shared shooter and the guest's missing powers are not done yet.
- Earlier tuning kept for reference: the mothership comes after 4 abductions (was 5); hunters after 90 s (was 150, then 120); the sombrero wave after 2 minutes; alien speed +30%; the Yeti 10.5 m; satellite funnels off; waterspouts only on request; Hank and the earthquake only from the panel.
