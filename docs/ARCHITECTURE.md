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
  nature/boulders.ts      mossy boulders in the home meadow and the rock material the falls share
  audio/soundscape.ts     ported synth soundscape
  player/                 controller (walk/fly on a sphere), input
  time/clock.ts           game clock (time of day, date, seasons), time scale
  space/
    kepler.ts             Kepler's equation, orbital elements → position (float64)
    system.ts             the Seren system: bodies, rails, Solenne's spin + sun, eclipses, far-pass uniforms
    bodies.worker.ts      bakes the far bodies' surface maps and ring profiles at boot
    maps.ts               loads them into texture arrays
    farShaders.ts         far pass GLSL: analytic spheres, rings, sub-pixel dots, corona; the sun's surface
    sun.ts                M6: the sun's spin and activity (spot groups, filaments, prominences, flares) from clock.t
    nav.ts                M7: spheres of influence (patched conics), the cruise drive's speed law, parking orbits, conics, ETA
  story/halden.ts         dialogue hook (subtitle line, spoken); `story.quiet` while the showcase plays
  story/filmExport.ts     the showcase as a video file: fixed-step frames, WebCodecs H.264, mp4-muxer, download
  story/showcase.ts       the showcase film: seven shots keyframed in the home region's (or the cottage's) flat
                          coordinates, Catmull–Rom paths kept above the ground, per-shot day/hour, warmth,
                          exposure; the Wren's scripted lift-off, a space shot round Orrin; black beats at cuts;
                          the end title (`titleCard()`: a canvas texture laid over the picture by the grade)
  audio/music.ts          the showcase's quiet pad: slow chords and bells, synthesized, in a generated reverb
  story/voice.ts          Halden's voice: Web Speech API, voice choice, fallbacks
  ui/                     DOM panel, HUD, styles
