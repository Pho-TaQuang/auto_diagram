import type {
  DiagramDocument,
  DiagramGroupKind,
  DiagramGroupPacking,
  DiagramGroupPackingV2,
  DiagramNode
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { LayoutLogEvent, LayoutSourceFormat } from "../engine/LayoutRunReport.js";
import { estimateClassNodeLayout } from "../mvp0GridLayout.js";
import {
  relativeFlowLayoutToStereotypeLayoutIntent,
  type RelativeFlowLayout
} from "../relativeFlowLayout.js";
import {
  createStereotypeLayoutIntent,
  normalizeStereotypeLayoutIntent,
  type StereotypeLayoutIntent,
  type StereotypeLayoutIntentGroup
} from "../stereotypeGridLayout.js";
import type { LayoutInputNormalizer, NormalizeLayoutResult } from "./LayoutInputNormalizer.js";

export type CoordinateRoutingLayoutV3 = {
  version: 3;
  layoutMode: "coordinate-routing";
  groups: CoordinateRoutingLayoutGroupV3[];
  layers?: CoordinateRoutingLayoutLayerV3[];
  routing?: CoordinateRoutingOptions;
};

export type CoordinateRoutingLayoutLayerV3 = {
  id: string;
  label?: string;
  groupIds: string[];
};

export type CoordinateRoutingLayoutGroupV3 = {
  id: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  packing: DiagramGroupPackingV2;
  nodeOrder: string[];
  nodes?: Record<string, { width: number; height: number }>;
  locked?: boolean;
  packingLocked?: boolean;
  nodeOrderLocked?: boolean;
};

export type CoordinateRoutingOptions = {
  dividerThreshold?: number;
  outerLaneMargin?: number;
  maxRepairPasses?: number;
};

export type CoordinateRoutingLayerLayoutOptions = {
  groupGapX?: number;
  layerGapY?: number;
  paddingX?: number;
  paddingY?: number;
};

export type NormalizedGroupIntent = CoordinateRoutingLayoutGroupV3 & {
  kind: DiagramGroupKind;
};

export type NormalizedCoordinateRoutingIntent = {
  version: 3;
  groups: Record<string, NormalizedGroupIntent>;
  groupOrder: string[];
  routing: Required<CoordinateRoutingOptions>;
};

const defaultCellWidth = 360;
const defaultCellHeight = 280;
const groupPadding = 32;
const nodeGapX = 80;
const nodeGapY = 80;

export const coordinateRoutingLayerLayoutDefaults = {
  groupGapX: 240,
  layerGapY: 240,
  paddingX: 32,
  paddingY: 32
} as const;

export const coordinateRoutingV3Normalizer: LayoutInputNormalizer = {
  canNormalize(input: unknown): boolean {
    return isRecord(input) && input.version === 3 && input.layoutMode === "coordinate-routing";
  },

  normalize(input: unknown, document: DiagramDocument, context: LayoutRunContext): NormalizeLayoutResult {
    return normalizeCoordinateRoutingLayoutInput(input, document, context, "coordinate-routing-v3");
  }
};

export const relativeFlowV2Normalizer: LayoutInputNormalizer = {
  canNormalize(input: unknown): boolean {
    return isRecord(input) && input.version === 2 && input.layoutMode === "relative-flow";
  },

  normalize(input: unknown, document: DiagramDocument, context: LayoutRunContext): NormalizeLayoutResult {
    const warnings: LayoutLogEvent[] = [];
    warn(context, warnings, {
      phase: "normalize",
      type: "layout-format-converted",
      message: "relative-flow v2 converted to coordinate-routing v3.",
      data: { sourceFormat: "relative-flow-v2", targetFormat: "coordinate-routing-v3" }
    });

    const intentV1 = relativeFlowLayoutToStereotypeLayoutIntent(document, input as RelativeFlowLayout);
    return {
      ...convertStereotypeGridToCoordinateRouting(intentV1, document, context, "relative-flow-v2", warnings),
      warnings
    };
  }
};

export const stereotypeGridV1Normalizer: LayoutInputNormalizer = {
  canNormalize(input: unknown): boolean {
    return isRecord(input) && input.version === 1 && isRecord(input.grid) && Array.isArray(input.groups);
  },

  normalize(input: unknown, document: DiagramDocument, context: LayoutRunContext): NormalizeLayoutResult {
    const warnings: LayoutLogEvent[] = [];
    warn(context, warnings, {
      phase: "normalize",
      type: "layout-format-converted",
      message: "stereotype-grid v1 converted to coordinate-routing v3.",
      data: { sourceFormat: "stereotype-grid-v1", targetFormat: "coordinate-routing-v3" }
    });

    const intentV1 = normalizeStereotypeLayoutIntent(input);
    return {
      ...convertStereotypeGridToCoordinateRouting(intentV1, document, context, "stereotype-grid-v1", warnings),
      warnings
    };
  }
};

const normalizers: LayoutInputNormalizer[] = [
  coordinateRoutingV3Normalizer,
  relativeFlowV2Normalizer,
  stereotypeGridV1Normalizer
];

export function normalizeLayoutInput(
  input: unknown,
  document: DiagramDocument,
  context: LayoutRunContext
): NormalizeLayoutResult {
  for (const normalizer of normalizers) {
    if (normalizer.canNormalize(input)) {
      return normalizer.normalize(input, document, context);
    }
  }

  context.logger.error({
    phase: "normalize",
    type: "unsupported-layout-format",
    message: "Unsupported layout format."
  });
  throw new Error("Unsupported layout format.");
}

export function createInitialCoordinateRoutingLayoutV3(
  document: DiagramDocument,
  placement: "grid" | "suggested" = "suggested"
): CoordinateRoutingLayoutV3 {
  const intent = createStereotypeLayoutIntent(document, { placement });
  return stereotypeGridIntentToCoordinateRouting(intent, document);
}

export function extractCoordinateRoutingLayoutV3FromDocument(document: DiagramDocument): CoordinateRoutingLayoutV3 {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));

  return {
    version: 3,
    layoutMode: "coordinate-routing",
    groups: (document.groups ?? [])
      .map((group): CoordinateRoutingLayoutGroupV3 => {
      return {
        id: group.id,
        label: group.label,
        x: group.layout?.x ?? 0,
        y: group.layout?.y ?? 0,
        width: group.layout?.width,
        height: group.layout?.height,
        packing: inferGroupPacking(group.nodeIds.map((nodeId) => nodesById.get(nodeId)).filter((node): node is DiagramNode => Boolean(node))),
        nodeOrder: group.nodeIds,
        nodes: group.nodeIds.reduce((acc, nodeId) => {
          const node = nodesById.get(nodeId);
          if (node?.layout) {
            acc[nodeId] = { width: node.layout.width, height: node.layout.height };
          }
          return acc;
        }, {} as Record<string, { width: number; height: number }>)
      };
    })
  };
}

