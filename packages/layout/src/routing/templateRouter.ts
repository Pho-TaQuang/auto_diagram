import type {
  DiagramDiagnostic,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramEdgeAnchorSide,
  DiagramNode,
  DiagramPoint,
  DiagramRoutingDivider
} from "../../../core/src/index.js";
import type { RouteRequest, RouteStrategy } from "./RouteStrategy.js";

const anchorStubDistance = 24;
const routingDividerThickness = 10;
const routingDividerMinLength = 48;
const epsilon = 0.001;

type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type EdgeEndpointAssignment = {
  edge: DiagramEdge;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
};

type RouteCandidate = {
  points: DiagramPoint[];
  waypoints: DiagramPoint[];
  outerLane?: DiagramEdgeAnchorSide;
};

type AcceptedPath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
};

type TemplateRouteOptions = {
  includeOuterLanes: boolean;
  includeDividers: boolean;
};

export const templateOnlyRouteStrategy: RouteStrategy = {
  id: "template-only",

  route(request: RouteRequest) {
    return routeWithTemplateStrategy(request, {
      includeOuterLanes: false,
      includeDividers: false
    });
  }
};

export const templateWithOuterLanesRouteStrategy: RouteStrategy = {
  id: "template-with-outer-lanes",

  route(request: RouteRequest) {
    return routeWithTemplateStrategy(request, {
      includeOuterLanes: true,
      includeDividers: true
    });
  }
};

function routeWithTemplateStrategy(request: RouteRequest, options: TemplateRouteOptions) {
  const nodeById = new Map(request.document.nodes.map((node) => [node.id, node]));
  const nodeBounds = request.document.nodes.map((node) => requireNodeRectangle(node));
  const assignments = assignAnchors(request.document.edges, nodeById);
  const acceptedPaths: AcceptedPath[] = [];
  const routedEdges: DiagramEdge[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const diagramBounds = rectangleBounds(nodeBounds);

  for (const assignment of assignments) {
    const source = requireNodeRectangle(requireNode(nodeById, assignment.edge.sourceId));
    const target = requireNodeRectangle(requireNode(nodeById, assignment.edge.targetId));
    const selected = selectRouteCandidate(
      assignment.edge,
      routeCandidatesForAnchors(
        source,
        target,
        assignment.sourceAnchor,
        assignment.targetAnchor,
        diagramBounds,
        request.intent.routing.outerLaneMargin,
        options.includeOuterLanes
      ),
      request.document.nodes,
      acceptedPaths
    );

    if (selected.validCandidates === 0) {
      request.context.run.logger.warn({
        phase: "route",
        type: "routing-fallback-used",
        message: `No hard-valid template route found for edge ${assignment.edge.id}; selected best-effort route.`,
        edgeId: assignment.edge.id
      });
    }

    if (selected.candidate.outerLane) {
      request.context.run.logger.info({
        phase: "route",
        type: "outer-lane-used",
        message: `Outer lane ${selected.candidate.outerLane} used for edge ${assignment.edge.id}.`,
        edgeId: assignment.edge.id,
        data: { side: selected.candidate.outerLane }
      });
    }

    const routedEdge: DiagramEdge = {
      ...assignment.edge,
      layout: {
        ...assignment.edge.layout,
        sourceAnchor: assignment.sourceAnchor,
        targetAnchor: assignment.targetAnchor,
        waypoints: selected.candidate.waypoints
      }
    };

    routedEdges.push(routedEdge);
    acceptedPaths.push({ edge: routedEdge, points: selected.candidate.points });
  }

  const repaired = options.includeOuterLanes && request.intent.routing.maxRepairPasses > 0
    ? repairRoutedEdges(routedEdges, acceptedPaths, assignments, request, diagramBounds)
    : { edges: routedEdges, paths: acceptedPaths };
  const dividers = options.includeDividers
    ? planRoutingDividers(repaired.edges, request.document.nodes, request.intent.routing.dividerThreshold, request)
    : [];

  return {
    edges: repaired.edges,
    dividers,
    diagnostics
  };
}

function selectRouteCandidate(
  edge: DiagramEdge,
  candidates: RouteCandidate[],
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[]
): { candidate: RouteCandidate; hardFailures: number; score: number; validCandidates: number } {
  const scored = candidates.map((candidate) => ({
    candidate,
    hardFailures: routeHardFailures(edge, candidate.points, nodes, acceptedPaths),
    score: routeCost(edge, candidate, nodes, acceptedPaths)
  }));
  const valid = scored.filter((candidate) => candidate.hardFailures === 0);
  const selected = (valid.length > 0 ? valid : scored).reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best
  );

  return {
    ...selected,
    validCandidates: valid.length
  };
}

