# Reguli de implementare și contracte de gameplay

Codul runtime este sursa de adevăr pentru comportamentul implementat. `.claude/rules.md` indexează contractele numerice verificate în cod, iar `GAME_DESIGN.md` descrie experiența și păstrează notele istorice. Când documentația diferă de cod, sincronizează documentația la valoarea runtime; nu schimba comportamentul codului într-o sarcină de documentare.

## Reguli HARD

### R-001 — Siguranța critică a lui Roger față de tornadă
**Regula:** Nu permite tornadei să-l omoare pe Roger. Tornada îl poate ameți sau îl poate arunca din mașină, dar nu este o condiție letală. **Sursă:** `GAME_DESIGN.md`, „Death conditions”, extras din propoziția „The tornado never kills Roger. Its edge dazes him ... and it can throw him out of a car.” **De ce:** aceasta este o regulă critică de siguranță/design care previne ca hazardul de bază să devină o moarte inevitabilă.

### R-002 — Mesajul de început
**Regula:** Păstrează pragul de 4 abducții pentru mesajul de deschidere și durata mesajului de 7 s. **Sursă:** `GAME_DESIGN.md`, „The opening”, extras din „before they abduct 4 people” și „(7 s)”. **De ce:** stabilește obiectivul și ritmul introductiv al jocului.

### R-003 — Sosiri și populație
**Regula:** Pornește cu 165 de oameni; adaugă 20 la fiecare 30 s, până la 420 în viață simultan. Sosirile înarmate încep la minutul 2. **Sursă:** `GAME_DESIGN.md`, „The town and its people”, extras din „165 people at the start”, „20 new arrivals every 30 s”, „up to 420 alive” și „minute 2”. **De ce:** modificările alterează densitatea simulării, presiunea asupra CPU-ului și echilibrul dintre oameni și invadatori.

### R-004 — Al doilea funnel și vânătoarea
**Regula:** Cheamă al doilea funnel la 30 s după primul, o singură dată și numai când este unul singur activ; începe vânătoarea supraviețuitorilor după 30 s. Fujiwhara adaugă al treilea funnel după 60 s. **Sursă:** `GAME_DESIGN.md`, „The storm” și „Automatic events in a run”, extras din „30 seconds”, „once per run”, „first 30 s” și „after a minute”. **De ce:** acestea controlează escaladarea stormului și compatibilitatea cu modurile care cer un singur funnel.

### R-005 — Controale și preseturi de storm
**Regula:** Păstrează intervalele: intensitate 0–1; vânt 20–320 mph; rază 10–50 m (default 30 m, 60 m peste); rotație 0.5–6 rad/s; debris count 10–50; mărimea debris 0.4–2.5×. Preseturile rămân Calm (0.25, 80 mph, 14 m, 1.5 rad/s, 15, 0.8×), Severe (0.75, 220 mph, 30 m, 3.5 rad/s, 40, 1.0×) și Monster (1.0, 320 mph, 44 m, 5.5 rad/s, 50, 1.6×). **Sursă:** `GAME_DESIGN.md`, „The storm”, extras din intervalele sliderelor și tabelul „Presets”. **De ce:** aceste intervale și combinații definesc puterea, scara și lizibilitatea tornadei.

### R-006 — Clădiri și Fujiwhara
**Regula:** O clădire se prăbușește după pierderea a 3 pereți. Două funnel-uri se pot uni când ajung la aproximativ 30 m; rezultatul are dimensiunea 2.4× și acordă bonusul +1500. **Sursă:** `GAME_DESIGN.md`, „The storm”, extras din „loses 3 walls”, „within about 30 m”, „2.4×” și „+1500”. **De ce:** pragurile controlează colapsurile în lanț, citirea fuziunii și recompensa.

### R-007 — Power line EMP
**Regula:** După ce doboară o linie, funnel-ul rămâne încărcat 10 s și emite o undă EMP la fiecare 3.5 s. **Sursă:** `GAME_DESIGN.md`, „Power lines”, extras din „EMP-charged for 10 s” și „every 3.5 s”. **De ce:** EMP-ul este unul dintre răspunsurile letale la Terminators și trebuie să aibă ritm previzibil.

