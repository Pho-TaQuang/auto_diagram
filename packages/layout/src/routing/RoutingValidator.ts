import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramNode,
  DiagramPoint
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { LayoutLogEvent } from "../engine/LayoutRunReport.js";
import type { RouteResult, RoutingContext } from "./RouteStrategy.js";

const epsilon = 0.001;

type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoutingPath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
  terminalIds: Set<string>;
};

export type RoutingValidationResult = {
  valid: boolean;
  errors: LayoutLogEvent[];
  edgeIdentityViolations: number;
  illegalSharedSegments: number;
  invalidDividers: number;
  edgeNodeHits: number;
  validEdges: number;
  invalidEdges: number;
  invalidEdgeIds: string[];
};

export interface RoutingValidator {
  validate(result: RouteResult, context: RoutingContext): RoutingValidationResult;
}

export function validateRoutedDocument(
  originalDocument: DiagramDocument,
  document: DiagramDocument,
  context: LayoutRunContext
): RoutingValidationResult {
  let edgeIdentityViolations = 0;
  let illegalSharedSegments = 0;
  let invalidDividers = 0;
  let edgeNodeHits = 0;
  const errors: LayoutLogEvent[] = [];
  const invalidEdgeIds = new Set<string>();
  const originalEdgeById = new Map(originalDocument.edges.map((edge) => [edge.id, edge]));
  const routedEdgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const paths = collectRoutingPaths(document).filter((path) => path.points.length >= 2);
  const nodeHitsByEdgeId = new Map<string, number>();

  for (const edge of document.edges) {
    const original = originalEdgeById.get(edge.id);
    if (original && (original.sourceId !== edge.sourceId || original.targetId !== edge.targetId)) {
      edgeIdentityViolations += 1;
      invalidEdgeIds.add(edge.id);
      pushValidationError(context, errors, {
        phase: "validate",
        type: "edge-identity-violation",
        message: `Edge ${edge.id} changed source or target during routing.`,
        edgeId: edge.id
      });
    }
  }

  for (const path of paths) {
    const hits = countRouteNodeHits(path, document.nodes);
    if (hits === 0) {
      continue;
    }
    edgeNodeHits += hits;
    nodeHitsByEdgeId.set(path.edge.id, (nodeHitsByEdgeId.get(path.edge.id) ?? 0) + hits);
    invalidEdgeIds.add(path.edge.id);
  }

  for (const [edgeId, hits] of nodeHitsByEdgeId) {
    pushValidationError(context, errors, {
      phase: "validate",
      type: "edge-node-hit",
      message: `Edge ${edgeId} crosses ${hits} non-terminal node${hits === 1 ? "" : "s"}.`,
      edgeId,
      data: { nodeHits: hits }
    });
  }

  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      if (canShareSegment(left.edge, right.edge)) {
        continue;
      }
      for (const [leftStart, leftEnd] of pathSegments(left.points)) {
        for (const [rightStart, rightEnd] of pathSegments(right.points)) {
          if (segmentsOverlap(leftStart, leftEnd, rightStart, rightEnd)) {
            illegalSharedSegments += 1;
            invalidEdgeIds.add(left.edge.id);
            invalidEdgeIds.add(right.edge.id);
            pushValidationError(context, errors, {
              phase: "validate",
              type: "illegal-shared-segment",
              message: `Edges ${left.edge.id} and ${right.edge.id} share a segment without a common source or target.`,
              edgeId: left.edge.id,
              data: { otherEdgeId: right.edge.id }
            });
          }
        }
      }
    }
  }

  for (const divider of document.routingDividers ?? []) {
    const dividerEdges = divider.sourceEdgeIds
      .map((edgeId) => routedEdgeById.get(edgeId))
      .filter((edge): edge is DiagramEdge => Boolean(edge));
    const valid = divider.mode === "fanOut"
      ? new Set(dividerEdges.map((edge) => edge.sourceId)).size === 1
      : new Set(dividerEdges.map((edge) => edge.targetId)).size === 1;

    if (!valid) {
      invalidDividers += 1;
      divider.sourceEdgeIds.forEach((edgeId) => invalidEdgeIds.add(edgeId));
      pushValidationError(context, errors, {
        phase: "validate",
        type: "invalid-divider-group",
        message: `Routing divider ${divider.id} is not a legal ${divider.mode} group.`,
        dividerId: divider.id
      });
    }
  }

  const invalidEdges = invalidEdgeIds.size;
  const validEdges = Math.max(0, document.edges.length - invalidEdges);

  return {
    valid: edgeIdentityViolations === 0 &&
      edgeNodeHits === 0 &&
      illegalSharedSegments === 0 &&
      invalidDividers === 0,
    errors,
    edgeIdentityViolations,
    illegalSharedSegments,
    invalidDividers,
    edgeNodeHits,
    validEdges,
    invalidEdges,
    invalidEdgeIds: [...invalidEdgeIds].sort()
  };
}

