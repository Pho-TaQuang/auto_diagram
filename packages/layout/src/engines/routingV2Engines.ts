import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramGroup,
  DiagramLayoutScore,
  DiagramNode,
  DiagramPoint
} from "../../../core/src/index.js";
import {
  MemoryLayoutLogger,
  logEventsToDiagnostics,
  type LayoutEngineId,
  type LayoutSourceFormat
} from "../engine/LayoutRunReport.js";
import {
  resolveLayoutEngineOptions,
  type LayoutEngine,
  type LayoutEngineRequest,
  type LayoutEngineResult,
  type LayoutRunContext
} from "../engine/LayoutEngine.js";
import { estimateClassNodeLayout } from "../mvp0GridLayout.js";
import {
  createInitialCoordinateRoutingLayoutV3,
  normalizeCoordinateRoutingIntent,
  normalizeLayoutInput,
  type CoordinateRoutingLayoutV3,
  type NormalizedCoordinateRoutingIntent,
  type NormalizedGroupIntent
} from "../normalizers/coordinateRoutingLayoutV3.js";
import { buildRoutingSummary } from "../routing/RoutingSummary.js";
import {
  collectRoutingPaths,
  countRouteNodeHits,
  validateRoutedDocument as validateRoutingResult
} from "../routing/RoutingValidator.js";
import { templateOnlyRouteStrategy, templateWithOuterLanesRouteStrategy } from "../routing/templateRouter.js";
import type { RouteResult, RouteStrategy, RoutingContext } from "../routing/RouteStrategy.js";

const groupPadding = 32;
const nodeGapX = 80;
const nodeGapY = 80;
const scoreWeights = {
  edgeNodeHits: 1_000_000_000,
  nodeOverlaps: 800_000_000,
  groupOverlaps: 500_000_000,
  edgeCrossings: 150_000_000,
  segmentOverlaps: 200_000_000,
  duplicateAnchors: 100_000_000,
  outerLaneUsage: 50_000,
  edgeBends: 1_000,
  edgeLength: 0.1,
  compactArea: 0.0001
};

export class ManualRoutingV2Engine implements LayoutEngine {
  readonly id = "manual-routing-v2" as const;

  run(request: LayoutEngineRequest): LayoutEngineResult {
    if (request.layoutInput === undefined) {
      throw new Error("manual-routing-v2 requires a layout input.");
    }

    return runRoutingV2(request, this.id, request.layoutInput);
  }
}

export class SuggestInitialV2Engine implements LayoutEngine {
  readonly id = "suggest-initial-v2" as const;

  run(request: LayoutEngineRequest): LayoutEngineResult {
    const layoutInput = request.layoutInput ?? createInitialCoordinateRoutingLayoutV3(request.document, "suggested");
    return runRoutingV2(request, this.id, layoutInput, request.layoutInput === undefined ? "none" : undefined);
  }
}

export class AutoArrangeV2Engine implements LayoutEngine {
  readonly id = "auto-arrange-v2" as const;

  run(request: LayoutEngineRequest): LayoutEngineResult {
    const layoutInput = createInitialCoordinateRoutingLayoutV3(request.document, "suggested");
    return runRoutingV2(request, this.id, layoutInput, "none");
  }
}

