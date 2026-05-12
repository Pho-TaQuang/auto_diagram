import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DiagramEdge, DiagramGroup, DiagramNode } from "../../core/src/index.js";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import {
  applyStereotypeGridLayout,
  createStereotypeLayoutIntent,
  type StereotypeLayoutIntent
} from "./stereotypeGridLayout.js";

const demoFixture = readFileSync("docs/demo_mermaid.md", "utf8");
const dmLoaiLucLuongFixture = readFileSync("docs/dmLoaiLucLuong.md", "utf8");

export function runStereotypeGridLayoutTests(): void {
  groupsNodesByExactStereotypeText();
  createsEditableLayoutIntent();
  createsSuggestedLayoutIntentFromInputGroups();
  placesUnknownGroupsAfterSuggestedGroups();
  appliesCustomGroupPlacementAndAssignment();
  keepsPresetGroupGridLockedWhileOptimizingInternals();
  appliesGroupGridSpanReservations();
  respectsExplicitHorizontalPackingIntent();
  rejectsInvalidLayoutIntent();
  storesScoredLayoutMetadata();
  routesInterGroupEdgesWithWaypoints();
  scoresOrthogonalRoutesWithManhattanLength();
  routesSameGroupEdgesWithAnchors();
  spacesSharedSideAnchorsEvenly();
  spacesTwoSharedSideAnchorsAwayFromCorners();
  ordersSharedSideAnchorsByTargetPosition();
  reordersLowerLeftFanoutAnchorsWhenScoreImproves();
  reordersClassesInsideLockedGroupWhenScoreImproves();
  reroutesFixedDemoGridWithoutCrossings();
  reroutesScreenshotGridWithLargeManagerFanoutBucket();
  appliesManualAnchorOrderIntent();
  spacesDenseSharedSideAnchorsEvenly();
  routesSuggestedDemoWithRowAwareFanout();
  placesDemoGroupsWithoutNodeOverlap();
  placesDmLoaiLucLuongGroupsWithoutNodeOverlap();
}

function groupsNodesByExactStereotypeText(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram([
    "classDiagram",
    "<<Service>> UpperService",
    "<<service>> LowerService",
    "class PlainClass"
  ].join("\n")));

  const serviceGroup = requireGroup(document.groups, "Service", "stereotype");
  const lowercaseServiceGroup = requireGroup(document.groups, "service", "stereotype");
  const ungroupedGroup = requireGroup(document.groups, "Ungrouped", "synthetic");

  assert.notEqual(serviceGroup.id, lowercaseServiceGroup.id);
  assert.equal(document.nodes.find((node) => node.id === "UpperService")?.groupId, serviceGroup.id);
  assert.equal(document.nodes.find((node) => node.id === "LowerService")?.groupId, lowercaseServiceGroup.id);
  assert.equal(document.nodes.find((node) => node.id === "PlainClass")?.groupId, ungroupedGroup.id);
  assert.deepEqual(serviceGroup.nodeIds, ["UpperService"]);
  assert.deepEqual(lowercaseServiceGroup.nodeIds, ["LowerService"]);
  assert.deepEqual(ungroupedGroup.nodeIds, ["PlainClass"]);
}

function createsEditableLayoutIntent(): void {
  const parsed = parseMermaidClassDiagram(dmLoaiLucLuongFixture);
  const intent = createStereotypeLayoutIntent(parsed);
  const assignedNodeIds = intent.groups.flatMap((group) => group.nodeIds).sort();
  const parsedNodeIds = parsed.nodes.map((node) => node.id).sort();

  assert.equal(intent.version, 1);
  assert.equal(intent.grid.columns, 3);
  assert.deepEqual(assignedNodeIds, parsedNodeIds);
  assert.ok(intent.groups.some((group) => group.label === "Controller" && group.packing === "vertical"));
  assert.ok(intent.groups.every((group) => group.gridWidth > 0 && group.gridHeight > 0));
}

