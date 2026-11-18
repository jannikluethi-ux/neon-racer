# Vehicle models

These files are the visual bodies for three cars. Surge stays a procedural model in the game and has no file here.

| Car | Asset | Files | Source | Licence |
|---|---|---|---|---|
| Vector | Classic 1970s Coupe | `lod1/classic-coupe.glb`, `lod2/classic-coupe.glb` | https://tevy.dev/models/classic-coupe | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Vanta | Electric Grand Tourer | `lod1/electric-gt.glb`, `lod2/electric-gt.glb` | https://tevy.dev/models/electric-gt | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Aegis | Family Sedan | `lod1/family-sedan.glb`, `lod2/family-sedan.glb` | https://tevy.dev/models/family-sedan | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Author: tevy. Commercial use, modification, and redistribution are allowed. Attribution is not required.

The GLB files on disk are the publisher's LOD1 and LOD2 builds (meshopt geometry, KTX2 textures). They are not rewritten. Physics, wheel positions, and collision are not taken from the files.

Race splitters, sills, and wings on Vanta and Aegis are original parts modelled in the game and parented to the imported body. The sill pieces follow the rocker between the wheel arches. An earlier build hung them on the body's bounding box, which includes the mirrors, and those pieces showed up as two black squares beside Aegis's rear tyres.

Vector no longer uses the mid-engine supercar. That mesh read as one modern supercar, and moving its nose vertices put the nose behind the front axle. The replacement is tevy's Classic 1970s Coupe, CC0, author tevy, source https://tevy.dev/models/classic-coupe. The GLBs are the publisher's LOD1 and LOD2 (meshopt + KTX2) and are not vertex-edited. Original parts added in code are a GT3 wing on two swan-neck pylons, endplates, a rear diffuser, and a full-width tail lamp bar. The cyan livery and race number are applied in the game. No manufacturer names or badges are added. The choice and the rejected candidates are in `docs/asset-eval/VECTOR-REPORT.md`.
