# Neon Racer — master graphic & style rebuild

Ready-to-paste builder prompt. Target look: the owner’s **intro video**
(`NEON RACER` cinematic cyberpunk night race). Match that art language as
closely as a Three.js phone WebView allows. Do **not** chase film-quality
reflections or heavy real-time effects that kill frame rate on a motorola
edge 70.

**Reference (required):** the intro video the owner attached. Extract stills
yourself if needed and keep them untracked under `screenshots/art-ref/` (do
not commit the video or the stills). Palette and shapes come from that video
only; ignore earlier flat/low-poly looks when they conflict.

**Git context:** GitHub `origin/main` may lag local Mac work. If the Mac
checkout already has the Android Capacitor commit and phone-playtest fixes
(local commits such as `e7c2f64` / `c824c5a`), implement **on top of that**
local `main`. Otherwise implement on current `main` and keep Android scripts
intact if present. Commit locally. **Do not push** unless the owner
explicitly asks. Never force-push.

**Node:** use Node 22 (`export PATH="/opt/homebrew/Cellar/node@22/22.23.4_2/bin:$PATH"`
or the Node 22 that exists on the machine).

**Hard rules**
- Do **not** change driving physics, AI timing, or the race-check target.
  `npm run test:game` must stay **113.4 s**.
- Keyboard / desktop play must keep working. Touch and auto-accelerate
  behavior from the phone-playtest fixes must stay working if those files
  are present.
- Cheap models only for any agent work; no expensive model calls.
- Untracked forever: `screenshots/`, `Cars/`, `startup.sh`,
  `test-gameplay*.mjs`, `test-race.mjs`, `*.apk`, keystores.

---

## Paste from here

