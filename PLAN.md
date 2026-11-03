# Neon Racer — Project Plan

## Current project

Neon Racer is a browser based 3D arcade circuit racer built with React,
TypeScript, Three.js, TanStack Start, Zustand, and Vite. The game includes four
circuits, four individually modeled cars, three AI difficulty settings,
championship and career progression, daily events, local saves, keyboard,
touch and gamepad controls, audio, and Low / Medium / High graphics settings.

The project is on `main`, based on reconstruction commit `0ebe88e`. The
Reconstruction 2.1 work corrects road geometry, kerb and wheel contact,
portability, documentation, resource handling, and rendering details while
preserving the established horizontal driving behavior.

## Implemented milestones

- Four vehicle meshes and detailed wheel assemblies are authored in
  `src/game/car-model.ts`; shared specifications and performance statistics are
  in `src/game/vehicle-def.ts` and `src/game/vehicle-stats.ts`.
- Track splines, surface meshes, asphalt, kerbs, barriers, walkways and themed
  scenery are generated from the existing four circuit definitions.
- `src/game/kerb.ts` is the shared kerb profile for simulation and rendering.
- Vehicle-specific wheel positions feed both car rendering and kerb contact.
- Visual contact fits the chassis pitch and roll to the four wheel patches;
  wheel decals follow their own contacts. Horizontal handling remains in the
  existing arcade tire model.
- Road strips correct their winding and recompute normals. Asphalt textures
  use repeatable per-theme seeds.
- The game includes AI, race and championship progression, unlocks, career
  records, daily events, local save migration, mobile controls, HUD, and sound.
- `startup.sh` resolves the checkout from its own location. Browser QA paths are
  constrained to loopback pages and allowed screenshot outputs.

## Vehicle dimensions

Dimensions are derived from the authored axle stations and body station table
in `src/game/car-model.ts`:

| Car | Wheelbase | Body width | Floor above wheel datum | Static floor-to-asphalt clearance |
| --- | ---: | ---: | ---: | ---: |
| VECTOR GT3 | 2.50 m | 2.14 m | 0.145 m | 0.115 m |
| VANTA GT4 | 2.38 m | 2.24 m | 0.150 m | 0.120 m |
| SURGE LMP | 2.82 m | 2.20 m | 0.140 m | 0.110 m |
| AEGIS TCR | 2.52 m | 2.36 m | 0.150 m | 0.120 m |

The floor values use the wheel-contact origin as zero. The asphalt deck is
0.030 m above it, so nominal level-ground clearance is the floor value minus
0.030 m. Suspension and road shape vary the running clearance.

## Verification

Run the checks from a clean install or the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:game
npm run build
```

The browser smoke scripts cover development and production. `scripts/visual-qa.mjs`
can capture the running game to `screenshots/recon-2.1/` and measure frame
intervals at all three quality levels. The 2.1 delivery record must include the
actual command results, screenshots, runtime measurements, baseline driving
comparison, and any remaining limitations; a scene build time is not an FPS
measurement.

## Follow-up roadmap

- Complete device-level mobile performance and browser coverage across current
  iOS and Android hardware.
- Evaluate a ghost lap and additional race practice tools without changing
  current handling.
- Consider further circuits only as a separately scoped content milestone.
- Evaluate native packaging, offline behavior, and store requirements as a
  separate release decision.

## Engineering constraints

- Preserve existing layouts, vehicle models, race progression, save behavior,
  mobile controls, HUD, and sound during corrective work.
- Keep the current tire and horizontal handling model unless a measured defect
  requires a documented change.
- Use the shared wheel layout and kerb profile wherever simulation and rendering
  need the same physical definitions.
- Keep repository scripts independent of personal checkout paths.
