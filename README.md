# Neon Racer

A fast, browser-based 3D arcade circuit racer. Pick a car, learn a neon night
circuit, and beat three AI rivals across drifting, boosting, and wheel-to-wheel
racing — no install, no download, just open and drive.

## Features

- **Four circuits** — APEX, NIGHTFALL, VELOCITY, and OVERDRIVE, each with its
  own theme, layout, and corner profiles.
- **Three AI difficulties** — Easy, Normal, and Hard change how the rivals drive
  (braking, pace, mistakes, nitro), never the physics.
- **Championship mode** — run a multi-round cup, score points, and unlock more
  cars and circuits as you progress.
- **Daily event** — a deterministic daily car + circuit combination to chase.
- **Career & challenges** — track your races, best laps, and mastery per car
  and track.
- **Drift, boost, and grip physics** — arcade handling with a nitro meter,
  slip angles, and a forgiving recovery.
- **Graphics settings** — Low / Medium / High quality (bloom and scenery scale
  with the setting; handling never changes).
- **Pause menu** — `Esc` / `P` (or the gamepad Start button) pauses with
  Resume / Restart / Quit; the race auto-pauses if you switch tabs.
- **Installable PWA** — add it to your home screen on iOS/Android.
- **Keyboard, touch, and gamepad** support.

The four cars are authored shapes, not one blob scaled four ways. Stats live
in `src/game/vehicle-def.ts`; the meshes live in `src/game/car-model.ts`.

| Car | Wheelbase | Body width | Floor above wheel datum | Static floor-to-asphalt clearance |
| --- | ---: | ---: | ---: | ---: |
| VECTOR GT3 | 2.50 m | 2.14 m | 0.145 m | 0.115 m |
| VANTA GT4 | 2.38 m | 2.24 m | 0.150 m | 0.120 m |
| SURGE LMP | 2.82 m | 2.20 m | 0.140 m | 0.110 m |
| AEGIS TCR | 2.52 m | 2.36 m | 0.150 m | 0.120 m |

Wheelbase is measured between the modeled axle stations. Body width is twice
the widest body station. The floor height is measured from the wheel-contact
datum; the rendered asphalt deck is 0.030 m above that datum. The final column
is the nominal clearance for a level, stationary car (`floor height − 0.030 m`);
suspension movement and road grade change clearance while driving.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Steer | `A` / `D` or `←` / `→` | Left / right pads | Left stick |
| Throttle | `W` or `↑` | Gas button | RT / RB (`7` / `5`) |
| Brake / reverse | `S` or `↓` | Brake button | LT / LB (`6` / `4`) |
| Boost (nitro) | `Space` or `Shift` | Boost button | `A` (`0`) / `B` (`1`) |
| Pause / resume | `Esc` or `P` | — | Start (`9`) |

Switching tabs auto-pauses the race; return and press `Esc` / `P` (or Start) to
resume.

## How to run

```bash
npm install
npm run dev
```

The dev server starts on `http://localhost:8080`. Open it in a browser and
you're racing.

To build for production:

```bash
npm run build
npm run preview
```

## How to test

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint
npm test            # unit tests (scripts + game logic)
npm run test:game   # headless race + feel checks (exits non-zero on failure)
npm run build       # production build
```

`npm run test:game` is the one to watch: it simulates a full race and asserts
the track, AI, and handling all behave. It fails the build if anything regresses.

## Tech stack

- **React 19** + **TypeScript**
- **TanStack Start / Router** (routing + SSR)
- **Three.js** (WebGL rendering, procedural car/track/scenery geometry)
- **Zustand** (state)
- **Tailwind CSS v4** (styling)
- **Vite** + **Nitro** (build + serverless deploy)
- **Vitest-free testing** via the built-in `node:test` runner and `tsx`

## License

MIT © Neon Racer contributors — see [LICENSE](LICENSE).