### R-008 — Reacții explozive
**Regula:** Păstrează cele 5 tankere explozive totale, dintre care 4 parcate la aproximativ 118 m de centru; nu include centralele nucleare în lista țintelor explozive obișnuite. **Sursă:** `GAME_DESIGN.md`, „Destruction and fire” și secțiunea originală „Explosions”, extras din „fuel tankers (all five)”, „Four parked tankers” și „118 m”. **De ce:** centralele au un contract separat de distrugere, iar numărul și amplasarea tankerelor susțin lanțurile de explozie.

### R-009 — Fuel station: faze și propagare
**Regula:** Păstrează cele 3 stații și cele 3 faze ale fiecăreia: leak 4 s, fire 2.5 s, apoi explozie cu fum 16 s. O explozie secundară poate sări leak-ul și să detoneze după 1–1.5 s; o stație la 60 m poate urma. **Sursă:** `GAME_DESIGN.md`, „Destruction and fire”, extras din „Fuel stations (three in town)”, „three acts”, „Leak (4 s)”, „Fire (2.5 s)”, „smoke ... 16 s”, „1–1.5 s” și „within 60 m”. **De ce:** alterarea fazelor poate elimina avertizarea vizuală/audio sau poate rupe ordinea reacțiilor în lanț.

### R-010 — Fuel station: distanțe și scor
**Regula:** Păstrează razele de efect ale stației: clădiri 34 m, obiecte aruncate 42 m, oameni omorâți 11 m, tankere/gas mains/lines declanșate 22 m; acordă +900 pentru acestea. **Sursă:** `GAME_DESIGN.md`, secțiunea originală „Explosions > Fuel stations”, extras din propoziția despre blast și „(+900)”. **De ce:** razele stabilesc raza de risc locală și prevenirea/propagarea exploziei.

### R-011 — Limitele lanțului de explozii
**Regula:** Limitează o reacție la adâncimea 3, la 14 secundare în așteptare, la 5 mașini pornite de un blast și la 2 mașini declanșate de fiecare mașină secundară. **Sursă:** `GAME_DESIGN.md`, „Destruction and fire”, extras din „at most 5”, „set off 2 cars”, „depth 3” și „at most 14 secondaries”. **De ce:** limitează explozia în cascadă și numărul de efecte procesate simultan.

### R-012 — Lightning targeting
**Regula:** Un click cheamă 3–5 strikes; ținerea pe loc repetă volley-ul la fiecare 0.5 s. Strike-ul electrocutează într-o rază de aproximativ 4 m. **Sursă:** `GAME_DESIGN.md`, „Lightning and other disasters”, extras din „3–5 rapid strikes”, „every half second” și „within about 4 m”. **De ce:** aceste valori definesc densitatea focului și aria de pericol pentru oameni.

### R-013 — Tipuri de damage acceptate
**Regula:** Păstrează imunitățile specifice: Terminators sunt opriți de EMP/Lightning și de MEGA BEAM în Hero Mode; aliens sunt uciși de plasma, lightning, Firenado și de lovitura Terminatorului numai când există foc; Cyber Yeti primește damage de la foc, EMP doar îl stun-ează, iar Black Hole Gun îl consumă separat. Nuclear plants pot fi distruse numai de mothership, alien ships după 5 hits, MEGA BEAM sau Electric Tornado. Samurai ignoră oamenii, Roger și Yeti; numai armele lui Roger îi pot ucide. **Sursă:** `GAME_DESIGN.md`, „Aliens and enemies”, „Landing Support” și secțiunea originală „Who kills what”, extras din propozițiile pentru Terminators, Aliens, Yeti, Samurai și Nuclear plants. **De ce:** registrul `enemies.js` filtrează după tipul acceptat, iar handler-ele dețin efecte diferite; vizualul unei arme nu acordă vulnerabilitate.

### R-014 — Fereastra și ținta abducțiilor
**Regula:** Abducțiile se petrec la fiecare 10 s pe durata ferestrei de 120 s a navei; după 4 oameni luați, cheamă mothership-ul. **Sursă:** `GAME_DESIGN.md`, „Aliens and enemies” și secțiunea originală „Abduction UFO”, extras din „every 10 s” și „After 4 abductions”; durata ferestrei este definită de `src/app/tornado/engine/aliens/config.js:45-47`. **De ce:** determină ritmul invaziei și pragul pentru faza mothership.