```

  props/telescope.ts      the brass telescope: tripod (in the cottage kit), tube mesh, eyepiece view
  ship/
    wrenShape.ts          the analytic hull (radius/axis along z), openings, decks, walls, stairs, ladder, legs
    wrenGeometry.ts       Kit (merged code-built parts with hull coordinates): inner shell, interior rooms, glows
    wrenModel.ts          the outside: the Blender GLB (public/models/wren.glb), a game shader per material name
    wrenShaders.ts        ship shader family: wood, painted panels, lights, shadow depth; MODEL_* for the GLB
    wren.ts               pose (anywhere on the planet), ship shadow map, ramp-door and legs, walking aboard, lamps
    flight.ts             M5: Newtonian flight with flight assist, landing assist, the helm's cameras;
                          M7: space mode (inertial, patched conics), cruise drive, autopilot, time warp

Later milestones add the flight model to `ship/`.

## 3. Scale and coordinates

**Planet.** Radius `R = 81 920 m`, `g = 9.81 m/s²` → `GM = g·R²`. The number is chosen so the
cube-sphere quadtree's finest level lines up with the prototype grid: face width `2R = 163 840 m`,
level 11 chunk = 80 m, 32 quads per chunk → **2.5 m vertex spacing, exactly the prototype's DX**.
LOD hand-overs never open holes: a node shows its children only once all four have meshes; merging back, it
keeps showing them until its own mesh has come; and a node that has just come over the horizon (the camera
rose) stays empty while its mesh streams in, instead of failing its branch back to a coarse ancestor (which
flashed 108 tiles into one for a frame in the showcase's island shot).

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
- *Cloud amount* (Settings → Weather → Clouds, `settings.clouds` → `uClouds` 0–1): `cloudAmt(clear, def,
  proto)` in `glsl.ts` moves the coverage thresholds and column heights of the cumulus (`nearCoverage`) and
  the towers (`towerCov`) from a clear sky (0) through the game's sparse sky (0.5; the default slider is 0.4) to the prototype's
  own values (1: towers from weather 0.47 and up to 1.4 km). Cloud shadows and the orbital puffs follow;
  weather `uCover` still adds on top. The showcase follows it too (its weather is forced fair, its amount of cloud is the player's;
  it was approved at 0.5).
  Cost at 1: ~1 fps on Medium.
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
In the shell region the colour is the cloud's own, so ground and water composite it premultiplied, texel
by texel (`shellOver` in `render/glsl.ts`); blending toward a filtered colour pulled in the clear texels'
colour and turned every faint cumulus puff into a dark dot. Where the shell is clear the cloud pass still
writes the shell's colour without its opacity (`gShellCol`, the deck as it would look there), never black:
the shell is one sphere at −46 m but the ground is ~600 m lower, so at a grazing angle a ray crosses the
shell kilometres before it reaches the ground (from 6 km, rays crossing 13–22 km out land 1.4–5 km further
on). Just short of a bank's near edge the ray passes through a gap while its ground lies under the bank, and
the ground's `seaMist` (deck between eye and ground) swallows it into `bg` — which used to be black there
(the "black slits along cloud edges"). Now those rays take the deck's colour and read as the bank's edge.
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
surface (half speed). Waterfalls (`nature/waterfalls.ts`) break out of the home plateau's cliffs just
under the lip (found where the ground first falls away steeply, cast from the plateau's centre or from a
point of its own), leap clear on a ballistic arc and fall through the cloud sea to the talus; a stone well
stands by the cottage. Each fall breaks out of a crack in the face 4.5 m under the rim (after a brook-and-spring-pool version the user
found odd): a jagged fissure of dark wet rock ringed with moss, laid a hand's breadth in front of the face (a
decal quad, `CRACK_FS`), the jet leaping clear of it at 3.4 m/s; a couple of mossy boulders sit on the rim above.
A few more old boulders lie in the home meadow (`nature/boulders.ts`: hand-placed clear of the film's cameras,
smoothed lumpy icosahedra, moss on what faces the sky, solid to the walker). Their look (rebuilt 2026-11-04): a short two-sheet ribbon at the lip (glassy, a line of light, two-tone foam),
fading out in its first ~20 m; below it, particles drawn as one instanced quad each (560 streamers and 420
spray puffs a fall, the same set for every fall). A streamer leaves the lip and its flight is a closed form of
time, linear drag toward a terminal velocity (`x = x0 + W·t + (v0 − W)(1 − e^(−kt))/k`, `W` = a little wind plus
gravity over drag); its drop picks the point on the fall's precomputed line down the face (`uPath`, which leaps
clear of bulges), so it never falls into the rock, and it is drawn stretched along its motion. A puff is shed
from a streamer after a random time and then flies with heavy drag toward the wind itself (direction and
strength from the weather, gusting; turned upward where it blows into the face), wanders, grows, and is shaded
like a small cloud from a round normal (sun side lit, glowing when backlit), with the rainbow at 42° from the
antisolar point; all of it fades into the cloud sea like the ground does. The billboard axes: `right =
cross(V, up)` (the other order flips the winding and the quads are culled).
Sources: Unity, "Nature shaders with Shader Graph in 2022 LTS" (layered scrolling noise, foam at lip and
base); "How we made the waterfall in Season" (realtimevfx.com: foam masks, stretched noise, highlight layer);
80.lv, Spirited Away–style animated water in Blender (stretched noise, separate foam and base);
World of Waterfalls, "What types of waterfalls are there" (plunge vs horsetail; very tall falls turn to mist). The soundscape adds a falls roar and shore lapping.

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

**The Gate** (a fifth kit, `gate()` in `ruins/ruinKits.ts`; concept `docs/concepts/ruins-gate-sheet-*.jpg`). A
ring of the old civilisation 31 m across, leaning back 15° and sunk into a mound at the first hand-placed site
(920, 360), turned so the showcase camera sees the home plateau through it. The band is a rounded-rectangle
profile swept round the ring (`sweep`, crisp at corners over 50°, wound by its normals, broken ends capped):
pearl ceramic (kind 3, flaked to dark stone in a few large low patches), brass lips, joints every 45° and circle
glyphs (kind 4, dull with a little green, a soft sheen), and a recessed channel of light round the inner face
(kind 5, emissive, breathing slowly; its light falls on nearby surfaces through a per-vertex amount, `aInfo.w`).
Four arcs of a second ring (×1.3) and loose chips float: the vertex shader rocks each about its own centre
(`aPivot`) and bobs it (`aInfo.z` is its phase), so the drift costs nothing on the CPU. Ivy grows in clumps up
the lower half with strands hanging from them. Scattered sites still draw only from the first four kits
(`RANDOM_KITS`), so the rest of the world is unchanged.

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
the region). The outside is the Blender model (below, `art/wren/`); the inside is code-built, in the
cottage's style:
- *One analytic hull.* `hullR(z)` (egg nose, straight middle, long taper) and `hullYc(z)` (the tail sweeps
  up) define an elliptical section (taller above the axis than below). Every part is placed on it or
  measured against it: portholes, light lines and the name on the skin; deck widths (`floorHalf`),
  partitions fitted to the inner shell; the walking limits. The canopy, the door and the dome hole are cut
  in the shader (`cutOut`) with the same tests the collision uses, so what you see is what stops you.
- *The outside is a model.* `wrenModel.ts` loads `public/models/wren.glb` (≈ 16 MB, in a moment after
  start) and gives each primitive a game shader by its material's name: `MODEL_FS` lights the baked
  atlas (albedo, tangent-space normal, AO/roughness/metal) with the same sun, sky, shadow maps and haze as
  the region; glass and the named lamps (portholes brighter at night, Halden's eye pulsing, cool strips
  shimmering) keep the code-built look. Each mesh is drawn with its node's matrix in the model, so the
  ramp-door, its foot and the legs move on their pivots; the legs are lowered to the ground under each
  foot. The model's depth meshes go into the ship's shadow map (the glass does not).
- *The ramp is the door.* Parked, it is lowered to the grass at the angle the terrain gives (the walking
  surface uses the same angle); `setDoor(false)` folds the foot onto it and swings it up into the doorway
  over three seconds (the GLB's `DoorClose` clip, posed in code), and then the ramp and the doorway stop
  being walkable. The doorway is the concept's rounded rectangle, cut from the inner shell with the same
  test (`doorTop`).
- *The inside in one draw call.* `Kit` merges the inner shell, rooms and furniture into one geometry with
  per-vertex colour and `info` = (material kind, grain, indoor, ao); additive glows (hover pads, engine
  halos, the thruster) are one more mesh. The code-built outside (procedural plating on the analytic hull)
  was replaced by the model on 2026-11-03.
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

**Flying the Wren** (`ship/flight.ts`, M5). The ship has a pose instead of a site: `Wren.pos` (the ground
point under her hull, planet-fixed, float64) and `Wren.rot` (her axes in planet-fixed coordinates). Rendering
already went through `pfMatrix`, so only the lighting had to move: her shaders became local shaders (`SUN =
uSunDirL`, camera at the origin, cloud shadows from `uCamPF + uLtoPF·v`), and what belongs to her lives in
ship-local metres — her shadow map (an orthographic camera in her own frame, re-rendered when the sun moves
in that frame, i.e. every frame in flight), her lamps, the camera (`uCamShip`) for two-sided interior
surfaces. The home region's shaders still sample her shadow through the flat frame (`uSShadowMat` = her map ×
flat→ship), and get her rain footprint, only while she stands near home. Walking aboard converts planet-fixed
positions to ship-local with her pose (`toLocal`/`fromLocal`, floors as altitudes), so she can be boarded
wherever she lands; `settle()` fits the legs (±0.4 m) and the ramp to the terrain there.
- *Flight model.* Newtonian: position, velocity and orientation integrated in planet-fixed coordinates
  with gravity GM/r². A flight computer sits on top, as in Elite Dangerous and X4/Star Citizen: with the
  assist on, the throttle sets a velocity along the nose (plus a climb rate) and the computer thrusts
  toward it like a damped spring (k = 1.4/s, capped), cancelling gravity, so she hovers when you let go;
  with it off you get only the thrust you ask for, and above the air a true orbit (verified). Turning is
  rate-limited mouse steering about her own axes; the assist keeps the horizon level with a little bank in
  turns. Speed and thrust scale with height above the ground (35 m/s low, 2.6 km/s high), so orbit is a
  short trip, the free-flight idea from M1.
- *Landing assist* (L): the hover-landing pattern from Orbiter's autopilots and soft-landing guidance —
  attitude to local vertical, horizontal drift to zero, descent rate proportional to height (capped by the
  speed range, 0.7 m/s at the end). Touchdown is contact (nose, middle or tail) with the legs down and
  low speed; ground under nose, tail and wingtips that differs by more than 2.5 m is refused.
- *Camera.* A chase camera eased behind and above her with the horizon kept level, or the pilot's eyes
  (V). The near plane stays short at the helm (the dynamic near/far would grow it past the ship up high).
- *Research notes (2026-11-03).*
  [Elite Dangerous flight model](https://elite-dangerous.fandom.com/wiki/Flight_Model),
  [Star Citizen IFCS](https://starcitizen.tools/Intelligent_Flight_Control_System),
  [flight assist as velocity hold (Frontier forum)](https://forums.frontier.co.uk/goto/post?id=7255510),
  [spring-damper flight models compared (RSI forum)](https://robertsspaceindustries.com/spectrum/community/SC/forum/55059/thread/flight-controls-pritchett-x4-and-all-the-rest),
  [hover-landing autopilot (Orbiter forum)](https://orbiter-forum.com/goto/post?id=310431),
  [soft-landing guidance with terminal vertical attitude (IISc thesis)](https://etd.iisc.ac.in/handle/2005/4397).

**The Wren in Blender** (`art/wren/`, the outside the game draws). A Python build script makes a
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
- *Eclipses.* Lull's disc covers the sun's in the far pass (M6; it used to be a mask in the cloud pass); the uncovered fraction (disc overlap,
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

### Space navigation (M7)
- *Two flight frames.* Within 150 km of Solenne's datum the Wren flies planet-fixed exactly as in M5 (terrain,
  landing, the air). Above it she flies in the inertial frame of the body that rules there: `Flight.rI/vI/qI`
  relative to that body, in the ecliptic axes, float64. She hands back below 100 km (not while the autopilot
  flies). The planet's turning is not carried over at the hand-over (the pose is continuous; the stars stop
  turning with Solenne). Every frame the inertial state becomes a planet-fixed pose for drawing, so all
  rendering still goes through Solenne's frame and the camera-relative matrices; float64 keeps millimetres
  out to Vael (≈ 1.3·10¹⁰ m).
- *Patched conics* (`space/nav.ts`): each body has a sphere of influence a·(m/M)^0.4 (Laplace), capped at 0.35 a
  for this compressed system's heavy moon and giants (Lull is 0.6 Solenne's mass, Orrin half the sun's). The
  focus is the deepest body whose sphere holds her, with 3 % hysteresis; at a hand-over the position is exact
  and the velocity relative to the new body is kept (the ship's clock is real time while the worlds run on game
  time, so carrying their orbital velocities over would throw her at tens of km/s). Assist on holds a velocity
  relative to the focus and ignores gravity (as M5); assist off feels only the focus body's gravity, so she
  coasts on a real conic, drawn in the map from the eccentricity vector.
- *Cruise drive* (supercruise-like): speed = 0.12/s × the room to the nearest surface (weighted: the sun counts
  at 0.4, the giants at 0.7), capped at 6·10⁷ m/s; it eases up in about 1.4 s and down in 0.2 s, so approaching
  anything slows her exponentially and nothing is overshot. Trips take one to four minutes. It needs 30 km of
  room and drops out below 15 km.
- *Autopilot*: climb at 60° in the planet frame until the drive has room, slew the nose to the target (0.6 rad/s,
  eased), cruise (steering at the target, swinging 1.4× wide of any world whose disc the line crosses), and on
  reaching the parking radius (R + max(60 km, R/2); outside the rings for Orrin and Vael) drop into a circular
  orbit with assist off. ETA: the cruise law marched along the straight line (`cruiseEta`).
- *Time warp*: ×10–×1000 of both the clock and her flight, only coasting in open space (200 km and a radius
  from the focus, drive off); her flight is integrated in quarter-second steps, so a sphere-of-influence change
  is never jumped over (KSP's on-rails bug report shows why).
- *Rendering away from home*: beyond 4,000 km (`FAR_SOL`) Solenne joins the far pass (kind 4: its land atlas,
  highland, cloud-sea cover and a little noise for water, lit by the sun, a blue rim of air); the cloud pass
  writes black space with full visibility; the quadtree is hidden and the detail region stays where it was
  left. The sun's direction comes from the camera (at Verran it differs by degrees), its light falls off as
  (AU/r)^1.2 and goes out in Solenne's shadow; the sky light drops to almost nothing. View rays are rebuilt
  from the near plane (from the far plane, w cancelled to 0 in float32 with far/near ≈ 3·10⁸ and every
  background pixel turned NaN), and the far plane is capped at 200 km out there.
- *HUD*: the helm's readout (speed, room to the nearest world, cruise share, autopilot, warp), a target ring or an
  edge arrow with distance and arrival time, and the system map: a 2-D canvas orrery seen from ecliptic north
  (orbits sampled from the rails, moons once they would sit apart from their planet, the Wren's arrow and conic).
- *Research notes (2026-11-03).* Patched conics treat each sphere of influence as spherical with one body
  dominating, which makes trajectories closed-form and time warp cheap; KSP's bug tracker notes that at high warp
  the step can jump past an SOI change, hence short steps. Elite's supercruise limits speed by the distance to
  nearby gravity wells, slowest near stars, and drops you out automatically too close to a body. Orbit lines from
  state vectors: h = r × v, e = (v × h)/μ − r/|r|, p = |h|²/μ, r(θ) = p / (1 + e cos θ). Links:
  [KSP patched conics (forum)](https://forum.kerbalspaceprogram.com/topic/69339-patched-conics),
  [KSP issue 1043: SOI changes at high warp](https://bugs.kerbalspaceprogram.com/issues/1043),
  [Elite Dangerous supercruise](https://elite-dangerous.fandom.com/wiki/Supercruise),
  [Conic orbit from angular momentum (Purdue)](https://engineering.purdue.edu/~bethel/conic_orbit.pdf),
  [Orbital elements (Rosetta Code)](https://rosettacode.org/wiki/Orbital_elements).

### Seren, the sun (M6)
- *A body in the far pass.* The sun is kind 3 in the sorted far-body list: an analytic sphere hit at full
  resolution with an anti-aliased limb (seeing softens it by 0.3× the planets' amount, so the granulation
  survives), shaded in sun radii from the ray's closest point to its centre `X0 = (b·rd − c)/s`. Nearer
  bodies cover it through the same transmittance as everything else, so Lull's eclipses and Cinder's transits
  come for free; the old disc in the half-resolution sky pass is gone (the sky keeps the aureole). Its
  radiance is the palette's sun colour (white of space above 2–16 km) × 18, before the eclipse dims the light.
- *Spin and activity* (`space/sun.ts`, a pure function of `clock.t` like the rails): the pole is tilted 7.25°;
  the Carrington meridian turns once in 9 game days at the equator, slower toward the poles. Active regions come
  from six-hour slots hashed from their index (two chances each, rate × the cycle's activity): latitude from
  the butterfly law, size from a steep distribution (big groups rare and long-lived), Joy's-law tilt,
  growth/decay of leader, follower and plage; each region drifts by the differential rotation at its
  latitude. Quiescent filaments come from half-day slots at 22–58° latitude. Flares: hourly slots per region,
  probability growing with the group's size; rise 2–8 min, decay 15–55 min; 4 in 10 are eruptive (the region's
  filament becomes a rising arch, then a loop arcade). Only what faces the camera goes to the GPU: 12 regions
  (biggest first) and 10 prominences (eruptions and loops first, then half limb, half disc).
- *Photosphere* (white light): per-channel quadratic limb darkening (redder at the limb), granulation as
  3-D Worley F2 − F1 on the sun-fixed sphere with drifting feature points (boiling) and per-granule brightness,
  faded in once a cell spans 1.2–3 px; spots are drawn in each region's own frame (leader ahead, axis tilted):
  umbra, a penumbra with radial filaments and a ragged edge (angle noise without a seam), pores; faculae bright
  toward the limb. Big flares add faint ribbons.
- *Chromosphere* (hydrogen-alpha, H in the telescope): weak limb darkening, a network of ridged noise broken into
  patches with dark mottles, plage, softer spots with fibrils, and the prominences seen from above as dark
  filaments. Prominences are thin sheets standing on great-circle arcs (their plane passes through the sun's
  centre), so each ray is clipped analytically to the sheet's slab, the arc's wedge and the shell of its heights,
  and four samples inside find even a sheet seen face-on; the sheet meanders and swells inside its slab, has a
  ragged top, a few feet, and vertical threads at three scales, each faded in when resolved. Off the limb they
  glow (plus a spicule fringe and small procedural prominences all round); on the disc they absorb. The far
  pass brightens the sun 3× through this filter and the grade's red tint is a third as strong, so the sky goes
  black as through a real narrow-band filter. At totality the same prominences glow pink in white light.
- *Flares on the disc*: two ribbons either side of the polarity line, bending together and parting with the
  flare's age, never thinner than a pixel (flux kept), with bright kernels at the start.
- *Telescope*: the solar filter is fully in whenever the disc or anything within 2.5 sun radii is on screen
  (to the corners), at any zoom; tying it to the field's centre made the disc flash through when zooming near
  the limb; bloom is cut to 15 % behind it (the filter sits in front of the objective). The clock drive holds a
  view across a big disc relative to that body (the sun moves 11°/day against the stars), and a new lock needs
  the body's centre inside the field, so you can study a spot group at ×300.
- *Research notes (2026-11-03).* Procedural suns: granulation from cellular (Worley) noise, sunspots from a
  thresholded field with a darker core and a filamented ring, limb darkening, prominences as arcs of noise at the
  limb (Robert Hodgin's *Sol*; Stefan Gustavson's procedural sun exercise; Godot and Blender sun shaders).
  Physical references: the quadratic limb-darkening law, the Wilson effect, Joy's law and the butterfly diagram,
  differential rotation (A + B sin²φ + C sin⁴φ), two-ribbon flares and eruptive prominences followed by
  post-flare loop arcades, hydrogen-alpha views of the network, plage, filaments and spicules.
  Links: [Robert Hodgin, Sol](https://roberthodgin.com/project/sol),
  [Gustavson, procedural textures lab (sun)](https://itn-web.it.liu.se/~stegu76/campusveckan2017/labuppgift2017.pdf),
  [Godot shaders: 2D sun with flares](https://godotshaders.com/shader/2d-sun-with-bloom-filter-coronal-flares/),
  [Procedural sun in Blender](https://blenderartists.org/t/procedural-texture-sun-test/673441),
  [Limb darkening](https://en.wikipedia.org/wiki/Limb_darkening),
  [Joy's law](https://en.wikipedia.org/wiki/Joy%27s_law_(astronomy)),
  [Solar cycle / butterfly diagram](https://en.wikipedia.org/wiki/Solar_cycle),
  [Differential rotation](https://en.wikipedia.org/wiki/Differential_rotation),
  [Solar prominence](https://en.wikipedia.org/wiki/Solar_prominence),
  [Solar flare](https://en.wikipedia.org/wiki/Solar_flare).

### The showcase (2026-11-03)
- *Camera*: each shot eases along a Catmull–Rom path through its keys in the region's flat space (heights above
  the ground under each key, or absolute), clamped 0.3 m above the ground in between (a rim or hump between keys
  put the camera underground); the look target follows its own path, or the Wren. The clock is set to each shot's
  day and hour (the sun, Lull and the stars follow) and put back afterwards.
- *Ground*: shot keys measure heights as the walker does: the home grid inside `HALF − 25`, `heightAtDir` beyond
  (the grid clamps at its edge, which buried a camera 4.7 m under the lowland meadow).
- *Clouds*: at each cut the cloud drift offset is set to the shot's `clouds` (default 0), so every playback and
  export of a shot has the same sky.
- *Pace*: `span: [a, b]` plays only that part of a shot's camera path (and field of view); equal ends lock the
  camera off while the world moves in the frame.
- *Lens*: `FocusPass` (renderer, film only) reads the depth resolved from the multisampled scene target (re-rendering
  depth with an override material would miss the custom vertex shaders: grass, region, ship), linearises it with the
  frame's near/far, and gathers up to 48 samples on a golden-angle spiral (Dennis Gustafsson's single-pass bokeh:
  a sample farther than the centre may blur it at most twice the centre's own blur, so sharp subjects don't bleed
  onto a soft foreground). Thin-lens circle of confusion `0.018·|1/focus − 1/d|`, capped at 0.55 % of the
  picture height, so it reads the same at every render scale. Focus is the distance to the shot's look target.
- *Export* (`story/filmExport.ts`, driven from `main.ts`): `Renderer.exportSize(1920×1080)` pins the drawing
  buffer (pixel ratio 1, no governor; CSS `object-fit: contain` shows it whole), the live frame loop stands aside,
  and the film is stepped by exactly 1/60 s per frame; each frame becomes a `VideoFrame` straight from the WebGL
  canvas (same task as the draw), is encoded as H.264 (High, else Main) and muxed in memory into a fast-start MP4.
  Yields go through a `MessageChannel`, not timers, which a hidden tab slows to one a second. At the first frame
  and each cut the clock is held (`step(0)`) for 1.5 s of real time so worker terrain, grass and bakes arrive.
  The world's sounds are suspended meanwhile; there is no audio track.
- *Cinema detail* (Settings → Showcase → Video; `settings.exportDetail`): for the export only, `main.ts` switches
  to the `cinema` quality preset, raises the quadtree's split factor (`lod.k` 2.3 → 3.4, so ~1.9× the tiles) and
  sets the shared `uCine` uniform; `exportSize(3840×2160)` draws at 4K and `filmExport.ts` scales each frame
  down to 1080p on an `OffscreenCanvas` (high-quality smoothing) before encoding. With `uCine` the terrain shader
  adds what a distant cliff or meadow needs only when it is resolved: `cliffFace()` (bedded ledges every ~5.5 m,
  vertical joints, a shadowed seam and moss on each ledge, rain stains, lichen; triplanar on the two vertical
  axes) and tussocks, flower drifts and far-reaching brush flecks on the meadow. Each frame also waits (≤ 4 s)
  while the planet or the detail region is still building (`busy`). The preset keeps MSAA (with `msaa: 0` the
  post chain's depth texture fails, GL error 1282) and High's grass lattice (so foreground blades stay where the
  shots were framed). `solenne.exportLook('cinema' | 'standard' | null)` previews either look without exporting.
- *Smoothness*: during the film the clock advances by a smoothed frame time (spikes count at most three frames),
  and the governor queues its steps until the next cut (`Renderer.calm`), applying them in the black beat.
- *Framing*: shot fields of view are for a 16:9 screen; `main.ts` rescales the camera's vertical field so the
  2.39:1 band shows the same picture in any window shape. The night shot's day and hour were chosen by a search for
  Lull with two planets near it in a dark sky; point-like worlds are lifted 10× in the film (far pass `uDot`).
- *Orbital clouds*: from far up the cloud shell reads the cloud-sea atlas through a cubic B-spline (`atlasSmooth`,
  four bilinear taps clamped inside the face) and fades the small puffs and edge fraying above 40–220 km, since
  detail a few pixels wide only shimmers there.
- *Leaving shot* (`leave`): the camera 450 km over Solenne in planet-fixed space, its direction set from the sun
  (60° off the sunward vertical, toward home's pole), the picture's up turned so the sun falls from the upper left;
  the Wren follows a ray from the camera whose distance shrinks geometrically (1100 m → 30 m) while it swings
  left, her nose along her motion, yawed and banked into it. Depth: one range cannot hold a ship 30 m away and a
  planet 450 km away (with the near plane at 4 m the lakes and shores z-fought), so during the shot (`close`) the
  Wren moves to layer 1 and `Renderer.shipRange` draws her in a second scene pass after the planet's, depth
  cleared, with her own near/far (2 m … 20 km); the planet's pass gets a near plane half its altitude out. The
  lens linearises the depth that is left (the ship's) with the ship camera's range.
- *Space shot* (Orrin): placed round a body in its inertial frame (distance in radii, 9.5 for Orrin, angle from
  the sunward side, tilt over the equator); the Wren's distance grows geometrically (32 m → 700 m) with time itself,
  not the eased camera time, so she never stops; the tilt takes the sun's side of the ring plane (the far side shows the rings' unlit face),
  the side is picked so the sun comes over the camera's right shoulder onto the Wren's flank, and the picture's
  up is the body's pole (`Showcase.up`; on the ground it is the local vertical).
- *Title*: `titleCard()` draws the name and one line into a 2048×512 canvas once (fonts loaded first); the grade
  pass (`uTitle`, `uTitleA`) lays it over the picture after the fade, so it rises over the last shot and holds on
  black for the film's last 6.5 s.
- *Thrust* (also in normal flight): jet plumes are billboards round their axes in ship-local space
  (`JET_VS/FS`, additive), length and brightness from `uThrust`; the lift jets under the pods use `uLift`, which
  fades with height. Their downwash is `shared.uWash` (flat x, z, strength, radius), read by the grass shader to
  press blades outward with a flutter; it widens and weakens as she climbs.
- *Cuts*: a 0.35 s black beat, then a fade in; on the cut frame the exposure jumps to its target, the cloud pass
  forgets its history, the region, cottage and ship shadows re-bake, and the frame-rate governor ignores the next
  second (bakes and chunk streaming).
- *Grade* (renderer `uCine`, `uWarm`, `uFade`, `uBars`): saturation, split toning, lifted blacks; per-shot warmth;
  letterbox and fades drawn in the picture, so nothing but the canvas is on screen (CSS hides the rest).
- *Frame rate*: `Renderer.cinema(true)` caps the pixel ratio at 1.5 and runs a stricter governor every half second
  on the median frame (vsync-aware: 30 is acceptable); when the scale is at 0.6 it raises a strain level instead
  (`onStrain`: grass density ×0.6/×0.4, cloud steps ×0.75/×0.55), and gives it back first when there is headroom.
  The grass instance grid's vertex work is a large fixed cost (about 670k blades on High) that resolution alone
  does not reduce.

## 4. Frame pipeline

1. Clock → star system on its rails (`space.update`): Solenne's spin, sun direction (PF); palette, weather.
2. Player update (PF), local frame L rebuilt (parallel transport), camera near/far; far-pass uniforms
   for the camera (`space.view`: directions, extinction, eclipse, moonlight; the sun's activity and which of its
   regions and prominences face the camera).
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

- *Shader rule learned the hard way:* never `pow()` a value that rounding can push below zero (`1 − dot(N, V)`,
  `1 − μ`, interpolated noise): GLSL leaves it undefined, the GPU returns NaN, and bloom smears one NaN pixel over
  the whole frame as a black flash. Clamp the base (`max(x, 0.0)`, `clamp(dot, 0, 1)`). Likewise `smoothstep(a, a, x)`.

- Space (M7): other bodies cast no shadow on the ship, and Lull's shadow is not on Solenne seen from space; near
  other worlds the ship only stops at their sphere (landing there is M8); the hand-over to the far-pass Solenne at
  4,000 km pops a little; the ship's flight runs in real time while the worlds run on game time (×10), so velocities
  are not carried across a sphere-of-influence boundary.
- The sun (M6): an eruption is one rising arch, not an expanding bubble or a coronal mass ejection; at most 10
  prominences from the list are drawn at once (small procedural ones fill the rest of the limb); the
  granulation's 27-cell Worley costs about 5 ms at 1080p when the sun fills the eyepiece at high power.

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
- The Wren's shadow reaches the ground only in the home region (the region shaders sample her map); far
  from home, and when she flies high, she casts none on terrain. The pilot stays seated in flight (no walking
  aboard a moving ship yet). No engine sound. Her lamps do not cast shadows, and rain still falls under the
  wings (only the hull's footprint is kept dry).

## 6. Dev hooks

`window.solenne` in the browser console: `teleport(x, z, yawDeg, pitchDeg, h?)` (spawn-region flat
coords; `h` turns on free flight), `altitude(m)`, `setTod(hours)`, `setDay(d)`, `setSeason(0–3)`,
`simulate(seconds)` and `render()` (step / draw without the animation loop, which browsers pause for
hidden pages), `look(name)` (turn toward 'Lull', 'Orrin', 'Verran', 'Vael', 'Cinder', 'Pip', 'Wick'),
`fov(deg)` (narrow the view to inspect a body; 62 is normal), `scope(name?, fovDeg?)` (stand at the
telescope and look through it, optionally at a body; 'Seren' is the sun), `leaveScope()`, `telescope`
(`point(dirL)` swings it and lets the drive re-hold), `solarFilter(ha = true)` (hydrogen-alpha or white
light), `flare(limb = false)` (a big eruptive flare now in the largest group facing you, or the one nearest
the limb), `sunNow()` (activity level, groups, prominences, the strongest flare facing you), `nextEclipse(minCovered, days)` (jump to
the next eclipse seen from where you stand with the sun up), `board()` (stand at the foot of the Wren's
ramp, facing the door), `wrenView(dist, side)` (a three-quarter view of the Wren; side −1 for starboard),
`wrenDoor(open?)` (fold the ramp-door shut or lower it; no argument toggles), `helm()` (sit at the Wren's
helm), `flight` (the flight model: `pos`, `vel`, `q`, `assist`, `look(dx, dy)`, `land()`),
`wren` (`toWorld(lx, lz)`, `toLocal(p)`, `inside(p)`), `flight` in space (`inSpace`, `focus`, `rI`, `vI`, `qI`, `pI`,
`target`, `auto`, `cruise`, `warp`; `toSpace()`, `toggleCruise()`, `autopilot()`), `sysMap` (`toggle()`, `shown`), `showcase(on?)` and `show` (the film: `t`, `shots`), `exportLook('cinema' | 'standard' | null)` (the export's look and size without exporting), plus `player`, `planet`, `sky`, `detail`,
`ruins`, `view`, `space`, `camera`, `renderer` (`dynScale`, `adapt`), `shared`, `frame`, `wx`. `sky.mat.uniforms.uDbg.value` is a cloud layer mask (1 sea, 2 towers,
4 cumulus; 7 = all).
