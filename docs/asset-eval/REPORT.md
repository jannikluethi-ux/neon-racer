# Milestone 1, phase A — real vehicle assets

This is an evaluation only. No model is wired into the game, and the candidate files are not in the repository. Physics, wheel positions, tracks, and scenery are unchanged.

Every file below was downloaded and opened. Previews are headless three.js renders of that file (front three-quarter, side, rear three-quarter) on a neutral grey ground. tevy.dev models were rendered from their LOD1 GLB (meshopt geometry, KTX2 textures). Kenney models were rendered from the GLB in Car Kit 3.1. Triangle counts in the tables are the publisher's LOD0 count when they publish one, and the count measured in the file that was rendered.

Licence check date: 18 November 2026.

## Recommendation

| Class | Pick | Runner-up | Verdict |
|---|---|---|---|
| Vector (GT3) | tevy **Mid-Engine Supercar** | tevy **Electric Grand Tourer** | Use the supercar. It already has a splitter, wide arches, glass, and a mounted rear wing. |
| Vanta (GT4) | tevy **Electric Grand Tourer** | tevy **Classic 1970s Coupe** | Use the grand tourer. It is a road coupe with a small spoiler, clearly not the supercar. |
| Aegis (TCR) | tevy **Family Sedan** | tevy **Five-Door Hatchback** | Use the sedan. Four doors and four side windows are real meshes. Race aero is not on the model and has to be added later. |
| Surge (LMP) | **none inspected** | — | No closed-wheel prototype with a usable licence was available to download. Do not use the open-wheel cars below. |

Kenney's Car Kit is CC0 and was inspected so the low-poly option is on the record. It is not a suitable body for any of the four classes.

## Vector — GT3 coupe

Need: wide coupe, sculpted fenders, low roof, real glass, splitter, rear arches, working rear wing, diffuser, separate racing wheels.

### tevy Mid-Engine Supercar — recommended

![front](vector/tevy-supercar-front34.jpg)
![side](vector/tevy-supercar-side.jpg)
![rear](vector/tevy-supercar-rear34.jpg)

