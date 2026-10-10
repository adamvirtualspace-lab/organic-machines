# Organic Machines — Project Plan

A 3D modeller with two modes, switched from a toggle at the top of the screen:

- **Organic**: SDF modelling. Primitives, smooth booleans, blends and soft forms.
- **Machines**: Plasticity-style precise CAD, history-free. Draw curves → extrude, fillets, chamfers, exact edges.

## 1. Vision & scope

**v1: the two modes are independent.** Each object belongs to one mode and can only be edited in that mode. No converting or combining between Organic and Machines geometry yet.

**Platforms: desktop browsers and Android.** The same web app runs in Chrome on Android tablets and phones, so every tool must work with touch alone. Tablets are the primary Android target; phones get a usable but compact layout.

**Optimisation is a first-class requirement, memory above all.** Every phase is measured on two modest reference devices, and a feature that breaks the budgets on them is not done:
- **Reference PC:** Ryzen 5 7640U with integrated Radeon 760M, 11.8 GB RAM of which about 3 GB is typically free. The GPU has no memory of its own; it takes from system RAM.
- **Reference phone:** Asus Zenfone 8, Snapdragon 888 (Adreno 660), 6 GB RAM, Chrome on Android 12 or newer.

**The bridge between the modes is the long-term reason for one app.** Without it this is two separate tools in one shell. The finished feature ships after v1, but its feasibility is proven early in spike B1 so the raymarcher and graph schema are built to accept it.

**Machines mode is history-free.** Like Plasticity, it stores the resulting solids, not a list of features. Undo/redo works fully, but an earlier operation's parameters cannot be edited once later operations exist. To change a shape later, the user edits it directly (e.g. moves a face). Organic mode stays parametric: its SDF tree keeps every parameter live.

**Default assumption: one shared scene.** Both kinds of objects live in the same scene and stay visible in both modes. Objects from the other mode are shown dimmed and locked. If this turns out to be unwanted, switch to separate documents per mode; the rest of the plan still holds.

**Non-goals for v1**
- Mixing modes as a finished feature (e.g. smooth-blending a Machines solid into an Organic shape). Spike B1 proves it is feasible; the feature itself is Phase 6.
- Browsers without WebGPU
- Parametric feature history and sketch constraints in Machines mode
- Sculpting or voxel painting
- Multi-user collaboration

**References**
- Plasticity: Machines mode workflow and UX
- MagicaCSG, Womp: Organic mode UX
- nTop: CAD built on implicits
- Fidget (Matt Keeter): Rust implicit-surface evaluation and meshing
- Replicad: OpenCascade-in-the-browser, code-based CAD

## 2. Tech stack

| Layer | Choice |
|---|---|
| Language (app) | TypeScript (strict) |
| Build | Vite |
| Rendering | three.js with WebGPURenderer. WebGPU is required; there is no WebGL2 fallback in v1 |
| Shaders | TSL (three.js Shading Language), with raw WGSL only where needed |
| UI | React + Zustand (state); shadcn/ui components on Tailwind CSS, themed for compact density |
| Organic compute | TypeScript in a Web Worker; WebGPU compute where it wins. Rust → WASM only if O3 benchmarks demand it (see O4) |
| Machines kernel | OpenCascade (OCCT) compiled to WASM, in a Web Worker |
| Android | Installable PWA in Chrome; Play Store packaging later (see open questions) |
| Desktop (later) | Tauri |

**Pin exact versions** of three.js and the OCCT WASM build (and Rust crates and Fidget, if O4 goes ahead). TSL changes often.

**Development constraints:** the reference PC is also the development machine. Use a prebuilt OCCT WASM and never compile OCCT locally; if a trimmed custom build is needed, build it in CI. Test Android on the real phone over USB remote debugging, not in an emulator.

**Licences:** OCCT and opencascade.js are LGPL 2.1, which carries relinking obligations that matter for the Tauri build. Fidget is MPL 2.0. Confirm both when pinning versions.

## 3. Architecture

