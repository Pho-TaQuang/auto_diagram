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
const corridorStrategyCandidateBudget = 600;
const outerStrategyCandidateBudget = 96;
const outerCornerStrategyCandidateBudget = 48;
const recoveryAnchorPairBudget = 8;

type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type RouteCandidate = {
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  sourcePortKey?: string;
  targetPortKey?: string;
  points: DiagramPoint[];
  waypoints: DiagramPoint[];
  outerLane?: DiagramEdgeAnchorSide;
  outerLaneIndex?: number;
  recovery?: boolean;
};

type AnchorPortSlot = {
  nodeId: string;
  side: DiagramEdgeAnchorSide;
  slotIndex: number;
  key: string;
  anchor: DiagramEdgeAnchor;
};

type NodeAnchorPortPool = Record<DiagramEdgeAnchorSide, AnchorPortSlot[]>;

type AnchorPortPools = Map<string, NodeAnchorPortPool>;

type RouteCandidateStrategy =
  | {
      kind: "corridor";
      sourceSide: DiagramEdgeAnchorSide;
      targetSide: DiagramEdgeAnchorSide;
    }
  | {
      kind: "outer";
      laneSide: DiagramEdgeAnchorSide;
      sourceSide: DiagramEdgeAnchorSide;
      targetSide: DiagramEdgeAnchorSide;
    }
  | {
      kind: "outer-corner";
      firstLaneSide: DiagramEdgeAnchorSide;
      finalLaneSide: DiagramEdgeAnchorSide;
      sourceSide: DiagramEdgeAnchorSide;
      targetSide: DiagramEdgeAnchorSide;
    };

type ScoredRouteCandidate = {
  candidate: RouteCandidate;
  failureBreakdown: RouteHardFailureBreakdown;
  hardFailures: number;
  score: number;
};

type PhysicalConnectorKind = "normal" | "divider-trunk" | "divider-spoke";

type SpokeMonotonicDirection = "up" | "down" | "left" | "right";

type PhysicalConnector = {
  id: string;
  ownerEdge: DiagramEdge;
  sourceId: string;
  targetId: string;
  label: string;
  kind: PhysicalConnectorKind;
  markerPolicy: { start: boolean; end: boolean };
  routeOrder: number;
  sourceSide?: DiagramEdgeAnchorSide;
  targetSide?: DiagramEdgeAnchorSide;
  sourceSlotIndex?: number;
  targetSlotIndex?: number;
  dividerId?: string;
  monotonic?: SpokeMonotonicDirection;
};

type RoutedPhysicalConnector = {
  connector: PhysicalConnector;
  candidate: RouteCandidate;
  segmentStrategy: DiagramRoutedEdgeSegmentStrategy;
  hardFailures: number;
};

type AcceptedPath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
};

type RouteSimplificationPass = "compact" | "collapse";

type RouteSimplificationState = {
  edges: DiagramEdge[];
  routedDividerConnectors: RoutedPhysicalConnector[];
  paths: AcceptedPath[];
};

type RouteSimplificationPassResult = {
  state: RouteSimplificationState;
  accepted: number;
  rejected: number;
  skipped: number;
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
  const nodeBounds = request.document.nodes.map((node) => requireNodeRectangle(node));
  const segmentStrategyByEdgeId = new Map<string, DiagramRoutedEdgeSegmentStrategy>();
  const dividerPlan = options.includeDividers
    ? planRoutingDividers(request.document.edges, request.document.nodes, request.intent.routing.dividerThreshold, request)
    : { dividers: [], diagnostics: [] };
  const dividers = dividerPlan.dividers;
  const diagnostics: DiagramDiagnostic[] = [...dividerPlan.diagnostics];
  const dividerEdgeIds = new Set(dividers.flatMap((divider) => divider.sourceEdgeIds));
  const routeNodes = [...request.document.nodes, ...dividerObstacleNodes(dividers)];
  const routeNodeById = new Map(routeNodes.map((node) => [node.id, node]));
  const diagramBounds = rectangleBounds([...nodeBounds, ...dividers.map((divider) => dividerRectangle(divider))]);
  const connectors = buildPhysicalConnectors(request.document.edges, dividers, routeNodes);
  const portPools = buildAnchorPortPools(connectors);
  const dividerConnectors = connectors
    .filter((connector) => connector.kind !== "normal")
    .sort(comparePhysicalConnectors);
  const normalConnectors = connectors.filter((connector) => connector.kind === "normal");
  const acceptedPaths: AcceptedPath[] = [];
  const reservedPortKeys = new Set<string>();
  const routedDividerConnectors: RoutedPhysicalConnector[] = [];

  for (const [connectorIndex, connector] of dividerConnectors.entries()) {
    const routed = routeDividerConnector(
      connector,
      connectorIndex,
      routeNodes,
      routeNodeById,
      diagramBounds,
      portPools,
      acceptedPaths,
      reservedPortKeys,
      request.intent.routing.outerLaneMargin,
      options.includeOuterLanes
    );
    routedDividerConnectors.push(routed);
    acceptedPaths.push({
      edge: connectorRoutingEdge(connector),
      points: routed.candidate.points
    });
    reserveCandidatePorts(reservedPortKeys, routed.candidate);

    if (routed.candidate.outerLane) {
      request.context.run.logger.info({
        phase: "route",
        type: "divider-outer-lane-used",
        message: `Outer lane ${routed.candidate.outerLane} used for divider connector ${connector.id}.`,
        edgeId: connector.ownerEdge.id,
        data: { connectorId: connector.id, side: routed.candidate.outerLane }
      });
    }
  }

  const fixedReservedPortKeys = new Set(reservedPortKeys);
  const routePlans = normalConnectors.map((connector, connectorIndex) => {
    const source = requireNodeRectangle(requireNode(routeNodeById, connector.sourceId));
    const target = requireNodeRectangle(requireNode(routeNodeById, connector.targetId));
    const routingEdge = connectorRoutingEdge(connector);
    const candidates = routeCandidatesForFlexibleAnchors(
      routingEdge,
      connectorIndex,
      source,
      target,
      portPools,
      diagramBounds,
      request.intent.routing.outerLaneMargin,
      options.includeOuterLanes
    );

    return { connector, routingEdge, candidates };
  }).sort((left, right) => routePlanDifficultyByEndpoint(right.connector, routeNodes, connectors) - routePlanDifficultyByEndpoint(left.connector, routeNodes, connectors) ||
    left.connector.id.localeCompare(right.connector.id));

  request.context.run.logger.debug({
    phase: "route",
    type: "route-candidates-generated",
    message: `${routePlans.reduce((total, plan) => total + plan.candidates.length, 0)} non-divider route candidates generated.`,
    data: {
      edgeCount: routePlans.length,
      dividerEdgeCount: dividerEdgeIds.size,
      dividerSegmentCount: routedDividerConnectors.length,
      candidateCount: routePlans.reduce((total, plan) => total + plan.candidates.length, 0),
      includeOuterLanes: options.includeOuterLanes
    }
  });
  request.context.run.logger.debug({
    phase: "route",
    type: "route-order-selected",
    message: `${routePlans.length} edges ordered for congestion-aware routing.`,
    data: { edgeIds: routePlans.map((plan) => plan.connector.ownerEdge.id) }
  });

  const routedEdges: DiagramEdge[] = [];
  for (const { connector, routingEdge, candidates } of routePlans) {
    const selected = selectRouteCandidate(
      routingEdge,
      candidates,
      routeNodes,
      acceptedPaths,
      {
        includeRecovery: options.includeOuterLanes,
        source: requireNodeRectangle(requireNode(routeNodeById, connector.sourceId)),
        target: requireNodeRectangle(requireNode(routeNodeById, connector.targetId)),
        bounds: diagramBounds,
        outerLaneMargin: request.intent.routing.outerLaneMargin,
        onAttempt: () => request.context.run.logger.debug({
          phase: "route",
          type: "routing-recovery-attempted",
          message: `Sparse lane-graph recovery attempted for edge ${connector.ownerEdge.id}.`,
          edgeId: connector.ownerEdge.id
        })
      },
      reservedPortKeys
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
        message: `Sparse lane-graph recovery selected for edge ${connector.ownerEdge.id}.`,
        edgeId: connector.ownerEdge.id,
        data: selected.failureBreakdown
      });
    } else if (selected.validCandidates === 0) {
      request.context.run.logger.debug({
        phase: "route",
        type: "routing-recovery-failed",
        message: `No hard-valid recovery route found for edge ${connector.ownerEdge.id}; keeping best-effort route until final repair.`,
        edgeId: connector.ownerEdge.id,
        data: selected.failureBreakdown
      });
    }

    if (selected.candidate.outerLane) {
      request.context.run.logger.info({
        phase: "route",
        type: "outer-lane-used",
        message: `Outer lane ${selected.candidate.outerLane} used for edge ${connector.ownerEdge.id}.`,
        edgeId: connector.ownerEdge.id,
        data: { side: selected.candidate.outerLane }
      });
    }

    const routedEdge: DiagramEdge = {
      ...connector.ownerEdge,
      layout: {
        ...connector.ownerEdge.layout,
        sourceAnchor: selected.candidate.sourceAnchor,
        targetAnchor: selected.candidate.targetAnchor,
        waypoints: selected.candidate.waypoints,
        routeSource: "engine-v2"
      }
    };

    segmentStrategyByEdgeId.set(routedEdge.id, segmentStrategy);
    routedEdges.push(routedEdge);
    acceptedPaths.push({ edge: routedEdge, points: selected.candidate.points });
    reserveCandidatePorts(reservedPortKeys, selected.candidate);
  }

  const repaired = options.includeOuterLanes && request.intent.routing.maxRepairPasses > 0
    ? repairRoutedEdges(routedEdges, acceptedPaths, request, routeNodes, diagramBounds, segmentStrategyByEdgeId, portPools, fixedReservedPortKeys)
    : { edges: routedEdges, paths: acceptedPaths, accepted: 0, rejected: 0 };
  const bendReduced = reduceRouteBends({
    routedEdges: repaired.edges,
    routedDividerConnectors,
    acceptedPaths: repaired.paths,
    request,
    routeNodes,
    routeNodeById,
    segmentStrategyByEdgeId
  });
  emitFinalFallbackEvents(bendReduced.edges, bendReduced.paths, request, routeNodes, segmentStrategyByEdgeId);
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
  request.context.run.logger.debug({
    phase: "route",
    type: "bend-reduction-complete",
    message: `Route simplification complete: ${bendReduced.accepted} accepted (${bendReduced.compactAccepted} compact, ${bendReduced.collapseAccepted} collapse), ${bendReduced.rejected} rejected, ${bendReduced.skipped} skipped.`,
    data: {
      accepted: bendReduced.accepted,
      compactAccepted: bendReduced.compactAccepted,
      collapseAccepted: bendReduced.collapseAccepted,
      rejected: bendReduced.rejected,
      skipped: bendReduced.skipped
    }
  });
  const routedEdgeById = new Map(bendReduced.edges.map((edge) => [edge.id, edge]));
  const finalEdges = request.document.edges.map((edge) => dividerEdgeIds.has(edge.id)
    ? edge
    : requireMapValue(routedEdgeById, edge.id, "routed edge")
  );
  const routedDividerSegmentsByEdgeId = routedDividerSegmentsByOwner(bendReduced.routedDividerConnectors);
  const routedEdgesWithSegments = applyEngineOwnedRoutedSegments(
    finalEdges,
    routedDividerSegmentsByEdgeId,
    segmentStrategyByEdgeId
  );

  return {
    edges: routedEdgesWithSegments,
    dividers,
    diagnostics
  };
}

