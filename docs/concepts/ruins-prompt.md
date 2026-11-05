# The ruins under the clouds — concept prompts

The ruins in the lowlands are plain broken stone today (arch wall, colonnade, tower stump, plinth). They were
built by the player's own people, an immortal civilisation far beyond ours, a million years ago, so they
should feel **mysterious and impossible**, not like old castles. Same steps as the Wren and the worlds:
**step 1** shows four directions on one sheet; you pick one (or mix: "A's ring with C's floating slabs");
**step 2** turns the choice into a sheet to build from; then a short decision table, and building starts on
your "start building". The first one built replaces the broken arch in the showcase's *under the clouds* shot.

## How to use

1. Start a new ChatGPT chat and **attach two images** to the prompt:
   - `docs/images/solenne-meadow.jpg`: our game's look (the style to match)
   - `docs/images/showcase-8-under.jpg`: the place and the light (under the cloud deck at dusk, the home plateau
     rising into the clouds behind, lantern blooms in the grass)
2. Paste the step 1 prompt as it is.
3. Save the result as `docs/concepts/ruins-sheet.png` and tell me the letter you like (or a mix).

What makes them buildable in our code-built style is written into the prompt: big simple shapes (rings,
spheres, slabs, discs), a few materials, glowing seams, and pieces that float (they can drift slowly in the
game, which also gives the shot something happening).

---

## Step 1 — four directions

```
Concept-art sheet: four directions for one ancient structure, arranged in a 2×2 grid in one image, each panel labelled only with a large letter A, B, C, D. No other text.

Art style: match the first attached image (a screenshot of our game) — hand-painted animated-film concept art, soft painterly shading, gentle light, muted colours, clean readable silhouettes, quiet and full of wonder, never grim, military or sci-fi-busy. Original designs — do not copy or resemble any existing film, game or landmark.

The place, the same in every panel (see the second attached image): a wide lowland meadow under a low, soft ceiling of cloud at dusk; tall blue-green grass with small glowing mint-green lantern flowers; behind, a huge stone plateau rises straight up into the clouds, a thin waterfall falling down its cliff. Light is dim, cool and violet-grey, the only warm or bright light comes from the structure itself and the lantern flowers. Same camera in every panel: a wide view from head height in the grass, about 40 m from the structure, the plateau behind it.

Scale: a small figure in a simple long pale coat stands near the structure; the structure is 25–45 m tall, so it towers over the figure.

Who built it: a vanished human civilisation far more advanced than ours, gone for a million years. Their things are calm and beautiful, not machines: smooth pearl-white ceramic (#e9e4d8) with fine lines of weathered brass (#a8874f) inlaid in it, on a base of dark grey stone (#4d4f52). Time has softened it — moss, ivy and grass over the lower parts, a few cracks and missing pieces — but it is not dead: thin seams of soft mint-cyan light (#8ff0d8) still glow faintly in it, and some of its pieces float in the air, unsupported, as if gravity forgot them. It must look mysterious: the viewer should wonder what it was for.

Buildable: every structure is made of a few big simple shapes — rings, spheres, discs, slabs, cylinders, arches — with clean silhouettes and no fine clutter or tiny details.

The four directions:
A — "The Gate": a giant free-standing ring, taller than the trees would be, tilted and half sunk into the meadow; a seam of light runs round its inner face; broken arc pieces of a second, outer ring hang motionless in the air around it.
B — "The Sleeper": a huge smooth sphere half buried in the ground, its shell split open in a few curved slices that have drifted apart and float, showing nested shells inside with faint light at the core.
C — "The Stair to the Clouds": a causeway of enormous stone and ceramic slabs climbing toward the cloud ceiling; the lower slabs rest on the ground, the upper ones float higher and higher with gaps between them, the last disappearing into the clouds.
D — "The Listening Spire": a tall slender spire made of stacked discs and rings with gaps of empty air between them, each piece hovering above the one below, leaning slightly; its foot is wrapped in ivy, a soft light pulses slowly up its seams.
```

