import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import {
  createDefaultLayoutEngineRegistry,
  createInitialCoordinateRoutingLayoutV3,
  coordinateRoutingLayerLayoutDefaults,
  createStereotypeLayoutIntent,
  MemoryLayoutLogger,
  normalizeLayoutInput,
  resolveLayoutEngineOptions,
  validateRoutedDocument,
  type CoordinateRoutingLayoutV3,
  type LayoutEngineResult,
  type LayoutEngineOptions
} from "./index.js";
import type { LayoutRunContext } from "./engine/LayoutEngine.js";
import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramPoint,
  DiagramRoutingDivider,
  DiagramRoutedEdgeSegment
} from "../../core/src/index.js";
import { __testSelectBendReductionCandidate, __testSelectRouteCompactionCandidate } from "./routing/templateRouter.js";
import { OrthogonalRoutingIndex } from "./routing/routingIndex.js";

export function runRoutingV2Tests(): void {
  runRoutingV2Slice1Tests();
  runRoutingV2Slice2Tests();
  runRoutingV2Slice3Tests();
  runRoutingV2Slice4ATests();
  runRoutingV2Slice4BTests();
  runRoutingV2Slice5ATests();
  runRoutingV2Slice5BTests();
}

export function runRoutingV2Slice1Tests(): void {
  registryRejectsUnknownEngine();
}

export function runRoutingV2Slice2Tests(): void {
  acceptsCleanCoordinateRoutingV3WithoutWarning();
  convertsStereotypeGridV1WithWarnings();
  warnsForMissingAndInvalidNodeOrder();
  layerJsonRunsThroughManualRoutingV2();
  layerPlacementReplacesStaleCoordinatesAndCentersRows();
  mixedPackingAffectsMeasuredLayerWidth();
  duplicateLayerAssignmentIsRejected();
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
  routingSummaryReportsHardValidationStatus();
  validationEventsAreLoggedBeforeRouteComplete();
}

export function runRoutingV2Slice5ATests(): void {
  sameSourceWithoutDividerCannotShareSegments();
  sameTargetWithoutDividerCannotShareSegments();
  fanOutMoreThanFourUsesDivider();
  fanOutDividerUsesStraightSpokes();
  fanInMoreThanFourUsesDivider();
  fanInDividerUsesStraightSpokes();
  blockedStraightSpokeFallsBackToConstrainedRoute();
  fanOutAtOrBelowThresholdDoesNotUseDividerOrShareSegments();
  fanInAtOrBelowThresholdDoesNotUseDividerOrShareSegments();
  duplicatedDividerTrunkSegmentsAreIllegalOverlaps();
  dividerPlanningBucketsByRemoteGroup();
  twoFanOutHubsSameRemoteGroupUseOppositeSides();
  secondDividerSideIsOppositeFirstDividerWhenCommonNodesAreOpposite();
  dividerSideFollowsCommonNodeGeometry();
  dividerSideOverflowEmitsDiagnostic();
  dividerIsRoutedAsObstacle();
  endpointDividerInteriorHitIsHardFailure();
  gapBetweenRoutingStaysInsideCleanGap();
  dividerPhysicalSegmentsAreOrdered();
  nodeHitIsHardFailure();
  invalidDividerIsHardFailure();
  crossingOnlyIsSoftWarning();
  terminalStubsMoveOutsideNodes();
  privateOffsetsAvoidSegmentOverlap();
  cleanCandidatePreferredOverDirtyCandidate();
  recoveryAvoidsFormerBestEffortFallback();
  routeCompactionRunsBelowTwoBends();
  routeCompactionReducesWaypointsWithoutBendReduction();
  bendReductionCollapsesCleanZRoute();
  bendReductionRejectsNodeHit();
  bendReductionRejectsIllegalOverlap();
  bendReductionRejectsCrossingIncrease();
  bendReductionRejectsNonMonotonicDividerSpoke();
  routingIndexMatchesBruteForceForOrthogonalSegments();
  routingIndexIgnoresZeroLengthSegmentsAndEndpointTouches();
}

export function runRoutingV2Slice5BTests(): void {
  generatedPlacementCandidateEvaluationSkipsDividers();
  generatedDemoFixtureReachesStrictGoldenRoutingTarget();
  lockedDemoFixtureReachesStrictGoldenRoutingTarget();
  renamedGeneratedDemoTopologyAlsoReachesStrictGoldenRoutingTarget();
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

function layerJsonRunsThroughManualRoutingV2(): void {
  const parsed = parseLayerFixture();
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const controller = requireGroupIntent(layout, "Controller");
  const manager = requireGroupIntent(layout, "Manager");
  const model = requireGroupIntent(layout, "Model");
  controller.x = 9999;
  manager.x = 9999;
  model.x = 9999;
  layout.layers = [
    { id: "layer_app", groupIds: [controller.id, manager.id] },
    { id: "layer_model", groupIds: [model.id] }
  ];

  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout
  });
  const routedController = result.document.groups?.find((group) => group.label === "Controller");

  assert.equal(result.document.layout?.engine, "manual-routing-v2");
  assert.ok(routedController?.layout);
  assert.notEqual(routedController.layout.x, 9999);
}

function layerPlacementReplacesStaleCoordinatesAndCentersRows(): void {
  const parsed = parseLayerFixture();
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const controller = requireGroupIntent(layout, "Controller");
  const manager = requireGroupIntent(layout, "Manager");
  const model = requireGroupIntent(layout, "Model");
  controller.x = 9999;
  controller.y = 9999;
  manager.x = 9999;
  manager.y = 9999;
  model.x = 9999;
  model.y = 9999;
  layout.layers = [
    { id: "layer_app", groupIds: [controller.id, manager.id] },
    { id: "layer_model", groupIds: [model.id] }
  ];

  const result = normalizeLayoutInput(layout, parsed, createContext(new MemoryLayoutLogger()));
  const outputController = requireGroupIntent(result.intent, "Controller");
  const outputManager = requireGroupIntent(result.intent, "Manager");
  const outputModel = requireGroupIntent(result.intent, "Model");
  const appLeft = Math.min(outputController.x, outputManager.x);
  const appRight = Math.max(
    outputController.x + (outputController.width ?? 0),
    outputManager.x + (outputManager.width ?? 0)
  );
  const appCenter = (appLeft + appRight) / 2;
  const modelCenter = outputModel.x + (outputModel.width ?? 0) / 2;

  assert.notEqual(outputController.x, 9999);
  assert.equal(outputController.y, outputManager.y);
  assert.ok(outputModel.y > outputController.y);
  assert.ok(Math.abs(appCenter - modelCenter) < 0.001);
}