### R-015 — Alien și hunter ship: hull și timp
**Regula:** UFO-ul are 6 hull points; hunter ship-ul are 4. O lovitură normală face 1, MEGA BEAM face 5. Hunter ships sosesc la 90 s, sunt 2, țin distanța de 38 m față de centrale și trag spre ele la fiecare 3.5–5 s. UFO-ul începe să tragă spre o centrală la 30 s după ce s-a stabilizat și repetă la fiecare 14 s. **Sursă:** `GAME_DESIGN.md`, „Aliens and enemies” și secțiunile originale „Hunter ships”/„Abduction UFO”; `src/app/tornado/engine/aliens/config.js:110-135`. **De ce:** valorile definesc sănătatea navelor, presiunea asupra centralelor și escaladarea luptei.

### R-016 — Storm și dezastre temporizate
**Regula:** Electric trimite EMP ring la fiecare 9 s. Doomsday păstrează secvența: earthquake 0 s, gas mains 6 s, dam 12 s, meteors 19 s, Electric 27 s, sinkhole 33 s, Final Boss 39 s, Ignite 48 s. Final Boss rămâne un EF5 cu un singur funnel și refuză Chase Mode, Control Tornado și Fujiwhara cât timp este activ. **Sursă:** `GAME_DESIGN.md`, „Disasters”, extras din descrierile Electric, Doomsday și Final Boss. **De ce:** secvența este ritmul central al modului Doomsday; Final Boss nu poate coexista cu modurile care cer alt număr sau control al funnel-urilor.

### R-017 — Firenado
**Regula:** Firenado durează 13 s; declanșarea automată cere cel puțin 3 clădiri în flăcări în 30 m și se poate întâmpla o dată pe run; în timp ce arde, damage scoring este ×1.5. **Sursă:** `GAME_DESIGN.md`, „The storm” și „Disasters > Ignite”, extras din valorile curente ale secțiunii Ignite. **De ce:** durata, pragul și multiplicatorul îi definesc rolul ca fereastră temporară de combat/scor.

### R-018 — Earthquake și Lavanado
**Regula:** Earthquake durează 10 s, cu magnitudine 6.5–8.8; lava apare peste 7.9, iar sinkhole-ul peste 7.1. **Sursă:** `GAME_DESIGN.md`, „Disasters > Earthquake”, extras din paragraful „10 s of shaking” și pragurile Lava/Sinkhole. **De ce:** pragurile controlează apariția hazardurilor și combinarea cu funnel-ul.

### R-019 — Dam break, meteors și downburst
**Regula:** Păstrează wave height de aproximativ 24 m la breach și 15 m spre capăt; volley-ul de meteori conține 5 rocks; downburst-ul durează 32–46 s la 120–165 mph. **Sursă:** `GAME_DESIGN.md`, „Disasters > Dam Break”, „Meteors” și „Downburst”, extras din descrierile numerice ale acestor evenimente. **De ce:** acestea definesc scara vizuală și zona de impact a hazardurilor.

### R-020 — Landing Support: Samurai
**Regula:** Păstrează inelul de coverage de 100 m, echipa de 10 samurai, camera glide de 1 s, timpul de luptă aproximativ 20–30 s, timpul de staționare 120 s și cooldown-ul de 60 s. Samurai omoară aliens și T-Rex-ul din zonă, dar ignoră oamenii, Roger și Yeti; numai armele lui Roger pot ucide un samurai. **Sursă:** `GAME_DESIGN.md`, „Landing Support”, extras din „100 m coverage”, descrierea Samurai Support și constantele citate din `engine/spaceship/config.js (SUPPORT)`. **De ce:** schimbarea afectează aria apărată, puterea echipei și disponibilitatea repetată a suportului.

### R-021 — Landing Support: Rocket Strike
**Regula:** Păstrează căderea de 6 s, corecția impactului de maximum 28 m (cu ultima secundă blocată), raza ringului de 80 m, damage-ul de 8 din 15 mothership hull, revenirea camerei după 3 s, cooldown-ul de 60 s, plecarea automată după 30 s, damage-ul touchdown-ului în 52 m și limita de 3 nave-landmark. Rocket Strike distruge țintele din zonă conform regulilor lor; Cyber Yeti primește numai damage-ul de foc. **Sursă:** `GAME_DESIGN.md`, „Landing Support > Rocket Strike”, extras din propozițiile despre fall, nudge, EMP ring, hull, cameră, cooldown și touchdown. **De ce:** orice abatere schimbă aria de distrugere, controlul în cădere sau puterea loviturii.