function buildPhysicalConnectors(
  edges: DiagramEdge[],
  dividers: DiagramRoutingDivider[],
  routeNodes: DiagramNode[]
): PhysicalConnector[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const dividerEdgeIds = new Set(dividers.flatMap((divider) => divider.sourceEdgeIds));
  const connectors: PhysicalConnector[] = [];

  for (const [dividerIndex, divider] of dividers.entries()) {
    const dividerEdges = divider.sourceEdgeIds
      .map((edgeId) => edgeById.get(edgeId))
      .filter((edge): edge is DiagramEdge => Boolean(edge));
    if (dividerEdges.length === 0) {
      continue;
    }

    const orderedSpokeEdges = orderDividerSpokeEdges(divider, dividerEdges, routeNodes);
    const trunkOwner = orderedSpokeEdges[0] ?? dividerEdges[0];
    const commonNodeId = divider.commonNodeId ?? (divider.mode === "fanOut" ? trunkOwner.sourceId : trunkOwner.targetId);
    const commonSide = sideOnEndpointToward(commonNodeId, divider.id, routeNodes);
    const baseOrder = dividerIndex * 10_000;

    if (divider.mode === "fanOut") {
      connectors.push({
        id: `${trunkOwner.id}:divider-trunk`,
        ownerEdge: trunkOwner,
        sourceId: commonNodeId,
        targetId: divider.id,
        label: "",
        kind: "divider-trunk",
        markerPolicy: { start: true, end: false },
        routeOrder: baseOrder,
        sourceSide: commonSide,
        targetSide: divider.side,
        dividerId: divider.id
      });

      orderedSpokeEdges.forEach((edge, spokeIndex) => {
        connectors.push({
          id: `${edge.id}:divider-spoke`,
          ownerEdge: edge,
          sourceId: divider.id,
          targetId: edge.targetId,
          label: edge.label ?? "",
          kind: "divider-spoke",
          markerPolicy: { start: false, end: true },
          routeOrder: baseOrder + spokeIndex + 1,
          sourceSide: oppositeSide(divider.side),
          targetSide: divider.side,
          sourceSlotIndex: spokeIndex,
          dividerId: divider.id,
          monotonic: fanOutSpokeDirection(divider.side)
        });
      });
      continue;
    }

    connectors.push({
      id: `${trunkOwner.id}:divider-trunk`,
      ownerEdge: trunkOwner,
      sourceId: divider.id,
      targetId: commonNodeId,
      label: "",
      kind: "divider-trunk",
      markerPolicy: { start: false, end: true },
      routeOrder: baseOrder,
      sourceSide: divider.side,
      targetSide: commonSide,
      dividerId: divider.id
    });

    orderedSpokeEdges.forEach((edge, spokeIndex) => {
      connectors.push({
        id: `${edge.id}:divider-spoke`,
        ownerEdge: edge,
        sourceId: edge.sourceId,
        targetId: divider.id,
        label: edge.label ?? "",
        kind: "divider-spoke",
        markerPolicy: { start: true, end: false },
        routeOrder: baseOrder + spokeIndex + 1,
        sourceSide: divider.side,
        targetSide: oppositeSide(divider.side),
        targetSlotIndex: spokeIndex,
        dividerId: divider.id,
        monotonic: fanInSpokeDirection(divider.side)
      });
    });
  }

  for (const edge of edges) {
    if (dividerEdgeIds.has(edge.id)) {
      continue;
    }
    connectors.push({
      id: edge.id,
      ownerEdge: edge,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      label: edge.label ?? "",
      kind: "normal",
      markerPolicy: { start: true, end: true },
      routeOrder: connectors.length
    });
  }

  return connectors;
}

function orderDividerSpokeEdges(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  nodes: DiagramNode[]
): DiagramEdge[] {
  const remoteRole = divider.mode === "fanOut" ? "target" : "source";
  return [...edges].sort((left, right) => {
    const leftNodeId = remoteRole === "target" ? left.targetId : left.sourceId;
    const rightNodeId = remoteRole === "target" ? right.targetId : right.sourceId;
    const leftNode = nodes.find((node) => node.id === leftNodeId);
    const rightNode = nodes.find((node) => node.id === rightNodeId);
    const leftCoordinate = leftNode?.layout
      ? dividerRemoteSortCoordinate(divider, requireNodeRectangle(leftNode))
      : 0;
    const rightCoordinate = rightNode?.layout
      ? dividerRemoteSortCoordinate(divider, requireNodeRectangle(rightNode))
      : 0;
    return leftCoordinate - rightCoordinate || left.id.localeCompare(right.id);
  });
}

function dividerRemoteSortCoordinate(divider: DiagramRoutingDivider, rectangle: Rectangle): number {
  return divider.side === "north" || divider.side === "south"
    ? centerX(rectangle)
    : centerY(rectangle);
}

function sideOnEndpointToward(endpointId: string, otherId: string, nodes: DiagramNode[]): DiagramEdgeAnchorSide {
  const endpoint = requireNodeRectangle(requireNode(new Map(nodes.map((node) => [node.id, node])), endpointId));
  const other = requireNodeRectangle(requireNode(new Map(nodes.map((node) => [node.id, node])), otherId));
  return chooseAnchorSides(endpoint, other).source;
}

