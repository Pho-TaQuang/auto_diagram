import type {
  DiagramDiagnostic,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramEdgeAnchorSide,
  DiagramGroup,
  DiagramNode,
  DiagramPoint,
  DiagramRoutedEdgeSegment,
  DiagramRoutedEdgeSegmentStrategy,
  DiagramRoutingDivider
} from "../../../core/src/index.js";
import type { RouteRequest, RouteStrategy } from "./RouteStrategy.js";

const anchorStubDistance = 24;
const routingDividerThickness = 10;
const routingDividerMinLength = 48;
const epsilon = 0.001;
const laneGraphClearance = 36;
const laneGraphMaxLinesPerAxis = 72;
const laneGraphSearchNodeLimit = 7000;
const privateOffsetSweepRadius = 12;

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
  sourceAnchorsBySide: Record<DiagramEdgeAnchorSide, DiagramEdgeAnchor>;
  targetAnchorsBySide: Record<DiagramEdgeAnchorSide, DiagramEdgeAnchor>;
};

type RouteCandidate = {
  points: DiagramPoint[];
  waypoints: DiagramPoint[];
  outerLane?: DiagramEdgeAnchorSide;
  outerLaneIndex?: number;
  recovery?: boolean;
};

type AcceptedPath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
};

type RoutedDividerSegment = {
  edge: DiagramEdge;
  segment: DiagramRoutedEdgeSegment;
  points: DiagramPoint[];
};

type DividerPlanResult = {
  dividers: DiagramRoutingDivider[];
  diagnostics: DiagramDiagnostic[];
};

type RouteHardFailureBreakdown = {
  nodeHits: number;
  segmentOverlaps: number;
  hardFailures: number;
};

type RouteSelection = {
  candidate: RouteCandidate;
  hardFailures: number;
  score: number;
  validCandidates: number;
  failureBreakdown: RouteHardFailureBreakdown;
  recovered: boolean;
};

type TemplateRouteOptions = {
  includeOuterLanes: boolean;
  includeDividers: boolean;
};