function inferGroupPacking(nodes: DiagramNode[]): DiagramGroupPackingV2 {
  if (nodes.length < 2 || nodes.some((node) => !node.layout)) {
    return "vertical";
  }

  const xValues = nodes.map((node) => node.layout!.x);
  const yValues = nodes.map((node) => node.layout!.y);
  const xSpread = Math.max(...xValues) - Math.min(...xValues);
  const ySpread = Math.max(...yValues) - Math.min(...yValues);

  return xSpread > ySpread ? "horizontal" : "vertical";
}

export function normalizeCoordinateRoutingIntent(
  intent: CoordinateRoutingLayoutV3,
  options: Required<CoordinateRoutingOptions>
): NormalizedCoordinateRoutingIntent {
  return {
    version: 3,
    groupOrder: intent.groups.map((group) => group.id),
    groups: Object.fromEntries(intent.groups.map((group) => [
      group.id,
      {
        ...group,
        kind: group.id.startsWith("group_synthetic_") ? "synthetic" : "stereotype"
      } satisfies NormalizedGroupIntent
    ])),
    routing: options
  };
}

export function applyCoordinateRoutingLayerLayout(
  intent: CoordinateRoutingLayoutV3,
  document: DiagramDocument,
  options: CoordinateRoutingLayerLayoutOptions = {}
): CoordinateRoutingLayoutV3 {
  if (!intent.layers) {
    return intent;
  }

  const config = {
    ...coordinateRoutingLayerLayoutDefaults,
    ...options
  };
  const groupsById = new Map(intent.groups.map((group) => [group.id, group]));
  const assignedGroupIds = new Set<string>();
  const layers: CoordinateRoutingLayoutLayerV3[] = [];

  for (const layer of intent.layers) {
    const groupIds: string[] = [];
    for (const groupId of layer.groupIds) {
      if (!groupsById.has(groupId) || assignedGroupIds.has(groupId)) {
        continue;
      }
      assignedGroupIds.add(groupId);
      groupIds.push(groupId);
    }

    if (groupIds.length > 0) {
      layers.push({
        id: layer.id,
        ...(layer.label !== undefined ? { label: layer.label } : {}),
        groupIds
      });
    }
  }

  const missingGroupIds = intent.groups
    .map((group) => group.id)
    .filter((groupId) => !assignedGroupIds.has(groupId));
  if (missingGroupIds.length > 0) {
    layers.push({
      id: nextCoordinateRoutingLayerId(layers, "layer_generated_unassigned"),
      label: "Unassigned",
      groupIds: missingGroupIds
    });
  }

  const measuredGroups = new Map<string, { width: number; height: number }>();
  for (const group of intent.groups) {
    measuredGroups.set(group.id, measureCoordinateRoutingGroup(group, document));
  }

  const layerMetrics = layers.map((layer) => {
    const sizes = layer.groupIds.map((groupId) => measuredGroups.get(groupId) ?? { width: 0, height: 0 });
    return {
      layer,
      width: sizes.reduce((total, size) => total + size.width, 0) + Math.max(0, sizes.length - 1) * config.groupGapX,
      height: sizes.reduce((height, size) => Math.max(height, size.height), 0)
    };
  });
  const widestLayer = layerMetrics.reduce((width, metric) => Math.max(width, metric.width), 0);
  const placedGroups = new Map<string, CoordinateRoutingLayoutGroupV3>();
  let y = config.paddingY;

  for (const metric of layerMetrics) {
    let x = config.paddingX + (widestLayer - metric.width) / 2;
    for (const groupId of metric.layer.groupIds) {
      const group = groupsById.get(groupId);
      if (!group) {
        continue;
      }
      const size = measuredGroups.get(groupId) ?? measureCoordinateRoutingGroup(group, document);
      placedGroups.set(groupId, {
        ...group,
        x,
        y,
        width: size.width,
        height: size.height
      });
      x += size.width + config.groupGapX;
    }
    y += metric.height + config.layerGapY;
  }

  return {
    ...intent,
    layers,
    groups: intent.groups.map((group) => placedGroups.get(group.id) ?? group)
  };
}

