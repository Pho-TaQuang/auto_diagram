# Slice 3: Route-Only MVP

Artifacts:

- preserve group x/y
- vertical/horizontal packing
- deterministic anchors
- simple template routes
- segment index
- hard validation shell
- basic score
- `LayoutRunReport`

Explicitly excluded:

- A*
- dividers
- outer lanes
- complex local repair
- web integration

Gate:

- route-only does not move groups
- locked packing is not changed
- locked `nodeOrder` is not reordered
- hard validation errors appear in the report

Targeted test:

```bash
npm run test:routing-v2:slice3
```