type RouteRecoveryOptions = {
  includeRecovery: boolean;
  source: Rectangle;
  target: Rectangle;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  bounds: { left: number; right: number; top: number; bottom: number };
  outerLaneMargin: number;
  onAttempt?: () => void;
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
  const assignmentByEdgeId = new Map(assignments.map((assignment) => [assignment.edge.id, assignment]));
  const segmentStrategyByEdgeId = new Map<string, DiagramRoutedEdgeSegmentStrategy>();
  const anchoredEdgeById = new Map(assignments.map((assignment) => [
    assignment.edge.id,
    edgeWithAnchors(assignment)
  ]));
  const dividerPlan = options.includeDividers
    ? planRoutingDividers([...anchoredEdgeById.values()], request.document.nodes, request.intent.routing.dividerThreshold, request)
    : { dividers: [], diagnostics: [] };
  const dividers = dividerPlan.dividers;
  const diagnostics: DiagramDiagnostic[] = [...dividerPlan.diagnostics];
  const dividerEdgeIds = new Set(dividers.flatMap((divider) => divider.sourceEdgeIds));
  const routeNodes = [...request.document.nodes, ...dividerObstacleNodes(dividers)];
  const routeNodeById = new Map(routeNodes.map((node) => [node.id, node]));
  const diagramBounds = rectangleBounds([...nodeBounds, ...dividers.map((divider) => dividerRectangle(divider))]);
  const routedDividerSegments = routeDividerSegments(dividers, anchoredEdgeById, assignmentByEdgeId, routeNodes, diagramBounds);
  const acceptedPaths: AcceptedPath[] = [...routedDividerSegments.paths];
  const dividerRoutedEdges = [...dividerEdgeIds].map((edgeId) => {
    const edge = requireMapValue(anchoredEdgeById, edgeId, "divider edge");
    segmentStrategyByEdgeId.set(edge.id, "divider");
    return edge;
  });
  const routePlans = assignments.filter((assignment) => !dividerEdgeIds.has(assignment.edge.id)).map((assignment, assignmentIndex) => {
    const source = requireNodeRectangle(requireNode(routeNodeById, assignment.edge.sourceId));
    const target = requireNodeRectangle(requireNode(routeNodeById, assignment.edge.targetId));
    const candidates = routeCandidatesForAnchors(
      assignment.edge.id,
      assignmentIndex,
      source,
      target,
      assignment.sourceAnchor,
      assignment.targetAnchor,
      diagramBounds,
      request.intent.routing.outerLaneMargin,
      options.includeOuterLanes
    );

    return { assignment, candidates };
  }).sort((left, right) => routePlanDifficulty(right.assignment, routeNodes, assignments) - routePlanDifficulty(left.assignment, routeNodes, assignments) ||
    left.assignment.edge.id.localeCompare(right.assignment.edge.id));

  request.context.run.logger.debug({
    phase: "route",
    type: "route-candidates-generated",
    message: `${routePlans.reduce((total, plan) => total + plan.candidates.length, 0)} non-divider route candidates generated.`,
    data: {
      edgeCount: routePlans.length,
      dividerEdgeCount: dividerEdgeIds.size,
      dividerSegmentCount: routedDividerSegments.paths.length,
      candidateCount: routePlans.reduce((total, plan) => total + plan.candidates.length, 0),
      includeOuterLanes: options.includeOuterLanes
    }
  });
  request.context.run.logger.debug({
    phase: "route",
    type: "route-order-selected",
    message: `${routePlans.length} edges ordered for congestion-aware routing.`,
    data: { edgeIds: routePlans.map((plan) => plan.assignment.edge.id) }
  });

  const routedEdges: DiagramEdge[] = [];
  for (const { assignment, candidates } of routePlans) {
    const selected = selectRouteCandidate(
      assignment.edge,
      candidates,
      routeNodes,
      acceptedPaths,
      {
        includeRecovery: options.includeOuterLanes,
        source: requireNodeRectangle(requireNode(routeNodeById, assignment.edge.sourceId)),
        target: requireNodeRectangle(requireNode(routeNodeById, assignment.edge.targetId)),
        sourceAnchor: assignment.sourceAnchor,
        targetAnchor: assignment.targetAnchor,
        bounds: diagramBounds,
        outerLaneMargin: request.intent.routing.outerLaneMargin,
        onAttempt: () => request.context.run.logger.debug({
          phase: "route",
          type: "routing-recovery-attempted",
          message: `Sparse lane-graph recovery attempted for edge ${assignment.edge.id}.`,
          edgeId: assignment.edge.id
        })
      }
    );
    const segmentStrategy: DiagramRoutedEdgeSegmentStrategy = selected.hardFailures > 0
      ? "fallback"
      : selected.candidate.recovery
        ? "corridor"
        : selected.candidate.outerLane
        ? "outer-lane"
        : "corridor";

    if (selected.recovered) {
      request.context.run.logger.debug({
        phase: "route",
        type: "routing-recovery-succeeded",
        message: `Sparse lane-graph recovery selected for edge ${assignment.edge.id}.`,
        edgeId: assignment.edge.id,
        data: selected.failureBreakdown
      });
    } else if (selected.validCandidates === 0) {
      request.context.run.logger.debug({
        phase: "route",
        type: "routing-recovery-failed",
        message: `No hard-valid recovery route found for edge ${assignment.edge.id}; keeping best-effort route until final repair.`,
        edgeId: assignment.edge.id,
        data: selected.failureBreakdown
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
      ...requireMapValue(anchoredEdgeById, assignment.edge.id, "anchored edge"),
      layout: {
        ...requireMapValue(anchoredEdgeById, assignment.edge.id, "anchored edge").layout,
        waypoints: selected.candidate.waypoints
      }
    };

    segmentStrategyByEdgeId.set(routedEdge.id, segmentStrategy);
    routedEdges.push(routedEdge);
    acceptedPaths.push({ edge: routedEdge, points: selected.candidate.points });
  }

  const repaired = options.includeOuterLanes && request.intent.routing.maxRepairPasses > 0
    ? repairRoutedEdges(routedEdges, acceptedPaths, assignments, request, routeNodes, diagramBounds, segmentStrategyByEdgeId)
    : { edges: routedEdges, paths: acceptedPaths, accepted: 0, rejected: 0 };
  emitFinalFallbackEvents(repaired.edges, repaired.paths, request, routeNodes, segmentStrategyByEdgeId);
  request.context.run.logger.debug({
    phase: "repair",
    type: "repair-complete",
    message: `Route repair complete: ${repaired.accepted} accepted, ${repaired.rejected} rejected.`,
    data: {
      accepted: repaired.accepted,
      rejected: repaired.rejected,
      maxRepairPasses: options.includeOuterLanes ? request.intent.routing.maxRepairPasses : 0
    }
  });
  const routedEdgeById = new Map([...dividerRoutedEdges, ...repaired.edges].map((edge) => [edge.id, edge]));
  const finalEdges = request.document.edges.map((edge) => requireMapValue(routedEdgeById, edge.id, "routed edge"));
  const routedEdgesWithSegments = applyEngineOwnedRoutedSegments(
    finalEdges,
    routedDividerSegments.segmentsByEdgeId,
    segmentStrategyByEdgeId
  );

  return {
    edges: routedEdgesWithSegments,
    dividers,
    diagnostics
  };
}

function edgeWithAnchors(assignment: EdgeEndpointAssignment): DiagramEdge {
  return {
    ...assignment.edge,
    layout: {
      ...assignment.edge.layout,
      sourceAnchor: assignment.sourceAnchor,
      targetAnchor: assignment.targetAnchor,
      routeSource: "engine-v2"
    }
  };
}

function selectRouteCandidate(
  edge: DiagramEdge,
  candidates: RouteCandidate[],
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  recovery?: RouteRecoveryOptions
): RouteSelection {
  const scored = candidates.map((candidate) => ({
    candidate,
    failureBreakdown: routeHardFailureBreakdown(edge, candidate.points, nodes, acceptedPaths),
    score: routeCost(edge, candidate, nodes, acceptedPaths)
  })).map((candidate) => ({
    ...candidate,
    hardFailures: candidate.failureBreakdown.hardFailures
  }));
  const validTemplates = scored.filter((candidate) => candidate.hardFailures === 0);
  const bestValidTemplate = validTemplates.length > 0
    ? validTemplates.reduce((best, candidate) => candidate.score < best.score ? candidate : best)
    : undefined;
  const shouldTryRecovery = Boolean(recovery?.includeRecovery) &&
    (!bestValidTemplate || countCrossingsWithAccepted(bestValidTemplate.candidate.points, acceptedPaths) > 0);
  if (shouldTryRecovery) {
    recovery?.onAttempt?.();
  }
  const recoveryScored = shouldTryRecovery && recovery
    ? scoreRecoveryCandidate(edge, nodes, acceptedPaths, recovery)
    : undefined;
  const allScored = recoveryScored ? [...scored, recoveryScored] : scored;
  const valid = allScored.filter((candidate) => candidate.hardFailures === 0);
  if (valid.length > 0) {
    const selected = valid.reduce((best, candidate) => candidate.score < best.score ? candidate : best);
    return {
      ...selected,
      validCandidates: valid.length,
      recovered: Boolean(selected.candidate.recovery)
    };
  }

  const selected = allScored.reduce((best, candidate) => candidate.score < best.score ? candidate : best);

  return {
    ...selected,
    validCandidates: 0,
    recovered: false
  };
}

function scoreRecoveryCandidate(
  edge: DiagramEdge,
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  recovery: RouteRecoveryOptions
): { candidate: RouteCandidate; failureBreakdown: RouteHardFailureBreakdown; hardFailures: number; score: number } | undefined {
  const recovered = recoverSparseLaneRoute(
    edge,
    recovery.source,
    recovery.target,
    recovery.sourceAnchor,
    recovery.targetAnchor,
    recovery.bounds,
    recovery.outerLaneMargin,
    nodes,
    acceptedPaths
  );
  if (!recovered) {
    return undefined;
  }
  const failureBreakdown = routeHardFailureBreakdown(edge, recovered.points, nodes, acceptedPaths);
  return {
    candidate: recovered,
    failureBreakdown,
    hardFailures: failureBreakdown.hardFailures,
    score: routeCost(edge, recovered, nodes, acceptedPaths)
  };
}

function repairRoutedEdges(
  routedEdges: DiagramEdge[],
  acceptedPaths: AcceptedPath[],
  assignments: EdgeEndpointAssignment[],
  request: RouteRequest,
  routeNodes: DiagramNode[],
  diagramBounds: { left: number; right: number; top: number; bottom: number },
  segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>
): { edges: DiagramEdge[]; paths: AcceptedPath[]; accepted: number; rejected: number } {
  const assignmentByEdgeId = new Map(assignments.map((assignment) => [assignment.edge.id, assignment]));
  const nodeById = new Map(routeNodes.map((node) => [node.id, node]));
  let currentEdges = routedEdges;
  let currentPaths = acceptedPaths;
  let totalAccepted = 0;
  let totalRejected = 0;

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
      const currentHardFailures = routeHardFailureBreakdown(edge, currentCandidate.points, routeNodes, otherPaths).hardFailures;
      const currentScore = routeCost(edge, currentCandidate, routeNodes, otherPaths);
      const selected = selectRouteCandidate(
        edge,
        routeCandidatesForAnchors(
          edge.id,
          currentEdges.findIndex((candidate) => candidate.id === edge.id),
          source,
          target,
          assignment.sourceAnchor,
          assignment.targetAnchor,
          diagramBounds,
          request.intent.routing.outerLaneMargin,
          true
        ),
        routeNodes,
        otherPaths,
        {
          includeRecovery: true,
          source,
          target,
          sourceAnchor: assignment.sourceAnchor,
          targetAnchor: assignment.targetAnchor,
          bounds: diagramBounds,
          outerLaneMargin: request.intent.routing.outerLaneMargin,
          onAttempt: () => request.context.run.logger.debug({
            phase: "repair",
            type: "routing-recovery-attempted",
            message: `Sparse lane-graph recovery attempted for edge ${edge.id} during repair.`,
            edgeId: edge.id
          })
        }
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
        segmentStrategyByEdgeId.set(edge.id, selected.hardFailures > 0
          ? "fallback"
          : selected.candidate.recovery
            ? "corridor"
            : selected.candidate.outerLane
            ? "outer-lane"
            : "corridor");
        acceptedInPass += 1;
        totalAccepted += 1;
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
      totalRejected += 1;
    }

    if (acceptedInPass === 0) {
      break;
    }
  }

  return { edges: currentEdges, paths: currentPaths, accepted: totalAccepted, rejected: totalRejected };
}

function emitFinalFallbackEvents(
  edges: DiagramEdge[],
  paths: AcceptedPath[],
  request: RouteRequest,
  routeNodes: DiagramNode[],
  segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>
): void {
  for (const edge of edges) {
    if (segmentStrategyByEdgeId.get(edge.id) === "divider") {
      continue;
    }

    const path = paths.find((candidate) => candidate.edge.id === edge.id);
    if (!path) {
      request.context.run.logger.warn({
        phase: "route",
        type: "routing-failed",
        message: `No routed path produced for edge ${edge.id}.`,
        edgeId: edge.id
      });
      continue;
    }

    const otherPaths = paths.filter((candidate) => candidate.edge.id !== edge.id);
    const breakdown = routeHardFailureBreakdown(edge, path.points, routeNodes, otherPaths);
    if (breakdown.hardFailures === 0 && segmentStrategyByEdgeId.get(edge.id) !== "fallback") {
      continue;
    }

    request.context.run.logger.warn({
      phase: "route",
      type: "routing-fallback-used",
      message: `Recovery routing failed for edge ${edge.id}; selected final best-effort route.`,
      edgeId: edge.id,
      data: breakdown
    });
  }
}

function routePlanDifficulty(
  assignment: EdgeEndpointAssignment,
  nodes: DiagramNode[],
  assignments: EdgeEndpointAssignment[]
): number {
  const source = nodes.find((node) => node.id === assignment.edge.sourceId);
  const target = nodes.find((node) => node.id === assignment.edge.targetId);
  if (!source?.layout || !target?.layout) {
    return 0;
  }

  const sourceRectangle = requireNodeRectangle(source);
  const targetRectangle = requireNodeRectangle(target);
  const sourceCenter = { x: centerX(sourceRectangle), y: centerY(sourceRectangle) };
  const targetCenter = { x: centerX(targetRectangle), y: centerY(targetRectangle) };
  const obstacleCount = nodes.filter((node) =>
    node.id !== assignment.edge.sourceId &&
    node.id !== assignment.edge.targetId &&
    node.layout &&
    segmentIntersectsRectangle(sourceCenter, targetCenter, expandRectangle(node.layout, laneGraphClearance / 2))
  ).length;
  const degree = assignments.filter((candidate) =>
    candidate.edge.sourceId === assignment.edge.sourceId ||
    candidate.edge.targetId === assignment.edge.sourceId ||
    candidate.edge.sourceId === assignment.edge.targetId ||
    candidate.edge.targetId === assignment.edge.targetId
  ).length;
  const distance = Math.abs(sourceCenter.x - targetCenter.x) + Math.abs(sourceCenter.y - targetCenter.y);

  return obstacleCount * 1_000_000 + degree * 10_000 + distance;
}

function recoverSparseLaneRoute(
  edge: DiagramEdge,
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[]
): RouteCandidate | undefined {
  const sourcePoint = anchorPoint(source, sourceAnchor);
  const targetPoint = anchorPoint(target, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, targetAnchor, 0);
  const xLines = boundedLaneLines(laneGraphXLines(sourcePort, targetPort, source, target, bounds, outerLaneMargin, nodes), sourcePort.x, targetPort.x);
  const yLines = boundedLaneLines(laneGraphYLines(sourcePort, targetPort, source, target, bounds, outerLaneMargin, nodes), sourcePort.y, targetPort.y);

  if (xLines.length * yLines.length > laneGraphSearchNodeLimit) {
    return undefined;
  }

  const graph = buildLaneGraph(edge, xLines, yLines, nodes, acceptedPaths);
  const startKey = pointKey(sourcePort);
  const endKey = pointKey(targetPort);
  if (!graph.points.has(startKey) || !graph.points.has(endKey)) {
    return undefined;
  }

  const path = shortestLanePath(graph, startKey, endKey);
  if (!path) {
    return undefined;
  }

  return {
    ...pointsToRoute([sourcePoint, ...path, targetPoint]),
    recovery: true
  };
}

function laneGraphXLines(
  sourcePort: DiagramPoint,
  targetPort: DiagramPoint,
  source: Rectangle,
  target: Rectangle,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  nodes: DiagramNode[]
): number[] {
  const lines = [
    sourcePort.x,
    targetPort.x,
    (sourcePort.x + targetPort.x) / 2,
    source.x - laneGraphClearance,
    source.x + source.width + laneGraphClearance,
    target.x - laneGraphClearance,
    target.x + target.width + laneGraphClearance,
    bounds.left - outerLaneMargin,
    bounds.right + outerLaneMargin
  ];

  for (let index = 1; index <= 4; index += 1) {
    lines.push(bounds.left - outerLaneMargin - index * anchorStubDistance);
    lines.push(bounds.right + outerLaneMargin + index * anchorStubDistance);
  }

  for (const node of nodes) {
    if (!node.layout) {
      continue;
    }
    lines.push(node.layout.x - laneGraphClearance);
    lines.push(node.layout.x + node.layout.width + laneGraphClearance);
    lines.push(node.layout.x + node.layout.width / 2);
  }

  for (const offset of deterministicPrivateOffsets(`${source.id}:${target.id}`, 0)) {
    lines.push(sourcePort.x + offset);
    lines.push(targetPort.x + offset);
    lines.push((sourcePort.x + targetPort.x) / 2 + offset);
  }

  return uniqueSortedNumbers(lines);
}

function laneGraphYLines(
  sourcePort: DiagramPoint,
  targetPort: DiagramPoint,
  source: Rectangle,
  target: Rectangle,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  nodes: DiagramNode[]
): number[] {
  const lines = [
    sourcePort.y,
    targetPort.y,
    (sourcePort.y + targetPort.y) / 2,
    source.y - laneGraphClearance,
    source.y + source.height + laneGraphClearance,
    target.y - laneGraphClearance,
    target.y + target.height + laneGraphClearance,
    bounds.top - outerLaneMargin,
    bounds.bottom + outerLaneMargin
  ];

  for (let index = 1; index <= 4; index += 1) {
    lines.push(bounds.top - outerLaneMargin - index * anchorStubDistance);
    lines.push(bounds.bottom + outerLaneMargin + index * anchorStubDistance);
  }

  for (const node of nodes) {
    if (!node.layout) {
      continue;
    }
    lines.push(node.layout.y - laneGraphClearance);
    lines.push(node.layout.y + node.layout.height + laneGraphClearance);
    lines.push(node.layout.y + node.layout.height / 2);
  }

  for (const offset of deterministicPrivateOffsets(`${source.id}:${target.id}`, 0)) {
    lines.push(sourcePort.y + offset);
    lines.push(targetPort.y + offset);
    lines.push((sourcePort.y + targetPort.y) / 2 + offset);
  }

  return uniqueSortedNumbers(lines);
}

function boundedLaneLines(lines: number[], start: number, end: number): number[] {
  const sorted = uniqueSortedNumbers([...lines, start, end]);
  if (sorted.length <= laneGraphMaxLinesPerAxis) {
    return sorted;
  }

  const center = (start + end) / 2;
  const required = new Set([roundCoordinate(start), roundCoordinate(end)]);
  return sorted
    .map((value) => ({ value, required: required.has(roundCoordinate(value)), distance: Math.min(Math.abs(value - start), Math.abs(value - end), Math.abs(value - center)) }))
    .sort((left, right) => Number(right.required) - Number(left.required) || left.distance - right.distance || left.value - right.value)
    .slice(0, laneGraphMaxLinesPerAxis)
    .map((entry) => entry.value)
    .sort((left, right) => left - right);
}

function buildLaneGraph(
  edge: DiagramEdge,
  xLines: number[],
  yLines: number[],
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[]
): { points: Map<string, DiagramPoint>; adjacency: Map<string, Array<{ key: string; axis: "h" | "v"; length: number; crossings: number }>> } {
  const points = new Map<string, DiagramPoint>();
  const adjacency = new Map<string, Array<{ key: string; axis: "h" | "v"; length: number; crossings: number }>>();

  for (const x of xLines) {
    for (const y of yLines) {
      const point = { x, y };
      if (pointInsideBlockedNode(edge, point, nodes)) {
        continue;
      }
      points.set(pointKey(point), point);
    }
  }

  for (const x of xLines) {
    const column = yLines
      .map((y) => points.get(pointKey({ x, y })))
      .filter((point): point is DiagramPoint => Boolean(point))
      .sort((left, right) => left.y - right.y);
    connectAdjacentLanePoints(edge, column, "v", nodes, acceptedPaths, adjacency);
  }

  for (const y of yLines) {
    const row = xLines
      .map((x) => points.get(pointKey({ x, y })))
      .filter((point): point is DiagramPoint => Boolean(point))
      .sort((left, right) => left.x - right.x);
    connectAdjacentLanePoints(edge, row, "h", nodes, acceptedPaths, adjacency);
  }

  return { points, adjacency };
}

function connectAdjacentLanePoints(
  edge: DiagramEdge,
  points: DiagramPoint[],
  axis: "h" | "v",
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  adjacency: Map<string, Array<{ key: string; axis: "h" | "v"; length: number; crossings: number }>>
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (laneSegmentBlocked(edge, start, end, nodes, acceptedPaths)) {
      continue;
    }
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    const length = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
    const crossings = segmentCrossingsWithAccepted(start, end, acceptedPaths);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), { key: endKey, axis, length, crossings }]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), { key: startKey, axis, length, crossings }]);
  }
}

