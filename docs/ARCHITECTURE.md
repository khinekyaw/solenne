# Solenne — Architecture

## 1. The prototype (baseline we port from)

Single HTML file, three.js r160, ~3k lines. Systems and how they talk:

| System | How it works | Key details |
| --- | --- | --- |
| **Terrain** | CPU heightfield 561² @ 2.5 m (1.4 km), `heightFn` = lobed island SDF + fbm, cliffs to −300 m | `terrainTex` RGBA: r = baked sun shadow, g = grass mask, b = island mask. Quads deep in the cloud sea are skipped |
| **Ground shader** | Painterly: noise-driven hollows/dry patches/brush flecks, rock strata on slopes, cloud + house shadows, bounce light from the cloud sea, haze, `seaMist` blends into the cloud background texture | All noise from one 256² RGBA tileable "weather" texture |
| **Grass** | Instanced blades, positions generated in the VS from a world-locked grid around the camera (hash per cell). Two rings: near (4 segments) and far (2 segments, wider) | Bending from `gustAt()` (noise stretched across the wind, scrolled along it) |
| **Flowers / motes** | Camera-facing dandelion cards (alpha-to-coverage); additive pollen points in a camera box | Same wind field |
| **Sky + clouds** | Fullscreen raymarch at reduced resolution into a half-float RT: cloud sea, cumulus towers beyond R0, near cumulus layer, cirrus veil. HG dual-lobe phase, 3–6 light samples. Temporal reprojection by view direction with history blend | 64³ shape + 32³ detail 3D noise volumes |
| **Lighting** | `uSunDir/uSunColor/uZenith/uHorizon` palette from sun elevation + weather (`updateSunPalette`). `skyAmbient`, `hazeColor`, `GROUND_SUN 0.4` | ACES grade pass, UnrealBloom 0.16 |
| **Weather** | Presets eased toward (cover, dark, rain, wind, fog, bolt, still), Dynamic = weighted Markov wander. Wetness accumulates | Rain streak box around the camera, lightning bolt mesh + flash pulses, delayed thunder |
| **Cottage** | Merged geometry built from boxes/cylinders/extrusions with per-vertex colour + info (kind, grain, indoor, AO), one shader, glass + flames + smoke | Shadow map only re-rendered when the sun moves; AABB collision + floor function; indoor exposure |
| **Audio** | Web Audio: pink/brown noise loops → filtered wind body/roar/whistles, grass rustle, fire crackle, rain + roof patter, thunder, footsteps synced to head bob | CPU copy of the gust field so sound matches the waves |
| **Player / UI** | Pointer-lock FPS, walk (slope/height limits) + fly, touch sticks, settings panel (localStorage), adaptive resolution | |

## 2. Module plan

```
src/
  main.ts                 boot sequence + frame loop
  config.ts               planet constants, quality presets
  settings.ts             persisted settings (localStorage)
  core/                   math, noise (2D prototype noise, 3D gradient noise, periodic noise)
  planet/
    solenne.ts            radius, gravity, cube faces, flat<->sphere mapping, sun/rotation frame
    heights.ts            spawn-region heightFn (prototype) + global terrain height function
    quadtree.ts           cube-sphere quadtree, LOD selection, horizon culling, chunk meshes
    terrain.worker.ts     chunk meshes, region heightfield, shadow bake, land-mask and highest-ground atlases
    terrainMaterial.ts    painterly ground shader (ported)
    region.ts             spawn-region textures (height, masks, shadow): clouds, cottage, terrain
    detail.ts             the moving detail region for grass, flowers and rain (rebuilt by a worker)
    regionBake.ts         grids, grass mask, terrain-shadow bake (worker-safe)
  render/
    renderer.ts           WebGLRenderer, composer, bloom, grade, adaptive resolution
    frame.ts              floating origin: local camera frame, shared uniforms
    glsl.ts               shared GLSL (COMMON, palette, wind, curve, height fetch)
  atmosphere/
    palette.ts            sky palette (CPU twin of GLSL `palette()`), day/night
    sky.ts                sky + clouds pass (raymarch, shells from altitude, reprojection)
    volumes.worker.ts     3D noise volumes + 2D weather texture
  nature/                 grass, flowers, motes
  weather/weather.ts      presets, dynamic weather, rain, lightning
  house/cottage.ts        the cottage (ported 1:1)
  ruins/                  code-built ruin kits, procedural placement, instancing, collision
  audio/soundscape.ts     ported synth soundscape
  player/                 controller (walk/fly on a sphere), input
  time/clock.ts           game clock (time of day, date, seasons), time scale
  space/
    kepler.ts             Kepler's equation, orbital elements → position (float64)
    system.ts             the Seren system: bodies, rails, Solenne's spin + sun, eclipses, far-pass uniforms
    bodies.worker.ts      bakes the far bodies' surface maps and ring profiles at boot
    maps.ts               loads them into texture arrays
    farShaders.ts         far pass GLSL: analytic spheres, rings, sub-pixel dots, corona
  story/halden.ts         dialogue hook (subtitle line, spoken)
  story/voice.ts          Halden's voice: Web Speech API, voice choice, fallbacks
  ui/                     DOM panel, HUD, styles
```

  props/telescope.ts      the brass telescope: tripod (in the cottage kit), tube mesh, eyepiece view
  ship/
    wrenShape.ts          the analytic hull (radius/axis along z), openings, decks, walls, stairs, ladder, legs
    wrenGeometry.ts       Kit (merged code-built parts with hull coordinates), exterior, glass, interior rooms
    wrenShaders.ts        ship shader family: patchwork plating, wood, painted panels, lights, glass, shadow depth
    wren.ts               placement, ship shadow map, walking in ship-local space, collision, lamps

