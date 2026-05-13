import { applyStereotypeGridLayout } from "../stereotypeGridLayout.js";
import {
  MemoryLayoutLogger,
  type LayoutEngineId
} from "../engine/LayoutRunReport.js";
import type {
  LayoutEngine,
  LayoutEngineRequest,
  LayoutEngineResult
} from "../engine/LayoutEngine.js";

export class LegacyStereotypeEngine implements LayoutEngine {
  readonly id: LayoutEngineId = "stereotype-scored";

  run(request: LayoutEngineRequest): LayoutEngineResult {
    const logger = new MemoryLayoutLogger();
    const document = applyStereotypeGridLayout(request.document);
    logger.info({
      phase: "route",
      type: "legacy-engine-complete",
      message: "Legacy stereotype-scored layout engine completed."
    });

    return {
      document,
      report: logger.report(this.id, request.layoutInput === undefined ? "none" : undefined, request.options?.traceRouting ?? false)
    };
  }
}