export function collectRoutingPaths(document: DiagramDocument): RoutingPath[] {
  const endpointById = createEndpointMap(document);
  const paths: RoutingPath[] = [];

  for (const edge of document.edges) {
    const segments = edge.layout?.routedSegments;
    if (segments && segments.length > 0) {
      for (const segment of segments) {
        const source = endpointById.get(segment.sourceId);
        const target = endpointById.get(segment.targetId);
        if (!source || !target) {
          continue;
        }
        paths.push({
          edge,
          terminalIds: new Set([segment.sourceId, segment.targetId]),
          points: pathPoints(
            source,
            target,
            segment.sourceAnchor,
            segment.targetAnchor,
            segment.waypoints
          )
        });
      }
      continue;
    }

    const source = endpointById.get(edge.sourceId);
    const target = endpointById.get(edge.targetId);
    if (!source || !target) {
      continue;
    }
    paths.push({
      edge,
      terminalIds: new Set([edge.sourceId, edge.targetId]),
      points: pathPoints(
        source,
        target,
        edge.layout?.sourceAnchor,
        edge.layout?.targetAnchor,
        edge.layout?.waypoints ?? []
      )
    });
  }

  return paths;
}

export function countRouteNodeHits(path: RoutingPath, nodes: DiagramNode[]): number {
  let hits = 0;
  for (const [start, end] of pathSegments(path.points)) {
    for (const node of nodes) {
      if (path.terminalIds.has(node.id) || !node.layout) {
        continue;
      }
      if (segmentIntersectsRectangle(start, end, node.layout)) {
        hits += 1;
      }
    }
  }
  return hits;
}

export function countBends(points: DiagramPoint[]): number {
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

export function pathLength(points: DiagramPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return length;
}

export function pathSegments(points: DiagramPoint[]): Array<[DiagramPoint, DiagramPoint]> {
  const segments: Array<[DiagramPoint, DiagramPoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

export function segmentsOverlap(leftStart: DiagramPoint, leftEnd: DiagramPoint, rightStart: DiagramPoint, rightEnd: DiagramPoint): boolean {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && Math.abs(leftStart.x - rightStart.x) < epsilon) {
    return rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }
  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && Math.abs(leftStart.y - rightStart.y) < epsilon) {
    return rangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }
  return false;
}

export function segmentsIntersect(firstStart: DiagramPoint, firstEnd: DiagramPoint, secondStart: DiagramPoint, secondEnd: DiagramPoint): boolean {
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

export function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < epsilon && Math.abs(left.y - right.y) < epsilon;
}

export function canShareSegment(left: DiagramEdge, right: DiagramEdge): boolean {
  return left.sourceId === right.sourceId || left.targetId === right.targetId;
}

function pushValidationError(
  context: LayoutRunContext,
  errors: LayoutLogEvent[],
  event: Omit<LayoutLogEvent, "level">
): void {
  const fullEvent: LayoutLogEvent = { ...event, level: "error" };
  errors.push(fullEvent);
  context.logger.log(fullEvent);
}

function createEndpointMap(document: DiagramDocument): Map<string, Rectangle> {
  return new Map([
    ...document.nodes
      .filter((node) => Boolean(node.layout))
      .map((node) => [node.id, requireLayoutRectangle(node.id, node.layout)] as const),
    ...(document.routingDividers ?? [])
      .map((divider) => [divider.id, requireLayoutRectangle(divider.id, divider.layout)] as const)
  ]);
}

function requireLayoutRectangle(id: string, layout: { x: number; y: number; width: number; height: number } | undefined): Rectangle {
  if (!layout) {
    throw new Error(`Endpoint ${id} is missing layout.`);
  }
  return {
    id,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height
  };
}

function pathPoints(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor | undefined,
  targetAnchor: DiagramEdgeAnchor | undefined,
  waypoints: DiagramPoint[]
): DiagramPoint[] {
  return [
    sourceAnchor ? anchorPoint(source, sourceAnchor) : center(source),
    ...waypoints,
    targetAnchor ? anchorPoint(target, targetAnchor) : center(target)
  ];
}

function anchorPoint(rectangle: Rectangle, anchor: DiagramEdgeAnchor): DiagramPoint {
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

function center(rectangle: Rectangle): DiagramPoint {
  return {
    x: rectangle.x + rectangle.width / 2,
    y: rectangle.y + rectangle.height / 2
  };
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

function orientation(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < epsilon) {
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
