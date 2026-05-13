# Routing Validation And Scoring

Validation is for hard constraints. Scoring is for soft quality.

Hard validation failures:

- edge through non-terminal node
- source/target identity changed
- illegal shared segment
- divider that is not fan-in or fan-out

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

Slice 3 uses template-only routing. Dividers, outer lanes, and local repair are later slices.