function fanOutSpokeDirection(side: DiagramEdgeAnchorSide): SpokeMonotonicDirection {
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

function fanInSpokeDirection(side: DiagramEdgeAnchorSide): SpokeMonotonicDirection {
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

function comparePhysicalConnectors(left: PhysicalConnector, right: PhysicalConnector): number {
  return left.routeOrder - right.routeOrder || left.id.localeCompare(right.id);
}

function connectorRoutingEdge(connector: PhysicalConnector): DiagramEdge {
  return {
    ...connector.ownerEdge,
    id: connector.id,
    sourceId: connector.sourceId,
    targetId: connector.targetId,
    label: connector.label
  };
}

function routeDividerConnector(
  connector: PhysicalConnector,
  connectorIndex: number,
  routeNodes: DiagramNode[],
  routeNodeById: Map<string, DiagramNode>,
  bounds: { left: number; right: number; top: number; bottom: number },
  portPools: AnchorPortPools,
  acceptedPaths: AcceptedPath[],
  reservedPortKeys: Set<string>,
  outerLaneMargin: number,
  includeOuterLanes: boolean
): RoutedPhysicalConnector {
  const routingEdge = connectorRoutingEdge(connector);
  const source = requireNodeRectangle(requireNode(routeNodeById, connector.sourceId));
  const target = requireNodeRectangle(requireNode(routeNodeById, connector.targetId));
  const candidates = routeCandidatesForConstrainedConnector(
    connector,
    connectorIndex,
    source,
    target,
    portPools,
    bounds,
    outerLaneMargin,
    includeOuterLanes
  );
  const selected = selectDividerRouteCandidate(routingEdge, connector, candidates, routeNodes, acceptedPaths, reservedPortKeys);
  const segmentStrategy: DiagramRoutedEdgeSegmentStrategy = selected.hardFailures > 0
    ? "fallback"
    : "divider";

  return {
    connector,
    candidate: selected.candidate,
    segmentStrategy,
    hardFailures: selected.hardFailures
  };
}

function routeCandidatesForConstrainedConnector(
  connector: PhysicalConnector,
  connectorIndex: number,
  source: Rectangle,
  target: Rectangle,
  portPools: AnchorPortPools,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  includeOuterLanes: boolean
): RouteCandidate[] {
  if (!connector.sourceSide || !connector.targetSide) {
    throw new Error(`Divider connector ${connector.id} is missing side constraints.`);
  }

  const sourceSlots = constrainedPortSlots(portPools, connector.sourceId, connector.sourceSide, connector.sourceSlotIndex);
  const targetSlots = constrainedPortSlots(portPools, connector.targetId, connector.targetSide, connector.targetSlotIndex);
  const slotPairs = sideConstrainedSlotPairs(sourceSlots, targetSlots, source, target);
  const budget = connector.kind === "divider-spoke" ? outerStrategyCandidateBudget : corridorStrategyCandidateBudget;
  const candidates: RouteCandidate[] = [];

  for (const [sourceSlot, targetSlot] of slotPairs) {
    for (const candidate of routeCandidatesForFixedAnchorPair(
      connector.id,
      connectorIndex,
      source,
      target,
      sourceSlot.anchor,
      targetSlot.anchor,
      sourceSlot.key,
      targetSlot.key,
      bounds,
      outerLaneMargin,
      includeOuterLanes
    )) {
      candidates.push(candidate);
      if (candidates.length >= budget) {
        return uniqueRoutes(candidates);
      }
    }
  }

  return uniqueRoutes(candidates);
}

function constrainedPortSlots(
  portPools: AnchorPortPools,
  nodeId: string,
  side: DiagramEdgeAnchorSide,
  slotIndex: number | undefined
): AnchorPortSlot[] {
  const slots = requirePortSlots(portPools, nodeId, side);
  if (slotIndex === undefined) {
    return slots;
  }
  return [slots[Math.min(slotIndex, slots.length - 1)]];
}

function selectDividerRouteCandidate(
  edge: DiagramEdge,
  connector: PhysicalConnector,
  candidates: RouteCandidate[],
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  reservedPortKeys: Set<string>
): RouteSelection {
  const availableCandidates = candidates.filter((candidate) => !candidateUsesReservedPort(candidate, reservedPortKeys));
  const candidatesToScore = availableCandidates.length > 0 ? availableCandidates : candidates;
  const scored: ScoredRouteCandidate[] = candidatesToScore.map((candidate) => {
    const failureBreakdown = routeHardFailureBreakdown(edge, candidate.points, nodes, acceptedPaths);
    return {
      candidate,
      failureBreakdown,
      hardFailures: failureBreakdown.hardFailures,
      score: dividerRouteCost(edge, connector, candidate, nodes, acceptedPaths)
    };
  });
  if (scored.length === 0) {
    throw new Error(`No divider route candidates were generated for connector ${connector.id}.`);
  }
  const valid = scored.filter((candidate) => candidate.hardFailures === 0);
  const selected = (valid.length > 0 ? valid : scored).reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best
  );

  return {
    ...selected,
    validCandidates: valid.length,
    recovered: false
  };
}

function dividerRouteCost(
  edge: DiagramEdge,
  connector: PhysicalConnector,
  candidate: RouteCandidate,
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[]
): number {
  const nodeHits = countEdgeNodeHits(edge, candidate.points, nodes);
  const illegalSegmentOverlaps = countIllegalSegmentOverlaps(edge, candidate.points, acceptedPaths);
  const crossings = countCrossingsWithAccepted(candidate.points, acceptedPaths);
  const bends = countBends(candidate.points);
  const length = pathLength(candidate.points);
  const nonMonotonic = connector.monotonic ? countNonMonotonicSteps(candidate.points, connector.monotonic) : 0;
  const corridorViolations = connector.monotonic ? countMonotonicCorridorViolations(candidate.points, connector.monotonic) : 0;
  const spokeOuterLane = connector.kind === "divider-spoke" && candidate.outerLane ? 1 : 0;

  return illegalSegmentOverlaps * 1_000_000_000_000 +
    nodeHits * 1_000_000_000_000 +
    nonMonotonic * 500_000_000_000 +
    crossings * 250_000_000_000 +
    corridorViolations * 100_000_000_000 +
    spokeOuterLane * 10_000_000 +
    (candidate.outerLane ? (candidate.outerLaneIndex ?? 1) * 500_000 : 0) +
    bends * 1_000 +
    length * 0.1;
}

function countNonMonotonicSteps(points: DiagramPoint[], direction: SpokeMonotonicDirection): number {
  let violations = 0;
  for (const [start, end] of pathSegments(points)) {
    if (direction === "down" && end.y + epsilon < start.y) {
      violations += 1;
    } else if (direction === "up" && end.y > start.y + epsilon) {
      violations += 1;
    } else if (direction === "right" && end.x + epsilon < start.x) {
      violations += 1;
    } else if (direction === "left" && end.x > start.x + epsilon) {
      violations += 1;
    }
  }
  return violations;
}

function countMonotonicCorridorViolations(points: DiagramPoint[], direction: SpokeMonotonicDirection): number {
  if (points.length < 2) {
    return 0;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const minX = Math.min(first.x, last.x) - anchorStubDistance;
  const maxX = Math.max(first.x, last.x) + anchorStubDistance;
  const minY = Math.min(first.y, last.y) - anchorStubDistance;
  const maxY = Math.max(first.y, last.y) + anchorStubDistance;
  let violations = 0;

  for (const point of points) {
    if ((direction === "up" || direction === "down") && (point.y < minY || point.y > maxY)) {
      violations += 1;
    }
    if ((direction === "left" || direction === "right") && (point.x < minX || point.x > maxX)) {
      violations += 1;
    }
  }

  return violations;
}

function routedDividerSegmentsByOwner(routedConnectors: RoutedPhysicalConnector[]): Map<string, DiagramRoutedEdgeSegment[]> {
  const segmentsByEdgeId = new Map<string, DiagramRoutedEdgeSegment[]>();

  for (const routed of [...routedConnectors].sort((left, right) => comparePhysicalConnectors(left.connector, right.connector))) {
    const { connector, candidate } = routed;
    const segment: DiagramRoutedEdgeSegment = {
      id: connector.id,
      sourceId: connector.sourceId,
      targetId: connector.targetId,
      label: connector.label,
      sourceAnchor: candidate.sourceAnchor,
      targetAnchor: candidate.targetAnchor,
      waypoints: candidate.waypoints,
      markerPolicy: connector.markerPolicy,
      strategy: routed.segmentStrategy
    };
    segmentsByEdgeId.set(connector.ownerEdge.id, [
      ...(segmentsByEdgeId.get(connector.ownerEdge.id) ?? []),
      segment
    ]);
  }

  return segmentsByEdgeId;
}

function reduceRouteBends(input: {
  routedEdges: DiagramEdge[];
  routedDividerConnectors: RoutedPhysicalConnector[];
  acceptedPaths: AcceptedPath[];
  request: RouteRequest;
  routeNodes: DiagramNode[];
  routeNodeById: Map<string, DiagramNode>;
  segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>;
}): {
  edges: DiagramEdge[];
  routedDividerConnectors: RoutedPhysicalConnector[];
  paths: AcceptedPath[];
  accepted: number;
  compactAccepted: number;
  collapseAccepted: number;
  rejected: number;
  skipped: number;
} {
  const initialState: RouteSimplificationState = {
    edges: input.routedEdges,
    routedDividerConnectors: input.routedDividerConnectors,
    paths: input.acceptedPaths
  };
  const compacted = applyRouteSimplificationPass("compact", initialState, input);
  const collapsed = applyRouteSimplificationPass("collapse", compacted.state, input);

  return {
    edges: collapsed.state.edges,
    routedDividerConnectors: collapsed.state.routedDividerConnectors,
    paths: collapsed.state.paths,
    accepted: compacted.accepted + collapsed.accepted,
    compactAccepted: compacted.accepted,
    collapseAccepted: collapsed.accepted,
    rejected: compacted.rejected + collapsed.rejected,
    skipped: compacted.skipped + collapsed.skipped
  };
}

function applyRouteSimplificationPass(
  pass: RouteSimplificationPass,
  state: RouteSimplificationState,
  input: {
    request: RouteRequest;
    routeNodes: DiagramNode[];
    routeNodeById: Map<string, DiagramNode>;
    segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>;
  }
): RouteSimplificationPassResult {
  let currentEdges = state.edges;
  let currentDividerConnectors = state.routedDividerConnectors;
  let currentPaths = state.paths;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;

  for (const pathRef of [...currentPaths]) {
    const currentPath = currentPaths.find((path) => path.edge.id === pathRef.edge.id);
    if (!currentPath) {
      skipped += 1;
      continue;
    }

    const dividerConnector = currentDividerConnectors.find((candidate) => candidate.connector.id === currentPath.edge.id);
    if (dividerConnector) {
      const selected = pass === "compact"
        ? selectRouteCompactionForConnector(dividerConnector, currentPath, currentPaths, input.routeNodes, input.routeNodeById)
        : selectBendReductionForConnector(dividerConnector, currentPath, currentPaths, input.routeNodes, input.routeNodeById);
      if (selected === "skipped") {
        skipped += 1;
        continue;
      }
      if (!selected) {
        rejected += 1;
        continue;
      }

      const otherPaths = currentPaths.filter((path) => path.edge.id !== dividerConnector.connector.id);
      const hardFailures = routeHardFailureBreakdown(
        connectorRoutingEdge(dividerConnector.connector),
        selected.points,
        input.routeNodes,
        otherPaths
      ).hardFailures;
      const reducedConnector: RoutedPhysicalConnector = {
        ...dividerConnector,
        candidate: selected,
        segmentStrategy: hardFailures > 0 ? dividerConnector.segmentStrategy : "divider",
        hardFailures
      };
      currentDividerConnectors = currentDividerConnectors.map((candidate) =>
        candidate.connector.id === dividerConnector.connector.id ? reducedConnector : candidate
      );
      currentPaths = currentPaths.map((path) =>
        path.edge.id === dividerConnector.connector.id
          ? { edge: connectorRoutingEdge(dividerConnector.connector), points: selected.points }
          : path
      );
      accepted += 1;
      input.request.context.run.logger.debug({
        phase: "route",
        type: "bend-reduction-accepted",
        message: `${pass === "compact" ? "Route compaction" : "Bend reduction"} accepted for divider connector ${dividerConnector.connector.id}.`,
        edgeId: dividerConnector.connector.ownerEdge.id,
        data: { connectorId: dividerConnector.connector.id, pass }
      });
      continue;
    }

    const edge = currentEdges.find((candidate) => candidate.id === currentPath.edge.id);
    if (!edge) {
      skipped += 1;
      continue;
    }

    const selected = pass === "compact"
      ? selectRouteCompactionForEdge(edge, currentPath, currentPaths, input.routeNodes, input.routeNodeById)
      : selectBendReductionForEdge(edge, currentPath, currentPaths, input.routeNodes, input.routeNodeById);
    if (selected === "skipped") {
      skipped += 1;
      continue;
    }
    if (!selected) {
      rejected += 1;
      continue;
    }

    const reducedEdge: DiagramEdge = {
      ...edge,
      layout: {
        ...edge.layout,
        sourceAnchor: selected.sourceAnchor,
        targetAnchor: selected.targetAnchor,
        waypoints: selected.waypoints,
        routeSource: "engine-v2"
      }
    };
    currentEdges = currentEdges.map((candidate) => candidate.id === edge.id ? reducedEdge : candidate);
    currentPaths = currentPaths.map((path) =>
      path.edge.id === edge.id ? { edge: reducedEdge, points: selected.points } : path
    );
    if (pass === "collapse") {
      input.segmentStrategyByEdgeId.set(edge.id, "corridor");
    }
    accepted += 1;
    input.request.context.run.logger.debug({
      phase: "route",
      type: "bend-reduction-accepted",
      message: `${pass === "compact" ? "Route compaction" : "Bend reduction"} accepted for edge ${edge.id}.`,
      edgeId: edge.id,
      data: { pass }
    });
  }

  return {
    state: {
      edges: currentEdges,
      routedDividerConnectors: currentDividerConnectors,
      paths: currentPaths
    },
    accepted,
    rejected,
    skipped
  };
}

function selectRouteCompactionForEdge(
  edge: DiagramEdge,
  currentPath: AcceptedPath,
  acceptedPaths: AcceptedPath[],
  routeNodes: DiagramNode[],
  routeNodeById: Map<string, DiagramNode>
): RouteCandidate | "skipped" | undefined {
  if (!edge.layout?.sourceAnchor || !edge.layout.targetAnchor) {
    return "skipped";
  }

  const source = requireNodeRectangle(requireNode(routeNodeById, edge.sourceId));
  const target = requireNodeRectangle(requireNode(routeNodeById, edge.targetId));
  const currentCandidate = reconstructCurrentRouteCandidate({
    source,
    target,
    sourceAnchor: edge.layout.sourceAnchor,
    targetAnchor: edge.layout.targetAnchor,
    waypoints: edge.layout.waypoints ?? currentPath.points.slice(1, -1),
    points: currentPath.points
  });

  if (currentCandidate.waypoints.length === 0) {
    return "skipped";
  }

  return selectRouteCompactionCandidate(
    edge,
    currentCandidate,
    routeNodes,
    acceptedPaths.filter((path) => path.edge.id !== edge.id)
  );
}

function selectRouteCompactionForConnector(
  routed: RoutedPhysicalConnector,
  currentPath: AcceptedPath,
  acceptedPaths: AcceptedPath[],
  routeNodes: DiagramNode[],
  routeNodeById: Map<string, DiagramNode>
): RouteCandidate | "skipped" | undefined {
  const edge = connectorRoutingEdge(routed.connector);
  const source = requireNodeRectangle(requireNode(routeNodeById, routed.connector.sourceId));
  const target = requireNodeRectangle(requireNode(routeNodeById, routed.connector.targetId));
  const currentCandidate = reconstructCurrentRouteCandidate({
    source,
    target,
    sourceAnchor: routed.candidate.sourceAnchor,
    targetAnchor: routed.candidate.targetAnchor,
    sourcePortKey: routed.candidate.sourcePortKey,
    targetPortKey: routed.candidate.targetPortKey,
    waypoints: routed.candidate.waypoints.length > 0 ? routed.candidate.waypoints : currentPath.points.slice(1, -1),
    points: currentPath.points
  });

  if (currentCandidate.waypoints.length === 0) {
    return "skipped";
  }

  return selectRouteCompactionCandidate(
    edge,
    currentCandidate,
    routeNodes,
    acceptedPaths.filter((path) => path.edge.id !== routed.connector.id),
    routed.connector
  );
}

function reconstructCurrentRouteCandidate(input: {
  source: Rectangle;
  target: Rectangle;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  sourcePortKey?: string;
  targetPortKey?: string;
  waypoints: DiagramPoint[];
  points: DiagramPoint[];
}): RouteCandidate {
  const waypoints = input.waypoints.length > 0 ? input.waypoints : input.points.slice(1, -1);
  const points = [
    anchorPoint(input.source, input.sourceAnchor),
    ...waypoints,
    anchorPoint(input.target, input.targetAnchor)
  ];

  return {
    sourceAnchor: input.sourceAnchor,
    targetAnchor: input.targetAnchor,
    sourcePortKey: input.sourcePortKey,
    targetPortKey: input.targetPortKey,
    points,
    waypoints
  };
}

function selectRouteCompactionCandidate(
  edge: DiagramEdge,
  currentCandidate: RouteCandidate,
  routeNodes: DiagramNode[],
  otherPaths: AcceptedPath[],
  dividerConnector?: PhysicalConnector
): RouteCandidate | undefined {
  const currentQuality = routeQuality(edge, currentCandidate.points, routeNodes, otherPaths);
  const candidate = canonicalCompactRouteCandidate(currentCandidate);
  const quality = routeQuality(edge, candidate.points, routeNodes, otherPaths);

  if (candidate.waypoints.length >= currentCandidate.waypoints.length) {
    return undefined;
  }
  if (routeCandidatesEqual(candidate, currentCandidate)) {
    return undefined;
  }
  if (!isOrthogonalRoute(candidate.points) || !bendReductionPreservesDividerConstraints(candidate, currentCandidate, dividerConnector)) {
    return undefined;
  }
  if (quality.hardFailures > currentQuality.hardFailures) {
    return undefined;
  }
  if (quality.illegalSegmentOverlaps > currentQuality.illegalSegmentOverlaps) {
    return undefined;
  }
  if (quality.crossings > currentQuality.crossings) {
    return undefined;
  }
  if (quality.bends > currentQuality.bends) {
    return undefined;
  }
  if (quality.length > currentQuality.length + epsilon) {
    return undefined;
  }

  return candidate;
}

function selectBendReductionForEdge(
  edge: DiagramEdge,
  currentPath: AcceptedPath,
  acceptedPaths: AcceptedPath[],
  routeNodes: DiagramNode[],
  routeNodeById: Map<string, DiagramNode>
): RouteCandidate | "skipped" | undefined {
  if (!edge.layout?.sourceAnchor || !edge.layout.targetAnchor || countBends(currentPath.points) < 2) {
    return "skipped";
  }

  const source = requireNodeRectangle(requireNode(routeNodeById, edge.sourceId));
  const target = requireNodeRectangle(requireNode(routeNodeById, edge.targetId));
  const currentCandidate = reconstructCurrentRouteCandidate({
    source,
    target,
    sourceAnchor: edge.layout.sourceAnchor,
    targetAnchor: edge.layout.targetAnchor,
    waypoints: edge.layout.waypoints ?? currentPath.points.slice(1, -1),
    points: currentPath.points
  });

  return selectBendReductionCandidate(
    edge,
    currentCandidate,
    source,
    target,
    routeNodes,
    acceptedPaths.filter((path) => path.edge.id !== edge.id)
  );
}

function selectBendReductionForConnector(
  routed: RoutedPhysicalConnector,
  currentPath: AcceptedPath,
  acceptedPaths: AcceptedPath[],
  routeNodes: DiagramNode[],
  routeNodeById: Map<string, DiagramNode>
): RouteCandidate | "skipped" | undefined {
  if (countBends(currentPath.points) < 2) {
    return "skipped";
  }

  const edge = connectorRoutingEdge(routed.connector);
  const source = requireNodeRectangle(requireNode(routeNodeById, routed.connector.sourceId));
  const target = requireNodeRectangle(requireNode(routeNodeById, routed.connector.targetId));
  const currentCandidate = reconstructCurrentRouteCandidate({
    source,
    target,
    sourceAnchor: routed.candidate.sourceAnchor,
    targetAnchor: routed.candidate.targetAnchor,
    sourcePortKey: routed.candidate.sourcePortKey,
    targetPortKey: routed.candidate.targetPortKey,
    waypoints: routed.candidate.waypoints.length > 0 ? routed.candidate.waypoints : currentPath.points.slice(1, -1),
    points: currentPath.points
  });

  return selectBendReductionCandidate(
    edge,
    currentCandidate,
    source,
    target,
    routeNodes,
    acceptedPaths.filter((path) => path.edge.id !== routed.connector.id),
    routed.connector
  );
}

function selectBendReductionCandidate(
  edge: DiagramEdge,
  currentCandidate: RouteCandidate,
  source: Rectangle,
  target: Rectangle,
  routeNodes: DiagramNode[],
  otherPaths: AcceptedPath[],
  dividerConnector?: PhysicalConnector
): RouteCandidate | undefined {
  const currentQuality = routeQuality(edge, currentCandidate.points, routeNodes, otherPaths);
  const candidates = uniqueRoutes(bendReductionCandidates(edge.id, currentCandidate, source, target)
    .map((candidate) => canonicalCompactRouteCandidate(candidate)))
    .filter((candidate) => !routeCandidatesEqual(candidate, currentCandidate))
    .filter((candidate) => bendReductionPreservesDividerConstraints(candidate, currentCandidate, dividerConnector));
  const acceptable = candidates
    .map((candidate) => ({
      candidate,
      quality: routeQuality(edge, candidate.points, routeNodes, otherPaths)
    }))
    .filter(({ quality }) => quality.hardFailures <= currentQuality.hardFailures)
    .filter(({ quality }) => quality.illegalSegmentOverlaps <= currentQuality.illegalSegmentOverlaps)
    .filter(({ quality }) => quality.crossings <= currentQuality.crossings)
    .filter(({ quality }) => quality.bends < currentQuality.bends)
    .filter(({ quality }) => quality.length <= currentQuality.length + epsilon)
    .sort((left, right) =>
      left.quality.bends - right.quality.bends ||
      left.quality.crossings - right.quality.crossings ||
      left.quality.illegalSegmentOverlaps - right.quality.illegalSegmentOverlaps ||
      left.quality.length - right.quality.length
    );

  return acceptable[0]?.candidate;
}

function bendReductionCandidates(
  edgeId: string,
  currentCandidate: RouteCandidate,
  source: Rectangle,
  target: Rectangle
): RouteCandidate[] {
  const sourcePoint = anchorPoint(source, currentCandidate.sourceAnchor);
  const targetPoint = anchorPoint(target, currentCandidate.targetAnchor);
  const sourcePort = outsidePort(sourcePoint, currentCandidate.sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, currentCandidate.targetAnchor, 0);
  const routes: RouteCandidate[] = [];

  if (Math.abs(sourcePort.x - targetPort.x) < epsilon || Math.abs(sourcePort.y - targetPort.y) < epsilon) {
    routes.push(pointsToRoute(
      [sourcePoint, sourcePort, targetPort, targetPoint],
      currentCandidate.sourceAnchor,
      currentCandidate.targetAnchor,
      currentCandidate.sourcePortKey,
      currentCandidate.targetPortKey
    ));
  }

  routes.push(pointsToRoute(
    [sourcePoint, sourcePort, { x: targetPort.x, y: sourcePort.y }, targetPort, targetPoint],
    currentCandidate.sourceAnchor,
    currentCandidate.targetAnchor,
    currentCandidate.sourcePortKey,
    currentCandidate.targetPortKey
  ));
  routes.push(pointsToRoute(
    [sourcePoint, sourcePort, { x: sourcePort.x, y: targetPort.y }, targetPort, targetPoint],
    currentCandidate.sourceAnchor,
    currentCandidate.targetAnchor,
    currentCandidate.sourcePortKey,
    currentCandidate.targetPortKey
  ));

  return uniqueRoutes(routes).filter((candidate) => isOrthogonalRoute(candidate.points));
}

function bendReductionPreservesDividerConstraints(
  candidate: RouteCandidate,
  currentCandidate: RouteCandidate,
  connector: PhysicalConnector | undefined
): boolean {
  if (!connector) {
    return true;
  }
  if (candidate.sourceAnchor.side !== currentCandidate.sourceAnchor.side ||
    candidate.targetAnchor.side !== currentCandidate.targetAnchor.side) {
    return false;
  }
  if (connector.sourceSide && candidate.sourceAnchor.side !== connector.sourceSide) {
    return false;
  }
  if (connector.targetSide && candidate.targetAnchor.side !== connector.targetSide) {
    return false;
  }
  return !connector.monotonic || countNonMonotonicSteps(candidate.points, connector.monotonic) === 0;
}

function routeQuality(
  edge: DiagramEdge,
  points: DiagramPoint[],
  routeNodes: DiagramNode[],
  acceptedPaths: AcceptedPath[]
): { hardFailures: number; illegalSegmentOverlaps: number; crossings: number; bends: number; length: number } {
  const breakdown = routeHardFailureBreakdown(edge, points, routeNodes, acceptedPaths);
  return {
    hardFailures: breakdown.hardFailures,
    illegalSegmentOverlaps: breakdown.segmentOverlaps,
    crossings: countCrossingsWithAccepted(points, acceptedPaths),
    bends: countBends(points),
    length: pathLength(points)
  };
}

function isOrthogonalRoute(points: DiagramPoint[]): boolean {
  return pathSegments(points).every(([start, end]) =>
    Math.abs(start.x - end.x) < epsilon || Math.abs(start.y - end.y) < epsilon
  );
}

export function __testSelectBendReductionCandidate(input: {
  edge: DiagramEdge;
  source: Rectangle;
  target: Rectangle;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  points: DiagramPoint[];
  routeNodes: DiagramNode[];
  acceptedPaths?: AcceptedPath[];
  dividerConstraints?: {
    sourceSide?: DiagramEdgeAnchorSide;
    targetSide?: DiagramEdgeAnchorSide;
    monotonic?: SpokeMonotonicDirection;
  };
}): { points: DiagramPoint[]; waypoints: DiagramPoint[]; sourceAnchor: DiagramEdgeAnchor; targetAnchor: DiagramEdgeAnchor } | undefined {
  const connector: PhysicalConnector | undefined = input.dividerConstraints
    ? {
      id: input.edge.id,
      ownerEdge: input.edge,
      sourceId: input.edge.sourceId,
      targetId: input.edge.targetId,
      label: input.edge.label ?? "",
      kind: "divider-spoke",
      markerPolicy: { start: true, end: true },
      routeOrder: 0,
      sourceSide: input.dividerConstraints.sourceSide,
      targetSide: input.dividerConstraints.targetSide,
      monotonic: input.dividerConstraints.monotonic
    }
    : undefined;

  return selectBendReductionCandidate(
    input.edge,
    {
      sourceAnchor: input.sourceAnchor,
      targetAnchor: input.targetAnchor,
      points: input.points,
      waypoints: input.points.slice(1, -1)
    },
    input.source,
    input.target,
    input.routeNodes,
    input.acceptedPaths ?? [],
    connector
  );
}

export function __testSelectRouteCompactionCandidate(input: {
  edge: DiagramEdge;
  source: Rectangle;
  target: Rectangle;
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  points: DiagramPoint[];
  routeNodes: DiagramNode[];
  acceptedPaths?: AcceptedPath[];
  dividerConstraints?: {
    sourceSide?: DiagramEdgeAnchorSide;
    targetSide?: DiagramEdgeAnchorSide;
    monotonic?: SpokeMonotonicDirection;
  };
}): { points: DiagramPoint[]; waypoints: DiagramPoint[]; sourceAnchor: DiagramEdgeAnchor; targetAnchor: DiagramEdgeAnchor } | undefined {
  const connector: PhysicalConnector | undefined = input.dividerConstraints
    ? {
      id: input.edge.id,
      ownerEdge: input.edge,
      sourceId: input.edge.sourceId,
      targetId: input.edge.targetId,
      label: input.edge.label ?? "",
      kind: "divider-spoke",
      markerPolicy: { start: true, end: true },
      routeOrder: 0,
      sourceSide: input.dividerConstraints.sourceSide,
      targetSide: input.dividerConstraints.targetSide,
      monotonic: input.dividerConstraints.monotonic
    }
    : undefined;

  const currentCandidate = reconstructCurrentRouteCandidate({
    source: input.source,
    target: input.target,
    sourceAnchor: input.sourceAnchor,
    targetAnchor: input.targetAnchor,
    waypoints: input.points.slice(1, -1),
    points: input.points
  });

  return selectRouteCompactionCandidate(
    input.edge,
    currentCandidate,
    input.routeNodes,
    input.acceptedPaths ?? [],
    connector
  );
}

function selectRouteCandidate(
  edge: DiagramEdge,
  candidates: RouteCandidate[],
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  recovery?: RouteRecoveryOptions,
  reservedPortKeys: Set<string> = new Set()
): RouteSelection {
  const availableCandidates = candidates.filter((candidate) => !candidateUsesReservedPort(candidate, reservedPortKeys));
  const candidatesToScore = availableCandidates.length > 0 ? availableCandidates : candidates;
  const scored: ScoredRouteCandidate[] = candidatesToScore.map((candidate) => ({
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
    ? scoreRecoveryCandidates(edge, nodes, acceptedPaths, recovery, scored)
    : [];
  const allScored = [...scored, ...recoveryScored];
  if (allScored.length === 0) {
    throw new Error(`No route candidates were generated for edge ${edge.id}.`);
  }
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

function scoreRecoveryCandidates(
  edge: DiagramEdge,
  nodes: DiagramNode[],
  acceptedPaths: AcceptedPath[],
  recovery: RouteRecoveryOptions,
  seeds: ScoredRouteCandidate[]
): ScoredRouteCandidate[] {
  const recoveredCandidates: ScoredRouteCandidate[] = [];
  const seenAnchorPairs = new Set<string>();

  for (const seed of [...seeds].sort((left, right) => left.score - right.score)) {
    const key = candidatePortPairKey(seed.candidate);
    if (seenAnchorPairs.has(key)) {
      continue;
    }
    seenAnchorPairs.add(key);
    const recovered = recoverSparseLaneRoute(
      edge,
      recovery.source,
      recovery.target,
      seed.candidate.sourceAnchor,
      seed.candidate.targetAnchor,
      recovery.bounds,
      recovery.outerLaneMargin,
      nodes,
      acceptedPaths,
      seed.candidate.sourcePortKey,
      seed.candidate.targetPortKey
    );
    if (!recovered) {
      continue;
    }
    const failureBreakdown = routeHardFailureBreakdown(edge, recovered.points, nodes, acceptedPaths);
    recoveredCandidates.push({
      candidate: recovered,
      failureBreakdown,
      hardFailures: failureBreakdown.hardFailures,
      score: routeCost(edge, recovered, nodes, acceptedPaths)
    });
    if (seenAnchorPairs.size >= recoveryAnchorPairBudget) {
      break;
    }
  }

  return recoveredCandidates;
}

function repairRoutedEdges(
  routedEdges: DiagramEdge[],
  acceptedPaths: AcceptedPath[],
  request: RouteRequest,
  routeNodes: DiagramNode[],
  diagramBounds: { left: number; right: number; top: number; bottom: number },
  segmentStrategyByEdgeId: Map<string, DiagramRoutedEdgeSegmentStrategy>,
  portPools: AnchorPortPools,
  fixedReservedPortKeys: Set<string>
): { edges: DiagramEdge[]; paths: AcceptedPath[]; accepted: number; rejected: number } {
  const nodeById = new Map(routeNodes.map((node) => [node.id, node]));
  let currentEdges = routedEdges;
  let currentPaths = acceptedPaths;
  let totalAccepted = 0;
  let totalRejected = 0;

  for (let pass = 1; pass <= request.intent.routing.maxRepairPasses; pass += 1) {
    let acceptedInPass = 0;

    for (const edge of currentEdges) {
      const currentPath = currentPaths.find((path) => path.edge.id === edge.id);
      if (!currentPath || !edge.layout?.sourceAnchor || !edge.layout.targetAnchor) {
        continue;
      }

      const source = requireNodeRectangle(requireNode(nodeById, edge.sourceId));
      const target = requireNodeRectangle(requireNode(nodeById, edge.targetId));
      const otherPaths = currentPaths.filter((path) => path.edge.id !== edge.id);
      const currentCandidate: RouteCandidate = {
        sourceAnchor: edge.layout.sourceAnchor,
        targetAnchor: edge.layout.targetAnchor,
        points: currentPath.points,
        waypoints: edge.layout?.waypoints ?? []
      };
      const currentHardFailures = routeHardFailureBreakdown(edge, currentCandidate.points, routeNodes, otherPaths).hardFailures;
      const currentScore = routeCost(edge, currentCandidate, routeNodes, otherPaths);
      const reservedPortKeys = reservedPortKeysForEdges(
        currentEdges.filter((candidate) => candidate.id !== edge.id),
        portPools,
        fixedReservedPortKeys
      );
      const selected = selectRouteCandidate(
        edge,
        routeCandidatesForFlexibleAnchors(
          edge,
          currentEdges.findIndex((candidate) => candidate.id === edge.id),
          source,
          target,
          portPools,
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
          bounds: diagramBounds,
          outerLaneMargin: request.intent.routing.outerLaneMargin,
          onAttempt: () => request.context.run.logger.debug({
            phase: "repair",
            type: "routing-recovery-attempted",
            message: `Sparse lane-graph recovery attempted for edge ${edge.id} during repair.`,
            edgeId: edge.id
          })
        },
        reservedPortKeys
      );
      const improvesHardFailureCount = selected.hardFailures < currentHardFailures;
      const improvesSoftCost =
        selected.hardFailures === currentHardFailures &&
        selected.score + epsilon < currentScore &&
        !routeCandidatesEqual(selected.candidate, currentCandidate);

      if (improvesHardFailureCount || improvesSoftCost) {
        const repairedEdge: DiagramEdge = {
          ...edge,
          layout: {
            ...edge.layout,
            sourceAnchor: selected.candidate.sourceAnchor,
            targetAnchor: selected.candidate.targetAnchor,
            waypoints: selected.candidate.waypoints,
            routeSource: "engine-v2"
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

function routePlanDifficultyByEndpoint(
  edge: { sourceId: string; targetId: string },
  nodes: DiagramNode[],
  edges: Array<{ sourceId: string; targetId: string }>
): number {
  const source = nodes.find((node) => node.id === edge.sourceId);
  const target = nodes.find((node) => node.id === edge.targetId);
  if (!source?.layout || !target?.layout) {
    return 0;
  }

  const sourceRectangle = requireNodeRectangle(source);
  const targetRectangle = requireNodeRectangle(target);
  const sourceCenter = { x: centerX(sourceRectangle), y: centerY(sourceRectangle) };
  const targetCenter = { x: centerX(targetRectangle), y: centerY(targetRectangle) };
  const obstacleCount = nodes.filter((node) =>
    node.id !== edge.sourceId &&
    node.id !== edge.targetId &&
    node.layout &&
    segmentIntersectsRectangle(sourceCenter, targetCenter, expandRectangle(node.layout, laneGraphClearance / 2))
  ).length;
  const degree = edges.filter((candidate) =>
    candidate.sourceId === edge.sourceId ||
    candidate.targetId === edge.sourceId ||
    candidate.sourceId === edge.targetId ||
    candidate.targetId === edge.targetId
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
  acceptedPaths: AcceptedPath[],
  sourcePortKey?: string,
  targetPortKey?: string
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
    ...pointsToRoute([sourcePoint, ...path, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
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

function buildAnchorPortPools(edges: Array<{ sourceId: string; targetId: string }>): AnchorPortPools {
  const degreeByNodeId = new Map<string, number>();
  for (const edge of edges) {
    degreeByNodeId.set(edge.sourceId, (degreeByNodeId.get(edge.sourceId) ?? 0) + 1);
    degreeByNodeId.set(edge.targetId, (degreeByNodeId.get(edge.targetId) ?? 0) + 1);
  }

  const pools: AnchorPortPools = new Map();
  for (const [nodeId, degree] of degreeByNodeId) {
    const pool = Object.fromEntries(allAnchorSides().map((side) => [
      side,
      Array.from({ length: degree }, (_, slotIndex): AnchorPortSlot => ({
        nodeId,
        side,
        slotIndex,
        key: portSlotKey(nodeId, side, slotIndex),
        anchor: {
          side,
          ratio: roundRatio((slotIndex + 1) / (degree + 1))
        }
      }))
    ])) as NodeAnchorPortPool;
    pools.set(nodeId, pool);
  }

  return pools;
}

function requirePortSlots(
  portPools: AnchorPortPools,
  nodeId: string,
  side: DiagramEdgeAnchorSide
): AnchorPortSlot[] {
  const slots = portPools.get(nodeId)?.[side];
  if (!slots || slots.length === 0) {
    throw new Error(`Missing route anchor port slots for ${nodeId}:${side}.`);
  }
  return slots;
}

function sideConstrainedSlotPairs(
  sourceSlots: AnchorPortSlot[],
  targetSlots: AnchorPortSlot[],
  source: Rectangle,
  target: Rectangle
): Array<[AnchorPortSlot, AnchorPortSlot]> {
  const preferredSourceRatio = preferredAnchorRatio(sourceSlots[0].side, source, target);
  const preferredTargetRatio = preferredAnchorRatio(targetSlots[0].side, target, source);

  return sourceSlots.flatMap((sourceSlot) =>
    targetSlots.map((targetSlot): [AnchorPortSlot, AnchorPortSlot] => [sourceSlot, targetSlot])
  ).sort((left, right) =>
    slotPairScore(left, preferredSourceRatio, preferredTargetRatio) -
      slotPairScore(right, preferredSourceRatio, preferredTargetRatio) ||
    left[0].slotIndex - right[0].slotIndex ||
    left[1].slotIndex - right[1].slotIndex
  );
}

function slotPairScore(
  pair: [AnchorPortSlot, AnchorPortSlot],
  preferredSourceRatio: number,
  preferredTargetRatio: number
): number {
  return Math.abs(pair[0].anchor.ratio - preferredSourceRatio) +
    Math.abs(pair[1].anchor.ratio - preferredTargetRatio);
}

function preferredAnchorRatio(side: DiagramEdgeAnchorSide, rectangle: Rectangle, opposite: Rectangle): number {
  if (side === "east" || side === "west") {
    return clampRatio((centerY(opposite) - rectangle.y) / rectangle.height);
  }
  return clampRatio((centerX(opposite) - rectangle.x) / rectangle.width);
}

function clampRatio(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}

function portSlotKey(nodeId: string, side: DiagramEdgeAnchorSide, slotIndex: number): string {
  return `${nodeId}:${side}:${slotIndex}`;
}

function routeCandidatesForFlexibleAnchors(
  edge: DiagramEdge,
  edgeIndex: number,
  source: Rectangle,
  target: Rectangle,
  portPools: AnchorPortPools,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  includeOuterLanes: boolean
): RouteCandidate[] {
  const strategies = routeCandidateStrategies(source, target, includeOuterLanes);
  const candidates: RouteCandidate[] = [];

  for (const strategy of strategies) {
    const sourceSlots = requirePortSlots(portPools, edge.sourceId, strategy.sourceSide);
    const targetSlots = requirePortSlots(portPools, edge.targetId, strategy.targetSide);
    const slotPairs = sideConstrainedSlotPairs(sourceSlots, targetSlots, source, target);
    const budget = candidateBudgetForStrategy(strategy);
    const strategyCandidates: RouteCandidate[] = [];

    for (const [sourceSlot, targetSlot] of slotPairs) {
      const next = routeCandidatesForStrategy(
        edge.id,
        edgeIndex,
        source,
        target,
        sourceSlot,
        targetSlot,
        strategy,
        bounds,
        outerLaneMargin
      );
      for (const candidate of next) {
        strategyCandidates.push(candidate);
        if (strategyCandidates.length >= budget) {
          break;
        }
      }
      if (strategyCandidates.length >= budget) {
        break;
      }
    }

    candidates.push(...uniqueRoutes(strategyCandidates));
  }

  return uniqueRoutes(candidates);
}

function routeCandidateStrategies(source: Rectangle, target: Rectangle, includeOuterLanes: boolean): RouteCandidateStrategy[] {
  const corridor = directCorridorSideConstraints(source, target);
  const strategies: RouteCandidateStrategy[] = [{
    kind: "corridor",
    sourceSide: corridor.source,
    targetSide: corridor.target
  }];

  if (!includeOuterLanes) {
    return strategies;
  }

  strategies.push(
    { kind: "outer", laneSide: "west", sourceSide: "west", targetSide: "west" },
    { kind: "outer", laneSide: "east", sourceSide: "east", targetSide: "east" },
    { kind: "outer", laneSide: "north", sourceSide: "north", targetSide: "north" },
    { kind: "outer", laneSide: "south", sourceSide: "south", targetSide: "south" }
  );

  for (const firstLaneSide of allAnchorSides()) {
    for (const finalLaneSide of allAnchorSides()) {
      if (sideAxis(firstLaneSide) === sideAxis(finalLaneSide)) {
        continue;
      }
      strategies.push({
        kind: "outer-corner",
        firstLaneSide,
        finalLaneSide,
        sourceSide: firstLaneSide,
        targetSide: finalLaneSide
      });
    }
  }

  return strategies;
}

function directCorridorSideConstraints(source: Rectangle, target: Rectangle): { source: DiagramEdgeAnchorSide; target: DiagramEdgeAnchorSide } {
  const dx = centerX(target) - centerX(source);
  const dy = centerY(target) - centerY(source);
  const firstSegmentDirection = Math.abs(dx) >= Math.abs(dy)
    ? { x: dx >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dy >= 0 ? 1 : -1 };
  const sourceSide = sideFromDirection(firstSegmentDirection);
  const targetSide = sideFromDirection({ x: -firstSegmentDirection.x, y: -firstSegmentDirection.y });

  return { source: sourceSide, target: targetSide };
}

function sideFromDirection(direction: { x: number; y: number }): DiagramEdgeAnchorSide {
  if (direction.x < 0) {
    return "west";
  }
  if (direction.x > 0) {
    return "east";
  }
  if (direction.y < 0) {
    return "north";
  }
  return "south";
}

function sideAxis(side: DiagramEdgeAnchorSide): "x" | "y" {
  return side === "east" || side === "west" ? "x" : "y";
}

function candidateBudgetForStrategy(strategy: RouteCandidateStrategy): number {
  if (strategy.kind === "corridor") {
    return corridorStrategyCandidateBudget;
  }
  if (strategy.kind === "outer") {
    return outerStrategyCandidateBudget;
  }
  return outerCornerStrategyCandidateBudget;
}

function routeCandidatesForStrategy(
  edgeId: string,
  edgeIndex: number,
  source: Rectangle,
  target: Rectangle,
  sourceSlot: AnchorPortSlot,
  targetSlot: AnchorPortSlot,
  strategy: RouteCandidateStrategy,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number
): RouteCandidate[] {
  if (strategy.kind === "corridor") {
    return routeCandidatesForFixedAnchorPair(
      edgeId,
      edgeIndex,
      source,
      target,
      sourceSlot.anchor,
      targetSlot.anchor,
      sourceSlot.key,
      targetSlot.key,
      bounds,
      outerLaneMargin,
      false
    );
  }

  if (strategy.kind === "outer") {
    return outerLaneCandidatesForAnchorPair(
      source,
      target,
      sourceSlot.anchor,
      targetSlot.anchor,
      sourceSlot.key,
      targetSlot.key,
      strategy.laneSide,
      bounds,
      outerLaneMargin
    );
  }

  return outerCornerCandidatesForAnchorPair(
    source,
    target,
    sourceSlot.anchor,
    targetSlot.anchor,
    sourceSlot.key,
    targetSlot.key,
    strategy.firstLaneSide,
    strategy.finalLaneSide,
    bounds,
    outerLaneMargin
  );
}

function routeCandidatesForFixedAnchorPair(
  edgeId: string,
  edgeIndex: number,
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourcePortKey: string | undefined,
  targetPortKey: string | undefined,
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
  const gapCandidates = gapBetweenCandidates(source, target, sourceAnchor, targetAnchor, sourcePortKey, targetPortKey, sourcePoint, sourcePort, targetPort, targetPoint);
  const baseCandidates = offsets.flatMap((offset) => {
    const xLane = midX + offset;
    const yLane = midY + offset;
    const xLaneA = sourcePort.x + offset;
    const xLaneB = targetPort.x - offset;
    const yLaneA = sourcePort.y + offset;
    const yLaneB = targetPort.y - offset;

    return [
      pointsToRoute([sourcePoint, sourcePort, { x: xLane, y: sourcePort.y }, { x: xLane, y: targetPort.y }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
      pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: yLane }, { x: targetPort.x, y: yLane }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
      pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: xLaneA, y: sourcePort.y },
        { x: xLaneA, y: yLane },
        { x: xLaneB, y: yLane },
        { x: xLaneB, y: targetPort.y },
        targetPort,
        targetPoint
      ], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
      pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: sourcePort.x, y: yLaneA },
        { x: xLane, y: yLaneA },
        { x: xLane, y: yLaneB },
        { x: targetPort.x, y: yLaneB },
        targetPort,
        targetPoint
      ], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey)
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
    ...pointsToRoute([sourcePoint, sourcePort, { x: lane.x, y: sourcePort.y }, { x: lane.x, y: targetPort.y }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
    outerLane: lane.side,
    outerLaneIndex: laneIndex + 1
  })));
  outerCandidates.push(...laneOffsets.flatMap((laneIndex) => [
    { side: "north" as const, y: bounds.top - outerLaneMargin - anchorStubDistance * laneIndex },
    { side: "south" as const, y: bounds.bottom + outerLaneMargin + anchorStubDistance * laneIndex }
  ].map((lane) => ({
    ...pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: lane.y }, { x: targetPort.x, y: lane.y }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
    outerLane: lane.side,
    outerLaneIndex: laneIndex + 1
  }))));

  return uniqueRoutes([...gapCandidates, ...baseCandidates, ...outerCandidates]);
}

function outerLaneCandidatesForAnchorPair(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourcePortKey: string | undefined,
  targetPortKey: string | undefined,
  laneSide: DiagramEdgeAnchorSide,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number
): RouteCandidate[] {
  const sourcePoint = anchorPoint(source, sourceAnchor);
  const targetPoint = anchorPoint(target, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, targetAnchor, 0);
  const laneOffsets = [0, 1, 2, 3, 4, 5];

  return uniqueRoutes(laneOffsets.map((laneIndex) => {
    const route = sideAxis(laneSide) === "x"
      ? pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: outerLaneX(laneSide, bounds, outerLaneMargin, laneIndex), y: sourcePort.y },
        { x: outerLaneX(laneSide, bounds, outerLaneMargin, laneIndex), y: targetPort.y },
        targetPort,
        targetPoint
      ], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey)
      : pointsToRoute([
        sourcePoint,
        sourcePort,
        { x: sourcePort.x, y: outerLaneY(laneSide, bounds, outerLaneMargin, laneIndex) },
        { x: targetPort.x, y: outerLaneY(laneSide, bounds, outerLaneMargin, laneIndex) },
        targetPort,
        targetPoint
      ], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey);
    return {
      ...route,
      outerLane: laneSide,
      outerLaneIndex: laneIndex + 1
    };
  }));
}

function outerCornerCandidatesForAnchorPair(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourcePortKey: string | undefined,
  targetPortKey: string | undefined,
  firstLaneSide: DiagramEdgeAnchorSide,
  finalLaneSide: DiagramEdgeAnchorSide,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number
): RouteCandidate[] {
  const sourcePoint = anchorPoint(source, sourceAnchor);
  const targetPoint = anchorPoint(target, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, 0);
  const targetPort = outsidePort(targetPoint, targetAnchor, 0);
  const laneOffsets = [0, 1, 2, 3, 4, 5];
  const candidates: RouteCandidate[] = [];

  for (const laneIndex of laneOffsets) {
    const firstLane = outerLaneCoordinate(firstLaneSide, bounds, outerLaneMargin, laneIndex);
    const finalLane = outerLaneCoordinate(finalLaneSide, bounds, outerLaneMargin, laneIndex);
    const points = sideAxis(firstLaneSide) === "x"
      ? [
        sourcePoint,
        sourcePort,
        { x: firstLane, y: sourcePort.y },
        { x: firstLane, y: finalLane },
        { x: targetPort.x, y: finalLane },
        targetPort,
        targetPoint
      ]
      : [
        sourcePoint,
        sourcePort,
        { x: sourcePort.x, y: firstLane },
        { x: finalLane, y: firstLane },
        { x: finalLane, y: targetPort.y },
        targetPort,
        targetPoint
      ];
    candidates.push({
      ...pointsToRoute(points, sourceAnchor, targetAnchor, sourcePortKey, targetPortKey),
      outerLane: firstLaneSide,
      outerLaneIndex: laneIndex + 1
    });
  }

  return uniqueRoutes(candidates);
}

function outerLaneCoordinate(
  side: DiagramEdgeAnchorSide,
  bounds: { left: number; right: number; top: number; bottom: number },
  outerLaneMargin: number,
  laneIndex: number
): number {
  return sideAxis(side) === "x"
    ? outerLaneX(side, bounds, outerLaneMargin, laneIndex)
    : outerLaneY(side, bounds, outerLaneMargin, laneIndex);
}

function outerLaneX(
  side: DiagramEdgeAnchorSide,
  bounds: { left: number; right: number },
  outerLaneMargin: number,
  laneIndex: number
): number {
  return side === "west"
    ? bounds.left - outerLaneMargin - anchorStubDistance * laneIndex
    : bounds.right + outerLaneMargin + anchorStubDistance * laneIndex;
}

function outerLaneY(
  side: DiagramEdgeAnchorSide,
  bounds: { top: number; bottom: number },
  outerLaneMargin: number,
  laneIndex: number
): number {
  return side === "north"
    ? bounds.top - outerLaneMargin - anchorStubDistance * laneIndex
    : bounds.bottom + outerLaneMargin + anchorStubDistance * laneIndex;
}

function gapBetweenCandidates(
  source: Rectangle,
  target: Rectangle,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourcePortKey: string | undefined,
  targetPortKey: string | undefined,
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
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: gapX, y: sourcePort.y }, { x: gapX, y: targetPort.y }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey));
  } else if (targetRight < source.x) {
    const gapX = (targetRight + source.x) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: gapX, y: sourcePort.y }, { x: gapX, y: targetPort.y }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey));
  }

  if (sourceBottom < target.y) {
    const gapY = (sourceBottom + target.y) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: gapY }, { x: targetPort.x, y: gapY }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey));
  } else if (targetBottom < source.y) {
    const gapY = (targetBottom + source.y) / 2;
    candidates.push(pointsToRoute([sourcePoint, sourcePort, { x: sourcePort.x, y: gapY }, { x: targetPort.x, y: gapY }, targetPort, targetPoint], sourceAnchor, targetAnchor, sourcePortKey, targetPortKey));
  }

  return candidates;
}

