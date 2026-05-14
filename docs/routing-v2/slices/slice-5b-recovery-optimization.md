# Slice 5B: Recovery And Generated Optimization

Artifacts:

- deterministic private offset sweep
- sparse lane-graph recovery search
- congestion-aware route ordering
- divider route occupancy for ordinary routes
- remote-group divider buckets and divider obstacles
- local repair after recovery
- generated-layout candidate search
- strict generated golden fixture checks

Gate:

- generated `DmPhuongTien` v2 output has `hardValid=true`
- `edgeNodeHits=0`
- `dividerNodeHits=0`
- `endpointDividerInteriorHits=0`
- `illegalSegmentOverlaps=0`
- `routingFailures=0`
- no edge has `routingFallbackUsed=true`
- `invalidDividers=0`
- `edgeIdentityViolations=0`
- renamed topology also passes, proving no fixture-name special case
- manual locked route-only layout remains preserved

Targeted test:

```bash
npm run test:routing-v2:slice5b
```
