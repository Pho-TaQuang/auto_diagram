# CoordinateRoutingLayoutV3

`CoordinateRoutingLayoutV3` is the public routing-v2 layout file format. The format version is `3`; the engine generation is routing v2.

```ts
export type CoordinateRoutingLayoutV3 = {
  version: 3;
  layoutMode: "coordinate-routing";
  groups: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    packing: "vertical" | "horizontal";
    nodeOrder: string[];
    locked?: boolean;
    packingLocked?: boolean;
    nodeOrderLocked?: boolean;
  }>;
  layers?: Array<{
    id: string;
    label?: string;
    groupIds: string[];
  }>;
  routing?: {
    dividerThreshold?: number;
    outerLaneMargin?: number;
    maxRepairPasses?: number;
  };
};
```

Public JSON uses a `groups` array for readability. Runtime normalizes it into a group-id map and validates duplicate groups, unknown groups, unknown nodes, duplicate nodes, finite coordinates, and packing values.

`nodeOrder` is intentionally named as an ordered list. It is not just a membership list.

`layers` is optional layout intent for routing-v2. When present, it becomes the source of truth for group placement:

- every group is first measured using its current `packing`, `nodeOrder`, node estimates, padding, and gaps;
- each layer row is laid out horizontally;
- rows are centered against the widest row;
- generated group `x` and `y` values replace stale group coordinates before routing starts.

Layers do not force group packing. A group may stay `vertical` or `horizontal`; changing `packing` changes the measured group size and recomputes layer placement. When `layers` is absent, routing-v2 keeps the legacy coordinate-only behavior and uses group `x` and `y` directly.