### R-022 — Terminator squad și Smooth Criminal
**Regula:** Terminator tile-ul cheamă o echipă de 5. Smooth Criminal păstrează reducerea luminii de 20%, cadrele la 24 m/50 m/260 m, hold-ul camerei de 7 s, dansul pornit după 2 s și ascensiunea până la 90 m; încălcarea păcii acordă +30000. **Sursă:** `GAME_DESIGN.md`, „Landing Support and special events” și secțiunile originale „Terminator”/„Smooth Criminal”, extras din aceste descrieri numerice. **De ce:** valorile definesc scara scenei, momentul schimbării de stare și recompensa.

### R-023 — Chase Mode și tranziții cameră
**Regula:** Păstrează intensitatea de aproximativ EF4 la 36 s și EF5 la 64 s; top speed-ul este 34; salvarea începe sub viteza 10 și preia un om la fiecare 0.3 s. Tranziția de cameră la un personaj folosește glide de 1 s, hold de 1.3 s și revenire de 1 s. **Sursă:** `GAME_DESIGN.md`, „Modes and controls”, extras din Chase Mode/Rescue și descrierea character camera glide. **De ce:** acestea definesc controlul mașinii și timing-ul camerelor scripted.

### R-024 — Scară, crowd și drumuri
**Regula:** Păstrează scara life-size: 1 unitate = 1 m; casele au 1–2 etaje, townhouses 3–4, blocurile 6–9 etaje și 19–29 m înălțime, cu 3.2 m per etaj. Oamenii au 1.8 m, mașinile 4.5 m, Roger 1.85 m, Hank 2.2 m, Terminator 2.1 m, alien 1.4 m, Patient Zero 2.3 m, Yeti 10.5 m, T-Rex 18 m și Captain Spotless 30 m. Roger poate ajunge aproximativ la 288 m de centru. Crowd: Aggressive aproximativ 60%; Leader aproximativ 1 din 12; raza follower 28 m; slider Panic 50–100%, viteza la 100% +15%; Herd 12 m. Bridge-ul este la 10 m înălțime, lung de 160 m, cu 10 mașini. **Sursă:** `GAME_DESIGN.md`, „The town and its people”, extras din scala personajelor, crowd presets, movement bounds și bridge. **De ce:** alterarea scării schimbă coliziunile, navigarea, lizibilitatea și distanțele de gameplay.

### R-025 — Armed arrivals și alarmă creaturi
**Regula:** După minutul 2, oamenii sosesc înarmați; trag asupra alienilor în 38 m la fiecare 1–2 s, cu șansă de hit de 60%. Nu permite mai mult de 18 voci de creaturi simultan. **Sursă:** `GAME_DESIGN.md`, „The town and its people” și „Sound and presentation”, extras din „Armed arrivals” și limita de voci. **De ce:** aceste limite influențează răspunsul de luptă, mixajul și costul audio.

### R-026 — Scor și combo
**Regula:** Scorurile de bază rămân: copac 10, mașină 15, piesă de clădire 20, colaps 100 plus 60 per chain collapse; bonusurile tanker 2500 și chemical works 6000. Obiectivul Hero Mode dublează punctele dacă Roger neutralizează și tornada. Combo: fereastră 2.5 s, +15% per link, plafon +300%. **Sursă:** `GAME_DESIGN.md`, „Scoring and feel” și „Hero Mode”, extras din tabelul de puncte, obiectiv și „Combo”. **De ce:** acestea sunt recompensa numerică pentru distrugere și nu trebuie multiplicate din nou pe o cale paralelă.