function mixedPackingAffectsMeasuredLayerWidth(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Model>> FirstModel",
    "<<Model>> SecondModel",
    "FirstModel --> SecondModel : ref"
  ].join("\n"));
  const verticalLayout = createInitialCoordinateRoutingLayoutV3(parsed);
  const verticalModel = requireGroupIntent(verticalLayout, "Model");
  verticalModel.packing = "vertical";
  verticalLayout.layers = [{ id: "layer_model", groupIds: [verticalModel.id] }];

  const horizontalLayout = JSON.parse(JSON.stringify(verticalLayout)) as CoordinateRoutingLayoutV3;
  const horizontalModel = requireGroupIntent(horizontalLayout, "Model");
  horizontalModel.packing = "horizontal";

  const vertical = normalizeLayoutInput(verticalLayout, parsed, createContext(new MemoryLayoutLogger()));
  const horizontal = normalizeLayoutInput(horizontalLayout, parsed, createContext(new MemoryLayoutLogger()));
  const verticalWidth = requireGroupIntent(vertical.intent, "Model").width ?? 0;
  const horizontalWidth = requireGroupIntent(horizontal.intent, "Model").width ?? 0;

  assert.ok(horizontalWidth > verticalWidth);
  assert.ok(horizontalWidth > coordinateRoutingLayerLayoutDefaults.groupGapX);
}

function duplicateLayerAssignmentIsRejected(): void {
  const parsed = parseLayerFixture();
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const controller = requireGroupIntent(layout, "Controller");
  const manager = requireGroupIntent(layout, "Manager");
  layout.layers = [
    { id: "layer_one", groupIds: [controller.id] },
    { id: "layer_two", groupIds: [manager.id, controller.id] }
  ];

  assert.throws(
    () => normalizeLayoutInput(layout, parsed, createContext(new MemoryLayoutLogger())),
    /assign group .* more than once/
  );
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
  const document = routedNodeHitDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.ok(logger.events.some((event) => event.type === "edge-node-hit"));
  assert.equal(result.valid, false);
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

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), false);
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

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), false);
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

  assert.equal(result.report.errors.some((event) => event.type === "edge-node-hit"), false);
  assert.equal(result.report.trace?.some((event) => event.type === "routing-fallback-used"), false);
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

function routingSummaryReportsHardValidationStatus(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : ok"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 650, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assert.equal(result.report.routingSummary?.routeStrategy, "template-with-outer-lanes");
  assert.equal(result.report.routingSummary?.hardValid, true);
  assert.equal(result.report.routingSummary?.totalEdges, 1);
  assert.equal(result.report.routingSummary?.validEdges, 1);
  assert.equal(result.report.routingSummary?.invalidEdges, 0);
  assert.equal(result.report.routingSummary?.edgeNodeHits, 0);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
  assert.equal(result.document.layout?.score.illegalSegmentOverlaps, 0);
  assert.ok(Array.isArray(result.report.diagnostics));
  assert.ok(Array.isArray(result.report.edgeValidations));
  assert.ok(Array.isArray(result.document.layout?.diagnostics));
}

function validationEventsAreLoggedBeforeRouteComplete(): void {
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
  const traceTypes = result.report.trace?.map((event) => event.type) ?? [];

  assert.ok(indexOf(traceTypes, "route-strategy-selected") < indexOf(traceTypes, "route-candidates-generated"));
  assert.ok(indexOf(traceTypes, "route-candidates-generated") < indexOf(traceTypes, "repair-complete"));
  assert.ok(indexOf(traceTypes, "repair-complete") < indexOf(traceTypes, "route-validation-passed", "route-validation-failed"));
  assert.ok(indexOf(traceTypes, "route-validation-passed", "route-validation-failed") < indexOf(traceTypes, "route-complete"));
}

function sameSourceWithoutDividerCannotShareSegments(): void {
  const document = routedOverlapDocument("same-source-shared", "same-source");
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.ok(result.illegalSegmentOverlaps > 0);
  assert.equal(result.valid, false);
  assert.ok(logger.events.some((event) => event.type === "illegal-segment-overlap"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.type === "layout-change-required" && diagnostic.reason === "illegal-segment-overlap"));
}

function sameTargetWithoutDividerCannotShareSegments(): void {
  const document = routedOverlapDocument("same-target-shared", "same-target");
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.ok(result.illegalSegmentOverlaps > 0);
  assert.equal(result.valid, false);
}

function fanOutMoreThanFourUsesDivider(): void {
  const result = runManualV2(fanOutFixture(5), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(result.document.routingDividers?.[0]?.mode, "fanOut");
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), true);
  assertDividerConnectorGraph(result.document);
  assert.equal(result.report.routingSummary?.edgeNodeHits, 0);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
}

function fanOutDividerUsesStraightSpokes(): void {
  const parsed = parseMermaidClassDiagram(fanOutFixture(5));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 900, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assertStraightDividerSpokes(result.document, "fanOut");
}

function fanInMoreThanFourUsesDivider(): void {
  const result = runManualV2(fanInFixture(5), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(result.document.routingDividers?.[0]?.mode, "fanIn");
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), true);
  assertDividerConnectorGraph(result.document);
  assert.equal(result.report.routingSummary?.edgeNodeHits, 0);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
}

function fanInDividerUsesStraightSpokes(): void {
  const parsed = parseMermaidClassDiagram(fanInFixture(5));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 900, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assertStraightDividerSpokes(result.document, "fanIn");
}

function blockedStraightSpokeFallsBackToConstrainedRoute(): void {
  const parsed = parseMermaidClassDiagram(fanOutFixture(5));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const model = layout.groups.find((group) => group.label === "Model");
  assert.ok(model);
  model.packing = "horizontal";
  model.packingLocked = true;
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 900, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const divider = result.document.routingDividers?.find((candidate) => candidate.mode === "fanOut");
  assert.ok(divider);
  const spokes = dividerSpokeSegments(result.document, divider);

  assert.equal(result.report.routingSummary?.hardValid, true);
  assert.equal(result.report.routingSummary?.edgeNodeHits, 0);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
  assert.ok(spokes.some((spoke) => spoke.waypoints.length > 0), "Expected at least one blocked straight spoke to fall back.");
}

