# Tornado Simulator — Gameplay Design

This document describes the gameplay experience. For the current numeric values, see `.claude/rules.md`; the runtime code is the source of truth, and the documentation must stay in sync with it.

## The opening

The camera opens on the aliens' landing site, with their ship arriving and the Chase Mode car parked nearby. The opening message gives the player an urgent goal: stop the abductions before the mothership arrives.

## The storm

The player starts the tornado from its button or by choosing a preset. Hero Mode does not start the storm. Roger's MEGA BEAM can neutralise a tornado; after it ropes out, the player can call another one.

The funnel pulls loose things inward, lifts and spins them, then flings them back out. Trees are uprooted, cars tip and fly, and buildings shed roofs and walls before collapsing. A collapse can shock neighbouring buildings into a chain reaction. Flying debris is dangerous in its own right. Shelters are sturdy, but not invulnerable.

The storm hunts survivors after its opening wandering phase. Fallen power lines can carry a fault down the grid and charge the funnel with EMP discharges. Funnels may orbit and merge into a larger storm.

Storm presets set the character of the wind, rotation and debris. The controls let the player tune the storm while it is running. At night the town is dark; Day Mode changes the scene to daylight.

## Destruction and fire

Violent impacts can trigger fuel tankers, chemical works, gas mains, power lines and fuel stations. Fuel stations progress from a leak to a fire and then a blast; nearby vehicles and other stations can join the chain. Nuclear plants are governed by their own restricted destruction contract.

Explosions throw objects, damage buildings, start fires and can trigger one another. Fire spreads between buildings until the emergency crews intervene. The Firenado is the tornado itself burning: it leaves burning ground, kills aliens it reaches, and increases destruction scoring. It cannot exist without a grounded tornado.

## Lightning and other disasters

The Lightning tile turns the pointer into a strike reticle. The player can call strikes at a chosen point or sweep them across town. Lightning starts fires, electrocutes people, shorts Terminators, uproots trees, flips cars and faults power lines. Roger's railgun calls the same kind of bolt.