### R-027 — Enemy registry și score path
**Regula:** Respectă lista `accepts` și handler-ul `damage` fiecărui enemy; nu considera acceptarea loviturii drept kill. Trimite scorul prin `damage.addDamageScore()` și combo event-urile prin sistemul `gamefeel` existent. **Sursă:** `src/app/tornado/engine/enemies.js:14-16, 122-124`; `src/app/tornado/engine/damage.js:81-97`; `src/app/tornado/engine/gamefeel.js:43-48`; `GAME_DESIGN.md`, „Aliens and enemies” și „Scoring and feel”. **De ce:** damage-ul, stun-ul, knockdown-ul și consumarea sunt rezultate diferite, iar scorer-ul comun compune multiplicatorii existenți.

### R-028 — Hero Mode: Terminators
**Regula:** Păstrează 2 pursuers la aproximativ 55 m în spatele lui Roger; fiecare revine o dată după distrugere. Alarma pornește în 50 m, redă 6 s și poate relua după ce toate au depășit 75 m. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > The Terminators”, extras din descrierea de spawn și alarmă. **De ce:** acestea controlează numărul amenințărilor, durata urmăririi și evitarea repetării audio.

### R-029 — Minigun și Bullet Time
**Regula:** Minigun-ul trage 18 rounds/s, are 200 rounds, viteza glonțului 320 m/s și limite de 300 bullets/140 casings. Bullet Time costă 20% energy, durează 7 s, rulează lumea la 3%, suspendă glonțul nou după 5 m și cere 30 hits pentru un Terminator. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Weapons > Minigun”, extras din toate valorile de foc, muniție, pooling și Bullet Time. **De ce:** valorile controlează DPS, consumul, pool-urile instanced și fereastra de slow motion.

### R-030 — Railgun și Fire Gun
**Regula:** Railgun-ul trage cel mult o dată la 0.2 s și nu lovește la mai puțin de 9 m de Roger. Fire Gun: con de 42 m, un tick la fiecare 0.25 s (4/s), iar asupra Yeti-ului aplică 1.2 damage/tick din 30 HP. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Weapons > Railgun/Fire Gun”, extras din valorile curente; `src/app/tornado/engine/hero/fireGun.js` pentru tick logic. **De ce:** ritmul și distanțele definesc damage-ul și evită auto-lovirea.

### R-031 — Black Hole Gun
**Regula:** Păstrează costul de 50% energy, durata 20 s, raza de influență 100 m, zona fără scăpare 40 m, knockdown-ul persoanelor la 70 m și distanța minimă de 12 m față de Roger. Permite o singură gaură deschisă: o lovitură nouă o închide și apoi deschide următoarea. Nu consuma niciodată Roger sau mașina pe care o conduce. Limitează obiectele trase simultan la 60, dissolving la 6 și fragmentele la 1400, pentru ținta documentată de 60 FPS. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Weapons > Black Hole Gun”; `src/app/tornado/engine/player/blackHole.js:46-60`; `src/app/tornado/engine/player/blackHole/dissolve.js:28-35`. **De ce:** contractul cuprinde balanțarea armei, siguranța lui Roger și costul maxim al efectelor.

### R-032 — Energy și abilități
**Regula:** Bara are 10 segmente, începe la 50%; testul Abilities o umple la 100%; exploziile pot încărca până la 50% o singură dată per eveniment. Recompense: tanker/chemical până la 50% în 60 m, stație 37% în 47 m, gas main 25%, factory tank 22%, car 6%, factory barrel 3%; terminalul nuclear umple la 100%. Time Slow: 20%, 7 s, cooldown 6 s, lumea la 30%; Teleport: 10%, 18 m, aterizare la minimum 4 m, cooldown 1.5 s; nu ateriza în clădire, peste chasm sau în afara hărții, iar dacă nu există loc sigur refuză fără cost. EMP: 30%, charge 0.8 s, rază 36 m, stun T-Rex 5 s, linii în 20 m, cooldown 5 s; dacă Roger moare sau run-ul se termină în timpul charge-ului, anulează efectul. Nicio abilitate nu îl afectează pe Roger. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Energy and abilities”, extras din tabel și descrierea energiei. **De ce:** costurile, refuzurile și cooldown-urile sunt parte din controlul și balanța Hero Mode.

