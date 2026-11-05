# Solenne — Game Design

A quiet exploration game. No combat, no inventory, no quests (yet). The player walks, listens,
looks at the sky and, later, flies.

## Premise

The player character belongs to an advanced human civilisation that achieved immortality.
During a routine jump an accident throws him, his ship, his cat and the ship's AI
**1,000,000 years** into the future. He comes home to his planet, **Solenne**, and finds no one:
only meadows, wind, ruins softened by time — and his old cottage, which somehow still stands.

| Name | What | Notes |
| --- | --- | --- |
| **Solenne** | Home planet | Small world, highlands rising out of a global sea of clouds |
| **The Wren** | The home-ship: old-looking, very advanced | About the size of a two-storey house (~25 m long, ~10 m tall, wings ~21 m across), two decks you can walk around like a home: cockpit under the many-paned glass nose, galley, bunk room with a ladder up into a glass stargazing dome, Halden's core; workshop, cargo hold (door and ramp), engine room below. Patched, riveted, mossy hull over pearl-white tech, brass portholes, warm lamps and blue-white light lines. Parked in the lower meadow south-east of the cottage hill, nose toward home (out of the classic view up the hill to the cottage) (built in M4; flies since M5: from the meadow to orbit and down anywhere; since M7 across the whole system: a cruise drive, a system map, an autopilot that parks her in orbit round any world) |
| **Halden** | The Wren's AI | Calm, dry-humoured. Subtitled lines spoken by the browser's own speech synthesis (a calm British voice where available; Settings → Sound → Halden's voice) |
| **Mochi** | The cat | Optional idle placeholder near the house (later) |
| **Seren** | The sun | Solenne circles it once every 32 days |
| **Lull** | Solenne's moon | Big in the sky; always shows home the same face |

Story beats are hooks only: Halden says one line on arrival, and remarks the first time you look at
Lull, at Orrin, and when Lull crosses the sun.

## The world: Solenne

- Radius **81.92 km**, surface gravity **1 g** (GM = g·R²). Orbital speed at the surface ≈ 896 m/s.
- A **sea of clouds** (top ≈ 32 m below the meadow datum) lies in great banks over about half the
  planet; between them the lowlands lie open under the sun. Highlands — mesas, plateaus and ridges —
  rise out of it. From orbit Solenne is green country patched with white cloud banks, cumulus and a
  soft blue atmosphere rim. Home always stands in its sea of clouds.
- **Spawn:** the prototype's plateau (meadow, cliffs, cottage) sits at the centre of the +Y cube
  face, latitude 48° N. It is the only region with full grass/flower detail in v1.
- **The view from home:** a ring of open cloud sea, then neighbouring islands 4–11 km out — a small
  mesa, a long plateau, broad uplands and a mountain massif — hazy on the horizon, the first hint
  that there is more of Solenne to find.
- **Under the clouds:** the cloud sea is a deck a couple of hundred metres thick. Below it lies a
  dim, overcast lowland ~640 m under the meadow, where the plateaus stand as stone pillars rising
  into the clouds. It is an open world: you can fly or fall anywhere, nothing is fenced off.
- **Life below:** tall blue-green shade grass, bluebells and wood anemones, glowing lantern blooms and
  toadstools, slow drifting spores — and the ruins of whoever lived here: broken arched walls,
  colonnades, tower stumps and temple floors, mossed over by a million years. Four of them lie close
  to the foot of the home plateau, for whoever steps off the edge first; the greatest is the Gate, a
  giant ring of pearl ceramic and brass half sunk in a mound, its inner face still glowing faintly,
  broken arcs of a second ring drifting in the air around it.
- **Water:** the warm oceans in the deep basins breathe up the cloud banks, which is why the banks
  hang over the coasts and inshore water while the inland plains stay sunny. Wind pushes the fog
  against the plateaus and the meadows drink it, so springs break out of cracks just under the rims as long
  waterfalls falling into the clouds; in the lowlands they gather into lakes and rivers that run back
  to the sea. The cottage has its own well. You can swim (you float at the surface).
- **Day/night and seasons:** Solenne rotates once per 24 game hours and circles Seren in 32 days, its
  axis tilted 16°: spring, summer, autumn and winter of eight days each (day 1 is the spring equinox).
  At home the noon sun stands 26° high in winter and 58° in summer; summer days last 14½ hours, winter
  days under 10. Time of day, time scale and season are player settings; the date carries on between
  visits.

## The sky: the Seren system

Distances and sizes are compressed so the sky is full of things to look at (and, later, to fly to).
Everything moves on real Kepler orbits, so the sky changes from night to night and season to season.

- **Lull**, the moon: about three times as wide in the sky as Earth's moon would look, grey highlands and
  dark seas on the face turned toward Solenne, bright-rayed craters. Phases every five days; a pale disc
  in the afternoon sky, silver light over the meadow at full moon, the old moon's dark face glowing faintly
  with Solenne-shine. Its orbit is tilted, so now and then it crosses the sun: a partial eclipse dims the
  day, and inside the narrow shadow the sun goes out behind a corona.
- **Cinder**, small, scorched and close to the sun: a bright evening or morning star.
- **Verran**, a cold red desert with a great canyon, white poles and thin pink skies; bright when it is
  near, a faint red point when it is across the sun.
- **Orrin**, the ringed giant: amber and cream belts with a great storm, broad rings with a dark
  division; visible to the eye as a tiny ringed disc. Its moons **Pip** (icy) and **Wick** (dark) circle in
  the ring plane. Its rings slowly open and close over its six-month year.
- **Vael**, a pale sea-green ice giant tipped on its side, with thin ringlets, at the edge of the system.

The brass telescope on its tripod in front of the cottage is how you meet them properly: press E by it,
aim with the mouse or the arrow keys (the slow-motion knobs), scroll to magnify. The mount's setting
circles show where it points (altitude and compass bearing in degrees); a sky guide lists what is up right
now and its position, and a number key swings the mount to it. Whatever you centre gets a label (name,
distance, how much of it is lit) and the clock drive keeps it in view as the sky turns. Seen through the
air, planets shimmer a little, more so low over the horizon. Point it at the sun and a solar filter drops in:
in white light Seren is a turning sphere with sunspot groups, granulation and faculae; H swaps in a
hydrogen-alpha filter that shows its red chromosphere, dark filaments and prominences standing off the limb.
Groups come and go over days and follow an 11-year cycle; now and then one flares (two bright ribbons), and
some flares lift a prominence off the sun.
- Weather is local to the player (Sunny / Cloudy / Rain / Thunderstorm / Fog / Dynamic) and
  fades out with altitude. Settings → Weather → Clouds sets how much cloud there is, from a clear sky
  through the default scattered cumulus to the prototype's towering walls of cloud. Rain and storms hide the stars, Lull and the planets; a stormy night is the
  darkest night there is, lit only by lightning (and the cottage windows).

## The showcase

"Watch the showcase" on the title card plays a short film of Solenne in the game's own renderer: slow, calm camera
moves (and one locked-off frame at the rim) with a soft depth of field, a gentle film grade with letterbox bars, a quiet synthesized pad, and nothing else on screen: home from
the grass, the plateau as an island in the clouds, the cottage in late light, the rim at golden hour, the Wren lifting
off into the sunset, the Wren climbing out past the camera high over the globe of Solenne, pulling away toward
Orrin's rings, then home again: the Gate under the clouds at dusk with home rising into the cloud deck through it, and the cottage at night under a full Lull with Orrin and Vael beside it; then the title,
*Solenne*, and one line: "A million years, and home kept a light on." Esc ends it. Settings → Sound → Showcase
music turns its pad off (for your own soundtrack), and Export the showcase renders it to a smooth 1080p 60 fps
MP4 (video only), frame by frame, however long that takes. In *Cinema detail* (the default) the film is drawn
at 4K and scaled down, with finer terrain and painted detail (bedded, mossy cliff ledges, flower drifts) that
the game itself leaves out for speed.

## Art direction (non-negotiable)

The prototype artifact ("Cloudsea Meadow") is the look. Everything must match it:

- Soft "Ghibli" lighting: gentle sun (`GROUND_SUN 0.4`) over a strong, cool skylight.
- Painterly mottled ground; muted, slightly cool meadow greens; dark soil between blades up close.
- Wind gust waves rolling across the grass, shared by blades, ground shading and sound.
- Raymarched volumetric clouds: cloud sea below, fair-weather cumulus above, towers in the distance.
- ACES grade, light bloom, gentle vignette, dithering.
- Code-built props (merged geometry, one shader, palette colours, per-vertex kind/grain/indoor/AO).
- Synthesized Web Audio soundscape — no audio files.

New content (telescope, the Wren, other planets) uses the same palette, the same lighting
functions (`skyAmbient`, `hazeColor`, `GROUND_SUN`) and the same code-built construction style.

## Controls (v1)

| Input | Action |
| --- | --- |
| W A S D / arrows | Walk |
| Mouse | Look |
| Shift | Run (fly faster) |
| Space | Jump (rise while flying) |
| F | Free flight on/off for the walker (speed scales with altitude, no limits: under the clouds to orbit); the Wren is the ship way to fly |
| C / Ctrl | Descend while flying |
| M | Sound on/off |
| P | Planet view: orbit around the whole planet (drag to turn, scroll to zoom), with a pin where you are; also in Settings → View |
| Esc | Release mouse / menu |
| E | Use the telescope by the cottage (when you stand by it); E or Esc to step back. In the Wren's cockpit, by the pilot's seat: take the helm (the ramp folds shut); E again leaves it once she is on the ground |
| At the helm | W / S throttle · mouse, A / D steer · Q / R roll · Space / C climb, sink (Space lifts off) · Shift boost · X all stop · L land (anywhere flat enough) · Z flight assist on/off (off: Newtonian, she coasts, orbits) · V chase / cockpit view |
| In space | J cruise drive (fast where there is room, slow near worlds) · T next target · G autopilot to the target (climb, turn, cruise, park in orbit) · M system map (click a world to target it) · [ / ] time warp, coasting in open space |
| Scroll / + − | Zoom the telescope (×6–×280) |
| Mouse, arrows / WASD | Aim the telescope (arrows are the slow-motion knobs; Shift faster) |
| 1 – 8 | Telescope: swing to an entry in the sky guide (GoTo) |
| H | Telescope: swap the solar filter (white light / hydrogen-alpha) |

Touch: left half = move stick, right half = look, on-screen Jump / Fly buttons.

## Out of scope for now

Combat, inventory, quests, NPCs. Story is limited to hooks.
