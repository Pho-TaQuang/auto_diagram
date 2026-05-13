# Logging And Run Reports

Routing v2 emits `LayoutLogEvent` entries for conversion, defaulting, deprecated field conversion, route selection, fallback, divider decisions, outer lane usage, repair attempts, and hard validation failures.

```ts
export type LayoutRunReport = {
  engine: "stereotype-scored" | "manual-routing-v2" | "suggest-initial-v2" | "auto-arrange-v2";
  sourceFormat?: "coordinate-routing-v3" | "relative-flow-v2" | "stereotype-grid-v1" | "none";
  warnings: LayoutLogEvent[];
  errors: LayoutLogEvent[];
  routingSummary?: RoutingSummary;
  trace?: LayoutLogEvent[];
};
```

Default reports include warnings and errors. Trace is included only when requested by CLI/web options.

`RoutingSummary` is the stable high-level routing result for CLI/debug consumers:

```ts
export type RoutingSummary = {
  routeStrategy: "template-only" | "template-with-outer-lanes" | "astar";
  hardValid: boolean;
  totalEdges: number;
  validEdges: number;
  invalidEdges: number;
  nodeOverlaps: number;
  groupOverlaps: number;
  edgeNodeHits: number;
  edgeCrossings: number;
  segmentOverlaps: number;
  illegalSharedSegments: number;
  edgeIdentityViolations: number;
  invalidDividers: number;
  outerLaneUsages: number;
  routingFailures: number;
  repairAccepted: number;
  repairRejected: number;
};
```

Routing v2 emits events in this order for the core route lifecycle:

```text
route-strategy-selected
route-candidates-generated
repair-complete
route-validation-passed | route-validation-failed
route-complete
```

`route-complete` must include the validation status in event data and must not be emitted before validation.
