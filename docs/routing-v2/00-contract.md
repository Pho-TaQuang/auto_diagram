# Routing V2 Contract

Routing v2 is a staged, opt-in route-first layout path. Legacy `stereotype-scored` remains the default until Slice 8.

Core boundary:

```text
User controls group layout.
Engine controls routing.
Auto layout only runs for initial layout or explicit Auto.
```

Route-only must preserve user-owned layout:

- group `x` / `y`
- locked `packing`
- locked `nodeOrder`

When routing is hard, the engine routes best-effort, emits `LayoutLogEvent` diagnostics, and suggests user action. It must not silently move groups or mutate UML semantics.

Slice completion requires docs, tests, `npm run build`, `npm test`, and unchanged legacy behavior unless the slice explicitly states otherwise.