Later milestones add the flight model to `ship/`.

## 3. Scale and coordinates

**Planet.** Radius `R = 81 920 m`, `g = 9.81 m/s²` → `GM = g·R²`. The number is chosen so the
cube-sphere quadtree's finest level lines up with the prototype grid: face width `2R = 163 840 m`,
level 11 chunk = 80 m, 32 quads per chunk → **2.5 m vertex spacing, exactly the prototype's DX**.

**Frames** (all CPU math in float64 — plain JS numbers / THREE.Vector3 / Matrix4):

| Frame | Origin / axes | Used for |
| --- | --- | --- |
| **PF** planet-fixed | planet centre; rotates with Solenne | terrain chunks, player, house anchor, sun direction |
| **Face flat** | per cube face: `(X, h, Z)`, `X = u·R`, `Z = v·R`, `h` altitude | noise lookups, region textures, heightfields. On face +Y this *is* the prototype world space (spawn at the face centre, where gnomonic distortion ≈ 0) |
| **L** local render frame | origin = camera, y = local up, x = parallel-transported east | everything the GPU draws. Camera-relative = floating origin every frame |

- Flat → sphere (gnomonic): `P = C + (R + h)·normalize(X, R, Z)`. The GPU version is written in a
  cancellation-free form relative to the region origin, so grass and the cottage stay sub-mm precise.
- Terrain chunks store vertices relative to the chunk centre (float32); the chunk centre minus the
  camera is computed in float64 each frame and uploaded as the model matrix.
- Region content (grass, flowers, cottage) keeps the prototype's math in flat space and only maps
  to clip space at the end (`regionToClip`). Global content (terrain, sky) works in L with a
  per-vertex local up.

**Depth range.** Camera-relative rendering + **dynamic near/far** (near grows with height above
ground, far = max visible terrain distance). Logarithmic depth was rejected: it needs
`gl_FragDepth`, which disables early-z for millions of grass blades. Planets and the moon (M2)
are drawn in the sky pass as depth-less impostors / a separate far pass, so no single depth buffer
has to span metres to millions of km.