function shortestLanePath(
  graph: { points: Map<string, DiagramPoint>; adjacency: Map<string, Array<{ key: string; axis: "h" | "v"; length: number; crossings: number }>> },
  startKey: string,
  endKey: string
): DiagramPoint[] | undefined {
  type State = { key: string; axis: "h" | "v" | "none" };
  const startState: State = { key: startKey, axis: "none" };
  const distances = new Map<string, number>([[stateKey(startState), 0]]);
  const previous = new Map<string, string>();
  const queue: Array<{ state: State; priority: number }> = [{ state: startState, priority: 0 }];
  let bestEndState: string | undefined;

  while (queue.length > 0) {
    queue.sort((left, right) => left.priority - right.priority);
    const current = queue.shift();
    if (!current) {
      break;
    }
    const currentStateKey = stateKey(current.state);
    const currentDistance = distances.get(currentStateKey);
    if (currentDistance === undefined || current.priority > currentDistance + epsilon) {
      continue;
    }
    if (current.state.key === endKey) {
      bestEndState = currentStateKey;
      break;
    }

    for (const edge of graph.adjacency.get(current.state.key) ?? []) {
      const nextState: State = { key: edge.key, axis: edge.axis };
      const bendCost = current.state.axis !== "none" && current.state.axis !== edge.axis ? 10_000 : 0;
      const nextDistance = currentDistance + edge.length + bendCost + edge.crossings * 1_000_000;
      const nextKey = stateKey(nextState);
      if (nextDistance + epsilon >= (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      distances.set(nextKey, nextDistance);
      previous.set(nextKey, currentStateKey);
      queue.push({ state: nextState, priority: nextDistance });
    }
  }

  if (!bestEndState) {
    return undefined;
  }

  const keys: string[] = [];
  let cursor: string | undefined = bestEndState;
  while (cursor) {
    keys.push(cursor.split("|")[0]);
    cursor = previous.get(cursor);
  }

  return keys.reverse().map((key) => {
    const point = graph.points.get(key);
    if (!point) {
      throw new Error(`Missing lane graph point ${key}.`);
    }
    return point;
  });
}

function stateKey(state: { key: string; axis: "h" | "v" | "none" }): string {
  return `${state.key}|${state.axis}`;
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
  const primaryEndpointBuckets = new Map<string, Array<{ edge: DiagramEdge; role: "source" | "target"; side: DiagramEdgeAnchorSide; opposite: Rectangle }>>();
  const endpointBuckets = new Map<string, Array<{ edge: DiagramEdge; role: "source" | "target"; side: DiagramEdgeAnchorSide; opposite: Rectangle }>>();

  for (const plan of sidePlans) {
    const source = requireNodeRectangle(requireNode(nodeById, plan.edge.sourceId));
    const target = requireNodeRectangle(requireNode(nodeById, plan.edge.targetId));
    pushEndpoint(primaryEndpointBuckets, plan.edge.sourceId, plan.sourceSide, {
      edge: plan.edge,
      role: "source",
      side: plan.sourceSide,
      opposite: target
    });
    pushEndpoint(primaryEndpointBuckets, plan.edge.targetId, plan.targetSide, {
      edge: plan.edge,
      role: "target",
      side: plan.targetSide,
      opposite: source
    });
    for (const side of allAnchorSides()) {
      pushEndpoint(endpointBuckets, plan.edge.sourceId, side, {
        edge: plan.edge,
        role: "source",
        side,
        opposite: target
      });
      pushEndpoint(endpointBuckets, plan.edge.targetId, side, {
        edge: plan.edge,
        role: "target",
        side,
        opposite: source
      });
    }
  }

  const anchorByEndpoint = new Map<string, DiagramEdgeAnchor>();
  const primaryAnchorByEndpoint = new Map<string, DiagramEdgeAnchor>();

  for (const bucket of primaryEndpointBuckets.values()) {
    const ordered = [...bucket].sort((left, right) =>
      endpointSortCoordinate(left.side, left.opposite) - endpointSortCoordinate(right.side, right.opposite) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
    ordered.forEach((endpoint, index) => {
      primaryAnchorByEndpoint.set(endpointPrimaryKey(endpoint.edge.id, endpoint.role), {
        side: endpoint.side,
        ratio: roundRatio((index + 1) / (ordered.length + 1))
      });
    });
  }

  for (const bucket of endpointBuckets.values()) {
    const ordered = [...bucket].sort((left, right) =>
      endpointSortCoordinate(left.side, left.opposite) - endpointSortCoordinate(right.side, right.opposite) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
    ordered.forEach((endpoint, index) => {
      anchorByEndpoint.set(endpointSideKey(endpoint.edge.id, endpoint.role, endpoint.side), {
        side: endpoint.side,
        ratio: roundRatio((index + 1) / (ordered.length + 1))
      });
    });
  }

  return sidePlans.map((plan) => ({
    edge: plan.edge,
    sourceAnchor: requireMapValue(primaryAnchorByEndpoint, endpointPrimaryKey(plan.edge.id, "source"), "source anchor"),
    targetAnchor: requireMapValue(primaryAnchorByEndpoint, endpointPrimaryKey(plan.edge.id, "target"), "target anchor"),
    sourceAnchorsBySide: anchorsBySide(anchorByEndpoint, plan.edge.id, "source"),
    targetAnchorsBySide: anchorsBySide(anchorByEndpoint, plan.edge.id, "target")
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

function anchorsBySide(
  anchorByEndpoint: Map<string, DiagramEdgeAnchor>,
  edgeId: string,
  role: "source" | "target"
): Record<DiagramEdgeAnchorSide, DiagramEdgeAnchor> {
  return {
    north: requireMapValue(anchorByEndpoint, endpointSideKey(edgeId, role, "north"), `${role} north anchor`),
    east: requireMapValue(anchorByEndpoint, endpointSideKey(edgeId, role, "east"), `${role} east anchor`),
    south: requireMapValue(anchorByEndpoint, endpointSideKey(edgeId, role, "south"), `${role} south anchor`),
    west: requireMapValue(anchorByEndpoint, endpointSideKey(edgeId, role, "west"), `${role} west anchor`)
  };
}

function allAnchorSides(): DiagramEdgeAnchorSide[] {
  return ["north", "east", "south", "west"];
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
  edgeId: string,
  edgeIndex: number,
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
  const offsets = deterministicPrivateOffsets(edgeId, edgeIndex);
  const gapCandidates = gapBetweenCandidates(source, target, sourcePoint, sourcePort, targetPort, targetPoint);
  const baseCandidates = offsets.flatMap((offset) => {
    const xLane = midX + offset;
    const yLane = midY + offset;
    const xLaneA = sourcePort.x + offset;
    const xLaneB = targetPort.x - offset;
    const yLaneA = sourcePort.y + offset;
    const yLaneB = targetPort.y - offset;

    return [
      pointsToRoute([sourcePoint, sourcePort, { x: xLane, y: sourcePort.y }, { x: xLane, y: targetPort.y }, targetPort, targetPoint]),
      pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: yLane }, { x: targetPort.x, y: yLane }, targetPort, targetPoint]),
      pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: xLaneA, y: sourcePort.y },
        { x: xLaneA, y: yLane },
        { x: xLaneB, y: yLane },
        { x: xLaneB, y: targetPort.y },
        targetPort,
        targetPoint
      ]),
      pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: sourcePort.x, y: yLaneA },
        { x: xLane, y: yLaneA },
        { x: xLane, y: yLaneB },
        { x: targetPort.x, y: yLaneB },
        targetPort,
        targetPoint
      ])
    ];
  });
  if (!includeOuterLanes) {
    return uniqueRoutes([...gapCandidates, ...baseCandidates]);
  }

  const laneOffsets = [0, 1, 2, 3, 4, 5];
  const outerCandidates: RouteCandidate[] = laneOffsets.flatMap((laneIndex) => [
    { side: "west" as const, x: bounds.left - outerLaneMargin - anchorStubDistance * laneIndex },
    { side: "east" as const, x: bounds.right + outerLaneMargin + anchorStubDistance * laneIndex }
  ].map((lane) => ({
    ...pointsToRoute([sourcePoint, sourcePort, { x: lane.x, y: sourcePort.y }, { x: lane.x, y: targetPort.y }, targetPort, targetPoint]),
    outerLane: lane.side,
    outerLaneIndex: laneIndex + 1
  })));
  outerCandidates.push(...laneOffsets.flatMap((laneIndex) => [
    { side: "north" as const, y: bounds.top - outerLaneMargin - anchorStubDistance * laneIndex },
    { side: "south" as const, y: bounds.bottom + outerLaneMargin + anchorStubDistance * laneIndex }
  ].map((lane) => ({
    ...pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: lane.y }, { x: targetPort.x, y: lane.y }, targetPort, targetPoint]),
    outerLane: lane.side,
    outerLaneIndex: laneIndex + 1
  }))));

  return uniqueRoutes([...gapCandidates, ...baseCandidates, ...outerCandidates]);
}