### R-033 — Plasma cell și MEGA BEAM
**Regula:** Plasma cell-ul are 100%; o lovitură consumă 25%, se reîncarcă cu 16 puncte procentuale pe secundă (aproximativ 6.25 s de la zero la plin), iar cooldown-ul loviturii este 0.35 s. MEGA BEAM cere hold de 2 s și are lățime 3.5×. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Combat (plasma rifle)”, extras din „uses 25%” și „hold 2 seconds”; valori exacte din `src/app/tornado/engine/hero/config.js:59-74`. **De ce:** afectează rata de foc, timpul de revenire și pragul dintre lovitura normală și atacul încărcat.

### R-034 — Efectele complete din tabelul rifle
**Regula:** Păstrează toate rezultatele tabelului: Alien — normal kill, MEGA BEAM kill în blast-ul extins; cei doi Hero Mode Terminators — normal knockdown (cod: 2.8 s), MEGA BEAM destroy; Terminator squad — normal knockback, MEGA BEAM destroy; UFO — 1/5 hull damage din 6; hunter ships — 1/5 din 4; mothership — 1/5 din 15; tanker — explodează la ambele lovituri; tornado — shot normal fără efect, MEGA BEAM îl neutralizează până la sfârșitul Hero Mode; buildings/people/cars/trees — blast radius 7 normal și 18 MEGA BEAM, cu clădiri din jur zguduite de MEGA BEAM. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > What the rifle does”, extras din fiecare rând al tabelului; `src/app/tornado/engine/hero/config.js` pentru knockdown. **De ce:** tabelul definește explicit target-by-target atât gameplay-ul cât și excepțiile de damage.

### R-035 — Death conditions și protecții
**Regula:** Spawn shield-ul durează 3 s la început și după Restart. Alien grab-ul se declanșează la distanță sub 1 m. Tracking laser-ul lock-ează în 100 m, se deplasează cu 5 m/s față de viteza lui Roger de 9 m/s, ține 3.2 s și revine la fiecare 3–5 s. Meteorul omoară în 22 m. Păstrează și condițiile fără prag numeric: chasm, alien ray/grab, mothership beam, ship crash, Terminator, EMP pe jos și meteor; Roger este protejat de EMP când este în mașină. **Sursă:** `GAME_DESIGN.md`, „Hero Mode > Death conditions”; `src/app/tornado/engine/aliens/config.js:101, 104-106`; `src/app/tornado/engine/aliens/crew.js:573`; `src/app/tornado/engine/aliens/weapons.js:155-157`; `src/app/tornado/engine/hero/config.js` pentru spawn shield și viteza lui Roger. **De ce:** aceste limite definesc supraviețuirea, urmărirea laserului și telegraph-ul pericolelor.

### R-036 — Abducții, hunter ships și mothership
**Regula:** UFO-ul sosește înaintea tornadei, ia o persoană la fiecare 10 s și cere 4 abducții pentru mothership; tornada care îl atinge îl doboară, iar UFO-ul cade și după 6 lovituri normale sau o MEGA BEAM plus una. Al doilea wave sosește după 2 minute cu 20 aliens; hunter ships vin după 1:30, în număr de 2, și cad la 4 shot-uri normale sau o MEGA BEAM. Mothership-ul are 15 hull, cade după 15 shot-uri normale sau 3 MEGA BEAMS, ține beam-ul 2 minute, redă intro audio 6 s, iar crash-ul folosește flash de aproximativ 2 s, kill radius 110 m, incendieri 220 m, 46 secondary blasts și cloud până la 250 m care stă aproximativ 30 s. După prima trecere a beam-ului, fiecare trecere ulterioară țintește centrala nucleară cea mai apropiată care încă stă. **Sursă:** `GAME_DESIGN.md`, „Aliens and enemies”, extras din „Abduction UFO”, „Second wave”, „Hunter ships” și „Mothership”. **De ce:** acestea sunt pragurile de progresie ale invaziei și ale finalului ei.

### R-037 — Cows și Cyber T-Rex
**Regula:** Păstrează turma de 8 cows și pasture-ul de 40 × 22 m la aproximativ (58,104). T-Rex-ul are 18 m înălțime, 39 m lungime și 40 HP; începe flame breath la 52 m, ține 2.6 s la intervale de 5–8 s, cu con de 60 m; merge cu 7.3 m/s, calcă pe rază de 7.5 m, shake-ul se aude până la 160 m. Damage: plasma 3, minigun 0.3/round, lightning/railgun 8, EMP 6 și stun 5 s; MEGA BEAM omoară instant; kill bonus +5000. **Sursă:** `GAME_DESIGN.md`, „The town and its people > Cows” și „Aliens and enemies > Cyber T-Rex”, extras din descrierile măsurate. **De ce:** aceste valori definesc dimensiunea, mobilitatea și rezistența unui boss.

