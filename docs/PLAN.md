# Solenne — Plan & Checklist

Tick items only after they are verified running in the browser. Keep this file current.

**Status (2026-11-03):** M1 (the planet), M2 (the star system) and M3 (the telescope) are built and
verified in the browser: Solenne circles its sun Seren with four other planets, its moon Lull and two moons
of Orrin on Keplerian rails, and a brass telescope by the cottage shows them up close. M4: the Wren is built
and parked by the cottage, outside and a walkable two-deck inside (verified; the optional Mochi placeholder
is left); its outside is now the Blender model (`art/wren/`). M5: the Wren flies — from the meadow to orbit
and down anywhere on the planet (verified 2026-11-03). Mobile/touch checks are parked for now (the user asked
to skip them). **M6 (the sun as a real sphere, flares in the telescope) and M7 (space navigation) are built, and the
showcase film is done and approved (Orrin shot hidden for now). Next: M8 (other worlds; concept pictures first —
the sheets from `docs/concepts/worlds-prompt.md` are still to come), when the user picks it up again.** Also open: the polish and backlog lists below and the optional Mochi placeholder (a
character: concept pictures first).

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
      (≈ 200 k triangles); every canopy bar and both rim halves end under the brass boss on the nose
- [x] Ramp-door (user request, "like in the movies"): the ramp is the door, a two-part drawbridge whose
      foot folds onto it before it swings up and seals the doorway (now the concept's rounded rectangle);
      glTF animation `DoorClose` (frames in `art/wren/renders/wren-ramp-fold-strip.png`)
- [x] In the game (user request, 2026-11-03): the GLB replaces the code-built outside (`wrenModel.ts`, lit by
      the region shaders from its baked atlas, its depth in the ship's shadow map), the code interior stays
      inside it; rounded doorway cut from the inner shell; the ramp lowered to the terrain's angle and
      walkable; legs on the ground; halos moved to the new pods and thruster; `solenne.wrenDoor()` folds the
      ramp-door shut and lowers it again (verified in the browser: `docs/images/m4-wren-model-day.jpg`,
      `m4-wren-door-closed.jpg`, `m4-wren-ramp.jpg`, `m4-wren-doorway-inside.jpg`; `npm run build` passes)
- [x] Fixed (user report): a black tunnel behind the doorway and a black drum and disc under the dome. The
      boolean that cut the openings kept its cutters' walls inside the skin; the build now deletes them
      (verified in the browser: the hold seen from outside, the doorway from inside, the dome from above)
- [x] Close the ramp-door for take-off and lower it on landing (M5)
- [ ] Lighter model for distance and for phones (KTX2 textures, a 2048² atlas, fewer triangles)
- [ ] Interior in Blender (later)

## M5 — Flight (done 2026-11-03)
- [x] The Wren has a pose (planet-fixed position and orientation) instead of a fixed site: her shaders are
      local-frame shaders (sun, sky, haze, cloud shadows anywhere), her shadow map, lamps and walking rules
      live in ship-local metres; the home region's meadow and cottage still get her shadow and rain footprint
      through the flat frame when she is near home. Parked at home she looks as before
- [x] E at the pilot's seat (port, cockpit) takes the helm: the ramp-door folds shut, Space lifts her once it
      is sealed; E leaves the helm on the ground (the ramp comes down); in the air Halden asks you to land first
- [x] Newtonian flight with flight assist (velocity hold as a damped spring, gravity cancelled, horizon kept
      level with a little bank in turns); W/S throttle, mouse and A/D steer, Space/C climb and sink, Shift
      boost, X all stop, Z assist off (thrust and gravity only: a real orbit, verified 688 m/s holding 57 km
      for 2 minutes); speeds scale with height above the ground (35 m/s low, 2.6 km/s high)
- [x] Gravity-aware landing assist (L): level, kill the drift, sink slower the lower she is, legs down, settle
      on the terrain anywhere (legs and ramp fitted to it); refuses ground too uneven (a cliff edge) with a
      word from Halden; touches down by itself when brought in low and slow
- [x] Legs fold up into the belly above 40 m and come down below it; the engines brighten with thrust
- [x] Chase camera (horizon level, eased) and cockpit view (V), the helm's readout and keys on screen
- [x] Take off → orbit → land: verified from the meadow to 58 km and back down, and landings 1–4 km away in
      the lowlands under the cloud sea, walking down the ramp there (`docs/images/m5-*.jpg`); the atmosphere-
      to-space transition is the existing sky and cloud fade with altitude
- [x] Halden lines: the helm, take-off, landing, landed, too steep, a hard landing, assist off, trying to
      leave in the air; the orbit line (20 km) was already there
- [ ] Engine sound (the soundscape still treats the helm like free flight: wind only)
- [ ] Walk about inside while she flies (the pilot stays seated in flight)
- [ ] Her shadow on terrain away from home (the home region's shaders only) and on the ground when high
- [ ] Manual roll and a landing target/marker; gravity of other bodies (she cannot leave Solenne's sky yet)

## M6 — Seren, the sun as a body (done 2026-11-03)
The sun was a bright soft disc in the half-resolution sky pass. It is now a real sphere in the far pass, at
full resolution, with a surface that turns and changes, and the telescope has a second filter.
- [x] A sphere, not a disc: drawn by the far pass (crisp limb at any magnification, softened only by the
      seeing), its size from its radius and distance, behind the air and clouds like the planets; Lull covers
      it there (eclipses), and Cinder can cross it
- [x] Photosphere: limb darkening redder toward the limb, granulation (boiling cells, resolved from about
      ×100), faculae near the limb; sunspot groups (leader and follower with dark umbrae, filamented ragged
      penumbrae, pores) in two belts that turn with the sun (9-day rotation at the equator, slower toward the
      poles) and foreshorten toward the limb
- [x] Activity: groups are born, grow, flare and decay (2–14 days; the follower goes first); an 11-year cycle
      (23–36 groups near maximum on day 1–60, 6–9 near minimum around day 176–260), new groups starting at
      high latitude and creeping toward the equator (the butterfly diagram)
- [x] Telescope, white-light filter: spots, granulation and faculae when magnified (`m6-sun-white.jpg`,
      `m6-sunspots.jpg`)
- [x] Telescope, hydrogen-alpha filter (H): the chromosphere's network and mottles, bright plage round the
      groups, dark meandering filaments on the disc, a spicule fringe and prominences standing off the limb
      with vertical threads (`m6-sun-halpha.jpg`, `m6-prominence.jpg`); the sky goes black through it
- [x] Flares: groups flare by size (two ribbons that part as it goes on, kernels at the start; only big ones
      show in white light); 4 in 10 are eruptive: the filament lifts off as a twisted arch and leaves an arcade
      of loops; the label says so; Halden remarks on the first you catch (`m6-flare.jpg`)
- [x] Naked eye unchanged (bloom, glare); the corona around Lull at totality; prominences show pink if they
      reach past Lull's limb; a partial eclipse through the H-alpha filter (`m6-eclipse-halpha.jpg`)
- [x] Verified through the telescope at ×22–×313, in both filters, during an eclipse, and from 60 km up
- [x] Fixed (user feedback): the sun flashed when zooming near the limb. The filter followed the field's centre and
      its edge moved with the zoom, so it was half out at ×300 just off the limb; it is now fully in whenever the
      disc or anything within 2.5 radii is on screen (checked ×6–×280 at 0.5–2.4 radii)
- [x] Fixed (user feedback, again): the sun still flashed black while zooming. Single NaN pixels (1–3 in a frame, at
      some zooms) that bloom spread over the whole screen: `pow()` of `1 − μ` and of noise that rounding pushed a
      hair below zero (the faculae term at the disc centre, the h-alpha network, the spicules; also the planets'
      haze and the glass, water and wet-sheen Fresnel terms elsewhere). All bases clamped; 0 NaN frames in 720
      checks at ×6–×280, both filters, on and off the limb (5 in 126 before)
- [x] Fixed on the way: the solar filter only half dropped in when zoomed onto part of the disc; the clock drive
      re-centred the sun when you looked at a spot group (it now holds the view relative to the body you are
      on); `pow()` of a negative and `smoothstep(0, 0, x)` (undefined in GLSL) blacked out or haloed the view
- Open: the eruption is a single arch (no expanding bubble or coronal mass ejection); prominences are capped at
  10 in view at once (the rest of the limb has small procedural ones); the granulation's 27-cell Worley costs
  about 1 ms at 0.44 Mpx when it fills the eyepiece (≈ 5 ms at 1080p)

## M7 — Space navigation (done 2026-11-03)
Leaving Solenne's sky for the rest of the Seren system. Distances are compressed but still 1–10 million km,
so travel between worlds needs its own mode; the design follows what works in games (Elite Dangerous's
supercruise, KSP's spheres of influence) at the scale of a quiet game.
- [x] Frames: below 150 km over Solenne she flies planet-fixed as in M5; above, in the inertial frame of the
      body that rules there (patched conics: spheres of influence, only that body's gravity, position exact
      and relative velocity kept at a handover), back to planet-fixed below 100 km; rendering still goes
      through Solenne's frame (float64 holds out to Vael); verified Solenne → Sun → Verran, Sun → Orrin → Pip
- [x] Cruise drive (J): speed set by the room to the nearest surface (stars and giants count as deeper wells),
      up to 60,000 km/s; needs 30 km of room, drops out by itself below 15 km; W/S set its share; Halden's lines
- [x] System map (M at the helm): orbits, worlds, moons when zoomed, the Wren and her conic, the course line;
      click a world to target it, scroll to zoom, double-click to follow (`m7-map.jpg`, `m7-map-solenne.jpg`)
- [x] Target (T, or the map): a ring on it or an arrow at the screen's edge, with distance and arrival time;
      autopilot (G): climbs out at 60°, turns, cruises (swinging wide of worlds in the way), drops into a circular
      parking orbit; any hand on the controls takes over
- [x] Time warp ([ / ]: ×10, ×100, ×1000) coasting in open space, off near worlds and in the cruise; a 500 km
      orbit held 499–500 km over 2.8 orbits at ×1000 (quarter-second steps)
- [x] The sky from elsewhere: beyond 4,000 km Solenne is a far body drawn from its land and cloud atlas with a
      blue rim, the cloud pass and the ground sleep (`m7-solenne-far.jpg`); the sun's size, direction and light
      by distance; Solenne's shadow in space; stars unchanged
- [x] Verified trips (autopilot): Solenne → Lull 105 s (`m7-lull-orbit.jpg`), → Verran 148 s (`m7-verran.jpg`),
      Verran → Pip 232 s, Pip → Solenne 251 s, then assist on and L: landed 77 s later
- [x] Fixed on the way: deep space blacked out the view (rays rebuilt from the far plane cancelled to NaN in
      float32 with far/near ≈ 3·10⁸; now from the near plane, and the far plane is capped out there); Solenne
      was drawn as a second sun (the sun's branch took every kind above 2.5); its own air dimmed it red; the
      cockpit used indoor exposure; cloud shadows were traced from above the clouds; the map read `offsetX`
- Open: other bodies' shadows on the ship, and Lull's own shadow on Solenne from space; near other worlds the
  ship only stops at their surface (landing is M8); the hand-over at 4,000 km pops a little (atlas colours vs
  the live clouds); a manual climb to 30 km is slow (the autopilot climbs at 60°)

## M8 — Other worlds (planned 2026-11-03; concept pictures first for each world)
- [ ] Concepts: prompts written (`docs/concepts/worlds-prompt.md`: five sheets — Lull, Cinder, Verran, Orrin's
      moons, the giants — four directions each, the Wren and a suited figure for scale); waiting for the sheets and
      the picks, then step 2 (orbit, landing, ground, landmark) and the decision table, then "start building"
- [ ] One planet renderer for every body: the quadtree, terrain workers, materials, air and clouds become a
      body description (radius, height function, palette, atmosphere or none, clouds or none); the active
      body is drawn in full detail, the others as far spheres, with a crossfade on approach
- [ ] Gravity, walking and landing per body (the Wren's flight model and landing assist with the body's
      ground and g; walking at Lull's low gravity)
- [ ] Lull: grey airless highlands and dark plains, Solenne hanging in its black sky
- [ ] Cinder: scorched rock close to a huge sun
- [ ] Verran: red desert, the great canyon, thin pink sky, white poles
- [ ] Pip (ice) and Wick (dark rock) with ringed Orrin overhead
- [ ] Orrin and Vael: no ground; fly into the upper cloud decks and along the rings
- [ ] Something to find on each world (ruins, a lost probe, story hooks), a log of the worlds visited, Halden

## Showcase film (built 2026-11-03)
A short film of the current world in the game's own renderer, peaceful and painterly, with no UI on screen
(about 116 s with the title). One frame of each shot in `docs/images/showcase-*.jpg`.
- [x] 1 Home (day 1, 13:54): from the grass of the lower meadow, a slow rise up the slope to the cottage on the crest
      (camera moved 18 m left on request, still aimed at the cottage so it stays centred)
- [x] 2 Island (day 8, 16:24): off the north tip, drifting back and up: the plateau with the cottage and the Wren,
      an island in the sea of clouds
- [x] 3 Cottage (17:54): a slow sideways dolly past the front, the well and the telescope, grass in front
- [x] 4 Edge (18:37): walking out through the grass to the north-west rim; the cloud sea opens up, the sun from the right
- [x] 5 Departure (18:57): the Wren folds her ramp shut, lifts, folds her legs and banks away toward the sunset;
      she is parked again on her site afterwards (`Wren.parkAtHome()`). Thrust you can feel, kept subtle: the jets
      spool up while the door closes, soft plumes under the pods and aft (longer and brighter with the thrust; the
      lift jets only near the ground), downwash pressing the grass out from under her, a small unstick-and-hang
      before the climb, a faint wobble, the nose dipping as she starts forward (plumes and downwash also in normal
      flight)
- [x] 6 Leaving Solenne (new, user request): 450 km up, placed from the sun so the whole globe is gibbous, lit from
      the upper left with a soft terminator, right of centre; the Wren climbs out of it from a speck against the
      clouds toward the camera (her distance shrinking at a steady rate, so she grows evenly) and sweeps past on
      the left, yawed and banked into her line so her face, flank and name show
- [x] 7 Orrin (day 9), back in the film: Orrin and its rings whole in the distance (9.5 radii; at 4.4 it filled the
      frame as if parked in front of it), the Wren flying on toward it at a steady pace from just ahead of the
      camera, shrinking into the picture until she is a silhouette on the disc (she used to ease to a stop); the
      camera on the rings' lit side with the pole up (the falls shot was dropped on request)
- [x] Solenne from orbit, calmer (user: the globe looked glitchy): the cloud-sea map is read through a cubic
      B-spline (its 1.3 km texels made polygon outlines), and from far up the small puffs fade and the banks' edges
      soften (specks a few pixels wide only shimmered); applies to every orbital view, not just the film
- [x] Leaving shot without z-fighting (user: the lakes flickered between frames): the near plane the passing Wren
      needed (4 m) left the planet 450 km off with depth steps of kilometres, so water and shore fought. She is now
      drawn in her own pass (layer 1, depth cleared, near 2 m) after the planet's, whose near plane moves out to
      ~220 km. Measured over the globe between nearly identical frames: 700–1,000 flipping pixels before, 13–68 after
- [x] Space shots in true black: the grade's lifted blacks (`uLift`) drop to 0.15 there
- [x] 9 Night (day 37, 23:30): from just off the north cliff, the cottage's lit windows against the north sky,
      where a full Lull stands with Orrin (its rings visible) and Vael a few degrees above it; the view lifts toward
      them. Found by searching days 1–64, dusk to dawn, for Lull 10–40° up with two planets within 45° of it in a
      dark sky. Point-like planets are drawn 10× brighter in the film (`uDot`, like a long exposure)
- [x] Film look in the grade: more colour, cool shadows and warm lights, lifted blacks, more glow, 2.39:1 letterbox;
      per shot a golden-hour warmth (amber lights, violet shadows) and an exposure trim; fair weather, clouds
      drifting faster; a black beat at each cut (exposure, cloud history and shadows reset there); Halden quiet
- [x] End title like a game trailer: "Solenne" and one line ("A million years, and home kept a light on."), both
      white, in the title card's italic display face, rising over the last fade and holding on black (drawn in the grade pass)
- [x] A quiet synthesized pad (four slow chords in D major, sparse bells, a long reverb); Settings → Sound →
      Showcase music turns it off (for laying your own music over a recording); the world's sounds stay
- [x] Video export (Settings → Showcase → Export the showcase): every frame drawn at an exact 1/60 s at 1920×1080,
      full resolution, however long it takes; encoded by the browser (WebCodecs H.264, 16 Mbit/s) into an MP4
      (`mp4-muxer` 5.2.2) and downloaded as `solenne-showcase.mp4`; video only; Esc cancels. At each cut the
      film's clock is held 1.5 s of real time while terrain and shadows arrive. Verified: a 3 s and a 25 s export
      (across the first cut) decode as 1920×1080 MP4s of the right length. About 80–110 ms a frame on this Mac at
      High, so the whole film takes roughly 10–15 minutes
- [x] "Watch the showcase" on the title card; Esc, Space or a click ends it; back to the card, clock put back
- [x] The Wren moved out of the opening view: parked in the lower meadow south-east of the hill, nose toward home
- [x] Framed for the 2.39:1 band as seen on a 16:9 screen: other window shapes (a tall pane, an ultrawide) widen or
      narrow the camera so the band shows the same picture
- [x] At least 30 fps on High (user request, film only): the resolution is capped (pixel ratio 1.5) and a governor
      judges the median frame of each half second (ignoring stalls and the second after a cut): with vsync a steady
      30 is fine, it steps down under 28, first the resolution (to 0.6), then thinner grass and fewer cloud steps
      (two levels), and creeps back up with headroom. Measured on this Mac (High, 717×630 pane, frames timed with
      the GPU): 30–38 ms at full scale, 20–24 ms at 0.6, 14–19 ms at 0.6 with the lighter scene; live in the pane it
      settled at 30 fps (vsync) around scale 0.7–0.9
- [x] Approved by the user (2026-11-03): "all good"
- [x] Slower, calmer moves (user request, cut to their music): every shot plays only the calm middle of its old
      move (`span`); the rim stays locked off (`span: [0.75, 0.75]`, the user's pick: the dandelion against the
      cloud sea). About 120 s in all
- [x] 8 Under the clouds (new, day 8, 19:36): a slow push toward a broken arch at the foot of home, lantern blooms
      glowing in the grass, the home plateau standing up into the cloud deck with its waterfall. Its time came out
      of the night shot (too long with nothing happening) and the others. With leaving Solenne and Orrin added the
      total is still 114 s + the title: home 15, island 13, cottage 12, rim 11, departure 16, leaving 13, Orrin 12,
      under 11, night 11 (its whole move, so it visibly moves); then night cut to 7 s on request (the middle of its
      move, same pace; the title rises from its fourth second), 110 s + the title. Order: a day at home, away into space, back home
      at dusk and night
- [x] Waterfalls rebuilt (user: the old ones looked flat; wanted them more real, like the clouds, reacting to the
      wind, after a photo of a windblown fall on a sea cliff): a short glassy ribbon at the lip, then GPU particles:
      streamers of water falling down the face (gravity and light drag, drawn along their motion) that shed spray,
      light droplets the game's wind carries (direction, strength, gusts), lifted where it blows into the cliff;
      the spray puffs grow as they drift and are shaded like small clouds, with a 42° rainbow. Each particle's
      flight is a closed form of time, so there is no CPU simulation (about 0.6 ms a frame at 1080p for all four
      falls). They start at the true lip; a fourth fall on the north face below the cottage, in view of the island
      shot, which is zoomed in a little (39→35°). Frame: `docs/images/waterfall-island.jpg`
- [x] Each fall breaks out of a crack in the cliff (user: the waterfall appeared out of nowhere; a brook from a
      spring pool looked odd and was removed): a dark wet fissure ringed with moss 4.5 m under the rim, the jet
      leaping from it, two mossy boulders on the rim above; and a few old mossy boulders in the home meadow,
      solid to the walker, placed clear of the film's frames (home, cottage, rim, lift-off, island checked).
      Frames: `docs/images/waterfall-crack.jpg`, `docs/images/mossy-boulders.jpg`
- [x] One-frame glitch in the island shot (user: a slab of the plateau with clouds showing through, at 0:19 of the
      export): found by re-running the export and diffing every frame against its neighbours, then logging the
      quadtree: as the camera rises the horizon moves out, tiles come over it with no mesh yet, and their failure
      climbed to a level-1 ancestor, so 108 fine tiles became one coarse one for a frame (381 → 274 drawn). Now a
      tile just over the horizon stays empty until its mesh comes, and a tile merging back keeps its children
      until its own mesh has come. Verified: the same export holds 381 tiles through that moment; a full export scan (7,306 frames)
      finds no odd frame and no one-frame tile drop in any shot
- [x] Cottage shot slower (user: the camera moved too fast): it plays only the middle of its dolly, `span: [0.34, 0.6]`,
      7 m at a peak of 0.9 m/s instead of 16 m at 2.3 m/s (grass right at the lens exaggerates any move)
- [x] Each shot's clouds start from the same place (`clouds`, default 0), so a shot's sky is the same every time it
      plays or is exported (the drift used to carry on from whenever the game started); night: its clouds start at (−400, 0),
      chosen by reading the pixels at Lull, Orrin and Vael through the shot, so all three stay clear to the title
- [x] Shots beyond the home grid (±1 km) find the ground as the walker does (the planet's heights; the grid
      clamped at its edge and put the camera under the lowland meadow)
- [x] A subtle depth of field in the film: focus on what each shot looks at (the Wren in the departure), foreground
      grass and the rim's dandelion go soft; from the scene's own depth (`FocusPass` in `render/renderer.ts`)
- [x] Smoother for recording: the film's clock steps evenly (a smoothed frame time, so uneven frames don't read
      as a stuttering camera), and the frame-rate governor changes sharpness only at cuts, in the black beat
      (at once only under 22 fps)
- [x] A mysterious ruin of the advanced civilisation for the *under the clouds* shot (user request: the broken arch
      did not look impressive): concepts in `docs/concepts/ruins-*` (four directions, the user picked A, the Gate;
      model sheets from Google Flow / Nano Banana; decision table). Built from code: a 31 m ring leaning back 15°,
      half sunk in a mound, pearl ceramic with brass lips, joints and glyphs, a breathing channel of light round
      its inner face, four floating arcs and chips that drift (vertex shader), ivy clumps and strands. It replaces
      the arch wall at (920, 360), turned so the plateau and its waterfall show through it; the shot pulls back
      to 74 → 62 m. Frame: `docs/images/ruin-gate.jpg`. B (the Sleeper) and D (the Spire) are for later
- [x] Cinema detail for the export (user: the zoomed-out shots, the island and its waterfall, lacked detail):
      Settings → Showcase → Video, *Cinema detail* (default) or *Standard*. Cinema draws each frame at 3840×2160
      and scales it down to 1080p (4× supersampling), with its own quality preset (`cinema` in `config.ts`: cloud
      march 200 steps, grass out to 160 m on High's lattice, flowers to 75 m), finer terrain further out
      (quadtree split factor 3.4 instead of 2.3) and fine shading the game never draws (`uCine`): bedded ledges,
      joints, shadowed seams, moss on the ledges, rain stains and lichen on the cliffs; tussocks and drifts of
      wildflowers in the distant meadow. Each frame also waits (up to 4 s) for terrain chunks still being built.
      Verified side by side on the island shot (cliffs went from plain stripes to bedded rock), the rim, home and
      under-the-clouds shots (no change of framing, no artifacts) and a 3 s export (a 1920×1080 MP4 of the right
      length). About 0.19 s a frame on this Mac once warmed up, so the whole film takes roughly 25–35 minutes.
      Before/after: `docs/images/showcase-standard-island.jpg`, `docs/images/showcase-cinema-island.jpg`
- Open: the full-screen frame rate on your own screen is for you to check (the pane is small; the export
  sidesteps it); camera paths
  are hand-placed in `story/showcase.ts`; the Orrin shot comes back (or other worlds get shots) once M8 builds
  them; ideas for more shots: under the clouds (ruins, lantern blooms), the telescope on the sun, a rainy morning

## M1 polish (open)
- [x] The bench in front of the cottage stands on the meadow (it hung in the air against the plinth: each leg now
      reaches its own ground)
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
- [x] Black slits along cloud edges at the horizon from a few km up (2026-11-03). Not the far plane: terrain
      and water are drawn under every slit (painted solid, nothing was missing). Parallax between the shell
      sphere (−46 m) and the ground (~−640 m): a ray crossing a gap just short of a bank's near edge lands
      1.4–5 km further on, under the bank (from 6 km: crossings 13–22 km out, 5–22° grazing), so the ground's
      `seaMist` swallowed it into `bg`, the black written for clear shell texels. The cloud pass now writes the
      shell's own colour there (`gShellCol`), so the slit reads as the bank's edge. Measured at 6 km, noon:
      dark pixels 353 → 0 (dusk 433 → 0, planet view 23 → 0, 12 km 424 → 37, all deep-blue sky in the top
      corners); outside the horizon band the pixels it changes match the frame-to-frame baseline. Cliff edge
      and under a bank are unchanged (shell branch inactive below ~3 km). `docs/images/slits-*`
- [x] Clouds setting (user request, 2026-11-04: the sky had been thinned from the prototype's): Settings →
      Weather → Clouds, 0 clear · 50 default · 100 the prototype's towering cumulus; saved. Verified at the
      cottage at 0, 50 and 100, and toward the sea at 100 (tall towers like the prototype); 29.3 → 28.0 fps
      on Medium at 100; no console errors. The showcase follows it too (user's pick): every shot checked at 100;
      home matches the prototype's towering sky, the edge shot's sunset is more overcast than at 50
- [x] New defaults (user request, 2026-11-05): grass density 20 and height 40 (the sliders' minimum), Clouds 40;
      settings v3 resets those three in older saves. Verified in the browser: a v2 save with Clouds 100 loads as
      40 / 63k blades / ≈ 17 cm, no console errors
- [x] Default volume 40 % (user request, 2026-11-05; was 70): settings v4 resets it once in older saves.
      Verified: a v3 save at 70 % with grass density 100 loads as 40 % and keeps the 100
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
- [x] Sunspots/granulation on the filtered sun (M6: the sun is a sphere in the full-resolution far pass)
- [ ] Distant terrain seen through the telescope keeps its distance-based LOD (soft when magnified)
- [ ] Orrin's moons sit 2.5° and 4.5° from it: only in the field at low power (×6)
- [ ] The clock drive lags ~0.5° at 600× time (could feed the body's angular velocity forward)

## Backlog / tech debt
- [ ] Cloud depth compositing for grass/cottage and for orbit views (near-field terrain already done)
- [ ] LOD geomorphing
- [ ] Seamless ground noise across cube-face edges
- [x] Seasons (axial tilt), moonlight (M2)
