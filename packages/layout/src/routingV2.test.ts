import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import {
  createDefaultLayoutEngineRegistry,
  createInitialCoordinateRoutingLayoutV3,
  createStereotypeLayoutIntent,
  MemoryLayoutLogger,
  normalizeLayoutInput,
  resolveLayoutEngineOptions,
  type CoordinateRoutingLayoutV3
} from "./index.js";
import type { LayoutRunContext } from "./engine/LayoutEngine.js";

export function runRoutingV2Tests(): void {
  runRoutingV2Slice1Tests();
  runRoutingV2Slice2Tests();
  runRoutingV2Slice3Tests();
  runRoutingV2Slice4ATests();
  runRoutingV2Slice4BTests();
}

export function runRoutingV2Slice1Tests(): void {
  registryRejectsUnknownEngine();
}

export function runRoutingV2Slice2Tests(): void {
  acceptsCleanCoordinateRoutingV3WithoutWarning();
  convertsStereotypeGridV1WithWarnings();
  warnsForMissingAndInvalidNodeOrder();
}

export function runRoutingV2Slice3Tests(): void {
  routeOnlyPreservesGroupCoordinates();
  routeOnlyRespectsLockedPacking();
  routeOnlyRespectsNodeOrder();
  templateOnlyDoesNotPlanDividers();
  hardValidationErrorsAppearInReport();
}

export function runRoutingV2Slice4ATests(): void {
  fanOutDividerIsOptInStrategyBehavior();
  fanInDividerIsOptInStrategyBehavior();
  independentEdgesAreNotBundled();
}

export function runRoutingV2Slice4BTests(): void {
  outerLaneAvoidsBlockedNodeWhenStrategyEnabled();
  outerLaneRepairEmitsStructuredLogs();
}

function registryRejectsUnknownEngine(): void {
  const registry = createDefaultLayoutEngineRegistry();
  assert.throws(() => registry.get("missing-engine" as never), /Unknown layout engine/);
}

function acceptsCleanCoordinateRoutingV3WithoutWarning(): void {
  const parsed = parseBasicFixture();
  const layout = readJsonFixture("coordinate-routing-v3.basic.json") as CoordinateRoutingLayoutV3;
  const logger = new MemoryLayoutLogger();
  const result = normalizeLayoutInput(layout, parsed, createContext(logger));

  assert.equal(result.sourceFormat, "coordinate-routing-v3");
  assert.equal(result.warnings.length, 0);
  assert.equal(logger.events.filter((event) => event.level === "warn").length, 0);
}

function convertsStereotypeGridV1WithWarnings(): void {
  const parsed = parseBasicFixture();
  const layout = readJsonFixture("stereotype-grid-v1.compact-grid.json");
  const logger = new MemoryLayoutLogger();
  const result = normalizeLayoutInput(layout, parsed, createContext(logger));

  assert.equal(result.sourceFormat, "stereotype-grid-v1");
  assert.equal(result.intent.version, 3);
  assert.ok(result.warnings.some((event) => event.type === "layout-format-converted"));
  assert.ok(result.warnings.some((event) => event.type === "deprecated-packing-converted"));
}

function warnsForMissingAndInvalidNodeOrder(): void {
  const parsed = parseBasicFixture();
  const layout = readJsonFixture("coordinate-routing-v3.basic.json") as CoordinateRoutingLayoutV3;
  const controller = layout.groups.find((group) => group.label === "Controller");
  assert.ok(controller);
  controller.nodeOrder = ["AppController", "AppController", "MissingController"];
  const model = layout.groups.find((group) => group.label === "Model");
  assert.ok(model);
  delete (model as Partial<typeof model>).nodeOrder;
  const logger = new MemoryLayoutLogger();
  const result = normalizeLayoutInput(layout, parsed, createContext(logger));

  assert.ok(result.warnings.some((event) => event.type === "duplicate-node-removed"));
  assert.ok(result.warnings.some((event) => event.type === "unknown-node-removed"));
  assert.ok(result.warnings.some((event) => event.type === "missing-node-order-generated"));
}

function routeOnlyPreservesGroupCoordinates(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Model>> AppModel",
    "AppController --> AppModel : uses"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 25, y: 50 });
  setGroup(layout, "Model", { x: 650, y: 90 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout
  });
  const controller = result.document.groups?.find((group) => group.label === "Controller");
  const model = result.document.groups?.find((group) => group.label === "Model");

  assert.equal(controller?.layout?.x, 25);
  assert.equal(controller?.layout?.y, 50);
  assert.equal(model?.layout?.x, 650);
  assert.equal(model?.layout?.y, 90);
  assert.equal(result.document.layout?.engine, "manual-routing-v2");
}

