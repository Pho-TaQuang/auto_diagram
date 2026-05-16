# AutoDiagram

AutoDiagram is a client-side foundation for generating draw.io / diagrams.net diagrams from structured input.

MVP 0 converts a Mermaid `classDiagram` into raw draw.io `mxGraphModel` XML saved with a `.drawio` extension.

## MVP 0 Pipeline

```text
docs/demo_mermaid.md -> DiagramDocument -> deterministic layout -> mxGraphModel XML -> .drawio
```

The output intentionally uses raw `<mxGraphModel>` XML rather than a compressed draw.io file or an `<mxfile>` wrapper.
Class nodes are exported as draw.io swimlanes with explicit header sizing so stereotypes and class names stay together in the title compartment.
Exported draw.io cell IDs are deterministic type counters such as `node_1`, `edge_1`, and `group_frame_1`; semantic class names stay in labels and the intermediate model.

## MVP 1 Hardening Baseline

MVP 1 treats the current openable draw.io output as a structural regression baseline. The baseline fixture is stored at `tests/fixtures/mvp0-baseline.drawio`.

Regression tests intentionally compare structure rather than exact XML text:

- valid `mxGraphModel` XML
- class, child compartment, and edge counts
- edge labels
- edges reference existing class cells
- class cells use draw.io swimlanes with explicit header `startSize`
- child compartments begin below the swimlane header

`out/demo.drawio` remains generated output and is not the source of truth for tests.

## MVP 2a Exact Stereotype Group Layout

MVP 2a adds logical stereotype groups to the intermediate model and uses those groups for automatic class placement.

Stereotype grouping uses an exact-input policy:

- Mermaid delimiters `<<` and `>>` are removed.
- Only outer whitespace is trimmed.
- Case, punctuation, spelling, internal spaces, and Mermaid `~` markers inside stereotypes are preserved.
- Stereotypes are not aliased, lowercased, enum-normalized, or inferred from class names.

For example, `<<Service>>`, `<<service>>`, and `<<External Service>>` are three distinct groups. Nodes without a stereotype are placed in a synthetic `Ungrouped` group. Known exact labels such as `Controller`, `ManagerInterface`, `Manager`, `Model`, and `DTO` receive the built-in group order; unknown exact labels remain valid and are placed after the known groups in first-seen order.

## MVP 2b/2c Routing and Group Frames

MVP 2b adds deterministic, group-aware orthogonal routing for inter-group relationships. The layout engine writes waypoint arrays into `DiagramEdge.layout.waypoints` when a bend is needed; direct anchored routes may have no waypoints. Routing uses the gap between source and target group bounds and nudges waypoints outside class rectangles.

MVP 2c added stereotype group frames to draw.io. These frames are background visuals only:

- group frames are emitted before class cells so they render behind nodes
- group labels use the exact `DiagramGroup.label`
- class swimlanes remain top-level draw.io cells
- relationships still connect class cells, not group frames
- frames use a subtle non-connectable, non-collapsible dashed style

## MVP 2d Scored Layout Intent

MVP 2d adds a scored layout pipeline. The layout engine now generates deterministic candidates for group placement, in-group class order, packing, and edge routing, then stores the selected candidate and score metrics in `DiagramDocument.layout`.

The CLI also supports an editable layout intent workflow:

```bash
npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json
```

The layout JSON lets users adjust grid size, group row/column placement, packing, and class assignment to groups. These edits affect layout only; they do not change parsed class names, stereotypes, attributes, methods, or relationships.

Groups are centered inside their reserved grid cell or span. Groups in the same row share a visual center line, and groups in the same column share a visual center line, even when their measured sizes differ.

`layout:init` and `generate` also accept `--suggested-layout` to opt into the built-in architecture-spine placement. This suggested placement is generated from the groups present in the input; it does not create missing groups. Explicit `--layout <layout.json>` remains the source of truth and cannot be combined with `--suggested-layout`.

## MVP 2e Orthogonal Anchored Routing

MVP 2e makes group frames opt-in and switches draw.io edges to `edgeStyle=orthogonalEdgeStyle`. Generated relationships connect class parent cells with explicit source and target anchors rather than connecting to member-row child cells.

Class swimlanes always reserve the standard UML compartments in this order: class name, attributes, then methods. Empty attributes or methods sections still keep their compartment spacing so the separator lines remain consistent.