function gapBetweenCandidates(
  source: Rectangle,
  target: Rectangle,
  sourcePoint: DiagramPoint,
  sourcePort: DiagramPoint,
  targetPort: DiagramPoint,
  targetPoint: DiagramPoint
): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;

  if (sourceRight < target.x) {
    const gapX = (sourceRight + target.x) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: gapX, y: sourcePort.y }, { x: gapX, y: targetPort.y }, targetPort, targetPoint]));
  } else if (targetRight < source.x) {
    const gapX = (targetRight + source.x) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: gapX, y: sourcePort.y }, { x: gapX, y: targetPort.y }, targetPort, targetPoint]));
  }

  if (sourceBottom < target.y) {
    const gapY = (sourceBottom + target.y) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: gapY }, { x: targetPort.x, y: gapY }, targetPort, targetPoint]));
  } else if (targetBottom < source.y) {
    const gapY = (targetBottom + source.y) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: gapY }, { x: targetPort.x, y: gapY }, targetPort, targetPoint]));
  }

  return candidates;
}

function pointsToRoute(points: DiagramPoint[]): RouteCandidate {
  const sourceStub = points[1];
  const targetStub = points[points.length - 2];
  const compacted = preserveTerminalStubs(compactOrthogonalPoints(points), sourceStub, targetStub);
  return {
    points: compacted,
    waypoints: compacted.slice(1, -1)
  };
}