function createsSuggestedLayoutIntentFromInputGroups(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
  const assignedNodeIds = intent.groups.flatMap((group) => group.nodeIds).sort();
  const parsedNodeIds = parsed.nodes.map((node) => node.id).sort();
  const parsedGroupLabels = [...new Set(parsed.nodes.map((node) => node.stereotype || "Ungrouped"))].sort();
  const intentGroupLabels = intent.groups.map((group) => group.label).sort();

  assert.equal(intent.grid.columns, 4);
  assert.deepEqual(assignedNodeIds, parsedNodeIds);
  assert.deepEqual(intentGroupLabels, parsedGroupLabels);
  assertIntentGroupPosition(intent, "AdapterFactory", 1, 0);
  assertIntentGroupPosition(intent, "DataAccessAdapter", 2, 0);
  assertIntentGroupPosition(intent, "Controller", 0, 1);
  assertIntentGroupPosition(intent, "ManagerInterface", 1, 1);
  assertIntentGroupPosition(intent, "Manager", 2, 1);
  assertIntentGroupPosition(intent, "LLBLGenEntity", 3, 1);
  assertIntentGroupPosition(intent, "Model", 0, 2);
  assertIntentGroupPosition(intent, "DTO", 1, 2);
}

function placesUnknownGroupsAfterSuggestedGroups(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Worker>> AppWorker",
    "<<Presenter>> AppPresenter"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
  const workerGroup = requireIntentGroup(intent, "Worker");
  const presenterGroup = requireIntentGroup(intent, "Presenter");

  assertIntentGroupPosition(intent, "Controller", 0, 1);
  assert.equal(workerGroup.gridY, 3);
  assert.equal(presenterGroup.gridY, 3);
  assert.equal(workerGroup.gridX, 0);
  assert.equal(presenterGroup.gridX, 1);
}

function appliesCustomGroupPlacementAndAssignment(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Model>> AppModel",
    "AppController ..> AppModel : use"
  ].join("\n"));
  const intent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 2, rows: 1 }));
  const controllerGroup = requireIntentGroup(intent, "Controller");
  const modelGroup = requireIntentGroup(intent, "Model");

  controllerGroup.gridX = 1;
  modelGroup.gridX = 0;
  controllerGroup.nodeIds.push("AppModel");
  modelGroup.nodeIds = [];

  const laidOut = applyStereotypeGridLayout(parsed, { intent });
  const controllerNode = requireNode(laidOut.nodes, "AppController");
  const modelNode = requireNode(laidOut.nodes, "AppModel");
  const controllerLayout = requireLayout(controllerNode);
  const modelLayout = requireLayout(modelNode);

  assert.equal(modelNode.stereotype, "Model");
  assert.equal(modelNode.groupId, controllerGroup.id);
  assert.ok(controllerLayout.x > requireGroup(laidOut.groups, "Model", "stereotype").layout!.x);
  assert.ok(modelLayout.x >= requireGroup(laidOut.groups, "Controller", "stereotype").layout!.x);
}

function keepsPresetGroupGridLockedWhileOptimizingInternals(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "class A1 {",
    "  <<Controller>>",
    "}",
    "class A2 {",
    "  <<Controller>>",
    "}",
    "class B1 {",
    "  <<Model>>",
    "}",
    "class B2 {",
    "  <<Model>>",
    "}",
    "A1 ..> B2 : use",
    "A2 ..> B1 : use"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 4, rows: 2 });
  requireIntentGroup(intent, "Controller").gridX = 2;
  requireIntentGroup(intent, "Controller").gridY = 1;
  requireIntentGroup(intent, "Model").gridX = 0;
  requireIntentGroup(intent, "Model").gridY = 0;

  const document = applyStereotypeGridLayout(parsed, { intent });
  const controllerGroup = requireGroup(document.groups, "Controller", "stereotype");
  const modelGroup = requireGroup(document.groups, "Model", "stereotype");

  assert.match(document.layout?.selectedCandidateId ?? "", /^intent-grid/);
  assert.equal(controllerGroup.layoutIntent?.gridX, 2);
  assert.equal(controllerGroup.layoutIntent?.gridY, 1);
  assert.equal(modelGroup.layoutIntent?.gridX, 0);
  assert.equal(modelGroup.layoutIntent?.gridY, 0);
  assert.deepEqual(controllerGroup.nodeIds, ["A2", "A1"]);
}

