import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import {
  createStereotypeLayoutIntent,
  createDefaultLayoutEngineRegistry,
  type StereotypeLayoutIntent,
  type StereotypeLayoutIntentGroup
} from "../../../../packages/layout/src/index.js";
import type { ILayoutAdapter } from "./types.js";

export const LegacyStereotypeAdapter: ILayoutAdapter<StereotypeLayoutIntent> = {
  id: "stereotype-scored",
  name: "Legacy Stereotype Grid",

  createInitialIntent(document: DiagramDocument): StereotypeLayoutIntent {
    return createStereotypeLayoutIntent(document);
  },

  cloneIntent(intent: StereotypeLayoutIntent): StereotypeLayoutIntent {
    return {
      version: intent.version,
      grid: { ...intent.grid },
      groups: intent.groups.map((group): StereotypeLayoutIntentGroup => ({
        ...group,
        nodeIds: [...group.nodeIds]
      }))
    };
  },

  runLayout(document: DiagramDocument, intent: StereotypeLayoutIntent | undefined, groupFrames: boolean): DiagramDocument {
    const registry = createDefaultLayoutEngineRegistry();
    const engine = registry.get("stereotype-scored");
    
    if (!engine) {
      throw new Error("Engine stereotype-scored not found");
    }
    
    const finalIntent = intent ?? this.createInitialIntent(document);

    // Ensure the intent has group frames configuration if needed (currently not deeply supported by old intent,
    // but the engine uses options or it just defaults to the legacy engine logic).
    const engineResult = engine.run({
      document,
      mode: "stereotype-scored",
      layoutInput: finalIntent
    });

    return engineResult.document;
  }
};
