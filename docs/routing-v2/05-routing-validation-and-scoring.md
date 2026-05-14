# Routing Validation And Scoring

Validation is for hard constraints. Scoring is for soft quality.

Hard validation failures:

- node overlap
- group overlap
- edge through any class node interior, including source/target interiors after boundary entry
- edge through a routing divider that is not one of its endpoints
- edge through the interior of its own source/target divider endpoint
- source/target identity changed
- any displayed connector segment overlap
- divider that is not valid fan-in or fan-out routing
- routing fallback or routing failure

Soft score factors:

- edge crossings
- bend count
- route length
- outer lane usage
- layout area

Edge crossings stay soft for `hardValid`; they are reported for quality scoring and UI feedback.

## Segment Overlap Policy

Displayed routed connectors must not share overlapping segments. Sharing a source or target does not make a shared segment legal.

Routing v2 reports both overlap counts:

- `segmentOverlaps`: every geometric route segment overlap.
- `illegalSegmentOverlaps`: compatibility alias for hard-failure segment overlaps.

Dividers are still the only bundling mechanism, but the engine must materialize a single physical trunk plus spokes before final validation. Duplicated divider trunks, divider leaf overlaps, ordinary edge overlaps, invalid divider overlaps, and same-source/same-target overlaps are illegal.

## Recovery Search

Routing v2 attempts recovery before final best-effort fallback:

```text
template candidates
private offset sweep
outer lane sweep
obstacle-aware doglegs
bounded sparse lane-graph recovery
local repair
final best-effort fallback only if recovery fails
```

The sparse lane graph is built from generic geometry: source/target anchors, expanded node, divider, and group obstacle boundaries, corridor lanes, outer lanes, divider lanes, and deterministic private lanes. It rejects graph edges that hit obstacles or reuse occupied displayed segments.

## Per-Edge Validation

Routing v2 reports per-edge validation with explicit references instead of ambiguous string arrays:

```ts
type SegmentRef = {
  edgeId: string;
  segmentId?: string;
  segmentIndex: number;
};

type NodeHitRef = {
  nodeId: string;
  segment: SegmentRef;
};

type EdgeCrossingRef = {
  otherEdgeId: string;
  segment: SegmentRef;
  otherSegment: SegmentRef;
  point?: DiagramPoint;
};

type SegmentOverlapRef = {
  otherEdgeId: string;
  segment: SegmentRef;
  otherSegment: SegmentRef;
  dividerExempt: boolean;
};

type EdgeRoutingValidationResult = {
  edgeId: string;
  nodeHits: NodeHitRef[];
  dividerNodeHits: NodeHitRef[];
  endpointDividerInteriorHits: NodeHitRef[];
  edgeCrossings: EdgeCrossingRef[];
  segmentOverlaps: SegmentOverlapRef[];
  illegalSegmentOverlaps: SegmentOverlapRef[];
  routingFallbackUsed: boolean;
  routingFailed: boolean;
  invalidDividers: string[];
  edgeIdentityViolations: string[];
  hardValid: boolean;
};
```

## Hard Valid

`hardValid` is true only when:

```ts
nodeOverlaps === 0 &&
groupOverlaps === 0 &&
edgeNodeHits === 0 &&
dividerNodeHits === 0 &&
endpointDividerInteriorHits === 0 &&
segmentOverlaps === 0 &&
edgeIdentityViolations === 0 &&
invalidDividers === 0 &&
routingFailures === 0
```

Edge crossings remain a soft quality metric and never make `hardValid` false.
