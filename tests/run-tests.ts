import { runCliTests } from "./cli.test.js";
import { runDrawioExporterTests } from "../packages/drawio/src/mxGraphExporter.test.js";
import { runMxGraphModelTests } from "../packages/drawio/src/mxGraphModel.test.js";
import { runLayoutTests } from "../packages/layout/src/mvp0GridLayout.test.js";
import { runRelativeFlowLayoutTests } from "../packages/layout/src/relativeFlowLayout.test.js";
import {
  runRoutingV2Slice1Tests,
  runRoutingV2Slice2Tests,
  runRoutingV2Slice3Tests,
  runRoutingV2Slice4ATests,
  runRoutingV2Slice4BTests,
  runRoutingV2Slice5ATests
} from "../packages/layout/src/routingV2.test.js";
import { runStereotypeGridLayoutTests } from "../packages/layout/src/stereotypeGridLayout.test.js";
import { runParserTests } from "../packages/parsers/src/mermaidClassDiagram.test.js";
import { runStructuralTests } from "./mvp0.structural.test.js";
import { runWebPipelineTests } from "../apps/web/src/pipeline.test.js";
import { runQlskDividerTests } from "./qlsk-divider.test.js";

const tests: Array<[string, () => void | Promise<void>]> = [
  ["parser", runParserTests],
  ["layout", runLayoutTests],
  ["relative flow layout", runRelativeFlowLayoutTests],
  ["routing v2 slice 1 interfaces logging", runRoutingV2Slice1Tests],
  ["routing v2 slice 2 normalizer", runRoutingV2Slice2Tests],
  ["routing v2 slice 3 route-only mvp", runRoutingV2Slice3Tests],
  ["routing v2 slice 4a divider planning", runRoutingV2Slice4ATests],
  ["routing v2 slice 4b outer lanes repair", runRoutingV2Slice4BTests],
  ["routing v2 slice 5a strict sharing diagnostics", runRoutingV2Slice5ATests],
  ["stereotype grid layout", runStereotypeGridLayoutTests],
  ["drawio exporter", runDrawioExporterTests],
  ["mxGraph model", runMxGraphModelTests],
  ["web pipeline", runWebPipelineTests],
  ["cli", runCliTests],
  ["structural baseline", runStructuralTests],
  ["qlsk divider clusters", runQlskDividerTests]
];

const filters = process.argv.slice(2).map((arg) => arg.toLowerCase());
const selectedTests = filters.length === 0
  ? tests
  : tests.filter(([name]) => filters.some((filter) => name.toLowerCase().includes(filter)));

if (selectedTests.length === 0) {
  throw new Error(`No test suites matched filters: ${filters.join(", ")}`);
}

let passed = 0;

for (const [name, run] of selectedTests) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`1..${selectedTests.length}`);
