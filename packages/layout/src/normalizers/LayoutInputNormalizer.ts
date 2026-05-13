import type { DiagramDocument } from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { LayoutLogEvent, LayoutSourceFormat } from "../engine/LayoutRunReport.js";
import type { CoordinateRoutingLayoutV3 } from "./coordinateRoutingLayoutV3.js";

export type NormalizeLayoutResult = {
  intent: CoordinateRoutingLayoutV3;
  sourceFormat: LayoutSourceFormat;
  warnings: LayoutLogEvent[];
};

export interface LayoutInputNormalizer {
  canNormalize(input: unknown): boolean;
  normalize(input: unknown, document: DiagramDocument, context: LayoutRunContext): NormalizeLayoutResult;
}
