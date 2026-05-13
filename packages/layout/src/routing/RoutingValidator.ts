import type { LayoutLogEvent } from "../engine/LayoutRunReport.js";
import type { RouteResult, RoutingContext } from "./RouteStrategy.js";

export type RoutingValidationResult = {
  valid: boolean;
  errors: LayoutLogEvent[];
};

export interface RoutingValidator {
  validate(result: RouteResult, context: RoutingContext): RoutingValidationResult;
}
