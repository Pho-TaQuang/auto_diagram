import { AutoArrangeV2Engine, ManualRoutingV2Engine, SuggestInitialV2Engine } from "../engines/routingV2Engines.js";
import { LegacyStereotypeEngine } from "../engines/legacyStereotypeEngine.js";
import { LayoutEngineRegistry } from "./LayoutEngineRegistry.js";

export function createDefaultLayoutEngineRegistry(): LayoutEngineRegistry {
  const registry = new LayoutEngineRegistry();
  registry.register(new LegacyStereotypeEngine());
  registry.register(new ManualRoutingV2Engine());
  registry.register(new SuggestInitialV2Engine());
  registry.register(new AutoArrangeV2Engine());
  return registry;
}
