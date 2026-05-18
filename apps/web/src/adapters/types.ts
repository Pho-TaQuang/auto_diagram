import type { DiagramDocument } from "../../../../packages/core/src/index.js";
import type { MxGraphModel, MxLayoutViewModel } from "../../../../packages/drawio/src/index.js";
import type { LayoutEngineId } from "../../../../packages/layout/src/index.js";

export interface ILayoutAdapter<TIntent = unknown> {
  readonly id: LayoutEngineId;
  readonly name: string;

  /** Generate the initial intent from a parsed document */
  createInitialIntent(document: DiagramDocument): TIntent;

  /** Create a deep clone of the intent for undo/redo stacks */
  cloneIntent(intent: TIntent): TIntent;

  /** Execute the layout engine to produce a laid-out document */
  runLayout(document: DiagramDocument, intent: TIntent | undefined, groupFrames: boolean): DiagramDocument;

  /** Extract layout intent back from a laid-out document (used for UI state sync after auto-layout) */
  extractIntent?(document: DiagramDocument): TIntent;
}

export type DrawioGenerationResult = {
  mxGraph: MxGraphModel;
  layoutView: MxLayoutViewModel;
  xml: string;
};

export type DrawioGenerationOptions = {
  groupFrames?: boolean;
};

export interface IDiagramGenerator {
  readonly id: string;
  readonly name: string;

  /** Generate Draw.io export format from a laid-out DiagramDocument */
  generate(document: DiagramDocument, options?: DrawioGenerationOptions): DrawioGenerationResult;

  /** Import from an existing Draw.io XML */
  importFromXml(xml: string): DrawioGenerationResult;
}
