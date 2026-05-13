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
