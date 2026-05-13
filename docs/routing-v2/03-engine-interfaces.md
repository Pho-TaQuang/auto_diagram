# Engine Interfaces

Routing v2 uses thin interfaces only where change is expected.

Required interfaces:

- `LayoutEngine`
- `LayoutInputNormalizer`
- `RouteStrategy`
- `LayoutLogger`
- `LayoutRunReport`
- tiny `LayoutEngineRegistry`

Do not turn the registry into a plugin framework. It only needs enough indirection for CLI/web to call `legacy` or `v2` engines through the same boundary.

No interface is needed yet for parser, draw.io exporter, group packing, anchor assignment, score weights, or class size estimation.
