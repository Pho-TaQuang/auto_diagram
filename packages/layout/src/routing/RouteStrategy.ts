import type {
  DiagramDiagnostic,
  DiagramDocument,
  DiagramEdge,
  DiagramRoutingDivider
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { LayoutRouteStrategy, RoutingSummary } from "../engine/LayoutRunReport.js";
import type { NormalizedCoordinateRoutingIntent } from "../normalizers/coordinateRoutingLayoutV3.js";

export type RouteStrategyId = LayoutRouteStrategy;

export type RoutingContext = {
  intent: NormalizedCoordinateRoutingIntent;
  run: LayoutRunContext;
};

export type RouteRequest = {
  document: DiagramDocument;
  intent: NormalizedCoordinateRoutingIntent;
  context: RoutingContext;
};

export type RouteResult = {
  edges: DiagramEdge[];
  dividers: DiagramRoutingDivider[];
  diagnostics: DiagramDiagnostic[];
  summary?: Partial<RoutingSummary>;
};

export interface RouteStrategy {
  id: RouteStrategyId;
  route(request: RouteRequest): RouteResult;
}
