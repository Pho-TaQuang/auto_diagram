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
  routing?: {
    dividerThreshold?: number;
    outerLaneMargin?: number;
    maxRepairPasses?: number;
  };
};
```

Public JSON uses a `groups` array for readability. Runtime normalizes it into a group-id map and validates duplicate groups, unknown groups, unknown nodes, duplicate nodes, finite coordinates, and packing values.

`nodeOrder` is intentionally named as an ordered list. It is not just a membership list.