function fanOutAtOrBelowThresholdDoesNotUseDividerOrShareSegments(): void {
  const result = runManualV2(readTextFixture("fan-out-divider.mmd"), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
}

function fanInAtOrBelowThresholdDoesNotUseDividerOrShareSegments(): void {
  const result = runManualV2(readTextFixture("fan-in-divider.mmd"), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
}

function duplicatedDividerTrunkSegmentsAreIllegalOverlaps(): void {
  const document = duplicatedDividerTrunkDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.ok(result.segmentOverlaps > 0);
  assert.equal(result.illegalSegmentOverlaps, result.segmentOverlaps);
  assert.equal(result.valid, false);
}

function dividerPlanningBucketsByRemoteGroup(): void {
  const result = runManualV2(fanOutTwoRemoteGroupsFixture(), { routeStrategy: "template-with-outer-lanes", traceRouting: true });
  const dividers = result.document.routingDividers ?? [];

  assert.equal(dividers.length, 2);
  assert.deepEqual(
    dividers.map((divider) => divider.remoteGroupId).sort(),
    ["group_stereotype_Entity", "group_stereotype_Model"]
  );
  assert.ok(dividers.every((divider) => divider.sourceEdgeIds.length === 5));
}

function twoFanOutHubsSameRemoteGroupUseOppositeSides(): void {
  const result = runManualV2(twoFanOutHubsSameRemoteGroupFixture(), { routeStrategy: "template-with-outer-lanes", traceRouting: true });
  const dividers = result.document.routingDividers ?? [];

  assert.equal(dividers.length, 2);
  assert.equal(dividers[0].remoteGroupId, "group_stereotype_Model");
  assert.equal(dividers[1].remoteGroupId, "group_stereotype_Model");
  assert.equal(dividers[0].sideSlot, 0);
  assert.equal(dividers[1].sideSlot, 1);
  assert.equal(dividers[1].side, oppositeSide(dividers[0].side));
  assert.equal(result.report.routingSummary?.routingFailures, 0);
}

function secondDividerSideIsOppositeFirstDividerWhenCommonNodesAreOpposite(): void {
  const parsed = parseMermaidClassDiagram(oppositeFanOutHubsSameRemoteGroupFixture());
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 900, y: 0 });
  setGroup(layout, "Manager", { x: 1800, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const dividers = result.document.routingDividers ?? [];

  assert.equal(dividers.length, 2);
  assert.equal(dividers[0].commonNodeId, "RightManager");
  assert.equal(dividers[0].side, "east");
  assert.equal(dividers[1].commonNodeId, "LeftController");
  assert.equal(dividers[1].side, "west");
  assert.equal(dividers[1].side, oppositeSide(dividers[0].side));
}

function dividerSideFollowsCommonNodeGeometry(): void {
  const parsed = parseMermaidClassDiagram(fanOutFixture(5));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const model = layout.groups.find((group) => group.label === "Model");
  assert.ok(model);
  model.packing = "horizontal";
  model.packingLocked = true;
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 900, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const divider = result.document.routingDividers?.[0];

  assert.ok(divider);
  assert.equal(divider.side, "west");
  assert.equal(divider.orientation, "vertical");
}

function dividerSideOverflowEmitsDiagnostic(): void {
  const result = runManualV2(threeFanOutHubsSameRemoteGroupFixture(), { routeStrategy: "template-with-outer-lanes", traceRouting: true });
  const dividers = result.document.routingDividers ?? [];

  assert.equal(dividers.length, 3);
  assert.equal(dividers[2].sideSlot, 2);
  assert.ok((dividers[2].sideOffset ?? 0) > 0);
  assert.ok(result.report.warnings.some((event) => event.type === "divider-side-overflow"));
  assert.equal(result.report.routingSummary?.dividerSideOverflow, 1);
  assert.equal(result.report.routingSummary?.routingFailures, 0);
  assert.ok(result.report.diagnostics.some((diagnostic) => diagnostic.reason === "divider-side-overflow"));
}

function dividerIsRoutedAsObstacle(): void {
  const document = dividerObstacleHitDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.equal(result.valid, false);
  assert.ok(result.dividerNodeHits > 0);
  assert.ok(logger.events.some((event) => event.type === "divider-node-hit"));
}

function endpointDividerInteriorHitIsHardFailure(): void {
  const document = endpointDividerInteriorHitDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.equal(result.valid, false);
  assert.ok(result.endpointDividerInteriorHits > 0);
  assert.ok(logger.events.some((event) => event.type === "endpoint-divider-interior-hit"));
}

function gapBetweenRoutingStaysInsideCleanGap(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : ok"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  setGroup(layout, "Controller", { x: 0, y: 0 });
  setGroup(layout, "Model", { x: 500, y: 0 });
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const edge = result.document.edges[0];
  const source = result.document.nodes.find((node) => node.id === edge.sourceId);
  const target = result.document.nodes.find((node) => node.id === edge.targetId);
  const waypoints = edge.layout?.routedSegments?.[0]?.waypoints ?? [];

  assert.ok(source?.layout);
  assert.ok(target?.layout);
  assert.equal(result.report.routingSummary?.hardValid, true);
  assert.ok(waypoints.every((point) => point.x > source.layout!.x + source.layout!.width && point.x < target.layout!.x));
  assert.equal(result.report.trace?.some((event) => event.type === "outer-lane-used"), false);
}

function dividerPhysicalSegmentsAreOrdered(): void {
  const result = runManualV2(fanInFixture(5), { routeStrategy: "template-with-outer-lanes", traceRouting: true });
  const firstDividerEdge = result.document.edges.find((edge) => (edge.layout?.routedSegments ?? []).some((segment) => segment.id.endsWith(":divider-trunk")));
  const routedSegments = firstDividerEdge?.layout?.routedSegments ?? [];

  assert.ok(firstDividerEdge);
  assert.ok(routedSegments.length > 1);
  assert.ok(routedSegments[0].id.endsWith(":divider-trunk"));
  assert.ok(routedSegments.some((segment) => segment.id.endsWith(":divider-spoke")));
}

function assertDividerConnectorGraph(document: DiagramDocument): void {
  const dividers = document.routingDividers ?? [];
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));

  for (const divider of dividers) {
    const ownerEdges = divider.sourceEdgeIds.map((edgeId) => {
      const edge = edgeById.get(edgeId);
      assert.ok(edge, `Expected divider owner edge ${edgeId} to exist.`);
      return edge;
    });
    const ownerSegments = ownerEdges.flatMap((edge) => edge.layout?.routedSegments ?? []);
    const trunks = ownerSegments.filter((segment) => segment.id.endsWith(":divider-trunk"));
    const spokes = ownerSegments.filter((segment) => segment.id.endsWith(":divider-spoke"));

    assert.equal(trunks.length, 1, `Expected divider ${divider.id} to have one physical trunk.`);
    assert.equal(spokes.length, divider.sourceEdgeIds.length, `Expected divider ${divider.id} to have one physical spoke per semantic edge.`);

    for (const edge of ownerEdges) {
      assert.ok((edge.layout?.routedSegments ?? []).some((segment) => segment.id.endsWith(":divider-spoke")));
      assert.equal(edge.layout?.sourceAnchor, undefined);
      assert.equal(edge.layout?.targetAnchor, undefined);
      assert.equal((edge.layout?.waypoints ?? []).length, 0);
    }

    assertDividerTrunkConstraints(divider, trunks[0]);
    for (const spoke of spokes) {
      assertDividerSpokeConstraints(document, divider, spoke);
    }
  }
}

function assertStraightDividerSpokes(document: DiagramDocument, mode: DiagramRoutingDivider["mode"]): void {
  const divider = document.routingDividers?.find((candidate) => candidate.mode === mode);
  assert.ok(divider, `Expected ${mode} divider.`);
  const spokes = dividerSpokeSegments(document, divider);

  assert.equal(spokes.length, divider.sourceEdgeIds.length);
  for (const spoke of spokes) {
    assert.equal(spoke.strategy, "divider");
    assert.equal(spoke.waypoints.length, 0, `${spoke.id} should be a straight spoke.`);
    assert.equal(countBends(routedSegmentPoints(document, divider, spoke)), 0, `${spoke.id} should not bend.`);
  }
}

function dividerSpokeSegments(document: DiagramDocument, divider: DiagramRoutingDivider): DiagramRoutedEdgeSegment[] {
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  return divider.sourceEdgeIds.flatMap((edgeId) =>
    edgeById.get(edgeId)?.layout?.routedSegments?.filter((segment) => segment.id.endsWith(":divider-spoke")) ?? []
  );
}

