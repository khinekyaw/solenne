# Solenne — Plan & Checklist

Tick items only after they are verified running in the browser. Keep this file current.

**Status (2026-11-03):** M1 (the planet), M2 (the star system) and M3 (the telescope) are built and
verified in the browser: Solenne circles its sun Seren with four other planets, its moon Lull and two moons
of Orrin on Keplerian rails, and a brass telescope by the cottage shows them up close. M4: the Wren is built
and parked by the cottage, outside and a walkable two-deck inside (verified; the optional Mochi placeholder
is left). Mobile/touch checks are parked for now (the user asked to skip them). **Next milestone: M5 —
flight.**

## M0 — Foundation
- [x] Read the prototype artifact and summarise its architecture (`ARCHITECTURE.md` §1)
- [x] Game design doc (`GAME_DESIGN.md`)
- [x] Module plan, scale and coordinate strategy (`ARCHITECTURE.md` §2–3)
- [x] Vite + TypeScript + three.js 0.160 project, `npm run dev` / `npm run build`
- [x] `CLAUDE.md` with conventions

## M1 — Planet Solenne (built 2026-11-02; two items await manual checks)
### Planet & terrain
- [x] Planet constants (R = 81.92 km, 1 g), cube faces, flat↔sphere mapping
- [x] Global terrain height function (lowlands under the cloud sea, highlands, ridges)
- [x] Spawn region = prototype plateau embedded at the +Y face centre
- [x] Cube-sphere quadtree with LOD, skirts, horizon + frustum culling
- [x] Terrain chunk generation in a Web Worker
- [x] Floating origin (camera-relative local frame), dynamic near/far
- [x] Painterly ground shader ported (meadow, rock strata, cloud/house shadows, bounce, sea mist)
- [x] Baked terrain self-shadow for the region, re-baked in the worker as the sun moves

### Atmosphere, sky & clouds
- [x] Palette (CPU + GLSL), day/night, twilight, night sky + stars
- [x] Optical-depth atmosphere: prototype sky on the ground, rim from orbit
- [x] Volumetric clouds on the sphere (sea, cumulus, towers, cirrus) with temporal reprojection
- [x] Cloud shells for high-altitude/orbit views; fade of clouds, fog and weather with altitude
- [x] Aerial perspective from the same density model

### Life & environment
- [x] Grass (two LOD rings), wind gusts shared with ground shading and sound
- [x] Dandelions, pollen motes
- [x] Weather presets + Dynamic, wetness, rain, lightning, thunder
- [x] Cottage (exterior, interior, fire, smoke, glass, lamp), shadow map, collision, indoor exposure
- [ ] Synthesized soundscape (wind, grass, footsteps, rain, roof, fire, thunder) — ported 1:1, runs without errors; not yet checked by ear

### Player & UI
- [x] First-person walking on the sphere (1 g), jump, run; dev free-flight to orbit
- [x] Pointer lock (desktop)
- [ ] Touch controls — ported 1:1; not yet tested on a device
- [x] Settings: weather, time of day, time scale, wind, grass, volume, quality (persisted)
- [x] Adaptive resolution, fps/altitude readout
- [x] Halden's first line on arrival

## M2 — Star system (done 2026-11-03)
- [x] Sun + 3–5 planets + ≥1 moon on Keplerian rails (compressed distances/sizes): Seren; Cinder, Solenne,
      Verran, Orrin, Vael; moons Lull (Solenne), Pip and Wick (Orrin). Positions are a pure function of time
- [x] Planets as shaded spheres with atmosphere and rings where fitting: baked surface maps (craters, maria,
      deserts, bands, storms), lunar-style shading, limb haze, rings with shadows both ways
- [x] Far-object pass in the sky, visible day and night: analytic spheres in the full-res background,
      behind clouds/fog (cloud-pass visibility target) and reddened by the air; sub-pixel bodies are soft
      dots that keep their total light (no flicker)
- [x] Solenne's orbit drives the sun direction: 32-day year, 16° tilt → seasons (noon sun at home 26°–58°,
      days 9.6–14.5 h); the clock stays local solar time. Date persists; Settings → Season
