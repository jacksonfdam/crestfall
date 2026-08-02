# src/render — presentation pipeline

One Three.js scene, two cameras, zero authority. The renderer is a read-only
consumer: `syncBoard(board, builder)` diffs the scene against the board that
arrived in a `GameEvent` and moves/adds/removes rigs to match. Nothing here
can cause, block, or reorder a move.

## Files

- `boardMath.ts` — **frozen** square↔world mapping. One square = 1 unit,
  board centered on origin, white on +z. `squareToWorld(sq)` and
  `worldToSquare([x,y,z])` (returns -1 off-board). Every module that places
  anything on the board imports these.
- `stage.ts` — the `Stage` class: renderer, scene, lights, board,
  environment, cameras, piece diffing, highlights, picking, duel camera rig.

## Scene

- Board: 64 quads merged into one geometry with two material groups
  (procedural birch / charred-oak canvas textures — no asset files), dark
  slab, knotwork-textured rim with torus-knot corner bosses, rune tick marks
  for files and ranks.
- Environment: stone plinth, dark ground disc, three distant standing
  stones, fog. Suggestion of a hall, not a hall.
- Lighting: one shadow-casting cool key (low winter sun, PCF soft, 1024
  map), warm ember-side fill, cool rim, hemisphere ambient. Contrast is
  carried by value, so the board reads in greyscale.

## Cameras and modes

- `3d`: perspective, low three-quarter orbit. Drag rotates (polar clamped so
  you can never go under the board), wheel zooms, no pan.
- `2d`: orthographic locked top-down. `setViewMode` switches instantly —
  same scene, same piece map; each rig is swapped to its flat variant via
  the `setPieceVariant` hook (or rebuilt with `{ flat: true }` through the
  last builder). Duel camera calls are no-ops in 2D.

## Truth derivation

Piece rigs hang under per-square anchor `Group`s. Anchors snap to the target
square immediately; the 120 ms glide is a decaying *local* offset on the rig
root. `deriveBoard()` therefore reads exact squares from the scene graph at
any instant — this is the oracle the fuzz harness compares against engine
truth.

## Input

Raycast against one invisible 8×8 plane → square index →
`onSquareClick` / `onSquareHover`. Handlers run synchronously in the pointer
event, independent of any animation state, so input stays < 50 ms mid-duel.

## Duel camera

`getDuelCameraRig()` implements `DuelCameraRig` from core: `moveTo` eases
from the orbit pose to the script's framing (script drives `t`), `shake`
uses the stage's seeded PRNG (no `Math.random`), `release()` eases back to
the orbit camera over 0.45 s.

## Budgets

- 60 fps on integrated GPU: one shadow map, no post passes (tone mapping +
  fog + MSAA only), all geometry low-poly procedural, highlight meshes
  pooled.
- `settings.reducedMotion`: no piece glides, no camera glides, no shake, no
  check pulse — everything snaps.
- Zero downloaded assets; textures are small canvases generated at
  construction.
