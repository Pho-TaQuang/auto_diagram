import { LegacyStereotypeAdapter } from "./LegacyStereotypeAdapter.js";
import { AutoArrangeV2Adapter } from "./AutoArrangeV2Adapter.js";
import { ManualRoutingV2Adapter } from "./ManualRoutingV2Adapter.js";
import { SuggestInitialV2Adapter } from "./SuggestInitialV2Adapter.js";
import type { ILayoutAdapter, IDiagramGenerator } from "./types.js";

export const layoutAdapters: ILayoutAdapter<any>[] = [
  LegacyStereotypeAdapter,
  AutoArrangeV2Adapter,
  SuggestInitialV2Adapter,
  ManualRoutingV2Adapter
];

export function getLayoutAdapter(id: string): ILayoutAdapter<any> {
  const adapter = layoutAdapters.find(a => a.id === id);
  if (!adapter) {
    throw new Error(`Unknown layout adapter: ${id}`);
  }
  return adapter;
}

export * from "./types.js";
export * from "./DrawioGenerator.js";
export * from "./LegacyStereotypeAdapter.js";
export * from "./AutoArrangeV2Adapter.js";
export * from "./SuggestInitialV2Adapter.js";
export * from "./ManualRoutingV2Adapter.js";
