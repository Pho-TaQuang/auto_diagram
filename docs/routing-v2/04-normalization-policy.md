# Normalization Policy

The routing-v2 normalizer accepts:

- `coordinate-routing-v3`
- `relative-flow-v2`
- `stereotype-grid-v1`

All inputs normalize to `CoordinateRoutingLayoutV3`.

No silent fixes are allowed. The normalizer must emit structured warnings for:

- format conversion
- `compactGrid` converted to `vertical`
- unknown node removed
- duplicate `nodeOrder` entry removed
- missing `nodeOrder` generated from document order
- unknown group ignored
- missing group generated

Duplicate group ids are rejected.
