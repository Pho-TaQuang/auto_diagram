# Routing Validation And Scoring

Validation is for hard constraints. Scoring is for soft quality.

Hard validation failures:

- node overlap
- group overlap
- edge through non-terminal node
- source/target identity changed
- illegal shared segment
- divider that is not fan-in or fan-out
- routing fallback used

Soft score factors:

- crossings
- bend count
- route length
- outer lane usage
- layout area

Independent edges may share a segment only when they share source or target:

```ts
function canShareSegment(a: DiagramEdge, b: DiagramEdge): boolean {
  return a.sourceId === b.sourceId || a.targetId === b.targetId;
}
```

Validation reports both segment overlap counts:

- `segmentOverlaps`: every overlapping route segment, including legal shared source/target segments.
- `illegalSharedSegments`: only shared segments that violate the source/target sharing rule.

`hardValid` is true only when:

```ts
nodeOverlaps === 0 &&
groupOverlaps === 0 &&
edgeNodeHits === 0 &&
illegalSharedSegments === 0 &&
edgeIdentityViolations === 0 &&
invalidDividers === 0 &&
routingFailures === 0
```

Edge crossings remain a soft quality metric in Slice 4B/5.

Slice 3 uses template-only routing. Dividers, outer lanes, and local repair are later slices.
