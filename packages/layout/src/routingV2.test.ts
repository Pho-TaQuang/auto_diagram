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
  validateRoutedDocument,
  type CoordinateRoutingLayoutV3,
  type LayoutEngineResult,
  type LayoutEngineOptions
} from "./index.js";
import type { LayoutRunContext } from "./engine/LayoutEngine.js";
import type {
  DiagramDocument,
  DiagramEdgeAnchor,
  DiagramRoutingDivider,
  DiagramRoutedEdgeSegment
} from "../../core/src/index.js";

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
  fanInMoreThanFourUsesDivider();
  fanOutAtOrBelowThresholdDoesNotUseDividerOrShareSegments();
  fanInAtOrBelowThresholdDoesNotUseDividerOrShareSegments();
  duplicatedDividerTrunkSegmentsAreIllegalOverlaps();
  dividerPlanningBucketsByRemoteGroup();
  dividerSideFollowsRemoteGroupPacking();
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
}

export function runRoutingV2Slice5BTests(): void {
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

function fanInMoreThanFourUsesDivider(): void {
  const result = runManualV2(fanInFixture(5), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(result.document.routingDividers?.[0]?.mode, "fanIn");
  assert.equal(result.report.trace?.some((event) => event.type === "divider-created"), true);
  assertDividerConnectorGraph(result.document);
  assert.equal(result.report.routingSummary?.edgeNodeHits, 0);
  assert.equal(result.report.routingSummary?.illegalSegmentOverlaps, 0);
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

function dividerSideFollowsRemoteGroupPacking(): void {
  const parsed = parseMermaidClassDiagram(fanOutFixture(5));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const model = layout.groups.find((group) => group.label === "Model");
  assert.ok(model);
  model.packing = "horizontal";
  model.packingLocked = true;
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes", traceRouting: true }
  });
  const divider = result.document.routingDividers?.[0];

  assert.ok(divider);
  assert.ok(divider.side === "north" || divider.side === "south");
  assert.equal(divider.orientation, "horizontal");
}

function dividerSideOverflowEmitsDiagnostic(): void {
  const result = runManualV2(threeFanOutHubsSameRemoteGroupFixture(), { routeStrategy: "template-with-outer-lanes", traceRouting: true });

  assert.equal(result.document.routingDividers?.length, 3);
  assert.ok(result.report.warnings.some((event) => event.type === "divider-side-overflow"));
  assert.equal(result.report.routingSummary?.dividerSideOverflow, 1);
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
  assert.ok(waypoints.length > 0);
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
  assert.ok(source?.layout);
  const anchor = anchorPoint(source.layout, edge.layout.sourceAnchor);
  const firstWaypoint = edge.layout.routedSegments[0].waypoints[0];
  assert.ok(firstWaypoint);

  if (edge.layout.sourceAnchor.side === "east") {
    assert.ok(firstWaypoint.x > anchor.x);
  } else if (edge.layout.sourceAnchor.side === "west") {
    assert.ok(firstWaypoint.x < anchor.x);
  } else if (edge.layout.sourceAnchor.side === "north") {
    assert.ok(firstWaypoint.y < anchor.y);
  } else {
    assert.ok(firstWaypoint.y > anchor.y);
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
