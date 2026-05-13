import type {
  DiagramDiagnostic,
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramNode,
  DiagramPoint,
  DiagramRoutedEdgeSegment,
  DiagramRoutingDivider
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type {
  EdgeRoutingValidationResult,
  LayoutLogEvent,
  RoutingEdgeCrossingRef,
  RoutingNodeHitRef,
  RoutingSegmentOverlapRef,
  RoutingSegmentRef
} from "../engine/LayoutRunReport.js";
import type { RouteResult, RoutingContext } from "./RouteStrategy.js";

const epsilon = 0.001;
const dividerMinimumEdgeCount = 4;
const defaultLayoutChangeAmount = 120;

type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ValidDividerInfo = {
  divider: DiagramRoutingDivider;
  commonNodeId: string;
};

export type RoutingPath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
  terminalIds: Set<string>;
  segmentId?: string;
  trunkDividerId?: string;
};

export type RoutingValidationResult = {
  valid: boolean;
  errors: LayoutLogEvent[];
  diagnostics: DiagramDiagnostic[];
  edgeResults: EdgeRoutingValidationResult[];
  edgeIdentityViolations: number;
  illegalSegmentOverlaps: number;
  invalidDividers: number;
  edgeNodeHits: number;
  segmentOverlaps: number;
  edgeCrossings: number;
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
  context: LayoutRunContext,
  events: LayoutLogEvent[] = []
): RoutingValidationResult {
  let edgeIdentityViolations = 0;
  let illegalSegmentOverlaps = 0;
  let invalidDividers = 0;
  let edgeNodeHits = 0;
  let segmentOverlaps = 0;
  let edgeCrossings = 0;
  const errors: LayoutLogEvent[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const invalidEdgeIds = new Set<string>();
  const originalEdgeById = new Map(originalDocument.edges.map((edge) => [edge.id, edge]));
  const routedEdgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const edgeResultsById = new Map(document.edges.map((edge) => [edge.id, createEdgeResult(edge.id)]));
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));

  for (const event of events) {
    if ((event.type !== "routing-fallback-used" && event.type !== "routing-failed") || !event.edgeId) {
      continue;
    }
    const result = requireEdgeResult(edgeResultsById, event.edgeId);
    if (event.type === "routing-fallback-used") {
      result.routingFallbackUsed = true;
    } else {
      result.routingFailed = true;
    }
    invalidEdgeIds.add(event.edgeId);
    diagnostics.push(layoutChangeDiagnostic({
      reason: "routing-failure",
      message: `Edge ${event.edgeId} used a best-effort route because no hard-valid candidate was found.`,
      edgeIds: [event.edgeId],
      groupIds: groupIdsForEdgeIds(document, [event.edgeId])
    }));
  }

  for (const edge of document.edges) {
    const original = originalEdgeById.get(edge.id);
    if (original && (original.sourceId !== edge.sourceId || original.targetId !== edge.targetId)) {
      edgeIdentityViolations += 1;
      invalidEdgeIds.add(edge.id);
      requireEdgeResult(edgeResultsById, edge.id).edgeIdentityViolations.push("source-target-changed");
      pushValidationError(context, errors, {
        phase: "validate",
        type: "edge-identity-violation",
        message: `Edge ${edge.id} changed source or target during routing.`,
        edgeId: edge.id
      });
    }
  }

  const { validDividerById, invalidDividerIds } = validateRoutingDividers(
    document.routingDividers ?? [],
    routedEdgeById,
    edgeResultsById,
    invalidEdgeIds,
    context,
    errors,
    diagnostics,
    document
  );
  invalidDividers = invalidDividerIds.length;

  const paths = collectRoutingPaths(document, validDividerById).filter((path) => path.points.length >= 2);
  const nodeHitsByEdgeId = new Map<string, RoutingNodeHitRef[]>();

  for (const path of paths) {
    const hits = collectRouteNodeHits(path, document.nodes);
    if (hits.length === 0) {
      continue;
    }
    edgeNodeHits += hits.length;
    nodeHitsByEdgeId.set(path.edge.id, [...(nodeHitsByEdgeId.get(path.edge.id) ?? []), ...hits]);
    const result = requireEdgeResult(edgeResultsById, path.edge.id);
    result.nodeHits.push(...hits);
    invalidEdgeIds.add(path.edge.id);
  }

  for (const [edgeId, hits] of nodeHitsByEdgeId) {
    const nodeIds = unique(hits.map((hit) => hit.nodeId));
    pushValidationError(context, errors, {
      phase: "validate",
      type: "edge-node-hit",
      message: `Edge ${edgeId} crosses ${hits.length} non-terminal node${hits.length === 1 ? "" : "s"}.`,
      edgeId,
      data: { nodeHits: hits.length, nodeIds }
    });
    diagnostics.push(layoutChangeDiagnostic({
      reason: "edge-node-hit",
      message: `Edge ${edgeId} crosses non-terminal node${hits.length === 1 ? "" : "s"}: ${nodeIds.join(", ")}.`,
      edgeIds: [edgeId],
      groupIds: groupIdsForEdgeIds(document, [edgeId], nodeIds)
    }));
  }

  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      if (left.edge.id === right.edge.id) {
        continue;
      }

      for (const leftSegment of pathSegmentsWithRefs(left)) {
        for (const rightSegment of pathSegmentsWithRefs(right)) {
          if (segmentsOverlap(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end)) {
            const dividerExempt = isDividerTrunkOverlapExempt(left, right);
            const leftOverlap = segmentOverlapRef(right.edge.id, leftSegment.ref, rightSegment.ref, dividerExempt);
            const rightOverlap = segmentOverlapRef(left.edge.id, rightSegment.ref, leftSegment.ref, dividerExempt);
            segmentOverlaps += 1;
            requireEdgeResult(edgeResultsById, left.edge.id).segmentOverlaps.push(leftOverlap);
            requireEdgeResult(edgeResultsById, right.edge.id).segmentOverlaps.push(rightOverlap);

            if (!dividerExempt) {
              illegalSegmentOverlaps += 1;
              requireEdgeResult(edgeResultsById, left.edge.id).illegalSegmentOverlaps.push(leftOverlap);
              requireEdgeResult(edgeResultsById, right.edge.id).illegalSegmentOverlaps.push(rightOverlap);
              invalidEdgeIds.add(left.edge.id);
              invalidEdgeIds.add(right.edge.id);
              pushValidationError(context, errors, {
                phase: "validate",
                type: "illegal-segment-overlap",
                message: `Edges ${left.edge.id} and ${right.edge.id} share a route segment outside a valid divider.`,
                edgeId: left.edge.id,
                data: { otherEdgeId: right.edge.id, segment: leftSegment.ref, otherSegment: rightSegment.ref }
              });
              diagnostics.push(layoutChangeDiagnostic({
                reason: "illegal-segment-overlap",
                message: `Edges ${left.edge.id} and ${right.edge.id} share a route segment outside a valid divider.`,
                edgeIds: [left.edge.id, right.edge.id],
                groupIds: groupIdsForEdgeIds(document, [left.edge.id, right.edge.id])
              }));
            }
            continue;
          }

          if (
            segmentsIntersect(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end) &&
            !pointsEqual(leftSegment.start, rightSegment.start) &&
            !pointsEqual(leftSegment.start, rightSegment.end) &&
            !pointsEqual(leftSegment.end, rightSegment.start) &&
            !pointsEqual(leftSegment.end, rightSegment.end)
          ) {
            const leftCrossing = edgeCrossingRef(right.edge.id, leftSegment.ref, rightSegment.ref, intersectionPoint(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end));
            const rightCrossing = edgeCrossingRef(left.edge.id, rightSegment.ref, leftSegment.ref, leftCrossing.point);
            edgeCrossings += 1;
            requireEdgeResult(edgeResultsById, left.edge.id).edgeCrossings.push(leftCrossing);
            requireEdgeResult(edgeResultsById, right.edge.id).edgeCrossings.push(rightCrossing);
            const message = `Edges ${left.edge.id} and ${right.edge.id} cross.`;
            context.logger.warn({
              phase: "validate",
              type: "edge-crossing",
              message,
              edgeId: left.edge.id,
              data: { otherEdgeId: right.edge.id, segment: leftSegment.ref, otherSegment: rightSegment.ref }
            });
            diagnostics.push({
              severity: "warning",
              type: "edge-crossing",
              reason: "edge-crossing",
              message,
              edgeIds: [left.edge.id, right.edge.id],
              groupIds: groupIdsForEdgeIds(document, [left.edge.id, right.edge.id])
            });
          }
        }
      }
    }
  }

  const edgeResults = [...edgeResultsById.values()].map((result) => ({
    ...result,
    nodeHits: sortNodeHits(result.nodeHits),
    edgeCrossings: sortCrossings(result.edgeCrossings),
    segmentOverlaps: sortOverlaps(result.segmentOverlaps),
    illegalSegmentOverlaps: sortOverlaps(result.illegalSegmentOverlaps),
    invalidDividers: unique(result.invalidDividers).sort(),
    edgeIdentityViolations: unique(result.edgeIdentityViolations).sort(),
    hardValid: result.nodeHits.length === 0 &&
      result.illegalSegmentOverlaps.length === 0 &&
      !result.routingFallbackUsed &&
      !result.routingFailed &&
      result.invalidDividers.length === 0 &&
      result.edgeIdentityViolations.length === 0
  }));

  for (const result of edgeResults) {
    if (!result.hardValid) {
      invalidEdgeIds.add(result.edgeId);
    }
  }

  const invalidEdges = invalidEdgeIds.size;
  const validEdges = Math.max(0, document.edges.length - invalidEdges);

  return {
    valid: edgeIdentityViolations === 0 &&
      edgeNodeHits === 0 &&
      illegalSegmentOverlaps === 0 &&
      invalidDividers === 0 &&
      edgeResults.every((result) => !result.routingFallbackUsed && !result.routingFailed),
    errors,
    diagnostics,
    edgeResults: edgeResults.sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
    edgeIdentityViolations,
    illegalSegmentOverlaps,
    invalidDividers,
    edgeNodeHits,
    segmentOverlaps,
    edgeCrossings,
    validEdges,
    invalidEdges,
    invalidEdgeIds: [...invalidEdgeIds].sort()
  };
}