### R-038 — Stalemate și Cyber Yeti
**Regula:** Yeti/T-Rex se opresc la 92 m și stalemate-ul durează 15 s. Yeti: 10.5 m, viteză 7.5 m/s, storm 14 m, cold cone 38 m, trage de la 55 m; frost-ul de sol persistă 9 s, aliens din congele sale și enemies din storm îngheață 4 s; Roger îngheață după 1.5 s și rămâne înghețat 3 s; apropierea la 9 m îl omoară. Are 30 HP: foc 1.2/tick; EMP stun 3 s, fără damage. Blizzard: radius 1.7× capture edge, enemies 5 s, Roger 3 s. **Sursă:** `GAME_DESIGN.md`, „The Yeti/T-Rex stalemate”, „Cyber Yeti” și „Blizzard”, extras din pragurile și valorile de acolo. **De ce:** alterarea lor strică matchup-ul intenționat și comportamentul de freeze.

### R-039 — Patient Zero
**Regula:** Creează un clone la fiecare 2.5 s, plafonează la 50 clones. Originalul are 12 HP; damage per hit: plasma 3, minigun 0.5, lightning 6, EMP 4; MEGA BEAM îl omoară. La moartea originalului dispar toate clonele; recompensa este +2000. **Sursă:** `GAME_DESIGN.md`, „Patient Zero”, extras din descrierea clonării și tabelul de damage. **De ce:** multiplicarea necontrolată ar afecta performanța și ar modifica major dificultatea.

### R-040 — Hank Granite și Captain Spotless
**Regula:** Hank: scenă de aproximativ 14 s, world scale 35%, 5 persoane, punch la fiecare 2 s și +500 per victimă; low gravity 10 s la 30%, revenire în ultimele 3 s, cars în 45 m. Captain Spotless: o dată per run, după 120–260 s, traversează în 16 s, radius 22 m și acordă +1000. **Sursă:** `GAME_DESIGN.md`, „Hank Granite” și „Captain Spotless”, extras din descrierile numerice. **De ce:** timing-ul scenelor și recompensele nu trebuie să blocheze sau să dezechilibreze un run.

### R-041 — Waterspout și sharks
**Regula:** Waterspout durează 45 s și se ridică la 110 m; apariția automată este o dată per run la 20–60 s după Outbreak. Sharkspout începe după 1.5 s, scoate câte un shark la fiecare 3 s, până la 6 simultan, în zona de 110 m; impactul knockdown-ului are 3 m, shark-ul rămâne 4 s, recompensa este +200. Păstrează 5 boats și +300 per boat. **Sursă:** `GAME_DESIGN.md`, „Waterspout”, extras din durată, spawn și efecte. **De ce:** menține ritmul evenimentului și plafonează actorii temporari.

### R-042 — Volcano
**Regula:** Crește în 22 s până la 50 m înălțime și 90 m lățime; eruption durează 60 s; lava bombs pot ajunge la 150 m, incendiază în 9 m și omoară oameni/Roger în 4 m. **Sursă:** `GAME_DESIGN.md`, „Volcano”, extras din creștere, eruption și impact. **De ce:** dimensiunea și razele determină coliziunea și aria sigură.

### R-043 — Missions
**Regula:** Păstrează obiectivele și recompensele: Demolition 30 clădiri/60 s/+5000; Evacuation 50 persoane/4 min/+6000; Fire crew 2 min/+7000; Safe house 40 persoane/90 s/+4000; Air cowboy 4 cows/2 min/+3000. Tracker-ul devine roșu sub 10 s. **Sursă:** `GAME_DESIGN.md`, „Missions”, extras din lista obiectivelor și regulile tracker-ului. **De ce:** țintele și timer-ele reprezintă condițiile de succes ale fiecărei misiuni.