function assertDividerTrunkConstraints(divider: DiagramRoutingDivider, trunk: DiagramRoutedEdgeSegment): void {
  if (divider.mode === "fanOut") {
    assert.equal(trunk.targetId, divider.id);
    assert.equal(trunk.targetAnchor?.side, divider.side);
    return;
  }

  assert.equal(trunk.sourceId, divider.id);
  assert.equal(trunk.sourceAnchor?.side, divider.side);
}

function assertDividerSpokeConstraints(
  document: DiagramDocument,
  divider: DiagramRoutingDivider,
  spoke: DiagramRoutedEdgeSegment
): void {
  if (divider.mode === "fanOut") {
    assert.equal(spoke.sourceId, divider.id);
    assert.equal(spoke.sourceAnchor?.side, oppositeSide(divider.side));
    assert.equal(spoke.targetAnchor?.side, divider.side);
    assertMonotonicSegmentPath(document, divider, spoke, fanOutSpokeDirection(divider.side));
    return;
  }

  assert.equal(spoke.targetId, divider.id);
  assert.equal(spoke.sourceAnchor?.side, divider.side);
  assert.equal(spoke.targetAnchor?.side, oppositeSide(divider.side));
  assertMonotonicSegmentPath(document, divider, spoke, fanInSpokeDirection(divider.side));
}

function assertMonotonicSegmentPath(
  document: DiagramDocument,
  divider: DiagramRoutingDivider,
  segment: DiagramRoutedEdgeSegment,
  direction: "up" | "down" | "left" | "right"
): void {
  const points = routedSegmentPoints(document, divider, segment);
  for (const [start, end] of pathSegments(points)) {
    if (direction === "down") {
      assert.ok(end.y + 0.001 >= start.y, `${segment.id} should not move upward.`);
    } else if (direction === "up") {
      assert.ok(end.y <= start.y + 0.001, `${segment.id} should not move downward.`);
    } else if (direction === "right") {
      assert.ok(end.x + 0.001 >= start.x, `${segment.id} should not move left.`);
    } else {
      assert.ok(end.x <= start.x + 0.001, `${segment.id} should not move right.`);
    }
  }
}

function routedSegmentPoints(
  document: DiagramDocument,
  divider: DiagramRoutingDivider,
  segment: DiagramRoutedEdgeSegment
): Array<{ x: number; y: number }> {
  assert.ok(segment.sourceAnchor);
  assert.ok(segment.targetAnchor);
  const source = endpointRectangle(document, divider, segment.sourceId);
  const target = endpointRectangle(document, divider, segment.targetId);
  return [
    anchorPoint(source, segment.sourceAnchor),
    ...segment.waypoints,
    anchorPoint(target, segment.targetAnchor)
  ];
}

function endpointRectangle(
  document: DiagramDocument,
  divider: DiagramRoutingDivider,
  id: string
): { x: number; y: number; width: number; height: number } {
  if (id === divider.id) {
    return divider.layout;
  }
  const node = document.nodes.find((candidate) => candidate.id === id);
  assert.ok(node?.layout, `Expected endpoint ${id} to have layout.`);
  return node.layout;
}

function pathSegments(points: Array<{ x: number; y: number }>): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  return points.slice(1).map((point, index) => [points[index], point]);
}

function countBends(points: Array<{ x: number; y: number }>): number {
  const axes = pathSegments(points)
    .map(([start, end]) => start.x === end.x ? "v" : start.y === end.y ? "h" : "d")
    .filter((axis) => axis !== "d");
  let bends = 0;
  for (let index = 1; index < axes.length; index += 1) {
    if (axes[index] !== axes[index - 1]) {
      bends += 1;
    }
  }
  return bends;
}

function pathLength(points: Array<{ x: number; y: number }>): number {
  return pathSegments(points).reduce((total, [start, end]) =>
    total + Math.abs(start.x - end.x) + Math.abs(start.y - end.y), 0);
}

function oppositeSide(side: DiagramEdgeAnchor["side"]): DiagramEdgeAnchor["side"] {
  if (side === "north") {
    return "south";
  }
  if (side === "south") {
    return "north";
  }
  if (side === "west") {
    return "east";
  }
  return "west";
}

function fanOutSpokeDirection(side: DiagramEdgeAnchor["side"]): "up" | "down" | "left" | "right" {
  if (side === "north") {
    return "down";
  }
  if (side === "south") {
    return "up";
  }
  if (side === "west") {
    return "right";
  }
  return "left";
}

function fanInSpokeDirection(side: DiagramEdgeAnchor["side"]): "up" | "down" | "left" | "right" {
  if (side === "north") {
    return "up";
  }
  if (side === "south") {
    return "down";
  }
  if (side === "west") {
    return "left";
  }
  return "right";
}

function nodeHitIsHardFailure(): void {
  const document = routedNodeHitDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.equal(result.valid, false);
  assert.ok(result.edgeNodeHits > 0);
}

function invalidDividerIsHardFailure(): void {
  const document = duplicatedDividerTrunkDocument(true);
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.ok(result.invalidDividers > 0);
  assert.equal(result.valid, false);
}

function crossingOnlyIsSoftWarning(): void {
  const document = crossingOnlyDocument();
  const logger = new MemoryLayoutLogger();
  const result = validateRoutedDocument(document, document, createContext(logger));

  assert.equal(result.valid, true);
  assert.ok(result.edgeCrossings > 0);
  assert.equal(result.illegalSegmentOverlaps, 0);
  assert.ok(logger.events.some((event) => event.type === "edge-crossing" && event.level === "warn"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.type === "edge-crossing" && diagnostic.severity === "warning"));
}

function terminalStubsMoveOutsideNodes(): void {
  const result = runManualV2([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : ok"
  ].join("\n"), { routeStrategy: "template-with-outer-lanes" });
  const edge = result.document.edges[0];
  assert.ok(edge.layout?.sourceAnchor);
  assert.ok(edge.layout.routedSegments?.[0]);
  const source = result.document.nodes.find((node) => node.id === edge.sourceId);
  const target = result.document.nodes.find((node) => node.id === edge.targetId);
  assert.ok(source?.layout);
  assert.ok(target?.layout);
  assert.ok(edge.layout.routedSegments[0].targetAnchor);
  const anchor = anchorPoint(source.layout, edge.layout.sourceAnchor);
  const firstSegmentEnd = edge.layout.routedSegments[0].waypoints[0] ??
    anchorPoint(target.layout, edge.layout.routedSegments[0].targetAnchor);

  if (edge.layout.sourceAnchor.side === "east") {
    assert.ok(firstSegmentEnd.x > anchor.x);
  } else if (edge.layout.sourceAnchor.side === "west") {
    assert.ok(firstSegmentEnd.x < anchor.x);
  } else if (edge.layout.sourceAnchor.side === "north") {
    assert.ok(firstSegmentEnd.y < anchor.y);
  } else {
    assert.ok(firstSegmentEnd.y > anchor.y);
  }
}

function privateOffsetsAvoidSegmentOverlap(): void {
  const result = runManualV2(fanOutFixture(4), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers, undefined);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
}