function runRoutingV2(
  request: LayoutEngineRequest,
  engine: LayoutEngineId,
  layoutInput: unknown,
  forcedSourceFormat?: LayoutSourceFormat
): LayoutEngineResult {
  const logger = new MemoryLayoutLogger();
  const options = resolveLayoutEngineOptions(request.options);
  const context: LayoutRunContext = { logger, options };
  const normalizeResult = forcedSourceFormat === "none"
    ? {
      intent: layoutInput as CoordinateRoutingLayoutV3,
      sourceFormat: "none" as const,
      warnings: []
    }
    : normalizeLayoutInput(layoutInput, request.document, context);
  const routingOptions = {
    dividerThreshold: normalizeResult.intent.routing?.dividerThreshold ?? options.dividerThreshold,
    outerLaneMargin: normalizeResult.intent.routing?.outerLaneMargin ?? options.outerLaneMargin,
    maxRepairPasses: normalizeResult.intent.routing?.maxRepairPasses ?? options.maxRepairPasses
  };
  const routeStrategy = options.routeStrategy === "template-with-outer-lanes"
    ? templateWithOuterLanesRouteStrategy
    : templateOnlyRouteStrategy;
  let normalizedIntent = normalizeCoordinateRoutingIntent(normalizeResult.intent, routingOptions);
  if (engine === "suggest-initial-v2" || engine === "auto-arrange-v2") {
    normalizedIntent = optimizeGeneratedRoutingIntent(request.document, normalizedIntent, routeStrategy, context);
  }
  const prepared = applyCoordinateRoutingIntent(request.document, normalizedIntent, context);
  const routingContext: RoutingContext = { intent: normalizedIntent, run: context };
  context.logger.info({
    phase: "route",
    type: "route-strategy-selected",
    message: `Routing strategy ${routeStrategy.id} selected.`,
    data: { requestedRouteStrategy: options.routeStrategy, routeStrategy: routeStrategy.id }
  });
  if (options.routeStrategy === "astar") {
    context.logger.warn({
      phase: "route",
      type: "route-strategy-fallback",
      message: "A* routing is not implemented in this slice; using template-only routing."
    });
  }
  const routeResult = routeStrategy.route({
    document: prepared,
    intent: normalizedIntent,
    context: routingContext
  });
  const routedDocument = applyRouteResult(prepared, routeResult);
  const score = scoreLayout(routedDocument);
  const validation = validateRoutingResult(prepared, routedDocument, context, logger.events);
  const routingSummary = buildRoutingSummary({
    document: routedDocument,
    routeStrategy: routeStrategy.id,
    score,
    validation,
    events: logger.events
  });
  context.logger.log({
    level: routingSummary.hardValid ? "info" : "error",
    phase: "validate",
    type: routingSummary.hardValid ? "route-validation-passed" : "route-validation-failed",
    message: routingSummary.hardValid
      ? "Routing hard validation passed."
      : "Routing hard validation failed.",
    data: { routingSummary }
  });
  context.logger.info({
    phase: "route",
    type: "route-complete",
    message: `${engine} routed ${routeResult.edges.length} edges.`,
    data: {
      hardValid: routingSummary.hardValid,
      validEdges: routingSummary.validEdges,
      invalidEdges: routingSummary.invalidEdges
    }
  });
  const structuredDiagnostics = [
    ...routeResult.diagnostics,
    ...validation.diagnostics
  ];
  const document: DiagramDocument = {
    ...routedDocument,
    diagnostics: [
      ...routedDocument.diagnostics,
      ...logEventsToDiagnostics(logger.events)
    ],
    layout: {
      engine,
      score: {
        ...score,
        edgeIdentityViolations: routingSummary.edgeIdentityViolations,
        illegalSegmentOverlaps: routingSummary.illegalSegmentOverlaps,
        dividerNodeHits: routingSummary.dividerNodeHits,
        endpointDividerInteriorHits: routingSummary.endpointDividerInteriorHits,
        dividerSideOverflow: routingSummary.dividerSideOverflow,
        outerLaneUsages: routingSummary.outerLaneUsages,
        routingFailures: routingSummary.routingFailures
      },
      diagnostics: structuredDiagnostics
    }
  };

  return {
    document,
    report: logger.report(
      engine,
      forcedSourceFormat ?? normalizeResult.sourceFormat,
      options.traceRouting,
      routingSummary,
      structuredDiagnostics,
      validation.edgeResults
    )
  };
}

type GeneratedIntentCandidate = {
  name: string;
  intent: NormalizedCoordinateRoutingIntent;
};

type CandidateScoreVector = [
  hardFailures: number,
  edgeCrossings: number,
  illegalSegmentOverlaps: number,
  routingFallbacks: number,
  edgeBends: number,
  totalEdgeLength: number,
  layoutArea: number
];