function preserveTerminalStubs(points: DiagramPoint[], sourceStub: DiagramPoint | undefined, targetStub: DiagramPoint | undefined): DiagramPoint[] {
  const next = [...points];
  if (sourceStub && next.length >= 2 && !pointsEqual(next[1], sourceStub)) {
    next.splice(1, 0, sourceStub);
  }
  if (targetStub && next.length >= 2 && !pointsEqual(next[next.length - 2], targetStub)) {
    next.splice(next.length - 1, 0, targetStub);
  }
  return next.filter((point, index, all) => index === 0 || !pointsEqual(point, all[index - 1]));
}

function routeHardFailureBreakdown(edge: DiagramEdge, points: DiagramPoint[], nodes: DiagramNode[], acceptedPaths: AcceptedPath[]): RouteHardFailureBreakdown {
  const nodeHits = countEdgeNodeHits(edge, points, nodes);
  const segmentOverlaps = countIllegalSegmentOverlaps(edge, points, acceptedPaths);
  return {
    nodeHits,
    segmentOverlaps,
    hardFailures: nodeHits + segmentOverlaps
  };
}

function routeCost(edge: DiagramEdge, candidate: RouteCandidate, nodes: DiagramNode[], acceptedPaths: AcceptedPath[]): number {
  const nodeHits = countEdgeNodeHits(edge, candidate.points, nodes);
  const illegalSegmentOverlaps = countIllegalSegmentOverlaps(edge, candidate.points, acceptedPaths);
  const crossings = countCrossingsWithAccepted(candidate.points, acceptedPaths);
  const bends = countBends(candidate.points);
  const length = pathLength(candidate.points);

  return illegalSegmentOverlaps * 1_000_000_000_000 +
    nodeHits * 1_000_000_000 +
    crossings * 250_000_000 +
    (candidate.outerLane ? 50_000 + (candidate.outerLaneIndex ?? 1) * 500 : 0) +
    bends * 1_000 +
    length * 0.1;
}

