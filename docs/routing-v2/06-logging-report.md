# Logging And Run Reports

Routing v2 emits `LayoutLogEvent` entries for conversion, defaulting, deprecated field conversion, route selection, fallback, divider decisions, outer lane usage, repair attempts, and hard validation failures.

```ts
export type LayoutRunReport = {
  engine: "stereotype-scored" | "manual-routing-v2" | "suggest-initial-v2" | "auto-arrange-v2";
  sourceFormat?: "coordinate-routing-v3" | "relative-flow-v2" | "stereotype-grid-v1" | "none";
  warnings: LayoutLogEvent[];
  errors: LayoutLogEvent[];
  trace?: LayoutLogEvent[];
};
```

Default reports include warnings and errors. Trace is included only when requested by CLI/web options.