function optimizeGeneratedRoutingIntent(
  document: DiagramDocument,
  intent: NormalizedCoordinateRoutingIntent,
  routeStrategy: RouteStrategy,
  context: LayoutRunContext
): NormalizedCoordinateRoutingIntent {
  const candidates = generatedRoutingIntentCandidates(document, intent);
  let best: { candidate: GeneratedIntentCandidate; vector: CandidateScoreVector } | undefined;

  for (const candidate of candidates) {
    const attemptLogger = new MemoryLayoutLogger();
    const attemptContext: LayoutRunContext = { logger: attemptLogger, options: context.options };
    const prepared = applyCoordinateRoutingIntent(document, candidate.intent, attemptContext);
    const routeResult = routeStrategy.route({
      document: prepared,
      intent: candidate.intent,
      context: { intent: candidate.intent, run: attemptContext }
    });
    const routed = applyRouteResult(prepared, routeResult);
    const score = scoreLayout(routed);
    const validation = validateRoutingResult(prepared, routed, attemptContext, attemptLogger.events);
    const routingFallbacks = validation.edgeResults.filter((edge) => edge.routingFallbackUsed || edge.routingFailed).length;
    const hardFailures =
      score.nodeOverlaps +
      score.groupOverlaps +
      validation.edgeNodeHits +
      validation.illegalSegmentOverlaps +
      validation.edgeIdentityViolations +
      validation.invalidDividers +
      routingFallbacks;
    const vector: CandidateScoreVector = [
      hardFailures,
      validation.edgeCrossings,
      validation.illegalSegmentOverlaps,
      routingFallbacks,
      score.edgeBends,
      score.totalEdgeLength,
      score.layoutArea
    ];

    context.logger.debug({
      phase: "route",
      type: "generated-layout-candidate-evaluated",
      message: `Generated routing layout candidate ${candidate.name} evaluated.`,
      data: { candidate: candidate.name, score: vector }
    });

    if (!best || compareScoreVector(vector, best.vector) < 0) {
      best = { candidate, vector };
    }

    if (vector[0] === 0 && vector[1] === 0) {
      break;
    }
  }

  return best?.candidate.intent ?? intent;
}

function generatedRoutingIntentCandidates(document: DiagramDocument, intent: NormalizedCoordinateRoutingIntent): GeneratedIntentCandidate[] {
  const candidates: GeneratedIntentCandidate[] = [
    { name: "normalized", intent }
  ];
  const variants: Array<{ xGap: number; yGap: number; packing: "original" | "vertical" }> = [
    { xGap: 440, yGap: 640, packing: "vertical" },
    { xGap: 440, yGap: 960, packing: "vertical" },
    { xGap: 700, yGap: 960, packing: "vertical" },
    { xGap: 700, yGap: 640, packing: "vertical" },
    { xGap: 440, yGap: 960, packing: "original" }
  ];

  for (const variant of variants) {
    candidates.push({
      name: `layered-${variant.packing}-x${variant.xGap}-y${variant.yGap}`,
      intent: createLayeredGeneratedIntent(document, intent, variant.xGap, variant.yGap, variant.packing)
    });
  }

  return candidates;
}