```
Neon Racer — master graphic & style rebuild (match the intro video)

Goal
Rebuild the game’s graphics and surroundings so they read as close as
possible to the owner’s NEON RACER intro video: cyberpunk night race,
glossy dark car, cyan + magenta neon only, wet mirror asphalt, dark
skyscraper silhouettes, heavy bloom, speed haze. This is an art-language
match for Three.js on Android (Capacitor WebView, motorola edge 70), not
a cinematic remake. Prefer look and feel over pixel-perfect fidelity.

Work in phases. Finish and screenshot each phase before starting the next.
One local commit per phase (or one commit if you keep the tree clean and
report clearly). Do not push.

=== ART BIBLE (freeze first, then code) ===

Write a short `docs/art-bible.md` (commit it) that locks:

1. Palette
   - Base: deep black, dark navy / desaturated blue (sky, unlit facades, asphalt).
   - Accents ONLY: vivid cyan and magenta / hot pink. No random rainbow neon.
   - Car bodies: glossy near-black (or very dark tinted clear-coat), not pastel
     body paint as the primary look. Neon is built into edges and lights.

2. Lighting & mood
   - Deep night. Almost no ambient fill; scene lit by neon, car lights, road
     emissives.
   - Aggressive bloom on cyan/magenta emissives.
   - Mid/far atmospheric haze (dark blue-grey) so the city reads as layered
     silhouettes.

3. Environment rules
   - Buildings: monolithic rectangular skyscraper silhouettes; dark glass /
     dark concrete; minimal daytime detail.
   - Neon: large abstract geometric logos / framing on facades; glowing strips
     on overpasses and building edges; cyan + magenta only.
   - Road: dark, wet-looking, highly reflective (fake mirror / env-map /
     planar reflection trick is OK). Lanes = continuous emissive cyan/magenta
     lines, not thick painted street paint.
   - Barriers / walls: solid glowing neon edge lines that read as light, not
     chunky plastic rails.

4. Cars
   - Low, wide, aggressive stance; sharp panels; clear rear wing / diffuser /
     splitter language from the intro.
   - Glossy dark body + integrated emissive cyan/magenta edge accents
     (skirts, splitter, diffuser, panel gaps). No loud full-body vinyl as the
     primary identity.
   - Lights: sharp V / slit cyan headlights; bracket / rectangular magenta
     taillights. Numbers remain readable (27 / 04 / 51 / 88).
   - Four cars must have DISTINCT silhouettes (Vector coupe, Vanta short
     GT4, Surge long-tail LMP prototype, Aegis wide TCR). Same paint language,
     different bodies. Surge must not look like a recolored coupe.

5. Camera & effects (mobile-safe)
   - Chase cam stays close/low (current closer chase is good; tune if needed
     so the car fills the lower-middle frame like a ground-hugging intro shot).
   - Bloom + fog first. Light tire mist / spray optional if it stays cheap.
   - Do NOT add heavy SSR, volumetric shafts everywhere, or permanent fake
     speed-streak meshes that trash GPU time on Low.
   - Respect Low / Medium / High: Low must stay playable on the edge 70.

6. Out of scope for this rebuild
   - Physics, lap timing, AI difficulty curves, career/save schema.
   - Play Store publishing, iOS, new tracks (unless scenery themes must follow
     the new bible).
   - Replacing the title string; keep “Neon Racer”.

=== PHASE A — surroundings ===

Rebuild track scenery / city / road / barriers / fog / bloom to match the
bible across all four circuits’ themes (keep circuit layouts; change look).

Files likely involved (adjust to the real tree): scenery / track mesh
builders, asphalt / barrier / kerb visuals, sky, postprocessing, theme
palettes, any “neon” materials.

Deliverables:
- docs/art-bible.md committed.
- City reads as dark monolithic neon canyon at night.
- Wet-look road with cyan/magenta lane emissives.
- Bloom + depth fog on, tuned so neon pops without washing the whole frame.
- Screenshots (untracked) at 2400×1080 landscape:
  screenshots/art-rebuild/A-city.png
  screenshots/art-rebuild/A-road-wet.png
  screenshots/art-rebuild/A-bloom-fog.png
  Look at each before claiming done.

=== PHASE B — cars ===

Replace / heavily revise the four car meshes and materials to the bible.
Update garage WebGL previews so they match what you drive (no stale SVGs /
old thumbnails).

Deliverables:
- Distinct silhouettes for Vector, Vanta, Surge (true LMP), Aegis.
- Glossy dark bodies + cyan/magenta edge neon + stylized lights.
- Numbers and identity still clear in race and garage.
- Screenshots (untracked):
  screenshots/art-rebuild/B-vector.png
  screenshots/art-rebuild/B-vanta.png
  screenshots/art-rebuild/B-surge.png
  screenshots/art-rebuild/B-aegis.png
  screenshots/art-rebuild/B-garage.png
  Plus one in-race rear chase shot:
  screenshots/art-rebuild/B-chase.png

=== PHASE C — polish pass (only if A+B are solid) ===

- Tune bloom / fog / exposure so phone screenshots match the intro mood.
- Optional cheap tire mist.
- Confirm HUD / steering wheel / pedals still readable on the new darker world
  (raise HUD contrast if neon background eats the UI).
- If `npm run android:apk` exists: rebuild debug APK and copy to
  …/Neon Racer/apk/neon-racer-debug.apk (overwrite). Report size + SHA-256.
  If Android tooling is missing, say so; do not invent an APK.

=== Verification (required, report honestly) ===

Clean-clone gate with Node 22:
  npm ci, typecheck, lint, npm test, npm run test:game (must stay 113.4 s),
  build, and build:android if the script exists.

Also:
- Play a short desktop race after A and after B; note anything broken.
- Confirm Low graphics still runs without obvious stutter in a short session
  (or say you could not measure on device).
- List every file touched per phase.

Git
- Commit locally with clear messages, e.g.
  “docs: lock neon cyberpunk art bible”
  “feat: rebuild city/road look to intro art bible”
  “feat: rebuild cars to intro neon silhouette language”
- Do NOT push. Do not commit screenshots/, apk, Cars/, startup.sh,
  test-gameplay*.mjs, test-race.mjs.
- Never force-push.

Report back
- Per phase: what changed, key files, screenshot paths, what you could not do.
- Gate table (pass/fail per step).
- Final local commit hashes.
- APK hash if built.
```

---

## How to run this

1. Give the builder the intro video (or a folder of stills extracted from it).
2. Paste the fenced prompt above.
3. Prefer running on the Mac project folder that already has the Android +
   phone-control commits, so the APK path and Capacitor scripts stay available.
4. After the builder finishes, the owner retests on the motorola before any
   push to GitHub.