function appliesGroupGridSpanReservations(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Manager>> AppManager"
  ].join("\n"));
  const baseIntent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 4, rows: 1 }));
  requireIntentGroup(baseIntent, "Controller").gridX = 0;
  requireIntentGroup(baseIntent, "Manager").gridX = 1;

  const spannedIntent = cloneIntent(baseIntent);
  requireIntentGroup(spannedIntent, "Controller").gridWidth = 2;
  requireIntentGroup(spannedIntent, "Manager").gridX = 2;

  const base = applyStereotypeGridLayout(parsed, { intent: baseIntent });
  const spanned = applyStereotypeGridLayout(parsed, { intent: spannedIntent });
  const baseController = requireGroup(base.groups, "Controller", "stereotype");
  const baseManager = requireGroup(base.groups, "Manager", "stereotype");
  const spannedController = requireGroup(spanned.groups, "Controller", "stereotype");
  const spannedManager = requireGroup(spanned.groups, "Manager", "stereotype");

  assert.ok(baseController.layout);
  assert.ok(baseManager.layout);
  assert.ok(spannedController.layout);
  assert.ok(spannedManager.layout);
  assert.ok(
    spannedManager.layout.x - spannedController.layout.x > baseManager.layout.x - baseController.layout.x,
    "Expected a wider group grid footprint to reserve more horizontal space."
  );
}

function respectsExplicitHorizontalPackingIntent(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Service>> FirstService",
    "<<Service>> SecondService"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 1, rows: 1 });
  requireIntentGroup(intent, "Service").packing = "horizontal";

  const document = applyStereotypeGridLayout(parsed, { intent });
  const serviceLayouts = ["FirstService", "SecondService"]
    .map((nodeId) => requireLayout(requireNode(document.nodes, nodeId)))
    .sort((left, right) => left.x - right.x);

  assert.equal(serviceLayouts[0].y, serviceLayouts[1].y);
  assert.ok(serviceLayouts[1].x > serviceLayouts[0].x + serviceLayouts[0].width);
  assert.ok(document.groups?.every((group) => group.layoutIntent?.packing === "horizontal"));
}

function rejectsInvalidLayoutIntent(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> AppController",
    "<<Model>> AppModel"
  ].join("\n"));

  const unknownNodeIntent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 2, rows: 1 }));
  requireIntentGroup(unknownNodeIntent, "Controller").nodeIds.push("MissingNode");
  assert.throws(() => applyStereotypeGridLayout(parsed, { intent: unknownNodeIntent }), /unknown node/);

  const duplicateNodeIntent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 2, rows: 1 }));
  requireIntentGroup(duplicateNodeIntent, "Controller").nodeIds.push("AppModel");
  assert.throws(() => applyStereotypeGridLayout(parsed, { intent: duplicateNodeIntent }), /more than once/);

  const overlappingGroupIntent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 2, rows: 1 }));
  requireIntentGroup(overlappingGroupIntent, "Controller").gridX = 0;
  requireIntentGroup(overlappingGroupIntent, "Model").gridX = 0;
  assert.throws(() => applyStereotypeGridLayout(parsed, { intent: overlappingGroupIntent }), /overlap/);
}

function storesScoredLayoutMetadata(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram(demoFixture));

  assert.equal(document.layout?.engine, "stereotype-scored");
  assert.ok(document.layout.selectedCandidateId.length > 0);
  assert.ok(document.layout.candidatesEvaluated > 1);
  assert.ok(Number.isFinite(document.layout.score.value));
  assert.equal(document.layout.score.nodeOverlaps, 0);
  assert.equal(document.layout.score.groupOverlaps, 0);
  assert.ok(document.layout.score.layoutWidth > 0);
  assert.ok(document.layout.score.layoutArea > 0);
}

function routesInterGroupEdgesWithWaypoints(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Manager>> TargetManager",
    "SourceController ..> TargetManager : use"
  ].join("\n")));
  const edge = requireEdge(document.edges, "SourceController", "TargetManager");

  assert.ok((edge.layout?.waypoints?.length ?? 0) > 0);
  assert.ok(edge.layout?.sourceAnchor);
  assert.ok(edge.layout?.targetAnchor);
  assertWaypointsOutsideNodes(document.edges, document.nodes);
}

function scoresOrthogonalRoutesWithManhattanLength(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Manager>> TargetManager",
    "<<Model>> TargetModel",
    "SourceController ..> TargetManager : manager",
    "SourceController ..> TargetModel : model"
  ].join("\n")));
  const totalManhattanLength = document.edges.reduce((sum, edge) => {
    const points = edgePathPoints(edge, document.nodes);
    assertOrthogonalPath(points, edge.id);
    return sum + manhattanPathLength(points);
  }, 0);

  assert.equal(document.layout?.score.totalEdgeLength, totalManhattanLength);
}