function planRoutingDividers(
  edges: DiagramEdge[],
  nodes: DiagramNode[],
  threshold: number,
  request: RouteRequest
): DividerPlanResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map((request.document.groups ?? []).map((group) => [group.id, group]));
  const usedEdgeIds = new Set<string>();
  const dividers: DiagramRoutingDivider[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const sideSlotsByRemoteGroupId = new Map<string, number>();
  const groups = [
    ...groupEdgesByCommonAndRemoteGroup(edges, "sourceId", nodeById).map((group) => ({ ...group, mode: "fanOut" as const })),
    ...groupEdgesByCommonAndRemoteGroup(edges, "targetId", nodeById).map((group) => ({ ...group, mode: "fanIn" as const }))
  ];

  for (const group of groups) {
    const effectiveThreshold = Math.max(threshold, 4);
    if (group.edges.length <= effectiveThreshold) {
      request.context.run.logger.debug({
        phase: "divider",
        type: "divider-candidate-rejected",
        message: `Divider candidate for ${group.commonNodeId} rejected at or below threshold.`,
        nodeId: group.commonNodeId,
        data: { mode: group.mode, edgeCount: group.edges.length, threshold: effectiveThreshold }
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

    const slotKey = group.remoteGroupId;
    const sideSlot = sideSlotsByRemoteGroupId.get(slotKey) ?? 0;
    const sideOverflow = sideSlot >= 2;
    if (sideOverflow) {
      const message = `More than two routing dividers share remote group ${group.remoteGroupId}; alternating sides with offsets.`;
      request.context.run.logger.warn({
        phase: "divider",
        type: "divider-side-overflow",
        message,
        groupId: group.remoteGroupId,
        data: {
          mode: group.mode,
          commonNodeId: group.commonNodeId,
          remoteGroupId: group.remoteGroupId,
          sideSlot
        }
      });
      diagnostics.push({
        severity: "warning",
        type: "divider-side-overflow",
        reason: "divider-side-overflow",
        message,
        groupIds: [group.remoteGroupId],
        data: { mode: group.mode, commonNodeId: group.commonNodeId, remoteGroupId: group.remoteGroupId, sideSlot }
      });
    }

    const divider = materializeDivider(group, nodeById, groupById, request, dividers.length, sideSlot);
    if (!divider) {
      continue;
    }

    dividers.push(divider);
    sideSlotsByRemoteGroupId.set(slotKey, sideSlot + 1);
    group.edges.forEach((edge) => usedEdgeIds.add(edge.id));
    request.context.run.logger.info({
      phase: "divider",
      type: "divider-created",
      message: `${group.mode} routing divider created for ${group.commonNodeId}.`,
      dividerId: divider.id,
      nodeId: group.commonNodeId,
      groupId: divider.remoteGroupId,
      data: { edgeIds: group.edges.map((edge) => edge.id), remoteGroupId: divider.remoteGroupId, side: divider.side, sideSlot }
    });
  }

  return { dividers, diagnostics };
}

function groupEdgesByCommonAndRemoteGroup(
  edges: DiagramEdge[],
  commonEndpoint: "sourceId" | "targetId",
  nodeById: Map<string, DiagramNode>
): Array<{ commonNodeId: string; remoteGroupId: string; remoteNodeIds: string[]; edges: DiagramEdge[] }> {
  const groups = new Map<string, { commonNodeId: string; remoteGroupId: string; remoteNodeIds: string[]; edges: DiagramEdge[] }>();
  const remoteEndpoint = commonEndpoint === "sourceId" ? "targetId" : "sourceId";

  for (const edge of edges) {
    const commonNodeId = edge[commonEndpoint];
    const remoteNodeId = edge[remoteEndpoint];
    const remoteNode = nodeById.get(remoteNodeId);
    const remoteGroupId = remoteNode?.groupId ?? `node:${remoteNodeId}`;
    const key = `${commonNodeId}:${remoteGroupId}`;
    const current = groups.get(key) ?? { commonNodeId, remoteGroupId, remoteNodeIds: [], edges: [] };
    groups.set(key, {
      ...current,
      remoteNodeIds: [...new Set([...current.remoteNodeIds, remoteNodeId])],
      edges: [...current.edges, edge]
    });
  }

  return [...groups.values()];
}

function materializeDivider(
  group: { mode: "fanOut" | "fanIn"; commonNodeId: string; remoteGroupId: string; remoteNodeIds: string[]; edges: DiagramEdge[] },
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>,
  request: RouteRequest,
  index: number,
  sideSlot: number
): DiagramRoutingDivider | undefined {
  const commonNode = nodeById.get(group.commonNodeId);
  if (!commonNode?.layout) {
    return undefined;
  }

  const otherNodes = group.remoteNodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is DiagramNode => Boolean(node?.layout));

  if (otherNodes.length === 0) {
    return undefined;
  }

  const common = requireNodeRectangle(commonNode);
  const remoteGroup = groupById.get(group.remoteGroupId);
  const cluster = remoteGroup?.layout
    ? { ...requireLayoutLikeRectangle(remoteGroup.id, remoteGroup.layout), left: remoteGroup.layout.x, right: remoteGroup.layout.x + remoteGroup.layout.width, top: remoteGroup.layout.y, bottom: remoteGroup.layout.y + remoteGroup.layout.height }
    : rectangleBounds(otherNodes.map((node) => requireNodeRectangle(node)));
  const allowedSides = dividerSidesForRemoteGroup(group.remoteGroupId, cluster, request);
  const dx = centerX(cluster) - centerX(common);
  const dy = centerY(cluster) - centerY(common);
  const preferredSide: DiagramEdgeAnchorSide = Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? "west" : "east")
    : (dy > 0 ? "north" : "south");
  const side = dividerSideForSlot(allowedSides, preferredSide, sideSlot);
  const orientation = side === "west" || side === "east" ? "vertical" : "horizontal";
  const offset = anchorStubDistance + routingDividerThickness;
  const sideOffset = Math.floor(sideSlot / 2) * (anchorStubDistance + routingDividerThickness);

  const layout = orientation === "vertical"
    ? {
      x: side === "west" ? cluster.left - offset - sideOffset : cluster.right + anchorStubDistance + sideOffset,
      y: cluster.top,
      width: routingDividerThickness,
      height: Math.max(routingDividerMinLength, cluster.bottom - cluster.top)
    }
    : {
      x: cluster.left,
      y: side === "north" ? cluster.top - offset - sideOffset : cluster.bottom + anchorStubDistance + sideOffset,
      width: Math.max(routingDividerMinLength, cluster.right - cluster.left),
      height: routingDividerThickness
    };

  return {
    id: `routing_divider_${index + 1}_${group.mode}_${group.commonNodeId}_${safeIdPart(group.remoteGroupId)}_${side}`,
    orientation,
    side,
    sourceEdgeIds: group.edges.map((edge) => edge.id),
    mode: group.mode,
    layout,
    commonNodeId: group.commonNodeId,
    remoteGroupId: group.remoteGroupId,
    remoteNodeIds: group.remoteNodeIds,
    sideSlot,
    sideOffset
  };
}

function dividerSidesForRemoteGroup(
  remoteGroupId: string,
  cluster: Rectangle,
  request: RouteRequest
): [DiagramEdgeAnchorSide, DiagramEdgeAnchorSide] {
  const packing = request.intent.groups[remoteGroupId]?.packing;
  if (packing === "horizontal") {
    return ["north", "south"];
  }
  if (packing === "vertical") {
    return ["west", "east"];
  }

  return cluster.width >= cluster.height
    ? ["north", "south"]
    : ["west", "east"];
}

function dividerSideForSlot(
  allowedSides: [DiagramEdgeAnchorSide, DiagramEdgeAnchorSide],
  preferredSide: DiagramEdgeAnchorSide,
  sideSlot: number
): DiagramEdgeAnchorSide {
  const firstSide = allowedSides.includes(preferredSide)
    ? preferredSide
    : allowedSides[0];
  const secondSide = allowedSides.find((side) => side !== firstSide) ?? allowedSides[1];
  return sideSlot % 2 === 0 ? firstSide : secondSide;
}

function requireLayoutLikeRectangle(id: string, layout: { x: number; y: number; width: number; height: number }): Rectangle {
  return {
    id,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height
  };
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_:-]+/g, "_");
}

function applyEngineOwnedRoutedSegments(
  edges: DiagramEdge[],
  dividerSegmentsByEdgeId: Map<string, DiagramRoutedEdgeSegment[]>,
  segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>
): DiagramEdge[] {
  return edges.map((edge) => {
    const routedSegments = dividerSegmentsByEdgeId.get(edge.id) ?? [directRoutedSegment(edge, segmentStrategyByEdgeId.get(edge.id) ?? "direct")];
    return {
      ...edge,
      layout: {
        ...edge.layout,
        routeSource: "engine-v2",
        routedSegments
      }
    };
  });
}

function routeDividerSegments(
  dividers: DiagramRoutingDivider[],
  edgeById: Map<string, DiagramEdge>,
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>,
  routeNodes: DiagramNode[],
  bounds: { left: number; right: number; top: number; bottom: number }
): { segmentsByEdgeId: Map<string, DiagramRoutedEdgeSegment[]>; paths: AcceptedPath[] } {
  const occupancy: AcceptedPath[] = [];
  const segmentsByEdgeId = new Map<string, DiagramRoutedEdgeSegment[]>();

  for (const divider of dividers) {
    const dividerEdges = divider.sourceEdgeIds
      .map((edgeId) => edgeById.get(edgeId))
      .filter((edge): edge is DiagramEdge => Boolean(edge));
    for (const { edge, segment } of splitDividerSegments(divider, dividerEdges, assignmentByEdgeId, routeNodes, occupancy, bounds)) {
      segmentsByEdgeId.set(edge.id, [...(segmentsByEdgeId.get(edge.id) ?? []), segment]);
    }
  }

  return { segmentsByEdgeId, paths: occupancy };
}

