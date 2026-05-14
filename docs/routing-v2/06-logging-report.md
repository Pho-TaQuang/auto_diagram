# Logging And Run Reports

Routing v2 emits `LayoutLogEvent` entries for conversion, defaulting, deprecated field conversion, generated-layout candidate evaluation, route ordering, route selection, recovery, final fallback, divider decisions, outer lane usage, repair attempts, and hard validation failures.

Default reports include warnings and errors. Trace is included only when requested by CLI/web options. Human-readable warning and error messages are preserved, while structured diagnostics are added for tools that need actionable routing data.

```ts
export type LayoutRunReport = {
  engine: "stereotype-scored" | "manual-routing-v2" | "suggest-initial-v2" | "auto-arrange-v2";
  sourceFormat?: "coordinate-routing-v3" | "relative-flow-v2" | "stereotype-grid-v1" | "none";
  warnings: LayoutLogEvent[];
  errors: LayoutLogEvent[];
  diagnostics: DiagramDiagnostic[];
  routingSummary?: RoutingSummary;
  edgeValidations?: EdgeRoutingValidationResult[];
  trace?: LayoutLogEvent[];
};
```

`DiagramDocument.layout.diagnostics` mirrors the same structured layout diagnostics for downstream consumers that only receive the document. The existing top-level `DiagramDocument.diagnostics` remains a human-readable message stream.

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
  dividerNodeHits: number;
  endpointDividerInteriorHits: number;
  edgeCrossings: number;
  segmentOverlaps: number;
  illegalSegmentOverlaps: number;
  dividerSideOverflow: number;
  edgeIdentityViolations: number;
  invalidDividers: number;
  outerLaneUsages: number;
  routingFailures: number;
  repairAccepted: number;
  repairRejected: number;
};
```

Structured routing diagnostics use these public diagnostic shapes:

```ts
type LayoutChangeRequiredDiagnostic = {
  type: "layout-change-required";
  severity: "error";
  reason: "edge-node-hit" | "divider-node-hit" | "endpoint-divider-interior-hit" | "illegal-segment-overlap" | "routing-failure" | "invalid-divider";
  edgeIds: string[];
  groupIds: string[];
  recommendedAction?: LayoutRecommendedAction;
};

type DividerSideOverflowDiagnostic = {
  type: "divider-side-overflow";
  severity: "warning";
  reason: "divider-side-overflow";
  groupIds: string[];
};

type EdgeCrossingDiagnostic = {
  type: "edge-crossing";
  severity: "warning";
  edgeIds: string[];
  groupIds: string[];
  recommendedAction?: LayoutRecommendedAction;
};
```

Routing v2 emits events in this order for the core route lifecycle:

```text
route-strategy-selected
generated-layout-candidate-evaluated
route-candidates-generated
routing-recovery-attempted | routing-recovery-succeeded | routing-recovery-failed
repair-complete
route-validation-passed | route-validation-failed
route-complete
```

`route-complete` must include the validation status in event data and must not be emitted before validation.

`routing-fallback-used` is reserved for final unrecovered routes after recovery and repair have failed. Intermediate failed candidates are trace/debug recovery events, not final warning/error diagnostics.

`divider-side-overflow` is a warning diagnostic. It means more than two dividers target the same remote group, so the router alternated the allowed sides with deterministic offsets.
