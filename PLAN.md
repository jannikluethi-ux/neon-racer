# Neon Racer — Build Plan

Planning only. This document records the project map, current status, and the ordered task list for follow-up sessions.

> **Also published to the repo root** as `PLAN.md` so later sessions and CI can find it. The authoritative copy lives here; the repo copy is updated at the same time.

**Rules for all later sessions:** one task per session, keep changes small, run the checks after every change, never commit secrets or `.env` files, stop and report if a check gets worse.

**Decisions:** all planning questions are answered — see **Decisions (answered)** at the end. Key ones: pause = separate `paused: boolean` flag; easy-brake = fix the probe location (don't loosen the check); attribution = "Neon Racer contributors"; removal scope = all `@radix-ui/*` + `src/lib/{auth,app-data,multiplayer,db.ts}` + `migrations/` and their tests (keep `zod`, `lucide-react`); sign-in = remove `gate-identity.server.ts` + `AuthProvider` entirely (no `.grok/app-env.json` reliance); publish this plan as repo-root `PLAN.md`; pin Node 22 in CI.

---

## Environment note (affects CI)

The default `node` on this machine (Homebrew `node@26.8.2`) is broken — it crashes at startup with `Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.33.dylib`. A working **Node 22** exists at `/opt/homebrew/Cellar/node@22/22.23.4_2/bin`. Every command in this plan was run against that working Node 22. The CI workflow must pin `node-version: 22` (see task c).

---

## Project map

### `src/game/` — the engine and simulation

- **`engine.ts`** — main game loop: WebGL renderer, fixed-step physics accumulator, per-frame reads of the zustand store (quality/difficulty/nonce transitions), audio + HUD sync, `requestAnimationFrame` cycle.
- **`simulation.ts`** — `createSim()` (builds APEX + 4 cars), `loadCourse()`/`buildCourse`, `stepSim()` (one fixed step: AI command → `stepCar` → gates/progress → wall respawn), countdown/restart/menu phase transitions.
- **`vehicle.ts`** — single-car physics: tire grip, engine/gearing, drift, nitro, airborne/jump, wall clamp + `crashPulse` (lines ~244–300), `latOff` projection.
- **`vehicle-def.ts`** — the four car definitions (VECTOR, VEX/ION/NYX use vector/vanta/surge): mass, grip, power, body silhouette.
- **`vehicle-stats.ts`** — derived stat block for garage cards (accel/grip/nitro/…).
- **`ai.ts`** — `aiCommand()`: difficulty table `DIFF` (easy/normal/hard: brake/pace/mistake/nitro/line/react), lookahead horizon → target corner speed → brake/throttle/steer/nitro state machine.
- **`tuning.ts`** — `AiDifficulty` type, `AI_CARS` profiles (VEX/ION/NYX: `brakeEarly`, `pace`, `apex`, `mistake`, …), `PLAYER_COLOR`.
- **`track.ts`** — spline builder (`buildSpline`/`buildFromDefinition`/`buildTrack`=APEX/`buildCourse`/`buildPad`), curvature `curv`, grip-limited corner `speed`, racing line, `projectInto`/`sampleAt`.
- **`track-def.ts`** — the 4 circuits as control points (APEX, NIGHTFALL, VELOCITY, OVERDRIVE) + their themes (city/yard/coast/core), widths, reference speeds, grid specs.
- **`race.ts`** — gate/checkpoint logic, lap/finish detection, `separateCars` collision resolution, `rankCars`, `timeGapSeconds`.
- **`store.ts`** — zustand store: phase, screen/menu flow, settings (quality/volume/steer/difficulty), save hydration, championship state, nonce-based intents (start/restart/menu) the engine consumes.
- **`save.ts`** — localStorage persistence schema (`SaveData`, `Quality`, `TouchMode`, `AiDifficulty`), version + migration.
- **`input.ts`** — keyboard/touch/gamepad → `InputCommand`; clears keys on blur/`visibilitychange`.
- **`visuals.ts`** — Three.js scene construction: car meshes (`createCarView`), `buildScene`, materials, textures, `syncCar`, `drawMinimap`, `disposeBundle`. Imports `scenery.ts`.
- **`scenery.ts`** — procedural per-theme environment (`addScenery`: city/yard/coast/core populate functions + tunnel shell). ~46 KB.
- **`audio.ts`** — WebAudio engine/tire/nitro/impact sound synthesis.
- **`championship.ts`** — cup/championship model (rounds, points, unlocks).
- **`mastery.ts`** — career/challenge/stat aggregation over a save.
- **`daily.ts`** — deterministic daily car+track pick (UTC-seeded).
- **`tires.ts`** — tire curve model used by vehicle physics + feel-check.
- **`math.ts`** — small helpers (`clamp`, `wrapAngle`, time formatting).
- **`types.ts`** — `Phase`, `InputCommand`, `CarState`, `IDLE_INPUT`.
- **`race-check.ts`** — headless race integration checks (laps, collisions, AI states, difficulty braking, wall-riding). Prints `FAIL …` lines and `process.exit(1)` on any failure. **Currently 4 failures.**
- **`feel-check.ts`** — headless handling/feel checks (cruise, launch, gears, braking distance, cornering, drift, boost). `fail()` exits immediately. **Currently passes**, prints a JSON metrics blob.
- **`globals.d.ts`** — ambient declarations.

### `src/components/`

- **`neon-racer.tsx`** — root app shell: title/garage/track/settings screens, canvas mount, lazy `import("@/game/engine")`, quality + difficulty selectors, PWA install prompt.
- **`race-screens.tsx`** — in-race HUD, countdown, results, championship screens.
- **`profile-screen.tsx`** — career/challenge stats view.
- **`previews.tsx`** — lightweight SVG car/track previews (avoids WebGL per garage card).
- **`preview-host-bridge.tsx`** — mounts the preview `postMessage` bridge (required by template).

### `src/routes/`

- **`__root.tsx`** — document shell: `<PreviewHostBridge>`, `<AuthProvider>`, head/meta/links.
- **`index.tsx`** — `/` → `NeonRacer`.
- **`src/router.tsx`** — `getRouter()` with `defaultErrorComponent`.

### Template / not-game code (`src/lib/`, `server/`, `migrations/`, `scripts/`)

- **`src/lib/auth/`** — Better Auth + gate-session + sign-in gating (10 files). Not used by any game/UI component.
- **`src/lib/app-data/`** — viewer-connector readiness/login helper. Only `preview-host-bridge.ts` imports its types.
- **`src/lib/multiplayer/p2p.ts`** — WebRTC room scaffolding, never imported.
- **`src/lib/db.ts`** — PGLite/Postgres helper, used only by the vite PGLite bootstrap plugin.
- **`migrations/auth/0001_auth.sql`** — auth schema, copied by `scripts/migration-plan.mjs`.
- **`server/middleware/grok-pwa.ts`** + **`scripts/grok-pwa-*`** — platform PWA/branding injector (must keep).
- **`scripts/browser-smoke.mjs`** — Playwright render + console-error audit (desktop + mobile).
- **`scripts/brand-check.mjs`** — og/share-card brand gate.
- **`scripts/check-auth-invariant.mjs`** — compares dev vs build `VITE_AUTH_ENABLED`.
- **`scripts/preview.mjs`**, **`scripts/with-app-env.mjs`**, **`scripts/app-env-plugin.mjs`**, **`scripts/migrate.mjs`**, **`scripts/migration-plan.mjs`**, **`scripts/sign-out-plan.mjs`**, **`scripts/write-atomic.mjs`** — template plumbing, each with `*.test.mjs`.
- **`scripts/browser-smoke-verdict.mjs`** — smoke verdict logic.
- **`scripts/grok-pwa-plugin.mjs`** / **`grok-pwa-shared.mjs`** — vite plugin + shared PWA helpers.

---

## Current status

### What works

- **Typecheck** — clean.
- **Lint** — clean.
- **Unit tests** — 195 (`scripts/**/*.test.mjs`) + 55 (`app-data`, `readiness-schedule`, `auth`) all pass.
- **Production build** — succeeds (nitro output under `.vercel/output/`).
- **feel-check.ts** — passes; produces handling metrics (cruise ~187 km/h, brake dist ~31.5 m, gear shifts, drift/boost behavior).
- **The game itself** — renders (WebGL scene, garage, HUD, results, championship, daily, career/profile screens), keyboard/touch/gamepad input, localStorage saves, low/medium/high graphics quality.
- **`npm run dev`** — starts fine via `npm run dev`.

### Failing checks (exact output)

`npx tsx src/game/race-check.ts` → **exit code 1**:

```
FAIL corner too tight 0.0458
FAIL VEX rode the wall 63 frames
FAIL ION rode the wall 45 frames
FAIL easy did not brake earlier (0 vs 0)
4 failed
```

### Additional gaps (not failing, but task targets)

- **No `npm run test:game` script.** The two game checks are only runnable by hand with `npx tsx …`. Note: `node --experimental-strip-types src/game/race-check.ts` does **not** work (extensionless relative imports fail with `ERR_MODULE_NOT_FOUND`) — `tsx` is required, and `tsx` is not a dependency yet.
- **No CI workflow** (`.github/` does not exist).
- **No pause menu**, no `Escape`/`P` handler, no auto-pause on tab hide, no Resume/Restart/Quit.
- **No README beyond a stub**, no `LICENSE`.
- **package name** is `app-builder-workspace`, not `neon-racer`.
- **Many unused npm packages** (recharts, react-hook-form, cmdk, vaul, react-day-picker, react-resizable-panels, sonner, date-fns, class-variance-authority, tailwind-merge, tw-animate-css, @tanstack/react-query, @tanstack/react-table, ~16 unused @radix-ui packages, better-auth, @electric-sql/pglite, pg, kysely, jose, lightningcss — `jose`/`kysely`/`pg`/`pglite` only under `src/lib/` which gets removed).
- **Unused template code**: `src/lib/auth`, `src/lib/multiplayer`, `src/lib/app-data`, `src/lib/db.ts`, `migrations/`, and **unused `visuals.ts` functions** (`_facadeTexture`, `_mulberry32`, `_addCoast`, `_addCore`, `_addYard`, `_addTunnel` — all dead, underscore-prefixed and unreferenced). `createCarView` and `releaseObject` are also exported but never called outside `visuals.ts`.
- **Unused `public/assets` JSON**: `tracks/*.json`, `vehicles/*.json`, `schemas/vehicle.schema.json` — no reference anywhere in `src/`, `scripts/`, `server/`, or `vite.config.ts`.
- **No bundle-size measurement** baseline (see task f).

### Baseline bundle (gzip, from `.vercel/output/static/assets/`)

| file | raw bytes | gzip bytes |
|---|---|---|
| `engine-*.js` | 659,659 | **172,116** |
| `index-*.js` | 433,180 | **135,295** |
| `routes-*.js` | 98,726 | **31,783** |
| `styles-*.css` | ~32K | — |
| **Total JS (raw)** | **1,191,565** | — |
| **Total JS (gzip)** | — | **~339,194** |

The `engine` chunk is already lazily loaded (`import("@/game/engine")` in `neon-racer.tsx`) and contains Three.js + `visuals.ts` + `scenery.ts`. `index` is the eager chunk (React + routing + zustand + UI).

---

## Task list

Each task is one session. Run `npm run typecheck && npm run lint && npm test && npm run build` after **every** change; stop and report if any gets worse.

---

### a. Make `race-check.ts` and `feel-check.ts` runnable with one command (`npm run test:game`)

**Goal:** A single script that runs both headless game checks and **exits non-zero** if either fails.

**Files to change:**
- `package.json` (add `test:game` script, add `tsx` dependency)
- (optionally) a thin runner `scripts/test-game.mjs` if we want one entry point with clear output

**Steps:**
1. Confirm `node --experimental-strip-types` cannot run these files (it fails: `ERR_MODULE_NOT_FOUND` on extensionless relative imports like `./ai`, `./types`). So we need a loader that resolves TS paths + extensions.
2. Add `tsx` as a dependency: `npm install tsx` (it's a JS package, installs fine without `-D`; but it's build-only, so if deploy skips `devDependencies` — per AGENTS.md it does — **install it as a regular dependency** so CI/dev both get it).
3. Add script: `"test:game": "tsx src/game/race-check.ts && tsx src/game/feel-check.ts"`. `&&` makes the combined command fail if the first fails. `race-check` already ends with `process.exit(1)` on any `fail()`; `feel-check`'s `fail()` calls `process.exit(1)` immediately — both already exit non-zero, so propagation works.
4. Verify `race-check` alone still exits 1 today (it does — confirmed) and that `feel-check` exits 0.
5. Confirm the combined script exits 1 while race-check is still broken (expected, until task b).

**Verify:**
- `npm run test:game` → **currently exits 1** with the 4 known race-check FAIL lines (correct behavior: any failure = error exit).
- After task b, `npm run test:game` exits 0.
- `npm run typecheck && npm run lint && npm test` all still pass.

---

### b. Fix the race-check failures

**Goal:** Get all 4 `race-check` failures green with **small, measured tuning changes** — do not raise thresholds to hide problems.

**Files to change:**
- `src/game/track-def.ts` (APEX control points — for the too-tight corner)
- `src/game/ai.ts` and/or `src/game/tuning.ts` (for wall-riding / brake probe)
- possibly `src/game/race-check.ts` (only if the `easy` brake probe itself is mis-set — see note)

**Steps (one sub-fix at a time, re-run `npm run test:game` after each):**

1. **`corner too tight 0.0458`** — threshold is `> 0.03`. The sharp spot is in `APEX_POINTS` (confirmed: `createSim(true)` → `buildTrack()` → `buildFromDefinition(APEX)`).
   - Locate the exact high-curvature sample by printing `argmax(|samples[i].curv|)` and its `dist`.
   - Open up that corner by nudging **one or two control points** (widen the turn radius), not by relaxing the `0.03` threshold.
   - Re-check: `maxC` should drop to ≤ 0.03 while the track still feels like the intended layout (lap length stays in 1600–4200 m, `est` lap stays 50–120 s).

2. **`VEX rode the wall 63 frames` / `ION rode the wall 45 frames`** — counted when `car.crashPulse > 0.3` for > 40 frames. Likely a downstream symptom of the too-tight corner pushing cars wide.
   - Fix step 1 first, then re-measure. If still over 40 frames, adjust AI line accuracy / apex depth (`tuning.ts` `lineAccuracy`, `apex`, or `brakeEarly`) by a **small** amount so rivals hold the racing line instead of scraping the barrier.
   - Confirm rivals still complete laps and finish in a sensible VEX < ION < NYX order (race-check asserts this).

3. **`easy did not brake earlier (0 vs 0)`** — **this is a test-setup bug, not an AI bug.** The probe runs `aiCommand(..., "easy")` and `aiCommand(..., "normal")` at `apex.dist - 180` with `forwardSpeed = 46`. At 180 m before the apex the car is still on the straight: `worst ≈ cruise*0.98 ≈ 51 > 46`, so `gap < 0` and `aiCommand` returns `brake = 0` for **both** runs → `(0 vs 0)`.
   - **Confirmed approach:** move the probe **to where braking actually happens** — closer to the corner (reduce `back` from 180 to a value where braking is active) **and/or** raise the probe's `forwardSpeed` above the corner's target speed so braking is required. **Do not loosen the check.** It must still prove that easy brakes earlier than hard (the `+ 0.2` margin on the assertion stays).
   - After fixing the probe, re-run: easy (higher `brakeExtra = brakeEarly + DIFF.easy.brake`) must register a higher `brake` than the comparison run at the same point.
   - **Fallback (only if it still fails after a correct probe):** nudge `DIFF.easy.brake` (currently `14`) up a little — but confirm the probe is exercising braking first. The `14` already looks generous, which is a strong hint the probe location is the real problem.

**Verify:**
- `npm run test:game` → exits 0, prints `race-check ok { … }` and the feel-check JSON.
- `npm run typecheck && npm run lint && npm test && npm run build` all pass.
- Manual browser check: APEX still drivable, rivals don't visibly scrape walls, easy difficulty is actually easier.

---

### c. Add a GitHub Actions workflow

**Goal:** CI runs install → typecheck → lint → test → test:game → build on every push/PR.

**Files to add:**
- `.github/workflows/ci.yml`

**Steps:**
1. Trigger: `push` and `pull_request` on `main`.
2. `actions/checkout@v4`.
3. `actions/setup-node@v4` with **`node-version: 22`** (the local default node is broken; pin 22 to match what works here) and `cache: npm`.
4. `npm ci` (use `npm ci` for a clean, lockfile-exact install in CI).
5. Steps, in order, each as its own `run`:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run test:game`
   - `npm run build`
6. Confirm `npm run build` doesn't need a `DATABASE_URL` (it doesn't — `scripts/migrate.mjs` skips gracefully when unset: `[migrate] DATABASE_URL not set — skipping`).
7. **Node 22 pin (confirmed):** keep `node-version: 22` — the local default Node is broken, so CI must match the known-good version.

**Verify:**
- Push the workflow to a branch / open a PR and confirm all 5 steps go green (once task b has landed; before that `test:game` will correctly fail the run).
- Locally sanity-check YAML syntax (`node -e` with a YAML parser, or just push and watch Actions).

---

### d. Add a pause menu

**Goal:** `Escape` or `P` toggles pause; tab becoming hidden auto-pauses; a pause overlay offers **Resume / Restart / Quit**. Physics must fully stop while paused.

**Files to change:**
- `src/game/store.ts` — add pause state + actions (see design note below)
- `src/game/engine.ts` — gate the physics step + AI on pause; consume the state in the main loop
- `src/game/input.ts` or a keydown handler — detect `Escape`/`KeyP`, and `visibilitychange` → auto-pause
- `src/components/neon-racer.tsx` (or a new `src/components/pause-menu.tsx`) — the overlay UI with Resume/Restart/Quit buttons
- `src/styles.css` — overlay styling (reuse `.glass` / `.btn` classes)

**Design decision (confirmed):** use a **separate `paused: boolean` flag** — not a new `Phase` member — so no `phase ===` comparison is touched.

**Steps:**
1. Add `paused: boolean`, `setPaused(bool)`, `togglePaused()` to the store (plus a `pauseNonce` if following the existing intent pattern).
2. In `engine.ts`'s main loop, when paused: skip the `while (acc >= STEP …)` physics step entirely (keep rendering so the frozen frame stays visible), don't feed `readCommand()` into `stepSim`.
3. Wire `Escape`/`KeyP` keydown → `togglePaused()` (only during a race, i.e. `phase === "racing" | "countdown"`, not in menus).
4. Wire `document.visibilitychange` → `setPaused(true)` when the tab hides (reuse/extend the existing listener in `input.ts` that currently only clears keys).
5. Render a pause overlay with:
   - **Resume** → `setPaused(false)`
   - **Restart** → `setPaused(false)` + `requestRestart()`
   - **Quit** → `setPaused(false)` + `requestMenu("title")` (or `askConfirm("quit")` if a confirmation is wanted)
6. Confirm audio doesn't keep advancing while paused (`audio.update` should be skipped or zeroed when paused).

**Verify:**
- All checks pass (`npm run typecheck && npm run lint && npm test && npm run test:game && npm run build`).
- **Manual browser test (required):** start a race, press `Escape` → car + rivals freeze (speed stays constant, lap counter doesn't tick); click Resume → continues from the exact same spot; press `P` → same; switch browser tabs → auto-pauses on return; Restart → countdown restarts; Quit → back to title.

---

### e. Remove unused template code, disable sign-in, drop unused packages, rename package

**Goal:** Strip the template down to what the game actually uses, explicitly turn sign-in off, remove unused deps, rename `app-builder-workspace` → `neon-racer`.

**Files to change/delete:**
- **Delete:** `src/lib/auth/`, `src/lib/app-data/`, `src/lib/multiplayer/`, `src/lib/db.ts`, `migrations/`
- **Edit:** `src/routes/__root.tsx` (remove `<AuthProvider>` + import — it's a passthrough, no behavior change), `vite.config.ts` (remove `pgliteBootstrapPlugin`, `authPopupPlugin`, and the migration-glob helper if now unused), `package.json` (scripts, deps, name)
- **Edit:** `src/game/visuals.ts` — delete the unused functions: `_facadeTexture`, `_mulberry32`, `_addCoast`, `_addCore`, `_addYard`, `_addTunnel`, and (if still uncalled) `createCarView`/`releaseObject` exports.
- **Delete unused JSON:** `public/assets/tracks/*.json`, `public/assets/vehicles/*.json`, `public/assets/schemas/vehicle.schema.json` (and the now-empty `environments`/`props` dirs) — **zero references** in `src/`, `scripts/`, `server/`, `vite.config.ts`.
- **Edit tests:** `npm test` script references `src/lib/app-data/*.test.ts` and `src/lib/auth/*.test.ts` — remove those paths once the folders are gone. `scripts/check-auth-invariant.test.mjs` and `scripts/migration-plan.test.mjs` reference auth/migrations — adjust or remove as needed.

**Explicitly disable sign-in (confirmed approach):**
- Deleting `src/lib/auth` is **not** enough on its own. Also remove the **identity gate** (`src/lib/auth/gate-identity.server.ts` and any other gate/session code) and the `<AuthProvider>` in `src/routes/__root.tsx`, so the game has **no sign-in code path at all**.
- **Do not rely on `.grok/app-env.json` for the `VITE_AUTH_ENABLED=false` flag** — `.grok/` is gitignored and **not in the GitHub repo**, so a Vercel deploy would never see it. Sign-in must be eliminated by **removing the code**, not by a local env flag.
- Grep to confirm no `authEnabled`, `useCurrentUser`, `gate-identity`, `better-auth`, or `AuthProvider` reference survives anywhere in `src/`, `vite.config.ts`, or `package.json`.
- Keep `PreviewHostBridge` (required by template) and **do not touch** `server/middleware/grok-pwa.ts` / `scripts/grok-pwa-*` / branding (per AGENTS.md).

**Remove unused npm packages** (confirmed unused in `src/`): `recharts`, `react-hook-form`, `@hookform/resolvers`, `cmdk`, `vaul`, `react-day-picker`, `react-resizable-panels`, `sonner`, `date-fns`, `class-variance-authority`, `tailwind-merge`, `tw-animate-css`, `@tanstack/react-query`, `@tanstack/react-table`, and all `@radix-ui/*` except the ones actually imported (grep shows **zero** `@radix-ui` imports in `src/`, so likely all). Also `better-auth`, `@electric-sql/pglite`, `pg`, `kysely`, `jose`, `lightningcss` once `src/lib/` is gone. **Keep:** `three`, `@types/three`, `zod` (used by `preview-host-bridge`), `zustand`, `react`, `react-dom`, TanStack router/start/table-not-used — verify each before removing; use `npm uninstall <pkg>` per package or edit `package.json` then `npm install`.

**Rename package:**
- `package.json` `"name": "neon-racer"` (and let `npm install` update `package-lock.json`'s `name` fields).

**Verify:**
- `npm run typecheck && npm run lint && npm test && npm run test:game && npm run build` — all pass.
- `npm test` script no longer references deleted test files.
- App still runs (`npm run dev`), no missing-module errors, sign-in is not shown anywhere.
- `grep -r "lib/auth\|lib/app-data\|lib/multiplayer\|lib/db\|migrations/" src/ vite.config.ts package.json` → no stale references.

---

### f. Reduce bundle size (split scenery per track, low/high graphics setting) + measure before/after

**Goal:** Shrink the shipped JS, specifically the 172 KB-gzip `engine` chunk, by (1) splitting scenery so only the active track's environment is loaded, and (2) leaning on the existing low/high quality setting to skip heavy work — and report a real before/after number.

**Baseline (record now):** see the gzip table above — **total JS gzip ≈ 339 KB**, `engine` gzip = **172,116 B**, `index` gzip = **135,295 B**, `routes` gzip = **31,783 B**.

**Files to change:**
- `src/game/visuals.ts` — make `addScenery` (currently a static `import { addScenery } from "./scenery"`) load **per theme kind** dynamically so the 46 KB `scenery.ts` splits into `city` / `yard` / `coast` / `core` chunks, each fetched only for the selected track.
- `src/game/engine.ts` — `buildScene` is now async (or takes a loaded scenery module); await the right chunk on `loadCourse`.
- Confirm the existing **low/medium/high quality** setting (`applyQuality()` in `engine.ts`, `bundle.dressing.visible = q !== "low"`) genuinely skips scenery/dressing work on `low` — and consider making `low` also skip building/loading the scenery chunk entirely.

**Steps:**
1. Re-measure the baseline cleanly (`find .vercel/output/static -name '*.js' | xargs gzip` → note per-chunk + total).
2. Refactor `visuals.ts`'s `import { addScenery }` → dynamic `await import("./scenery")` selected by `theme.kind`, with `buildScene` becoming async (audit `engine.ts` call sites: `syncSelection`, `startGame` bundle setup).
3. Wire `loadCourse`/`syncSelection` to await the correct scenery chunk before building the scene.
4. Ensure `low` quality can skip the scenery build/load (dressing is already hidden on `low` — extend to not download it).
5. Rebuild and re-measure.

**Verify:**
- All checks pass (`typecheck`, `lint`, `test`, `test:game`, `build`).
- **Record before/after gzip numbers** in this plan (append the delta).
- Manual browser test: switch tracks in the garage → each track still renders its correct environment (city/yard/coast/core), no missing scenery, no console errors from a failed chunk load; toggle low/high → high shows full dressing + bloom, low still drives normally with scenery hidden.
- **Node 22 pin (confirmed):** the local default Node is broken, and CI must match the known-good version — pin `node-version: 22` in the workflow (see task c) so local and CI builds agree.

**Caveat:** splitting scenery only helps if the chunks are actually separate — confirm in the build output that `scenery` becomes multiple smaller files rather than staying one merged chunk.

---

### g. Write a real README + add MIT LICENSE

**Goal:** Replace the 8-line stub README with a real one; add an MIT `LICENSE`.

**Files to change:**
- `README.md` (rewrite)
- `LICENSE` (add — MIT text, copyright **"Neon Racer contributors"** — confirmed)

**README sections:**
1. **Title + one-line pitch** (browser 3D arcade circuit racer).
2. **Features** — 4 cars, 4 circuits, 3 rival difficulties, championship cup, daily event, career/challenge stats, drift + nitro, low/high graphics, PWA install, touch + gamepad support.
3. **Controls** — keyboard (WASD/arrows, Space/Shift for boost, `Esc`/`P` pause — once task d lands), touch, gamepad.
4. **How to run** — `npm install` → `npm run dev`.
5. **How to test** — `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:game`, `npm run build`, and `node scripts/browser-smoke.mjs` for a render audit.

**LICENSE:** standard MIT text, copyright **"Neon Racer contributors"** (confirmed). Use the same attribution in the README.

**Also confirmed:** copy this plan into the repo root as `PLAN.md` so later sessions and CI can find it.

**Verify:**
- All checks pass (README/LICENSE don't affect builds, but confirm nothing regressed).
- README commands are copy-pasteable and accurate (verify each script name against `package.json` after tasks e/f have renamed/added scripts).

---

## Risks — what could break gameplay, and what to test manually in the browser

**High risk (touches physics/AI — test after every change):**
- **Task b (tuning):** moving APEX control points changes curvature → affects racing line, grip-limited corner speeds, AI braking, and lap times for **all** cars (player + rivals). Re-run `test:game` after *each* point nudge. Manually: drive APEX, confirm the corner is still challenging but passable, lap time in a sane range, rivals don't scrape walls or fly off.
- **Task b (AI probe):** changing `DIFF.easy.brake` or the probe point affects **real difficulty** — easy must stay meaningfully easier, not accidentally harder.

**Medium risk:**
- **Task d (pause):** a missed `phase ===` check could let physics advance while paused, or a stale input could fire on resume. Test: pause mid-countdown, mid-drift, and mid-air; confirm zero movement while paused and clean resume.
- **Task e (deletion):** removing `src/lib/*` could break `__root.tsx`, `vite.config.ts`, or the `npm test` script if a reference is missed. `AuthProvider` removal must not break rendering (it's a passthrough). Grep for stale imports; watch for a blank page (run `browser-smoke.mjs`).
- **Task f (async buildScene):** making scene construction async risks a race where the car starts before scenery loads, or a track switch shows the previous track's environment. Test rapid track switching.

**Lower risk:**
- **Task c (CI):** a wrong `node-version` or missing `DATABASE_URL` handling could fail the workflow. Confirm locally that `npm run build` needs no DB.
- **Task e (package rename / dep removal):** an over-eager `npm uninstall` could remove something still transitively needed. Uninstall **one package at a time**, run `npm run build` between removals.

**Manual browser checklist (run after b, d, e, f):**
- App renders (no blank/white page) on desktop + mobile width.
- Console has no uncaught errors / failed module loads (especially a split scenery chunk failing to load — task f).
- Drive APEX end-to-end; rivals behave; lap + results screens work.
- Pause (Esc/P/tab-hide), Resume, Restart, Quit all work; physics frozen while paused (task d).
- Toggle low/high graphics; both render correctly; switching tracks loads the right environment.
- No sign-in UI anywhere (task e).

**Environment risk:** the broken system Node could make a future session's `npm run …` crash with `libsimdjson` errors — use `/opt/homebrew/Cellar/node@22/22.23.4_2/bin` on PATH. CI must pin Node 22 (confirmed).

**Plan-discovery risk:** if `PLAN.md` only lives outside the repo, later sessions and CI won't see it. **Confirmed:** copy it into the repo root as `PLAN.md`.

---

## Decisions (answered — no open questions)

All five planning questions are resolved. These are binding for build sessions:

1. **Pause (task d):** use a **separate `paused: boolean` flag**, not a new `Phase` member.
2. **Easy-brake (task b):** fix the **probe location** — move it to where braking actually happens. **Do not loosen the check**; it must still prove easy brakes earlier than hard (keep the `+ 0.2` margin). Only if it still fails after a correct probe, tune `DIFF.easy.brake`.
3. **LICENSE + README attribution:** **"Neon Racer contributors"**.
4. **Removal scope (task e):** remove **all `@radix-ui/*`**, and fully delete `src/lib/auth`, `src/lib/app-data`, `src/lib/multiplayer`, `src/lib/db.ts`, `migrations/` **and their tests**. Keep `zod` and `lucide-react`. Run typecheck, build, and `npm test` afterward to confirm nothing breaks.
5. **Sign-in (task e):** deleting `src/lib/auth` is not enough — also remove the **identity gate** (`gate-identity.server.ts`) and **`AuthProvider`** so there is **no sign-in code path at all**. Do **not** rely on `.grok/app-env.json` (not in the GitHub repo, so a Vercel deploy would never see it). Eliminate sign-in by removing the code.

**Also confirmed:** copy `PLAN.md` into the repo root (so later sessions and CI can find it) and **pin Node 22 in CI**.
---

## Progress

**Task c (CI):** Added `.github/workflows/ci.yml` (push/PR to main, Node 22, npm cache, npm ci, full GATE). `.grok`-dependent tests skip cleanly (4 `# SKIP`). GATE passes from clean `npm ci`. Commit `5ea5c29`. Push pending: OAuth token lacks the `workflow` scope.

**Task d (Pause menu):** Added `paused` boolean (separate from Phase), Escape/P + tab-hidden auto-pause, gamepad Start, overlay with Resume/Restart/Quit, physics+timers frozen in engine loop. New `pause.test.ts` asserts race time doesn't advance while paused. GATE passes. Commit `03f6f72`.

**Task e (Template cleanup):** Deleted src/lib/{auth,app-data,multiplayer,db.ts}, migrations/, AuthProvider, gate-identity + their tests; inlined CONNECTOR_TOKEN_READY_EVENT into preview-host-bridge. Removed 40 unused deps (kept zod, lucide-react, tsx, three, react, zustand). Deleted 6 _-prefixed visuals.ts funcs + unused public/assets JSON. Renamed package to neon-racer. No sign-in path remains. GATE passes (test count 188+1 after removing migration tests). Commit `9b3f4a8`.

**Task f (Bundle size):** Lazy-loaded per-track scenery (dynamic import in buildScene, disposed-guard). Before -> After gzip: engine 172,213 -> 164,404 (-4.5%), scenery 8,494 as own lazy chunk, total 339,625 -> 340,420. Low/High setting (bloom only on High) already existed. Lap times unchanged (t 113.4). GATE passes. Commit `1375333`.

**Task g (README + LICENSE):** Wrote README (description, features, controls table incl. pause, how to run, how to test via npm run test:game, tech stack, cars marked "placeholder, being redesigned"). Added MIT LICENSE for "Neon Racer contributors". GATE passes. Commit `2c66175`.
