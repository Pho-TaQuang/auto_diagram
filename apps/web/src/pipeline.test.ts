import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { runMxGraphImport, runWebPipeline, serializeMxGraphState } from "./pipeline.js";
import { updateCellGeometry } from "../../../packages/drawio/src/index.js";

const fixture = readFileSync("docs/demo_mermaid.md", "utf8");

export function runWebPipelineTests(): void {
  generatesDrawioXmlFromMermaid();
  exposesSelectedAutoLayoutIntent();
  appliesEditableLayoutIntent();
  exportsOptionalGroupFrames();
  importsMxGraphXmlIntoEditorState();
  exportsMutatedMxGraphState();
}

function generatesDrawioXmlFromMermaid(): void {
  const result = runWebPipeline({ source: fixture });

  assert.equal(result.parsed.nodes.length, 11);
  assert.equal(result.diagram.edges.length, 13);
  assert.equal(result.intent.version, 1);
  assert.equal(result.intent.grid.columns, result.diagram.layout?.grid.columns);
  assert.equal(result.diagram.layout?.score.edgeCrossings, 0);
  assert.equal(result.layoutView.classes.length, 11);
  assert.equal(result.layoutView.edges.length, 13);
  assert.equal(XMLValidator.validate(result.xml), true);
  assert.ok(result.xml.includes("<mxGraphModel"));
}

function exposesSelectedAutoLayoutIntent(): void {
  const base = runWebPipeline({ source: fixture });
  const rerun = runWebPipeline({ source: fixture, intent: base.intent });

  assert.equal(base.intent.grid.columns, base.diagram.layout?.grid.columns);
  assert.equal(base.intent.grid.rows, base.diagram.layout?.grid.rows);
  assert.equal(rerun.diagram.layout?.score.edgeCrossings, 0);
  assert.deepEqual(
    base.intent.groups.map((group) => [group.id, group.gridX, group.gridY, group.packing]),
    rerun.intent.groups.map((group) => [group.id, group.gridX, group.gridY, group.packing])
  );
}

function appliesEditableLayoutIntent(): void {
  const base = runWebPipeline({ source: fixture });
  const intent = {
    ...base.intent,
    grid: { ...base.intent.grid },
    groups: base.intent.groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }))
  };
  const controller = intent.groups.find((group) => group.label === "Controller");
  const managerInterface = intent.groups.find((group) => group.label === "ManagerInterface");

  assert.ok(controller);
  assert.ok(managerInterface);

  controller.gridX = 1;
  managerInterface.gridX = 0;

  const result = runWebPipeline({ source: fixture, intent, groupFrames: true });
  const cells = asArray(parseXml(result.xml).mxGraphModel.root.mxCell);
  const controllerFrame = cells.find((cell) => cell.id === "group_frame_group_stereotype_Controller");
  const managerFrame = cells.find((cell) => cell.id === "group_frame_group_stereotype_ManagerInterface");

  assert.ok(controllerFrame);
  assert.ok(managerFrame);
  assert.ok(Number(controllerFrame.mxGeometry.x) > Number(managerFrame.mxGeometry.x));
}

function exportsOptionalGroupFrames(): void {
  const withoutFrames = runWebPipeline({ source: fixture, groupFrames: false });
  const withFrames = runWebPipeline({ source: fixture, groupFrames: true });

  assert.equal(withoutFrames.xml.includes("group_frame_"), false);
  assert.equal(withFrames.xml.includes("group_frame_"), true);
}

function importsMxGraphXmlIntoEditorState(): void {
  const generated = runWebPipeline({ source: fixture, groupFrames: true });
  const imported = runMxGraphImport(generated.xml);

  assert.equal(imported.layoutView.classes.length, generated.layoutView.classes.length);
  assert.equal(imported.layoutView.edges.length, generated.layoutView.edges.length);
  assert.equal(imported.layoutView.groups.length > 0, true);
}

function exportsMutatedMxGraphState(): void {
  const generated = runWebPipeline({ source: fixture });
  const firstClass = generated.layoutView.classes[0];
  const mutatedGraph = updateCellGeometry(generated.mxGraph, firstClass.id, { x: 999, y: 888 });
  const serialized = serializeMxGraphState(mutatedGraph);
  const updatedClass = serialized.layoutView.classes.find((classCell) => classCell.id === firstClass.id);

  assert.equal(XMLValidator.validate(serialized.xml), true);
  assert.equal(updatedClass?.x, 999);
  assert.equal(updatedClass?.y, 888);
}

function parseXml(xml: string): any {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false
  }).parse(xml);
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