function pointsToRoute(
  points: DiagramPoint[],
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourcePortKey?: string,
  targetPortKey?: string
): RouteCandidate {
  const sourceStub = points[1];
  const targetStub = points[points.length - 2];
  const compacted = preserveTerminalStubs(compactOrthogonalPoints(points), sourceStub, targetStub);
  return {
    sourceAnchor,
    targetAnchor,
    sourcePortKey,
    targetPortKey,
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

function canonicalCompactRouteCandidate(candidate: RouteCandidate): RouteCandidate {
  const points = canonicalCompactRoutePoints(candidate.points);
  return {
    ...candidate,
    points,
    waypoints: points.slice(1, -1)
  };
}

function canonicalCompactRoutePoints(points: DiagramPoint[]): DiagramPoint[] {
  const deduped = removeAdjacentDuplicatePoints(points);
  const withoutCollinear = removeCollinearMiddlePoints(deduped);
  const withoutEndpointStubs = removeEndpointAdjacentStubs(withoutCollinear);
  return removeCollinearMiddlePoints(removeAdjacentDuplicatePoints(withoutEndpointStubs));
}

function removeAdjacentDuplicatePoints(points: DiagramPoint[]): DiagramPoint[] {
  const next: DiagramPoint[] = [];
  for (const point of points) {
    if (next.length === 0 || !pointsEqual(point, next[next.length - 1])) {
      next.push(point);
    }
  }
  return next;
}

function removeCollinearMiddlePoints(points: DiagramPoint[]): DiagramPoint[] {
  return points.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) {
      return true;
    }
    return !sameAxis(all[index - 1], point, all[index + 1]);
  });
}