function cleanCandidatePreferredOverDirtyCandidate(): void {
  const result = runManualV2([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Helper>> BlockingHelper",
    "<<Model>> TargetModel",
    "SourceController --> TargetModel : blocked"
  ].join("\n"), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.report.errors.some((event) => event.type === "edge-node-hit"), false);
  assert.equal(result.report.trace?.some((event) => event.type === "routing-fallback-used"), false);
}

function recoveryAvoidsFormerBestEffortFallback(): void {
  const result = runManualV2(fanOutFixture(4), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.ok(result.document.edges.some((edge) => (edge.layout?.routedSegments?.length ?? 0) > 0));
  assert.equal(result.report.trace?.some((event) => event.type === "routing-fallback-used"), false);
  assert.equal(result.report.routingSummary?.hardValid, true);
}

function routeCompactionRunsBelowTwoBends(): void {
  const source = node("A", 0, 0);
  const target = node("B", 160, 100);
  const sourceAnchor: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const targetAnchor: DiagramEdgeAnchor = { side: "north", ratio: 0.5 };
  const edge: DiagramEdge = {
    id: "edge_compact_one_bend",
    sourceId: source.id,
    targetId: target.id,
    kind: "directedAssociation",
    operator: "-->"
  };
  const points: DiagramPoint[] = [
    anchorPoint(source.layout, sourceAnchor),
    { x: 124, y: 20 },
    { x: 200, y: 20 },
    { x: 200, y: 76 },
    anchorPoint(target.layout, targetAnchor)
  ];
  const selected = __testSelectRouteCompactionCandidate({
    edge,
    source: { id: source.id, ...source.layout },
    target: { id: target.id, ...target.layout },
    sourceAnchor,
    targetAnchor,
    points,
    routeNodes: [source, target]
  });

  assert.ok(selected);
  assert.equal(countBends(points), 1);
  assert.equal(countBends(selected.points), 1);
  assert.ok(selected.waypoints.length < points.slice(1, -1).length);
}

function routeCompactionReducesWaypointsWithoutBendReduction(): void {
  const source = node("A", 0, 0);
  const target = node("B", 300, 100);
  const sourceAnchor: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const targetAnchor: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const edge: DiagramEdge = {
    id: "edge_compact_same_bends",
    sourceId: source.id,
    targetId: target.id,
    kind: "directedAssociation",
    operator: "-->"
  };
  const points: DiagramPoint[] = [
    anchorPoint(source.layout, sourceAnchor),
    { x: 124, y: 20 },
    { x: 160, y: 20 },
    { x: 200, y: 20 },
    { x: 200, y: 120 },
    { x: 250, y: 120 },
    { x: 276, y: 120 },
    anchorPoint(target.layout, targetAnchor)
  ];
  const selected = __testSelectRouteCompactionCandidate({
    edge,
    source: { id: source.id, ...source.layout },
    target: { id: target.id, ...target.layout },
    sourceAnchor,
    targetAnchor,
    points,
    routeNodes: [source, target]
  });

  assert.ok(selected);
  assert.equal(countBends(selected.points), countBends(points));
  assert.ok(selected.waypoints.length < points.slice(1, -1).length);
  assert.ok(pathLength(selected.points) <= pathLength(points));
}

function bendReductionCollapsesCleanZRoute(): void {
  const fixture = bendReductionFixture();
  const selected = __testSelectBendReductionCandidate(fixture);

  assert.ok(selected);
  assert.ok(countBends(selected.points) < countBends(fixture.points));
  assert.ok(pathLength(selected.points) <= pathLength(fixture.points));
}

function bendReductionRejectsNodeHit(): void {
  const fixture = bendReductionFixture({
    extraNodes: [
      node("block_vh", 90, 150),
      node("block_hv", 260, 100)
    ]
  });

  assert.equal(__testSelectBendReductionCandidate(fixture), undefined);
}

function bendReductionRejectsIllegalOverlap(): void {
  const fixture = bendReductionFixture({
    acceptedPaths: [
      occupancyPath("occ_hv", [{ x: 276, y: 60 }, { x: 276, y: 180 }]),
      occupancyPath("occ_vh", [{ x: 104, y: 150 }, { x: 104, y: 210 }])
    ]
  });

  assert.equal(__testSelectBendReductionCandidate(fixture), undefined);
}

function bendReductionRejectsCrossingIncrease(): void {
  const fixture = bendReductionFixture({
    acceptedPaths: [
      occupancyPath("cross_hv", [{ x: 150, y: 0 }, { x: 150, y: 40 }]),
      occupancyPath("cross_vh", [{ x: 80, y: 160 }, { x: 130, y: 160 }])
    ]
  });

  assert.equal(__testSelectBendReductionCandidate(fixture), undefined);
}

function bendReductionRejectsNonMonotonicDividerSpoke(): void {
  const fixture = bendReductionFixture({
    dividerConstraints: {
      sourceSide: "east",
      targetSide: "west",
      monotonic: "left"
    }
  });

  assert.equal(__testSelectBendReductionCandidate(fixture), undefined);
}

function routingIndexMatchesBruteForceForOrthogonalSegments(): void {
  const acceptedPaths: DiagramPoint[][] = [
    [{ x: 100, y: 50 }, { x: 260, y: 50 }],
    [{ x: 160, y: 0 }, { x: 160, y: 140 }],
    [{ x: 20, y: 120 }, { x: 220, y: 120 }, { x: 220, y: 220 }],
    [{ x: 300, y: 20 }, { x: 300, y: 180 }]
  ];
  const candidates: DiagramPoint[][] = [
    [{ x: 0, y: 50 }, { x: 320, y: 50 }],
    [{ x: 160, y: -40 }, { x: 160, y: 200 }],
    [{ x: 0, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 220 }],
    [{ x: 260, y: 0 }, { x: 260, y: 200 }, { x: 340, y: 200 }]
  ];
  const index = new OrthogonalRoutingIndex();
  acceptedPaths.forEach((points) => index.addPath(points));

  for (const candidate of candidates) {
    assert.equal(index.countIllegalSegmentOverlaps(candidate), bruteSegmentOverlapCount(candidate, acceptedPaths));
    assert.equal(index.countCrossingsWithAccepted(candidate), bruteCrossingCount(candidate, acceptedPaths));
  }
}

function routingIndexIgnoresZeroLengthSegmentsAndEndpointTouches(): void {
  const index = new OrthogonalRoutingIndex();
  const acceptedPaths: DiagramPoint[][] = [
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]
  ];
  acceptedPaths.forEach((points) => index.addPath(points));

  assert.equal(index.countIllegalSegmentOverlaps([{ x: 100, y: 0 }, { x: 200, y: 0 }]), 0);
  assert.equal(index.countCrossingsWithAccepted([{ x: 100, y: 0 }, { x: 100, y: 100 }]), 0);
  assert.equal(index.countIllegalSegmentOverlaps([{ x: 25, y: 0 }, { x: 25, y: 0 }, { x: 75, y: 0 }]), 1);
}

