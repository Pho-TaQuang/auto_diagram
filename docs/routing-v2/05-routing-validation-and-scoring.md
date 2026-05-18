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

## Flexible Anchor Candidate Selection

Ordinary routing-v2 edges choose route path and endpoint anchors together. The router builds a per-node port pool from displayed ordinary-edge degree: a node with degree `n` gets `n` slots on each north/east/south/west side, with slot ratios `i / (n + 1)`.

Port reservations use stable slot identity, not floating-point ratios:

```text
nodeId:side:slotIndex
```

Direct and corridor candidates infer their source and target sides from the first and last segments of the geometry skeleton. Outer-left/right/top/bottom candidates use matching sides on both endpoints, and outer-corner candidates use the first outer lane side for the source and the final outer lane side for the target. Candidate expansion is budgeted per strategy so high-degree nodes do not create an unbounded port Cartesian product.

Repair reroutes an edge transactionally: it evaluates replacements against reservations from all other committed routes, then commits the new path and ports only if the replacement improves the route. Rejected repairs leave the old path, anchors, and reserved ports intact.

## Bend Reduction

After routing and repair, routing v2 simplifies routed paths before `routedSegments` are exported. This is post-routing cleanup, not a separate routing strategy.

Pass 1 compacts every normal route and divider physical route that exports at least one waypoint. It reconstructs the full path from selected anchors plus waypoints, removes adjacent duplicates, collinear middle points, and endpoint-adjacent stubs, then writes the compacted waypoints back to the route object. Compaction is committed only when:

- hard failures do not increase
- illegal segment overlaps do not increase
- crossings do not increase
- route length does not increase
- bend count does not increase
- exported waypoint count decreases

Pass 2 runs after compaction. It targets remaining routes with at least two bends and tries direct, horizontal-then-vertical, and vertical-then-horizontal rewrites. A rewrite is committed only when the same no-regression checks pass and bend count decreases.

Divider trunk/spoke anchor sides must stay unchanged. Divider spokes also must keep their monotonic direction toward or away from the divider.

## Segment Overlap Policy

Displayed routed connectors must not share overlapping segments. Sharing a source or target does not make a shared segment legal.

Routing v2 reports both overlap counts:

- `segmentOverlaps`: every geometric route segment overlap.
- `illegalSegmentOverlaps`: compatibility alias for hard-failure segment overlaps.

Dividers are still the only bundling mechanism, but the engine must materialize physical connectors before final validation. Duplicated divider trunks, divider spokes, ordinary edge overlaps, invalid divider overlaps, and same-source/same-target overlaps are illegal.

## Divider Connector Graph

A routing divider is a virtual node in the connector graph. The original semantic relationship remains the owner identity, but displayed geometry is stored in physical trunk/spoke `routedSegments`:

- fan-out: one trunk from the common class to the divider, then one spoke from the divider to each remote class
- fan-in: one spoke from each remote class to the divider, then one trunk from the divider to the common class

Divider-owned semantic edges are not routed directly and do not rely on top-level direct source/target anchors. The trunk owner is a deterministic representative semantic edge; each spoke is owned by its corresponding semantic edge. Physical trunk/spoke paths are accepted as occupancy before ordinary semantic edges are routed, so normal routes avoid divider connector node hits and illegal segment overlaps.

Divider side is a hard constraint. A trunk connects to `divider.side`; spokes connect to `oppositeSide(divider.side)` on the divider and to the class side facing the divider. Spokes are sorted by remote position along the divider axis and first try an aligned straight segment from the divider to the remote class. A straight spoke is accepted only when it has no node hit, no illegal segment overlap, and preserves the required monotonic direction; otherwise the existing constrained orthogonal router handles that spoke. Spokes are still scored to prefer monotonic movement from divider to remote for fan-out, or remote to divider for fan-in.

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