**Clouds.** All layers are spherical shells: altitude `h = |p − C| − R` replaces `y`.
- Coverage uses the prototype's own 256² weather map, laid **triplanar over planet-fixed
  positions** projected onto the datum sphere (coverage is per column, like the prototype's 2D map).
  On a cube-face centre — the spawn — this is exactly the prototype's xz lookup with the same scales
  and offsets; elsewhere the three planes blend seamlessly. (A 64³ 3D weather volume was tried first:
  its missing fine octaves made the towers soft and blobby.)
- Near the ground the overhead cumulus deck and cirrus are laid **flat relative to the camera**
  (`uFlatK`), because on an 82 km sphere a horizontal ray reaches the 340 m deck only ~7 km out and
  the deck would converge into a wall at the horizon. It fades back to true shells by 3 km altitude.
  The cloud sea and towers stay curved (the sea horizon is ~3 km away from the plateau).
- Towers avoid land via a 6×128² land-mask atlas (plus the prototype's plateau exclusion `R0`).
- The cumulus layer (base 340 m) keeps clear of mountains: a 6×512² highest-ground atlas (~320 m
  texels, `uLandTop`) holds the max of the sampled ground over each texel's 3×3 neighbourhood, so a
  bilinear lookup never undercuts a nearby sample, and `nearCoverage` fades to nothing where it reaches
  120–240 m. Cloud shadows and the orbital puffs use the same coverage. Highlands peak above the layer
  (up to ~1.4 km) and the clouds used to cut through them, with speckled edges where the half-res
  front distances met the slope. The first try put the channel in the 128² land atlas: its 1.3 km
  texels plus the 3×3 spread cleared the sky from 1 km north-east of the cottage. Only highland texels
  (coarse max > 40 m) are sampled finely, which adds ~0.3 s to the worker's boot bake.
- The cloud pass writes the distance at which clouds become plainly visible (transmittance < 0.75)
  into its alpha; the ground shader fades into the cloud behind that distance, so towers correctly
  hide distant highlands. It applies beyond 500 m (full by 1 km). It used to start at 1.5 km and only
  record fully opaque fronts (T < 0.5), which let mountains show through thinner or nearer clouds when
  flying low. The gate exists because the march cannot see the ground: on the plateau, low sea puffs
  in the bays would otherwise speckle the meadow (the old "white dotted line"). If that returns, raise
  the gate in `cloudFrontK` (`render/glsl.ts`) rather than the threshold in `marchClouds`.
- Towers and cumulus are much sparser and lower than the prototype's (towers 0.73–0.82 instead of
  0.47–0.6, max ~900 m; cumulus 0.71–0.9): on a planet, and especially from the air, the prototype's
  wall of cloud buried the sea and every other island.
- Cloud-front compositing (`cloudFrontK`): each of the 4 nearest half-res texels judges with its own
  front distance and the judgements blend bilinearly. Interpolating the distances themselves invented
  near fronts (a bright line along the sea horizon); a hard per-texel cut stair-stepped the edges.
- The march strides geometrically through empty air (≥ 6 % of the distance per step) and thins the
  clouds out over the last part of its 11.5 km range. With the old 1.5× stride, rays that start at the
  camera ran out of steps ~1.5 km out, so towers popped in as you flew.
- Above ~1.8–4.5 km the volumetric march crossfades into cheap shells (opaque sea + tower and
  cumulus puffs) so the orbital view stays fast; highlands draw on top of the shell.

**Atmosphere.** Stylised optical-depth model: density `ρ = exp(−h/2.5 km)`; the prototype palette
(zenith/horizon/sun from sun elevation + weather) is indexed by the optical depth along the view
ray. On the ground this reproduces the prototype sky exactly; from altitude the same function
gives a pale limb fading to black space, and evaluating the palette at the local sun elevation of
each point gives the day side, terminator and night side. Aerial perspective uses the same density
integral, so haze is the prototype's on the ground and thins out with altitude.

**Neighbouring highlands.** On an 82 km sphere the cloud-sea horizon is only ~3 km from the plateau,
so random highlands 8+ km away sit below it. `NEIGHBOURS` in `planet/heights.ts` pushes four islands
4–11 km out (a mesa, a long plateau, broad uplands, a ~1 km massif), sized to clear the horizon.
See `docs/images/` for the view from the plateau and from orbit.

**Under the clouds (open world).** The cloud sea is a ~220 m deck: billowing top near −32 m, lumpy
underside near `SEA_BASE` −250 m. Below it is clear grey air over lowlands at `LOWLAND` −640 m;
the plateau's cliffs continue as steep talus (`heightFn`, only beyond the cliff foot, so the part the
prototype showed is unchanged). The ground shader measures how much of the deck lies between the
camera and each point (`seaMist`), so from above the deck swallows everything as before and from
below the air stays clear; below the deck the sun is blocked (overcast grey ambient, grey murk) and
the eye adapts. Nothing limits movement: free flight goes anywhere, and walking only refuses to
*climb* slopes over ~46°; you can step off any edge, slide down faces too steep to stand on, and fall
at 1 g.

**Detail region anywhere.** Grass, flowers and rain need a 1.4 km heightfield + mask texture
(`planet/detail.ts`). Near home it is the spawn grid; anywhere else a worker rebuilds it around you
(heights from `planetHeight`, grass mask, terrain shadow), centred on a 250 m lattice of the current
cube face's flat coords, so blades keep their places when it moves. Region shaders are written in
face flat coords and map to clip space with `curveRel`, relative to the region centre and free of
cancellation, so they stay sub-millimetre precise anywhere on the planet; the sun is passed in the
face's axes (`uSunDirF`). The cottage keeps its own fixed spawn-frame uniforms.

**Cloud banks.** The cloud sea is not global: `seaCover` (heights.ts) is a low-frequency field that
puts great banks over about half of Solenne with wide clear gaps, always covering the home plateau's
surroundings (3.5–7.5 km) so home looks like the prototype. It is baked with the land mask into a
two-channel atlas (r land, g cover) sampled by every shader: the deck thins and breaks into billows
toward a bank's edge, orbital shells follow it, and mist, overcast light and murk only exist under a
bank, so clear lowlands get full sun. The same field is meant to carry the oceans (banks over warm
water). From orbit the cloud pass hands the ground its opacity through the alpha channel
(> 0 cloud-front distance, −1…0 star visibility, −3…−2 shell opacity) so cloud edges blend softly.
In the shell region the colour is the cloud's own (black where there is none), so ground and water
composite it premultiplied, texel by texel (`shellOver` in `render/glsl.ts`); blending toward a filtered
colour pulled in the black and turned every faint cumulus puff into a dark dot.
Distant land gets a slow biome tint (golden grassland, woodland greens, heather).

