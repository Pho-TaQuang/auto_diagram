import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import {
  extractLayoutViewModel,
  parseMxGraphModelXml,
  serializeMxGraphModel,
  toMxGraphModelXml
} from "../../../../packages/drawio/src/index.js";
import type { DrawioGenerationOptions, DrawioGenerationResult, IDiagramGenerator } from "./types.js";

export const LegacyDrawioGenerator: IDiagramGenerator = {
  id: "legacy-mxgraph",
  name: "Legacy MxGraph Export",

  generate(document: DiagramDocument, options: DrawioGenerationOptions = {}): DrawioGenerationResult {
    const xml = toMxGraphModelXml(document, { groupFrames: options.groupFrames ?? false });
    const mxGraph = parseMxGraphModelXml(xml);
    const layoutView = extractLayoutViewModel(mxGraph);

    return {
      mxGraph,
      layoutView,
      xml
    };
  },

  importFromXml(xml: string): DrawioGenerationResult {
    const mxGraph = parseMxGraphModelXml(xml);
    const layoutView = extractLayoutViewModel(mxGraph);
    return {
      mxGraph,
      layoutView,
      xml: serializeMxGraphModel(mxGraph)
    };
  }
};
