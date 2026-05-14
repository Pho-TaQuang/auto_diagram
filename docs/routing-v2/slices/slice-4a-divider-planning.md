# Slice 4A: Divider Planning

Artifacts:

- fan-out divider planning
- fan-in divider planning
- rejection of arbitrary group-to-group bundling
- reuse of exporter divider shape
- logs for accepted and rejected divider candidates

Gate:

- fan-out divider allowed only when one source has more than four routed edges to the same remote group
- fan-in divider allowed only when one target has more than four routed edges from the same remote group
- remote groups are bucketed independently
- `A1->B1`, `A2->B2`, `A3->B3` is not bundled

Targeted test:

```bash
npm run test:routing-v2:slice4a
```
