# Tornado Simulator — Game Rules & Mechanics

## The start
- The game opens with the camera on the **aliens' landing spot**: their ship comes down there straight away, and the Chase Mode car is parked beside it.
- A message says the goal as it opens: **"STOP THE ALIENS — before they abduct 4 people · then the mothership comes"** (7 s).

## The storm
- The storm starts with the **🌪️ Tornado** button, or by picking a preset (Calm, Severe, Monster). Nothing else starts it, Hero Mode included.
- If Roger's MEGA BEAM neutralises the tornado, the **🌪️ Tornado** button lights up again once it has roped out: press it (or pick a preset) and a new one comes down.

## Explosions
- Everything that can blow up can be set off by anything violent enough, with or without a storm: the **mothership's beam** and its crash, a crashing alien ship, a **meteor**, a **lightning bolt** (the Lightning tile or Roger's railgun), Roger's plasma, and the tanker and the chemical works setting each other off.
- What goes off: the **fuel tankers** (all five), the **chemical works**, the **gas mains** under the streets, the **power lines**, the **fuel stations**. (The nuclear plants are not on this list: only four things destroy them, see **Nuclear power plants**.)
- **Four parked tankers** stand out towards the edges of town, one each to the **north, south, east and west**, on the long streets: inside the town (118 m from the centre), well away from the ring road the first tanker drives. They have no fuse. Each one goes up with the same blast as the first tanker when a funnel reaches it, when Roger shoots it, or when anything violent enough happens beside it (including another tanker or the chemical works going up). They show on the minimap as orange trucks.
- **The biggest explosions**, smallest to largest: fuel tanker → chemical works → **mothership crash** → **nuclear plant**.
- **Fuel stations** (three in town) go up in three acts:
  1. **Leak** (4 s): a funnel reaching the forecourt, or the wind tearing any piece off the station, ruptures the pumps. Fuel sprays out, a dark puddle spreads over the forecourt, the pumps **hiss** and the **pump alarm** beeps. People keep clear.
  2. **Fire** (2.5 s): the fuel catches, flames cover the puddle, the kiosk burns, the alarm beeps faster.
  3. **BOOM**: a fireball, a flash, **two rings of flame** racing out along the ground and **columns of black smoke** for 16 s. Buildings within 34 m are shaken, loose things within 42 m thrown, people within 11 m killed, the neighbourhood set alight, the station comes down (a funnel in those fires catches them: the Firenado). Tankers, gas mains and lines within 22 m go off (+900).
  - A station reached by another explosion, or collapsing, skips the leak: it is already on fire and goes up 1–1.5 s later. Another station within 60 m goes up after it.
  - **Secondary explosions:** the cars round a station or a tanker go up after it, nearest first, one after the other (at most 5 from one blast), and each can set off 2 cars right beside it. Burnt out, thrown, and never again.
  - **Chain limit:** a blast is depth 0, what it sets off depth 1, and so on up to **depth 3**; nothing past that is set off, and at most 14 secondaries wait at once.
  - **⛽ Fuel Station** (in 💥 Disasters) starts a leak: at the station nearest Roger in Hero Mode, a random one otherwise. Disabled while one is leaking or burning, and when none is left standing (Reset brings them back).
- **Second tornado:** 30 seconds after the first tornado comes down (Start), a second one comes down elsewhere in town ("SECOND TORNADO"). This happens once per run, and only if just one is up.
  - It waits while a one-funnel mode is on (Chase Mode, Control Tornado, Final Boss, Hero Mode), and comes as soon as that mode ends.
  - The Fujiwhara disaster starts with two funnels and adds a third after a minute, so it doesn't need this.
  - Two funnels that wander close together can merge (the Fujiwhara effect).

## 🌩️ Lightning strike targeting
- Turn the **🌩️ Lightning** disaster tile on. The pointer becomes a crosshair, and a glowing ring on the ground shows where strikes will land.
- **Click** the ground to call down **3–5 rapid strikes** inside the ring.
- **Hold and drag** to paint strikes across the town: a new volley wherever the crosshair moves, and every half second while you hold still.
- **Esc** or the tile again stops it. While it is on, the left mouse button no longer rotates the camera. The mouse wheel still zooms and W A S D still pan.
- **Each strike:**
  - sets a building it lands on or beside on fire, and knocks a piece off;
  - **electrocutes** anyone within about 4 m: they light up, convulse, char and fall;
  - **shorts out a Terminator** it lands on, like the EMP (EMP-like death);
  - uproots trees, flips cars, faults power lines and leaves a scorch mark.
- **Sound:** a crack and boom of thunder with every strike (sharper up close), then an electrical hum that builds with each strike and dies away over a few seconds.
- It works before or during the storm, but not in Hero Mode, where the mouse is Roger's.

## Who kills what
- **Terminators:** only an EMP kills them. That is the **Electric Tornado's EMP beam** (its discharge ring), the EMP waves from a funnel charged by bringing down a power line, or a **lightning strike called down on them** (🌩️ Lightning). In Hero Mode, Roger's **MEGA BEAM** kills them too. Nothing else stops them: wind, debris, fire, water and blasts pass straight through.
- **Aliens:** the **Firenado** (a burning tornado, 🔥 Ignite) kills any alien it reaches: they catch fire, blacken and fall. A Terminator's blow kills one only with fire at hand (the Firenado nearby or a burning building next to it). Otherwise it just throws the alien back. In Hero Mode, any plasma shot kills one.
- **Nuclear plants:** only the mothership, the alien ships (5 hits), Roger's MEGA BEAM and the Electric Tornado (see **Nuclear power plants**).
- **People → aliens:** a nuclear plant's green EMP turns everyone it reaches into a sombrero alien.
- **Alien ships:** a tornado reaching the UFO tears it out of the sky. In Hero Mode, every plasma shot damages the UFO, the hunter ships and the mothership, and a MEGA BEAM does five times as much (see below).

## Storm controls (🌪️ Storm section)
- The sliders set the storm live:
  - **Intensity** 0–1: its EF rating and how strongly it lifts;
  - **Wind Speed** 20–320 mph;
  - **Tornado Radius** 10–50 m (default 30 m: 60 m across, a block at a time);
  - **Rotation Speed** 0.5–6 rad/s;
  - **Debris Count** 10–50;
  - **Debris Size** 0.4–2.5×.
- **Presets:**

  | Preset | Intensity | Wind | Radius | Rotation | Debris | Debris size |
  |---|---|---|---|---|---|---|
  | **Calm** | 0.25 | 80 mph | 14 m | 1.5 rad/s | 15 | 0.8× |
  | **Severe** (default) | 0.75 | 220 mph | 30 m | 3.5 rad/s | 40 | 1.0× |
  | **Monster** | 1.0 | 320 mph | 44 m | 5.5 rad/s | 50 | 1.6× |

- **The hunt:** for the first **30 s** of a run a tornado wanders its own path. After that each funnel hunts: it picks a random survivor, steers for them, and picks another once that one is gone. It moves at its normal speed, so people can still outrun it.
- **What a tornado does:**
  - **Pulling things in:** objects at the edge of its pull tremble, then slide in. Closer in they lift and orbit up the funnel, until they are flung out and fall. Heavier things need a stronger storm to lift.
  - **Trees** sway, then are uprooted and carried off whole.
  - **Cars** tip, then go airborne.
  - **Buildings** lose the roof first, then walls. A building that loses **3 walls collapses**. A collapse shocks its neighbours, so buildings can fall like dominoes in a **chain**, each one paying a chain bonus. Some fall over sideways onto whatever is next to them and leave rubble in the road.
  - **Flying debris** is dangerous on its own: it kills people, tips cars, uproots trees and knocks pieces off buildings. It also brings down power lines and damages the bridge's pillars.
  - **Storm shelters** can be damaged too, but they are built far tougher than anything else, so they are usually the last thing standing.
- **Power lines:** a funnel passing over a pole brings it down.
  - A fault then runs along the lines from pole to pole, with sparks, and can set buildings alight.
  - A funnel that brings a line down becomes **EMP-charged** for 10 s: blue arcs, a hum, and an EMP wave every 3.5 s that kills Terminators.
- **Fujiwhara merge:** two funnels that wander within about 30 m of each other orbit and merge into one **monster** funnel, 2.4× the size and much stronger (+1500).
- **Night by default.** **Day Mode** (🎥 Camera) switches to daylight. There is no random lightning by day.