function routeOnlyRespectsLockedPacking(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> FirstController",
    "<<Controller>> SecondController",
    "<<Model>> AppModel",
    "FirstController --> AppModel : first"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const controller = layout.groups.find((group) => group.label === "Controller");
  assert.ok(controller);
  controller.packing = "horizontal";
  controller.packingLocked = true;
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout
  });
  const first = result.document.nodes.find((node) => node.id === "FirstController");
  const second = result.document.nodes.find((node) => node.id === "SecondController");

  assert.ok(first?.layout);
  assert.ok(second?.layout);
  assert.equal(first.layout.y, second.layout.y);
  assert.ok(second.layout.x > first.layout.x);
}

function routeOnlyRespectsNodeOrder(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> FirstController",
    "<<Controller>> SecondController",
    "<<Model>> AppModel",
    "FirstController --> AppModel : first",
    "SecondController --> AppModel : second"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const controller = layout.groups.find((group) => group.label === "Controller");
  assert.ok(controller);
  controller.nodeOrder = ["SecondController", "FirstController"];
  controller.nodeOrderLocked = true;
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout
  });
  const routedController = result.document.groups?.find((group) => group.label === "Controller");

  assert.deepEqual(routedController?.nodeIds, ["SecondController", "FirstController"]);
}

function templateOnlyDoesNotPlanDividers(): void {
  const parsed = parseMermaidClassDiagram(readTextFixture("fan-out-divider.mmd"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { traceRouting: true }
  });

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), false);
}

function hardValidationErrorsAppearInReport(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Helper>> BlockingHelper",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : blocked"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Helper", { x: 310, y: 0 });
  setGroup(layout, "Model", { x: 620, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { traceRouting: true }
  });

  assert.ok(result.report.errors.some((event) => event.type === "edge-node-hit"));
}

function fanOutDividerIsOptInStrategyBehavior(): void {
  const parsed = parseMermaidClassDiagram(readTextFixture("fan-out-divider.mmd"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(result.document.routingDividers?.[0]?.mode, "fanOut");
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), true);
}

function fanInDividerIsOptInStrategyBehavior(): void {
  const parsed = parseMermaidClassDiagram(readTextFixture("fan-in-divider.mmd"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(result.document.routingDividers?.[0]?.mode, "fanIn");
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), true);
}

function independentEdgesAreNotBundled(): void {
  const parsed = parseMermaidClassDiagram(readTextFixture("independent-edges-no-bundle.mmd"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", dividerThreshold: 2, traceRouting: true }
  });

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), false);
}

function outerLaneAvoidsBlockedNodeWhenStrategyEnabled(): void {
  const parsed = parseBlockedLaneFixture();
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Helper", { x: 310, y: 0 });
  setGroup(layout, "Model", { x: 620, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assert.equal(result.report.trace?.some((event) => event.type === "outer-lane-used"), true);
  assert.equal(result.report.errors.some((event) => event.type === "edge-node-hit"), false);
}

function outerLaneRepairEmitsStructuredLogs(): void {
  const parsed = parseBlockedLaneFixture();
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Helper", { x: 310, y: 0 });
  setGroup(layout, "Model", { x: 620, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", maxRepairPasses: 1, traceRouting: true }
  });

  assert.equal(result.report.trace?.some((event) => event.phase === "repair" && event.type.startsWith("route-repair-")), true);
}

function createContext(logger: MemoryLayoutLogger): LayoutRunContext {
  return {
    logger,
    options: resolveLayoutEngineOptions()
  };
}

function setGroup(layout: CoordinateRoutingLayoutV3, label: string, patch: { x: number; y: number }): void {
  const group = layout.groups.find((candidate) => candidate.label === label);
  assert.ok(group, `Expected ${label} group to exist.`);
  group.x = patch.x;
  group.y = patch.y;
}

function parseBasicFixture(): ReturnType<typeof parseMermaidClassDiagram> {
  return parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Model>> AppModel",
    "AppController --> AppModel : uses"
  ].join("\n"));
}

function parseBlockedLaneFixture(): ReturnType<typeof parseMermaidClassDiagram> {
  return parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Helper>> BlockingHelper",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : blocked"
  ].join("\n"));
}

function readJsonFixture(name: string): unknown {
  return JSON.parse(readTextFixture(name)) as unknown;
}

function readTextFixture(name: string): string {
  return readFileSync(`tests/fixtures/routing-v2/${name}`, "utf8");
}