The routing v2 template router chooses ordinary-edge anchors as part of route candidate selection instead of assigning final anchors before routing. For each node with displayed degree `n`, it builds `n` slots on each north/east/south/west side with ratios `i / (n + 1)` and reserves selected ports by `nodeId:side:slotIndex` so ordinary edges do not reuse the same side slot. Candidate generation includes direct/corridor routes, exterior lanes, and outer-corner detours; each strategy constrains source and target sides before expanding slot candidates. Candidate scoring vectorizes orthogonal edge segments and strongly penalizes crossings before bends and Manhattan route length, so the router can prefer longer detours when they reduce crossing count.

After routing and repair, routing v2 runs safe post-routing simplification. It first compacts every routed path that exports waypoints by removing duplicate, collinear, and endpoint-adjacent stub points while keeping selected anchors and reserved ports. Compaction is committed only when hard failures, crossings, illegal overlaps, length, and bend count do not increase, and the exported waypoint count decreases. It then tries direct and L-shaped rewrites for remaining multi-bend Z/U routes, committing only when the same no-regression checks pass and bend count decreases. Divider spokes also keep their required monotonic direction.

The scored layout search can also reorder classes inside a stereotype group when the placement is otherwise fixed. It evaluates bounded original, reverse, degree-based, name-based, and small permutation class-order variants per group and keeps the resulting layout only when its score wins. When callers provide explicit layout intent, group grid positions are locked; the engine only repacks classes inside those groups, tries local anchor-order variants per node side, including split fan-out and bounded bucket permutations, and reroutes edges. After the winning layout is selected, a local refinement pass may move anchors to projected non-even ratios or adjacent sides and rewrite waypoints when the full layout score improves.

Programmatic layout callers can optionally pass `anchorOrders`, `anchorOrderMode`, and `anchorOrderVariantLimit` to control endpoint ordering on a specific node side. Auto mode evaluates a bounded set of endpoint-order variants and may choose a different anchor order when the full route score improves.

The web UI summary panel shows the current generated layout score, crossing count, node-hit count, and bend count for Mermaid-generated diagrams.

Draw.io export writes routed control points directly under `<Array as="points">` as plain `<mxPoint x="..." y="..." />` entries. It does not emit `sourcePoint` or `targetPoint`; endpoint selection stays in the edge style through `exitX/exitY` and `entryX/entryY`.

Relationship endpoints stay in the same left-to-right order as the Mermaid input. Arrowheads, inheritance triangles, and aggregation/composition diamonds are selected during draw.io export from the parsed Mermaid operator, so an operator such as `A --* B` affects the visual marker side without reversing the layout source and target.

Quoted Mermaid endpoint labels such as `ClassA "1" *-- "0..*" ClassB : owns` are parsed as UML multiplicities. Draw.io export renders them as endpoint `edgeLabel` child cells near the source and target ends of the routed connector, while the relationship label after `:` remains the middle edge label.

Dense fan-out and fan-in routes can be rendered through small routing dividers when more than four relationships compete for the same common endpoint and the same remote stereotype group. A divider is a virtual node in the routing connector graph, not a decoration added after routing. For fan-out, each target group is treated as its own cluster; for fan-in, each source group is treated as its own cluster. Dividers are planned before anchor assignment, expand semantic relationships into one physical trunk plus one physical spoke per semantic edge, and those physical connectors participate in route occupancy before ordinary edges are routed. Horizontal remote groups use north/south dividers, vertical remote groups use west/east dividers, and more than two dividers on the same remote group emit a `divider-side-overflow` warning while using deterministic side offsets. Exported draw.io output contains the divider as a small connectable vertex and serializes the engine-owned trunk/spoke `routedSegments` without changing the semantic Mermaid relationships or relying on top-level direct anchors for divider-owned semantic edges.