## Automatic events in a run (timed from Start)
Starting the tornado sets off **no other disaster**: no meteors, no dam break, no earthquake. Those come only from their own buttons (or Doomsday's script).

| Time | Event |
|---|---|
| 0 s → | Aliens are already there before Start (see Aliens). 20 new people arrive every 30 s from the moment the game opens (storm or not), up to 420 alive at once; from minute 2 they come armed. |
| 20 s | The **fuel tanker** on the ring road explodes (a huge blast, though the mothership crash and the nuclear plants are bigger): a fireball, a ring of fires, gas mains torn open (+2500). It also goes off early if an emergency vehicle hits it during the run, if Roger shoots it, or if anything violent enough reaches it (see **Explosions**). The tornado cannot move it before then. It shows on the minimap as a long orange truck. Until then it drives the ring road, braking to a stop in front of any building, rubble, landed ship or vehicle in its way, and it waits there. |
| 30 s | The tornado starts **hunting** people. |
| 30 s | The **second tornado** comes down (was 1:30). |
| 40 s | The **chemical works** cooks off: its 50 barrels go one after another, then the storage tanks and the works in one blast whose pressure wave crosses the town (+6000). A funnel crossing the yard sets it off early, and so does anything violent enough reaching it (see **Explosions**). |

## Disasters (💥 section), one tile each
- **⚡ Electric:** a mode that stays on until switched off.
  - Arcs crawl up every funnel. Strikes go out into buildings, trees and people, and chain from building to building.
  - Ball lightning orbits the funnel and lets go into the ground.
  - Every 9 s an **EMP ring** sweeps the whole map. It faults power lines, shocks buildings and starts fires, electrocutes people in the open (more likely near the funnel) and **kills Terminators**.
- **👹 Final Boss:** an EF5 wedge.
  - The funnel grows until it covers most of the town. The screen "cracks" as it comes up and the sliders are maxed.
  - It is one funnel only: Chase Mode, Control Tornado and Fujiwhara are refused while it is on. Switching it off shrinks the funnel back, but the sliders stay at EF5.
- **☠️ Doomsday:** every disaster in order on a timer, starting the storm itself:
  - 0 s earthquake;
  - 6 s gas mains;
  - 12 s dam break;
  - 19 s meteors (5);
  - 27 s Electric;
  - 33 s sinkhole under the fullest muster point;
  - 39 s Final Boss;
  - 48 s the funnel catches fire.

  Pressing it again stops the script, but whatever has already started keeps running.
- **🌀 Fujiwhara:** starts with two funnels, a third after a minute, and they merge into a monster. Refused during the wedge, Chase Mode and Control Tornado.
- **🔥 Ignite (Firenado):** the tornado itself catches fire for **13 s**: flames wrapped round its funnel, embers, a heat glow.
  - Only when you press Ignite, or when the funnel **passes through a big fire** (3 or more buildings alight within 30 m of it; once per run). A fuel station or a tanker going up beside it lights it that way, through the fires they start.
  - **Never without a tornado on the ground.** Pressed with no funnel, it says so and does nothing. (Shooting a tanker in Hero Mode used to draw a free-standing "flame tornado" that drifted and faded: that is gone. Explosions make a fireball, a shockwave, debris, smoke and fires, nothing more.)
  - Flames and embers fill it, and it leaves burning ground behind it.
  - It kills aliens it reaches, and all damage scores **×1.5** while it burns.
- **Satellite funnels:** the small funnels that used to come and go round the tornado at EF4 and above are **switched off** (`SUB.enabled` in `engine/vortex.js`). Glowing like fire, they looked like a stray mini fire tornado.
- **🌎 Earthquake:** **back on** (`EARTHQUAKE.enabled` in `engine/earthquake.js`; it was switched off for a while). The button works and it opens Doomsday. It no longer comes by itself during a run.
  - 10 s of shaking at magnitude 6.5–8.8.
  - **The chasm:** the ground splits open along a line across town. Anything on the line falls in and is gone: people, cars, trees, the train, Roger. Buildings over it collapse, and the crowd steers round it afterwards.
  - **Lava:** above magnitude 7.9, fissures and lava vents open. A funnel passing over the lava becomes a **Lavanado**: it throws molten gobs across town that start fires and open gas mains, for as long as it keeps finding lava.
  - **Sinkhole:** above magnitude 7.1, a sinkhole opens, preferably under an open evacuation point. What goes in is gone for good.
  - **The train:** it rocks on its rails and derails near the chasm.
- **🌊 Dam Break:** only from its button (or Doomsday). The dam on the west edge fails and a **wave as tall as the buildings** crosses the whole town, settling into a deep flood behind it.
  - **The water is opaque and murky**: silt brown in the shallows and the churned front, dark where it is deep, with ripples running downstream, sky reflections at grazing angles and the sun's glint. What is under it is hidden: a car half under shows only its roof.
  - **The wave**: about 24 m high at the breach (15 m by the far side), its face steepening into a plunging white lip, bowed forward in the middle; white water off its face, spray blowing off the top, foam round every building standing in it, mud and wreckage riding the flood.
  - **It destroys what it reaches**: buildings take damage in proportion to the flow's force (depth × speed²) for as long as they stand in it and **come apart piece by piece until they collapse** (shelters hold); cars are thrown and trees torn out, then carried; people are swept off their feet and some drown; the pieces of what it breaks float off with the flow. Scored and comboed like any destruction.
  - **Sound**: the dam's groaning and the burst as before, plus **rushing water** (louder near the water and alongside the wave) and **the crash of the wave** when the gate goes and when a building comes down in it.
  - **The lake behind it is a closed basin**: side walls and a far wall as high as the dam, with earth banked up behind them, so there is nothing to see beyond. **Nothing crosses the dam line**: not Roger, not a car, not anything the storm throws. Whatever is thrown at it bounces back, through the breach or round the ends.
  - Power lines fault and bridge pillars are undermined.
  - The water then drains and the dam is rebuilt, so it can be broken again.
- **☄️ Meteors:** only from the button (or Doomsday): a volley of 5 at random spots, as often as you like. None aims at the dam. Each leaves a permanent crater.
  - The blast throws things, shocks buildings and starts fires, and kills people near the impact.
  - One rock in each volley is an **airburst**: nothing reaches the ground, but trees are flattened in a ring, all pointing away from it.
- **⬇️ Downburst:** a column of air slams down under the camera's view.
  - A **DOWNBURST WARNING** comes first, then 32–46 s of straight-line wind (120–165 mph) blowing one way across a square zone.
  - Trees bend or are flattened on the same bearing, and buildings are shocked from upwind.
  - Cars roll, people are knocked flat and some are killed, and gusts keep tearing at the core.
- **🌩️ Lightning:** call strikes down yourself (see above).
- **🛢️ Gas Main:** ruptures a buried main.
  - The fire runs down the street and branches at crossings, lighting buildings on both sides.
  - Fire engines cannot put a burning main out, and a street that has burnt stays charred.
  - Mains are also torn open by fissures, meteor craters, the tanker, the chemical works, lava, and the Electric Tornado's arcs.
- **🛸 Landing → Landing Support** (the tile, or **T**): a marker follows the pointer on the ground (the middle of the view under Hero Mode's pointer lock) with two rings: **A, blue**, the samurai's 100 m coverage, and **B, red**, the rocket's 80 m blast (flashing warning red with Roger inside it). Then **R** = Samurai Support, **T** again = Rocket Strike, **Esc** or right-click = cancel. Outside the marker R is still the EMP. Enter does nothing here any more.
  - **Samurai Support:** a black-and-gold ship comes down on the marker (the old scripted descent: thrusters, dust, shock rings, nothing under it hurt), hangs at the aliens' height and runs out the aliens' ramp in gold; 10 samurai walk down it exactly as the aliens do. The camera glides there (1 s), holds, and glides back; Roger keeps control. They guard 100 m round the drop point and kill every alien there (all waves, mutants) and the T-Rex (together, in about 20-30 s); they ignore people, Roger and the Cyber Yeti. Nothing but Roger's weapons (rifle, minigun 3 rounds, railgun, Fire Gun, Black Hole Gun, the Rocket Strike) can kill one. They stay 120 s, board and the ship leaves; one squad at a time; 60 s cooldown after it leaves.
  - **Rocket Strike:** a 6 s fall seen from the rocket's nose (altitude, distance, wind and flame streaks, rising rumble and shake, a whistle); W A S D nudge the impact point up to 28 m from the marker, the last second locked. Impact: the tanker's explosion at twice its reach, then a fire EMP ring sweeping out 80 m — every building down, cars wrecked, trees flattened, people, enemies by their own rules (the Yeti only takes the fire), aliens, UFOs and hunters shot down, samurai, and Roger if he is inside. The mothership loses 8 of its 15 hull points. Crater, smoke column, deep boom. Then the camera returns to Roger (Hero Mode) or circles the crater for 3 s and goes back. 60 s cooldown.
  - Both cooldown (60 s) and stay (120 s) are constants in `engine/spaceship/config.js` (SUPPORT).
  - While it hovers, fly it with **W A S D**, then drop it with **Space** or **Enter**. It drops by itself after 30 s.
  - Double-click the ground first to choose where it starts.
  - The touchdown is the biggest shake in the game and damages everything within 52 m.
  - The ship stays as a landmark, up to 3 at a time.
- **🤖 Terminator:** a squad of **5** walks in from the edge of town and hunts people. With Hero Mode on, it hunts Roger instead.
  - Only an EMP stops them (see "Who kills what").
  - The tile is greyed until all 5 are destroyed.
  - They fight the aliens: a blow near fire kills an alien, otherwise it only throws it back.
  - The aliens can carry a Terminator up their ramp.
- **🕺 Smooth Criminal** (a button beside **🦸 Hero**, above the Tornado row, not a disaster tile): a tall stage rises out of the middle of town, lit violet, with spotlights, and the dancer on top of it in the Smooth Criminal look (white pinstripe suit, blue shirt, white tie, blue armband, white fedora with a black band, white socks, black shoes, long black curls).
  - `public/sounds/smooth-criminal.mp3` starts at once, looped, at the master volume. The music playlist goes quiet and the storm is turned down while it plays. **Nothing plays over it:** the Terminator and mothership tracks wait until it is over, and one already playing is cut when it starts.
  - The stage's own light (the glowing floor, the neon rims and strips, the spotlight beams) is kept 20% down from what it was, so the floor's pink and violet squares read instead of washing out.
  - The camera frames the stage for a few seconds, except in Hero Mode, Chase Mode and Control Tornado.
  - **His ascent is filmed** (in every camera mode, Hero Mode too): the camera glides out to a medium distance (24 m as he leaves the stage, 50 m at the top), a little below him, with him in the middle of the frame and sky round him. When he explodes it pulls back to 260 m so the whole violet blast, its rings and the mushroom are in the frame, holds 7 s, then gives the camera back.
  - **2 seconds after the press, everyone dances:** every person in town and every alien, each with their own moves. The dancer has his own routine: the **moonwalk**, a **spin** with a hand on the hat, the **45° lean**, up **on his toes**, **kicks**, and the **point**.
  - **No more fighting while it lasts:** the aliens take nobody and shoot nobody, the UFO and hunter ships hold their fire (lasers off, no shots at the nuclear plants), the mothership holds its beam, the Terminators and Roger's pursuers stand still, and armed people lower their guns. (The tornado still does what tornadoes do.)
  - **If Roger kills anyone** (a person or an alien, with any weapon) while it lasts, it is over ("YOU BROKE THE PEACE"). The dancing stops and everything goes back to fighting as before. The song fades out, and the dancer rises off the stage in a violet glow, spinning, up to where the ships fly (90 m). There he **explodes like a nuclear plant but in violet**: a violet flash, the fireball dome, the pressure wave across the map, a violet mushroom cloud (+30000). There is no mutation. The stage goes with him.
  - Pressing the tile again during the show ends it quietly: the stage sinks, the song stops, and everyone goes back to what they were doing. It can be played again as often as you like.

### When two disasters meet
- **Lava + flood → steam explosion**, the biggest single blast, which puts the vent out for good.
- **Electric arcs + flood water:** the whole flooded corridor becomes live, and everyone standing in the water is hurt.
- **Flood + fire:** the water puts burning buildings out.
- **Tornado + lava → Lavanado.**

## Modes
- **🕹️ Control Tornado:** you steer the funnel with **W A S D**, at its normal speed. It stops dead when you let go. One funnel only.
- **🎬 Cinematic View:** the camera orbits the tornado automatically, framed to its size.
- **Chase Mode** (🎥 Camera): you drive a car away from the storm with **W A S D**, and **Cockpit View** switches to the driver's seat.
  - The car is parked **beside the aliens' landing spot** from the start of every game (and after a Reset), off to one side of the ship and its ramp, with its headlamps on, and shows on the minimap as a **cyan car in a ring**. It is drawn **three times** the size of the town's cars, about as tall as Roger. Chase Mode starts wherever it is parked. Leaving Chase Mode parks it where you left it, or parks a fresh one if it was wrecked.
  - The storm ramps up the longer you survive: about EF4 at 36 s and EF5 at 64 s, and it keeps climbing.
  - It's over if the tornado takes the car, lightning hits it, or you drive into the chasm.
  - Top speed **34** (it was 22).
  - **Rescue:** slow down (under 10) beside people and they climb in, one every 0.3 s, and count as **safe** (rescued). This works in Chase Mode and in any car Roger drives in Hero Mode.
- **Kill-cam:** built in but **currently switched off** (`SCRIPTED_CAMERAS = false` in `engine/camera.js`), like the other automatic camera moves. When on, it replays the last few seconds of a big destruction event in slow motion from a good angle.
- **A new character called in from the panel** (🦍 Cyber Yeti, 🦖 Cyber T-Rex, 🤖 Terminator, 🧟 Patient Zero, ✨ Captain Spotless, 👊 Hank Granite): the camera **glides to it over 1 s**, eased in and out, framing it whole from the side the camera was on. Then the camera mode carries on: the free camera stays there (the new starting point); Hero Mode, Chase Mode, Control Tornado and the Cinematic View hold the shot 1.3 s and ease back into their own camera over 1 s. Hank's scene glides into its own framing instead of cutting to it. 🕺 Smooth Criminal keeps its own camera (only his ascent is filmed, see above).
- **Free camera:**
  - drag to orbit and right-drag to pan;
  - the mouse wheel zooms smoothly towards the point under the cursor;
  - W A S D pan across town when no mode is using them.

## The town and its people
- **Everything is life-size** (one unit is one metre; the full table is in `docs/SCALE.md`). People are 1.8 m. Houses are 1–2 storeys, townhouses 3–4 and blocks of flats 6–9 (19–29 m), at 3.2 m a storey with a row of windows on each. Cars are 4.5 m, the Chase Mode car included. Bicycles, hydrants and signs are their real size. Characters: Roger 1.85 m, Hank Granite 2.2 m, a Terminator 2.1 m, an alien 1.4 m, Patient Zero 2.3 m, the cyber Yeti 10.5 m (30% smaller than its 15 m, on request) and the cyber T-Rex 18 m (two giants, towering over the houses) and Captain Spotless 30 m.
- **👥 Crowd** (a panel section): how the townspeople behave when the funnel comes.
  - **Presets:**
    - **Normal**: the town as it always was.
    - **Aggressive**: about 60% are **brave**. They stand their ground facing the funnel ("Come on then!") in dark red clothes, until the wind takes them.
    - **Coward**: almost everyone runs off in a **random direction** (never straight at the funnel), weaving wildly, and forgets the shelters.
    - **Leader**: about 1 in 12 is a **leader** in an orange vest, who always makes for a shelter shouting "Follow me!". Anyone running within 28 m follows them to the same door, or their way.
    - **Mixed**: a bit of each.
  - **Sliders** (a preset sets them; they can then be moved):
    - **Panic**: how early they notice the funnel and how hard they run. 50% is as before; 100% notices it from half as far again and runs 15% faster.
    - **Herd**: how much a runner goes the way the runners around them go (within 12 m).
    - **Shelter**: how many think of a storm shelter at all.
  - Each person gets their own values, spread around the sliders. The choice stays through a Reset.
  - **👥 Crowd** (in 💥 Disasters) switches to the next preset and starts the storm if it is not running.
- 165 people at the start, plus **20 new arrivals every 30 s**, at random clear spots. The clock is the game's own, so they keep coming **with or without the storm**, including after a nuclear plant has turned everyone into aliens.
- **Armed arrivals:** everyone who arrives from **minute 2** on carries a pistol and fights back. Any alien within 38 m gets shot at every 1–2 s (a yellow tracer), and a hit (60%) kills it. They hold their fire during Smooth Criminal.
- **Behaviour:** people wander and walk in pairs. They flee from the funnel and other hazards, and run for **storm shelters**. Shelters are buildings with a green sign and a door, and anyone who gets in is safe.
- **Emergency response:**
  - **Fire engines** put out burning buildings, but not gas mains.
  - **Ambulances** collect casualties, who leave alive.
  - A **patrol car** opens a muster point, people queue there, and a **bus** drives them off the map. They only count as evacuated when the bus reaches the edge.
  - All these vehicles avoid the funnel. The fleet never respawns, so every one the storm takes is gone for the rest of the run.
- **Traffic and structures:**
  - **The train:** a freight train runs back and forth across the north side. The storm derails it, and so do the earthquake and the flood. Anything on the rails stops it: it brakes in front of a fallen building, rubble, a landed ship or a wreck, and waits until the way is clear.
  - **The bridge:** an **elevated highway** with traffic crosses town, 10 m up over 160 m. **At each end a ramp** (two sloping spans on a half-height pillar) comes down to the ground, and a ground road goes on round a bend and north to the street at z = −20. Nothing stands in front of a ramp, and it never ends in the air or at the dam. Its 10 cars drive the whole route: in at one junction, up a ramp, across, down the other ramp and out at the far junction, then back in at the start. Its pillars snap and its spans **(ramps included)** sag and fall when the storm is over them, or when debris, fissures or the flood hit them; a span hinges on the end that still stands and comes to rest on the ground, never through it. The minimap shows it, ramp to ramp, with its ground roads.
  - **Buildings on fire** burn, spread to their neighbours and can collapse, until a fire engine puts them out.
- **Humans readout:** people left alive / total, with **safe** (sheltered, rescued by ambulance, evacuated by bus) and **dead** (killed, abducted, fallen in).

## Scoring and game feel
- **Points:**
  - Every piece of destruction scores: a tree 10, a car 15, a building piece 20, a collapse 100 plus 60 per chain collapse.
  - The set pieces pay big bonuses: tanker 2500, chemical works 6000, meteors, merges, Terminators, ships.
- **Combo:** destruction within 2.5 s of the last one extends a chain. Each link adds 15% to the multiplier, up to +300%.
- **Slow motion** kicks in on a burst of heavy events. **Camera shake** is sized by what was hit and how close it was.

## Hero Mode (Roger)

### Roger's look
- Muscled: a broad chest, big shoulders and arms. A **black leather jacket** with the collar up over a white T-shirt, dark jeans, black boots, an **Elvis Presley pompadour** with sideburns, and dark glasses. The first-person sleeve is leather too.
- **Walk:** a swagger. The shoulders roll against the stride, the hips sway, there is a spring in the step, the legs are a little apart and the elbows out, and the quiff bounces.

### Spawning
- Click **🦸 Hero** to spawn Roger at a safe spot, with a marked bunker across town.
- Hero Mode does **not** start the tornado, and nothing starts it by itself while Hero Mode runs. Start it yourself with the **Tornado** button or by picking a preset (Calm, Severe, Monster), which starts the storm if it is not already running.
- Tornado control, cinematic view, Final Boss, Doomsday and Fujiwhara are switched off while Hero Mode runs.

### The Terminators
- **Two Terminators** hunt Roger at the same time. They start together about 55 m behind him, on either side, and both show on the minimap as red crosses.
- Each one reboots and comes back once after it is destroyed. Destroy each of them twice and the chase is over.
- When a Terminator (one of these two, or one of the squad from the Terminator button) comes **within 50 m** of Roger, **6 seconds** of `terminator.wav` play on top of the music. It can play again once they have all been more than 75 m away.

### Goal
- Reach the bunker (gold square on the minimap, gold beacon in town) → **SAFE**. You get double points if you also neutralised the tornado.

### Keys
**W A S D** move and steer in every mode; **the arrow keys do nothing anywhere** (since 2026-10-01). **Q** Time Slow (Bullet Time with the minigun) · **E** Teleport · **R** EMP · mouse wheel switches weapon · right-click draws / holsters · Enter or click fires. In a car, **E**, **Q** or **Esc** gets out (abilities are off while driving, so nothing clashes); **T** opens Landing Support (then R samurai, T rocket, Esc cancel) and the Rocket Strike steers on W A S D while it falls; the free camera pans on W A S D only when no mode is using them.

### Movement
Roger can go out as far as the last buildings of the town in the background (about 288 m from the centre). He stops against them and against the dam wall, instead of hitting an invisible wall a street past the town.

| Key | On foot, rifle away | Rifle drawn (first person) | In a car |
|---|---|---|---|
| W | Run forward | Walk forward | Accelerate |
| S | Back off | Walk backward | Brake / reverse |
| A | Turn left | Strafe left | Steer left |
| D | Turn right | Strafe right | Steer right |

In first person the **mouse looks** (the pointer is locked when the browser allows it).

### Weapons (the mouse wheel switches, on foot)
Roger has five weapons. The **mouse wheel** cycles through them: plasma rifle → minigun → railgun → Fire Gun → Black Hole Gun (wheel down), and back (wheel up). The HUD's weapon name is in the weapon's colour (the railgun's yellow, the Fire Gun's orange...). Q no longer switches weapons. The HUD's WEAPON line shows the one in hand. Only the Black Hole Gun uses the energy bar (the plasma rifle keeps its own charge). Whichever it is, **right-click** raises it into first person and **left-click** (or Enter) fires.
- **Plasma rifle:** as below.
- **Minigun:** fires while the button is held, 18 rounds a second, with a little scatter. **200 rounds** (back to 200, as asked), not refilled for now.
  - **Real bullets**: each round is a brass capsule with a glowing tip and a thin tracer trail, flying from the muzzle at 320 m/s; a muzzle flash on every shot, a **spent casing** spinning out of the gun and bouncing on the ground, and **sparks and dust** where it hits something hard. Its hit lands when the bullet arrives. Instanced, at most 300 bullets and 140 casings at once.
  - **Bullet Time** (press **Q** with the minigun in hand, 20% energy, **7 s**): the world drops to **3%** speed, almost frozen, while Roger moves, aims and fires at full speed. **Bullets already in the air hang where they are**, trails and all; bullets fired during it fly 5 m and hang too, building a spray of suspended rounds. The picture drains of colour under a heavier vignette, the camera drifts slowly round Roger (in first person the mouse looks round), the sound goes muffled with a deep time-warp on the way in. When it ends, **or when Q is pressed again**, every hanging bullet goes on at its own speed and direction and they hit together, with a sharp release whoosh. With any other weapon, Q is the ordinary Time Slow.
  - It hurts only **people** (one round kills) and **Terminators**: **30 rounds** bring one down, Roger's own or one of the squad. The HUD counts the hits.
  - Everything else stops the round and takes no damage: buildings, cars, trees, aliens, ships, the tornado.
- **Railgun** (**yellow** now: its coils and charge glow, its muzzle flash, its aiming ring and its HUD name; the bolt is the Lightning tile's own white-yellow): works like the 🌩️ Lightning tile. Raised, a yellow ring on the ground shows where the crosshair meets the town. **Every left-click calls one lightning bolt down there**, with everything a Lightning-tile bolt does (fires, electrocuted people, **aliens burnt**, Terminators shorted out, trees and cars thrown, the tanker, chemical works and gas mains set off). One bolt every 0.2 s at most. Not within 9 m of Roger.
- **Fire Gun:** the Cyber T-Rex's flamethrower in Roger's hands: **the same fire** (the T-Rex's flame particles at a man's scale, its roar and crackle) in a continuous cone while the button is held, 42 m long. Four times a second what is in the cone burns: **buildings catch fire**, **people go up**, **aliens burn**, and **the Cyber Yeti takes damage** (1.2 of its 30 hit points a tick: about 6 s of steady fire brings it down). **It is the only ordinary weapon that can hurt the Yeti** (the Black Hole Gun still swallows it). No energy, no ammunition. A blue pilot flame flickers at the nozzle.
- **Black Hole Gun:** aimed like the railgun: a violet ring shows where it would open and, round it, the 40 m no-escape line. **Each shot costs 50% energy** and opens a black hole there for **20 s** (it fades in, then collapses and winks out at the end). **One at a time**: firing while one is open makes it collapse at once, and the new one opens where you aimed as soon as it has gone. Not within 12 m of Roger.
  - **The look** is the purple spiral vortex (a black core, white-hot at the inside, violet, indigo, deep purple at the rim, specks riding the swirl, slowly precessing). It stays where it opens.
  - **The pull is a wind**, the Downburst's turned inwards: a radial inflow with a swirl on it, like a magnet, felt **out to 100 m** and stronger the nearer it gets. Dust and pale streaks of wind fly in along spiral paths; loose things are dragged along them and lifted; people within 70 m are blown off their feet; enemies are shoved in bodily.
  - **Within 40 m nothing escapes.** Small and medium things (people, cars, trees, debris, aliens, Terminators, clones...) are lifted, spun and drawn in on a tightening spiral, faster the nearer, stretched towards the core and shrinking until they are gone. **Big things do not fly in whole**: buildings, the Yeti, the T-Rex, the UFOs, the mothership, the nuclear plants and landed ships **dissolve where they stand**, from the side facing the hole, into fragments of their own colour that stream into the core.
  - **It swallows everything**: buildings, trees, cars, the train, tankers, people, aliens, UFOs, hunter ships and the mothership, the Terminators and Roger's pursuers, the Cyber Yeti and Cyber T-Rex, Patient Zero and his clones, the nuclear plants, props, debris, and **tornadoes** (they rope out and dissipate). What it takes is gone quietly, with no death explosion of its own. **Never Roger** or the car he drives.
  - Capped for 60 FPS: 60 drawn in at once and 6 dissolving at once (1400 fragments); anything past that simply shrinks away.

### Energy and abilities
- **Energy:** a bar of **10 segments** of 10% each (the HUD's ENERGY line, each segment filling as the level rises). A run starts at **50%**. The 🧪 test button fills it.
- **Explosions charge it.** Roger near a real explosion in town takes energy in proportion to its size, less the further out he is: a tanker or the chemical works' blast gives up to **50%** point blank (reach 60 m), a fuel station up to 37% (47 m), a gas main 25%, a factory tank 22%, a car going up 6%, a factory barrel 3%. The bar glows and the HUD says "⚡ +x% ENERGY".
  - **Anti-farm:** each explosion gives once, and at most 50% of the bar, however long he stands in its fire. His own shots (plasma, railgun, mega beam) are not explosions of this kind and give nothing.
  - Explosions do not hurt Roger: walking through them is how he charges.
  - **A nuclear plant's terminal** fills it to 100% (see **Nuclear power plants**).
- **Abilities** are on their own keys and cost whole segments. Each has a duration and a cooldown; the HUD shows it ready, running (▶) or cooling down (⌛). They are refused, with a message, while running, while cooling down, or when the energy is not there. Not while dying, safe or driving.

| Key | Ability | Cost | Status |
|---|---|---|---|
| **Q** | **Time Slow**: the world (storm, people, aliens, Terminators) runs at 30% for **7 s** (was 3); Roger, his aim and his weapons run at full speed. The HUD counts it down. Q again ends it early. **6 s cooldown** after it ends. **With the minigun in hand it is Bullet Time** instead (see **Weapons**). | 20% | on |
| **E** | **Teleport** (was W): an instant jump of **18 m** the way he looks (his aim with the weapon up), with a shimmering distortion where he leaves and where he lands. **Never into a building, over the chasm or off the map**: it lands at the farthest clear spot along that line (at least 4 m), and with nowhere to land it is refused ("no room to land that way") and costs nothing. 1.5 s cooldown. | 10% | on |
| **R** | **EMP** (was E): 0.8 s of charge (a blue glow gathering round Roger), then a pulse out to **36 m**. Everything electronic in it is knocked out: **Terminators and Roger's pursuers die**, the cyber T-Rex is stunned for 5 s (and hurt), power lines within 20 m fault. **Never Roger.** If he dies or the run ends while it charges, it fizzles. 5 s cooldown. | 30% | on |

- The abilities never affect Roger himself.
- **🧪 Abilities** (in 💥 Disasters): starts Hero Mode with a full energy bar, to try them.

### Combat (plasma rifle)
- **Right-click**: draw or put away the plasma rifle. Drawing it switches to first person with a Counter-Strike-style crosshair. **Esc** also puts it away.
- **Enter**: fire. **Hold** to charge. The left mouse button also fires and charges while the rifle is drawn.
  - Tap: normal plasma shot.
  - Hold **2 seconds** (was 3): **MEGA BEAM**. The HUD charge bar turns gold and shows **MEGA BEAM READY**, the crosshair ring fills and pulses, and the rifle glows and hums. The shot fires when you release.
- Every shot plays `sonic-boom.mp3` (louder for a mega beam) and uses 25% of the plasma cell. The cell refills over a few seconds.
- The crosshair turns red over something the beam will hit hard and shows its name and distance.

### What the rifle does
| Target | Normal shot | MEGA BEAM |
|---|---|---|
| Alien | Killed | Killed (and every alien in the bigger blast) |
| Hero Mode's Terminators (both) | Knocked flat for a few seconds | **Destroyed** |
| Terminator squad (Terminator button) | Knocked back | **Destroyed** |
| UFO (abduction ship) | 1 hull point of **6** | 5 hull points |
| Hunter ships | 1 hull point of **4** | 5 hull points (one destroys it) |
| Mothership | 1 hull point of **15** | 5 hull points (three destroy it) |
| Fuel tanker | **Explodes** | **Explodes** |
| Tornado | No effect ("too strong") | **Neutralised**: it ropes out until Hero Mode ends |
| Buildings, people, cars, trees | Blast radius 7 | Blast radius 18; buildings round the point shaken down too |

The HUD shows how much hull is left after every hit. A destroyed ship burns, falls and explodes where it lands, which also hurts anything under it, Roger included.

A mega beam is 3.5× as wide, with rings of plasma bursting out along it, fire down its length, a deep boom and a heavy camera shake.

### Death conditions → GAME OVER (Restart / Exit Hero Mode)
- **Spawn shield:** for the first **3 seconds** of a run (and after Restart), nothing can kill Roger: alien rays, ship lasers, Terminators or anything else. He blinks while it lasts.
- **Falling into the earthquake chasm.** Roger staggers at the edge and drops, on foot or in a car.
- **An alien grabbing him** (within about 2.4 m).
- **An alien ray hitting him.** Aliens aim at where he is when the gun comes up, so keep moving to dodge.
- **A ship's tracking laser catching him.** The UFO and hunter ships lock on within 100 m. The laser lands a little way off and crawls after him at 5 m/s (Roger runs at 9), for about 3 s every 3–5 s. It kills in a car too.
- **The mothership's beam running over him.**
- **A ship crashing on him.**
- **A Terminator reaching him.** Either of the two, or one of the squad from the Terminator button, which hunts Roger while Hero Mode is on.
- **A meteor landing near him** (within 22 m of the impact), on foot or in a car.
- **An EMP wave reaching him on foot:** the waves from an EMP-charged funnel and the Electric Tornado's EMP ring. He is electrocuted. **In a car he is shielded.**
- The tornado never kills Roger. Its edge dazes him for a few seconds, and it can throw him out of a car.

### Vehicles
- The nearest parked cars are marked on the minimap. The nearest one is gold, the others white.
- **The Chase Mode car** (the big one parked by the aliens): just touch its glowing **left door**. Roger gets in and drives it straight away, with Chase Mode's handling and camera, and the HUD says **CHASE MODE**. Hero Mode carries on. After getting out, walk away from it before its door will take you in again.
- Walk to a car's glowing **left (driver's) door** and press **Enter** with the rifle away to get in.
- Drive with **W A S D**. The Chase Mode camera follows the car, and it shows on the minimap as a large gold car.
- **E**, **Q** or **Esc** gets out.
- Aliens can't grab or shoot Roger while he is in a car. Ship lasers and the chasm still can.

## Aliens

### Abduction UFO (the first ship)
- Comes down at the start, before the tornado, and takes a person every 10 s.
- Two aliens escort each person to the ramp. The conveyor carries them up.
- After **4** abductions it calls in the **mothership**.
- A tornado that reaches it tears it out of the sky. So do Roger's plasma shots: 6 normal shots, or a MEGA BEAM and 1 shot.
- From 30 s after it has settled over the town, it shoots a green ray into the nearest **nuclear plant** still standing every 14 s (see **Nuclear power plants**).

### Crew
- **They dance when there is nobody left to kill:** with no humans in town, they dance where they stand. They still go for Roger if he comes near. During Smooth Criminal, all of them dance.
- **All the aliens walk and run 30% faster** than they used to (patrol, fetching people, escorting them, hunting Roger, the rampage).
- They patrol round the ship. Any within 45 m of Roger on foot go after him: they close in to grab him and shoot at him.
- Any plasma shot kills one. So does a lightning bolt (the Lightning tile or Roger's railgun), the Firenado (a burning tornado), and a Terminator's blow near fire.
- With the ship gone, they go on the rampage through town.

### Second wave (sombreros)
- **2 minutes after the first ship arrives** (it was 20 minutes), a gold transport ship comes down elsewhere in town ("SECOND WAVE"). **20 more aliens, in sombreros**, walk down its ramp one after another, then it lifts away.
- They take nobody. They go straight through town after people, and after Roger when he is near, like the first crew once its ship is gone.

### Hunter ships
- **1:30 after the first ship arrives**, two red hunter ships come down at opposite ends of town ("HUNTER SHIPS INBOUND").
- While a **nuclear plant** is standing, they go for it first: each flies to about 38 m from the nearest one and fires a red ray into it every 3.5–5 s. Only once both plants are gone do they go back to hunting people.
- Then they take nobody: each hunts the nearest person and burns them with a red laser.
- They turn their tracking laser on Roger within 100 m.
- While they are in the sky, the storm is turned down so the music is heard over the rain.
- 4 normal shots or 1 MEGA BEAM bring each one down. They show on the minimap as red rings.

### Mothership
- Arrives after **4** abductions. **6 seconds** of `space-ship-music.wav` play on top of the music as it arrives.
- Its super laser sweeps the town for 2 minutes and kills Roger if it runs over him.
- While a **nuclear plant** is standing, every pass of the beam after the first runs straight at the nearest one, and the beam sets it off.
- 15 normal shots or 3 MEGA BEAMS bring it down. It falls burning onto the town and **explodes catastrophically** where it lands, the second-biggest explosion in the game (only a nuclear plant is bigger), and much bigger than the tanker or the chemical works:
  - a white-out flash that holds and fades over about 2 s;
  - a fireball dome (a huge central blast with a ring of ten more round it);
  - a pressure wave you can see (a glowing ring on the ground and a dome) that crosses the whole map: everyone within 110 m is killed, loose things are thrown, buildings are shaken down, fires are lit out to 220 m and every tanker, the chemical works, gas main and power line in that reach goes off; aliens within 110 m burn, and Roger dies inside it;
  - 46 secondary blasts walking out behind the wave;
  - a **mushroom cloud** that climbs 250 m out of the fireball, glowing, cools to smoke and hangs over the town for about 30 s;
  - if it comes down on a nuclear plant, that plant goes too.
- Its beam sets off everything explosive it passes over: the tankers, the chemical works, the gas mains, the power lines.

## 🐄 The cows
- A **fenced pasture** on the southern edge of town (around (58, 104), 40 × 22 m) with **8 cows** grazing: a slow amble, heads down to the grass, turning back at the fence.
- They are ordinary physics objects: **a funnel that comes by lifts them** like anything else (lighter than a car, heavier than a box). Each **moos** as it leaves the ground (no sound file: two sawtooths through a closing filter), louder the nearer the camera.
- Wherever they come down they get back on their feet and **graze right there**, in the middle of the road if need be. Counted in the **Air cowboy** mission. Reset puts the herd back in the field.

## 🦖 Cyber T-Rex
- **🦖 Cyber T-Rex** (in 💥 Disasters): an **18 m** cyber T-rex (39 m nose to tail) with steel plates, spikes, glowing vents, a red eye and a flame nozzle on its snout walks in from the edge of town. One at a time; the button is off while it lives. **The camera glides to it** when the button is pressed.
- **What it goes for:** a Yeti in town first (see the stalemate below); then Roger in Hero Mode (it comes in on his side of town); otherwise the nearest standing building not yet alight.
- **Flame breath:** once its target is within 52 m it breathes fire for 2.6 s, every 5–8 s: a cone **60 m** long. Buildings in it **catch fire** (the ordinary fire system, which spreads on its own from there), people in it die, **aliens in it die**, and so does **Roger** ("TOASTED").
- **Walking:** 7.3 m/s, straight through town. A building it walks into is shaken (and can come down), cars under its feet (7.5 m) are thrown, people crushed. Every footfall **shakes the camera and thuds**, by how near it lands (out to 160 m).
- **Fighting it** (40 hit points; unchanged): a plasma shot takes 3, the **mega beam kills it outright**, the minigun chips 0.3 a round, lightning and the railgun 8, an **EMP 6 and stuns it for 5 s** (eye and vents dark). The rifle and minigun aim at it like any target.
- **Killed:** it topples over and its tanks blow up: an explosion Roger can take energy from, fires round it, **+5000**.

### 🦍 vs 🦖 The stalemate
- **Whenever a Yeti and a T-Rex are both in town they go for each other**, at once if they came in together, and stop 92 m apart, face to face.
- The T-Rex breathes fire and the Yeti fires its cold gun, both at once and without a break. **The two beams meet in the middle and cancel out:** neither goes past the meeting point. There: steam billowing up, sparks of fire and ice, an ice-and-fire burst with a crack every half second or so, a light flickering orange and blue, and the hiss and crackle of it.
- It lasts **exactly 15 s** ("STALEMATE"). Then both stop, break off, and **hunt Roger** from then on (outside Hero Mode: what they went for before). **That pair never fights again.** A new Yeti or T-Rex called in later starts a stalemate of its own.
- Neither hurts the other. Roger can still hurt either while it lasts; one of them falling ends it.

## ❄️ Frozen, 🦍 Cyber Yeti and the Blizzard
- **Frozen:** what freezes stands in a block of ice until it thaws (it cracks away).
  - **Enemies** (Terminators, pursuers, aliens, the T-Rex, the Yeti) stop dead for the time. (The Yeti never freezes the T-Rex: they are a match.)
  - **Roger** frozen cannot move, fire or use an ability; the cold itself never kills him.
  - **People** become **ice statues**, pale blue and glassy, which **shatter at any impact** (the funnel catching one, being thrown, struck) into ice shards that fly like any other debris.
- **🦍 Cyber Yeti** (in 💥 Disasters): a **10.5 m** giant (30% smaller than the 15 m it was; everything that goes with its size shrank with it: hitbox, reach, speed, footfall shake, the cold gun's cone (38 m), its storm (14 m), its voice higher and heard less far), **half yeti, half cyborg**. The yeti half (its left): shaggy white and ice-blue fur with the hair showing, a blue-grey face, hand and foot, its own dark eye under a furred brow. The cyborg half (its right): a metal arm and a metal leg with bare joints ringed in cyan and pistons along them, a steel plate over half its face with a glowing cyan eye, plating over the chest with a glowing core and cables. Inside its own **ice storm** (snow whirling round it out to 14 m). One at a time. **The camera glides to it** when the button is pressed. It walks at 7.5 m/s; every footfall shakes the camera and thuds.
  - **The cold gun** (a Mr. Freeze blaster in its metal hand): once what it goes for is within **55 m** it raises the gun and fires **without a break**, a cone of cold: a pale-blue frost beam, ice crystals blown down it, and **frost settling on the ground** (it melts after 9 s). Everything in the cone freezes: **people become ice statues** (which shatter at any impact), **aliens** (and the other small fry) freeze in blocks of ice for 4 s, and **Roger** by the storm's rule.
  - Roger standing in the storm, or in the cone, for 1.5 s **freezes for 3 s**; the Yeti reaching him (9 m) kills him ("SHATTERED" if frozen, "MAULED" if not).
  - Enemies in the storm freeze for 4 s; people become statues.
  - It goes for a T-Rex in town first (the stalemate, above), then Roger in Hero Mode, otherwise the nearest person. 30 hit points, and **only fire hurts it**: Roger's **Fire Gun** (1.2 a tick). Plasma, the mega beam, the minigun and the railgun (and the Lightning tile) do nothing to it; an EMP still stuns it for 3 s (its storm stills) but does not hurt it. The Black Hole Gun swallows it. Killed, it bursts into ice (energy for Roger, +3000).
- **❄️ Blizzard** (in 💥 Disasters, on until pressed again): every funnel becomes an **ice tornado**, glowing pale blue with snow driven round it.
  - Near a funnel (1.7 × its capture edge): people turn to **ice statues**, enemies freeze for 5 s, Roger for 3 s.
  - **The dam's water freezes**: the reservoir ice-white, and a flood already out stops dead where it is until the Blizzard ends.
  - **The earthquake's lava freezes**: every vent and the caldera lake are put out under a crust of ice, and the chasm's lava is iced over with its glow gone.
  - **No fire in an ice tornado**: a burning funnel is put out, and it cannot catch while the Blizzard lasts.
  - Switched off: the water and the chasm thaw; statues stay ice until something breaks them; the lava that was put out stays out.

## 🧟 Patient Zero
- **🧟 Patient Zero** (in 💥 Disasters): a sickly green figure, a head taller than anyone, with a **glowing green halo**: the original. It walks in from the edge of town.
- **It copies itself:** a new clone every 2.5 s, and **anyone it or a clone touches is infected** (gone, and a clone stands in their place). **At most 50 clones.**
- Clones go straight for the nearest person (or Roger, in Hero Mode) and die to any hit. Touching Roger: "INFECTED".
- **The original** takes 12 hit points (plasma 3, the mega beam kills it, minigun 0.5, lightning 6, EMP 4). **When it dies, every clone dies with it.** +2000.
- The Black Hole Gun, the EMP and freezing work on them like on any enemy.

## Random events (original characters)
- **👊 Hank Granite** — **only from his button** (he no longer turns up by himself during a run, on request): a bearded action hero in a red bandana, dark glasses, a black vest and jeans walks into town. A cinematic scene of about 14 s:
  - The camera locks on him, black bars top and bottom; **the world slows to 35% and the player keeps control**.
  - He walks towards the camera; **five townspeople line up** in front of him.
  - **One punch every 2 s**, a different ending each time: one is blown apart into a cloud of particles; the others are thrown like rag dolls, tumbling, off the edge of the map, and gone (+500 each).
  - He nods, and is gone in a puff of dust. The camera and the world's time come back.
  - **Low gravity afterwards**: the town has not quite got over him. For **10 s gravity is 30%** of normal (easing back over the last 3 s), and **every parked car within 45 m of where he stood hops off the ground** and floats down slowly. "LOW GRAVITY". Only when the scene plays to its end (not on a Reset).
- **✨ Captain Spotless** — once a run, 120–260 s in (and from the panel): a giant of light, white and gold with a golden halo, strides straight across the town in 16 s with a ring of clean light 22 m round his feet.
  - **Everything it touches comes up spotless**: debris gone, fires out.
  - **Enemies in it are disintegrated molecularly** (a burst of sparkling motes).
  - **A blinding glare** as he comes on, fading as he goes. +1000, and "✨ SPOTLESS · n things cleaned".

## 🌊 Waterspout
- A tornado over water: **the lake behind the dam** (no new ocean). **🌊 Waterspout** in 💥 Disasters, or **at random once an Outbreak is under way** (two or more funnels; once a run, 20–60 s in).
- A spinning column of spray, 110 m tall up into the clouds, rises off the lake and wanders across it for 45 s, drawn to the nearest boat.
  - **Waves**: rings racing out from its foot, and the whole lake sloshing.
  - **Spray and mist** at its foot, carried up the column and blown off it.
  - **🦈 Sharkspout**: the lake has sharks in it. From 1.5 s after it rises, **every 3 s it pulls a shark out of the water**, spins it up the column and **flings it over the dam into the town** (anywhere within 110 m of its middle) (at most 6 at once). Where one lands: a splash, **anyone within 3 m is knocked flat** (dazed, not killed), and the shark flops about for 4 s before it is gone (+200 each). The first one: "SHARKSPOUT!".
  - **Boats**: five small boats ride the lake. One it reaches is lifted, spun up the column, thrown out and broken on the water, and sinks (+300). Reset puts them back.
  - It **no longer breaks the dam**: the flood starts only from the Dam Break button (or Doomsday).
  - **Sound**: a whirling roar over the slap of the waves, louder the nearer the camera.

## 🌋 Volcano
- **🌋 Volcano** (in 💥 Disasters): a volcano rises **over the earthquake's caldera** if there is one; otherwise out on open ground towards the edge of town, **with an earthquake** to go with it.
- **The cone grows where you can watch it**: over 22 s to 50 m high and 90 m across, dark rock streaked with glowing lava and a burning crater on top. Buildings where it rises come down; people keep away; Roger cannot walk into it.
- **The eruption** (60 s, from when it is half grown): **lava bombs** thrown from the crater on their own arcs, trailing fire and smoke, mostly at buildings up to 150 m away. Where one lands: a burst, **buildings within 9 m catch fire** (and the fire spreads on its own), people within 4 m die, and so does Roger under it ("LAVA BOMB").
- Then it sleeps, smoking; the button (off while it erupts) wakes it again. Reset takes it away.
- **The ❄️ Blizzard freezes it**: no bombs, the crater white and the lava dark, until the Blizzard ends.

## 🎯 Missions
- A panel section, **🎯 Missions**: one timed mission at a time. They count from what the game already records, from the moment they start:
  - **Demolition**: bring down **30 buildings in 60 s** (+5000).
  - **Evacuation**: get **50 people out on the evacuation buses in 4 min** (+6000).
  - **Fire crew**: **burn every alien on the ground with the Firenado in 2 min** (+7000). The goal is how many aliens are down when it starts; with none, it will not start ("call the UFO first").
  - **Safe house**: get **40 people into the storm shelters in 90 s** (+4000).
  - **Air cowboy**: send **4 cows up the funnel in 2 min** (+3000).
- A tracker at the top of the screen shows the mission, a bar, the count and the time left (red under 10 s). Done: "✅ COMPLETE" and the reward added to the score; out of time: "❌ FAILED". A Reset ends it.
- **🎯 Mission** (in 💥 Disasters) starts the storm and Demolition.

## Nuclear power plants
- **Two**, at opposite corners of town (about (-100, 100) and (102, -104)): two cooling towers breathing steam, a domed reactor, a turbine hall with the yellow radiation sign, and a red-and-white stack with a blinking red light. On the minimap they are yellow radiation signs, and a green crater once gone.
- **Only four things can destroy one:**
  - **the mothership:** its beam (it aims its passes at them), or the ship crashing onto one;
  - **the alien ships: 5 hits.** The UFO and the hunter ships target the plants while any is standing. Each hit makes the reactor glow greener and smoke, with a banner counting the containment down ("containment 3/5");
  - **Roger's MEGA BEAM** (a normal plasma shot only sparks off: "REINFORCED CONTAINMENT");
  - **the Electric Tornado** (⚡ Electric on) running straight into it.
  Nothing else touches them: not the storm, the tankers, the chemical works, meteors, lightning, or the other plant blowing up.
- **Meltdown:** once destroyed it goes critical for about 2 s ("MELTDOWN!"): the reactor pulses green, the site shakes and small blasts go off. Then it blows up.
- **The explosion, the biggest in the game:**
  - a full white-out flash that holds for over half a second and fades over about 3.5 s;
  - a fireball dome (a central blast with a ring of sixteen more);
  - a pressure wave that crosses the whole map: buildings shaken down all over town, fires out to 300 m, every tanker, gas main, power line and the chemical works in that reach set off, and the far town flattened. Only people within 55 m are killed outright; Roger dies within 55 m;
  - 70 secondary blasts;
  - a **mushroom cloud** that climbs 380 m and stands over the town for most of a minute;
  - +30000 points.
- **The green EMP.** Out of the blast comes a ring of green light, with a glowing green wall on it (and two fainter echoes behind it), travelling at 55 m/s out across **the entire map**. It is on the minimap as a green ring.
  - **Every person it passes is mutated into an alien:** a green bolt comes down on them; over **2 seconds** they glow green, shake, stretch and shrink away while an **alien in a sombrero** grows up out of the same spot. It then goes through town after the people left and after Roger, like the sombrero second wave. People in the air when the ring passes are mutated when they land.
  - The mutants can be killed like any alien (plasma, lightning, the Firenado, a Terminator's blow near fire).
  - Up to 150 aliens can be on their feet at once. Past that, the green bolt simply kills.
  - The ring also knocks out the power lines and **kills the Terminators** it passes (it is an EMP).
  - **Roger is not mutated** (he is the hero), and people inside vehicles are not reached.
  - A green flash crosses the screen as the ring passes the camera.
  - Once the ring has crossed the whole town, a message says **"ALL HUMANS ARE ALIENS NOW"**, with how many were turned. New humans still arrive every 30 s, armed from minute 2.
- **The mutation goes in batches:** the ring queues the people it reaches and at most 8 are turned a frame, so a crowd does not stall the biggest explosion in the game (a crowd of 160 takes about a third of a second).
- **🔌 Plugging in (Hero Mode):** each plant has a **charging terminal** at the front corner of its pad (a grey cabinet with a glowing panel). Roger standing at it on foot, while the plant stands, is plugged in: an arc crackles to him and his energy fills to **100%** (3 s from empty). He can walk off at any time and keeps what he took. After it has given anything, the terminal **cools down for 60 s** (panel red; green when ready, pulsing yellow while charging). A destroyed or critical plant gives nothing.
- **Test buttons** (💥 Disasters): **🔌 Plug In** starts Hero Mode with 10% energy and puts Roger at the nearest terminal; **☢️ Meltdown** sends a plant critical (in Hero Mode, the one farthest from Roger). Both are disabled once no plant stands.
- The site is left a green-glowing crater. Both plants come back with **Reset**.

## Lighting
- The ambient light is 25% brighter than the base scene.
- After the first major destruction of a run (a collapse, a blast, a flood, a crash…), it brightens by a further 50% over 2 minutes and stays there.

## The panel (UI)
- **Sections, all folded at the start:** 🎮 **Presets** (Calm, Severe, Monster), 🌪️ **Storm**, 🔊 **Sounds**, 🎥 **Camera**, 💥 **Disasters**, 📊 **Readout**. Click a header to open or close it. A folded header still shows its key value (the active preset, the wind speed and category, the points).
- **Look:** aquamarine on dark teal. The main actions (🕹️ Control Tornado, 🌪️ Tornado) are solid aquamarine keys and the secondary actions are dark teal. A mode that is on is lit aquamarine. Disaster tiles are dark with the disaster's colour as a bar down the left edge. **🦸 Hero** (✕ Exit Hero while it runs) and **🕺 Smooth Criminal** are two small pills side by side, and they pulse while on.
- **Presets:** the active preset is highlighted in aquamarine with a ✓ badge, and its name shows in the folded header ("Custom" once a slider is moved).
- **Disasters:** every disaster is the same kind of tile, like Ignite:
  - ⚡ Electric, 👹 Final Boss (the EF5 wedge, renamed), ☠️ Doomsday, 🌀 Fujiwhara (twin vortices · rotation merge), 🔥 Ignite, 🌎 Earthquake, 🌊 Dam Break, ☄️ Meteors, ⬇️ Downburst, 🌩️ Lightning, 🛢️ Gas Main, 🛸 Landing, 🤖 Terminator.
  - Each has its own colour and shows what it does when you hover over it.
  - The tiles that stay on (Electric, Final Boss, Doomsday, Fujiwhara) and a Downburst in progress pulse while active.
- **Game feel:**
  - Buttons glow on hover and shrink to 95% when pressed. Everything animates over 0.2 s.
  - Disaster tiles darken on hover and glow in their own colour.
  - The humans line reads 👥 STANDING BY until the storm starts.
- **Layout:** tight spacing between sections, chunky square-ish buttons with one-line labels, and a dark semi-transparent panel over the 3D scene.

### 🔊 Sounds
- **Sound**: Mute and the volume slider, as before.
- Three separate switches, each on or off. They are **remembered between sessions** (in this browser) and **a Reset does not change them**:
  - **Rain**: the rain drawn over the town.
  - **Rain sound**: the storm's wind-and-rain hiss. The game has no separate rain recording; the hiss is what the rain sounds like. The storm's low rumble stays.
  - **Music**: the background music. An event's own track still plays: the Terminator, the ships, Smooth Criminal's song.
  - **Creature sounds**: the creatures' voices, steps, attacks and deaths (see below).
  - **Track** (two buttons beside it): **🎵 Guta · Drobeta** (the playlist, the default) or **🏙️ City sound** (the old `city-sound.wav`, looped, levelled to the playlist's loudness). Switching crossfades over about a second; the first time City sound is chosen the playlist keeps playing until its file has loaded. Remembered between sessions, like the switches.

## Controls everywhere else (W A S D only; the arrows do nothing)
- **Chase Mode:** W/S drive, A/D steer.
- **Control Tornado:** W A S D steer the funnel.
- **Landing Support:** T opens the marker; R samurai, T rocket, Esc / right-click cancel; W A S D steer the rocket.
- **Free camera:** W A S D pan. The mouse wheel zooms smoothly towards the point under the cursor.

### 🐾 Creature sounds (`engine/sound/creatures.js`)
Every creature's sounds come from where it is (they pan left and right and fade with distance), procedural like the rest. The bigger it is, the lower it sounds and the farther it is heard; the giants' roars and steps shake the camera when near. The **Creature sounds** switch in 🔊 Sounds mutes all of it. A crowd shares a few voices (each kind of sound has a minimum gap, at most 18 play at once, and the quietest is cut first); nothing too far away to hear is played.

| Who | Appears | Idle / held | Moving | Attack | Hurt | Death | Special |
|---|---|---|---|---|---|---|---|
| Aliens (crew) | a chirp down the ramp | warbling chirps and clicks, each alien its own pitch; one hover hum for the crowd, at the nearest | (the hover hum) | laser zap | (one hit kills) | wet squelch | **abduction beam** hum while it runs |
| Cyber Yeti | roar | | deep stomps; the metal leg's servos every other step | roar on a blow; servo as the gun comes up | grunt | dying roar and the crash | **cold gun**: airy, icy, crackling hiss while it fires; ice crackling over everything it freezes |
| Cyber T-Rex | huge roar | | metal stomps with a clank; hydraulic hisses | a roar before the fire (half the time); **flame**: a low roaring whoosh while it breathes | screech | long roar falling, and the crash | |
| Yeti vs T-Rex | | **the clash** at the meeting point: steam hiss, sizzle, a low roar, a pressure tone climbing over the 15 s; ice-and-fire bursts with a crack | | | | | stops when the stalemate ends |
| Hank Granite | "dun, dun" | | footsteps | "hah!" and the punch landing | (none: nobody hurts him) | (he never dies) | gone in a puff (whoosh) |
| Terminators | booting up | | metal footsteps | servo and the blow | a clang on every hit | powering down, circuits crackling | |
| Patient Zero | a low groan | groans now and then | footsteps (the original) | a snarl on every touch | snarl | groan and squelch | |
| Clones | | groans, sharing a few voices | | snarl | | squelch (a swarm dying shares a few voices) | |
| Captain Spotless | a bell chime | a held shimmer of light (a soft chord) | huge soft footfalls | a sparkle for each enemy disintegrated | (none) | (he walks off) | |
| Already had sounds, unchanged | the ships (laser, explosions), the landing ship, Roger's pursuers (steps, zaps), the cows (moo), the people (screams), **Michael** (his song) | | | | | | |

## Sound files
- `public/sounds/sonic-boom.mp3`: every rifle shot.
- `public/sounds/space-ship-music.wav`: 6 s over the music when the mothership arrives.
- `public/sounds/terminator.wav`: 6 s over the music when a Terminator comes within 50 m of Roger in Hero Mode.
- `public/sounds/guta.mp3` and `public/sounds/drobeta.mp3`: the music.
- `public/sounds/smooth-criminal.mp3`: the Smooth Criminal tile's song, looped while the show is on (the playlist goes quiet under it).

**Music:** (with 🎵 Guta · Drobeta chosen) `guta.mp3` plays to its end, then `drobeta.mp3` to its end, then guta again, and so on, for as long as the game is open. Nothing stops or restarts it: Roger dying or living, a run starting or ending, Chase Mode, the Terminators, the ships. The Terminator and mothership tracks only play a few seconds **on top of it**. While they do, the music dips a little and the storm (wind and rain, thunder, effects) is turned down. The storm is also turned down while the hunter ships are in the sky. Chase Mode's `car-music.wav` is switched off, since it would clash.

The game runs without them, with only a console warning, and plays them once they are in `public/sounds`.