function repairRoutedEdges(
  routedEdges: DiagramEdge[],
  acceptedPaths: AcceptedPath[],
  assignments: EdgeEndpointAssignment[],
  request: RouteRequest,
  diagramBounds: { left: number; right: number; top: number; bottom: number },
): { edges: DiagramEdge[]; paths: AcceptedPath[] } {
  const assignmentByEdgeId = new Map(assignments.map((assignment) => [assignment.edge.id, assignment]));
  const nodeById = new Map(request.document.nodes.map((node) => [node.id, node]));
  let currentEdges = routedEdges;
  let currentPaths = acceptedPaths;

  for (let pass = 1; pass <= request.intent.routing.maxRepairPasses; pass += 1) {
    let acceptedInPass = 0;

    for (const edge of currentEdges) {
      const assignment = assignmentByEdgeId.get(edge.id);
      const currentPath = currentPaths.find((path) => path.edge.id === edge.id);
      if (!assignment || !currentPath) {
        continue;
      }

      const source = requireNodeRectangle(requireNode(nodeById, edge.sourceId));
      const target = requireNodeRectangle(requireNode(nodeById, edge.targetId));
      const otherPaths = currentPaths.filter((path) => path.edge.id !== edge.id);
      const currentCandidate: RouteCandidate = {
        points: currentPath.points,
        waypoints: edge.layout?.waypoints ?? []
      };
      const currentHardFailures = routeHardFailures(edge, currentCandidate.points, request.document.nodes, otherPaths);
      const currentScore = routeCost(edge, currentCandidate, request.document.nodes, otherPaths);
      const selected = selectRouteCandidate(
        edge,
        routeCandidatesForAnchors(
          source,
          target,
          assignment.sourceAnchor,
          assignment.targetAnchor,
          diagramBounds,
          request.intent.routing.outerLaneMargin,
          true
        ),
        request.document.nodes,
        otherPaths
      );
      const improvesHardFailureCount = selected.hardFailures < currentHardFailures;
      const improvesSoftCost =
        selected.hardFailures === currentHardFailures &&
        selected.score + epsilon < currentScore &&
        !routesEqual(selected.candidate.points, currentCandidate.points);

      if (improvesHardFailureCount || improvesSoftCost) {
        const repairedEdge: DiagramEdge = {
          ...edge,
          layout: {
            ...edge.layout,
            waypoints: selected.candidate.waypoints
          }
        };
        currentEdges = currentEdges.map((candidate) => candidate.id === edge.id ? repairedEdge : candidate);
        currentPaths = currentPaths.map((path) =>
          path.edge.id === edge.id ? { edge: repairedEdge, points: selected.candidate.points } : path
        );
        acceptedInPass += 1;
        request.context.run.logger.info({
          phase: "repair",
          type: "route-repair-accepted",
          message: `Route repair accepted for edge ${edge.id}.`,
          edgeId: edge.id,
          data: {
            pass,
            previousHardFailures: currentHardFailures,
            nextHardFailures: selected.hardFailures
          }
        });
        continue;
      }

      request.context.run.logger.debug({
        phase: "repair",
        type: "route-repair-rejected",
        message: `Route repair rejected for edge ${edge.id}; existing route is not worse than alternatives.`,
        edgeId: edge.id,
        data: {
          pass,
          hardFailures: currentHardFailures,
          validCandidates: selected.validCandidates
        }
      });
    }

    if (acceptedInPass === 0) {
      break;
    }
  }

  return { edges: currentEdges, paths: currentPaths };
}

