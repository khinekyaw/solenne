# The Wren in Blender (exterior)

A detailed, game-ready exterior of the Wren, built entirely from Python in Blender 5.2 (no hand
modelling, so it is reproducible and diffable). **Not imported into the game yet**: the game still
draws the code-built Wren from `src/ship/`.

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/wren/build_wren.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/wren/render_wren.py -- art/wren/out/wren.glb art/wren/renders all cycles
```

`--quick` bakes at 1024² (≈ 45 s); the full build bakes at 4096² (≈ 10 min on an M2, the first run
adds ≈ 2 min of GPU kernel compile). `--no-bake` exports clay geometry in a few seconds.
`render_wren.py` renders the GLB the game would load: front/side/back/top on the concept sheet's
paper, the concept's three-quarter view, a low view at the ramp, starboard, the ship closed for flight,
and `wren-ramp-fold.mp4` (the ramp folding into the door). The renders add a dark cabin shell and a
warm lamp inside the skin; neither is in the GLB.

## Built for the game

| | |
| --- | --- |
| Frame | Ship-local metres: x port, y up, z toward the nose, origin on the ground under the hull (the frame of `wrenShape.ts`); the GLB is +Y up, so it loads as-is |
| Hull | Sampled from the same analytic hull as the game (`wren_shape.py` is a port of `wrenShape.ts`); the plates, rails and trim stand 2–8 cm proud of it, so the walkable interior and collision still fit. The constants are written to the root node's extras |
| Openings | Real holes (canopy faces removed, doorway and dome seat cut by booleans) with the hull's thickness closed by a lip and a jamb. The doorway is the concept's rounded rectangle (the game's is a round arch: `doorTop()` in `wrenShape.ts` changes on import) |
| Ramp-door | A drawbridge, as in the films. `Ramp` is hinged on the sill (pivot on the inner shell); closed, its outer face *is* the patch of hull cut out for the doorway, riveted, with brass bars. `RampFoot` is hinged to its end and folds back onto its planks. Deployed, both reach the grass at ≈ 26° (5.7 m) |
| Animation | `DoorClose` (glTF, frames 1–90 at 30 fps): the foot folds onto the ramp, then the ramp swings up and seals the doorway. Play forward to close for flight, backward to open. The nodes' rest pose is parked (ramp down) |
| Nodes | `Body` (static, one mesh), `Ramp` → `RampFoot`, four `Leg*` (pivot at the hip, for folding in flight) |
| Materials | `wren_paint` (one atlas: albedo, tangent-space normal, ORM = AO/roughness/metal; single-sided), `wren_glass`, `wren_glow_warm` (portholes), `wren_glow_eye` (Halden's eye), `wren_glow_cool` (light strips, pod and pad emitters, thruster). The game can map these names onto its own shaders (pulses, night gain) |
| Budget | ≈ 200 k triangles in all (Body ≈ 183 k: the plates and rails are real geometry), ≈ 14 draw calls by material; one 4096² atlas; GLB ≈ 12–15 MB with WebP textures |
| Interior | None. The game keeps its code-built rooms inside this skin |
| Paint | The code-built palette, a little deeper (terracotta, teal) to sit closer to the concept art |

## How it is made

- `wren_shape.py` — the analytic hull and layout constants (port of `src/ship/wrenShape.ts`).
- `wren_mesh.py` — a small mesh accumulator in game coordinates, primitives (lathe, sweep, rounded
  box, cylinder) and the plate generator: chamfered plates 2 cm proud, laid on any parametric surface,
  clipped to openings, closing to a point toward a pole, with rivet rows along their edges.
- `wren_parts.py` — the parts: hull grid with the canopy region, the panel layout (rings and staggered
  columns, no two neighbours the same colour, a cream panel for the name, seams under the canopy's side
  rims), raised half-round brass rails with rivet heads, plank wings with blunt trailing edges, capsule
  pods with nozzles and hover emitters, fin and tail planes, thruster, portholes, Halden's eye with its
  hood, light strips set in bronze channels and the whisker, the canopy frame (heavy rim, arches that
  land on it, bars that end on an arch, a boss at the nose), dome with collar and mullions, doorway
  frame and jamb, belly block, top hatch, moss tufts along the seams and rails, four legs with rams and
  hover pads, the two-part ramp-door.
- `wren_paint.py` — bake-source shaders (emission only: the bake records the paint, the game does the
  lighting): patchwork with grime, rain streaks, darker belly, warm grime on top, rust patches,
  cavity darkening (the concept's ink lines), worn edges, moss in up-facing seams; brass with tarnish,
  pearl enamel, dark metal, bronze, wood, moss, ink for the lettering.
- `build_wren.py` — builds, unwraps (skin: angle-based, the dark skin under the plates at a third of the
  density; fittings: smart project at lower density), triangulates, bakes in Cycles (rivets and the
  "THE WREN" lettering baked selected-to-active onto the plated skin; everything else from its own
  shader), packs the ORM, assigns the glTF materials, keys the door animation, exports.

Practice applied: detail that shapes the silhouette and catches light (plates, rails, frames) is real
geometry, finer detail (rivets on plates, lettering, grime) is baked with a cage; triangulating before
the normal bake so the tangent frames match the exported mesh; uniform texel density with less for
small brass parts; one atlas and one static mesh for few draw calls; WebP textures in the GLB. Possible
next steps when it goes into the game: KTX2/Basis textures (GPU memory), meshopt/quantized geometry,
a lighter LOD for distance, halos/lamps read from the GLB.
