import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import {
  createInitialCoordinateRoutingLayoutV3,
  extractCoordinateRoutingLayoutV3FromDocument,
  createDefaultLayoutEngineRegistry,
  type CoordinateRoutingLayoutV3
} from "../../../../packages/layout/src/index.js";
import type { ILayoutAdapter } from "./types.js";
import { strictV2LayoutOptions } from "./routingOptions.js";

export const ManualRoutingV2Adapter: ILayoutAdapter<CoordinateRoutingLayoutV3> = {
  id: "manual-routing-v2",
  name: "Manual Routing V2",

  createInitialIntent(document: DiagramDocument): CoordinateRoutingLayoutV3 {
    return createInitialCoordinateRoutingLayoutV3(document, "suggested");
  },

  cloneIntent(intent: CoordinateRoutingLayoutV3): CoordinateRoutingLayoutV3 {
    return JSON.parse(JSON.stringify(intent));
  },

  extractIntent(document: DiagramDocument): CoordinateRoutingLayoutV3 {
    return extractCoordinateRoutingLayoutV3FromDocument(document);
  },

  runLayout(document: DiagramDocument, intent: CoordinateRoutingLayoutV3 | undefined, groupFrames: boolean): DiagramDocument {
    const registry = createDefaultLayoutEngineRegistry();
    const engineId = "manual-routing-v2";
    const engine = registry.get(engineId);

    if (!engine) {
      throw new Error(`Engine ${engineId} not found`);
    }
    
    // If manual, we use the provided intent (or fallback to initial if something went wrong).
    const finalIntent = intent ?? this.createInitialIntent(document);
    
    const engineResult = engine.run({
      document,
      mode: engineId,
      layoutInput: finalIntent,
      options: strictV2LayoutOptions
    });

    return engineResult.document;
  }
};
