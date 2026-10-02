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

The disaster panel offers distinct events rather than starting them with the storm: electrical weather, the Final Boss wedge, Doomsday, Fujiwhara, Ignite, earthquake, dam break, meteors, downburst, lightning, gas-main rupture and Landing Support. Earthquakes open a chasm and can expose lava; a tornado crossing lava becomes a Lavanado. A dam break sends a destructive flood through town, while a Blizzard freezes water, lava and living things. Meteors leave craters, and a downburst drives straight-line wind across a chosen area.

The town is a closed basin behind the dam. The flood is opaque and turbulent, carries wreckage, damages buildings piece by piece, and eventually drains so the dam can be broken again. Fire is put out by flood water; electricity in flood water becomes a hazard; lava and flood water can create a steam blast.

## Landing Support and special events

Landing Support lets the player call Samurai Support or a Rocket Strike at a chosen point. The samurai protect the town from aliens and the T-Rex while ignoring civilians, Roger and the Cyber Yeti. The rocket arrives in a filmed descent and devastates its impact area; enemies still follow their own damage rules.

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

Roger arrives at a safe spot and must reach the marked bunker. He can choose between the plasma rifle, minigun, railgun, Fire Gun, Black Hole Gun and Katana using the weapon wheel. The right mouse button raises or holsters the weapon; the trigger fires. The plasma rifle charges into a MEGA BEAM, the minigun can enter Bullet Time, the railgun calls lightning, the Fire Gun projects the T-Rex's flame, and the Black Hole Gun draws objects into a vortex. The Katana is a melee weapon that costs no energy and cuts aliens only: right-click draws it in the follow camera, a click or swipe cuts in one of six directions, and holding the button enters Blade Mode, which slows the world to 10 % while you draw up to three cut lines. A cut slices the alien in two along the line, with a glowing cut face and green goo; each half can be cut again (three cuts an alien) and fades after about six seconds. Every other enemy parries the blade and takes no damage.

Roger also has Time Slow, Teleport and EMP abilities. Energy comes from explosions and nuclear terminals. Weapons, abilities and enemies have distinct interactions; consult `.claude/rules.md` for the exact combat contracts and values.

A tornado can daze Roger or throw him from a car, but it is not a lethal source. Other threats can end the run. The spawn shield, vehicle protections and death conditions are implementation contracts, not tuning suggestions.

## Aliens and enemies

The abduction ship arrives before the storm. Its crew escorts people up the ramp; enough abductions call in the mothership. The crew later rampages through town. A second wave of sombrero-wearing aliens arrives by transport, and hunter ships attack people and nuclear plants. The mothership sweeps the town with its beam and can be brought down by Roger.

Terminators are resistant to ordinary environmental destruction and have specific EMP and Hero Mode interactions. Aliens, the Cyber Yeti, the Cyber T-Rex, Patient Zero, samurai and other characters each have their own damage rules. Do not infer vulnerabilities from visual effects; use the per-enemy contracts in `.claude/rules.md` and the implementation.

The Cyber T-Rex walks through town and breathes fire. The Cyber Yeti brings a local ice storm and freezes its targets. When both giants meet, their fire and cold beams cancel at a stalemate; after it ends they hunt Roger instead. Patient Zero creates clones and spreads infection. Captain Spotless cleans debris and fires while disintegrating enemies. Hank Granite's arrival briefly slows the world and leaves the town in low gravity.

A nuclear plant is a major set piece: only a small set of attacks can destroy it. Its blast devastates the area and sends a green EMP wave through the town, mutating people into aliens. Charging terminals at the plants let Roger refill his energy while the plant is still intact.

## Sound and presentation

Creature sounds are spatial and procedural. Music continues through ordinary play, while event tracks and Smooth Criminal have their own mix behaviour. The sound panel controls rain, music, creature sounds and the selected background track. The UI keeps storm controls, disasters, camera, sound and readouts in compact sections over the scene.

## Changelog Notes

These notes preserve the historical context that was embedded in the former combined gameplay guide. They are not active gameplay rules.

- The second tornado delay changed from 1 minute 30 seconds to 30 seconds.
- The Chase Mode top speed changed from 22 to 34.
- The minigun ammunition count returned from 600 to 200.
- Time Slow duration changed from 3 to 7 seconds; the current charge-to-MEGA-BEAM time changed from 3 to 2 seconds.
- Teleport moved from W to E; EMP moved from E to R.
- The mothership is called after 4 abductions rather than 5.
- Hunter ships now arrive 90 seconds after the first ship; earlier values were 150 and 120 seconds.
- The sombrero second wave arrives after 2 minutes rather than 20 minutes.
- Alien movement speed was increased by 30 percent. The Cyber Yeti was reduced from 15 m to 10.5 m, with its reach and effects scaled to match.
- The Cyber T-Rex's 40 hit points were explicitly retained as unchanged.
- Smooth Criminal's stage lighting was reduced by 20 percent from its earlier level.
- Satellite funnels were disabled; the earthquake disaster was re-enabled and no longer starts by itself during a run.
- Shooting a tanker no longer creates a free-standing flame tornado; Ignite requires a grounded tornado. Waterspouts no longer break the dam.
- Hank Granite became panel-triggered rather than appearing automatically. The arrow keys were disabled on 2026-10-01.