function assignAnchors(edges: DiagramEdge[], nodeById: Map<string, DiagramNode>): EdgeEndpointAssignment[] {
  const sidePlans = edges.map((edge) => {
    const source = requireNodeRectangle(requireNode(nodeById, edge.sourceId));
    const target = requireNodeRectangle(requireNode(nodeById, edge.targetId));
    const sides = chooseAnchorSides(source, target);
    return {
      edge,
      sourceSide: sides.source,
      targetSide: sides.target
    };
  });
  const endpointBuckets = new Map<string, Array<{ edge: DiagramEdge; role: "source" | "target"; side: DiagramEdgeAnchorSide; opposite: Rectangle }>>();

  for (const plan of sidePlans) {
    const source = requireNodeRectangle(requireNode(nodeById, plan.edge.sourceId));
    const target = requireNodeRectangle(requireNode(nodeById, plan.edge.targetId));
    pushEndpoint(endpointBuckets, plan.edge.sourceId, plan.sourceSide, {
      edge: plan.edge,
      role: "source",
      side: plan.sourceSide,
      opposite: target
    });
    pushEndpoint(endpointBuckets, plan.edge.targetId, plan.targetSide, {
      edge: plan.edge,
      role: "target",
      side: plan.targetSide,
      opposite: source
    });
  }

  const anchorByEndpoint = new Map<string, DiagramEdgeAnchor>();

  for (const bucket of endpointBuckets.values()) {
    const ordered = [...bucket].sort((left, right) =>
      endpointSortCoordinate(left.side, left.opposite) - endpointSortCoordinate(right.side, right.opposite) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
    ordered.forEach((endpoint, index) => {
      anchorByEndpoint.set(endpointKey(endpoint.edge.id, endpoint.role), {
        side: endpoint.side,
        ratio: roundRatio((index + 1) / (ordered.length + 1))
      });
    });
  }

  return sidePlans.map((plan) => ({
    edge: plan.edge,
    sourceAnchor: requireMapValue(anchorByEndpoint, endpointKey(plan.edge.id, "source"), "source anchor"),
    targetAnchor: requireMapValue(anchorByEndpoint, endpointKey(plan.edge.id, "target"), "target anchor")
  }));
}

function pushEndpoint(
  buckets: Map<string, Array<{ edge: DiagramEdge; role: "source" | "target"; side: DiagramEdgeAnchorSide; opposite: Rectangle }>>,
  nodeId: string,
  side: DiagramEdgeAnchorSide,
  endpoint: { edge: DiagramEdge; role: "source" | "target"; side: DiagramEdgeAnchorSide; opposite: Rectangle }
): void {
  const key = `${nodeId}:${side}`;
  buckets.set(key, [...(buckets.get(key) ?? []), endpoint]);
}

function chooseAnchorSides(source: Rectangle, target: Rectangle): { source: DiagramEdgeAnchorSide; target: DiagramEdgeAnchorSide } {
  const dx = centerX(target) - centerX(source);
  const dy = centerY(target) - centerY(source);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0
      ? { source: "east", target: "west" }
      : { source: "west", target: "east" };
  }

  return dy > 0
    ? { source: "south", target: "north" }
    : { source: "north", target: "south" };
}

function endpointSortCoordinate(side: DiagramEdgeAnchorSide, opposite: Rectangle): number {
  return side === "east" || side === "west" ? centerY(opposite) : centerX(opposite);
}

