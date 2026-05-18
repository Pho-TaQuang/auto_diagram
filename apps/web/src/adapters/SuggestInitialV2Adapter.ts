import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import {
  createDefaultLayoutEngineRegistry,
  createInitialCoordinateRoutingLayoutV3,
  extractCoordinateRoutingLayoutV3FromDocument,
  type CoordinateRoutingLayoutV3
} from "../../../../packages/layout/src/index.js";
import type { ILayoutAdapter } from "./types.js";
import { strictV2LayoutOptions } from "./routingOptions.js";

export const SuggestInitialV2Adapter: ILayoutAdapter<CoordinateRoutingLayoutV3> = {
  id: "suggest-initial-v2",
  name: "Suggest Initial V2",

  createInitialIntent(document: DiagramDocument): CoordinateRoutingLayoutV3 {
    return createInitialCoordinateRoutingLayoutV3(document, "suggested");
  },

  cloneIntent(intent: CoordinateRoutingLayoutV3): CoordinateRoutingLayoutV3 {
    return JSON.parse(JSON.stringify(intent));
  },

  extractIntent(document: DiagramDocument): CoordinateRoutingLayoutV3 {
    return extractCoordinateRoutingLayoutV3FromDocument(document);
  },

  runLayout(document: DiagramDocument, intent: CoordinateRoutingLayoutV3 | undefined): DiagramDocument {
    const registry = createDefaultLayoutEngineRegistry();
    const engineId = "suggest-initial-v2";
    const engine = registry.get(engineId);
    const engineResult = engine.run({
      document,
      mode: engineId,
      layoutInput: intent,
      options: strictV2LayoutOptions
    });

    return engineResult.document;
  }
};