```
┌──────────────────────────────── Main thread ─────────────────────────────────┐
│  Top bar:  [ Organic | Machines ]     React UI: object tree, properties      │
│                    │ commands                                                │
│                    ▼                                                         │
│  Document: list of objects, each { mode: "organic" | "machines", ... }       │
│            shared undo/redo stack, save/load (JSON + B-rep)                  │
│          │                                       │                           │
│   Organic objects                          Machines objects                  │
│          │ compile                               │ commands                  │
│          ▼                                       ▼                           │
│   SDF graph (DAG) ──► TSL codegen          Worker: OCCT WASM                 │
│          │            + param buffer         command → new solid → mesh      │
│          ▼                                   + topology IDs (face/edge)      │
│   Worker: TS mesher                              │                           │
│   (meshing, export)                              ▼                           │
│          │                               three.js meshes + edge lines        │
│          ▼                                       │                           │
│  three.js viewport: raymarched SDF pass (writes depth) + Machines meshes     │
│                     + grid, gizmos, sketch overlays — one shared camera      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Shared rules

1. **Mode is a property of each object**, not of the app. The top toggle sets which objects are editable and which tools the toolbar shows.
2. **The raymarch pass writes depth**, so SDF objects, Machines meshes, the grid and gizmos all composite correctly in one viewport.
3. **Heavy work never runs on the main thread.** SDF meshing and every OCCT operation go through workers.
4. **Units are millimetres internally.** Display units are a UI setting.
5. **One undo/redo stack** across both modes. An Organic entry stores the parameter or tree change. A Machines entry stores the before and after solid versions (see Machines rule 3).

6. **Save files carry a document schema version.** The loader migrates older versions forward; a file from a newer version is refused with a clear message.
7. **Input goes through Pointer Events**, covering mouse, touch and pen with one code path. No tool may depend on hover, right-click or a keyboard shortcut alone; each has an on-screen equivalent. Touch navigation: one finger orbits, two fingers pan and zoom.
8. **The layout is responsive.** Side panels become drawers or bottom sheets on small screens, and controls grow to touch-sized targets on coarse pointers. shadcn/ui covers panels, menus and dialogs; gizmos and in-viewport numeric inputs are custom.
9. **Documents autosave to browser storage**, and import/export use the standard file picker and download, which work on Android.

### Engine and UI boundary

1. **The engine and the UI are separate, linked only by a command interface.** The engine is everything except the React panels: the document, both modes, the workers, the renderer and viewport input. The UI is the panels, toolbars and menus. Neither imports the other's code; a lint rule enforces it.
2. **Three calls make up the interface:** `execute(command)` to change something, `query(...)` to ask something, and `subscribe(event)` to hear about changes. Commands are plain data with a name and typed parameters, defined once in `/protocol`.
3. **Interactive commands have four steps:** begin, update, commit, cancel. A gizmo drag sends updates through the same interface, which is how live previews work without the UI touching engine internals.
4. **Every command also has a text form**, e.g. `fillet edges=e12,e13 radius=2`. That gives an in-app command console, a headless CLI in Node for tests and batch export, and scripting. The headless CLI covers the document, OCCT, the CPU SDF evaluator, meshing and export; it cannot render, since Node has no WebGPU. Text is parsed only at those edges; the UI itself sends structured objects, so there is no parsing cost during a drag.
5. **Bulk data never crosses the interface.** Meshes and textures stay inside the engine, which creates its own canvas inside a container element the UI hands it.
6. **The engine is the source of truth.** The UI's Zustand store only mirrors what engine events report.

### Organic mode rules

1. **Document ≠ SDF graph.** Organic objects compile into a lower-level SDF graph.
2. **One graph schema, two evaluators.** The graph is plain, versioned JSON. The TSL shader evaluates it on the GPU for display; one TypeScript evaluator evaluates it on the CPU for picking, bounds and meshing. Both must give the same surface, checked against shared test vectors from O1 onward. A Rust evaluator would be a third copy of every node, so it is added only if O4 goes ahead.
3. **Recompile shaders only on structural change.** Parameter edits only update a uniform/storage buffer, so dragging stays at full framerate.
4. **Performance has a budget, not just a demo.** Starting targets on the reference PC, to adjust once measured: a stress scene of 100 primitives with smooth blends holds 30 fps when all of it is raymarched live (the worst case) and 60 fps in normal editing with one or two active objects, and a structural edit shows its new shader within 200 ms. On the reference phone: 30 primitives hold 30 fps, using dynamic resolution scaling. Planned mitigations, in order: the level-of-detail rules below, rays bounded by the scene depth buffer and per-object bounding volumes, node culling per screen tile.
5. **Distances are bounds, not exact.** Smooth booleans and subtraction do not return true distances. The raymarcher uses a conservative step factor, and shell and round applied after a smooth boolean are documented as approximate.

**Initial SDF nodes**
- **Primitives:** sphere, box, rounded box, cylinder, capsule, torus, cone, plane
- **Booleans:** union, subtract, intersect, plus smooth versions with blend radius
- **Modifiers:** shell (onion), round (offset), translate, rotate, uniform scale, mirror
- **Reserved:** sampled volume (a distance field in a 3D texture). Kept in the schema from the start so the bridge does not force a schema break; first used in B1.

### Machines mode rules

1. **The solid is the source of truth.** There is no feature history. A command (extrude, fillet, boolean…) takes the current solids plus its parameters and produces new solids that replace them. Nothing is stored for replay.
2. **Stable object ID, changing version ID.** An object keeps its ID for life; every command result gets a new version ID. Solids live in the OCCT worker keyed by version ID. The main thread holds only IDs and tessellations.
3. **Undo is snapshots, not replay.** An undo entry records the before and after version IDs of each object the command touched. Undo swaps the old version back in with no recalculation, so it is instant and cannot fail. The stack is capped by memory (Memory rule 3), and the worker frees a solid once no undo entry references it (OCCT objects in WASM must be deleted by hand).
4. **Commands preview live.** While the user drags, the worker recalculates at coarse tessellation and keeps only the latest request, dropping stale ones. Commit recalculates at full quality.
5. **Adjust last operation.** The most recent command's parameters stay editable until the next command starts. Changing one is undo plus re-run with the new value.
6. **Later changes are direct edits.** Move face, offset face and delete face stand in for editing an old dimension.
7. **Tessellation carries topology IDs.** Every triangle and line segment maps back to its face or edge, which makes picking faces and edges for fillets and sketch planes possible. IDs only need to stay valid until the next command on that object; selection is cleared after a command unless it can be remapped cheaply.
8. **Solids are saved as B-rep.** With no history to replay, the save file must contain each solid's OCCT B-rep alongside the document JSON. The undo stack is not saved.
9. **The OCCT WASM build is large.** Load it lazily the first time Machines mode is opened, with a loading indicator.
10. **A failed command changes nothing.** If OCCT throws or returns an invalid solid, the document is left untouched, no undo entry is added and the user sees the error.
11. **The worker owns the solids, so it is not killed to cancel.** An OCCT call in WASM cannot be interrupted. Stale previews are dropped by the latest-wins queue instead. For a runaway call the worker is terminated and rebuilt from B-rep copies: after each commit the serialised B-rep of each changed solid is written to browser disk storage (OPFS), not held in RAM. The same copies serve autosave and let the worker be recycled to reclaim memory (Memory rule 2).
12. **One owner for OCCT memory.** Only the solid store holds long-lived OCCT objects. Every temporary a command creates is deleted in that command's `finally` block.

### Memory rules

1. **Memory has a budget.** Starting targets for the whole tab (JS heap, WASM heaps and GPU memory together): 1 GB on the reference PC and 600 MB on the reference phone. A dev overlay shows the three numbers live from Phase 0, and each phase records its peak in `/docs`.
2. **WASM memory never shrinks.** Once OCCT's heap has grown it stays that size until the worker ends. So the OCCT worker is recycled (terminated and rebuilt from the B-rep copies on disk) when its heap passes a threshold, and shut down entirely when Machines mode has been idle. Solids stay visible meanwhile, because their meshes live on the main thread.
3. **Undo memory is tiered.** The newest few undo steps keep live solids for instant undo. Older steps are serialised to disk and freed from the heap, so undoing them takes a moment longer. The stack is capped by memory used, not by step count.
4. **Meshes are compact and held once.** Indexed geometry, 16-bit indices where they fit, quantised normals, and face and edge IDs stored as ranges, not per vertex. Buffers move from worker to main thread by transfer, never by copy. The CPU-side copy is released after upload to the GPU, so Machines picking uses a GPU ID buffer.
5. **The mesher streams.** Surface nets needs only two adjacent slices of samples at a time, so the full grid is never allocated (256³ floats would be 64 MB).
6. **Volume textures are budgeted.** Bridge distance fields default to 128³ at 16 bits, about 4 MB each. 256³ is about 34 MB and is opt-in per object.
7. **Code loads on demand.** OCCT loads only when Machines mode is first opened; the mesher and exporters are split out and load on first use.
8. **A memory tier is chosen at startup** from the device's reported RAM. It sets the undo cap, how many fine meshes are kept, and the starting resolution scale.

### Level-of-detail rules

1. **Lower resolution while interacting.** While the camera moves or a gizmo is dragged, the SDF raymarch pass renders at a reduced scale (starting at 50%, adjusted automatically to hold the frame rate) with cheaper shading and fewer steps. It refines to full quality within about 200 ms of the interaction stopping. Machines meshes and edge lines stay at full resolution, since they are cheap and keep the CAD edges crisp.
2. **Only active Organic objects are raymarched live.** Objects not being edited are drawn from a cache, so cost depends on what is being edited, not on scene size. With a still camera the cache is a stored colour and depth layer. With a moving camera it is a mesh proxy baked by the mesher and refined in the background. This relies on Organic objects not blending with each other; blending happens inside one object's tree.
3. **Machines solids keep a coarse and a fine mesh.** The solid itself is exact; only its displayed mesh has vertices, and the tessellation tolerance sets how faceted it looks. Previews use the coarse mesh (Machines rule 4). After a commit the coarse mesh is shown at once and the fine one replaces it when ready. Both stay cached while memory allows, so switching costs nothing. On the low memory tier the fine mesh is kept only for active solids; inactive ones show the coarse mesh and get their fine mesh re-made on demand. Edge lines stay fine at both levels, because faceted edges are far more visible than faceted faces.
4. **Precision never depends on the displayed mesh.** Snapping, measuring and picked points come from the exact solid in the kernel, so a coarse mesh changes how a solid looks, never where things land.

### Testing rules

1. **SDF conformance vectors.** A checked-in JSON file of points and expected distances per node type. The CPU evaluator is tested against it directly, the shader through readback of a small test render.
2. **Kernel golden tests.** Each Machines command runs on fixed inputs and is checked for a valid solid, volume, and face and edge counts.
3. **Save/load round trips**, including files written by every older schema version.

## 4. Folder structure

```
/web
  /src
    /protocol     the command, query and event schema: the only thing both sides import
    /engine       no React anywhere in here
      /doc        document model, objects, undo/redo, schema
      /organic    SDF graph, compiler, TSL codegen, SDF function library
      /machines   commands, curves and regions, snapping, OCCT worker bridge, topology picking
      /render     three.js setup, raymarch pass, mesh display, grid, gizmos, viewport input
      /workers    worker entry points (organic-mesher, occt with its solid store)
      /io         save/load (JSON + B-rep), mesh export
    /ui           React components (top mode bar, object tree, properties, toolbars, command console); no three.js or OCCT imports