function bruteSegmentOverlapCount(points: DiagramPoint[], acceptedPaths: DiagramPoint[][]): number {
  let overlaps = 0;
  for (const [start, end] of nonZeroPathSegments(points)) {
    for (const accepted of acceptedPaths) {
      for (const [acceptedStart, acceptedEnd] of nonZeroPathSegments(accepted)) {
        if (testSegmentsOverlap(start, end, acceptedStart, acceptedEnd)) {
          overlaps += 1;
        }
      }
    }
  }
  return overlaps;
}

function bruteCrossingCount(points: DiagramPoint[], acceptedPaths: DiagramPoint[][]): number {
  let crossings = 0;
  for (const [start, end] of nonZeroPathSegments(points)) {
    for (const accepted of acceptedPaths) {
      for (const [acceptedStart, acceptedEnd] of nonZeroPathSegments(accepted)) {
        if (
          !testSegmentsOverlap(start, end, acceptedStart, acceptedEnd) &&
          testSegmentsIntersect(start, end, acceptedStart, acceptedEnd) &&
          !testPointsEqual(start, acceptedStart) &&
          !testPointsEqual(start, acceptedEnd) &&
          !testPointsEqual(end, acceptedStart) &&
          !testPointsEqual(end, acceptedEnd)
        ) {
          crossings += 1;
        }
      }
    }
  }
  return crossings;
}

function nonZeroPathSegments(points: DiagramPoint[]): Array<[DiagramPoint, DiagramPoint]> {
  return points.slice(1)
    .map((point, index): [DiagramPoint, DiagramPoint] => [points[index], point])
    .filter(([start, end]) => !testPointsEqual(start, end));
}

function testSegmentsOverlap(leftStart: DiagramPoint, leftEnd: DiagramPoint, rightStart: DiagramPoint, rightEnd: DiagramPoint): boolean {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
    return testRangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }
  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
    return testRangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }
  return false;
}

function testSegmentsIntersect(firstStart: DiagramPoint, firstEnd: DiagramPoint, secondStart: DiagramPoint, secondEnd: DiagramPoint): boolean {
  const firstMinX = Math.min(firstStart.x, firstEnd.x);
  const firstMaxX = Math.max(firstStart.x, firstEnd.x);
  const firstMinY = Math.min(firstStart.y, firstEnd.y);
  const firstMaxY = Math.max(firstStart.y, firstEnd.y);
  const secondMinX = Math.min(secondStart.x, secondEnd.x);
  const secondMaxX = Math.max(secondStart.x, secondEnd.x);
  const secondMinY = Math.min(secondStart.y, secondEnd.y);
  const secondMaxY = Math.max(secondStart.y, secondEnd.y);

  return firstMinX <= secondMaxX &&
    firstMaxX >= secondMinX &&
    firstMinY <= secondMaxY &&
    firstMaxY >= secondMinY &&
    testOrientation(firstStart, firstEnd, secondStart) * testOrientation(firstStart, firstEnd, secondEnd) <= 0 &&
    testOrientation(secondStart, secondEnd, firstStart) * testOrientation(secondStart, secondEnd, firstEnd) <= 0;
}

function testOrientation(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function testRangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return Math.min(a, b) < Math.max(c, d) && Math.max(a, b) > Math.min(c, d);
}

function testPointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function bendReductionFixture(options: {
  extraNodes?: ReturnType<typeof node>[];
  acceptedPaths?: Array<{ edge: DiagramEdge; points: DiagramPoint[] }>;
  dividerConstraints?: {
    sourceSide?: DiagramEdgeAnchor["side"];
    targetSide?: DiagramEdgeAnchor["side"];
    monotonic?: "up" | "down" | "left" | "right";
  };
} = {}) {
  const source = node("A", 0, 0);
  const target = node("B", 300, 200);
  const sourceAnchor: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const targetAnchor: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const edge: DiagramEdge = {
    id: "edge_z",
    sourceId: source.id,
    targetId: target.id,
    kind: "directedAssociation",
    operator: "-->"
  };
  const points: DiagramPoint[] = [
    anchorPoint(source.layout, sourceAnchor),
    { x: 104, y: 20 },
    { x: 104, y: 120 },
    { x: 180, y: 120 },
    { x: 180, y: 220 },
    { x: 276, y: 220 },
    anchorPoint(target.layout, targetAnchor)
  ];

  return {
    edge,
    source: { id: source.id, ...source.layout },
    target: { id: target.id, ...target.layout },
    sourceAnchor,
    targetAnchor,
    points,
    routeNodes: [source, target, ...(options.extraNodes ?? [])],
    acceptedPaths: options.acceptedPaths,
    dividerConstraints: options.dividerConstraints
  };
}

function occupancyPath(id: string, points: DiagramPoint[]): { edge: DiagramEdge; points: DiagramPoint[] } {
  return {
    edge: {
      id,
      sourceId: `${id}_source`,
      targetId: `${id}_target`,
      kind: "directedAssociation",
      operator: "-->"
    },
    points
  };
}

