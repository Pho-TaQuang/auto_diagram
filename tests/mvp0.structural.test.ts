import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { toMxGraphModelXml } from "../packages/drawio/src/index.js";
import { applyMvp0GridLayout } from "../packages/layout/src/index.js";
import { parseMermaidClassDiagram } from "../packages/parsers/src/index.js";

const mermaidFixture = readFileSync("docs/demo_mermaid.md", "utf8");
const dmLoaiLucLuongFixture = readFileSync("docs/dmLoaiLucLuong.md", "utf8");
const mvp0BaselineDrawioFixture = readFileSync("tests/fixtures/mvp0-baseline.drawio", "utf8");

export function runStructuralTests(): void {
  matchesTheMvp0BaselineStructuralShape();
  matchesTheDmLoaiLucLuongStructuralShape();
}

function matchesTheMvp0BaselineStructuralShape(): void {
  const generated = toMxGraphModelXml(applyMvp0GridLayout(parseMermaidClassDiagram(mermaidFixture)));

  assert.equal(XMLValidator.validate(generated), true);
  assert.equal(XMLValidator.validate(mvp0BaselineDrawioFixture), true);

  const generatedSummary = summarize(generated);
  const baselineSummary = summarize(mvp0BaselineDrawioFixture);

  assert.equal(generatedSummary.rootName, "mxGraphModel");
  assert.equal(generatedSummary.rootName, baselineSummary.rootName);
  assert.equal(generatedSummary.topLevelVertices, baselineSummary.topLevelVertices);
  assert.equal(generatedSummary.edges, baselineSummary.edges);
  assert.equal(generatedSummary.childVertices, baselineSummary.childVertices);
  assert.deepEqual(generatedSummary.edgeLabels.sort(), baselineSummary.edgeLabels.sort());
  assertStructuralInvariants(generatedSummary);
  assertStructuralInvariants(baselineSummary);
}

function matchesTheDmLoaiLucLuongStructuralShape(): void {
  const generated = toMxGraphModelXml(applyMvp0GridLayout(parseMermaidClassDiagram(dmLoaiLucLuongFixture)));

  assert.equal(XMLValidator.validate(generated), true);

  const generatedSummary = summarize(generated);

  assert.equal(generatedSummary.rootName, "mxGraphModel");
  assert.equal(generatedSummary.topLevelVertices, 8);
  assert.equal(generatedSummary.edges, 9);
  assert.equal(generatedSummary.childVertices, 62);
  assert.deepEqual(generatedSummary.edgeLabels.sort(), [
    "CRUD/map",
    "creates",
    "creates adapter",
    "filters/paging",
    "implements",
    "inject/call",
    "input/output",
    "input/output",
    "map/use"
  ].sort());
  assertStructuralInvariants(generatedSummary);
}

function summarize(xml: string): {
  rootName: string;
  topLevelVertices: number;
  childVertices: number;
  edges: number;
  edgeLabels: string[];
  edgeReferencesExistingClassCells: boolean;
  swimlaneClassesHaveStartSize: boolean;
  childRowsStartBelowHeader: boolean;
} {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false
  }).parse(xml);
  const cells = asArray(parsed.mxGraphModel.root.mxCell);
  const classCells = cells.filter((cell) => cell.vertex === "1" && cell.parent === "1");
  const childCells = cells.filter((cell) => cell.vertex === "1" && cell.parent !== "1");
  const edgeCells = cells.filter((cell) => cell.edge === "1");
  const classIds = new Set(classCells.map((cell) => cell.id));

  return {
    rootName: parsed.mxGraphModel ? "mxGraphModel" : "",
    topLevelVertices: classCells.length,
    childVertices: childCells.length,
    edges: edgeCells.length,
    edgeLabels: edgeCells.map((cell) => String(cell.value ?? "")),
    edgeReferencesExistingClassCells: edgeCells.every((cell) => classIds.has(cell.source) && classIds.has(cell.target)),
    swimlaneClassesHaveStartSize: classCells.every((cell) => {
      const style = String(cell.style);
      return style.startsWith("swimlane") && extractStartSize(style) > 0;
    }),
    childRowsStartBelowHeader: childCells.every((child) => {
      const parent = classCells.find((cell) => cell.id === child.parent);
      return !parent || Number(child.mxGeometry.y) >= extractStartSize(String(parent.style));
    })
  };
}

function assertStructuralInvariants(summary: {
  edgeReferencesExistingClassCells: boolean;
  swimlaneClassesHaveStartSize: boolean;
  childRowsStartBelowHeader: boolean;
}): void {
  assert.equal(summary.edgeReferencesExistingClassCells, true);
  assert.equal(summary.swimlaneClassesHaveStartSize, true);
  assert.equal(summary.childRowsStartBelowHeader, true);
}

function extractStartSize(style: string): number {
  const match = style.match(/(?:^|;)startSize=([^;]+)/);
  return match ? Number(match[1]) : 0;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