export function measureCoordinateRoutingGroup(
  group: CoordinateRoutingLayoutGroupV3,
  document: DiagramDocument
): { width: number; height: number } {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const dimensions = group.nodeOrder
    .map((nodeId) => {
      const persisted = group.nodes?.[nodeId];
      if (persisted && Number.isFinite(persisted.width) && Number.isFinite(persisted.height)) {
        return persisted;
      }
      const node = nodeById.get(nodeId);
      return node ? estimateClassNodeLayout(node) : undefined;
    })
    .filter((dimension): dimension is { width: number; height: number } => Boolean(dimension));

  if (dimensions.length === 0) {
    return { width: groupPadding * 2, height: groupPadding * 2 };
  }

  const maxWidth = Math.max(...dimensions.map((dimension) => dimension.width));
  const maxHeight = Math.max(...dimensions.map((dimension) => dimension.height));
  const sumWidth = dimensions.reduce((total, dimension) => total + dimension.width, 0);
  const sumHeight = dimensions.reduce((total, dimension) => total + dimension.height, 0);

  if (group.packing === "horizontal") {
    return {
      width: sumWidth + nodeGapX * (dimensions.length - 1) + groupPadding * 2,
      height: maxHeight + groupPadding * 2
    };
  }

  return {
    width: maxWidth + groupPadding * 2,
    height: sumHeight + nodeGapY * (dimensions.length - 1) + groupPadding * 2
  };
}