function routesSameGroupEdgesWithAnchors(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram([
    "classDiagram",
    "<<Manager>> FirstManager",
    "<<Manager>> SecondManager",
    "FirstManager ..> SecondManager : use"
  ].join("\n")));
  const edge = requireEdge(document.edges, "FirstManager", "SecondManager");

  assert.ok(edge.layout?.sourceAnchor);
  assert.ok(edge.layout?.targetAnchor);
  assertNoNodeOverlap(document.nodes);
  assertGroupsContainTheirNodes(document.groups ?? [], document.nodes);
}

function spacesSharedSideAnchorsEvenly(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<ManagerInterface>> TargetManagerInterface",
    "<<Manager>> TargetManager",
    "<<AdapterFactory>> TargetAdapterFactory",
    "SourceController ..> TargetManagerInterface : first",
    "SourceController ..> TargetManager : second",
    "SourceController ..> TargetAdapterFactory : third"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 4, rows: 1 });
  const document = applyStereotypeGridLayout(parsed, { intent });
  const sourceAnchors = document.edges.map((edge) => edge.layout?.sourceAnchor);
  const sourceRatios = sourceAnchors.map((anchor) => anchor?.ratio).sort();

  assert.deepEqual(sourceRatios, [0.25, 0.5, 0.75]);
  assert.equal(new Set(sourceAnchors.map((anchor) => `${anchor?.side}:${anchor?.ratio}`)).size, 3);
}

function spacesTwoSharedSideAnchorsAwayFromCorners(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Manager>> TargetManager",
    "<<AdapterFactory>> TargetAdapterFactory",
    "SourceController ..> TargetManager : first",
    "SourceController ..> TargetAdapterFactory : second"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 3, rows: 1 });
  const document = applyStereotypeGridLayout(parsed, { intent });
  const sourceAnchors = document.edges.map((edge) => edge.layout?.sourceAnchor);

  assert.equal(new Set(sourceAnchors.map((anchor) => `${anchor?.side}:${anchor?.ratio}`)).size, 2);
  assert.ok(sourceAnchors.every((anchor) => anchor && anchor.ratio >= 0.05 && anchor.ratio <= 0.95));
}

function ordersSharedSideAnchorsByTargetPosition(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> LeftModel",
    "<<Model>> MiddleModel",
    "<<Model>> RightModel",
    "SourceController ..> LeftModel : left",
    "SourceController ..> MiddleModel : middle",
    "SourceController ..> RightModel : right"
  ].join("\n"));
  const intent = cloneIntent(createStereotypeLayoutIntent(parsed, { columns: 1, rows: 3 }));
  requireIntentGroup(intent, "Controller").gridY = 0;
  requireIntentGroup(intent, "Model").gridY = 2;

  const document = applyStereotypeGridLayout(parsed, { intent });
  const edgesByTargetX = document.edges
    .map((edge) => ({
      edge,
      targetCenterX: centerX(requireLayout(requireNode(document.nodes, edge.targetId)))
    }))
    .sort((left, right) => left.targetCenterX - right.targetCenterX);
  const sourceAnchors = edgesByTargetX.map(({ edge }) => {
    assert.ok(edge.layout?.sourceAnchor);
    return edge.layout.sourceAnchor;
  });

  assert.equal(new Set(sourceAnchors.map((anchor) => `${anchor.side}:${anchor.ratio}`)).size, sourceAnchors.length);
  assert.ok(sourceAnchors.every((anchor) => anchor.ratio >= 0.05 && anchor.ratio <= 0.95));
}