function removeEndpointAdjacentStubs(points: DiagramPoint[]): DiagramPoint[] {
  const next = [...points];
  if (next.length >= 3 && sameAxis(next[0], next[1], next[2])) {
    next.splice(1, 1);
  }
  if (next.length >= 3 && sameAxis(next[next.length - 3], next[next.length - 2], next[next.length - 1])) {
    next.splice(next.length - 2, 1);
  }
  return next;
}

function sameAxis(first: DiagramPoint, middle: DiagramPoint, last: DiagramPoint): boolean {
  return (Math.abs(first.x - middle.x) < epsilon && Math.abs(middle.x - last.x) < epsilon) ||
    (Math.abs(first.y - middle.y) < epsilon && Math.abs(middle.y - last.y) < epsilon);
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

function candidateUsesReservedPort(candidate: RouteCandidate, reservedPortKeys: Set<string>): boolean {
  return Boolean(
    (candidate.sourcePortKey && reservedPortKeys.has(candidate.sourcePortKey)) ||
    (candidate.targetPortKey && reservedPortKeys.has(candidate.targetPortKey))
  );
}

function reserveCandidatePorts(reservedPortKeys: Set<string>, candidate: RouteCandidate): void {
  if (candidate.sourcePortKey) {
    reservedPortKeys.add(candidate.sourcePortKey);
  }
  if (candidate.targetPortKey) {
    reservedPortKeys.add(candidate.targetPortKey);
  }
}

function reservedPortKeysForEdges(
  edges: DiagramEdge[],
  portPools: AnchorPortPools,
  initial: Set<string> = new Set()
): Set<string> {
  const reserved = new Set(initial);
  for (const edge of edges) {
    if (edge.layout?.sourceAnchor) {
      const sourceKey = portKeyForAnchor(portPools, edge.sourceId, edge.layout.sourceAnchor);
      if (sourceKey) {
        reserved.add(sourceKey);
      }
    }
    if (edge.layout?.targetAnchor) {
      const targetKey = portKeyForAnchor(portPools, edge.targetId, edge.layout.targetAnchor);
      if (targetKey) {
        reserved.add(targetKey);
      }
    }
  }
  return reserved;
}

function portKeyForAnchor(
  portPools: AnchorPortPools,
  nodeId: string,
  anchor: DiagramEdgeAnchor
): string | undefined {
  return portPools.get(nodeId)?.[anchor.side].find((slot) => Math.abs(slot.anchor.ratio - anchor.ratio) < epsilon)?.key;
}

function candidatePortPairKey(candidate: RouteCandidate): string {
  return `${candidate.sourcePortKey ?? anchorUsageKey(candidate.sourceAnchor)}|${candidate.targetPortKey ?? anchorUsageKey(candidate.targetAnchor)}`;
}

function anchorUsageKey(anchor: DiagramEdgeAnchor): string {
  return `${anchor.side}:${roundRatio(anchor.ratio)}`;
}

function routeCandidatesEqual(left: RouteCandidate, right: RouteCandidate): boolean {
  return anchorsEqual(left.sourceAnchor, right.sourceAnchor) &&
    anchorsEqual(left.targetAnchor, right.targetAnchor) &&
    routesEqual(left.points, right.points);
}

function anchorsEqual(left: DiagramEdgeAnchor, right: DiagramEdgeAnchor): boolean {
  return left.side === right.side && Math.abs(left.ratio - right.ratio) < epsilon;
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
    const key = [
      candidatePortPairKey(route),
      route.points.map((point) => `${roundRatio(point.x)},${roundRatio(point.y)}`).join("|")
    ].join("::");
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