**Water.** One sea level, `WATER` −690 m. The terrain function carves ocean basins where `seaField`
is high (down to ~−900 m, highland islands rise out of them), lake hollows in the lowland, rivers as
wide valleys along the zero lines of a noise field, and a lake near home. Cloud banks sit over the
coasts and inshore water; the hearts of the oceans and the inland plains lie open. The terrain worker
adds a water mesh to every chunk that reaches sea level (same grid, flat at sea level, with skirts;
its bounds and horizon culling use the surface, not the seabed). `waterMaterial.ts`: swell + chop from
the shared noise, Fresnel sky reflection (local palette far away), sun glint that vanishes under a
bank, clear green shallows, lapping foam, the same haze/murk/mist/cloud hand-overs as the ground.
Beaches and seabed are in the ground shader; no grass below the beach. The player floats at the
surface (half speed). Waterfalls (`nature/waterfalls.ts`) break out of the home plateau's cliffs a few
metres under the rim, leap clear on a ballistic arc and fall through the cloud sea to the talus;
a stone well stands by the cottage. The soundscape adds a falls roar and shore lapping.

**Life under the clouds.** The grass mask allows grass everywhere except inside the cloud deck. Below
it the blades grow taller and blue-green and are lit by the overcast (`deckLight`, `deckShade`,
`murkAmount` in COMMON). Flowers switch to bluebells and wood anemones, with glowing lantern blooms
and toadstools; motes become slow glowing spores (and fireflies over the meadow at night).

**Ruins** (`ruins/`). Four kits built from code like the cottage (broken arched wall, colonnade, round
tower stump, stepped temple plinth with a worn figure), mossy and weathered in an L-frame shader that
shares the deck light, murk and cloud mist. Sites come from a 900 m hash grid per cube face (half the
lowland cells, a few highland ones, none on the home plateau, four placed by hand near its foot),
drawn as InstancedMeshes within 5.5 km. Walls and columns push the player out; the plinth's steps
are walkable floors.