### R-044 — Nuclear plant și EMP mutation
**Regula:** Păstrează 2 centrale la coordonatele aproximative (-100,100) și (102,-104); alien ships au nevoie de 5 hits pentru containment. Meltdown: aproximativ 2 s critical; flash peste 0.5 s și fade 3.5 s; incendii 300 m, kill radius 55 m, 70 secondary blasts, cloud 380 m și +30000. EMP ring merge cu 55 m/s; mutația durează 2 s; limita este 150 aliens activi; procesează cel mult 8 persoane/frame, astfel încât 160 persoane să fie mutate în aproximativ o treime de secundă. **Sursă:** `GAME_DESIGN.md`, „Nuclear power plants”, extras din locații, meltdown, blast și mutation. **De ce:** acestea sunt limitele set piece-ului cel mai mare și ale efectului său de masă.

### R-045 — Nuclear terminals și iluminare
**Regula:** Terminalul completează energy la 100% în 3 s de la zero și are cooldown de 60 s; testul Plug In începe la 10%. Ambientul este cu 25% peste scena de bază, apoi crește cu încă 50% pe durata a 2 minute după prima distrugere majoră. **Sursă:** `GAME_DESIGN.md`, „Nuclear power plants > Plugging in” și „Lighting”, extras din timpii și nivelurile exacte. **De ce:** terminalele și iluminarea sunt feedback persistent pentru progresia run-ului.

### R-046 — Limite numerice pentru UI și sunet
**Regula:** Păstrează animația UI la 0.2 s și apăsarea la scale 95%; crossfade-ul track-urilor este aproximativ 1 s; nu reda mai mult de 18 creature voices simultan. **Sursă:** `GAME_DESIGN.md`, „Sound and presentation” și secțiunile originale „Panel”, „Sounds” și „Creature sounds”. **De ce:** limitează aglomerația vizuală și audio și păstrează tranzițiile lizibile.

### R-047 — Arhitectura și lifecycle-ul
**Regula:** Păstrează starea mutabilă pe instanța `Sim`/`ctx`, subsistemele pe `ctx.systems` și ordinea lifecycle `init`/`reset`/`dispose`; nu introduce singleton-uri globale sau sisteme paralele pentru comportament existent. **Sursă:** `CLAUDE.md`, „Architecture”, „Important systems” și „Development rules”; `src/app/tornado/engine/lifecycle.js`. **De ce:** simulările trebuie izolate și resursele trebuie resetate/eliberate în ordinea existentă.

### R-048 — Limite de performanță
**Regula:** Respectă caps: 160 enemies globale, 50 Patient Zero clones și 10,000 particles partajate. Cere `canSpawn(kind)` înainte de spawn, `particleRoom()` înainte de emitere; reutilizează pool-urile și nu aloca obiecte/tablouri în hot loops. **Sursă:** `src/app/tornado/engine/perf/caps.js:24-31, 66-83`; `src/app/tornado/engine/particlePool.js:75-125`; `CLAUDE.md`, „Performance rules”; `FINDINGS.md`, „Performance budget” și „Particle budget”. **De ce:** plafoanele sunt globale și măsurate; limite locale separate nu protejează bugetul comun.

### R-049 — Ciclul armelor și combo
**Regula:** Păstrează ordinea wheel-ului (`rifle`, `minigun`, `railgun`, `fire`, `blackhole`), input-ul wheel/trigger și HUD-ul existente. Trimite scoring prin `damage.addDamageScore()` și evenimentele combo prin `gamefeel.event()`; nu dubla scorer-ul sau multiplicatorii. **Sursă:** `src/app/tornado/engine/heroWeapons.js:52-53, 431-440`; `src/app/tornado/engine/hero/input.js:109-114`; `src/app/tornado/engine/damage.js:81-97`; `src/app/tornado/engine/gamefeel.js:43-48`. **De ce:** previne divergence între arma selectată, HUD, trigger și scor.

### R-050 — Scope-ul planului
**Regula:** Implementează doar subtask-ul aprobat. Înaintea modificării unui sistem protejat aici, citează regula relevantă în plan și raport; dacă schimbarea o contrazice, cere aprobarea utilizatorului înainte de editare. **Sursă:** `CLAUDE.md`, „AGENT WORKFLOW” și „Business / gameplay rules that must not be broken”; `.claude/agents/coder.md`, „What you may not do”. **De ce:** separă planificarea de implementare și previne schimbarea accidentală a contractelor de gameplay.

