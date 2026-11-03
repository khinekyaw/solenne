# The Wren — build plan (chosen design: A "Sky whale")

References: `wren-chosen-sky-whale.jpg` (the look), `wren-turnaround.webp` (front/side/back/top shape),
`wren-cutaway.webp` (rooms and decks).

## Where the three pictures disagree, and what we chose (agreed with the user, 2026-11-03)

| Question | The pictures | Chosen |
| --- | --- | --- |
| Size | Measured by the person: cutaway ≈ 21 m long, concept ≈ 30 m, turnaround ≈ 35 m. The hull shape (length ≈ 2.65 × height) agrees in all three | **≈ 26 m long, ≈ 10 m tall hull**: the cutaway's rooms at a comfortable size (decks ≈ 2.7 m high), still "a house, not huge" |
| Rooms | Cutaway: upper deck cockpit (under the glass nose) → galley and table → bunk room → Halden's core; lower deck workshop → cargo hold → engine room; stairs mid-ship | **As in the cutaway** |
| The dome | On top over the bunk room / Halden's core, but no way up in the cutaway | **A ladder from Halden's core room up into the dome**: a stargazing seat (fits the telescope) |
| Door and ramp | Under the wing's leading edge, opening into the lower deck by the stairs | **As drawn**: ramp → lower deck by the cargo hold → stairs up |
| Landing legs | Concept 4, cutaway 3 on the near side, turnaround 4 + a belly block | **4 legs** (front pair, rear pair) and the small belly block from the front view |
| Engines | Pods under the wings (concept, turnaround; further back in the cutaway); the back view adds a big glowing main thruster in the tail | **Pods under the wings mid-ship + the tail thruster** |
| Halden's eye lamp | Lower nose, slightly off-centre in the front view | **Keep it off-centre** (the hull is meant to be a little asymmetric) |
| Lettering | Turnaround paints a big "A" (the generator's panel label) | **Drop the "A"**, keep "THE WREN" on the nose from the concept | Everything is built from code in the cottage's style: shapes
generated in TypeScript, one painterly shader family sharing the game's lighting (`GROUND_SUN`,
`skyAmbient`, haze, cloud and house shadows), no image textures except a small painted name plate.

## Size (from the person in the concept, ~1.75 m)

| | |
| --- | --- |
| Length, nose to tail tip | ~26 m (see the table above) |
| Hull height / width | ~10 m / ~9 m (slightly flattened, flatter belly) |
| Belly above the grass | ~1.6 m on the landing legs |
| Observation dome | ~6 m across, ~2.5 m above the hull top, on the rear half |
| Wing span | ~24 m tip to tip, mid-hull, slightly below the middle |
| Decks inside | lower ~2.8 m, upper ~2.8 m headroom |

## Parts and how each is made

| Part in the concept | How it is built |
| --- | --- |
| Whale-shaped hull | One lathe surface from a hand-tuned length profile (big rounded nose, slow taper to the tail), squashed into an ellipse, belly flattened. Every point on it comes from a function, so portholes, lights and moss can be placed exactly on the skin |
| Patchwork panels, rivets, seams | Procedural in the shader from (angle around, distance along) the hull: a panel grid with per-panel colour from the palette (cream, terracotta, teal, olive, brass), slightly irregular sizes, dark seams, rivet dots along seams, rust and dirt from the shared noise texture — the same painterly approach as the cottage walls |
| Moss on the top seams | Shader mask on up-facing skin along seams (noise-broken), plus a few code-built moss clumps on top, like the roof moss |
| Glass nose canopy (many panes) | The nose cap of the lathe as a separate glass mesh (cottage glass shader: sky reflection, warm interior showing through) with brass mullions as thin tubes along a latitude/longitude grid |
| Observation dome | Glass hemisphere + brass mullion grid, same glass shader |
| Two rows of round portholes | Instanced brass rings (torus) on the hull, each with a glowing warm glass disc; lit stronger at night |
| Halden's eye lamp (lower nose) | Brass ring + emissive disc with a slow, calm pulse |
| Nose light bar ("whisker") and blue light lines along the seams | Thin emissive tubes following curves on the hull, soft blue-white, picked up by the bloom |
| Stubby wings | Extruded rounded wing outline with a bevel (airfoil-ish), patchwork shader |
| Engine pods under the wings | Small lathe capsules with brass rings, a pearl-white intake and a soft glowing exhaust ring |
| Tail fin and small tail planes | Extruded rounded shapes, terracotta/patchwork |
| Four landing legs with hover pads | Pearl-white struts and dark joints (boxes/cylinders); the pads float a hand above the grass with a soft blue glow disc under each (additive) and light on the ground |
| Side door and ramp | Arched doorway in the hull side under the wing; ramp of wooden slats on a metal frame, hinged so it can rise later |
| "THE WREN" painted on the nose | Small canvas-drawn texture decal (hand-lettered font), weathered in the shader |

## Inside (two walkable decks)

Built like the cottage interior (merged code-built furniture, warm lamps, indoor exposure), from the
cutaway concept when we have it. Planned rooms: cockpit under the glass nose (two worn seats, glowing
instruments), galley and table, bunk room, Halden's core (a softly glowing sphere in a brass cradle),
workshop, cargo hold by the ramp, engine room (pearl-white machinery, blue-white light), stairs between
decks, the dome reached from the upper deck. Walking: deck floors and stairs as floor functions, walls and
furniture as collision boxes in ship-local coordinates (the cottage's system); the outside of the hull is
a solid shape you walk around.

## Placement

On the meadow a short walk from the cottage, on the flattest ground nearby, nose toward the cloud sea;
legs adjust to the ground height. Halden gets lines when you first see it and step aboard.

## Matching the concept

1. Ask ChatGPT for the side/front/back/top turnaround and the cutaway (prompts in `wren-prompt.md`) —
   one three-quarter picture hides the far side, the back, the top and the inside.
2. Block out the hull, wings, dome and legs at the measured proportions; screenshot the game from the same
   three-quarter camera as the concept and compare side by side; adjust the profile until the silhouettes
   match.
3. Then the skin (panels, colours, rivets, moss), glass, lights, the ramp and the interior, comparing
   at each step.

It will read as the game's own 3D painterly style (like the cottage), not a flat painting: the brush
texture comes from the shader, the shapes and colours from the concept.