function routeCandidatesForAnchors(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  includeOuterLanes: boolean
): RouteCandidate[] {
  const sourcePoint = anchorPoint(source, sourceAnchor);
  const targetPoint = anchorPoint(target, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, targetAnchor, 0);
  const midX = (sourcePort.x + targetPort.x) / 2;
  const midY = (sourcePort.y + targetPort.y) / 2;
  const baseCandidates = [
    pointsToRoute([sourcePoint, sourcePort, { x: midX, y: sourcePort.y }, { x: midX, y: targetPort.y }, targetPort, targetPoint]),
    pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: midY }, { x: targetPort.x, y: midY }, targetPort, targetPoint])
  ];
  if (!includeOuterLanes) {
    return uniqueRoutes(baseCandidates);
  }

  const outerCandidates: RouteCandidate[] = [
    { side: "west" as const, x: bounds.left - outerLaneMargin },
    { side: "east" as const, x: bounds.right + outerLaneMargin }
  ].map((lane) => ({
    ...pointsToRoute([sourcePoint, sourcePort, { x: lane.x, y: sourcePort.y }, { x: lane.x, y: targetPort.y }, targetPort, targetPoint]),
    outerLane: lane.side
  }));
  outerCandidates.push(...[
    { side: "north" as const, y: bounds.top - outerLaneMargin },
    { side: "south" as const, y: bounds.bottom + outerLaneMargin }
  ].map((lane) => ({
    ...pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: lane.y }, { x: targetPort.x, y: lane.y }, targetPort, targetPoint]),
    outerLane: lane.side
  })));

  return uniqueRoutes([...baseCandidates, ...outerCandidates]);
}

function pointsToRoute(points: DiagramPoint[]): RouteCandidate {
  const compacted = compactOrthogonalPoints(points);
  return {
    points: compacted,
    waypoints: compacted.slice(1, -1)
  };
}

function routeHardFailures(edge: DiagramEdge, points: DiagramPoint[], nodes: DiagramNode[], acceptedPaths: AcceptedPath[]): number {
  return countEdgeNodeHits(edge, points, nodes) + countIllegalSegmentOverlaps(edge, points, acceptedPaths);
}

function routeCost(edge: DiagramEdge, candidate: RouteCandidate, nodes: DiagramNode[], acceptedPaths: AcceptedPath[]): number {
  const nodeHits = countEdgeNodeHits(edge, candidate.points, nodes);
  const illegalSharedSegments = countIllegalSegmentOverlaps(edge, candidate.points, acceptedPaths);
  const crossings = countCrossingsWithAccepted(candidate.points, acceptedPaths);
  const bends = countBends(candidate.points);
  const length = pathLength(candidate.points);

  return illegalSharedSegments * 1_000_000_000_000 +
    nodeHits * 1_000_000_000 +
    crossings * 250_000_000 +
    (candidate.outerLane ? 50_000 : 0) +
    bends * 1_000 +
    length * 0.1;
}

function planRoutingDividers(
  edges: DiagramEdge[],
  nodes: DiagramNode[],
  threshold: number,
  request: RouteRequest
): DiagramRoutingDivider[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedEdgeIds = new Set<string>();
  const dividers: DiagramRoutingDivider[] = [];
  const groups: Array<{ mode: "fanOut" | "fanIn"; commonNodeId: string; edges: DiagramEdge[] }> = [
    ...groupEdgesByEndpoint(edges, "sourceId").map(([commonNodeId, bucket]) => ({ mode: "fanOut" as const, commonNodeId, edges: bucket })),
    ...groupEdgesByEndpoint(edges, "targetId").map(([commonNodeId, bucket]) => ({ mode: "fanIn" as const, commonNodeId, edges: bucket }))
  ];

  for (const group of groups) {
    if (group.edges.length < threshold) {
      request.context.run.logger.debug({
        phase: "divider",
        type: "divider-candidate-rejected",
        message: `Divider candidate for ${group.commonNodeId} rejected below threshold.`,
        nodeId: group.commonNodeId,
        data: { mode: group.mode, edgeCount: group.edges.length, threshold }
      });
      continue;
    }

    if (group.edges.some((edge) => usedEdgeIds.has(edge.id))) {
      request.context.run.logger.debug({
        phase: "divider",
        type: "divider-candidate-rejected",
        message: `Divider candidate for ${group.commonNodeId} rejected because an edge is already claimed.`,
        nodeId: group.commonNodeId,
        data: { mode: group.mode }
      });
      continue;
    }

    const divider = materializeDivider(group, nodeById, dividers.length);
    if (!divider) {
      continue;
    }

    dividers.push(divider);
    group.edges.forEach((edge) => usedEdgeIds.add(edge.id));
    request.context.run.logger.info({
      phase: "divider",
      type: "divider-created",
      message: `${group.mode} routing divider created for ${group.commonNodeId}.`,
      dividerId: divider.id,
      nodeId: group.commonNodeId,
      data: { edgeIds: group.edges.map((edge) => edge.id) }
    });
  }

  return dividers;
}