function convertStereotypeGridToCoordinateRouting(
  intent: StereotypeLayoutIntent,
  document: DiagramDocument,
  context: LayoutRunContext,
  sourceFormat: Exclude<LayoutSourceFormat, "coordinate-routing-v3" | "none">,
  existingWarnings: LayoutLogEvent[]
): NormalizeLayoutResult {
  for (const group of intent.groups) {
    if (group.packing === "compactGrid") {
      warn(context, existingWarnings, {
        phase: "normalize",
        type: "deprecated-packing-converted",
        message: `compactGrid is deprecated in routing v2; converted group "${group.label}" to vertical.`,
        groupId: group.id
      });
    }
  }

  const coordinate = stereotypeGridIntentToCoordinateRouting(intent, document);
  const normalized = normalizeCoordinateRoutingLayoutInput(coordinate, document, context, sourceFormat, existingWarnings);
  return {
    ...normalized,
    sourceFormat
  };
}

function stereotypeGridIntentToCoordinateRouting(
  intent: StereotypeLayoutIntent,
  document?: DiagramDocument
): CoordinateRoutingLayoutV3 {
  const nodeDimensions = new Map<string, { width: number; height: number }>();
  if (document) {
    for (const node of document.nodes) {
      const layout = estimateClassNodeLayout(node);
      nodeDimensions.set(node.id, { width: layout.width, height: layout.height });
    }
  }

  return {
    version: 3,
    layoutMode: "coordinate-routing",
    groups: intent.groups.map((group): CoordinateRoutingLayoutGroupV3 => {
      let width: number | undefined;
      let height: number | undefined;
      const nodesDict: Record<string, { width: number; height: number }> = {};
      const packing = normalizePackingValue(group.packing);

      if (document) {
        let maxWidth = 0;
        let maxHeight = 0;
        let sumWidth = 0;
        let sumHeight = 0;
        let validNodeCount = 0;

        for (const nodeId of group.nodeIds) {
          const dim = nodeDimensions.get(nodeId);
          if (dim) {
            nodesDict[nodeId] = dim;
            maxWidth = Math.max(maxWidth, dim.width);
            maxHeight = Math.max(maxHeight, dim.height);
            sumWidth += dim.width;
            sumHeight += dim.height;
            validNodeCount += 1;
          }
        }

        if (validNodeCount === 0) {
          width = groupPadding * 2;
          height = groupPadding * 2;
        } else if (packing === "horizontal") {
          width = sumWidth + nodeGapX * (validNodeCount - 1) + groupPadding * 2;
          height = maxHeight + groupPadding * 2;
        } else {
          width = maxWidth + groupPadding * 2;
          height = sumHeight + nodeGapY * (validNodeCount - 1) + groupPadding * 2;
        }
      }

      return {
        id: group.id,
        label: group.label,
        x: group.gridX * defaultCellWidth,
        y: group.gridY * defaultCellHeight,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        packing,
        nodeOrder: [...group.nodeIds],
        ...(Object.keys(nodesDict).length > 0 ? { nodes: nodesDict } : {}),
        locked: true
      };
    })
  };
}