export function collectRoutingPaths(
  document: DiagramDocument,
  validDividerById: Map<string, ValidDividerInfo> = new Map()
): RoutingPath[] {
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
          segmentId: segment.id,
          trunkDividerId: trunkDividerIdForSegment(segment, validDividerById),
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
  return collectRouteNodeHits(path, nodes).length;
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

function createEdgeResult(edgeId: string): EdgeRoutingValidationResult {
  return {
    edgeId,
    nodeHits: [],
    edgeCrossings: [],
    segmentOverlaps: [],
    illegalSegmentOverlaps: [],
    routingFallbackUsed: false,
    routingFailed: false,
    invalidDividers: [],
    edgeIdentityViolations: [],
    hardValid: true
  };
}

function validateRoutingDividers(
  dividers: DiagramRoutingDivider[],
  edgeById: Map<string, DiagramEdge>,
  edgeResultsById: Map<string, EdgeRoutingValidationResult>,
  invalidEdgeIds: Set<string>,
  context: LayoutRunContext,
  errors: LayoutLogEvent[],
  diagnostics: DiagramDiagnostic[],
  document: DiagramDocument
): { validDividerById: Map<string, ValidDividerInfo>; invalidDividerIds: string[] } {
  const validDividerById = new Map<string, ValidDividerInfo>();
  const invalidDividerIds: string[] = [];

  for (const divider of dividers) {
    const dividerEdges = divider.sourceEdgeIds
      .map((edgeId) => edgeById.get(edgeId))
      .filter((edge): edge is DiagramEdge => Boolean(edge));
    const hasMissingEdge = dividerEdges.length !== divider.sourceEdgeIds.length;
    const hasEnoughEdges = divider.sourceEdgeIds.length > dividerMinimumEdgeCount;
    const sourceIds = new Set(dividerEdges.map((edge) => edge.sourceId));
    const targetIds = new Set(dividerEdges.map((edge) => edge.targetId));
    const commonNodeId = divider.mode === "fanOut"
      ? [...sourceIds][0]
      : [...targetIds][0];
    const valid = !hasMissingEdge &&
      hasEnoughEdges &&
      (divider.mode === "fanOut"
        ? sourceIds.size === 1
        : targetIds.size === 1);

    if (valid && commonNodeId) {
      validDividerById.set(divider.id, { divider, commonNodeId });
      continue;
    }

    invalidDividerIds.push(divider.id);
    divider.sourceEdgeIds.forEach((edgeId) => {
      invalidEdgeIds.add(edgeId);
      const result = edgeResultsById.get(edgeId);
      if (result) {
        result.invalidDividers.push(divider.id);
      }
    });
    pushValidationError(context, errors, {
      phase: "validate",
      type: "invalid-divider-group",
      message: `Routing divider ${divider.id} is not a legal ${divider.mode} group.`,
      dividerId: divider.id,
      data: {
        edgeCount: divider.sourceEdgeIds.length,
        minimumExclusiveEdgeCount: dividerMinimumEdgeCount,
        hasMissingEdge
      }
    });
    diagnostics.push(layoutChangeDiagnostic({
      reason: "invalid-divider",
      message: `Routing divider ${divider.id} is not a legal ${divider.mode} group.`,
      edgeIds: divider.sourceEdgeIds,
      groupIds: groupIdsForEdgeIds(document, divider.sourceEdgeIds)
    }));
  }

  return { validDividerById, invalidDividerIds };
}

function collectRouteNodeHits(path: RoutingPath, nodes: DiagramNode[]): RoutingNodeHitRef[] {
  const hits: RoutingNodeHitRef[] = [];
  for (const segment of pathSegmentsWithRefs(path)) {
    for (const node of nodes) {
      if (path.terminalIds.has(node.id) || !node.layout) {
        continue;
      }
      if (segmentIntersectsRectangle(segment.start, segment.end, node.layout)) {
        hits.push({
          nodeId: node.id,
          segment: segment.ref
        });
      }
    }
  }
  return hits;
}

function pathSegmentsWithRefs(path: RoutingPath): Array<{ start: DiagramPoint; end: DiagramPoint; ref: RoutingSegmentRef }> {
  return pathSegments(path.points).map(([start, end], segmentIndex) => ({
    start,
    end,
    ref: {
      edgeId: path.edge.id,
      ...(path.segmentId ? { segmentId: path.segmentId } : {}),
      segmentIndex
    }
  }));
}

function segmentOverlapRef(
  otherEdgeId: string,
  segment: RoutingSegmentRef,
  otherSegment: RoutingSegmentRef,
  dividerExempt: boolean
): RoutingSegmentOverlapRef {
  return { otherEdgeId, segment, otherSegment, dividerExempt };
}

function edgeCrossingRef(
  otherEdgeId: string,
  segment: RoutingSegmentRef,
  otherSegment: RoutingSegmentRef,
  point: DiagramPoint | undefined
): RoutingEdgeCrossingRef {
  return {
    otherEdgeId,
    segment,
    otherSegment,
    ...(point ? { point } : {})
  };
}

function isDividerTrunkOverlapExempt(left: RoutingPath, right: RoutingPath): boolean {
  return Boolean(left.trunkDividerId && left.trunkDividerId === right.trunkDividerId);
}

function trunkDividerIdForSegment(
  segment: DiagramRoutedEdgeSegment,
  validDividerById: Map<string, ValidDividerInfo>
): string | undefined {
  if (segment.strategy !== "divider") {
    return undefined;
  }

  for (const { divider, commonNodeId } of validDividerById.values()) {
    if (
      divider.mode === "fanOut" &&
      segment.sourceId === commonNodeId &&
      segment.targetId === divider.id
    ) {
      return divider.id;
    }

    if (
      divider.mode === "fanIn" &&
      segment.sourceId === divider.id &&
      segment.targetId === commonNodeId
    ) {
      return divider.id;
    }
  }

  return undefined;
}

function requireEdgeResult(edgeResultsById: Map<string, EdgeRoutingValidationResult>, edgeId: string): EdgeRoutingValidationResult {
  const result = edgeResultsById.get(edgeId);
  if (!result) {
    throw new Error(`Missing edge validation result for ${edgeId}.`);
  }
  return result;
}

function layoutChangeDiagnostic(input: {
  reason: Exclude<NonNullable<DiagramDiagnostic["reason"]>, "edge-crossing">;
  message: string;
  edgeIds: string[];
  groupIds: string[];
}): DiagramDiagnostic {
  return {
    severity: "error",
    type: "layout-change-required",
    reason: input.reason,
    message: input.message,
    edgeIds: unique(input.edgeIds).sort(),
    groupIds: unique(input.groupIds).sort(),
    recommendedAction: recommendedAction(input.groupIds)
  };
}

function recommendedAction(groupIds: string[]): DiagramDiagnostic["recommendedAction"] {
  const uniqueGroupIds = unique(groupIds);
  if (uniqueGroupIds.length >= 2) {
    return {
      kind: "increase-gap",
      betweenGroupIds: [uniqueGroupIds[0], uniqueGroupIds[1]],
      direction: "x",
      amount: defaultLayoutChangeAmount
    };
  }
  if (uniqueGroupIds.length === 1) {
    return {
      kind: "move-group",
      groupId: uniqueGroupIds[0],
      direction: "right",
      amount: defaultLayoutChangeAmount
    };
  }
  return undefined;
}

function groupIdsForEdgeIds(document: DiagramDocument, edgeIds: string[], extraNodeIds: string[] = []): string[] {
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const groupIds: string[] = [];

  for (const edgeId of edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      continue;
    }
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      const groupId = nodeById.get(nodeId)?.groupId;
      if (groupId) {
        groupIds.push(groupId);
      }
    }
  }

  for (const nodeId of extraNodeIds) {
    const groupId = nodeById.get(nodeId)?.groupId;
    if (groupId) {
      groupIds.push(groupId);
    }
  }

  return unique(groupIds);
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

