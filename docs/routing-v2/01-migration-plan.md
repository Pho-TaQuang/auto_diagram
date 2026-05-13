# Routing V2 Migration Plan

Routing v2 is split into independently shippable slices. No slice may require the next slice to keep existing CLI or web behavior usable.

Slices:

1. Slice 0: Docs and contracts only.
2. Slice 1: Thin interfaces and logging shell.
3. Slice 2: `CoordinateRoutingLayoutV3` normalizer.
4. Slice 3: Route-only MVP.
5. Slice 4A: Divider planning.
6. Slice 4B: Outer lanes and repair.
7. Slice 5: CLI v2 workflow.
8. Slice 6: Schema freeze.
9. Slice 7: Web integration.
10. Slice 8: Default switch.

Definition of done for every slice:

- updates `docs/routing-v2/` or records why no doc change is needed
- adds tests for changed behavior
- keeps legacy behavior unchanged
- emits `LayoutLogEvent` for conversion, fallback, repair, and hard validation events
- passes `npm run build`
- passes `npm test`

Current implementation may expose opt-in v2 plumbing early for integration tests, but it is not the default product path until Slice 8.

## Targeted Test Commands

Use targeted commands while hardening one slice:

```bash
npm run test:routing-v2
npm run test:routing-v2:slice1
npm run test:routing-v2:slice2
npm run test:routing-v2:slice3
npm run test:routing-v2:slice4a
npm run test:routing-v2:slice4b
npm run test:routing-v2:slice5
npm run test:cli
npm run test:web
npm run test:legacy-layout
npm run test:drawio
```

Slice 5 currently maps to the CLI suite because its acceptance gate is CLI behavior. The full `npm test` remains the release gate, but slice work should normally run the smallest relevant suite first.