function reordersLowerLeftFanoutAnchorsWhenScoreImproves(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Manager>> SourceManager",
    "<<DTO>> NearDto",
    "<<Model>> MiddleModel",
    "<<Model>> FarModel",
    "SourceManager ..> NearDto : near",
    "SourceManager ..> MiddleModel : middle",
    "SourceManager ..> FarModel : far"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
  const autoDocument = applyStereotypeGridLayout(parsed, { intent });
  const source = requireNode(autoDocument.nodes, "SourceManager");
  const sourceCenterX = centerX(requireLayout(source));
  const fanoutEdges = autoDocument.edges.filter((edge) => edge.sourceId === "SourceManager");
  const targetsNearestToFarthest = [...fanoutEdges]
    .sort((left, right) =>
      Math.abs(centerX(requireLayout(requireNode(autoDocument.nodes, left.targetId))) - sourceCenterX) -
      Math.abs(centerX(requireLayout(requireNode(autoDocument.nodes, right.targetId))) - sourceCenterX)
    )
    .map((edge) => edge.id);
  const manualDocument = applyStereotypeGridLayout(parsed, {
    intent,
    anchorOrderMode: "manual",
    anchorOrders: [{
      nodeId: "SourceManager",
      side: "south",
      edgeOrder: targetsNearestToFarthest
    }]
  });
  const targetsBySourcePort = [...fanoutEdges]
    .sort((left, right) => {
      assert.ok(left.layout?.sourceAnchor);
      assert.ok(right.layout?.sourceAnchor);
      return left.layout.sourceAnchor.ratio - right.layout.sourceAnchor.ratio;
    })
    .map((edge) => {
      return edge.targetId;
    });

  assert.deepEqual([...targetsBySourcePort].sort(), ["FarModel", "MiddleModel", "NearDto"]);
  assert.ok((autoDocument.layout?.score.value ?? Infinity) <= (manualDocument.layout?.score.value ?? Infinity));
  assert.ok((autoDocument.layout?.score.edgeCrossings ?? Infinity) <= (manualDocument.layout?.score.edgeCrossings ?? Infinity));
}

function reordersClassesInsideLockedGroupWhenScoreImproves(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "class A1 {",
    "  <<Controller>>",
    "}",
    "class A2 {",
    "  <<Controller>>",
    "}",
    "class B1 {",
    "  <<Model>>",
    "}",
    "class B2 {",
    "  <<Model>>",
    "}",
    "A1 ..> B2 : use",
    "A2 ..> B1 : use"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 2, rows: 1 });
  const originalOnly = applyStereotypeGridLayout(parsed, { intent, candidateLimit: 1 });
  const reordered = applyStereotypeGridLayout(parsed, { intent });
  const controllerGroup = requireGroup(reordered.groups, "Controller", "stereotype");

  assert.equal(originalOnly.layout?.selectedCandidateId, "intent-grid-original");
  assert.match(reordered.layout?.selectedCandidateId ?? "", /order-group_stereotype_Controller/);
  assert.deepEqual(controllerGroup.nodeIds, ["A2", "A1"]);
  assert.ok((reordered.layout?.score.value ?? Infinity) < (originalOnly.layout?.score.value ?? -Infinity));
  assert.ok((reordered.layout?.score.edgeBends ?? Infinity) < (originalOnly.layout?.score.edgeBends ?? -Infinity));
}

function reroutesFixedDemoGridWithoutCrossings(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const intent = createStereotypeLayoutIntent(parsed, { columns: 4, rows: 3 });
  setIntentGroupPlacement(intent, "Controller", 0, 1, "vertical");
  setIntentGroupPlacement(intent, "ManagerInterface", 1, 1, "vertical");
  setIntentGroupPlacement(intent, "Manager", 2, 1, "vertical");
  setIntentGroupPlacement(intent, "AdapterFactory", 1, 0, "vertical");
  setIntentGroupPlacement(intent, "DataAccessAdapter", 2, 0, "vertical");
  setIntentGroupPlacement(intent, "LLBLGenEntity", 3, 1, "compactGrid");
  setIntentGroupPlacement(intent, "Model", 0, 2, "compactGrid");
  setIntentGroupPlacement(intent, "DTO", 1, 2, "compactGrid");

  const document = applyStereotypeGridLayout(parsed, { intent });

  assert.match(document.layout?.selectedCandidateId ?? "", /^intent-grid/);
  assert.equal(document.layout?.score.edgeCrossings, 0);
  assert.equal(requireGroup(document.groups, "Controller", "stereotype").layoutIntent?.gridX, 0);
  assert.equal(requireGroup(document.groups, "Model", "stereotype").layoutIntent?.gridY, 2);
}