**Halden's voice** (`story/voice.ts`). Lines are spoken with the browser's speech synthesis (Web Speech
API) — no audio files, in keeping with the synthesized soundscape. Voices load asynchronously
(`voiceschanged`); novelty voices are filtered out and a calm voice is preferred (Daniel on macOS, then
Google/Microsoft UK voices, premium/enhanced variants first). Rate 0.94, pitch 0.9, volume follows the
Volume slider; mute and "Off" cancel speech, and so does hiding the page. Speech can't be routed through
Web Audio, so the soundscape ducks (nature bus × 0.45) while Halden talks. The subtitle stays up until
he has finished (plus a beat); Chrome can cut long utterances off after ~15 s without firing `end`, so
lines stay short and the subtitle also hides after an estimated length. The first line comes after
"Click to begin", which satisfies autoplay rules. Settings → Sound lists the English voices and plays a
sample when you pick one ([MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API),
[Chrome cutoff, PhET notes](https://github.com/phetsims/utterance-queue/issues/60)).

**Telescope** (`props/telescope.ts`, M3). The tripod is built into the cottage kit (shared material,
shadow map and collision box); the tube is a second mesh with the cottage material and its own `uFlatM`
(house-local → flat), placed by `cottage.placeLocal()` and casting into the cottage's shadow map (it does
not receive it: its 1.3 cm texels are too coarse for a 15 cm tube). No two parts share a plane (the
objective is recessed in a lathed dew-shield hood). Looking through it puts the camera at the tube's pivot
and narrows the field of view (`camera.fov`, 10° → 0.22°). Practice applied: look speed scales with
1/magnification (the same hand movement crosses the same share of the view at any zoom); the tube follows
the mouse with a little inertia; arrow keys are slow-motion knobs (a third of the field per second). Like a
real alt-az mount it shows setting circles — altitude, and azimuth from true north (the planet's axis
projected onto the horizon) — and a sky guide of the bodies above the horizon; a number key starts a GoTo
(a slower eased swing). The clock drive follows a locked body (GoTo, or one centred within half its radius;
held within half the field), otherwise the patch of sky it was left on (a fixed inertial direction);
touching the controls releases it. The label uses a looser "near the centre" test than the lock. The centred body comes from the far
pass's directions (`space.dirL`, `angL`); `space.info(k)` gives distance, lit fraction and Lull's phase. The
grade pass draws the round field stop (`uScope`), the eye's adaptation to a bright disc (`uFilter`) and a
warm solar filter (`uSolar`). Stars are measured in pixels (a fixed ~1.3 px dot, brightness from a steep
magnitude distribution); a narrow field gathers more light (gain ∝ √magnification) and finer star grids
fade in, so the eyepiece shows fainter stars, as a real one does. Few cells hold a visible star (a steep
magnitude-like law), and a patchy galactic band raises their density and adds a faint glow. The far bodies
are seen through "seeing": each ray to a body is perturbed by a slow, time-varying ripple of a few arcseconds
(×4 near the horizon), the disc edge and texture LOD soften to that angle, and a per-pixel grain sits on
the bodies
([zoom sensitivity scaling](https://www.mouse-sensitivity.com/forums/topic/7393-whats-the-best-calculation-setting-for-high-magnification-scopes/),
[Gaia Sky star rendering](https://gaia.ari.uni-heidelberg.de/gaiasky/docs/3.7.3/Star-rendering.html)).

**The Wren** (`ship/`, M4). Design A "Sky whale" from the concept sheets (`docs/concepts/`): ≈ 25 m nose
to tail, a ≈ 10 m tall hull on four hover legs, parked 30 m from the cottage (`WREN_SITE`, ground height from
the region). Everything is code-built, in the cottage's style:
- *One analytic hull.* `hullR(z)` (egg nose, straight middle, long taper) and `hullYc(z)` (the tail sweeps
  up) define an elliptical section (taller above the axis than below). Every part is placed on it or
  measured against it: portholes, light lines and the name on the skin; deck widths (`floorHalf`),
  partitions fitted to the inner shell; the walking limits. The canopy, the door and the dome hole are cut
  in the shader (`cutOut`) with the same tests the collision uses, so what you see is what stops you.
- *Plating without a texture.* Hull vertices carry `skin` = (metres around, z, angle); the fragment
  shader lays panels of slightly irregular size on it, colours each from the concept's palette (cream,
  terracotta, teal, olive), and adds seams, rivets along them, streaks, rare rust, a brass strake, warm
  grime on the top and moss with crisp edges along the up-facing seams (a soft, heavy coat read as
  camouflage from above). Practice from hard-surface tools: panel lines come from a parametrisation of
  the base surface, not from modelling them, so the mesh stays smooth and the panels follow the curvature.
- *One draw call for the ship.* `Kit` merges every part (hull, wings, pods, legs, ramp, furniture) into one
  geometry with per-vertex colour and `info` = (material kind, grain, indoor, ao); glass (canopy, dome) and
  additive glows are two more meshes. ≈ 150 k triangles, about 1 ms per frame measured.
- *Light and shade.* The shared lighting (`GROUND_SUN`, `skyAmbient`, haze, cloud shadows). The ship has a
  2048² shadow map of its own (re-rendered only when the sun moves); `houseShadow()` in every region
  shader takes the min of the cottage's and the ship's maps, so the meadow, the cottage and the ship's own
  interior are shaded by it. Inside, the indoor term (low sky ambient) plus ten warm lamps; the last one
  spills out of the door onto the ramp. Portholes, Halden's eye and the core glow; windows brighten at night.
  Rain is not drawn inside (`inShip()`), and the eye adapts indoors as in the cottage.
- *Walking in ship-local space.* The player stays in planet-fixed coordinates; the ship turns a position
  into ship-local metres (`toLocal`, x port, y up, z toward the nose), answers `floorAt` (ramp, decks, 17
  stairs, a ladder into the dome, the dome's half-moon platform; steps up to 0.45 m) and `collide` (outside:
  legs, belly, ramp rails; aboard: the inner shell at chest height, partitions with arched doorways,
  furniture as boxes that apply between their heights; in the dome, the glass). It implements the same
  obstacle interface as the ruins. Practice for walkable ships: keep the walker in the ship's frame and
  convert at the boundary (when the Wren flies, its frame moves and the walker moves with it), rather than
  parenting the player to a moving physics body.
- *Rooms (cutaway).* Upper deck: cockpit under the glass nose (two seats, console, holographic
  instruments), galley, landing at the top of the stairs, bunk room (ladder up into the dome), Halden's core.
  Lower deck: workshop, cargo hold by the door and ramp, engine room. The dome is a stargazing seat.
- *Halden.* A line the first time you see the ship, another when you step aboard.
- *Research notes (2026-11-03).* Procedural hull plating on an untouched base mesh (PanelForge for
  Blender), rivet rows along seams (modo's procedural rivets), and the walkable-ship pattern (local frame
  of the vessel, convert in and out). Links:
  [procedural hull plating, PanelForge](https://blenderartists.org/t/procedural-hull-plating-that-leaves-the-base-mesh-alone-built-panelforge/1650487),
  [modo procedural rivets](https://learn.foundry.com/modo/901/content/help/pages/shading_lighting/emodo_textures/rivets.html),
  [moving character inside a moving spaceship (Unity)](https://discussions.unity.com/t/moving-character-inside-of-a-moving-spaceship/638935),
  [walking on moving vessels (KSP forum)](https://forum.kerbalspaceprogram.com/topic/174984-walking-kerbals-on-moving-vessels).

**The Wren in Blender** (`art/wren/`, exterior only, not imported yet). A Python build script makes a
detailed exterior in Blender 5.2 and exports a GLB in the ship-local frame above. The hull is sampled
from a port of `wrenShape.ts`, so the code-built interior and the collision fit inside it unchanged.
Detail that shapes the silhouette and catches the light is real geometry: chamfered plates 2 cm proud,
half-round brass rails, the canopy frame, light strips set in channels. Finer detail (rivets on the
plates, lettering, grime, moss in the seams) is baked selected-to-active, giving one 4096² atlas (albedo,
tangent-space normal, ORM) on about 200 k triangles. The boarding ramp is the door, a two-part
drawbridge: `Ramp` is hinged on the sill and `RampFoot` folds onto it. A glTF animation (`DoorClose`)
folds the foot and seals the doorway for flight. The four `Leg*` are pivoted for folding, and glass and
lamps carry named materials for the game's shaders. Practice and
sources (2026-11-03):
[high-to-low baking with a cage](https://docs.altava.com/creator-guide/3d-modeling/low-polygons/bake),
[texel density](https://help.maxon.net/c4d/en-us/Content/html/Texel_Density.html) and
[where to set it](https://polycount.com/discussion/comment/2608791),
[GLB size and GPU memory (WebP vs KTX2, meshopt)](https://app.cinevva.com/guides/optimize-glb-for-web).

**Planet view.** `P` or the menu button switches the camera to an orbit around Solenne (drag to turn,
scroll or pinch to zoom, 12 km to 6 R up); the walker waits where you left them. A DOM pin
(`#youMark`, `ui.marker`) is placed each frame by projecting the walker's position through the local
frame; it hides when the walker is on the hemisphere facing away from the camera.

**Meadow structure.** `MEADOW_GLSL` (`meadowLush`, `meadowDrift`) is shared by blades, flowers and
the ground shader: domain-warped fbm for winding lush/short swathes plus a cellular channel for
hummocks. Blades gather into 0.7 m tufts (hash-based clump centres), lush swathes are taller and
cooler, short turf lower and warmer but still dense; a few seed stalks stand above. Flowers bunch
into 2.4 m clumps inside warped drifts, mostly one species per drift (seed puff, buttercup, pale
blue, pink clover, daisy). Defaults are lower than the prototype: density 70 %, height 80 %.

**Time.** 24 h day, 32-day year (four seasons of eight days; day 1 is the spring equinox). The clock is
apparent solar time at home, and the date persists with the time of day. Stars are fixed in the inertial
frame I and turn with the sky (`uLtoStar = PF→I · L→PF`).

**Star system** (`space/`). Five planets and three moons on Keplerian rails around the sun **Seren**.
Best practices applied (sources at the end of this section):
- *Rails, not integration.* Every position is a pure function of game time: mean anomaly → Kepler's
  equation (Newton–Raphson from E₀ = M + e·sin M, converges in 3–5 steps) → perifocal → ecliptic
  rotation. Time scale, clock jumps and frame rate can never make an orbit drift. Periods come from the
  parent's GM (Kepler's third law), so the system stays consistent for the flight milestones.
- *Inertial frame I* = the ecliptic (z = ecliptic north, x = spring equinox). Solenne's pole is tilted 16°
  (OBLIQUITY). Its spin is set each frame so the home meridian faces the sun at clock noon:
  `meridian angle = α_sun + hourAngle(tod)`; PF→I maps (AXIS, MERIDIAN, EAST0) onto (pole, meridian, east).
  The old equinox formula is the special case δ = 0. The sun direction in PF follows, and with it the
  seasons: noon sun at home 26°–58°, days 9.6–14.5 h.
- *Compressed scale for the sky, not for realism* (as Outer Wilds and KSP do): what matters is apparent
  size and motion. Solenne's orbit is 2·10⁹ m; the sun is drawn 1.4° in radius. Lull orbits 6000 km out
  (4.2 days sidereal, phases every ~5 days, inclined 5.2° with regressing nodes, so eclipses come in
  seasons) and looks ~1.5° in radius — slightly bigger than the sun, so total eclipses happen (the umbra
  is ~16 km across Solenne). Orrin looks 0.4–0.5° with rings out to 2.3 R; Verran, Cinder and Vael
  0.04–0.18° (dots to the eye, discs in a telescope).

| Body | Kind | Orbit | Look |
| --- | --- | --- | --- |
| Seren | sun | — | the sky shader's disc |
| Cinder | airless rock | 0.42 AU, 8.7 d | cratered, evening/morning star |
| Solenne | home | 1 AU, 32 d | — |
| Lull | Solenne's moon | 6000 km, 4.2 d, tidally locked | maria on the near face, craters, rays |
| Verran | desert with thin air | 1.55 AU, 62 d | rust and basalt, a canyon, polar caps, pink haze |
| Orrin | ringed gas giant | 3.2 AU, 183 d, tilt 22° | amber/cream belts, a great storm, rings with a dark division |
| Pip, Wick | Orrin's moons | 5 and 9.5 Orrin radii, in its ring plane | icy / dark dots |
| Vael | ice giant | 5.4 AU, 400 d, tilt 52° | pale sea-green, thin ringlets |

- *Floating origin for space too.* Body positions and the camera's inertial position are float64 on the
  CPU; the GPU only gets unit directions in L plus radius/distance — no planet-scale numbers, no depth.
- *Far pass* (`farShaders.ts`, inside the full-res background pass `BG_FS`). Each body is an analytic
  ray–sphere hit (written to avoid cancellation for tiny angular radii), shaded from a baked
  equirectangular map (`bodies.worker.ts`, 1024×512 per layer, rgb albedo + height; explicit mip level from
  texels per pixel, so no seam). Airless rock uses Lambert blended with Lommel–Seeliger plus a small
  opposition surge (the flat, evenly bright full moon); the height map tilts normals near the terminator;
  gas giants get a soft terminator and limb darkening; bodies with air get limb haze and a thin halo.
  Rings: ray–plane hit, profile from a texture array with mip level by footprint, lit/unlit face (light
  soaking through), the planet's shadow on the rings and the rings' shadow on the planet. Bodies are
  sorted nearest first each frame and each covers what lies behind (Lull occults Orrin correctly).
- *Sub-pixel bodies* (research: "Smaller than Pixels", Schneegans et al. 2025): below ~2 px a body is a
  fixed 1.3 px soft dot whose intensity carries the disc's whole light (phase-integrated Lambert sphere),
  cross-faded with the disc between 1.2 and 2.4 px, so planets never flicker in and out as they move.
- *Behind the air and the clouds.* The cloud pass now renders to two targets (MRT); the second carries how
  much of the sky's far side shows through clouds, cirrus and fog (temporally blended like the colour).
  The background adds the bodies × that visibility on top of the sky's own light, so the moon is a pale
  disc by day and bright by night, and cloud edges cover it smoothly. Extinction through Solenne's air
  (reddening toward the horizon) is a per-body colour computed on the CPU from the same density model.
- *Eclipses.* Lull's disc masks the sun's disc in the cloud pass; the uncovered fraction (disc overlap,
  with parallax from where you stand) dims the sun linearly and the sky by its square root, the eye
  adapts a little, and near totality the background draws a streaked corona. Moons in their planet's
  shadow are dimmed the same way (penumbral).
- *Moonlight.* `uMoonlit` (Lull's lit fraction × height × air) lifts the night entries of the palette, on
  the CPU and in `PALETTE_GLSL` alike, so moonlit nights are silver-blue and new-moon nights stay dark.
  The night side of Lull is lit by Solenne-shine, strongest at new moon.
- *Weather at night.* The palette's overcast greys dim to 7 % at night (plus a little moon glow through
  thin cloud, `uMoonlit × (1 − uDark)`), so rain and storms make the darkest nights; the overcast-day
  exposure boost is halved at night. The weather overcast is not raymarched, so the cloud pass also
  scales star and far-body visibility by `1 − smoothstep(0.55, 1, uCover)`.
- *Research notes (2026-11-03).* Far bodies in a separate layer behind everything, with directions from
  double-precision positions (KSP's "scaled space" camera; Unity/Godot large-world advice); Kepler by
  Newton–Raphson with a good first guess and an iteration cap; lunar photometry: Lambert is limb-darkened,
  Lommel–Seeliger evenly bright at full phase, real moons sit between, plus an opposition surge; ring
  shaders test rays toward the sun against the planet sphere and the planet's surface against the ring
  plane (Space Nerds In Space); gas giants from latitude-stretched, domain-warped noise, baked once
  rather than evaluated per pixel; sub-pixel point lights keep a constant total energy and a minimum
  footprint to avoid flicker. Links: [Godot large world coordinates](https://docs.godotengine.org/en/stable/tutorials/physics/large_world_coordinates.html),
  [KSP scaled space (forum)](https://forum.kerbalspaceprogram.com/topic/142500-ksp-has-unrealisticdistorted-3d-rendering),
  [Kepler's equation (arXiv 1009.1738)](https://arxiv.org/pdf/1009.1738),
  [Radiances of planetary spheres](https://phys.libretexts.org/Bookshelves/Astronomy__Cosmology/Planetary_Photometry_(Tatum_and_Fairbairn)/01%3A_Principles_of_Planetary_Photometry/1.09%3A_Radiances_of_Planetary_Spheres),
  [Opposition surge](https://en.wikipedia.org/wiki/Opposition_surge),
  [Space Nerds In Space ring shaders](https://apps.txrxlabs.org/blog/128/recreational-computer-programming-group-meeting-julyaugust-2014/),
  [GLSL gas giants](https://gamedev.net/blogs/entry/1388471-glsl-gas-giants-atmospheric-scattering),
  [Smaller than Pixels (Eurographics 2025)](https://diglib.eg.org/items/fc13d662-0f6a-4a23-9ae2-d7f1ec1afc78/full).

## 4. Frame pipeline

1. Clock → star system on its rails (`space.update`): Solenne's spin, sun direction (PF); palette, weather.
2. Player update (PF), local frame L rebuilt (parallel transport), camera near/far; far-pass uniforms
   for the camera (`space.view`: directions, extinction, eclipse, moonlight).
3. Quadtree update (split/merge, worker requests), chunk model matrices (camera-relative).
4. Sky/cloud pass → two half-float targets (colour + front/stars/shell code; far-side visibility),
   reduced resolution, temporal reprojection.
5. Main scene: background quad (clouds, stars, planets, moons, corona), terrain, grass, flowers, cottage,
   rain, motes, bolt.
6. Bloom → grade (ACES, exposure: day/indoor/night adaptation).
7. Adaptive resolution check, HUD. A change of render scale (or a window resize) is only requested here
   and applied by `renderer.beginFrame()` at the start of the next frame, before anything is drawn:
   resizing a canvas clears it, and doing it between drawing and display blinked the whole screen.
   Hysteresis keeps the scale from flip-flopping (down after 2 s under 45 fps, up after 4 s over 57).

## 5. Known limitations (v1)

- The detail region switches faces abruptly at a cube-face edge (grass pops there).
- Cloud/terrain ordering is only resolved in the volumetric near field; grass and the cottage are
  never hidden by cloud (flying into a cloud next to the house shows the house).
- Ground noise uses per-face coordinates: small pattern seams at cube-face edges.
- No geomorphing between LOD levels (skirts hide cracks).
- Weather is a single local state around the player.
- Looking steeply down from 2–4 km the volumetric march undersamples (streaky towers) until the
  shell crossfade takes over; tune this with the flight milestone.
- Eclipse light is a single value at the camera; distant land and the planet seen from orbit do not
  show the moon's shadow. Moonlight is ambient only (no moon shadows or reflections).
- Stars are cells on the view sphere and grow at very narrow fields of view (matters for the telescope).
- The Wren cannot fly yet (M5); its door is always open and the ramp always down. Its lamps do not cast
  shadows, and rain still falls under the wings (only the hull's footprint is kept dry).

## 6. Dev hooks

`window.solenne` in the browser console: `teleport(x, z, yawDeg, pitchDeg, h?)` (spawn-region flat
coords; `h` turns on free flight), `altitude(m)`, `setTod(hours)`, `setDay(d)`, `setSeason(0–3)`,
`simulate(seconds)` and `render()` (step / draw without the animation loop, which browsers pause for
hidden pages), `look(name)` (turn toward 'Lull', 'Orrin', 'Verran', 'Vael', 'Cinder', 'Pip', 'Wick'),
`fov(deg)` (narrow the view to inspect a body; 62 is normal), `scope(name?, fovDeg?)` (stand at the
telescope and look through it, optionally at a body), `leaveScope()`, `telescope`, `nextEclipse(minCovered, days)` (jump to
the next eclipse seen from where you stand with the sun up), `board()` (stand at the foot of the Wren's
ramp, facing the door), `wrenView(dist, side)` (a three-quarter view of the Wren; side −1 for starboard),
`wren` (`toWorld(lx, lz)`, `toLocal(p)`, `inside(p)`), plus `player`, `planet`, `sky`, `detail`,
`ruins`, `view`, `space`, `camera`, `renderer` (`dynScale`, `adapt`), `shared`, `frame`, `wx`. `sky.mat.uniforms.uDbg.value` is a cloud layer mask (1 sea, 2 towers,
4 cumulus; 7 = all).