function groupEdgesByEndpoint(edges: DiagramEdge[], endpoint: "sourceId" | "targetId"): Array<[string, DiagramEdge[]]> {
  const groups = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    groups.set(edge[endpoint], [...(groups.get(edge[endpoint]) ?? []), edge]);
  }
  return [...groups.entries()];
}

function materializeDivider(
  group: { mode: "fanOut" | "fanIn"; commonNodeId: string; edges: DiagramEdge[] },
  nodeById: Map<string, DiagramNode>,
  index: number
): DiagramRoutingDivider | undefined {
  const commonNode = nodeById.get(group.commonNodeId);
  if (!commonNode?.layout) {
    return undefined;
  }

  const otherNodes = group.edges
    .map((edge) => nodeById.get(group.mode === "fanOut" ? edge.targetId : edge.sourceId))
    .filter((node): node is DiagramNode => Boolean(node?.layout));

  if (otherNodes.length === 0) {
    return undefined;
  }

  const common = requireNodeRectangle(commonNode);
  const cluster = rectangleBounds(otherNodes.map((node) => requireNodeRectangle(node)));
  const dx = centerX(cluster) - centerX(common);
  const dy = centerY(cluster) - centerY(common);
  const side: DiagramEdgeAnchorSide = Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? "west" : "east")
    : (dy > 0 ? "north" : "south");
  const orientation = side === "west" || side === "east" ? "vertical" : "horizontal";
  const offset = anchorStubDistance + routingDividerThickness;

  const layout = orientation === "vertical"
    ? {
      x: side === "west" ? cluster.left - offset : cluster.right + anchorStubDistance,
      y: cluster.top,
      width: routingDividerThickness,
      height: Math.max(routingDividerMinLength, cluster.bottom - cluster.top)
    }
    : {
      x: cluster.left,
      y: side === "north" ? cluster.top - offset : cluster.bottom + anchorStubDistance,
      width: Math.max(routingDividerMinLength, cluster.right - cluster.left),
      height: routingDividerThickness
    };

  return {
    id: `routing_divider_${index + 1}_${group.mode}_${group.commonNodeId}_${side}`,
    orientation,
    side,
    sourceEdgeIds: group.edges.map((edge) => edge.id),
    mode: group.mode,
    layout
  };
}