function createLayeredGeneratedIntent(
  document: DiagramDocument,
  intent: NormalizedCoordinateRoutingIntent,
  xGap: number,
  yGap: number,
  packingMode: "original" | "vertical"
): NormalizedCoordinateRoutingIntent {
  const groupByNodeId = new Map<string, string>();
  for (const groupId of intent.groupOrder) {
    const group = intent.groups[groupId];
    group?.nodeOrder.forEach((nodeId) => groupByNodeId.set(nodeId, groupId));
  }
  const layers = computeGroupLayers(document, intent, groupByNodeId);
  const groupsByLayer = new Map<number, string[]>();
  for (const groupId of intent.groupOrder) {
    const layer = layers.get(groupId) ?? 0;
    groupsByLayer.set(layer, [...(groupsByLayer.get(layer) ?? []), groupId]);
  }
  for (const [layer, groupIds] of groupsByLayer) {
    groupsByLayer.set(layer, orderLayerGroupIds(groupIds, document, groupByNodeId, intent));
  }

  const nextGroups = new Map<string, NormalizedGroupIntent>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const groupId of intent.groupOrder) {
    const group = intent.groups[groupId];
    if (!group) {
      continue;
    }
    const packing = packingMode === "vertical" ? "vertical" : group.packing;
    sizes.set(groupId, measureGeneratedGroup(document, group, packing));
    nextGroups.set(groupId, { ...group, packing });
  }

  const layerIds = [...groupsByLayer.keys()].sort((left, right) => left - right);
  const layerX = new Map<number, number>();
  let x = 0;
  for (const layer of layerIds) {
    layerX.set(layer, x);
    const maxWidth = Math.max(...(groupsByLayer.get(layer) ?? []).map((groupId) => sizes.get(groupId)?.width ?? 0), 0);
    x += maxWidth + xGap;
  }

  const layerBounds = new Map<number, { top: number; bottom: number; center: number }>();
  for (const layer of layerIds) {
    let y = 0;
    for (const groupId of groupsByLayer.get(layer) ?? []) {
      const group = nextGroups.get(groupId);
      const size = sizes.get(groupId);
      if (!group || !size) {
        continue;
      }
      nextGroups.set(groupId, { ...group, x: layerX.get(layer) ?? 0, y });
      y += size.height + yGap;
    }
    const bottom = Math.max(0, y - yGap);
    layerBounds.set(layer, { top: 0, bottom, center: bottom / 2 });
  }
  const globalCenter = Math.max(...[...layerBounds.values()].map((bounds) => bounds.center), 0);

  for (const layer of layerIds) {
    const groupIds = groupsByLayer.get(layer) ?? [];
    if (groupIds.length !== 1) {
      continue;
    }
    const groupId = groupIds[0];
    const group = nextGroups.get(groupId);
    const size = sizes.get(groupId);
    if (!group || !size) {
      continue;
    }
    const incomingSourceY = singleIncomingSourceY(groupId, document, groupByNodeId, nextGroups);
    const hasOutgoing = document.edges.some((edge) => groupByNodeId.get(edge.sourceId) === groupId && groupByNodeId.get(edge.targetId) !== groupId);
    const y = incomingSourceY !== undefined && !hasOutgoing
      ? incomingSourceY
      : Math.max(0, globalCenter - size.height / 2);
    nextGroups.set(groupId, { ...group, y });
  }

  return {
    ...intent,
    groups: Object.fromEntries(intent.groupOrder.map((groupId) => [groupId, nextGroups.get(groupId) ?? intent.groups[groupId]]))
  };
}

