---
name: drawio-diagram-relayout
description: Relayout draw.io/diagrams.net mxGraphModel XML diagrams while preserving semantic content. Use when Codex is asked to use the relayout skill, relayout so do, relayout drawio/draw.io files, rearrange UML/class diagrams, boxes, swimlanes, or edges to reduce crossings, box overlaps, segment overlaps, or messy connector routing without changing class names, attributes, methods, enum values, edge labels, multiplicities, or source/target relationships. Supports arbitrary draw.io cell IDs.
---

# Draw.io Diagram Relayout

## Workflow

1. Preserve all diagram content: `value`, class members, operations, enum entries, edge labels, multiplicity labels, `source`, `target`, arrows, dashed/solid semantics, and parent-child cell structure.
2. Change only layout-related data unless the user explicitly allows more:
   - top-level vertex `mxGeometry` `x`/`y`
   - edge routing style keys such as `edgeStyle`, `curved`, `exitX`, `exitY`, `entryX`, `entryY`
   - edge waypoint `<Array as="points">`
3. Prefer the generic script flow. Do not depend on a fixed ID prefix: every pasted diagram may have different draw.io cell IDs.
4. First reduce edge crossings and box cuts, then minimize bends and spacing. Align centers of strongly connected boxes on shared horizontal or vertical axes whenever that can make the relation straight.
5. Use edge anchors on the 25%, 50%, or 75% positions of class sides. Choose the position by direction, not by fixed sequence: top/bottom use 25% for a left-side target and 75% for a right-side target; left/right use 25% for an upper target and 75% for a lower target. If one side has multiple links, distribute to adjacent sides before using visually opposite sides.
6. Do not attach a relation to the visually opposite side when a direct side is available. Example: when A is left of B, A should exit right and B should enter left.
7. Do not reuse the same anchor point for multiple edges on the same class side.
8. Links may cross, but their orthogonal segments must not overlap on top of each other, including shared dogleg lanes.
9. Route edges so no segment passes through the rectangle of any non-terminal class box unless the user explicitly relaxes that rule.
10. Return either a complete relayouted XML artifact, a layout-only XML fragment, or file paths depending on the user's requested output format.

## Layout Strategy

Do not force a fixed central-class layout. A central hub layout is only one possible strategy, not a rule.

Choose the layout that minimizes visual complexity:
1. no edge segment through non-terminal boxes;
2. no box overlaps;
3. no overlapping edge segments;
4. fewest crossings, especially when the user complains that edges cut through or cross other content;
5. compact bounding width/area and short total edge length;
6. fewest bends;
7. no duplicate source/target anchor points on the same class;
8. good spacing and readable grouping.

Before committing to a layout, consider multiple arrangements:
- hub-and-spoke layout;
- layered left-to-right layout;
- layered top-to-bottom layout;
- grouped-by-stereotype layout, such as Entity / DTO / Enum / Audit;
- grouped-by-relationship layout, placing strongly connected boxes near each other;
- split-hub layout, where a high-degree class is not centered if that creates fewer crossings.

The final layout may place any class anywhere if that reduces edge crossings, bends, route length, compactness, or anchor congestion.

Treat user examples such as "make these DTOs form a vertical column" as evidence that a more compact generic arrangement can work, not as a hard constraint unless the user explicitly asks for that exact shape. Generalize the lesson into scoring/candidate rules before adding a new preset.

Do not preserve the original relative position of classes unless it helps readability.

## Domain-Specific Layout Handling

The script already detects arbitrary draw.io cell IDs dynamically. Do not hard-code IDs. For every custom or domain-specific layout, identify boxes by their visible `value` text, class name, stereotype, or enum name.

If the generic `auto` layout produces an unstable result for a tall or high-degree entity, create or use a domain-specific preset or small wrapper layout function. The preset must:
- inspect top-level vertex cells dynamically;
- map classes by names found in `value`, not by cell ID;
- preserve all class text, edge labels, multiplicities, `source`, `target`, and parent structure;
- only modify top-level vertex `mxGeometry x/y`, edge routing style, and edge waypoint points.
- generate several reasonable coordinate maps and select the one with the best routing score.

For diagrams such as `DanhGiaSuKienModel`, `QLSuKien`, `SysqlskSuKienEntity` / `SuKienModel`, or `DMLucLuong`, inspect the graph structure and choose the least tangled arrangement.

A tall or high-degree class may be placed near the center, but this is not mandatory. If placing it off-center, above, below, or in a side column reduces crossings and bends, use that arrangement.

Prefer to:
- keep directly related boxes close;
- align strongly connected boxes horizontally or vertically;
- put enum/reference boxes near the fields that use them;
- put search DTOs near their entity or result model;
- put audit/history models near the entities they reference;
- keep workflow DTOs in a readable sequence when applicable.

Avoid:
- forcing all relations through one central class;
- routing many unrelated edges around a large central box;
- placing small enum/reference boxes between two heavily connected entity boxes;
- using long perimeter routes just to avoid a minor crossing.

A named preset may still use known class names, but it must not hard-code a single fixed coordinate map unless the user explicitly asks for that exact arrangement. Prefer generating several reasonable coordinate maps and selecting the one with the best routing score.

If the requested diagram resembles an existing good layout such as `QLSuKien` or `DMLucLuong`, mimic that layout style instead of relying only on generic BFS.

## Script

Use `scripts/relayout_mxgraph.py` for repeatable relayout work. The default `auto` preset detects top-level draw.io class boxes and edges dynamically, generates multiple candidate layouts, routes each candidate, scores the result, and writes the lowest-scoring layout.

Default usage:

```powershell
python C:\Users\Admin\.codex\skills\drawio-diagram-relayout\scripts\relayout_mxgraph.py input.drawio
```

When no output path is provided, save artifacts under a `diagram` folder next to the current project root, not inside it. If the project is `father/root`, use `father/diagram`:

```text
father/
  root/
  diagram/
    ori/       original diagram copied before relayout
    relayout/  diagram after relayout
```

Use `../diagram/ori/<input-name>` for the original file and `../diagram/relayout/<input-stem>_relayout<input-ext>` for the relayouted file when running from the project root. Create these folders before writing when they do not exist.

For pasted XML, save it first to `../diagram/ori/<meaningful-name>.drawio`, run the script against that file, then write the relayouted diagram to `../diagram/relayout/`.

Explicit output remains supported when a user asks for a specific path:

```powershell
python C:\Users\Admin\.codex\skills\drawio-diagram-relayout\scripts\relayout_mxgraph.py input.drawio output.drawio
```

When running with a known domain preset, use:

```powershell
python C:\Users\Admin\.codex\skills\drawio-diagram-relayout\scripts\relayout_mxgraph.py input.drawio output.drawio --preset <preset-name>
```

If the requested preset is not implemented in the script, implement it by class-name detection, not by fixed draw.io IDs or a single fixed coordinate map.

Implemented presets:

- `auto`: generic dynamic candidate layout with routing-score selection. It scores box overlaps, route overlaps, crossings, compact width/area, and route length; it also tries stacked disconnected components, diagonal child-branch flips, and crossing-aware routing before choosing a layout.
- `danh-gia-su-kien`: class-name informed candidate layout for `DanhGiaSuKienModel` assessment/closure diagrams.
- `ql-su-kien`: class-name informed compact and layered candidates for `SysqlskSuKienEntity` / `SuKienModel` event-management diagrams; also considered by `auto` when all known class names are present.

Use `--keep-vertices` when the user only wants connector rerouting and does not want class boxes moved.

Use `--skip-validation` only when the diagram is too dense to satisfy all strict routing rules and the user accepts the remaining risk.