function normalizeCoordinateRoutingLayoutInput(
  input: unknown,
  document: DiagramDocument,
  context: LayoutRunContext,
  sourceFormat: LayoutSourceFormat,
  initialWarnings: LayoutLogEvent[] = []
): NormalizeLayoutResult {
  const warnings = initialWarnings;

  if (!isRecord(input) || input.version !== 3 || input.layoutMode !== "coordinate-routing") {
    throw new Error('Coordinate routing layout must have version 3 and layoutMode "coordinate-routing".');
  }

  if (!Array.isArray(input.groups)) {
    throw new Error("Coordinate routing layout must define a groups array.");
  }

  const baseIntent = createStereotypeLayoutIntent(document);
  const baseGroupsById = new Map(baseIntent.groups.map((group) => [group.id, group]));
  const outputGroups: CoordinateRoutingLayoutGroupV3[] = [];
  const seenGroupIds = new Set<string>();
  const assignedNodeIds = new Set<string>();

  for (let index = 0; index < input.groups.length; index += 1) {
    const rawGroup = input.groups[index];
    const group = normalizeRawCoordinateGroup(rawGroup, index);

    if (isRecord(rawGroup) && rawGroup.packing === "compactGrid") {
      warn(context, warnings, {
        phase: "normalize",
        type: "deprecated-packing-converted",
        message: `compactGrid is deprecated in routing v2; converted group "${group.label}" to vertical.`,
        groupId: group.id
      });
    }

    if (seenGroupIds.has(group.id)) {
      context.logger.error({
        phase: "normalize",
        type: "duplicate-group-id",
        message: `Coordinate routing layout defines duplicate group id: ${group.id}.`,
        groupId: group.id
      });
      throw new Error(`Coordinate routing layout defines duplicate group id: ${group.id}`);
    }
    seenGroupIds.add(group.id);

    const baseGroup = baseGroupsById.get(group.id);
    if (!baseGroup) {
      warn(context, warnings, {
        phase: "normalize",
        type: "unknown-group-ignored",
        message: `Unknown group ${group.id} ignored.`,
        groupId: group.id
      });
      continue;
    }

    const nodeOrder = normalizeNodeOrder(group, baseGroup, assignedNodeIds, context, warnings);
    outputGroups.push({
      ...group,
      nodeOrder
    });
  }

  for (const baseGroup of baseIntent.groups) {
    if (outputGroups.some((group) => group.id === baseGroup.id)) {
      continue;
    }

    warn(context, warnings, {
      phase: "normalize",
      type: "missing-group-generated",
      message: `Missing group ${baseGroup.label} generated from document order.`,
      groupId: baseGroup.id
    });
    outputGroups.push({
      id: baseGroup.id,
      label: baseGroup.label,
      x: baseGroup.gridX * defaultCellWidth,
      y: baseGroup.gridY * defaultCellHeight,
      packing: normalizePackingValue(baseGroup.packing),
      nodeOrder: baseGroup.nodeIds.filter((nodeId) => !assignedNodeIds.has(nodeId)),
      locked: true
    });
    baseGroup.nodeIds.forEach((nodeId) => assignedNodeIds.add(nodeId));
  }

  const routing = normalizeRoutingOptions(input.routing);
  const rawLayers = input.layers === undefined ? undefined : normalizeRawCoordinateLayers(input.layers);
  const normalizedLayers = rawLayers === undefined
    ? undefined
    : normalizeCoordinateRoutingLayers(rawLayers, outputGroups, context, warnings);
  const normalizedIntent: CoordinateRoutingLayoutV3 = {
    version: 3,
    layoutMode: "coordinate-routing",
    groups: outputGroups,
    ...(normalizedLayers !== undefined ? { layers: normalizedLayers } : {}),
    routing
  };
  const intent = normalizedLayers === undefined
    ? normalizedIntent
    : applyCoordinateRoutingLayerLayout(normalizedIntent, document);

  return {
    intent: {
      ...intent,
      routing
    },
    sourceFormat,
    warnings
  };
}

function normalizeRawCoordinateLayers(value: unknown): CoordinateRoutingLayoutLayerV3[] {
  if (!Array.isArray(value)) {
    throw new Error("layers must be an array when provided.");
  }

  const layers: CoordinateRoutingLayoutLayerV3[] = [];
  const seenLayerIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const rawLayer = value[index];
    if (!isRecord(rawLayer)) {
      throw new Error(`layers[${index}] must be an object.`);
    }
    const id = requireString(rawLayer.id, `layers[${index}].id`);
    if (seenLayerIds.has(id)) {
      throw new Error(`Coordinate routing layout defines duplicate layer id: ${id}`);
    }
    seenLayerIds.add(id);

    if (!Array.isArray(rawLayer.groupIds)) {
      throw new Error(`layers[${index}].groupIds must be an array.`);
    }

    layers.push({
      id,
      ...(rawLayer.label === undefined ? {} : { label: requireString(rawLayer.label, `layers[${index}].label`) }),
      groupIds: rawLayer.groupIds.map((groupId, groupIndex) => requireString(groupId, `layers[${index}].groupIds[${groupIndex}]`))
    });
  }
  return layers;
}

