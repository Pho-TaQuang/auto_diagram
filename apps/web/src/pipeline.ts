import type { DiagramDocument } from "../../../packages/core/src/index.js";
import {
  extractLayoutViewModel,
  parseMxGraphModelXml,
  serializeMxGraphModel,
  toMxGraphModelXml,
  type MxGraphModel,
  type MxLayoutViewModel
} from "../../../packages/drawio/src/index.js";
import {
  applyStereotypeGridLayout,
  createStereotypeLayoutIntent,
  normalizeStereotypeLayoutIntent
} from "../../../packages/layout/src/index.js";
import type {
  StereotypeLayoutIntent,
  StereotypeLayoutIntentGroup
} from "../../../packages/layout/src/index.js";
import { parseMermaidClassDiagram } from "../../../packages/parsers/src/index.js";

export type {
  StereotypeLayoutIntent,
  StereotypeLayoutIntentGroup
} from "../../../packages/layout/src/index.js";

export type RunWebPipelineOptions = {
  source: string;
  intent?: StereotypeLayoutIntent;
  groupFrames?: boolean;
};

export type WebPipelineResult = {
  parsed: DiagramDocument;
  intent: StereotypeLayoutIntent;
  diagram: DiagramDocument;
  mxGraph: MxGraphModel;
  layoutView: MxLayoutViewModel;
  xml: string;
};

export type MxGraphImportResult = {
  mxGraph: MxGraphModel;
  layoutView: MxLayoutViewModel;
  xml: string;
};

export function runWebPipeline(options: RunWebPipelineOptions): WebPipelineResult {
  const parsed = parseMermaidClassDiagram(options.source);

  if (parsed.nodes.length === 0) {
    throw new Error("No class nodes were parsed from the input.");
  }

  const intent = options.intent ? normalizeStereotypeLayoutIntent(options.intent) : undefined;
  const diagram = applyStereotypeGridLayout(parsed, intent ? { intent } : undefined);
  const activeIntent = intent ?? createIntentFromSelectedLayout(diagram);
  const xml = toMxGraphModelXml(diagram, { groupFrames: options.groupFrames ?? false });
  const mxGraph = parseMxGraphModelXml(xml);
  const layoutView = extractLayoutViewModel(mxGraph);

  return {
    parsed,
    intent: activeIntent,
    diagram,
    mxGraph,
    layoutView,
    xml
  };
}

function createIntentFromSelectedLayout(diagram: DiagramDocument): StereotypeLayoutIntent {
  const groups = diagram.groups;

  if (!groups || groups.some((group) => !group.layoutIntent)) {
    return createStereotypeLayoutIntent(diagram);
  }

  const columns = diagram.layout?.grid.columns ?? Math.max(1, ...groups.map((group) => group.layoutIntent!.gridX + group.layoutIntent!.gridWidth));
  const rows = diagram.layout?.grid.rows ?? Math.max(1, ...groups.map((group) => group.layoutIntent!.gridY + group.layoutIntent!.gridHeight));

  return {
    version: 1,
    grid: {
      columns,
      rows
    },
    groups: groups.map((group): StereotypeLayoutIntentGroup => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      gridX: group.layoutIntent!.gridX,
      gridY: group.layoutIntent!.gridY,
      gridWidth: group.layoutIntent!.gridWidth,
      gridHeight: group.layoutIntent!.gridHeight,
      packing: group.layoutIntent!.packing,
      nodeIds: [...group.nodeIds]
    }))
  };
}

export function runMxGraphImport(xml: string): MxGraphImportResult {
  const mxGraph = parseMxGraphModelXml(xml);
  return {
    mxGraph,
    layoutView: extractLayoutViewModel(mxGraph),
    xml: serializeMxGraphModel(mxGraph)
  };
}

export function serializeMxGraphState(mxGraph: MxGraphModel): MxGraphImportResult {
  return {
    mxGraph,
    layoutView: extractLayoutViewModel(mxGraph),
    xml: serializeMxGraphModel(mxGraph)
  };
}

export function cloneLayoutIntent(intent: StereotypeLayoutIntent): StereotypeLayoutIntent {
  return {
    version: intent.version,
    grid: { ...intent.grid },
    groups: intent.groups.map((group): StereotypeLayoutIntentGroup => ({
      ...group,
      nodeIds: [...group.nodeIds]
    }))
  };
}
