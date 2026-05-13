import type { DiagramDocument } from "../../../core/src/index.js";
import type { RouteStrategyId } from "../routing/RouteStrategy.js";
import type {
  LayoutEngineId,
  LayoutLogger,
  LayoutRunReport
} from "./LayoutRunReport.js";

export type RouteFallbackStrategy = "none" | "template-only" | "astar";

export type LayoutEngineOptions = {
  routeStrategy?: RouteStrategyId;
  fallbackStrategy?: RouteFallbackStrategy;
  dividerThreshold?: number;
  outerLaneMargin?: number;
  maxRepairPasses?: number;
  traceRouting?: boolean;
};

export type LayoutEngineRequest = {
  document: DiagramDocument;
  mode: LayoutEngineId;
  layoutInput?: unknown;
  options?: LayoutEngineOptions;
};

export type LayoutEngineResult = {
  document: DiagramDocument;
  report: LayoutRunReport;
};

export type LayoutRunContext = {
  logger: LayoutLogger;
  options: Required<LayoutEngineOptions>;
};

export interface LayoutEngine {
  id: LayoutEngineId;
  run(request: LayoutEngineRequest): LayoutEngineResult;
}

export function resolveLayoutEngineOptions(options: LayoutEngineOptions = {}): Required<LayoutEngineOptions> {
  return {
    routeStrategy: options.routeStrategy ?? "template-only",
    fallbackStrategy: options.fallbackStrategy ?? "template-only",
    dividerThreshold: options.dividerThreshold ?? 4,
    outerLaneMargin: options.outerLaneMargin ?? 96,
    maxRepairPasses: options.maxRepairPasses ?? 2,
    traceRouting: options.traceRouting ?? false
  };
}
