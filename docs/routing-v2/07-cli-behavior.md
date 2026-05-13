# CLI Behavior

Legacy remains the default CLI behavior until Slice 8.

Routing v2 CLI workflow, once officially hardened in Slice 5:

```bash
npm run layout:init -- input.mmd -o layout.json --engine v2
npm run generate -- input.mmd -o output.drawio --engine v2 --layout layout.json
npm run generate -- input.mmd -o output.drawio --engine v2
```

Logging flags:

- default prints warnings/errors
- `--verbose` prints info/warnings/errors
- `--trace-routing` prints debug/info/warnings/errors
- `--log-layout-json <path>` writes the full structured report

Any earlier `--engine v2` exposure is dev/opt-in plumbing for integration tests and must not change default behavior.

For `generate --engine v2`, the CLI passes the strongest currently implemented v2 strategy to the engine:

```ts
{
  routeStrategy: "template-with-outer-lanes",
  traceRouting: traceRouting || verbose || Boolean(logLayoutJson)
}
```

This enables template routing, outer lanes, dividers, repair, and validation summary for explicit v2 runs only. The default CLI path remains legacy until Slice 8.

The CLI writes `.drawio` output even when `routingSummary.hardValid` is `false`. Hard validation failures are surfaced through default warnings/errors, diagnostics, and optional report JSON instead of failing generation at runtime.