| | |
|---|---|
| Identity | Mid-engine supercar with splitter, side intakes, glass engine cover, and a rear wing on two pylons |
| Source | https://tevy.dev/models/supercar |
| Asset name | Mid-Engine Supercar |
| Author | tevy |
| Format | GLB (LOD0 / LOD1 / LOD2) |
| File inspected | `v1/lod1.glb`, 308 KB, 12,014 triangles measured |
| LOD0 published | 159,952 triangles, 6.6 MB |
| LOD2 published | 5,432 triangles, 325 KB |
| Licence | CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/ |
| Commercial / modify / redistribute | Yes / yes / yes |
| Attribution | Not required |
| Textures | Embedded. LOD1 has 2 images. The file is meshopt + KTX2, so a loader must set both decoders |
| Wheels | Separate nodes: `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, plus `steer_FL` / `steer_FR` and calipers |
| Also separate | Doors, bonnet, boot, wing, steering wheel |
| Dimensions | 2.32 m wide, 1.16 m tall, 4.60 m long |
| Modifications | Repaint to the Vector livery, drop any default orange if it reads as a brand, fit the wing and splitter if the game numbers need to sit on the doors, scale to the Vector wheelbase |
| Suitability | Best free match for an aggressive coupe. It is mid-engined rather than a front-engine GT3, and it has no branded badges |

### tevy Electric Grand Tourer — runner-up

![front](vector/tevy-electric-gt-front34.jpg)
![side](vector/tevy-electric-gt-side.jpg)
![rear](vector/tevy-electric-gt-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/electric-gt |
| Asset name | Electric Grand Tourer |
| Author | tevy |
| Format | GLB |
| File inspected | LOD1, 808 KB, 29,407 triangles measured |
| LOD0 published | 125,676 triangles, 2.2 MB |
| LOD2 published | 7,567 triangles, 112 KB |
| Licence | CC0 1.0 |
| Commercial / modify / redistribute | Yes / yes / yes |
| Attribution | Not required |
| Textures | Embedded KTX2, 4 images in LOD1, meshopt |
| Wheels | `wheel_FL/FR/RL/RR` separate. No steer pivots. Spoiler and steering wheel are separate |
| Glass | `glass_windshield`, `glass_side_L`, `glass_side_R`, `glass_rear`, `glass_roof` |
| Dimensions | 2.14 × 1.29 × 4.67 m |
| Modifications | The lip spoiler is too small for a GT3. A larger wing, splitter, and wider arches would have to be added. Better kept as the Vanta |
| Suitability | A real coupe with glass and separate wheels, but it reads as a road grand tourer, not a GT3 |

### Kenney `race.glb` — not suitable

![front](vector/kenney-race-front34.jpg)
![side](vector/kenney-race-side.jpg)
![rear](vector/kenney-race-rear34.jpg)

| | |
|---|---|
| Source | https://kenney.nl/assets/car-kit and the OpenGameArt mirror https://opengameart.org/content/car-kit |
| Asset name | `race.glb` in Car Kit 3.1 |
| Author | Kenney |
| Format | GLB, 163 KB |
| Triangles | 1,952 measured |
| Licence | CC0 1.0. Pack text: personal, educational, and commercial use. Credit to Kenney is requested and not required. https://creativecommons.org/publicdomain/zero/1.0/ |
| Textures | One external `Textures/colormap.png`, 12 KB |
| Wheels | Separate nodes `wheel-front-left/right`, `wheel-back-left/right`, plus a shared `wheel-racing.glb` (332 triangles) |
| Suitability | Open-wheel toy. It is the same class of model the procedural cars were rejected for. Do not use it as Vector |

### Kenney `hatchback-sports.glb` — not suitable

![front](vector/kenney-hatchback-sports-front34.jpg)
![side](vector/kenney-hatchback-sports-side.jpg)
![rear](vector/kenney-hatchback-sports-rear34.jpg)

| | |
|---|---|
| Asset name | `hatchback-sports.glb`, Car Kit 3.1, Kenney, CC0 |
| Triangles | 2,088. File 193 KB. Same colormap |
| Wheels | Four separate wheel nodes and a body node |
| Suitability | Blocky hot hatch. No readable glass, no GT3 aero. Not Vector |

Sketchfab also lists **Race Car 01** by toddeppe, described as a generic LMGT3, CC BY, 609,896 triangles, downloadable only with a Sketchfab login. It was not downloaded, so it is not a pick. At that triangle count it would need a heavy decimation before Android.

## Vanta — GT4 coupe

Need: a normal sports-coupe silhouette, a real roof and glass, and modest aero. It must not be the Vector.

### tevy Electric Grand Tourer — recommended

Same file as the Vector runner-up. Previews for this class:

![front](vanta/tevy-electric-gt-front34.jpg)
![side](vanta/tevy-electric-gt-side.jpg)
![rear](vanta/tevy-electric-gt-rear34.jpg)

The long hood, cabin glass, and small lip spoiler read as a road GT. Next to the mid-engine supercar the two silhouettes are different. Phase B would repaint it and can leave the spoiler, or swap in a slightly taller GT4 wing. Wheel nodes already exist.

### tevy Classic 1970s Coupe — runner-up

![front](vanta/tevy-classic-coupe-front34.jpg)
![side](vanta/tevy-classic-coupe-side.jpg)
![rear](vanta/tevy-classic-coupe-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/classic-coupe |
| Asset name | Classic 1970s Coupe |
| Author | tevy |
| Format | GLB |
| File inspected | LOD1, 288 KB, 13,351 triangles |
| LOD0 published | 56,130 triangles, 1.4 MB |
| Licence | CC0 1.0. Commercial, modify, redistribute: yes. Attribution not required |
| Textures | Embedded KTX2, 2 images, meshopt |
| Wheels | Separate, with `steer_FL` / `steer_FR`. Doors, bonnet, and boot open |
| Glass | `glass_windshield`, `glass_side_L`, `glass_side_R` |
| Dimensions | 2.0 × 1.3 × 4.65 m |
| Suitability | A real coupe, but the 1970s shape is the wrong era for a GT4. Only use it if the grand tourer is rejected |

### tevy Rally Car — not suitable

![front](vanta/tevy-rally-car-front34.jpg)
![side](vanta/tevy-rally-car-side.jpg)
![rear](vanta/tevy-rally-car-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/rally-car |
| LOD0 | 60,473 triangles, 1.6 MB. LOD1 measured 16,166 triangles, 339 KB |
| Licence | CC0 1.0. Commercial, modify, redistribute: yes |
| Wheels | Separate, with steer pivots, doors, bonnet, boot |
| Suitability | Gravel rally hatch with a light pod and mud flaps. Wrong class for a circuit GT4 |

### Kenney `sedan-sports.glb` — not suitable

![front](vanta/kenney-sedan-sports-front34.jpg)
![side](vanta/kenney-sedan-sports-side.jpg)
![rear](vanta/kenney-sedan-sports-rear34.jpg)

| | |
|---|---|
| Asset | Kenney Car Kit 3.1 `sedan-sports.glb`, CC0, 174 KB, 2,088 triangles |
| Nodes | Body, spoiler, four wheels |
| Suitability | Toy block car. The spoiler is a slab. Not Vanta |

## Aegis — TCR touring car

Need: a production four-door sedan, four doors you can see, separate front and rear side glass, shut lines, then splitter, skirts, and a rear wing.

### tevy Family Sedan — recommended

![front](aegis/tevy-family-sedan-front34.jpg)
![side](aegis/tevy-family-sedan-side.jpg)
![rear](aegis/tevy-family-sedan-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/family-sedan |
| Asset name | Family Sedan |
| Author | tevy |
| Format | GLB |
| File inspected | LOD1, 983 KB, 56,560 triangles measured |
| LOD0 published | 149,996 triangles, 2.4 MB |
| LOD2 published | 5,632 triangles, 120 KB |
| Licence | CC0 1.0. Commercial, modify, redistribute: yes. Attribution not required |
| Textures | Embedded KTX2, 3 images in LOD1, meshopt |
| Wheels | `wheel_FL/FR/RL/RR` and `steer_FL/FR` |
| Doors | `door_FL`, `door_FR`, `door_RL`, `door_RR`, each with its own side glass. Bonnet and boot open |
| Dimensions | 2.1 × 1.45 × 4.91 m |
| Modifications | It is a road sedan, which is the right base for TCR, but it has no splitter, skirts, or wing. Those have to be modelled or taken from another CC0 piece and parented on. Repaint and add the race number. LOD1 is 56 meshes; merge the static shell before shipping on Android and keep the four wheels (and steer pivots) as their own nodes |
| Suitability | The only inspected model that is actually a four-door sedan with separate windows |

### tevy Five-Door Hatchback — runner-up

![front](aegis/tevy-hatchback-front34.jpg)
![side](aegis/tevy-hatchback-side.jpg)
![rear](aegis/tevy-hatchback-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/hatchback |
| LOD0 | 46,170 triangles, 680 KB. LOD1 measured 8,812 triangles, 212 KB |
| Licence | CC0 1.0. Commercial, modify, redistribute: yes |
| Wheels | Four wheel nodes. Doors are not separate meshes. Glass nodes exist for windshield, sides, and rear |
| Dimensions | 2.03 × 1.47 × 4.10 m |
| Suitability | A compact hatch, lighter than the sedan, but the doors are not distinguishable parts. Weaker TCR base |

### Kenney `sedan.glb` — not suitable

![front](aegis/kenney-sedan-front34.jpg)
![side](aegis/kenney-sedan-side.jpg)
![rear](aegis/kenney-sedan-rear34.jpg)

| | |
|---|---|
| Asset | Kenney Car Kit 3.1 `sedan.glb`, CC0, 168 KB, 2,032 triangles |
| Wheels | Four separate wheel nodes, one body |
| Suitability | A toy saloon. Doors and glass are painted blocks. This is the look phase A is supposed to leave |

## Surge — closed-wheel endurance prototype

Need: wide tub, long nose, front fenders over the front wheels, enclosed rear wheels, sidepods, glazed cockpit, engine cover, fin, large wing, diffuser. An open-wheel car does not qualify.

**No suitable model was downloaded.** The free packs that could be fetched do not contain a closed-wheel prototype.

### tevy Open-Wheel Formula Car — rejected

![front](surge/tevy-formula-car-front34.jpg)
![side](surge/tevy-formula-car-side.jpg)
![rear](surge/tevy-formula-car-rear34.jpg)

| | |
|---|---|
| Source | https://tevy.dev/models/formula-car |
| LOD0 | 46,816 triangles, 1.2 MB. LOD1 measured 11,940 triangles |
| Licence | CC0 1.0. Commercial, modify, redistribute: yes |
| Wheels | Separate, plus front wing, rear wing, and DRS flap |
| Suitability | Open wheels, open cockpit, halo. Explicitly the wrong class. Do not substitute it |

### Kenney `race.glb` and `race-future.glb` — rejected

`race.glb` is the open-wheel toy shown under Vector. `race-future.glb` is a low-poly sci-fi shape, 169 KB, 2,068 triangles, same CC0 pack, four wheel nodes.

![front](surge/kenney-race-future-front34.jpg)
![side](surge/kenney-race-future-side.jpg)
![rear](surge/kenney-race-future-rear34.jpg)

Neither is an enclosed prototype.

### What exists but was not inspected as a mesh

Sketchfab's download API requires a logged-in token, so these were identified from the public model record and not opened locally. They are not picks.

| Name | Author | Licence | Faces | Why it is not a pick |
|---|---|---|---|---|
| [Le Mans Prototype](https://sketchfab.com/3d-models/le-mans-prototype-8f711f4dc62648fb8b9d5b3c6c1ec931) | mudkipz321 | CC BY | 41,880 | Author says it is based on the 2017 Porsche 919. That is a real-brand shape. Not downloaded |
| [Proto V2](https://sketchfab.com/3d-models/proto-v2-438afff24155432fb98dbfa23f1cdfab) | Streetsraker | CC BY | 16,141 | Described as a generic endurance prototype. Best free lead, but the file was not downloaded, so proportions and wheel splits are unknown |
| [2006 Courage LC70](https://sketchfab.com/3d-models/2006-courage-lc70-4eff742424e7439890af66109a12c6cf) | JUSTGAME | CC BY | 37,848 | Real constructor name and livery. Not downloaded |
| Audi, Ferrari 499P, Peugeot 9X8, BMW listings from the same CC BY search | various | CC BY | — | Real-brand cars. Out of scope even if the logos could be stripped |

CC BY would allow commercial use, modification, and redistribution **with attribution**, once the file is actually in hand. A Porsche, Audi, or Ferrari likeness would still be rejected.

### Options if the owner wants a Surge model

1. **Buy a generic one.** CGTrader lists [LMP - Le Mans Prototype - Generic Concept](https://www.cgtrader.com/3d-models/car/racing-car/lmp-le-mans-prototype-generic-concept) by gerulf.doesinger. The page on 18 November 2026 showed a royalty-free licence, GLTF delivery, about 75k polygons / 150k triangles, and a sale price of $4. It was not purchased and not inspected. The store licence is not CC0; it has to be read before buying, because some store licences allow a game to ship the mesh and still forbid posting the source file.
2. **Approve a Sketchfab login** so Proto V2 (CC BY, 16k faces) can be downloaded and judged the same way as the tevy cars. If it is a real enclosed prototype with separate wheels, it becomes the Surge pick, with the attribution line in the game credits.
3. **Commission** a closed-wheel prototype in the same style as the tevy supercar (separate wheels, glass canopy, wing on mounts, under 40k triangles at LOD1). That is the clean option if Proto V2 fails inspection.

Do not fill Surge with the formula car or a Kenney toy while waiting.

## Quaternius

[Quaternius Cars Pack](https://quaternius.com/packs/cars.html) (November 2018) is CC0, eight low-poly cars, FBX / OBJ / Blend. The download button opens a Google Drive folder, and that folder was not fetched. Nothing from the pack was rendered. Treat it as the same class of asset as Kenney: useful for traffic, not for these four heroes. Poly Pizza also hosts a Quaternius Sports Car (CC0, a few thousand triangles) but the site returned 403 to a direct download, so that file was not inspected either.

## Integration plan (phase B, after approval)

Do this only for the three recommended tevy models, plus a Surge model once one is approved. Physics bodies, wheel anchors, wheelbase, steering pivots, suspension travel, collision, handling, and stats stay as they are. The GLB is a visual child of the existing car root.

**Scale and align.** tevy files are in metres and already close to the game cars (about 4.1–4.9 m long and 2.0–2.3 m wide). Measure the model's front and rear wheel nodes, then apply one uniform scale so that distance matches `wheelLayout(id).wheelbase`. Move the visual root so the scaled wheel contacts sit on the existing anchors (`frontX`, `rearX`, `frontZ`, `rearZ`, height `WHEEL_CONTACT_Y + radius`). If the model's track is a few centimetres off, reparent the wheel meshes onto the physics pivots instead of scaling X separately. Do not edit `wheelLayout` or the contact tests.

**Wheels.** The recommended models already split wheels into nodes, and the supercar and sedan also have steer pivots. Keep those nodes. Parent each wheel to the existing steer pivot (front) or spin hub (rear). Hide or delete the model's brake calipers if they double up with the current calipers. If a later Surge file has wheels fused to the body, cut them by vertex island or replace all four corners with one shared wheel assembly (the Kenney `wheel-racing.glb` is too cartoon; a wheel taken from the tevy supercar, duplicated, is the consistent set).

**Compression.** The tevy GLBs are already meshopt and KTX2. Load them with `MeshoptDecoder` and `KTX2Loader` (Basis transcoder). Do not also Draco-compress them. Ship LOD1 on Android and LOD0 only if a desktop quality setting asks for it. LOD2 is the backup if a car is still heavy after merging.

**Draw calls.** A raw family-sedan LOD1 is 56 meshes. Merge everything that does not move into one or two static meshes (paint shell, glass). Leave four wheel nodes, and the front steer parents. Target for the car on track: under 12 draws (shell, glass, lights, four wheels, optional calipers). Rivals use the same merged shell with a different paint colour. The garage shows one hero car, so the budget is the same.

**Materials.** Replace the imported PBR set with the game's roles where it is cheaper, but keep the authored normals:

- Body: `MeshPhysicalMaterial`, moderate metalness, clearcoat. One colour per car from the existing palette, plus the race number on the doors and rear.
- Glass: the model's glass meshes stay separate and use a dark clearcoat glass (`color` about `#101820`, opacity around 0.6, double sided). Do not tint glass with the body colour.
- Tyres: rubber, high roughness, no clearcoat.
- Rims: metal, low roughness.
- Lamps and tail lenses: small emissive materials, not the body paint.
- Strip any default livery that could be read as a manufacturer mark. These three tevy cars are generic; there are no badges to remove.

**Garage.** The carousel, track-select transition, and unlocks keep using the same car root and the same length/height numbers for framing. After the real meshes are in, re-shoot the orthographic compare scene (side, front, and rear lineups, plus each car's front three-quarter, side, and rear three-quarter) and check the camera does not clip the wing or the nose.

**Gate, when phase B happens.** `npm ci`, `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm test`, `npm run test:game` still exactly 113.4 s, `npm run build`, `npm run build:android`. No edits to asphalt, kerbs, barriers, scenery, or environments.
