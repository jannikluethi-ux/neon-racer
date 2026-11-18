# Vehicle models

These files are the visual bodies for three cars. Surge stays a procedural model in the game and has no file here.

| Car | Asset | Files | Source | Licence |
|---|---|---|---|---|
| Vector | Mid-Engine Supercar | `lod1/supercar.glb`, `lod2/supercar.glb` | https://tevy.dev/models/supercar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Vanta | Electric Grand Tourer | `lod1/electric-gt.glb`, `lod2/electric-gt.glb` | https://tevy.dev/models/electric-gt | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Aegis | Family Sedan | `lod1/family-sedan.glb`, `lod2/family-sedan.glb` | https://tevy.dev/models/family-sedan | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Author: tevy. Commercial use, modification, and redistribution are allowed. Attribution is not required.

The GLB files on disk are the publisher's LOD1 and LOD2 builds (meshopt geometry, KTX2 textures). They are not rewritten. Physics, wheel positions, and collision are not taken from the files.

Race splitters, sills, and wings on Vanta and Aegis are original parts modelled in the game and parented to the imported body. The sill pieces follow the rocker between the wheel arches. An earlier build hung them on the body's bounding box, which includes the mirrors, and those pieces showed up as two black squares beside Aegis's rear tyres.

Vector's silhouette is changed when the model loads. `editVectorMesh` copies the quantized positions into plain floats, then moves the nose and hood vertices in world space: the nose is shortened and stood up, and a low centre spine is added on the hood. The stock wing is hidden, the named front-lamp triangles are dropped, and morph targets on those meshes are cleared so the edited base mesh is what renders. Original parts added in code are a GT3 wing on two swan-neck pylons, endplates, a rear diffuser, and a full-width tail lamp bar. No manufacturer names or badges are added. The base mesh stays CC0. The added parts are original to Neon Racer.