The disaster panel offers distinct events rather than starting them with the storm: electrical weather, the Final Boss wedge, Doomsday, Fujiwhara, Ignite, earthquake, dam break, meteors, downburst, lightning, gas-main rupture and Landing Support. Earthquakes open a chasm and can expose lava; a tornado crossing lava becomes a Lavanado. A dam break sends a destructive flood through town, while a Blizzard freezes water, lava and living things. Meteors leave craters, and a downburst drives straight-line wind across a chosen area. The Solar Storm tile sets off a solar flare: after a five-second countdown, auroras unroll down the sky and a blackout crosses the town street by street. Windows and streetlamps go dark, every engine dies (traffic, the train, the tanker, the chase car and Roger's own car coast to a stop), and the machines lock up as the wave reaches them: Terminators, Roger's pursuers and the Cyber T-Rex freeze twitching and sparking, while the alien ships sag in the air with their lights stuttering and hold their fire. Surges come every few seconds and lock them up again, glitching the picture and Roger's HUD; halfway through, the great surge puts an auroral corona straight overhead. After about half a minute the power comes back the way it went. The storm itself damages nothing. In Hero Mode it is Roger's chance: his EMP (R) reaches further and runs down the power lines, so every pole near him fires an EMP of its own.

A waterspout rises over the lake behind the dam only when the player calls it (its button or a scenario); it never appears by itself during an Outbreak.

The town is a closed basin behind the dam. The flood is opaque and turbulent, carries wreckage, damages buildings piece by piece, and eventually drains so the dam can be broken again. Fire is put out by flood water; electricity in flood water becomes a hazard; lava and flood water can create a steam blast.

## Landing Support and special events

Landing Support lets the player call Samurai Support or a Rocket Strike at a chosen point (each has its own cooldown). The samurai ship leaves once the last samurai is down the ramp; the squad stays on the ground until no hostile has been near for a few seconds, a time limit passes or all have fallen. The samurai protect the town from aliens and the T-Rex while ignoring civilians, Roger and the Cyber Yeti. The rocket arrives in a filmed descent and devastates its impact area; enemies still follow their own damage rules.

Smooth Criminal is a staged interruption to the disaster. A violet-lit platform rises, the music takes over, and townspeople and aliens dance. Fighting pauses while the peace holds. If Roger breaks it by killing someone, the dancer ascends and detonates in a violet spectacle; choosing the event again ends it quietly.

Doomsday sequences disasters in order. Switching it off stops future events in the sequence, not events already underway.

## Modes and controls

Control Tornado steers the funnel. Cinematic View orbits it. Chase Mode puts the player in a car and turns the storm into a driving escape. The free camera orbits, pans and zooms; W A S D pan only when another mode does not own those controls. Keyboard and mouse actions are routed through the active mode, so the same input does not control two systems at once.

The Chase Mode car begins beside the aliens' landing site. In Hero Mode Roger can drive it or enter other parked cars. Driving offers protection from alien grabs and rays, but does not protect against every threat.

## The town and its people

The simulation uses life-size world units. People flee hazards, seek shelters, form pairs and follow crowd tendencies. Crowd presets shape whether they panic, stand their ground, or follow leaders. The player can tune panic, herding and shelter-seeking independently.

New arrivals keep the town populated whether or not a tornado is active. Later arrivals carry weapons and fight aliens. Fire engines handle building fires but not gas mains; ambulances collect casualties; evacuation buses take people off the map. Emergency vehicles avoid the funnel and are not replaced after they are lost.

Traffic and structures are part of the disaster. The train stops for obstructions and can derail. The elevated bridge has ramps and ground roads; its pillars can snap and spans can sag to the ground. Cows graze in a fenced pasture and return to grazing wherever they land after being lifted.

## Scoring and feel

Destruction earns points, and large set pieces award bonuses. A short chain of destruction builds a combo multiplier. Heavy events can trigger slow motion; impacts also shake the camera according to what happened and how close it was. These effects amplify the spectacle without deciding what the simulation can damage.

## Hero Mode

Roger arrives at a safe spot facing the town and roams it freely: there is no bunker to reach and no win line, the run lasts until he dies or leaves. He wears his own Storm Ranger suit, built as a figure of his own rather than a padded townsperson: a slim navy under-suit with pearl armour over the chest, forearms and shins, gold accents, longer legs with knees that bend as he runs, a closed helmet with a dark glass visor and a cyan line at the eyes (no face to look odd), a glowing tornado emblem on the chest and a spinning Storm Core on his back that turns faster as he runs. No name hangs over his head any more; two small bars float there instead, health on top (red when low, outlined while it regenerates) and the energy segments under it. He can choose between the plasma rifle, minigun, railgun, Fire Gun, Black Hole Gun, Katana and Gravitron using the weapon wheel. The Gravitron opens a gravity rift where it is aimed: inside a 40 m circle, cars, people and aliens float up, then gravity slams back and everything that went up explodes where it lands. The right mouse button raises or holsters the weapon; the trigger fires. The plasma rifle charges into a MEGA BEAM, the minigun can enter Bullet Time, the railgun calls lightning, the Fire Gun projects the T-Rex's flame, and the Black Hole Gun draws objects into a vortex. The Katana is a melee weapon that costs no energy and cuts aliens and people: selecting it draws it from the sheath on the back, right-click raises first person (right-click again, or wheeling to another weapon, lowers it), with the crosshair at the centre; with the button up the mouse looks, and with it held the view is frozen and you drag a line from the crosshair; letting go cuts along that line. A plain click runs a chain of cuts. Q is Time Slow, as with every other weapon, and the Katana cuts in it. A cut slices the alien in two along the line, with a glowing cut face and green goo; each half can be cut again (three cuts an alien) and fades after about six seconds. A person falls in two as well, with red blood and a red cut face. Three blows destroy a Terminator; other enemies in reach take a small chip of damage from the blade (never a cut); nuclear plants, the mothership and tornadoes are untouched, and hunter ships and the samurai are ignored.

Roger has a health bar (100 points) over his head, above his energy. The plasma rifle has no cell of its own: it only waits 0.35 s between shots, and its screen reads READY, the charge or MEGA. It glows after 4 seconds without damage, starts refilling at 7 seconds and is full about 4 seconds later; any new hit resets the timer. A red vignette, a direction arrow and hurt, heartbeat and recharge sounds tell him how bad it is. The Katana now also hurts other enemies in reach, though only slightly; it never harms nuclear plants, the mothership or tornadoes.

Roger also has Time Slow, Teleport, EMP and a grappling hook (G). The hook flies the way he looks: it reels an alien in to sword's reach, and pulls Roger himself along its cable to a wall or to an enemy too heavy to pull, such as a Terminator or a giant. Thrown at an enemy, Roger shouts **GET OVER HERE!** (spoken by the browser over a growl, with an arena echo); the chain is drawn with visible links inside an orange glow, with a steel kunai and a spark on its end, and it rattles out and clanks where it bites. Space jumps; Space again in the air fires the **jetpack**, built and flown like CJ's in San Andreas (two thrusters at his hips, a grip in each hand): 4 s of fuel, Space held climbs, released hovers, W A S D fly him about, with flames, smoke and a roar, for 10% energy once per flight, then he falls and can land on a roof, walk on it and drop off its edge; the landing never hurts. Energy comes from explosions and nuclear terminals. Weapons, abilities and enemies have distinct interactions; consult `.claude/rules.md` for the exact combat contracts and values. With telekinesis (C) he lifts the car he is looking at and holds it floating in front of him (in first person it follows the mouse); C again or a click throws it, and it explodes on the first enemy, alien, tree or building it hits.

### The Terminators

No machine hunts Roger when a run starts. The Terminators come only when the player sends them, with the panel's Terminator tile (on a phone also the 🤖 button): a squad of 5 comes in round Roger, about 62 m out, each from a different side, facing him, and the camera cuts to two of them for 1.6 s each before handing back. Outside Hero Mode the squad comes in round the edge of town.

A tornado can daze Roger or throw him from a car, and debris and ice only daze or freeze him; none of them takes health or is a lethal source.

### On a phone or tablet

On a touch screen Hero Mode clears the screen and puts the controls under the thumbs. The control panel, the co-op box and the install button step aside, and the HUD becomes a strip along the top with a small minimap under it. The left thumb is a floating joystick: put it down anywhere on the lower left and push. On foot Roger runs the way the stick points on screen, as fast as it is pushed, and swings round smoothly; raised into first person he walks and strafes; in a car it steers. The right thumb looks while aiming and turns Roger on foot. FIRE raises the weapon if it is down and fires; held, the rifle charges its MEGA BEAM and the minigun keeps firing. With the Katana it slashes on foot, and in first person the right thumb's drag while FIRE is held is the cut line. AIM raises or lowers the weapon, the weapon button switches to the next one, and five buttons fire the abilities: Time Slow (Bullet Time with the minigun), Teleport, EMP, the grappling hook and telekinesis. They light up while running and dim while cooling down or short of energy. A car button appears at a car's glowing door and while driving, the 🤖 button in the top right sends in the Terminators (dimmed while the squad is out), and ✕ leaves Hero Mode. On foot the top strip hides itself so the town is in view; health and energy are read from the bars over Roger's head, and the strip comes back when he aims, drives or has a message. In first person a gentle aim assist eases the view toward the enemy nearest the crosshair inside a small cone, a little harder while FIRE is held, so a thumb can aim. A pinch or a double tap never zooms the page. `?touch=1` forces these controls on a desktop and `?touch=0` turns them off.

### Death conditions

Most threats now drain the health bar instead of killing outright: an alien's ray (20), an alien's touch (34), a Terminator's touch (50, with a visible 0.6 second wind-up inside 6 metres), a hunter ship's laser (50), a UFO's laser (20), the T-Rex's flame (33 a second), ordinary fire (10 a second), lava (50, again every 1.5 seconds) and a flood crest (50, once). Melee touches are at least 3 seconds apart per attacker and reach about 2 metres. Some threats still kill in one blow, each with its own message: the mothership's beam and crash, the Cyber Yeti, the black hole (which now also swallows its caster), a nuclear blast, the chasm, explosions ("Caught in the blast"), a meteor, a lava bomb, a falling ship, an EMP wave on foot and Patient Zero. Friendly fire is on: Roger's own plasma blast can hurt him, and in co-op a partner's weapons, explosions and the black hole can hurt the other player. Each co-op player has their own bar; a player at zero is downed and can be revived, and the run ends when both are down. The spawn shield and the revive shield still protect him. Other threats can end the run. The spawn shield, vehicle protections and death conditions are implementation contracts, not tuning suggestions.

## Aliens and enemies

The abduction ship arrives before the storm. Its crew escorts people up the ramp; enough abductions call in the mothership. The crew later rampages through town. A second wave of sombrero-wearing aliens arrives by transport, and hunter ships attack people and nuclear plants; every Roger weapon except the Katana can hurt a hunter ship, and the Black Hole Gun pulls it in. Every weapon now hurts every enemy: where a weapon used to do nothing it chips a small fraction of the enemy's health, and the old immunities became weaknesses. The mothership sweeps the town with its beam and can be brought down by Roger. It no longer shakes the camera (nor does the earthquake): while it arrives and fires, every screen shake is held off so Roger can aim. Instead it is felt on the ground like a helicopter landing, only far worse: a wind blasting down and out from the beam's foot raises a storm of dust and grit with a ring blown out on every gust, bends the trees flat, blows loose wreckage and cars around, knocks people off their feet and pushes Roger (much harder on the jetpack), all under a roaring wind with a rotor's beat. Its crash still shakes.

Terminators are resistant to ordinary environmental destruction and have specific EMP and Hero Mode interactions (other weapons only chip them). Samurai can still be killed only by Roger's weapons, never by enemies or disasters; the Fire Gun is now a slow way to kill one (50 ticks). Aliens, the Cyber Yeti, the Cyber T-Rex, Patient Zero, samurai and other characters each have their own damage rules. Do not infer vulnerabilities from visual effects; use the per-enemy contracts in `.claude/rules.md` and the implementation.

The Cyber T-Rex walks through town and breathes fire. The Cyber Yeti brings a local ice storm and freezes its targets. When both giants meet, their fire and cold beams cancel at a stalemate; after it ends they hunt Roger instead. Patient Zero creates clones and spreads infection. It is a Replicator: a gaunt, twitching machine of dark chrome blocks with acid-green veins, claws of light and red eyes, the original crowned with turning shards. Every clone visibly builds itself from a stream of blocks (from the original along a green link, or out of the person it just infected), and a clone shot down falls apart into blocks. At 15 clones they dissolve, rebuild in a ring 100 metres around Roger and close in from every side, throwing shards (8 damage each); shooting a gap in the ring is the way out. Left alive for 75 seconds (with a warning 15 seconds before), the original evolves: it rises in a cyclone of blocks and grows half again as big, with a second pair of arms, two scythes of light from its back and a second crown; it is faster, buds clones faster and reaches further, though the same shots still kill it. A hit that does not bring a Replicator down throws green sparks and loose blocks off it and makes it flinch. Captain Spotless cleans debris and fires while disintegrating enemies. Hank Granite's arrival briefly slows the world and leaves the town in low gravity.

A nuclear plant is a major set piece with a health value of its own: the MEGA BEAM, alien ship hits and the Black Hole Gun destroy it quickly, and every other weapon except the Katana only chips it. The mothership and tornadoes are the same (the Katana never harms them), and a tornado now has health that Roger can wear down. Its blast devastates the area and sends a green EMP wave through the town, mutating people into aliens. Charging terminals at the plants let Roger refill his energy while the plant is still intact.

## Sound and presentation

Creature sounds are spatial and procedural. Music continues through ordinary play, while event tracks and Smooth Criminal have their own mix behaviour. The sound panel controls rain, music, creature sounds and the selected background track. The UI keeps storm controls, disasters, camera, sound and readouts in compact sections over the scene.

## Changelog Notes

These notes preserve the historical context that was embedded in the former combined gameplay guide. They are not active gameplay rules.

- The second tornado delay changed from 1 minute 30 seconds to 30 seconds.
- The Chase Mode top speed changed from 22 to 34.
- The minigun ammunition count returned from 600 to 200.
- Time Slow duration changed from 3 to 7 seconds (2026-10-02: now 5 seconds with the world at 10% and a 3 s cooldown); the current charge-to-MEGA-BEAM time changed from 3 to 2 seconds.
- Teleport moved from W to E; EMP moved from E to R.
- The mothership is called after 4 abductions rather than 5.
- Hunter ships now arrive 90 seconds after the first ship; earlier values were 150 and 120 seconds.
- The sombrero second wave arrives after 2 minutes rather than 20 minutes.
- Alien movement speed was increased by 30 percent. The Cyber Yeti was reduced from 15 m to 10.5 m, with its reach and effects scaled to match.
- The Cyber T-Rex's 40 hit points were explicitly retained as unchanged.
- Smooth Criminal's stage lighting was reduced by 20 percent from its earlier level.
- Satellite funnels were disabled; the earthquake disaster was re-enabled and no longer starts by itself during a run.
- Shooting a tanker no longer creates a free-standing flame tornado; Ignite requires a grounded tornado. Waterspouts no longer break the dam, and no longer appear automatically in an Outbreak: the player triggers one from its button.
- Hank Granite became panel-triggered rather than appearing automatically. The arrow keys were disabled on 2026-10-01.