function normalizeCoordinateRoutingLayers(
  layers: CoordinateRoutingLayoutLayerV3[],
  groups: CoordinateRoutingLayoutGroupV3[],
  context: LayoutRunContext,
  warnings: LayoutLogEvent[]
): CoordinateRoutingLayoutLayerV3[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const assignedGroupIds = new Set<string>();
  const normalizedLayers: CoordinateRoutingLayoutLayerV3[] = [];

  for (const layer of layers) {
    const validGroupIds: string[] = [];
    for (const groupId of layer.groupIds) {
      if (!groupIds.has(groupId)) {
        warn(context, warnings, {
          phase: "normalize",
          type: "unknown-layer-group-ignored",
          message: `Unknown layer group ${groupId} ignored.`,
          groupId,
          data: { layerId: layer.id }
        });
        continue;
      }

      if (assignedGroupIds.has(groupId)) {
        context.logger.error({
          phase: "normalize",
          type: "duplicate-layer-group-assignment",
          message: `Coordinate routing layers assign group ${groupId} more than once.`,
          groupId,
          data: { layerId: layer.id }
        });
        throw new Error(`Coordinate routing layers assign group ${groupId} more than once.`);
      }

      assignedGroupIds.add(groupId);
      validGroupIds.push(groupId);
    }

    if (validGroupIds.length > 0) {
      normalizedLayers.push({
        id: layer.id,
        ...(layer.label !== undefined ? { label: layer.label } : {}),
        groupIds: validGroupIds
      });
    }
  }

  const missingGroupIds = groups
    .map((group) => group.id)
    .filter((groupId) => !assignedGroupIds.has(groupId));
  if (missingGroupIds.length > 0) {
    warn(context, warnings, {
      phase: "normalize",
      type: "missing-layer-groups-appended",
      message: `${missingGroupIds.length} groups were not assigned to layers and were appended to a generated layer.`,
      data: { groupIds: missingGroupIds }
    });
    normalizedLayers.push({
      id: nextCoordinateRoutingLayerId(normalizedLayers, "layer_generated_unassigned"),
      label: "Unassigned",
      groupIds: missingGroupIds
    });
  }

  return normalizedLayers;
}

