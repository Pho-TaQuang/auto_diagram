import type { DiagramDiagnostic, DiagramPoint } from "../../../core/src/index.js";

export type LayoutEngineId =
  | "stereotype-scored"
  | "manual-routing-v2"
  | "suggest-initial-v2"
  | "auto-arrange-v2";

export type LayoutSourceFormat =
  | "coordinate-routing-v3"
  | "relative-flow-v2"
  | "stereotype-grid-v1"
  | "none";

export type LayoutLogLevel = "debug" | "info" | "warn" | "error";

export type LayoutLogPhase =
  | "normalize"
  | "measure"
  | "pack"
  | "anchor"
  | "divider"
  | "route"
  | "repair"
  | "validate"
  | "score"
  | "export";

export type LayoutLogEvent = {
  level: LayoutLogLevel;
  phase: LayoutLogPhase;
  type: string;
  message: string;
  groupId?: string;
  nodeId?: string;
  edgeId?: string;
  dividerId?: string;
  data?: Record<string, unknown>;
};

export type LayoutRouteStrategy =
  | "template-only"
  | "template-with-outer-lanes"
  | "astar";

export type RoutingSummary = {
  routeStrategy: LayoutRouteStrategy;
  hardValid: boolean;
  totalEdges: number;
  validEdges: number;
  invalidEdges: number;
  nodeOverlaps: number;
  groupOverlaps: number;
  edgeNodeHits: number;
  dividerNodeHits: number;
  endpointDividerInteriorHits: number;
  edgeCrossings: number;
  segmentOverlaps: number;
  illegalSegmentOverlaps: number;
  dividerSideOverflow: number;
  edgeIdentityViolations: number;
  invalidDividers: number;
  outerLaneUsages: number;
  routingFailures: number;
  repairAccepted: number;
  repairRejected: number;
};

export type RoutingSegmentRef = {
  edgeId: string;
  segmentId?: string;
  segmentIndex: number;
};

export type RoutingNodeHitRef = {
  nodeId: string;
  segment: RoutingSegmentRef;
};

export type RoutingEdgeCrossingRef = {
  otherEdgeId: string;
  segment: RoutingSegmentRef;
  otherSegment: RoutingSegmentRef;
  point?: DiagramPoint;
};

export type RoutingSegmentOverlapRef = {
  otherEdgeId: string;
  segment: RoutingSegmentRef;
  otherSegment: RoutingSegmentRef;
  dividerExempt: boolean;
};

export type EdgeRoutingValidationResult = {
  edgeId: string;
  nodeHits: RoutingNodeHitRef[];
  dividerNodeHits: RoutingNodeHitRef[];
  endpointDividerInteriorHits: RoutingNodeHitRef[];
  edgeCrossings: RoutingEdgeCrossingRef[];
  segmentOverlaps: RoutingSegmentOverlapRef[];
  illegalSegmentOverlaps: RoutingSegmentOverlapRef[];
  routingFallbackUsed: boolean;
  routingFailed: boolean;
  invalidDividers: string[];
  edgeIdentityViolations: string[];
  hardValid: boolean;
};

export type LayoutRunReport = {
  engine: LayoutEngineId;
  sourceFormat?: LayoutSourceFormat;
  warnings: LayoutLogEvent[];
  errors: LayoutLogEvent[];
  diagnostics: DiagramDiagnostic[];
  edgeValidations?: EdgeRoutingValidationResult[];
  routingSummary?: RoutingSummary;
  trace?: LayoutLogEvent[];
};

export interface LayoutLogger {
  log(event: LayoutLogEvent): void;
  debug(event: Omit<LayoutLogEvent, "level">): void;
  info(event: Omit<LayoutLogEvent, "level">): void;
  warn(event: Omit<LayoutLogEvent, "level">): void;
  error(event: Omit<LayoutLogEvent, "level">): void;
}

export class MemoryLayoutLogger implements LayoutLogger {
  readonly events: LayoutLogEvent[] = [];

  log(event: LayoutLogEvent): void {
    this.events.push(event);
  }

  debug(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "debug" });
  }

  info(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "info" });
  }

  warn(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "warn" });
  }

  error(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "error" });
  }

  report(
    engine: LayoutEngineId,
    sourceFormat?: LayoutSourceFormat,
    includeTrace = false,
    routingSummary?: RoutingSummary,
    diagnostics: DiagramDiagnostic[] = [],
    edgeValidations?: EdgeRoutingValidationResult[]
  ): LayoutRunReport {
    return {
      engine,
      sourceFormat,
      warnings: this.events.filter((event) => event.level === "warn"),
      errors: this.events.filter((event) => event.level === "error"),
      diagnostics,
      ...(edgeValidations ? { edgeValidations } : {}),
      ...(routingSummary ? { routingSummary } : {}),
      ...(includeTrace ? { trace: [...this.events] } : {})
    };
  }
}

export class NoopLayoutLogger implements LayoutLogger {
  log(_event: LayoutLogEvent): void {}

  debug(_event: Omit<LayoutLogEvent, "level">): void {}

  info(_event: Omit<LayoutLogEvent, "level">): void {}

  warn(_event: Omit<LayoutLogEvent, "level">): void {}

  error(_event: Omit<LayoutLogEvent, "level">): void {}
}

export function logEventsToDiagnostics(events: LayoutLogEvent[]): DiagramDiagnostic[] {
  return events
    .filter((event) => event.level === "warn" || event.level === "error")
    .map((event): DiagramDiagnostic => ({
      severity: event.level === "error" ? "error" : "warning",
      message: event.message
    }));
}