function directRoutedSegment(edge: DiagramEdge, strategy: DiagramRoutedEdgeSegmentStrategy): DiagramRoutedEdgeSegment {
  return {
    id: `${edge.id}:direct`,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label ?? "",
    sourceAnchor: edge.layout?.sourceAnchor,
    targetAnchor: edge.layout?.targetAnchor,
    waypoints: edge.layout?.waypoints ?? [],
    markerPolicy: { start: true, end: true },
    strategy
  };
}

function splitDividerSegments(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>,
  nodes: DiagramNode[],
  occupancy: AcceptedPath[],
  bounds: { left: number; right: number; top: number; bottom: number }
): RoutedDividerSegment[] {
  return divider.mode === "fanOut"
    ? fanOutDividerSegments(divider, edges, assignmentByEdgeId, nodes, occupancy, bounds)
    : fanInDividerSegments(divider, edges, assignmentByEdgeId, nodes, occupancy, bounds);
}

function fanOutDividerSegments(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>,
  nodes: DiagramNode[],
  occupancy: AcceptedPath[],
  bounds: { left: number; right: number; top: number; bottom: number }
): RoutedDividerSegment[] {
  if (edges.length === 0) {
    return [];
  }
  const firstEdge = edges[0];
  const sourceAnchor = classAnchorTowardDivider(firstEdge, "source", divider, nodes, assignmentByEdgeId);
  const dividerInputAnchor = dividerOuterAnchor(divider);
  const orderedLeaves = orderEdgesForDivider(divider, edges, "target", oppositeSide(divider.side), nodes);
  const trunk = createDividerSegment({
    edge: firstEdge,
    segmentId: `${firstEdge.id}:divider-trunk`,
    sourceId: firstEdge.sourceId,
    targetId: divider.id,
    label: "",
    sourceAnchor,
    targetAnchor: dividerInputAnchor,
    markerPolicy: { start: true, end: false },
    nodes,
    divider,
    occupancy,
    bounds
  });
  occupancy.push({
    edge: { ...firstEdge, id: trunk.segment.id, sourceId: trunk.segment.sourceId, targetId: trunk.segment.targetId },
    points: trunk.points
  });

  return [
    { edge: firstEdge, segment: trunk.segment, points: trunk.points },
    ...orderedLeaves.map(({ edge, dividerAnchor }) => {
      const leaf = createDividerSegment({
        edge,
        segmentId: `${edge.id}:divider-leaf`,
        sourceId: divider.id,
        targetId: edge.targetId,
        label: edge.label ?? "",
        sourceAnchor: dividerAnchor,
        targetAnchor: classAnchorForDividerSide(edge, "target", dividerAnchor.side, assignmentByEdgeId),
        markerPolicy: { start: false, end: true },
        nodes,
        divider,
        occupancy,
        bounds
      });
      occupancy.push({
        edge: { ...edge, id: leaf.segment.id, sourceId: leaf.segment.sourceId, targetId: leaf.segment.targetId },
        points: leaf.points
      });
      return { edge, segment: leaf.segment, points: leaf.points };
    })
  ];
}

function fanInDividerSegments(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>,
  nodes: DiagramNode[],
  occupancy: AcceptedPath[],
  bounds: { left: number; right: number; top: number; bottom: number }
): RoutedDividerSegment[] {
  if (edges.length === 0) {
    return [];
  }
  const firstEdge = edges[0];
  const targetAnchor = classAnchorTowardDivider(firstEdge, "target", divider, nodes, assignmentByEdgeId);
  const dividerOutputAnchor = dividerOuterAnchor(divider);
  const orderedLeaves = orderEdgesForDivider(divider, edges, "source", oppositeSide(divider.side), nodes);
  const trunk = createDividerSegment({
    edge: firstEdge,
    segmentId: `${firstEdge.id}:divider-trunk`,
    sourceId: divider.id,
    targetId: firstEdge.targetId,
    label: "",
    sourceAnchor: dividerOutputAnchor,
    targetAnchor,
    markerPolicy: { start: false, end: true },
    nodes,
    divider,
    occupancy,
    bounds
  });
  occupancy.push({
    edge: { ...firstEdge, id: trunk.segment.id, sourceId: trunk.segment.sourceId, targetId: trunk.segment.targetId },
    points: trunk.points
  });

  return [
    { edge: firstEdge, segment: trunk.segment, points: trunk.points },
    ...orderedLeaves.map(({ edge, dividerAnchor }) => {
      const leaf = createDividerSegment({
        edge,
        segmentId: `${edge.id}:divider-leaf`,
        sourceId: edge.sourceId,
        targetId: divider.id,
        label: edge.label ?? "",
        sourceAnchor: classAnchorForDividerSide(edge, "source", dividerAnchor.side, assignmentByEdgeId),
        targetAnchor: dividerAnchor,
        markerPolicy: { start: true, end: false },
        nodes,
        divider,
        occupancy,
        bounds
      });
      occupancy.push({
        edge: { ...edge, id: leaf.segment.id, sourceId: leaf.segment.sourceId, targetId: leaf.segment.targetId },
        points: leaf.points
      });
      return { edge, segment: leaf.segment, points: leaf.points };
    })
  ];
}

function createDividerSegment(input: {
  edge: DiagramEdge;
  segmentId: string;
  sourceId: string;
  targetId: string;
  label: string;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  markerPolicy: { start: boolean; end: boolean };
  nodes: DiagramNode[];
  divider: DiagramRoutingDivider;
  occupancy: AcceptedPath[];
  bounds: { left: number; right: number; top: number; bottom: number };
}): { segment: DiagramRoutedEdgeSegment; points: DiagramPoint[] } {
  const source = endpointRectangle(input.sourceId, input.nodes, input.divider);
  const target = endpointRectangle(input.targetId, input.nodes, input.divider);
  const segmentEdge = {
    ...input.edge,
    id: input.segmentId,
    sourceId: input.sourceId,
    targetId: input.targetId
  };
  const selected = selectRouteCandidate(
    segmentEdge,
    routeCandidatesForAnchors(
      input.segmentId,
      stableHash(input.segmentId) % 997,
      source,
      target,
      input.sourceAnchor,
      input.targetAnchor,
      input.bounds,
      Math.max(anchorStubDistance * 4, laneGraphClearance * 2),
      true
    ),
    input.nodes,
    input.occupancy,
    {
      includeRecovery: true,
      source,
      target,
      sourceAnchor: input.sourceAnchor,
      targetAnchor: input.targetAnchor,
      bounds: input.bounds,
      outerLaneMargin: Math.max(anchorStubDistance * 4, laneGraphClearance * 2)
    }
  );

  return {
    segment: {
      id: input.segmentId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      label: input.label,
      sourceAnchor: input.sourceAnchor,
      targetAnchor: input.targetAnchor,
      waypoints: selected.candidate.waypoints,
      markerPolicy: input.markerPolicy,
      strategy: "divider"
    },
    points: selected.candidate.points
  };
}

function edgeRoutePoints(edge: DiagramEdge, nodes: DiagramNode[]): DiagramPoint[] {
  const source = nodes.find((node) => node.id === edge.sourceId);
  const target = nodes.find((node) => node.id === edge.targetId);
  if (!source?.layout || !target?.layout || !edge.layout?.sourceAnchor || !edge.layout.targetAnchor) {
    return [];
  }
  return [
    anchorPoint(requireNodeRectangle(source), edge.layout.sourceAnchor),
    ...(edge.layout.waypoints ?? []),
    anchorPoint(requireNodeRectangle(target), edge.layout.targetAnchor)
  ];
}

