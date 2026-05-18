import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import {
  createInitialCoordinateRoutingLayoutV3,
  extractCoordinateRoutingLayoutV3FromDocument,
  createDefaultLayoutEngineRegistry,
  type CoordinateRoutingLayoutV3
} from "../../../../packages/layout/src/index.js";
import type { ILayoutAdapter } from "./types.js";
import { strictV2LayoutOptions } from "./routingOptions.js";

export const AutoArrangeV2Adapter: ILayoutAdapter<CoordinateRoutingLayoutV3> = {
  id: "auto-arrange-v2",
  name: "Auto Arrange V2",

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
    const engine = registry.get("auto-arrange-v2");

    if (!engine) {
      throw new Error(`Engine auto-arrange-v2 not found`);
    }
    
    // auto-arrange-v2 engine ignores layoutInput internally, but we pass it just in case
    const engineResult = engine.run({
      document,
      mode: "auto-arrange-v2",
      layoutInput: "none",
      options: strictV2LayoutOptions
    });

    return engineResult.document;
  }
};
