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
- unknown layer group ignored
- missing layer group assignment appended to a generated layer

Duplicate group ids are rejected.

For `CoordinateRoutingLayoutV3.layers`, normalization validates layer ids and group assignments before routing. A group may appear in only one layer; duplicate layer assignment is rejected because it would make placement ambiguous.

When `layers` is present, normalization estimates all group sizes before placement, replaces group `x/y` from horizontal centered layer rows, and then passes the resulting coordinate intent to `manual-routing-v2`. When `layers` is absent, existing coordinate-only `x/y` behavior remains unchanged.
