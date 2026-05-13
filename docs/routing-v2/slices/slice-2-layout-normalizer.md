# Slice 2: CoordinateRoutingLayoutV3 Normalizer

Artifacts:

- coordinate-routing v3 normalizer
- relative-flow v2 converter
- stereotype-grid v1 converter
- structured warnings
- routing-v2 fixtures

Required warnings:

- format conversion
- `compactGrid` converted to `vertical`
- unknown node removed
- duplicate `nodeOrder` entry
- missing `nodeOrder` generated

Gate:

- converter tests pass
- no route engine dependency
- no silent conversion

Targeted test:

```bash
npm run test:routing-v2:slice2
```
