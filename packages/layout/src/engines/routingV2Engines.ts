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
  type NormalizedCoordinateRoutingIntent
} from "../normalizers/coordinateRoutingLayoutV3.js";
import { buildRoutingSummary } from "../routing/RoutingSummary.js";
import {
  collectRoutingPaths,
  countRouteNodeHits,
  validateRoutedDocument as validateRoutingResult
} from "../routing/RoutingValidator.js";
import { templateOnlyRouteStrategy, templateWithOuterLanesRouteStrategy } from "../routing/templateRouter.js";
import type { RouteResult, RoutingContext } from "../routing/RouteStrategy.js";

const groupPadding = 32;
const nodeGapX = 80;
const nodeGapY = 80;
const scoreWeights = {
  edgeNodeHits: 1_000_000_000,
  nodeOverlaps: 800_000_000,
  groupOverlaps: 500_000_000,
  edgeCrossings: 250_000_000,
  segmentOverlaps: 100_000_000,
  duplicateAnchors: 10_000_000,
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
  const normalizedIntent = normalizeCoordinateRoutingIntent(normalizeResult.intent, routingOptions);
  const prepared = applyCoordinateRoutingIntent(request.document, normalizedIntent, context);
  const routingContext: RoutingContext = { intent: normalizedIntent, run: context };
  const routeStrategy = options.routeStrategy === "template-with-outer-lanes"
    ? templateWithOuterLanesRouteStrategy
    : templateOnlyRouteStrategy;
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
  const validation = validateRoutingResult(prepared, routedDocument, context);
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
        invalidSharedSegments: routingSummary.illegalSharedSegments,
        outerLaneUsages: routingSummary.outerLaneUsages,
        routingFailures: routingSummary.routingFailures
      }
    }
  };

  return {
    document,
    report: logger.report(engine, forcedSourceFormat ?? normalizeResult.sourceFormat, options.traceRouting, routingSummary)
  };
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

function canShareSegment(left: DiagramEdge, right: DiagramEdge): boolean {
  return left.sourceId === right.sourceId || left.targetId === right.targetId;
}
