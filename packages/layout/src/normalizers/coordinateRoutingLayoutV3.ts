import type {
  DiagramDocument,
  DiagramGroupKind,
  DiagramGroupPacking,
  DiagramGroupPackingV2
} from "../../../core/src/index.js";
import type { LayoutRunContext } from "../engine/LayoutEngine.js";
import type { LayoutLogEvent, LayoutSourceFormat } from "../engine/LayoutRunReport.js";
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
  routing?: CoordinateRoutingOptions;
};

export type CoordinateRoutingLayoutGroupV3 = {
  id: string;
  label: string;
  x: number;
  y: number;
  packing: DiagramGroupPackingV2;
  nodeOrder: string[];
  locked?: boolean;
  packingLocked?: boolean;
  nodeOrderLocked?: boolean;
};

export type CoordinateRoutingOptions = {
  dividerThreshold?: number;
  outerLaneMargin?: number;
  maxRepairPasses?: number;
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
  return stereotypeGridIntentToCoordinateRouting(intent);
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

  const coordinate = stereotypeGridIntentToCoordinateRouting(intent);
  const normalized = normalizeCoordinateRoutingLayoutInput(coordinate, document, context, sourceFormat, existingWarnings);
  return {
    ...normalized,
    sourceFormat
  };
}

function stereotypeGridIntentToCoordinateRouting(intent: StereotypeLayoutIntent): CoordinateRoutingLayoutV3 {
  return {
    version: 3,
    layoutMode: "coordinate-routing",
    groups: intent.groups.map((group): CoordinateRoutingLayoutGroupV3 => ({
      id: group.id,
      label: group.label,
      x: group.gridX * defaultCellWidth,
      y: group.gridY * defaultCellHeight,
      packing: normalizePackingValue(group.packing),
      nodeOrder: [...group.nodeIds],
      locked: true
    }))
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

  return {
    intent: {
      version: 3,
      layoutMode: "coordinate-routing",
      groups: outputGroups,
      routing: normalizeRoutingOptions(input.routing)
    },
    sourceFormat,
    warnings
  };
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

  return {
    id,
    label,
    x,
    y,
    packing,
    nodeOrder,
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