function countEdgeNodeHits(edge: DiagramEdge, points: DiagramPoint[], nodes: DiagramNode[]): number {
  let hits = 0;
  const segments = pathSegments(points);

  for (const [start, end] of segments) {
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

function countIllegalSegmentOverlaps(edge: DiagramEdge, points: DiagramPoint[], acceptedPaths: AcceptedPath[]): number {
  let overlaps = 0;
  const segments = pathSegments(points);

  for (const accepted of acceptedPaths) {
    if (canShareSegment(edge, accepted.edge)) {
      continue;
    }
    for (const [start, end] of segments) {
      for (const [acceptedStart, acceptedEnd] of pathSegments(accepted.points)) {
        if (segmentsOverlap(start, end, acceptedStart, acceptedEnd)) {
          overlaps += 1;
        }
      }
    }
  }

  return overlaps;
}

function countCrossingsWithAccepted(points: DiagramPoint[], acceptedPaths: AcceptedPath[]): number {
  let crossings = 0;
  const segments = pathSegments(points);

  for (const accepted of acceptedPaths) {
    for (const [start, end] of segments) {
      for (const [acceptedStart, acceptedEnd] of pathSegments(accepted.points)) {
        if (
          !segmentsOverlap(start, end, acceptedStart, acceptedEnd) &&
          segmentsIntersect(start, end, acceptedStart, acceptedEnd) &&
          !pointsEqual(start, acceptedStart) &&
          !pointsEqual(start, acceptedEnd) &&
          !pointsEqual(end, acceptedStart) &&
          !pointsEqual(end, acceptedEnd)
        ) {
          crossings += 1;
        }
      }
    }
  }

  return crossings;
}

function canShareSegment(left: DiagramEdge, right: DiagramEdge): boolean {
  return left.sourceId === right.sourceId || left.targetId === right.targetId;
}

function requireNodeRectangle(node: DiagramNode): Rectangle {
  if (!node.layout) {
    throw new Error(`Node ${node.id} is missing layout.`);
  }

  return {
    id: node.id,
    x: node.layout.x,
    y: node.layout.y,
    width: node.layout.width,
    height: node.layout.height
  };
}

function requireNode(nodeById: Map<string, DiagramNode>, nodeId: string): DiagramNode {
  const node = nodeById.get(nodeId);
  if (!node) {
    throw new Error(`Missing node: ${nodeId}`);
  }
  return node;
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

function outsidePort(point: DiagramPoint, anchor: DiagramEdgeAnchor, laneIndex: number): DiagramPoint {
  const distance = anchorStubDistance * (laneIndex + 1);
  if (anchor.side === "north") {
    return { x: point.x, y: point.y - distance };
  }
  if (anchor.side === "south") {
    return { x: point.x, y: point.y + distance };
  }
  if (anchor.side === "west") {
    return { x: point.x - distance, y: point.y };
  }
  return { x: point.x + distance, y: point.y };
}

function rectangleBounds(rectangles: Rectangle[]): { left: number; right: number; top: number; bottom: number } & Rectangle {
  const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return {
    id: "__bounds__",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    right,
    top,
    bottom
  };
}

function centerX(rectangle: { x: number; width: number }): number {
  return rectangle.x + rectangle.width / 2;
}

function centerY(rectangle: { y: number; height: number }): number {
  return rectangle.y + rectangle.height / 2;
}

function compactOrthogonalPoints(points: DiagramPoint[]): DiagramPoint[] {
  const deduped: DiagramPoint[] = [];
  for (const point of points) {
    if (deduped.length === 0 || !pointsEqual(point, deduped[deduped.length - 1])) {
      deduped.push(point);
    }
  }

  return deduped.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) {
      return true;
    }
    const previous = all[index - 1];
    const next = all[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function uniqueRoutes(routes: RouteCandidate[]): RouteCandidate[] {
  const seen = new Set<string>();
  const unique: RouteCandidate[] = [];

  for (const route of routes) {
    const key = route.points.map((point) => `${roundRatio(point.x)},${roundRatio(point.y)}`).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(route);
    }
  }

  return unique;
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

function segmentIntersectsRectangle(
  start: DiagramPoint,
  end: DiagramPoint,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  if (start.x === end.x) {
    return start.x > rect.x && start.x < rect.x + rect.width && rangesOverlap(start.y, end.y, rect.y, rect.y + rect.height);
  }

  if (start.y === end.y) {
    return start.y > rect.y && start.y < rect.y + rect.height && rangesOverlap(start.x, end.x, rect.x, rect.x + rect.width);
  }

  return false;
}

function segmentsOverlap(leftStart: DiagramPoint, leftEnd: DiagramPoint, rightStart: DiagramPoint, rightEnd: DiagramPoint): boolean {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && Math.abs(leftStart.x - rightStart.x) < epsilon) {
    return rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }

  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && Math.abs(leftStart.y - rightStart.y) < epsilon) {
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

function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < epsilon && Math.abs(left.y - right.y) < epsilon;
}

function routesEqual(left: DiagramPoint[], right: DiagramPoint[]): boolean {
  return left.length === right.length && left.every((point, index) => pointsEqual(point, right[index]));
}

function endpointKey(edgeId: string, role: "source" | "target"): string {
  return `${edgeId}:${role}`;
}

function requireMapValue<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, label: string): TValue {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${label}: ${String(key)}`);
  }
  return value;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(3));
}