function nextCoordinateRoutingLayerId(layers: CoordinateRoutingLayoutLayerV3[], baseId: string): string {
  const usedLayerIds = new Set(layers.map((layer) => layer.id));
  if (!usedLayerIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (usedLayerIds.has(`${baseId}_${index}`)) {
    index += 1;
  }
  return `${baseId}_${index}`;
}

function normalizeRawCoordinateGroup(value: unknown, index: number): CoordinateRoutingLayoutGroupV3 {
  if (!isRecord(value)) {
    throw new Error(`Coordinate routing group at index ${index} must be an object.`);
  }

  const id = requireString(value.id, `groups[${index}].id`);
  const label = requireString(value.label, `groups[${index}].label`);
  const x = requireFiniteNumber(value.x, `groups[${index}].x`);
  const y = requireFiniteNumber(value.y, `groups[${index}].y`);
  const packing = requirePacking(value.packing, `groups[${index}].packing`);
  const nodeOrder = Array.isArray(value.nodeOrder)
    ? value.nodeOrder.map((nodeId, nodeIndex) => requireString(nodeId, `groups[${index}].nodeOrder[${nodeIndex}]`))
    : [];

  const width = typeof value.width === "number" ? value.width : undefined;
  const height = typeof value.height === "number" ? value.height : undefined;
  const nodes = isRecord(value.nodes) ? value.nodes as Record<string, { width: number; height: number }> : undefined;

  return {
    id,
    label,
    x,
    y,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    packing,
    nodeOrder,
    ...(nodes !== undefined ? { nodes } : {}),
    ...(value.locked === undefined ? {} : { locked: requireBoolean(value.locked, `groups[${index}].locked`) }),
    ...(value.packingLocked === undefined ? {} : { packingLocked: requireBoolean(value.packingLocked, `groups[${index}].packingLocked`) }),
    ...(value.nodeOrderLocked === undefined ? {} : { nodeOrderLocked: requireBoolean(value.nodeOrderLocked, `groups[${index}].nodeOrderLocked`) })
  };
}

function normalizeNodeOrder(
  group: CoordinateRoutingLayoutGroupV3,
  baseGroup: StereotypeLayoutIntentGroup,
  assignedNodeIds: Set<string>,
  context: LayoutRunContext,
  warnings: LayoutLogEvent[]
): string[] {
  const baseNodeIds = new Set(baseGroup.nodeIds);
  const localSeen = new Set<string>();
  const normalized: string[] = [];

  if (group.nodeOrder.length === 0) {
    warn(context, warnings, {
      phase: "normalize",
      type: "missing-node-order-generated",
      message: `Missing nodeOrder generated from document order for group ${group.label}.`,
      groupId: group.id
    });
  }

  for (const nodeId of group.nodeOrder) {
    if (localSeen.has(nodeId)) {
      warn(context, warnings, {
        phase: "normalize",
        type: "duplicate-node-removed",
        message: `Duplicate node ${nodeId} removed from nodeOrder for group ${group.label}.`,
        groupId: group.id,
        nodeId
      });
      continue;
    }
    localSeen.add(nodeId);

    if (!baseNodeIds.has(nodeId)) {
      warn(context, warnings, {
        phase: "normalize",
        type: "unknown-node-removed",
        message: `Unknown or out-of-group node ${nodeId} removed from nodeOrder for group ${group.label}.`,
        groupId: group.id,
        nodeId
      });
      continue;
    }

    if (assignedNodeIds.has(nodeId)) {
      warn(context, warnings, {
        phase: "normalize",
        type: "duplicate-node-assignment-removed",
        message: `Node ${nodeId} was already assigned by another group and was removed from ${group.label}.`,
        groupId: group.id,
        nodeId
      });
      continue;
    }

    normalized.push(nodeId);
    assignedNodeIds.add(nodeId);
  }

  for (const nodeId of baseGroup.nodeIds) {
    if (!assignedNodeIds.has(nodeId)) {
      warn(context, warnings, {
        phase: "normalize",
        type: "missing-node-appended",
        message: `Node ${nodeId} appended to nodeOrder for group ${group.label} from document order.`,
        groupId: group.id,
        nodeId
      });
      normalized.push(nodeId);
      assignedNodeIds.add(nodeId);
    }
  }

  return normalized;
}

function normalizeRoutingOptions(value: unknown): CoordinateRoutingOptions | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("routing must be an object when provided.");
  }

  return {
    ...(value.dividerThreshold === undefined ? {} : { dividerThreshold: requireNonNegativeInteger(value.dividerThreshold, "routing.dividerThreshold") }),
    ...(value.outerLaneMargin === undefined ? {} : { outerLaneMargin: requireNonNegativeNumber(value.outerLaneMargin, "routing.outerLaneMargin") }),
    ...(value.maxRepairPasses === undefined ? {} : { maxRepairPasses: requireNonNegativeInteger(value.maxRepairPasses, "routing.maxRepairPasses") })
  };
}

function normalizePackingValue(value: DiagramGroupPacking): DiagramGroupPackingV2 {
  return value === "horizontal" ? "horizontal" : "vertical";
}

function requirePacking(value: unknown, label: string): DiagramGroupPackingV2 {
  if (value === "compactGrid") {
    return "vertical";
  }

  if (value !== "vertical" && value !== "horizontal") {
    throw new Error(`${label} must be "vertical" or "horizontal".`);
  }

  return value;
}

function warn(
  context: LayoutRunContext,
  warnings: LayoutLogEvent[],
  event: Omit<LayoutLogEvent, "level">
): void {
  const fullEvent: LayoutLogEvent = { ...event, level: "warn" };
  warnings.push(fullEvent);
  context.logger.log(fullEvent);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return numeric;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  const numeric = requireFiniteNumber(value, label);
  if (numeric < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
  return numeric;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const numeric = requireNonNegativeNumber(value, label);
  if (!Number.isInteger(numeric)) {
    throw new Error(`${label} must be an integer.`);
  }
  return numeric;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