function reroutesScreenshotGridWithLargeManagerFanoutBucket(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const intent = createStereotypeLayoutIntent(parsed, { columns: 15, rows: 15 });
  setIntentGroupPlacement(intent, "Controller", 0, 0, "vertical", 3, 2);
  setIntentGroupPlacement(intent, "ManagerInterface", 3, 0, "vertical", 3, 2);
  setIntentGroupPlacement(intent, "Manager", 6, 0, "vertical", 3, 2);
  setIntentGroupPlacement(intent, "AdapterFactory", 9, 0, "vertical", 2, 1);
  setIntentGroupPlacement(intent, "DataAccessAdapter", 11, 0, "vertical", 3, 2);
  setIntentGroupPlacement(intent, "Model", 0, 2, "compactGrid", 3, 6);
  setIntentGroupPlacement(intent, "DTO", 3, 2, "compactGrid", 2, 2);
  setIntentGroupPlacement(intent, "LLBLGenEntity", 9, 2, "compactGrid", 3, 6);

  const document = applyStereotypeGridLayout(parsed, { intent });
  const managerFanoutTargets = [
    "SysdmLoaiLucLuongEntity",
    "SysdmPhuongTienEntity",
    "DmPhuongTienModel",
    "DmPhuongTienPageModel",
    "SysQlpaModel_LoaiLucLuongOptionModel"
  ];
  const targetsBySourcePort = managerFanoutTargets
    .map((targetId) => requireEdge(document.edges, "DmPhuongTienManager", targetId))
    .sort((left, right) => {
      assert.ok(left.layout?.sourceAnchor);
      assert.ok(right.layout?.sourceAnchor);
      return left.layout.sourceAnchor.ratio - right.layout.sourceAnchor.ratio;
    })
    .map((edge) => edge.targetId);

  assert.equal(document.layout?.score.edgeCrossings, 0);
  assert.ok(
    targetsBySourcePort.indexOf("DmPhuongTienModel") > targetsBySourcePort.indexOf("SysQlpaModel_LoaiLucLuongOptionModel"),
    "Expected large bucket search to try non-geometric manager fanout order."
  );
}

function appliesManualAnchorOrderIntent(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Manager>> SourceManager",
    "<<DTO>> NearDto",
    "<<Model>> MiddleModel",
    "<<Model>> FarModel",
    "SourceManager ..> NearDto : near",
    "SourceManager ..> MiddleModel : middle",
    "SourceManager ..> FarModel : far"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
  const manualOrder = [
    "edge_3_SourceManager_FarModel",
    "edge_2_SourceManager_MiddleModel",
    "edge_1_SourceManager_NearDto"
  ];
  const document = applyStereotypeGridLayout(parsed, {
    intent,
    anchorOrderMode: "manual",
    anchorOrders: [{
      nodeId: "SourceManager",
      side: "south",
      edgeOrder: manualOrder
    }]
  });
  const targetsBySourcePort = parsed.edges
    .map((edge) => requireEdge(document.edges, edge.sourceId, edge.targetId))
    .sort((left, right) => {
      assert.ok(left.layout?.sourceAnchor);
      assert.ok(right.layout?.sourceAnchor);
      return left.layout.sourceAnchor.ratio - right.layout.sourceAnchor.ratio;
    })
    .map((edge) => edge.id);

  assert.deepEqual(targetsBySourcePort, manualOrder);
}

function routesSuggestedDemoWithRowAwareFanout(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const intent = createStereotypeLayoutIntent(parsed, { placement: "suggested" });
  const document = applyStereotypeGridLayout(parsed, { intent });
  const fanoutTargets = [
    "DmPhuongTienPageModel",
    "SysQlpaModel_LoaiLucLuongOptionModel",
    "DmPhuongTienModel"
  ];
  const managerFanoutEdges = fanoutTargets.map((targetId) =>
    requireEdge(document.edges, "DmPhuongTienManager", targetId)
  );
  const targetsBySourcePort = [...managerFanoutEdges]
    .sort((left, right) => {
      assert.ok(left.layout?.sourceAnchor);
      assert.ok(right.layout?.sourceAnchor);
      return left.layout.sourceAnchor.ratio - right.layout.sourceAnchor.ratio;
    })
    .map((edge) => {
      return edge.targetId;
    });
  const pageModelBottom = bottom(requireLayout(requireNode(document.nodes, "DmPhuongTienPageModel")));

  assert.deepEqual([...targetsBySourcePort].sort(), [...fanoutTargets].sort());
  assert.ok(
    managerFanoutEdges.some((edge) => (edge.layout?.waypoints ?? []).some((waypoint) => waypoint.y > pageModelBottom)),
    "Expected at least one manager fanout route to use a lane below DmPhuongTienPageModel."
  );
  assert.equal(document.layout?.score.nodeOverlaps, 0);
  assert.equal(document.layout?.score.groupOverlaps, 0);
  assert.equal(document.layout?.score.edgeNodeHits, 0);
  assert.equal(document.layout?.score.edgeCrossings, 0);
  assertWaypointsOutsideNodes(document.edges, document.nodes);
}