Group frames are hidden by default. To include them as background visuals:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json --group-frames
```

## Web UI MVP

The web UI is a client-side React + Vite app over the same parser, layout, and draw.io exporter used by the CLI. The current UI is an mxGraph-first class diagram layout editor: `mxGraphModel` is the editable source of truth, and the SVG preview is only a view layer.

For fresh Mermaid input, the web UI runs the same scored auto-layout search as the CLI and then exposes the selected candidate as editable layout intent. Placement is locked only after the user edits or imports a layout intent.

The first screen is the tool workflow:

- paste or edit Mermaid `classDiagram` input
- import raw `<mxGraphModel>` XML or an uncompressed `.drawio` file
- inspect compact classes, edges, groups, extends/realization relationships, diagnostics, and layout data
- keep diagnostics readable with a bounded warning log area and clamped message rows
- show a lightweight loading overlay during Mermaid layout calculation with compact candidate/score context
- open Grid Intent as a popup that derives its initial matrix from the currently displayed layout until the user saves a grid preset, stage logical stereotype group placement on a 10x10 or 15x15 matrix, then reroute and apply the layout only when Save is pressed
- edit layout-safe fields such as class geometry, edge segment routes, and edge terminals without editing UML semantics
- adjust stereotype group layout in a large popup 10x10 or 15x15 group-grid matrix, including drag-and-drop group placement with rounded x/y drop preview, compact estimated group footprints, and per-group vertical/horizontal packing rotation recalculated from class sizes
- preview full class member rows in separate attribute and method compartments without hiding long lists
- undo/redo layout edits from toolbar buttons or standard Ctrl/Cmd+Z and Ctrl/Cmd+Y shortcuts
- preview output with the internal SVG renderer
- keep visible group frames off by default; the `Group frames` toggle controls preview/export frames
- collapse the left input/data panel and right layout-info panel to small buttons
- zoom the canvas with Ctrl + mouse wheel or the zoom buttons
- scroll horizontally and vertically in the canvas
- pan the canvas by holding Alt and dragging
- multi-select classes, groups, and edges with Shift/Ctrl/Command clicks or click-drag marquee selection
- drag selected class boxes to update parent-cell `mxGeometry`
- select edges through a zoom-aware enlarged hit target
- select an edge and drag segment midpoint handles perpendicular to that segment to update the edge route
- keep edited edge routes orthogonal after segment drags and after class moves
- drag source/target terminal handles onto a class side to reconnect the relationship or reorder anchors on that side by drop position
- download `.drawio`, layout JSON, SVG preview, or copy raw `mxGraphModel` XML

The web UI does not embed the draw.io editor. Manual draw.io shape editing is intentionally out of scope. SVG export is a preview artifact only; AutoDiagram never converts SVG back to `mxGraphModel`.

Layout JSON export includes the current `mxGraphModel` XML plus extracted layout summaries. In this MVP, importing layout JSON requires an `mxGraphXml` field.

## Supported Mermaid Subset

MVP 0 supports the subset used by `docs/demo_mermaid.md`:

- `classDiagram`
- `class Name { ... }`
- stereotype entries such as `<<Controller>>`
- attributes and methods with visibility prefixes
- constructors
- method return types after the method signature
- relationship operators `--`, `-->`, `<--`, `..`, `..>`, `<..`, `<|..`, `..|>`, `<|--`, `--|>`, `o--`, `--o`, `*--`, and `--*`
- relationship labels after `:`
- quoted relationship endpoint multiplicities, for example `ClassA "1" -- "0..*" ClassB : owns`

Relationship endpoints without a matching `class Name` declaration or `class Name { ... }` block are generated as empty class boxes and reported as parser warnings. Add explicit class declarations when those boxes should contain attributes, methods, or stereotypes.

Mermaid generic markers such as `Task~ApiResponse~` are normalized to `Task<ApiResponse>`.
This generic marker normalization does not apply to stereotype text.

## Commands

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

Run the standalone Python regression checks:

```bash
npm run test:python
```

Run the web UI in development:

```bash
npm run web:dev
```

Build the web UI:

```bash
npm run web:build
```

The production web bundle is written to `dist/apps/web-build` so it does not collide with TypeScript build output.

Generate the sample with the default MVP 2 stereotype group layout:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio
```

Create an editable layout intent file:

```bash
npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json
```

Create an editable layout intent file with the suggested architecture-spine placement:

```bash
npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json --suggested-layout
```

Generate using an edited layout intent file:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json
```

Generate directly with the suggested architecture-spine placement:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --suggested-layout
```