function computeGroupLayers(
  document: DiagramDocument,
  intent: NormalizedCoordinateRoutingIntent,
  groupByNodeId: Map<string, string>
): Map<string, number> {
  const layers = new Map(intent.groupOrder.map((groupId) => [groupId, 0]));
  for (let pass = 0; pass < intent.groupOrder.length; pass += 1) {
    let changed = false;
    for (const edge of document.edges) {
      const sourceGroupId = groupByNodeId.get(edge.sourceId);
      const targetGroupId = groupByNodeId.get(edge.targetId);
      if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
        continue;
      }
      const nextLayer = Math.min(intent.groupOrder.length - 1, (layers.get(sourceGroupId) ?? 0) + 1);
      if (nextLayer > (layers.get(targetGroupId) ?? 0)) {
        layers.set(targetGroupId, nextLayer);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return layers;
}

function orderLayerGroupIds(
  groupIds: string[],
  document: DiagramDocument,
  groupByNodeId: Map<string, string>,
  intent: NormalizedCoordinateRoutingIntent
): string[] {
  return [...groupIds].sort((left, right) =>
    firstEdgeIndexForGroup(left, document, groupByNodeId) - firstEdgeIndexForGroup(right, document, groupByNodeId) ||
    intent.groupOrder.indexOf(left) - intent.groupOrder.indexOf(right) ||
    left.localeCompare(right)
  );
}

function firstEdgeIndexForGroup(groupId: string, document: DiagramDocument, groupByNodeId: Map<string, string>): number {
  const index = document.edges.findIndex((edge) => groupByNodeId.get(edge.sourceId) === groupId || groupByNodeId.get(edge.targetId) === groupId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function singleIncomingSourceY(
  groupId: string,
  document: DiagramDocument,
  groupByNodeId: Map<string, string>,
  groups: Map<string, NormalizedGroupIntent>
): number | undefined {
  const incoming = document.edges
    .map((edge) => ({ sourceGroupId: groupByNodeId.get(edge.sourceId), targetGroupId: groupByNodeId.get(edge.targetId) }))
    .filter((edge) => edge.targetGroupId === groupId && edge.sourceGroupId && edge.sourceGroupId !== groupId)
    .map((edge) => groups.get(edge.sourceGroupId!))
    .filter((group): group is NormalizedGroupIntent => Boolean(group));
  if (incoming.length === 0) {
    return undefined;
  }
  return incoming.reduce((sum, group) => sum + group.y, 0) / incoming.length;
}

function measureGeneratedGroup(document: DiagramDocument, groupIntent: NormalizedGroupIntent, packing: "vertical" | "horizontal"): { width: number; height: number } {
  const nodeById = new Map(document.nodes.map((node) => [node.id, { ...node, layout: estimateClassNodeLayout(node) } satisfies DiagramNode]));
  const nodes: DiagramNode[] = [];
  for (const nodeId of groupIntent.nodeOrder) {
    const node = nodeById.get(nodeId);
    if (node) {
      nodes.push(node);
    }
  }
  const group: DiagramGroup = {
    id: groupIntent.id,
    label: groupIntent.label,
    kind: groupIntent.kind,
    nodeIds: nodes.map((node) => node.id),
    layout: { x: 0, y: 0, width: 0, height: 0 }
  };
  packGroup(group, nodes, packing);
  return { width: group.layout?.width ?? 0, height: group.layout?.height ?? 0 };
}

function compareScoreVector(left: CandidateScoreVector, right: CandidateScoreVector): number {
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > 0.001) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function applyCoordinateRoutingIntent(
  document: DiagramDocument,
  intent: NormalizedCoordinateRoutingIntent,
  context: LayoutRunContext
): DiagramDocument {
  const nodeById: Map<string, DiagramNode> = new Map(document.nodes.map((node) => [
    node.id,
    {
      ...node,
      layout: estimateClassNodeLayout(node)
    } satisfies DiagramNode
  ]));
  const groups: DiagramGroup[] = [];

  for (const groupId of intent.groupOrder) {
    const groupIntent = intent.groups[groupId];
    if (!groupIntent) {
      continue;
    }

    const groupNodes = groupIntent.nodeOrder
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is DiagramNode => Boolean(node));

    for (const node of groupNodes) {
      node.groupId = groupIntent.id;
    }

    const group: DiagramGroup = {
      id: groupIntent.id,
      label: groupIntent.label,
      kind: groupIntent.kind,
      nodeIds: groupNodes.map((node) => node.id),
      layout: {
        x: groupIntent.x,
        y: groupIntent.y,
        width: 0,
        height: 0
      }
    };

    packGroup(group, groupNodes, groupIntent.packing);
    groups.push(group);
    context.logger.debug({
      phase: "pack",
      type: "group-packed",
      message: `Group ${group.label} packed ${groupIntent.packing}.`,
      groupId: group.id,
      data: { x: group.layout?.x, y: group.layout?.y, nodeOrder: group.nodeIds }
    });
  }

  return {
    ...document,
    nodes: [...nodeById.values()],
    groups,
    routingDividers: undefined
  };
}

function packGroup(group: DiagramGroup, nodes: DiagramNode[], packing: "vertical" | "horizontal"): void {
  if (!group.layout) {
    throw new Error(`Group ${group.id} is missing layout.`);
  }

  if (nodes.length === 0) {
    group.layout.width = groupPadding * 2;
    group.layout.height = groupPadding * 2;
    return;
  }

  if (packing === "horizontal") {
    let x = group.layout.x + groupPadding;
    let maxHeight = 0;
    for (const node of nodes) {
      if (!node.layout) {
        throw new Error(`Node ${node.id} is missing layout.`);
      }
      node.layout.x = x;
      node.layout.y = group.layout.y + groupPadding;
      x += node.layout.width + nodeGapX;
      maxHeight = Math.max(maxHeight, node.layout.height);
    }
    group.layout.width = nodes.reduce((total, node) => total + (node.layout?.width ?? 0), 0) + nodeGapX * (nodes.length - 1) + groupPadding * 2;
    group.layout.height = maxHeight + groupPadding * 2;
    return;
  }

  let y = group.layout.y + groupPadding;
  let maxWidth = 0;
  for (const node of nodes) {
    if (!node.layout) {
      throw new Error(`Node ${node.id} is missing layout.`);
    }
    node.layout.x = group.layout.x + groupPadding;
    node.layout.y = y;
    y += node.layout.height + nodeGapY;
    maxWidth = Math.max(maxWidth, node.layout.width);
  }
  group.layout.width = maxWidth + groupPadding * 2;
  group.layout.height = nodes.reduce((total, node) => total + (node.layout?.height ?? 0), 0) + nodeGapY * (nodes.length - 1) + groupPadding * 2;
}

function applyRouteResult(document: DiagramDocument, routeResult: RouteResult): DiagramDocument {
  return {
    ...document,
    edges: routeResult.edges,
    routingDividers: routeResult.dividers.length > 0 ? routeResult.dividers : undefined,
    diagnostics: [...document.diagnostics, ...routeResult.diagnostics]
  };
}

function scoreLayout(document: DiagramDocument): DiagramLayoutScore {
  const paths = collectRoutingPaths(document).filter((path) => path.points.length >= 2);
  const nodeOverlaps = countRectangleOverlaps(document.nodes);
  const groupOverlaps = countRectangleOverlaps(document.groups ?? []);
  const edgeNodeHits = paths.reduce((sum, path) => sum + countRouteNodeHits(path, document.nodes), 0);
  const segmentOverlaps = countSegmentOverlaps(paths);
  const edgeCrossings = countEdgeCrossings(paths);
  const edgeBends = paths.reduce((sum, path) => sum + countBends(path.points), 0);
  const duplicateAnchors = countDuplicateAnchors(document.edges);
  const totalEdgeLength = paths.reduce((sum, path) => sum + pathLength(path.points), 0);
  const bounds = layoutBounds(document);
  const layoutArea = bounds.width * bounds.height;
  const value =
    edgeNodeHits * scoreWeights.edgeNodeHits +
    nodeOverlaps * scoreWeights.nodeOverlaps +
    groupOverlaps * scoreWeights.groupOverlaps +
    edgeCrossings * scoreWeights.edgeCrossings +
    segmentOverlaps * scoreWeights.segmentOverlaps +
    duplicateAnchors * scoreWeights.duplicateAnchors +
    edgeBends * scoreWeights.edgeBends +
    totalEdgeLength * scoreWeights.edgeLength +
    layoutArea * scoreWeights.compactArea;

  return {
    value,
    nodeOverlaps,
    groupOverlaps,
    edgeNodeHits,
    segmentOverlaps,
    edgeCrossings,
    edgeBends,
    duplicateAnchors,
    totalEdgeLength,
    layoutWidth: bounds.width,
    layoutHeight: bounds.height,
    layoutArea
  };
}

function edgePathPoints(edge: DiagramEdge, nodes: DiagramNode[]): DiagramPoint[] {
  const source = nodes.find((node) => node.id === edge.sourceId);
  const target = nodes.find((node) => node.id === edge.targetId);
  if (!source?.layout || !target?.layout) {
    return [];
  }

  return [
    edge.layout?.sourceAnchor ? anchorPoint(source.layout, edge.layout.sourceAnchor) : center(source.layout),
    ...(edge.layout?.waypoints ?? []),
    edge.layout?.targetAnchor ? anchorPoint(target.layout, edge.layout.targetAnchor) : center(target.layout)
  ];
}

function anchorPoint(rectangle: { x: number; y: number; width: number; height: number }, anchor: DiagramEdgeAnchor): DiagramPoint {
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

function center(rectangle: { x: number; y: number; width: number; height: number }): DiagramPoint {
  return {
    x: rectangle.x + rectangle.width / 2,
    y: rectangle.y + rectangle.height / 2
  };
}

function countEdgeNodeHits(edge: DiagramEdge, points: DiagramPoint[], nodes: DiagramNode[]): number {
  let hits = 0;
  for (const [start, end] of pathSegments(points)) {
    for (const node of nodes) {
      if (node.id === edge.sourceId || node.id === edge.targetId || !node.layout) {
        continue;
      }
      if (segmentIntersectsRectangle(start, end, node.layout)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function countRectangleOverlaps(items: Array<{ layout?: { x: number; y: number; width: number; height: number } }>): number {
  const rectangles = items.map((item) => item.layout).filter((layout): layout is { x: number; y: number; width: number; height: number } => Boolean(layout));
  let overlaps = 0;
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      if (rectanglesOverlap(rectangles[leftIndex], rectangles[rightIndex])) {
        overlaps += 1;
      }
    }
  }
  return overlaps;
}

function countSegmentOverlaps(paths: Array<{ points: DiagramPoint[] }>): number {
  let overlaps = 0;
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      for (const [leftStart, leftEnd] of pathSegments(paths[leftIndex].points)) {
        for (const [rightStart, rightEnd] of pathSegments(paths[rightIndex].points)) {
          if (segmentsOverlap(leftStart, leftEnd, rightStart, rightEnd)) {
            overlaps += 1;
          }
        }
      }
    }
  }
  return overlaps;
}

function countEdgeCrossings(paths: Array<{ points: DiagramPoint[] }>): number {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      for (const [leftStart, leftEnd] of pathSegments(paths[leftIndex].points)) {
        for (const [rightStart, rightEnd] of pathSegments(paths[rightIndex].points)) {
          if (
            !segmentsOverlap(leftStart, leftEnd, rightStart, rightEnd) &&
            segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd) &&
            !pointsEqual(leftStart, rightStart) &&
            !pointsEqual(leftStart, rightEnd) &&
            !pointsEqual(leftEnd, rightStart) &&
            !pointsEqual(leftEnd, rightEnd)
          ) {
            crossings += 1;
          }
        }
      }
    }
  }
  return crossings;
}

function countDuplicateAnchors(edges: DiagramEdge[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const edge of edges) {
    for (const endpoint of ["source", "target"] as const) {
      const nodeId = endpoint === "source" ? edge.sourceId : edge.targetId;
      const anchor = endpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;
      if (!anchor) {
        continue;
      }
      const key = `${nodeId}:${anchor.side}:${anchor.ratio.toFixed(3)}`;
      if (seen.has(key)) {
        duplicates += 1;
      }
      seen.add(key);
    }
  }
  return duplicates;
}

function layoutBounds(document: DiagramDocument): { width: number; height: number } {
  const rectangles = [
    ...document.nodes.map((node) => node.layout),
    ...(document.groups ?? []).map((group) => group.layout),
    ...(document.routingDividers ?? []).map((divider) => divider.layout)
  ].filter((layout): layout is { x: number; y: number; width: number; height: number } => Boolean(layout));

  if (rectangles.length === 0) {
    return { width: 0, height: 0 };
  }

  const minX = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const minY = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const maxX = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const maxY = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));

  return {
    width: maxX - minX,
    height: maxY - minY
  };
}