## Step 1 result

`ruins-sheet.webp`. Recommended: **A, the Gate** — the clearest silhouette at a distance and in dim light, the
most mysterious (what did it open onto?), and in the shot the ring frames the home plateau and its waterfall as
the camera pushes in; the floating outer arcs can drift and the seam can breathe, so the shot has something
happening. B (the Sleeper) and D (the Spire) would make good further lowland ruins later.

## Step 2 — the Gate

Attach `docs/concepts/ruins-sheet.webp` (the four directions) and `docs/images/solenne-meadow.jpg` (our look).

```
Concept-art model sheet for ONE ancient structure: design A ("The Gate") from the first attached image — keep its look exactly: a giant tilted ring of pearl-white ceramic (#e9e4d8) with fine weathered brass inlay lines (#a8874f), half sunk into a grassy meadow, a seam of soft mint-cyan light (#8ff0d8) running round its inner face, moss and ivy over the lower parts, a few fallen stones around its foot, and broken arc pieces of a second, larger outer ring hanging motionless in the air around it.

Art style: match the second attached image (a screenshot of our game) — hand-painted animated-film concept art, soft painterly shading, muted colours, clean readable silhouettes. Original design — do not copy any existing film, game or landmark. Plain soft grey-violet background, no landscape, so the shapes read clearly. No text except the small view labels.

Layout, one image, all views at the same scale, each with the same small figure (a person in a long pale coat, 1.7 m) standing beside it for scale:
- Top row, three views of the whole structure: FRONT (looking through the ring), SIDE (showing how far the ring tilts and how deep it sinks into the ground), THREE-QUARTER.
- Bottom row, three close-ups: 1) a cross-section of the ring's thick band (its profile shape, where the brass lines and the light seam sit); 2) one floating outer-arc piece with its broken ends and the small stone fragments hovering near it; 3) the foot where the ring enters the ground (stone base, moss, ivy, fallen blocks, the light seam fading into the earth).

Make it buildable from simple shapes: the ring is one thick band with a simple profile; the outer pieces are four or five separate arcs of one bigger ring, at different angles, with clear gaps; no fine clutter. The ring is about 30 m across and stands about 24 m tall above the ground.
```

## Step 2 result and decision table

Two model sheets (made with Google Flow / Nano Banana): `ruins-gate-sheet-1.jpg` (views with a 30 m scale,
the tilt marked 75°, four big floating arcs) and `ruins-gate-sheet-2.jpg` (a cleaner cross-section, a steeper
side view, only small chips floating, roots at the foot). Where they differ:

| Question | Sheet 1 | Sheet 2 | Choice |
| --- | --- | --- | --- |
| Size | 30 m tall | about the same | ring 30 m across, standing about 27 m above the ground (a little of it sunk) |
| Band | thick, rounded | rounded-rectangle tube | rounded-rectangle profile, about 4.5 m deep (radial) × 4 m thick |
| Tilt | leans back 15° (75°) | leans more | **15° back**, turned so the plateau shows through the opening from the shot's camera |
| Light | a wide inset seam on the inner face | the same, recessed between brass lips | the whole inner face is a recessed glowing channel with brass lips; it breathes slowly |
| Brass | lips + radial joints + circle glyphs | lips + radial joints | lips round the channel, a radial joint every 45°, two or three circle glyphs |
| Weathering | dark stone where the ceramic flaked | the same | three or four dark stone patches, mostly low; moss and ivy over the lower third |
| Floating pieces | 4–5 big outer arcs + chips | small chips only | **sheet 1**: four big arcs of an outer ring (radius ×1.3) at different angles, plus small chips; all drift slowly (a gentle bob and turn) |
| Foot | mound, moss, boulders | the same, with roots | a grassy mound, a few fallen blocks and boulders, roots |
| Where | — | — | replaces the arch wall at (920, 360), the site in the *under the clouds* shot; the other ruins stay for now (B and D later) |