Generate with optional background group frames:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json --group-frames
```

Routing v2 is available as an opt-in migration path. It uses coordinate-based group layout JSON and keeps the legacy engine as the default:

```bash
npm run layout:init -- docs/demo_mermaid.md -o out/demo.routing-v3.json --engine v2
npm run generate -- docs/demo_mermaid.md -o out/demo-v2.drawio --engine v2 --layout out/demo.routing-v3.json
```

When `generate --engine v2` is selected explicitly, the CLI uses the strongest currently implemented v2 route strategy: template routing with private offset sweeps, outer lanes, routing dividers, sparse lane-graph recovery, local repair, generated-layout optimization, and hard validation reporting. This is a bounded sparse lane graph, not a dense grid A* router.

Routing v2 can emit structured run reports:

```bash
npm run generate -- docs/demo_mermaid.md -o out/demo-v2.drawio --engine v2 --layout out/demo.routing-v3.json --verbose --log-layout-json out/demo.routing-report.json
```

Use `--trace-routing` to include debug-level routing events in the console output. The report includes `routingSummary`, including `hardValid`, valid/invalid edge counts, class node hits, divider hits, endpoint-divider interior hits, crossings, total segment overlaps, illegal segment overlaps, divider side overflow count, repair counts, and routing fallback counts. All displayed segment overlaps are hard failures; crossings remain soft quality warnings. The report also includes structured diagnostics and per-edge routing validation results. The CLI still writes `.drawio` output when `hardValid` is `false`; the report and console diagnostics describe the failed constraints.

For v2-routed edges, the layout engine owns generated anchors, waypoints, routing divider split segments, and validation status. The draw.io exporter serializes those engine-owned routes directly and does not invent divider waypoints for v2 output. Legacy exports keep the existing draw.io orthogonal routing style and `jettySize=auto`; v2 routed edges keep explicit anchors and waypoints but omit `jettySize=auto`.

## Standalone Python Routing Pipeline

`scripts/autodiagram_standalone.py` is a Python 3.10+ extraction of the current routing-v2 generation path. It uses only the Python standard library and does not call the Node/TypeScript packages. It is intended for portable/offline generation and regression checks, not as a backend service or replacement for the shared TypeScript packages.

The supported pipeline is:

```text
Mermaid classDiagram -> DiagramDocument -> CoordinateRoutingLayoutV3 -> routing v2 -> mxGraphModel XML/.drawio
```

Create an editable coordinate-routing layout:

```bash
python scripts/autodiagram_standalone.py layout-init docs/demo_mermaid.md -o out/demo.python-routing-v3.json --engine v2
```

Generate from that layout:

```bash
python scripts/autodiagram_standalone.py generate docs/demo_mermaid.md -o out/demo.python.drawio --layout out/demo.python-routing-v3.json --engine v2
```

Generate directly and write a structured routing report:

```bash
python scripts/autodiagram_standalone.py generate docs/demo_mermaid.md -o out/demo.python.drawio --log-layout-json out/demo.python-report.json --engine v2
```

Use `--auto-arrange` to force a fresh generated CoordinateRoutingLayoutV3, `--group-frames` to include background group frames, `--verbose` for info-level routing logs, and `--trace-routing` for debug-level route events. The Python script is v2-only; `--engine legacy` is rejected.

For large diagrams, the standalone Python port applies deterministic adaptive guards to keep CLI runs bounded: generated-layout optimization is skipped above 25 semantic edges, and sparse lane-graph recovery is limited to small diagrams. The output still includes route diagnostics and a routing summary, and `.drawio` is still written when hard validation fails.

Open `out/demo.drawio` in draw.io / diagrams.net to inspect the result.

## Multiplicity - relationship 
Example 1: Zero or one

```mermaid
classDiagram
class User "1" -- "0..1" Address : has
```

Example 2: One or more

```mermaid
classDiagram
class Order "1" -- "1..*" OrderItem : contains
```

## Known Limits

- Drag editing is focused on class positions, edge segment handles, and source/target terminal handles. Terminal drag can reorder anchors on one side, but full draw.io-style shape editing remains out of scope.
- Multi-selection supports classes, groups, and edges, but inspector editing still applies to the primary selected item.
- Undo/redo is model-level for layout edits. Drag gestures are coalesced into one history checkpoint instead of one checkpoint per mousemove.
- Raw `<mxGraphModel>` XML and uncompressed `.drawio` imports are supported first; compressed draw.io files are deferred.
- No continuous layout optimizer.
- The standalone Python utility targets behavioral parity with routing-v2 acceptance criteria, not byte-for-byte XML identity with TypeScript output.
- No compressed `.drawio` output.
- No `<mxfile>` wrapper.
- No free-form diagram editing.
