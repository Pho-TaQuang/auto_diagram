import type { DiagramDocument, DiagramLayoutScore } from "../../../core/src/index.js";
import type { LayoutLogEvent, LayoutRouteStrategy, RoutingSummary } from "../engine/LayoutRunReport.js";
import type { RoutingValidationResult } from "./RoutingValidator.js";

export type BuildRoutingSummaryInput = {
  document: DiagramDocument;
  routeStrategy: LayoutRouteStrategy;
  score: DiagramLayoutScore;
  validation: RoutingValidationResult;
  events: LayoutLogEvent[];
};

export function buildRoutingSummary(input: BuildRoutingSummaryInput): RoutingSummary {
  const outerLaneUsages = countEvents(input.events, "outer-lane-used");
  const routingFailures = countEvents(input.events, "routing-fallback-used");
  const repairAccepted = countEvents(input.events, "route-repair-accepted");
  const repairRejected = countEvents(input.events, "route-repair-rejected");
  const hardValid =
    input.score.nodeOverlaps === 0 &&
    input.score.groupOverlaps === 0 &&
    input.validation.edgeNodeHits === 0 &&
    input.validation.illegalSegmentOverlaps === 0 &&
    input.validation.edgeIdentityViolations === 0 &&
    input.validation.invalidDividers === 0 &&
    routingFailures === 0;

  return {
    routeStrategy: input.routeStrategy,
    hardValid,
    totalEdges: input.document.edges.length,
    validEdges: input.validation.validEdges,
    invalidEdges: input.validation.invalidEdges,
    nodeOverlaps: input.score.nodeOverlaps,
    groupOverlaps: input.score.groupOverlaps,
    edgeNodeHits: input.validation.edgeNodeHits,
    edgeCrossings: input.score.edgeCrossings,
    segmentOverlaps: input.score.segmentOverlaps,
    illegalSegmentOverlaps: input.validation.illegalSegmentOverlaps,
    edgeIdentityViolations: input.validation.edgeIdentityViolations,
    invalidDividers: input.validation.invalidDividers,
    outerLaneUsages,
    routingFailures,
    repairAccepted,
    repairRejected
  };
}

function countEvents(events: LayoutLogEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}
