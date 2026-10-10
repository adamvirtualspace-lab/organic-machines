# Benchmarks

## O1 — SDF preview (2026-10-10)

Measured on the reference PC (Ryzen 5 7640U, integrated Radeon 760M) in the app's Browser pane, with
`bench.run`. Frame times wait for the GPU to finish, so they are not capped by vsync. The reference
phone has not been measured yet.

Stress scene: 100 primitives in 10 objects (351 graph nodes, 1040 parameters), all raymarched live.

| Canvas                           | Full quality (scale 1, 128 steps) | While moving (scale 0.5, 64 steps) |
| -------------------------------- | --------------------------------- | ---------------------------------- |
| 753×838 px                       | 18.3 ms = 55 fps                  | 5.9 ms = 169 fps                   |
| 750×1434 px (phone-sized, DPR 2) | 30.0 ms = 33 fps                  | 8.3 ms = 120 fps                   |
| 1936×1104 px                     | 44.8 ms = 22 fps                  | 12.3 ms = 81 fps                   |

Test scene (2 objects, 3 primitives) at 1936×1104: 6.5 ms full quality, 5.0 ms while moving.

### Against the budget (plan, Organic rule 4)

- **30 fps with everything live:** met while moving at every size. At full quality it is met up to
  about 1 megapixel and missed at 1936×1104 (22 fps). Full quality is only drawn once the view stops,
  so the miss shows as a slower final refine, not as stutter.
- **Structural edit shows its new shader within 200 ms:** missed for the whole stress scene in one
  shader (430 to 730 ms). Met for small scenes: one 10-primitive object builds in about 100 ms, the
  test scene in about 80 ms. Build time grows roughly linearly, about 7 ms per primitive.

### Shader build time

Build time was 7.5 s for the stress scene at first. Two changes brought it to about 0.7 s:

1. The distance function has a single call site: one loop steps along the ray and then takes the four
   normal readings. The compiler inlines the function, so five call sites cost five times as much.
2. The distance result is stored in a variable before branching on it.

Build time by object count (10 primitives each): 1 → 102 ms, 2 → 194, 3 → 220, 4 → 268, 5 → 365,
6 → 412, 7 → 495, 8 → 564, 9 → 627, 10 → 714.

### Mitigation chosen

One shader per object, built in O2 alongside Level-of-detail rule 2. A structural edit then rebuilds
only the object being edited, which stays near 100 ms for a 10-primitive object. The interpreter
shader from the open questions stays the fallback if single objects grow past about 25 primitives.

Already in place: recently built shaders are kept (six of them), so undo and redo across a
structural change do not rebuild.

### Memory

Idle with the stress scene: about 85 MB at 753×838, 109 MB at 750×1434, about 155 MB at 1936×1104
(JS heap plus the GPU estimate). The budget is 1 GB.

### Conformance

`selftest.sdf` runs the shader against the hand-worked vectors in
`web/src/engine/organic/conformance.json`: 85 of 85 points match across 23 cases. The CPU evaluator
passes the same vectors in the unit tests.