- [x] Lull: phases, libration, Solenne-shine on its night side, moonlight on the night sky and land
- [x] Eclipses: Lull masks the sun's disc, dims sun and sky near you, corona at totality
- [x] Halden lines the first time you look at Lull and at Orrin, and in an eclipse
- [x] Dev hooks: `solenne.look(name)`, `fov(deg)`, `nextEclipse(min)`, `setDay(d)`, `setSeason(i)`, `space`

## M3 — Telescope (done 2026-11-03)
- [x] Brass-and-wood telescope on a tripod in front of the cottage (code-built): tripod, tray and head in
      the cottage mesh (shading, shadow map, collision); the tube (dew-shield hood, recessed objective,
      bands, focuser, eyepiece, finder) is its own mesh that stays pointed where it was last used
- [x] `E` to use: prompt when you stand by it and face it; zoom ×6–×280 (scroll or +/−); look speed scales
      with the zoom; a round field stop; E or Esc to step back
- [x] Label for the centred body: name, description, distance, % lit (Lull's phase name); the sun too
- [x] Clock drive: a locked body is followed (0.008° off at 10× time, < 0.5° at 600×); otherwise it holds
      the patch of sky you left it on; touching the controls releases the lock
- [x] Aiming like a real mount (user feedback): setting circles (Alt/Az in degrees, compass), a sky guide of
      what is up with its position, number keys 1–8 to GoTo (an eased swing that locks on), arrow keys/WASD as
      slow-motion knobs (Shift faster), a faint centre mark; label moved under the circles
- [x] Eye adapts to a bright disc filling the eyepiece; a warm solar filter with limb darkening on the sun
- [x] Stars stay pixel-sized points at any zoom; magnification brightens them and reveals fainter ones
- [x] Natural night sky (user feedback): far fewer stars, steep brightness law (few bright, many faint), a
      faint patchy galactic band where they gather
- [x] Planets less "rendered" (user feedback): seeing — a slow shimmer and softening through the air,
      stronger toward the horizon — plus a fine grain on the bodies
- [x] Halden lines: first look through the telescope, the solar filter
- [x] Fixed: the objective z-fought with the dew shield's cap (black spokes); the tube self-shadowed in blocks

## M4 — The Wren
- [x] Concept: design A "Sky whale" chosen (`docs/concepts/wren-chosen-sky-whale.jpg`); build plan in
      `docs/concepts/wren-build-plan.md`
- [x] Turnaround (front/side/back/top) and cutaway (rooms) of the Sky whale from ChatGPT
- [x] Settled where the pictures disagree (≈ 26 m long, rooms as the cutaway, ladder up to the dome, 4 legs,
      wing pods + tail thruster, no "A"): table in the build plan
- [x] Block-out at the measured proportions (one analytic hull, ≈ 25 m), compared with the concept from the
      same three-quarter camera (`docs/images/m4-wren-day.jpg`)
- [x] Skin: procedural patchwork panels, rivets, seams, streaks, moss, "THE WREN" on the nose; glass nose
      and dome with brass mullions; two porthole rows, Halden's eye lamp, blue-white light lines, whisker;
      wings, engine pods, tail fin and planes, tail thruster; four hover legs; door and ramp
- [x] Walkable two-deck interior: cockpit under the glass nose, galley, landing, bunk room, Halden's core;
      workshop, cargo hold by the door, engine room; stairs between the decks; a ladder from the bunk room
      up into the dome (a stargazing seat)
- [x] Original Ghibli-style ship: rounded, slightly asymmetric hull (eye lamp off-centre), riveted patches,
      glass dome, stubby painted wings, landing legs, warm cabin lights, moss
- [x] Parked near the cottage; collision outside (legs, belly, ramp rails) and inside (shell, walls,
      furniture), the ramp; its shadow on the meadow and cottage; rain stays outside; indoor exposure
- [x] Halden lines the first time you see the Wren and when you step aboard
- [x] Night: portholes, eye lamp and windows glow, engine halos, warm light spilling down the ramp
- [ ] Mochi placeholder near the house (optional)

### The Wren in Blender (exterior only, 2026-11-03; checked in Blender renders, not in the game)
- [x] Scripted Blender build (`art/wren/`, see its README): the game's analytic hull, real canopy/door/dome
      openings, riveted patchwork plates, brass straps and trim, airfoil wings, capsule pods, fin and tail
      planes, thruster, portholes, Halden's eye, light lines, dome, legs, ramp, moss, "THE WREN"
- [x] Baked atlas (4096²: albedo, normal, ORM) and a game-ready GLB (ship-local frame, `Body` + hinged
      `Ramp` + four `Leg*` pivots, named glass/glow materials)
- [x] Turnaround renders against the concept sheets (`art/wren/renders/`)
- [x] Second pass after the user's review: canopy frame like the art (arches land on the rim, bars end on
      an arch or the nose boss), light strips set in bronze channels, raised half-round brass rails with
      rivet heads and moss caught on them, plates as real chamfered geometry, moss tufts along the seams
      (≈ 200 k triangles)
