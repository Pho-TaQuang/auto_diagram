# CLI Behavior

Legacy remains the default CLI behavior until Slice 8.

Routing v2 CLI workflow, once officially hardened in Slice 5:

```bash
npm run layout:init -- input.mmd -o layout.json --engine v2
npm run generate -- input.mmd -o output.drawio --engine v2 --layout layout.json
npm run generate -- input.mmd -o output.drawio --engine v2
```

`generate --engine v2 --layout layout.json` accepts `CoordinateRoutingLayoutV3`. If the layout JSON includes root-level `layers`, the CLI uses layer-derived coordinates automatically. Layer rows are horizontal and centered as a whole, while each group keeps its own `packing` value.

Example layer intent:

```json
{
  "version": 3,
  "layoutMode": "coordinate-routing",
  "layers": [
    { "id": "entry", "groupIds": ["group_stereotype_Controller"] },
    { "id": "domain", "groupIds": ["group_stereotype_Manager", "group_stereotype_Model"] }
  ],
  "groups": []
}
```

The `groups` array still carries real group membership, `nodeOrder`, packing, and fallback coordinates. The shortened example above only shows the layer shape.

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

This enables template routing, private offset sweeps, outer lanes, dividers, sparse lane-graph recovery, repair, generated-layout optimization for generated v2 runs, and validation summary for explicit v2 runs only. The default CLI path remains legacy until Slice 8.

The CLI writes `.drawio` output even when `routingSummary.hardValid` is `false`. Hard validation failures are surfaced through default warnings/errors, structured diagnostics, per-edge validation results, and optional report JSON instead of failing generation at runtime.

All displayed segment overlaps are hard failures. Divider routes are expanded into one physical trunk plus spokes before validation, so there is no final divider-trunk overlap exemption.

Example hard diagnostic:

```text
Error: Routing hard validation failed. Reason: illegal-segment-overlap. Edges: edge_11_A_B, edge_12_C_D. Suggested fix: increase horizontal gap between Controller and DTO by 120px, or route one edge through the north outer lane.
```

Example node-hit diagnostic:

```text
Error: Routing hard validation failed. Reason: edge-node-hit. Edges: edge_4_Manager_AdapterFactory. Suggested fix: move AdapterFactory to the right, or increase vertical gap below Manager by 260px.
```

Crossing-only diagnostics are warnings and do not make `routingSummary.hardValid` false:

```text
Warning: Edge crossing remains. Edges: edge_11_A_B, edge_13_C_D. Suggested fix: move DTO down by 120px or reorder nodes in Model.
```
