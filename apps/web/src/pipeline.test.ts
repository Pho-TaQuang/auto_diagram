import assert from "node:assert/strict";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { updateCellGeometry } from "../../../packages/drawio/src/index.js";
import type { CoordinateRoutingLayoutV3 } from "../../../packages/layout/src/index.js";
import { readWebPipelineMetadata, runMxGraphImport, runWebPipeline, serializeMxGraphState } from "./pipeline.js";

const fixture = [
  "classDiagram",
  "<<Controller>> FirstController",
  "<<Controller>> SecondController",
  "<<Manager>> AppManager",
  "<<Model>> AppModel",
  "FirstController --> AppManager : first",
  "SecondController --> AppModel : second",
  "AppManager --> AppModel : output"
].join("\n");

export function runWebPipelineTests(): void {
  generatesDrawioXmlFromMermaid();
  exposesSelectedAutoLayoutIntent();
  supportsSuggestInitialV2Adapter();
  appliesEditableCoordinateLayoutIntent();
  preservesManualV2PackingRoundTrip();
  preservesManualV2LayersForCliExport();
  exportsOptionalGroupFrames();
  importsMxGraphXmlIntoEditorState();
  exportsMutatedMxGraphState();
}

function generatesDrawioXmlFromMermaid(): void {
  const result = runWebPipeline({ source: fixture });
  const intent = asCoordinateIntent(result.intent);

  assert.equal(result.parsed.nodes.length, 4);
  assert.equal(result.diagram.edges.length, 3);
  assert.equal(intent.version, 3);
  assert.equal(intent.layoutMode, "coordinate-routing");
  assert.equal(result.diagram.layout?.engine, "auto-arrange-v2");
  assert.ok((result.diagram.layout?.candidatesEvaluated ?? 0) > 0);
  assert.ok((result.diagram.layout?.selectedCandidateId ?? "").length > 0);
  assert.equal(result.diagram.layout?.score.edgeNodeHits, 0);
  assert.equal(result.layoutView.classes.length, 4);
  assert.equal(result.layoutView.edges.length, 3);
  assert.equal(XMLValidator.validate(result.xml), true);
  assert.ok(result.xml.includes("<mxGraphModel"));
}

function exposesSelectedAutoLayoutIntent(): void {
  const base = runWebPipeline({ source: fixture });
  const rerun = runWebPipeline({ source: fixture, intent: base.intent });
  const baseIntent = asCoordinateIntent(base.intent);
  const rerunIntent = asCoordinateIntent(rerun.intent);

  assert.equal(rerun.diagram.layout?.score.edgeNodeHits, 0);
  assert.deepEqual(
    baseIntent.groups.map((group) => [group.id, group.x, group.y, group.packing]),
    rerunIntent.groups.map((group) => [group.id, group.x, group.y, group.packing])
  );
}

function supportsSuggestInitialV2Adapter(): void {
  const result = runWebPipeline({ source: fixture, engineId: "suggest-initial-v2" });

  assert.equal(result.diagram.layout?.engine, "suggest-initial-v2");
  assert.equal(asCoordinateIntent(result.intent).version, 3);
  assert.equal(XMLValidator.validate(result.xml), true);
}

function appliesEditableCoordinateLayoutIntent(): void {
  const metadata = readWebPipelineMetadata({ source: fixture, engineId: "manual-routing-v2" });
  const intent = cloneCoordinateIntent(asCoordinateIntent(metadata.intent));
  const controller = intent.groups.find((group) => group.label === "Controller");
  const model = intent.groups.find((group) => group.label === "Model");

  assert.ok(controller);
  assert.ok(model);

  controller.x = 600;
  model.x = 0;

  const result = runWebPipeline({ source: fixture, engineId: "manual-routing-v2", intent, groupFrames: true });
  const cells = asArray(parseXml(result.xml).mxGraphModel.root.mxCell);
  const controllerFrame = cells.find((cell) => cell.value === "Controller");
  const modelFrame = cells.find((cell) => cell.value === "Model");

  assert.ok(controllerFrame);
  assert.ok(modelFrame);
  assert.ok(Number(controllerFrame.mxGeometry.x) > Number(modelFrame.mxGeometry.x));
}

function preservesManualV2PackingRoundTrip(): void {
  const metadata = readWebPipelineMetadata({ source: fixture, engineId: "manual-routing-v2" });
  const intent = cloneCoordinateIntent(asCoordinateIntent(metadata.intent));
  const controller = intent.groups.find((group) => group.label === "Controller");

  assert.ok(controller);
  controller.packing = "horizontal";

  const result = runWebPipeline({ source: fixture, engineId: "manual-routing-v2", intent });
  const outputController = asCoordinateIntent(result.intent).groups.find((group) => group.label === "Controller");

  assert.equal(outputController?.packing, "horizontal");
}

function preservesManualV2LayersForCliExport(): void {
  const metadata = readWebPipelineMetadata({ source: fixture, engineId: "manual-routing-v2" });
  const intent = cloneCoordinateIntent(asCoordinateIntent(metadata.intent));
  const controller = intent.groups.find((group) => group.label === "Controller");
  const manager = intent.groups.find((group) => group.label === "Manager");
  const model = intent.groups.find((group) => group.label === "Model");

  assert.ok(controller);
  assert.ok(manager);
  assert.ok(model);

  controller.x = 9999;
  manager.x = 9999;
  model.x = 9999;
  controller.packing = "horizontal";
  intent.layers = [
    { id: "layer_flow", label: "Flow", groupIds: [controller.id, manager.id] },
    { id: "layer_model", label: "Model", groupIds: [model.id] }
  ];

  const result = runWebPipeline({ source: fixture, engineId: "manual-routing-v2", intent });
  const outputIntent = asCoordinateIntent(result.intent);
  const outputController = outputIntent.groups.find((group) => group.id === controller.id);

  assert.deepEqual(outputIntent.layers, intent.layers);
  assert.equal(outputController?.packing, "horizontal");
  assert.notEqual(outputController?.x, 9999);
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

function asCoordinateIntent(intent: unknown): CoordinateRoutingLayoutV3 {
  assert.ok(isCoordinateIntent(intent));
  return intent;
}

function isCoordinateIntent(intent: unknown): intent is CoordinateRoutingLayoutV3 {
  return typeof intent === "object" &&
    intent !== null &&
    "version" in intent &&
    (intent as { version?: unknown }).version === 3 &&
    "layoutMode" in intent &&
    (intent as { layoutMode?: unknown }).layoutMode === "coordinate-routing";
}

function cloneCoordinateIntent(intent: CoordinateRoutingLayoutV3): CoordinateRoutingLayoutV3 {
  return JSON.parse(JSON.stringify(intent)) as CoordinateRoutingLayoutV3;
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