function pathSegments(points: DiagramPoint[]): Array<[DiagramPoint, DiagramPoint]> {
  const segments: Array<[DiagramPoint, DiagramPoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

function countBends(points: DiagramPoint[]): number {
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

function pathLength(points: DiagramPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return length;
}

function segmentIntersectsRectangle(start: DiagramPoint, end: DiagramPoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  if (start.x === end.x) {
    return start.x > rect.x && start.x < rect.x + rect.width && rangesOverlap(start.y, end.y, rect.y, rect.y + rect.height);
  }
  if (start.y === end.y) {
    return start.y > rect.y && start.y < rect.y + rect.height && rangesOverlap(start.x, end.x, rect.x, rect.x + rect.width);
  }
  return false;
}

function rectanglesOverlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function segmentsOverlap(leftStart: DiagramPoint, leftEnd: DiagramPoint, rightStart: DiagramPoint, rightEnd: DiagramPoint): boolean {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
    return rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }
  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
    return rangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }
  return false;
}

function segmentsIntersect(firstStart: DiagramPoint, firstEnd: DiagramPoint, secondStart: DiagramPoint, secondEnd: DiagramPoint): boolean {
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
    orientation(firstStart, firstEnd, secondStart) * orientation(firstStart, firstEnd, secondEnd) <= 0 &&
    orientation(secondStart, secondEnd, firstStart) * orientation(secondStart, secondEnd, firstEnd) <= 0;
}

function orientation(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  const firstMin = Math.min(a, b);
  const firstMax = Math.max(a, b);
  const secondMin = Math.min(c, d);
  const secondMax = Math.max(c, d);
  return firstMin < secondMax && firstMax > secondMin;
}

function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

