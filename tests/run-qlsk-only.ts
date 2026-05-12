import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parseMermaidClassDiagram } from "../packages/parsers/src/index.js";
import { applyStereotypeGridLayout, createStereotypeLayoutIntent } from "../packages/layout/src/index.js";
import { toMxGraphModelXml } from "../packages/drawio/src/index.js";
import { runQlskDividerTests } from "./qlsk-divider.test.js";

await mkdir("out", { recursive: true });

// ── 1. Generate .drawio ──────────────────────────────────────────────────────
const source = readFileSync("docs/qlsk.md", "utf8");
const parsed = parseMermaidClassDiagram(source);
const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
const laidOut = applyStereotypeGridLayout(parsed, { intent });
const xml = toMxGraphModelXml(laidOut, { groupFrames: true });

await writeFile("out/qlsk.drawio", xml, "utf8");
console.log("Exported → out/qlsk.drawio");

// Print any layout diagnostics
for (const d of laidOut.diagnostics) {
  console.log(`  [${d.severity}] ${d.message}`);
}

// ── 2. Run divider tests ─────────────────────────────────────────────────────
console.log("");
await runQlskDividerTests();
console.log("ok 1 - qlsk divider clusters");