function endpointRectangle(endpointId: string, nodes: DiagramNode[], divider: DiagramRoutingDivider): Rectangle {
  const node = nodes.find((candidate) => candidate.id === endpointId);
  if (node?.layout) {
    return requireNodeRectangle(node);
  }

  if (endpointId === divider.id) {
    return dividerRectangle(divider);
  }

  throw new Error(`Missing endpoint ${endpointId}.`);
}

function dividerObstacleNodes(dividers: DiagramRoutingDivider[]): DiagramNode[] {
  return dividers.map((divider) => ({
    id: divider.id,
    label: divider.id,
    kind: "class" as const,
    attributes: [],
    methods: [],
    layout: {
      ...divider.layout,
      headerHeight: divider.layout.height,
      lineHeight: divider.layout.height,
      separatorHeight: 0
    }
  }));
}

function dividerRectangle(divider: DiagramRoutingDivider): Rectangle {
  return {
    id: divider.id,
    x: divider.layout.x,
    y: divider.layout.y,
    width: divider.layout.width,
    height: divider.layout.height
  };
}

function simpleSplitWaypoints(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor
): DiagramPoint[] {
  const sourcePoint = anchorPoint(source, sourceAnchor);
  const targetPoint = anchorPoint(target, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, targetAnchor, 0);
  const points = sourceAnchor.side === "north" || sourceAnchor.side === "south"
    ? [sourcePoint, sourcePort, { x: targetPort.x, y: sourcePort.y }, targetPort, targetPoint]
    : [sourcePoint, sourcePort, { x: sourcePort.x, y: targetPort.y }, targetPort, targetPoint];

  return pointsToRoute(points).waypoints;
}

function orderEdgesForDivider(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  classEndpoint: "source" | "target",
  dividerSide: DiagramEdgeAnchorSide,
  nodes: DiagramNode[]
): Array<{ edge: DiagramEdge; dividerAnchor: DiagramEdgeAnchor }> {
  const sorted = [...edges].sort((left, right) =>
    dividerSortCoordinate(left, classEndpoint, divider, nodes) - dividerSortCoordinate(right, classEndpoint, divider, nodes) ||
    left.id.localeCompare(right.id)
  );

  return sorted.map((edge, index) => ({
    edge,
    dividerAnchor: {
      side: dividerSide,
      ratio: roundRatio((index + 1) / (sorted.length + 1))
    }
  }));
}

function dividerSortCoordinate(edge: DiagramEdge, classEndpoint: "source" | "target", divider: DiagramRoutingDivider, nodes: DiagramNode[]): number {
  const nodeId = classEndpoint === "source" ? edge.sourceId : edge.targetId;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node?.layout) {
    const anchor = classEndpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;
    return anchor?.ratio ?? 0.5;
  }

  return divider.orientation === "vertical"
    ? centerY(requireNodeRectangle(node))
    : centerX(requireNodeRectangle(node));
}

function dividerOuterAnchor(divider: DiagramRoutingDivider): DiagramEdgeAnchor {
  return {
    side: divider.side,
    ratio: 0.5
  };
}

function classAnchorTowardDivider(
  edge: DiagramEdge,
  endpoint: "source" | "target",
  divider: DiagramRoutingDivider,
  nodes: DiagramNode[],
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>
): DiagramEdgeAnchor {
  const endpointId = endpoint === "source" ? edge.sourceId : edge.targetId;
  const node = nodes.find((candidate) => candidate.id === endpointId);
  const desiredSide = node?.layout
    ? chooseAnchorSides(requireNodeRectangle(node), dividerRectangle(divider)).source
    : oppositeSide(divider.side);
  return endpointSideAnchor(edge.id, endpoint, desiredSide, assignmentByEdgeId) ?? {
    side: desiredSide,
    ratio: stableAnchorRatio(`${edge.id}:${endpoint}:${desiredSide}`)
  };
}

function classAnchorForDividerSide(
  edge: DiagramEdge,
  endpoint: "source" | "target",
  dividerSide: DiagramEdgeAnchorSide,
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>
): DiagramEdgeAnchor {
  const desiredSide = oppositeSide(dividerSide);
  return endpointSideAnchor(edge.id, endpoint, desiredSide, assignmentByEdgeId) ?? {
    side: desiredSide,
    ratio: stableAnchorRatio(`${edge.id}:${endpoint}:${desiredSide}`)
  };
}

function endpointSideAnchor(
  edgeId: string,
  endpoint: "source" | "target",
  side: DiagramEdgeAnchorSide,
  assignmentByEdgeId: Map<string, EdgeEndpointAssignment>
): DiagramEdgeAnchor | undefined {
  const assignment = assignmentByEdgeId.get(edgeId);
  if (!assignment) {
    return undefined;
  }
  return endpoint === "source"
    ? assignment.sourceAnchorsBySide[side]
    : assignment.targetAnchorsBySide[side];
}

function stableAnchorRatio(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 700;
  }

  return roundRatio(0.15 + hash / 1000);
}

function deterministicPrivateOffsets(edgeId: string, edgeIndex: number): number[] {
  const step = anchorStubDistance;
  const bias = ((stableHash(edgeId) + edgeIndex) % 5) - 2;
  const base = bias * step;
  const offsets = [base, 0];
  for (let index = 1; index <= privateOffsetSweepRadius; index += 1) {
    offsets.push(base + step * index);
    offsets.push(base - step * index);
    offsets.push(step * index);
    offsets.push(-step * index);
  }
  return [...new Set(offsets)];
}

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function oppositeSide(side: DiagramEdgeAnchorSide): DiagramEdgeAnchorSide {
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

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map(roundCoordinate))].sort((left, right) => left - right);
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

function pointKey(point: DiagramPoint): string {
  return `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;
}

function expandRectangle(rectangle: { x: number; y: number; width: number; height: number }, clearance: number): { x: number; y: number; width: number; height: number } {
  return {
    x: rectangle.x - clearance,
    y: rectangle.y - clearance,
    width: rectangle.width + clearance * 2,
    height: rectangle.height + clearance * 2
  };
}

function pointInsideBlockedNode(edge: DiagramEdge, point: DiagramPoint, nodes: DiagramNode[]): boolean {
  return nodes.some((node) => {
    if (node.id === edge.sourceId || node.id === edge.targetId || !node.layout) {
      return false;
    }
    const rect = expandRectangle(node.layout, laneGraphClearance);
    return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
  });
}

function laneSegmentBlocked(edge: DiagramEdge, start: DiagramPoint, end: DiagramPoint, nodes: DiagramNode[], acceptedPaths: AcceptedPath[]): boolean {
  if (pointsEqual(start, end)) {
    return true;
  }

  for (const node of nodes) {
    if (node.id === edge.sourceId || node.id === edge.targetId || !node.layout) {
      continue;
    }
    if (segmentIntersectsRectangle(start, end, expandRectangle(node.layout, laneGraphClearance))) {
      return true;
    }
  }

  for (const accepted of acceptedPaths) {
    for (const [acceptedStart, acceptedEnd] of pathSegments(accepted.points)) {
      if (segmentsOverlap(start, end, acceptedStart, acceptedEnd)) {
        return true;
      }
    }
  }

  return false;
}

function segmentCrossingsWithAccepted(start: DiagramPoint, end: DiagramPoint, acceptedPaths: AcceptedPath[]): number {
  let crossings = 0;
  for (const accepted of acceptedPaths) {
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
  return crossings;
}

function countEdgeNodeHits(edge: DiagramEdge, points: DiagramPoint[], nodes: DiagramNode[]): number {
  let hits = 0;
  const segments = pathSegments(points);

  for (const [start, end] of segments) {
    for (const node of nodes) {
      if (!node.layout) {
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

function endpointSideKey(edgeId: string, role: "source" | "target", side: DiagramEdgeAnchorSide): string {
  return `${edgeId}:${role}:${side}`;
}

function endpointPrimaryKey(edgeId: string, role: "source" | "target"): string {
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
