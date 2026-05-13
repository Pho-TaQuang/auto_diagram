# Slice 4A: Divider Planning

Artifacts:

- fan-out divider planning
- fan-in divider planning
- rejection of arbitrary group-to-group bundling
- reuse of exporter divider shape
- logs for accepted and rejected divider candidates

Gate:

- same-source fan-out allowed
- same-target fan-in allowed
- `A1->B1`, `A2->B2`, `A3->B3` is not bundled

Targeted test:

```bash
npm run test:routing-v2:slice4a
```
