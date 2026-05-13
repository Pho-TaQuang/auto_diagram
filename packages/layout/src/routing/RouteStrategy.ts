import type {
  DiagramDiagnostic,
  DiagramDocument,
  DiagramEdge,
  DiagramRoutingDivider
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { NormalizedCoordinateRoutingIntent } from "../normalizers/coordinateRoutingLayoutV3.js";

export type RouteStrategyId =
  | "template-only"
  | "template-with-outer-lanes"
  | "astar";

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
};

export interface RouteStrategy {
  id: RouteStrategyId;
  route(request: RouteRequest): RouteResult;
}