function spacesDenseSharedSideAnchorsEvenly(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<ManagerInterface>> TargetManagerInterface",
    "<<Manager>> TargetManager",
    "<<AdapterFactory>> TargetAdapterFactory",
    "<<DataAccessAdapter>> TargetDataAccessAdapter",
    "SourceController ..> TargetManagerInterface : first",
    "SourceController ..> TargetManager : second",
    "SourceController ..> TargetAdapterFactory : third",
    "SourceController ..> TargetDataAccessAdapter : fourth"
  ].join("\n"));
  const intent = createStereotypeLayoutIntent(parsed, { columns: 5, rows: 1 });
  const document = applyStereotypeGridLayout(parsed, { intent });
  const sourceAnchors = document.edges.map((edge) => {
    assert.ok(edge.layout?.sourceAnchor);
    return edge.layout.sourceAnchor;
  });
  const sourceAnchorKeys = new Set(sourceAnchors.map((anchor) => `${anchor.side}:${anchor.ratio}`));

  assert.equal(sourceAnchorKeys.size, 4);
  assert.ok(sourceAnchors.every((anchor) => anchor.ratio >= 0.05 && anchor.ratio <= 0.95));
}

function placesDemoGroupsWithoutNodeOverlap(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram(demoFixture));

  assert.ok(document.groups);
  assert.ok(document.groups.length > 0);
  assertNoNodeOverlap(document.nodes);
  assertGroupsContainTheirNodes(document.groups, document.nodes);
  assertWaypointsOutsideNodes(document.edges, document.nodes);
}

function placesDmLoaiLucLuongGroupsWithoutNodeOverlap(): void {
  const document = applyStereotypeGridLayout(parseMermaidClassDiagram(dmLoaiLucLuongFixture));

  assert.ok(document.groups);
  assert.equal(document.nodes.every((node) => Boolean(node.groupId)), true);
  assertNoNodeOverlap(document.nodes);
  assertGroupsContainTheirNodes(document.groups, document.nodes);
  assertWaypointsOutsideNodes(document.edges, document.nodes);
}

function requireEdge(edges: DiagramEdge[], sourceId: string, targetId: string): DiagramEdge {
  const edge = edges.find((candidate) => candidate.sourceId === sourceId && candidate.targetId === targetId);
  assert.ok(edge, `Expected edge ${sourceId} -> ${targetId} to be present.`);
  return edge;
}

