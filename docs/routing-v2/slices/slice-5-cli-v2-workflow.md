# Slice 5: CLI V2 Workflow

Artifacts:

- `--engine legacy | v2`
- `--verbose`
- `--trace-routing`
- `--log-layout-json`
- `layout:init --engine v2`
- `generate --engine v2 --layout`
- `generate --engine v2` suggest-initial

Gate:

- `--engine legacy` unchanged
- v2 route-only works
- report JSON written
- warnings/errors printed by default

Targeted test:

```bash
npm run test:routing-v2:slice5
```