- [x] Ramp-door (user request, "like in the movies"): the ramp is the door, a two-part drawbridge whose
      foot folds onto it before it swings up and seals the doorway (now the concept's rounded rectangle);
      glTF animation `DoorClose` and a render of it (`wren-ramp-fold.mp4`)
- [ ] Import into the game (the user asked not to yet): map materials onto the region shaders, ship
      shadow map from the GLB, hide the code-built exterior, keep the code interior; the doorway's new
      shape (`doorTop()`), the ramp's length/angle and the door animation (closed in flight) in `wren.ts`
- [ ] Interior in Blender (later)

## M5 — Flight
- [ ] Newtonian flight, velocity hold, gravity-aware landing assist
- [ ] Take off → orbit → land; smooth atmosphere-to-space transition
- [ ] Halden lines for take-off / orbit / landing (hooks)

## M1 polish (open)
- [x] Fix white speckled line across the far meadow (cloud-front compositing on the plateau)
- [x] Neighbouring highlands visible from the plateau; fewer cumulus towers
- [x] Night side of the planet dark from orbit (distant ground used the camera's day/night)
- [x] Fix bright line along the cloud-sea horizon (filtered cloud-front alpha)
- [x] Sparser, lower towers and cumulus, especially as seen from the air
- [x] Open world under the clouds: deck underside, lowland at −640 m, talus, overcast light, no movement limits
- [x] Walk off edges, slide down faces too steep to stand on, fall at 1 g
- [x] Meadow: tufts, lush/short swathes, seed stalks; flower drifts with five species; lower grass defaults
- [x] Detail region follows the player: grass and flowers on every highland and under the clouds
- [x] Life under the clouds: shade grass, bluebells, anemones, glowing lantern blooms, toadstools, spores; fireflies at night
- [x] Ruins: four code-built kits, procedural sites (mostly under the clouds), collision and walkable steps
- [x] Planet view (P / Settings → View): orbit camera, drag to turn, scroll/pinch to zoom, back to the walker
- [x] Planet view marks where you are: a "You" pin over the walker, hidden when it is round the far side
- [x] Stormy nights too bright (2026-11-03): the overcast grey was only dimmed to 25 % at night (brighter
      than a clear night sky) and the overcast-day exposure boost stacked on the night adaptation. Now an
      overcast night is darker than a clear one (moon glow only through thin cloud), the weather boost is
      halved at night, rain/storm overcast hides stars, Lull and the planets, and pollen/fireflies shelter
      from rain. Measured horizon on screen: storm night 0.262 → 0.077 (clear night 0.105, moonlit 0.166);
      days unchanged
- [x] Fix whole-screen blink (2026-11-03): adaptive resolution resized the canvas after a frame was drawn
      and before it was shown, so that frame was blank; now applied at the start of the next frame, with
      hysteresis (down after 2 s under 45 fps, up after 4 s over 57, no re-try for 30 s after a failed
      step up). Verified: old order showed a black frame, new order the full frame
- [x] Cloud sea in banks over ~half the planet, clear sunlit lowlands between; softer orbital cloud edges; land colour variety
- [x] Water: ocean basins under the cloud banks, lakes, river valleys, beaches, a lake near home
- [x] Water surface on the terrain chunks: waves, sky reflection, sun glint, shallows, shore foam
- [x] Swimming at the surface; waterfalls off the home plateau; a stone well at the cottage; falls and shore sounds
- [x] Fix towers popping in while flying (march ran out of steps ~1.5 km out) and stair-stepped cloud edges over distant land
- [x] Mountains showing through clouds in front of them when flying low (front at T < 0.75, compositing
      from 500 m); verified 2026-11-03: towers cover the massif, no speckles on the plateau
- [x] Cumulus cutting through mountains (2026-11-03): the 340 m layer ignored the ground and highland
      peaks reach ~1.4 km, so puffs sat inside ridges with speckled edges and sharp shadows. A 6×512²
      highest-ground atlas now fades the layer out where the ground reaches 120–240 m. Verified on the
      south-east massif with the same cloud offset (puffs in the ridge → clean ridge, cumulus above the
      plain); the home sky is unchanged (coverage factor 1.0 within 3 km of the cottage)
- [x] Black dots over the land in the planet view (2026-11-03): ground and water blended toward a filtered
      shell colour that included the black written where there is no cloud, so every faint cumulus puff
      became a dark 2×2 dot. Now premultiplied per texel (`shellOver`); faint puffs show as white wisps.
      Measured at 30 km: pixels the shell darkens 3080 → 187
- [ ] Black slits along cloud edges at the horizon from a few km up: the cloud pass writes black for "no
      cloud" in the shell region, and it shows wherever the terrain there isn't drawn (beyond the far plane)
- [ ] Rivers that flow downhill (sloped water surface, currents) instead of sea-level valleys
- [ ] Waterfalls on other highlands; spray mist where they land; water reflections of terrain
- [ ] Underwater view (diving) and wet footsteps
- [ ] More ruin kinds (stairs into the cliff, a bridge, a fallen tower, a half-buried dome) and interiors
- [ ] Halden lines when you find your first ruin
- [ ] Smooth the detail region across cube-face edges
- [ ] Damage/feedback for long falls (none yet; you land at any speed)
- [ ] Listen through the soundscape on the sphere (wind exposure, thunder delay, roof rain)
- [ ] Test touch controls on a phone/tablet (parked: the user asked to skip mobile for now)
- [ ] Warmer sunsets (sun-side glow, cloud rim light) — dusk currently reads lavender-grey
- [ ] Smooth the 2–4 km volumetric→shell crossfade (undersampled towers when looking straight down)

## Story & voice
- [x] Halden speaks his lines (browser speech synthesis; calm voice picked automatically, novelty voices
      skipped); subtitles last as long as the speech; the soundscape dips under him
- [x] Settings → Sound → Halden's voice: On/Off and a voice picker with a sample line (persisted)
- [ ] Listen through it on Windows/Chrome and Firefox (voice lists differ; the row hides if the browser
      has no speech synthesis)

## M2 polish (open)
- [x] Stars balloon into blobs at narrow fields of view — fixed in M3 (pixel-sized stars)
- [ ] Moonlight is ambient only: no moon shadows, no silver cloud edges, water does not reflect Lull
- [ ] Lull's eclipses by Solenne are only a uniform penumbral dimming (no shadow edge across the disc)
- [ ] Eclipse light is one value for the camera: distant land (> 6 km) stays lit, and from orbit the
      moon's shadow is not drawn on the planet
- [ ] Horizontal banding in cumulus and towers in frames stepped with `solenne.render()` while the pane
      is hidden (also in the M1 build); check whether it ever shows in live play
- [ ] Seasonal colour (autumn meadow, winter frost) — the sun's height changes, the land does not yet

## M3 polish (open)
- [ ] Sunspots/granulation on the filtered sun (the disc edge is soft: the sun is drawn in the half-res cloud pass)
- [ ] Distant terrain seen through the telescope keeps its distance-based LOD (soft when magnified)
- [ ] Orrin's moons sit 2.5° and 4.5° from it: only in the field at low power (×6)
- [ ] The clock drive lags ~0.5° at 600× time (could feed the body's angular velocity forward)

## Backlog / tech debt
- [ ] Cloud depth compositing for grass/cottage and for orbit views (near-field terrain already done)
- [ ] LOD geomorphing
- [ ] Seamless ground noise across cube-face edges
- [x] Seasons (axial tilt), moonlight (M2)
