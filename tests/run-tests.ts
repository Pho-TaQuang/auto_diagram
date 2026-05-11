import { runCliTests } from "./cli.test.js";
import { runDrawioExporterTests } from "../packages/drawio/src/mxGraphExporter.test.js";
import { runMxGraphModelTests } from "../packages/drawio/src/mxGraphModel.test.js";
import { runLayoutTests } from "../packages/layout/src/mvp0GridLayout.test.js";
import { runStereotypeGridLayoutTests } from "../packages/layout/src/stereotypeGridLayout.test.js";
import { runParserTests } from "../packages/parsers/src/mermaidClassDiagram.test.js";
import { runStructuralTests } from "./mvp0.structural.test.js";
import { runWebPipelineTests } from "../apps/web/src/pipeline.test.js";

const tests: Array<[string, () => void | Promise<void>]> = [
  ["parser", runParserTests],
  ["layout", runLayoutTests],
  ["stereotype grid layout", runStereotypeGridLayoutTests],
  ["drawio exporter", runDrawioExporterTests],
  ["mxGraph model", runMxGraphModelTests],
  ["web pipeline", runWebPipelineTests],
  ["cli", runCliTests],
  ["structural baseline", runStructuralTests]
];

let passed = 0;

for (const [name, run] of tests) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`1..${tests.length}`);