/cli              headless Node runner for the engine: tests, scripts, batch export
/core             Rust crate, created only if O4 goes ahead
/docs           design notes, decisions, benchmarks
plan.md
CLAUDE.md
```

## 5. Phases

Each phase ends with a working, demoable app. Two tracks share Phase 0.

**Recommended order:** 0 → O1 → M1 → B1 → O2 → O3 → M2 → M3a → M3b → M4. O4 is conditional and runs only if O3 triggers it.
M1 and B1 come early on purpose: the OCCT kernel and the bridge are the biggest technical risks, so prove both before investing heavily in either mode's UX.

### Phase 0 — Scaffold & mode switcher
- [x] Vite + React + TS strict, three.js WebGPURenderer, orbit camera, infinite grid, axis gizmo
- [x] Tailwind + shadcn/ui set up with the compact theme (shadcn's Mira preset); responsive shell (panels collapse to drawers on small screens)
- [x] Pointer Events camera controls for mouse and touch; PWA manifest so it installs on Android
- [x] Top bar with the **Organic | Machines** toggle; toolbar contents change per mode
- [x] Document model with `mode` per object; empty object tree
- [x] Engine/UI split in place from the start: `/protocol` schema, `execute` / `query` / `subscribe`, the import lint rule, and a command console in the UI
- [x] Headless CLI that loads the engine in Node and runs a text command, used by the test suite
- [x] ESLint + Prettier, Vitest
- [x] Document schema version field and a migration hook in save/load from the first commit
- [x] Dev overlay showing frame time, JS heap, WASM heap and estimated GPU memory (Memory rule 1)
- **Done when:** app runs on desktop and in Chrome on an Android device with touch navigation, toggle switches toolbars, the same mode switch works typed into the console and run from the CLI, and a browser without WebGPU gets a clear "not supported" message.
- **Status:** everything above is verified on the reference PC. Still to check on the reference phone: that it runs with touch navigation, and that it installs from the manifest. Phone layout was checked only in an emulated 360 px viewport.

### Organic track

#### O1 — SDF preview
- [x] Graph schema + TS types
- [x] SDF function library (primitives, booleans, smooth ops) in TSL
- [x] Codegen: graph → shader; parameters packed into one buffer
- [x] Full-screen raymarch pass with normals, studio lighting, depth write
- [x] CPU evaluator in TS for the same graph, plus the shared conformance vectors (Testing rule 1)
- [x] Hardcoded test scene (box smooth-minus sphere, plus a torus): `demo.scene test`
- [x] Interaction resolution scaling for the raymarch pass (Level-of-detail rule 1)
- [x] Generated stress scene (100 primitives with smooth blends): `demo.scene stress`; frame time and shader compile time recorded in `/docs/benchmarks.md`
- **Done when:** changing a parameter updates without shader recompile; GPU and CPU evaluators pass the conformance vectors; the stress scene meets the budget in Organic rule 4, or the miss is recorded with the mitigation chosen.
- **Status:** done on the reference PC; not yet run on the reference phone. The frame budget is met while the view moves and missed at full quality above about 1 megapixel. The 200 ms shader build budget is met for objects up to about 25 primitives and missed for the whole stress scene in one shader (about 0.7 s). Mitigation chosen: one shader per object, built in O2.
- **Moved to M1:** bounding rays by the scene depth buffer. It only saves work once there are meshes to bound against, and M1 brings the first one.

#### O2 — Organic editing UX
- [x] Add primitives and booleans from the Organic toolbar (Add / Cut / Keep overlap, plus Shell, Round and Mirror)
- [x] Object tree showing each Organic object's SDF nodes (add, delete, reorder, rename, hide), properties panel with numeric fields that can also be dragged
- [x] Picking by CPU raymarch on click; move gizmo along the axes of the shape's parent. Rotation and scale are numeric fields only for now
- [x] One shader per object, each drawn into the shared SDF target with depth testing, so a structural edit rebuilds only the object being edited (chosen in O1; see `/docs/benchmarks.md`)
- [x] Cached colour and depth layer for inactive objects while the camera is still (Level-of-detail rule 2)
- [x] Undo/redo, save/load, and autosave to browser storage (Shared rule 9)
- [x] Live edits: drags preview through begin / update / commit and land as one undo step (Engine and UI boundary, rule 3)
- **Done when:** a smooth character-ish or product-ish shape can be built entirely through the UI, saved, reloaded and fully undone.
- **Status:** done on the reference PC with mouse input. Still to check: touch on the reference phone, the Save download and the Open file picker (both were only exercised through their commands), and rotate and scale gizmos, which are not built.
- **Known rough edge:** on a phone the properties drawer covers the view, so a change is not visible until the drawer closes. A bottom sheet that leaves the view showing would fix it.

#### O3 — Meshing & export
- Surface nets mesher in TS inside a worker, built on the CPU evaluator from O1, streaming slice by slice (Memory rule 5)
- Export STL, OBJ, GLB
- Mesh proxies for inactive Organic objects while the camera moves (Level-of-detail rule 2)
- Benchmarks recorded in `/docs`. Starting target: the 100-primitive stress scene meshes at 256³ in under 5 s
- **Done when:** exported meshes open cleanly in Blender, and the benchmark result decides whether O4 runs.

#### O4 — Rust core (conditional)
Runs only if O3 misses its meshing target, or sharp edges need dual contouring that is too slow in TS. Otherwise skip it.
- `/core` crate with wasm-bindgen; serde graph deserialization
- Port evaluation; it must pass the same conformance vectors as the TS and GPU evaluators
- Dual contouring on an adaptive octree for sharper edges
- Evaluate Fidget vs. own implementation, including whether Fidget's expression model covers the full node set; record the decision in `/docs/decisions.md`
- **Done when:** Rust mesher clearly beats the TS benchmarks and replaces the TS mesher, leaving two CPU-side copies at most for the shortest time possible.

### Machines track

#### M1 — Kernel spike
- Load an OCCT WASM build in a worker (compare opencascade.js and Replicad's build: size, maintenance, API coverage)
- Make a box, fillet one edge, tessellate, display in the viewport next to an SDF object
- Bound SDF rays by the mesh depth buffer, so pixels already covered by a nearer mesh stop marching early (moved from O1)
- Drag the fillet radius with live preview: measure time per update, since this decides whether history-free editing feels good on OCCT in WASM
- Try the direct edits (move face, offset face) and record how often OCCT fails on them
- Round-trip a solid through B-rep save/load and time the serialisation, since it runs after every commit (Machines rule 11)
- Snapshot undo of the fillet, checking the old solid is freed; terminate the worker and rebuild it from the B-rep copies
- First kernel golden tests (Testing rule 2) for box and fillet
- Measure download size, load time, and WASM heap size after load and at peak during the fillet, on both reference devices. Heap size is a deciding factor in which OCCT build to use
- Recycle the worker and confirm the memory is actually returned
- **Done when:** a filleted box renders correctly alongside the raymarched SDF, its radius can be dragged and undone; numbers recorded in `/docs`.

#### M2 — Curves & regions
- Draw on a construction plane (XY/XZ/YZ) or a picked planar face
- Tools: line, rectangle, circle, arc, polyline. Curves are ordinary objects in the document, unconstrained
- Snapping to grid, endpoints, midpoints, centres, intersections and edges of existing solids, with on-screen snap indicators
- Closed coplanar loops detected automatically as regions, shown filled
- **Done when:** you can draw a plate outline with holes, snapped precisely, and see its regions.

#### M3a — Extrude & booleans
- The command framework: gizmo, live preview with latest-wins queue, numeric inputs in the viewport, adjust-last-operation, failure handling (Machines rule 10)
- Snapshot undo/redo with the stack cap and solid freeing in place
- Extrude (new body / cut / join), revolve
- Booleans between bodies
- **Done when:** a plate with holes can be drawn, extruded, cut and joined to a second body, with every step undone and redone.

#### M3b — Fillets, shell & direct edits
- Fillet and chamfer on picked edges, shell on picked faces
- Direct edits: move face, offset face, delete face
- Golden tests for every command so far
- **Done when:** a simple enclosure (box, shelled, filleted, with mounting holes) can be modelled, a wall then moved by dragging a face, and every step undone and redone.

#### M4 — Machines polish & export
- Face/edge/vertex selection filters, hover highlighting
- Export STEP and STL
- Measure tool (distance, angle)
- **Done when:** exported STEP opens correctly in another CAD tool.

### Bridge spike

#### B1 — Bridge spike (straight after M1)
- Take the filleted box from M1: tessellate → compute a distance field in a worker → upload as a 3D texture
- Implement the reserved sampled-volume node in the shader and CPU evaluator
- Smooth-union the sampled box with an SDF sphere in the raymarcher
- Measure bake time, texture resolution and memory, and how well sharp edges survive
- **Done when:** the blended result is on screen, the numbers are in `/docs`, and a decision is recorded: bridge joins v1, or stays in Phase 6 with known constraints.

### Phase 6 — Later / exploratory
- **Bridging the modes as a finished feature**, building on B1: Machines solid → SDF so it can smooth-blend in Organic mode, re-baked when the solid changes; Organic mesh → Machines as a mesh body
- Parametric history and sketch constraints for Machines, only if direct editing proves too limiting (look into a WASM port of FreeCAD's PlaneGCS)
- Tauri desktop build, native file dialogs
- Per-object materials/colours, 3MF export

## 6. Open questions

- One shared scene vs. separate documents per mode (see section 1).
- Which OCCT WASM build to use, and whether its download size is acceptable for the web (decided in M1).
- **Live preview speed:** whether single-threaded OCCT in WASM is fast enough for drag previews of fillets and booleans (measured in M1). Fallback: preview on release, or a coarser preview.
- **Direct-edit robustness:** how reliable OCCT's move/offset/delete face is. If poor, limit direct edits to planar and cylindrical faces.
- **Save format for solids:** B-rep blobs embedded in the JSON vs. a zipped container with one file per solid (decided in M1).
- **Undo tiers:** how many steps stay live in memory before older ones move to disk, per memory tier.
- **Whether the memory budgets are reachable with OCCT at all on the phone** (measured in M1). Fallback: Machines mode is view-only on the low memory tier.
- **Selection after a command:** always clear, or remap faces/edges using OCCT's modified/generated shape history.
- Pure TSL vs. raw WGSL for the raymarcher.
- **Generated shader vs. interpreter shader:** O1 measured about 7 ms of build time per primitive, so generated shaders stay, split one per object in O2. If single objects grow past about 25 primitives and edits feel slow, add one fixed shader that walks the graph from a data buffer: it never recompiles but runs slower per pixel, so it would show the edit at once while the generated shader builds in the background.
- **Android packaging:** a PWA needs nothing extra. For the Play Store, a Trusted Web Activity runs in Chrome and so keeps Chrome's WebGPU support; Tauri on Android uses the system WebView, where WebGPU support is unconfirmed.
- **Android GPU coverage:** Chrome ships WebGPU on Android 12+ for ARM, Qualcomm and Intel GPUs; Samsung Xclipse (some Exynos phones) is still in progress. The reference phone (Snapdragon 888) is covered, so no fallback is planned; revisit if other devices matter.
- **Engine in its own worker:** with the boundary in place, the whole engine could later move off the main thread and draw through an OffscreenCanvas, keeping the UI responsive during heavy frames. Not planned for v1.
- Whether the bridge joins v1 (decided in B1).
- Whether O4 runs at all (decided by the O3 benchmark).

## 7. Working with Claude Code

- Keep files small and single-purpose (aim for < ~300 lines).
- Ask for targeted edits or diffs, not full-file rewrites.
- Paste only the relevant part of errors and stack traces.
- Always state versions (three.js, OCCT build, shadcn/Tailwind) when asking about APIs.
- One branch per phase; tick off items here as they land.
- UI work and engine work can run as separate sessions. A change to `/protocol` is the only thing both need to agree on first.
- Move the stable rules from sections 2–4 into `CLAUDE.md` so every session starts with them.
