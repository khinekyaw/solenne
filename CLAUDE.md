# Solenne

A quiet exploration game (Vite + TypeScript + three.js **0.160**, WebGL2). Start here:

- `docs/GAME_DESIGN.md` — story, characters, world, art direction, controls
- `docs/ARCHITECTURE.md` — prototype summary, module map, scale & coordinate strategy, known limitations, dev hooks
- `docs/PLAN.md` — milestones with checklists. **Tick an item only after it is verified in the browser**, and keep the file current at the end of each task.

## Commands
- `npm run dev` — dev server on http://localhost:5173 (`.claude/launch.json` entry "solenne";
  "solenne-alt" runs on 5174 when another session already holds 5173)
- `npm run build` — type-check (`tsc --noEmit`) + production build
- `npm run typecheck`
- Blender assets (headless, Blender 5.2 in /Applications): `art/wren/build_wren.py` builds and bakes the
  Wren's exterior GLB, `art/wren/render_wren.py` renders it (see `art/wren/README.md`)

## Conventions
- The prototype ("Cloudsea Meadow" artifact) is the visual baseline. Keep its palette, `GROUND_SUN`,
  `skyAmbient`/`hazeColor`, ACES grade and code-built style for all new content.
- Never upload planet-scale coordinates to the GPU. CPU math is float64 (`THREE.Vector3`/`Matrix4`);
  everything drawn goes through the local camera frame in `src/render/frame.ts` (`pfMatrix`, `shared`).
- Two shader families (see `src/render/glsl.ts`): region shaders (`#define SUN uSunDir`, prototype
  flat space, end with `regionToClip`) and local shaders (`#define SUN uSunDirL`, camera at origin).
- Planets, moons and the sun move on Keplerian rails in `src/space/system.ts` (positions are a pure
  function of `clock.t`). They are drawn by the far pass in the background (`space/farShaders.ts`) as
  analytic spheres from float64 directions — never as meshes in the main depth range.
- `atmosphere/palette.ts` and `PALETTE_GLSL` must stay in sync.
- Heavy CPU work (terrain chunks, region grid, shadow bakes, noise volumes) belongs in the workers.
- Pin versions: three 0.160.0 / @types/three 0.160.0 / TypeScript 5.6 (newer TS breaks the old typings).
- Comment density and naming follow the ported prototype code: short `/* === */` section headers,
  one-line comments that explain *why*.

## Testing in the browser
Use `window.solenne` (see ARCHITECTURE §6): e.g. `solenne.teleport(398, 100, -30, 2)` (cliff edge),
`solenne.altitude(60000)` (orbit), `solenne.setTod(22.5)` (night), `solenne.look('Orrin'); solenne.fov(2)`
(inspect a planet), `solenne.scope('Lull', 4)` (look through the telescope), `solenne.nextEclipse(0.8)`,
`solenne.board()` (foot of the Wren's ramp), `solenne.wrenView(30, 1)` (three-quarter view of the Wren).
Input is gated until "Click to begin". When the Browser pane is hidden the animation loop pauses: step
frames with `solenne.render()` instead (and `await` a few seconds of them after a teleport so terrain
chunks from the worker arrive).