function intersectionPoint(firstStart: DiagramPoint, firstEnd: DiagramPoint, secondStart: DiagramPoint, secondEnd: DiagramPoint): DiagramPoint | undefined {
  if (firstStart.x === firstEnd.x && secondStart.y === secondEnd.y) {
    return { x: firstStart.x, y: secondStart.y };
  }
  if (firstStart.y === firstEnd.y && secondStart.x === secondEnd.x) {
    return { x: secondStart.x, y: firstStart.y };
  }
  return undefined;
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

function sortNodeHits(values: RoutingNodeHitRef[]): RoutingNodeHitRef[] {
  return [...values].sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId) ||
    compareSegmentRefs(left.segment, right.segment)
  );
}

function sortCrossings(values: RoutingEdgeCrossingRef[]): RoutingEdgeCrossingRef[] {
  return [...values].sort((left, right) =>
    left.otherEdgeId.localeCompare(right.otherEdgeId) ||
    compareSegmentRefs(left.segment, right.segment) ||
    compareSegmentRefs(left.otherSegment, right.otherSegment)
  );
}

function sortOverlaps(values: RoutingSegmentOverlapRef[]): RoutingSegmentOverlapRef[] {
  return [...values].sort((left, right) =>
    left.otherEdgeId.localeCompare(right.otherEdgeId) ||
    Number(left.dividerExempt) - Number(right.dividerExempt) ||
    compareSegmentRefs(left.segment, right.segment) ||
    compareSegmentRefs(left.otherSegment, right.otherSegment)
  );
}

function compareSegmentRefs(left: RoutingSegmentRef, right: RoutingSegmentRef): number {
  return left.edgeId.localeCompare(right.edgeId) ||
    (left.segmentId ?? "").localeCompare(right.segmentId ?? "") ||
    left.segmentIndex - right.segmentIndex;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