function generatedPlacementCandidateEvaluationSkipsDividers(): void {
  const parsed = parseMermaidClassDiagram(fanOutFixture(5));
  const result = createDefaultLayoutEngineRegistry().get("suggest-initial-v2").run({
    document: parsed,
    mode: "suggest-initial-v2",
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const evaluations = result.report.trace?.filter((event) => event.type === "generated-layout-candidate-evaluated") ?? [];

  assert.ok(evaluations.length > 0);
  assert.ok(evaluations.every((event) => event.data?.dividerCount === 0));
  assert.equal(result.document.routingDividers?.length, 1);
}

function generatedDemoFixtureReachesStrictGoldenRoutingTarget(): void {
  const parsed = parseMermaidClassDiagram(readFileSync("docs/demo_mermaid.md", "utf8"));
  const result = createDefaultLayoutEngineRegistry().get("suggest-initial-v2").run({
    document: parsed,
    mode: "suggest-initial-v2",
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assertStrictGoldenRoutingTarget(result);
  assert.ok(result.report.trace?.some((event) => event.type === "generated-layout-candidate-evaluated"));
  assert.ok(result.report.trace?.some((event) => event.type === "route-order-selected"));
  assert.ok(result.report.trace?.some((event) => event.type === "bend-reduction-accepted"));
}

function lockedDemoFixtureReachesStrictGoldenRoutingTarget(): void {
  const parsed = parseMermaidClassDiagram(readFileSync("docs/demo_mermaid.md", "utf8"));
  const layout = readJsonFixture("demo-mermaid.coordinate-routing-v3.layout.json") as CoordinateRoutingLayoutV3;
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assertStrictGoldenRoutingTarget(result);
}

function renamedGeneratedDemoTopologyAlsoReachesStrictGoldenRoutingTarget(): void {
  const parsed = parseMermaidClassDiagram(renamedDemoMermaid());
  const result = createDefaultLayoutEngineRegistry().get("suggest-initial-v2").run({
    document: parsed,
    mode: "suggest-initial-v2",
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });

  assertStrictGoldenRoutingTarget(result);
}

function assertStrictGoldenRoutingTarget(result: LayoutEngineResult): void {
  const summary = result.report.routingSummary;
  assert.ok(summary);
  assert.equal(summary.hardValid, true);
  assert.equal(summary.edgeNodeHits, 0);
  assert.equal(summary.dividerNodeHits, 0);
  assert.equal(summary.endpointDividerInteriorHits, 0);
  assert.equal(summary.illegalSegmentOverlaps, 0);
  assert.equal(summary.edgeCrossings, 0);
  assert.equal(summary.routingFailures, 0);
  assert.equal(result.report.edgeValidations?.some((edge) => edge.routingFallbackUsed || edge.routingFailed), false);
  assert.equal(summary.invalidDividers, 0);
  assert.equal(summary.edgeIdentityViolations, 0);
  assertOrdinaryPortsAreUnique(result.document);
}

function assertOrdinaryPortsAreUnique(document: DiagramDocument): void {
  const dividerEdgeIds = new Set((document.routingDividers ?? []).flatMap((divider) => divider.sourceEdgeIds));
  const ordinaryEdges = document.edges.filter((edge) => !dividerEdgeIds.has(edge.id));
  const degreeByNodeId = new Map<string, number>();
  const seen = new Set<string>();

  for (const edge of ordinaryEdges) {
    degreeByNodeId.set(edge.sourceId, (degreeByNodeId.get(edge.sourceId) ?? 0) + 1);
    degreeByNodeId.set(edge.targetId, (degreeByNodeId.get(edge.targetId) ?? 0) + 1);
  }

  for (const edge of ordinaryEdges) {
    for (const endpoint of ["source", "target"] as const) {
      const nodeId = endpoint === "source" ? edge.sourceId : edge.targetId;
      const anchor = endpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;
      const degree = degreeByNodeId.get(nodeId) ?? 0;
      assert.ok(anchor, `Expected ${edge.id} ${endpoint} anchor.`);
      assert.ok(degree > 0, `Expected displayed degree for ${nodeId}.`);
      const slotIndex = Math.round(anchor.ratio * (degree + 1) - 1);
      const expectedRatio = Number(((slotIndex + 1) / (degree + 1)).toFixed(3));

      assert.ok(slotIndex >= 0 && slotIndex < degree, `Expected ${edge.id} ${endpoint} to use a valid slot index.`);
      assert.ok(Math.abs(anchor.ratio - expectedRatio) < 0.001, `Expected ${edge.id} ${endpoint} to use an even port slot.`);

      const key = `${nodeId}:${anchor.side}:${slotIndex}`;
      assert.equal(seen.has(key), false, `Expected ordinary routes not to share port slot ${key}.`);
      seen.add(key);
    }
  }
}

function renamedDemoMermaid(): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bDmPhuongTienController\b/g, "AlphaController"],
    [/\bIDmPhuongTienManager\b/g, "IAlphaManager"],
    [/\bDmPhuongTienManager\b/g, "AlphaManager"],
    [/\bDataAccessAdapterFactory\b/g, "StorageFactory"],
    [/\bDataAccessAdapter\b/g, "StorageAdapter"],
    [/\bSysdmLoaiLucLuongEntity\b/g, "PrimaryEntity"],
    [/\bSysdmPhuongTienEntity\b/g, "SecondaryEntity"],
    [/\bDmPhuongTienModel\b/g, "AlphaModel"],
    [/\bDmPhuongTienPageModel\b/g, "AlphaPageModel"],
    [/\bSysQlpaModel_LoaiLucLuongOptionModel\b/g, "OptionModel"],
    [/\bPageModel\b/g, "BasePageModel"]
  ];
  return replacements.reduce(
    (source, [pattern, replacement]) => source.replace(pattern, replacement),
    readFileSync("docs/demo_mermaid.md", "utf8")
  );
}

function createContext(logger: MemoryLayoutLogger): LayoutRunContext {
  return {
    logger,
    options: resolveLayoutEngineOptions()
  };
}

function indexOf(values: string[], ...types: string[]): number {
  const index = values.findIndex((value) => types.includes(value));
  assert.ok(index >= 0, `Expected trace to include one of: ${types.join(", ")}`);
  return index;
}

function runManualV2(source: string, options: LayoutEngineOptions = {}) {
  const parsed = parseMermaidClassDiagram(source);
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  return createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options
  });
}

function fanOutFixture(edgeCount: number): string {
  return [
    "classDiagram",
    "<<Controller>> SourceController",
    ...Array.from({ length: edgeCount }, (_, index) => `<<Model>> TargetModel${index + 1}`),
    ...Array.from({ length: edgeCount }, (_, index) => `SourceController --> TargetModel${index + 1} : edge${index + 1}`)
  ].join("\n");
}

function fanInFixture(edgeCount: number): string {
  return [
    "classDiagram",
    ...Array.from({ length: edgeCount }, (_, index) => `<<Controller>> SourceController${index + 1}`),
    "<<Model>> TargetModel",
    ...Array.from({ length: edgeCount }, (_, index) => `SourceController${index + 1} --> TargetModel : edge${index + 1}`)
  ].join("\n");
}

