import type { LayoutEngine } from "./LayoutEngine.js";
import type { LayoutEngineId } from "./LayoutRunReport.js";

export class LayoutEngineRegistry {
  private readonly engines = new Map<LayoutEngineId, LayoutEngine>();

  register(engine: LayoutEngine): void {
    this.engines.set(engine.id, engine);
  }

  get(id: LayoutEngineId): LayoutEngine {
    const engine = this.engines.get(id);
    if (!engine) {
      throw new Error(`Unknown layout engine: ${id}`);
    }
    return engine;
  }
}