function requireNode(nodes: DiagramNode[], nodeId: string): DiagramNode {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Expected node ${nodeId} to be present.`);
  return node;
}

function requireIntentGroup(intent: StereotypeLayoutIntent, label: string): StereotypeLayoutIntent["groups"][number] {
  const group = intent.groups.find((candidate) => candidate.label === label);
  assert.ok(group, `Expected intent group ${label} to be present.`);
  return group;
}

function assertIntentGroupPosition(intent: StereotypeLayoutIntent, label: string, gridX: number, gridY: number): void {
  const group = requireIntentGroup(intent, label);
  assert.equal(group.gridX, gridX, `Expected ${label} gridX to be ${gridX}.`);
  assert.equal(group.gridY, gridY, `Expected ${label} gridY to be ${gridY}.`);
}

function setIntentGroupPlacement(
  intent: StereotypeLayoutIntent,
  label: string,
  gridX: number,
  gridY: number,
  packing: StereotypeLayoutIntent["groups"][number]["packing"],
  gridWidth = 1,
  gridHeight = 1
): void {
  const group = requireIntentGroup(intent, label);
  group.gridX = gridX;
  group.gridY = gridY;
  group.gridWidth = gridWidth;
  group.gridHeight = gridHeight;
  group.packing = packing;
}

function cloneIntent(intent: StereotypeLayoutIntent): StereotypeLayoutIntent {
  return JSON.parse(JSON.stringify(intent)) as StereotypeLayoutIntent;
}

function requireGroup(
  groups: DiagramGroup[] | undefined,
  label: string,
  kind: DiagramGroup["kind"]
): DiagramGroup {
  assert.ok(groups, "Expected document groups to be present.");
  const group = groups.find((candidate) => candidate.label === label && candidate.kind === kind);
  assert.ok(group, `Expected ${kind} group ${label} to be present.`);
  return group;
}

function assertGroupsContainTheirNodes(groups: DiagramGroup[], nodes: DiagramNode[]): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const group of groups) {
    assert.ok(group.layout, `Expected ${group.id} to have group layout.`);

    for (const nodeId of group.nodeIds) {
      const node = nodesById.get(nodeId);
      assert.ok(node, `Expected group node ${nodeId} to exist.`);
      assert.equal(node.groupId, group.id);
      assert.ok(node.layout, `Expected ${node.id} to have node layout.`);
      assert.ok(node.layout.x >= group.layout.x, `${node.id} starts before ${group.id}.`);
      assert.ok(node.layout.y >= group.layout.y, `${node.id} starts above ${group.id}.`);
      assert.ok(node.layout.x + node.layout.width <= group.layout.x + group.layout.width, `${node.id} exceeds ${group.id} width.`);
      assert.ok(node.layout.y + node.layout.height <= group.layout.y + group.layout.height, `${node.id} exceeds ${group.id} height.`);
    }
  }
}

function assertNoNodeOverlap(nodes: DiagramNode[]): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = requireLayout(nodes[leftIndex]);
      const right = requireLayout(nodes[rightIndex]);

      assert.equal(rectanglesOverlap(left, right), false, `${nodes[leftIndex].id} overlaps ${nodes[rightIndex].id}`);
    }
  }
}

function assertWaypointsOutsideNodes(edges: DiagramEdge[], nodes: DiagramNode[]): void {
  const nodeLayouts = nodes.map((node) => ({ id: node.id, layout: requireLayout(node) }));

  for (const edge of edges) {
    for (const waypoint of edge.layout?.waypoints ?? []) {
      const containingNode = nodeLayouts.find(({ layout }) => pointInsideRectangle(waypoint, layout));
      assert.equal(
        containingNode,
        undefined,
        `Expected waypoint (${waypoint.x}, ${waypoint.y}) for ${edge.id} to be outside nodes.`
      );
    }
  }
}

function edgePathPoints(edge: DiagramEdge, nodes: DiagramNode[]): Array<{ x: number; y: number }> {
  const sourceLayout = requireLayout(requireNode(nodes, edge.sourceId));
  const targetLayout = requireLayout(requireNode(nodes, edge.targetId));
  const sourcePoint = edge.layout?.sourceAnchor ? testAnchorPoint(sourceLayout, edge.layout.sourceAnchor) : center(sourceLayout);
  const targetPoint = edge.layout?.targetAnchor ? testAnchorPoint(targetLayout, edge.layout.targetAnchor) : center(targetLayout);

  return [sourcePoint, ...(edge.layout?.waypoints ?? []), targetPoint];
}

function testAnchorPoint(
  rectangle: { x: number; y: number; width: number; height: number },
  anchor: NonNullable<DiagramEdge["layout"]>["sourceAnchor"]
): { x: number; y: number } {
  assert.ok(anchor);

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

function center(rectangle: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: rectangle.x + rectangle.width / 2,
    y: rectangle.y + rectangle.height / 2
  };
}

function assertOrthogonalPath(points: Array<{ x: number; y: number }>, edgeId: string): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    assert.ok(start.x === end.x || start.y === end.y, `Expected ${edgeId} segment ${index} to be orthogonal.`);
  }
}

function manhattanPathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.abs(points[index + 1].x - points[index].x) + Math.abs(points[index + 1].y - points[index].y);
  }

  return total;
}

function requireLayout(node: DiagramNode): NonNullable<DiagramNode["layout"]> {
  assert.ok(node.layout, `Expected ${node.id} to have layout.`);
  assert.ok(node.layout.width > 0, `Expected ${node.id} to have positive width.`);
  assert.ok(node.layout.height > 0, `Expected ${node.id} to have positive height.`);
  return node.layout;
}

function centerX(rectangle: { x: number; width: number }): number {
  return rectangle.x + rectangle.width / 2;
}

function bottom(rectangle: { y: number; height: number }): number {
  return rectangle.y + rectangle.height;
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function pointInsideRectangle(
  point: { x: number; y: number },
  rectangle: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x > rectangle.x &&
    point.x < rectangle.x + rectangle.width &&
    point.y > rectangle.y &&
    point.y < rectangle.y + rectangle.height
  );
}