function fanOutTwoRemoteGroupsFixture(): string {
  return [
    "classDiagram",
    "<<Controller>> SourceController",
    ...Array.from({ length: 5 }, (_, index) => `<<Model>> TargetModel${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `<<Entity>> TargetEntity${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `SourceController --> TargetModel${index + 1} : model${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `SourceController --> TargetEntity${index + 1} : entity${index + 1}`)
  ].join("\n");
}

function twoFanOutHubsSameRemoteGroupFixture(): string {
  return [
    "classDiagram",
    "<<Controller>> FirstController",
    "<<Controller>> SecondController",
    ...Array.from({ length: 5 }, (_, index) => `<<Model>> TargetModel${index + 1}`),
    ...["FirstController", "SecondController"].flatMap((source) =>
      Array.from({ length: 5 }, (_, index) => `${source} --> TargetModel${index + 1} : ${source}_${index + 1}`)
    )
  ].join("\n");
}

function threeFanOutHubsSameRemoteGroupFixture(): string {
  return [
    "classDiagram",
    "<<Controller>> FirstController",
    "<<Controller>> SecondController",
    "<<Controller>> ThirdController",
    ...Array.from({ length: 5 }, (_, index) => `<<Model>> TargetModel${index + 1}`),
    ...["FirstController", "SecondController", "ThirdController"].flatMap((source) =>
      Array.from({ length: 5 }, (_, index) => `${source} --> TargetModel${index + 1} : ${source}_${index + 1}`)
    )
  ].join("\n");
}

function oppositeFanOutHubsSameRemoteGroupFixture(): string {
  return [
    "classDiagram",
    "<<Manager>> RightManager",
    "<<Controller>> LeftController",
    ...Array.from({ length: 5 }, (_, index) => `<<Model>> TargetModel${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `RightManager --> TargetModel${index + 1} : manager_${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `LeftController --> TargetModel${index + 1} : controller_${index + 1}`)
  ].join("\n");
}

function routedOverlapDocument(id: string, mode: "same-source" | "same-target" | "independent"): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const nodes = [
    node("A", 0, 0),
    node("B", 200, 0),
    node("C", 0, 0),
    node("D", 200, 0)
  ];
  const secondSource = mode === "same-source" ? "A" : "C";
  const firstTarget = mode === "same-target" ? "D" : "B";

  return {
    id,
    type: "classDiagram",
    nodes,
    edges: [
      routedEdge("edge_1", "A", firstTarget, east, west),
      routedEdge("edge_2", secondSource, "D", east, west)
    ],
    diagnostics: []
  };
}

function crossingOnlyDocument(): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const south: DiagramEdgeAnchor = { side: "south", ratio: 0.5 };
  const north: DiagramEdgeAnchor = { side: "north", ratio: 0.5 };

  return {
    id: "crossing-only",
    type: "classDiagram",
    nodes: [
      node("A", 0, 0),
      node("B", 200, 0),
      node("C", 100, -100),
      node("D", 100, 100)
    ],
    edges: [
      routedEdge("edge_1", "A", "B", east, west, [{ x: 140, y: 20 }]),
      routedEdge("edge_2", "C", "D", south, north, [{ x: 140, y: -20 }, { x: 140, y: 100 }])
    ],
    diagnostics: []
  };
}

function routedNodeHitDocument(): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };

  return {
    id: "node-hit",
    type: "classDiagram",
    nodes: [
      node("A", 0, 0),
      node("BlockingNode", 130, 0),
      node("B", 300, 0)
    ],
    edges: [
      routedEdge("edge_1", "A", "B", east, west, [{ x: 180, y: 20 }])
    ],
    diagnostics: []
  };
}

function dividerObstacleHitDocument(): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const divider = {
    id: "divider_1",
    orientation: "vertical" as const,
    side: "west" as const,
    sourceEdgeIds: [],
    mode: "fanOut" as const,
    layout: { x: 110, y: 0, width: 10, height: 80 }
  };

  return {
    id: "divider-obstacle-hit",
    type: "classDiagram",
    nodes: [
      node("A", 0, 0),
      node("B", 240, 0)
    ],
    routingDividers: [divider],
    edges: [
      routedEdge("edge_1", "A", "B", east, west, [{ x: 160, y: 20 }])
    ],
    diagnostics: []
  };
}

function endpointDividerInteriorHitDocument(): DiagramDocument {
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const divider = {
    id: "divider_1",
    orientation: "vertical" as const,
    side: "west" as const,
    sourceEdgeIds: [],
    mode: "fanOut" as const,
    layout: { x: 100, y: 0, width: 10, height: 100 }
  };

  return {
    id: "endpoint-divider-interior-hit",
    type: "classDiagram",
    nodes: [
      node("B", 240, 30)
    ],
    routingDividers: [divider],
    edges: [{
      id: "edge_1",
      sourceId: "divider_1",
      targetId: "B",
      kind: "directedAssociation" as const,
      operator: "-->" as const,
      layout: {
        sourceAnchor: west,
        targetAnchor: west,
        routeSource: "engine-v2" as const,
        waypoints: [{ x: 105, y: 50 }, { x: 160, y: 50 }]
      }
    }],
    diagnostics: []
  };
}

function duplicatedDividerTrunkDocument(invalidDivider = false): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const dividerAnchor: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const targetIds = ["B", "C", "D", "E", "F"];
  const nodes = [
    node("A", 0, 0),
    ...targetIds.map((id, index) => node(id, 300, index * 80))
  ];
  const divider = {
    id: "divider_1",
    orientation: "vertical" as const,
    side: "east" as const,
    sourceEdgeIds: invalidDivider ? ["edge_1", "edge_2", "edge_3", "edge_4"] : ["edge_1", "edge_2", "edge_3", "edge_4", "edge_5"],
    mode: "fanOut" as const,
    layout: { x: 180, y: 0, width: 10, height: 260 }
  };

  return {
    id: "duplicated-divider-trunk",
    type: "classDiagram",
    nodes,
    routingDividers: [divider],
    edges: targetIds.map((targetId, index) => ({
      id: `edge_${index + 1}`,
      sourceId: "A",
      targetId,
      kind: "directedAssociation" as const,
      operator: "-->" as const,
      layout: {
        sourceAnchor: east,
        targetAnchor: west,
        routeSource: "engine-v2" as const,
        routedSegments: [{
          id: `edge_${index + 1}:divider-trunk`,
          sourceId: "A",
          targetId: "divider_1",
          sourceAnchor: east,
          targetAnchor: dividerAnchor,
          waypoints: [{ x: 120, y: 20 }, { x: 120, y: 130 }],
          markerPolicy: { start: true, end: false },
          strategy: "divider" as const
        }]
      }
    })),
    diagnostics: []
  };
}

function node(id: string, x: number, y: number) {
  return {
    id,
    label: id,
    kind: "class" as const,
    attributes: [],
    methods: [],
    layout: {
      x,
      y,
      width: 80,
      height: 40,
      headerHeight: 24,
      lineHeight: 16,
      separatorHeight: 4
    }
  };
}

function routedEdge(
  id: string,
  sourceId: string,
  targetId: string,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  waypoints: Array<{ x: number; y: number }> = [{ x: 140, y: 20 }]
) {
  return {
    id,
    sourceId,
    targetId,
    kind: "directedAssociation" as const,
    operator: "-->" as const,
    layout: {
      sourceAnchor,
      targetAnchor,
      routeSource: "engine-v2" as const,
      routedSegments: [{
        id: `${id}:direct`,
        sourceId,
        targetId,
        sourceAnchor,
        targetAnchor,
        waypoints,
        markerPolicy: { start: true, end: true },
        strategy: "corridor" as const
      }]
    }
  };
}

function anchorPoint(
  rectangle: { x: number; y: number; width: number; height: number },
  anchor: DiagramEdgeAnchor
): { x: number; y: number } {
  if (anchor.side === "north") {
    return { x: rectangle.x + rectangle.width * anchor.ratio, y: rectangle.y };
  }
  if (anchor.side === "south") {
    return { x: rectangle.x + rectangle.width * anchor.ratio, y: rectangle.y + rectangle.height };
  }
  if (anchor.side === "west") {
    return { x: rectangle.x, y: rectangle.y + rectangle.height * anchor.ratio };
  }
  return { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height * anchor.ratio };
}

function setGroup(layout: CoordinateRoutingLayoutV3, label: string, patch: { x: number; y: number }): void {
  const group = layout.groups.find((candidate) => candidate.label === label);
  assert.ok(group, `Expected ${label} group to exist.`);
  group.x = patch.x;
  group.y = patch.y;
}

function requireGroupIntent(layout: CoordinateRoutingLayoutV3, label: string) {
  const group = layout.groups.find((candidate) => candidate.label === label);
  assert.ok(group, `Expected ${label} group to exist.`);
  return group;
}

function parseBasicFixture(): ReturnType<typeof parseMermaidClassDiagram> {
  return parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Model>> AppModel",
    "AppController --> AppModel : uses"
  ].join("\n"));
}

function parseLayerFixture(): ReturnType<typeof parseMermaidClassDiagram> {
  return parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Manager>> AppManager",
    "<<Model>> AppModel",
    "AppController --> AppManager : calls",
    "AppManager --> AppModel : reads"
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
