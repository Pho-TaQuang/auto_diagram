import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramEdgeAnchorSide,
  DiagramGroup,
  DiagramGroupKind,
  DiagramGroupPacking,
  DiagramLayoutScore,
  DiagramNode,
  DiagramNodeLayout,
  DiagramPoint
} from "../../core/src/index.js";
import { estimateClassNodeLayout } from "./mvp0GridLayout.js";

const exactStereotypeOrder = [
  "Controller",
  "ManagerInterface",
  "Manager",
  "AdapterFactory",
  "DataAccessAdapter",
  "LLBLGenEntity",
  "Model",
  "DTO"
];

const suggestedGroupColumns = 4;
const suggestedGroupPositions = new Map<string, DiagramPoint>([
  ["AdapterFactory", { x: 1, y: 0 }],
  ["DataAccessAdapter", { x: 2, y: 0 }],
  ["Controller", { x: 0, y: 1 }],
  ["ManagerInterface", { x: 1, y: 1 }],
  ["Manager", { x: 2, y: 1 }],
  ["LLBLGenEntity", { x: 3, y: 1 }],
  ["Model", { x: 0, y: 2 }],
  ["DTO", { x: 1, y: 2 }]
]);
const suggestedFallbackStartRow = 3;
const syntheticUngroupedLabel = "Ungrouped";
const defaultGroupColumns = 3;
const pageMarginX = 40;
const pageMarginY = 40;
const groupGapX = 120;
const groupGapY = 160;
const groupPadding = 32;
const nodeGapX = 80;
const nodeGapY = 80;
const waypointMargin = 16;
const anchorStubDistance = 24;
const defaultCandidateLimit = 100;
const lockedGroupCandidateLimit = 220;
const lockedGroupAnchorOrderVariantLimit = 32;
const exactEndpointBucketPermutationLimit = 5;
const epsilon = 0.001;
const scoreWeights = {
  edgeNodeHits: 1000000000,
  nodeOverlaps: 800000000,
  groupOverlaps: 500000000,
  edgeCrossings: 250000000,
  segmentOverlaps: 100000000,
  duplicateAnchors: 10000000,
  edgeBends: 1000,
  edgeLength: 0.1,
  compactWidth: 250,
  compactHeight: 25,
  compactArea: 0.0001
};

export type StereotypeLayoutIntent = {
  version: 1;
  grid: {
    columns: number;
    rows: number;
  };
  groups: StereotypeLayoutIntentGroup[];
};

export type StereotypeLayoutIntentGroup = {
  id: string;
  label: string;
  kind: DiagramGroupKind;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  packing: DiagramGroupPacking;
  nodeIds: string[];
};

/**
 * AUTODIAGRAM CHANGE - Anchor order mode
 * Cho phép router đổi thứ tự edge trên cùng một cạnh node.
 * - auto: thử các thứ tự heuristic.
 * - manual: chỉ dùng thứ tự người dùng truyền vào.
 * - autoWithManual: ưu tiên manual, sau đó thử thêm heuristic để giảm crossing.
 */
export type AnchorOrderMode = "auto" | "manual" | "autoWithManual";

/**
 * AUTODIAGRAM CHANGE - Manual anchor order
 * Người dùng chỉ cần khai báo thứ tự edgeId trên một node-side.
 * Thuật toán vẫn tự chia đều ratio; phần này chỉ đổi edge nào nhận ratio nào.
 */
export type AnchorOrderIntent = {
  nodeId: string;
  side: DiagramEdgeAnchorSide;
  edgeOrder: string[];
};

export type ApplyStereotypeGridLayoutOptions = {
  intent?: StereotypeLayoutIntent;
  candidateLimit?: number;
  /**
   * AUTODIAGRAM CHANGE - Routing options
   * Điều khiển thứ tự endpoint trong từng bucket nodeId+side để giảm crossing.
   * Không bắt buộc caller phải set ratio cụ thể.
   */
  anchorOrders?: AnchorOrderIntent[];
  anchorOrderMode?: AnchorOrderMode;
  anchorOrderVariantLimit?: number;
};

export type CreateStereotypeLayoutIntentOptions = {
  columns?: number;
  rows?: number;
  placement?: "grid" | "suggested";
};

type GridSize = {
  columns: number;
  rows: number;
};

type PackedGroup = {
  group: DiagramGroup;
  nodes: DiagramNode[];
  relativeLayouts: Map<string, Pick<DiagramNodeLayout, "x" | "y">>;
};

type CandidateGroupPlan = {
  id: string;
  label: string;
  kind: DiagramGroupKind;
  nodeIds: string[];
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  packing: DiagramGroupPacking;
};

type LayoutCandidatePlan = {
  id: string;
  grid: GridSize;
  groups: CandidateGroupPlan[];
};

type GroupNodeOrderVariant = {
  id: string;
  nodeIds: string[];
};

type LayoutAttempt = {
  id: string;
  grid: GridSize;
  nodes: DiagramNode[];
  groups: DiagramGroup[];
  edges: DiagramEdge[];
  score: DiagramLayoutScore;
};

type EdgePath = {
  edge: DiagramEdge;
  points: DiagramPoint[];
};

type RoutedEdgeCandidate = {
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
  waypoints: DiagramPoint[];
  points: DiagramPoint[];
};

type EdgeEndpointRole = "source" | "target";

type EdgeEndpointReference = {
  edge: DiagramEdge;
  role: EdgeEndpointRole;
  node: DiagramNode;
  otherNode: DiagramNode;
  nodeGroup?: DiagramGroup;
  otherGroup?: DiagramGroup;
  side: DiagramEdgeAnchorSide;
};

type EdgeEndpointAssignment = {
  anchor: DiagramEdgeAnchor;
  laneIndex: number;
};

type EdgeRoutingAssignment = {
  source: EdgeEndpointAssignment;
  target: EdgeEndpointAssignment;
};

/**
 * AUTODIAGRAM CHANGE - Anchor assignment candidate
 * Mỗi variant là một cách gán edge endpoint vào anchor ratio.
 * Layout candidate giờ được chấm điểm cùng nhiều anchor-order variant.
 */
type AnchorAssignmentVariant = {
  id: string;
  assignments: Map<string, EdgeRoutingAssignment>;
};

type AnchorOrderPlan = {
  id: string;
  ordersByBucket: Map<string, EdgeEndpointReference[]>;
};

type EndpointBucketOrderVariant = {
  id: string;
  endpoints: EdgeEndpointReference[];
};

type ResolvedRoutingOptions = {
  anchorOrders: AnchorOrderIntent[];
  anchorOrderMode: AnchorOrderMode;
  anchorOrderVariantLimit: number;
};

export function createStereotypeLayoutIntent(
  document: DiagramDocument,
  options: CreateStereotypeLayoutIntentOptions = {}
): StereotypeLayoutIntent {
  const placement = requirePlacement(options.placement ?? "grid", "layout intent placement");
  const columns = placement === "suggested"
    ? suggestedGroupColumns
    : requirePositiveInteger(options.columns ?? defaultGroupColumns, "layout intent columns");
  const nodes = cloneMeasuredNodes(document.nodes);
  const groups = buildExactStereotypeGroups(nodes, columns);

  if (placement === "suggested") {
    applySuggestedGroupPlacement(groups);
  }

  const minimumRows = Math.max(1, Math.ceil(groups.length / columns));
  const rows = requirePositiveInteger(options.rows ?? minimumRows, "layout intent rows");

  return {
    version: 1,
    grid: {
      columns,
      rows: Math.max(rows, ...groups.map((group) => {
        const intent = requireLayoutIntent(group);
        return intent.gridY + intent.gridHeight;
      }))
    },
    groups: groups.map((group) => {
      const intent = requireLayoutIntent(group);
      return {
        id: group.id,
        label: group.label,
        kind: group.kind,
        gridX: intent.gridX,
        gridY: intent.gridY,
        gridWidth: intent.gridWidth,
        gridHeight: intent.gridHeight,
        packing: intent.packing,
        nodeIds: [...group.nodeIds]
      };
    })
  };
}

export function normalizeStereotypeLayoutIntent(value: unknown): StereotypeLayoutIntent {
  if (!isRecord(value)) {
    throw new Error("Layout intent must be a JSON object.");
  }

  if (value.version !== 1) {
    throw new Error("Layout intent version must be 1.");
  }

  if (!isRecord(value.grid)) {
    throw new Error("Layout intent must define a grid object.");
  }

  const columns = requirePositiveInteger(value.grid.columns, "layout intent grid.columns");
  const rows = requirePositiveInteger(value.grid.rows, "layout intent grid.rows");

  if (!Array.isArray(value.groups)) {
    throw new Error("Layout intent must define a groups array.");
  }

  return {
    version: 1,
    grid: { columns, rows },
    groups: value.groups.map((rawGroup, index) => normalizeIntentGroup(rawGroup, index, { columns, rows }))
  };
}

export function applyStereotypeGridLayout(
  document: DiagramDocument,
  options: ApplyStereotypeGridLayoutOptions = {}
): DiagramDocument {
  const nodes = cloneMeasuredNodes(document.nodes);
  const hasExplicitIntent = Boolean(options.intent);
  const prepared = options.intent
    ? applyLayoutIntent(nodes, normalizeStereotypeLayoutIntent(options.intent))
    : createDefaultLayoutInput(nodes);
  const candidatePlans = generateLayoutCandidates(
    prepared.groups,
    nodes,
    document.edges,
    prepared.grid,
    hasExplicitIntent,
    options.candidateLimit ?? (hasExplicitIntent ? lockedGroupCandidateLimit : defaultCandidateLimit)
  );
  const routingOptions = resolveRoutingOptions(options, hasExplicitIntent);
  const attempts = candidatePlans.map((candidate) => materializeCandidate(candidate, nodes, document.edges, routingOptions));

  if (attempts.length === 0) {
    throw new Error("No layout candidates were generated.");
  }

  const best = attempts.reduce((currentBest, attempt) => compareAttempts(attempt, currentBest) < 0 ? attempt : currentBest);
  const refinedEdges = routingOptions.anchorOrderMode === "manual"
    ? best.edges
    : refineRoutedEdgeAnchors(best.edges, best.nodes, best.groups);
  const refinedScore = scoreLayout(refinedEdges, best.nodes, best.groups);

  return {
    ...document,
    nodes: best.nodes,
    edges: refinedEdges,
    groups: best.groups,
    layout: {
      engine: "stereotype-scored",
      selectedCandidateId: best.id,
      candidatesEvaluated: attempts.length,
      score: refinedScore,
      grid: best.grid
    }
  };
}

function createDefaultLayoutInput(nodes: DiagramNode[]): { groups: DiagramGroup[]; grid: GridSize } {
  const groups = buildExactStereotypeGroups(nodes, defaultGroupColumns);
  return {
    groups,
    grid: {
      columns: defaultGroupColumns,
      rows: Math.max(1, Math.ceil(groups.length / defaultGroupColumns))
    }
  };
}

function applyLayoutIntent(nodes: DiagramNode[], rawIntent: StereotypeLayoutIntent): { groups: DiagramGroup[]; grid: GridSize } {
  const intent = normalizeStereotypeLayoutIntent(rawIntent);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const assignedNodeIds = new Set<string>();
  const groupIds = new Set<string>();
  const occupiedGridCells = new Map<string, string>();
  const groups: DiagramGroup[] = [];

  for (const intentGroup of intent.groups) {
    if (groupIds.has(intentGroup.id)) {
      throw new Error(`Layout intent defines duplicate group id: ${intentGroup.id}`);
    }
    groupIds.add(intentGroup.id);

    for (let x = intentGroup.gridX; x < intentGroup.gridX + intentGroup.gridWidth; x += 1) {
      for (let y = intentGroup.gridY; y < intentGroup.gridY + intentGroup.gridHeight; y += 1) {
        const key = `${x}:${y}`;
        const existingGroupId = occupiedGridCells.get(key);
        if (existingGroupId) {
          throw new Error(`Layout intent groups ${existingGroupId} and ${intentGroup.id} overlap at grid cell ${key}.`);
        }
        occupiedGridCells.set(key, intentGroup.id);
      }
    }

    for (const nodeId of intentGroup.nodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) {
        throw new Error(`Layout intent references unknown node: ${nodeId}`);
      }
      if (assignedNodeIds.has(nodeId)) {
        throw new Error(`Layout intent assigns node more than once: ${nodeId}`);
      }
      assignedNodeIds.add(nodeId);
      node.groupId = intentGroup.id;
    }

    groups.push({
      id: intentGroup.id,
      label: intentGroup.label,
      kind: intentGroup.kind,
      nodeIds: [...intentGroup.nodeIds],
      layoutIntent: {
        gridX: intentGroup.gridX,
        gridY: intentGroup.gridY,
        gridWidth: intentGroup.gridWidth,
        gridHeight: intentGroup.gridHeight,
        packing: intentGroup.packing
      }
    });
  }

  for (const node of nodes) {
    if (!assignedNodeIds.has(node.id)) {
      throw new Error(`Layout intent does not assign node: ${node.id}`);
    }
  }

  return {
    groups,
    grid: intent.grid
  };
}

function cloneMeasuredNodes(nodes: DiagramNode[]): DiagramNode[] {
  return nodes.map((node) => ({
    ...node,
    attributes: [...node.attributes],
    methods: [...node.methods],
    layout: estimateClassNodeLayout(node)
  }));
}

function buildExactStereotypeGroups(nodes: DiagramNode[], columns: number): DiagramGroup[] {
  const groupsByKey = new Map<string, DiagramGroup>();
  const firstSeenGroups: DiagramGroup[] = [];
  const usedIds = new Set<string>();

  for (const node of nodes) {
    const exactStereotype = node.stereotype && node.stereotype.length > 0 ? node.stereotype : undefined;
    const kind = exactStereotype ? "stereotype" : "synthetic";
    const label = exactStereotype ?? syntheticUngroupedLabel;
    const groupKey = `${kind}:${label}`;
    let group = groupsByKey.get(groupKey);

    if (!group) {
      group = {
        id: createUniqueGroupId(kind, label, usedIds),
        label,
        kind,
        nodeIds: []
      };
      groupsByKey.set(groupKey, group);
      firstSeenGroups.push(group);
    }

    group.nodeIds.push(node.id);
    node.groupId = group.id;
  }

  const knownGroups = exactStereotypeOrder
    .map((label) => groupsByKey.get(`stereotype:${label}`))
    .filter((group): group is DiagramGroup => Boolean(group));
  const knownGroupIds = new Set(knownGroups.map((group) => group.id));
  const unknownStereotypeGroups = firstSeenGroups.filter(
    (group) => group.kind === "stereotype" && !knownGroupIds.has(group.id)
  );
  const syntheticGroups = firstSeenGroups.filter((group) => group.kind === "synthetic");

  return [...knownGroups, ...unknownStereotypeGroups, ...syntheticGroups].map((group, index) => {
    const packing = packingForGroup(group);
    return {
      ...group,
      nodeIds: [...group.nodeIds],
      layoutIntent: {
        gridX: index % columns,
        gridY: Math.floor(index / columns),
        gridWidth: 1,
        gridHeight: 1,
        packing
      }
    };
  });
}

function applySuggestedGroupPlacement(groups: DiagramGroup[]): void {
  const occupied = new Set<string>();
  const hasSuggestedPosition = groups.some((group) => suggestedGroupPositions.has(group.label));
  const fallbackStartRow = hasSuggestedPosition ? suggestedFallbackStartRow : 0;
  let fallbackIndex = 0;

  for (const group of groups) {
    let position = suggestedGroupPositions.get(group.label);

    while (!position || occupied.has(`${position.x}:${position.y}`)) {
      position = {
        x: fallbackIndex % suggestedGroupColumns,
        y: fallbackStartRow + Math.floor(fallbackIndex / suggestedGroupColumns)
      };
      fallbackIndex += 1;
    }

    occupied.add(`${position.x}:${position.y}`);
    group.layoutIntent = {
      gridX: position.x,
      gridY: position.y,
      gridWidth: 1,
      gridHeight: 1,
      packing: group.layoutIntent?.packing ?? packingForGroup(group)
    };
  }
}

function generateLayoutCandidates(
  groups: DiagramGroup[],
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  grid: GridSize,
  lockedGroupPlacement: boolean,
  candidateLimit: number
): LayoutCandidatePlan[] {
  const basePlans = lockedGroupPlacement
    ? [createCandidatePlan("intent-grid", groups, grid)]
    : createDefaultGroupPlacementCandidates(groups);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const degreeByNodeId = calculateNodeDegrees(nodes, edges);
  const candidates: LayoutCandidatePlan[] = [];

  for (const basePlan of basePlans) {
    candidates.push(applyPackingVariant(basePlan, "original", nodeById, degreeByNodeId));
    candidates.push(applyPackingVariant(basePlan, "degree", nodeById, degreeByNodeId));
    candidates.push(applyPackingVariant(basePlan, "degree-ascending", nodeById, degreeByNodeId));
    candidates.push(applyPackingVariant(basePlan, "name", nodeById, degreeByNodeId));
    candidates.push(applyPackingVariant(basePlan, "name-reverse", nodeById, degreeByNodeId));
    candidates.push(applyPackingVariant(basePlan, "reverse", nodeById, degreeByNodeId));
    if (!lockedGroupPlacement) {
      candidates.push(applyPackingVariant(basePlan, "all-vertical", nodeById, degreeByNodeId));
      candidates.push(applyPackingVariant(basePlan, "degree-compact", nodeById, degreeByNodeId));
    }
  }

  for (const basePlan of basePlans) {
    candidates.push(...createNodeOrderSearchCandidates(basePlan, nodeById, degreeByNodeId, candidateLimit));
  }

  return uniqueCandidates(candidates).slice(0, Math.max(1, candidateLimit));
}

function createDefaultGroupPlacementCandidates(groups: DiagramGroup[]): LayoutCandidatePlan[] {
  const compactColumns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const compactGrid = {
    columns: compactColumns,
    rows: Math.max(1, Math.ceil(groups.length / compactColumns))
  };

  return [
    createCandidatePlan("stereotype-grid", groups, {
      columns: defaultGroupColumns,
      rows: Math.max(1, Math.ceil(groups.length / defaultGroupColumns))
    }),
    createSequentialCandidatePlan("left-to-right", groups, { columns: Math.max(1, groups.length), rows: 1 }),
    createSequentialCandidatePlan("top-to-bottom", groups, { columns: 1, rows: Math.max(1, groups.length) }),
    createSequentialCandidatePlan("compact-grid", groups, compactGrid),
    createRoleBandCandidatePlan(groups)
  ];
}

function createCandidatePlan(id: string, groups: DiagramGroup[], grid: GridSize): LayoutCandidatePlan {
  return {
    id,
    grid,
    groups: groups.map((group) => {
      const intent = requireLayoutIntent(group);
      return {
        id: group.id,
        label: group.label,
        kind: group.kind,
        nodeIds: [...group.nodeIds],
        gridX: intent.gridX,
        gridY: intent.gridY,
        gridWidth: intent.gridWidth,
        gridHeight: intent.gridHeight,
        packing: intent.packing
      };
    })
  };
}

function createSequentialCandidatePlan(id: string, groups: DiagramGroup[], grid: GridSize): LayoutCandidatePlan {
  return {
    id,
    grid,
    groups: groups.map((group, index) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      nodeIds: [...group.nodeIds],
      gridX: index % grid.columns,
      gridY: Math.floor(index / grid.columns),
      gridWidth: 1,
      gridHeight: 1,
      packing: group.layoutIntent?.packing ?? packingForGroup(group)
    }))
  };
}

function createRoleBandCandidatePlan(groups: DiagramGroup[]): LayoutCandidatePlan {
  const occupied = new Set<string>();
  const plannedGroups: CandidateGroupPlan[] = [];
  const hasSuggestedPosition = groups.some((group) => suggestedGroupPositions.has(group.label));
  const fallbackStartRow = hasSuggestedPosition ? suggestedFallbackStartRow : 0;
  let fallbackIndex = 0;

  for (const group of groups) {
    let position = suggestedGroupPositions.get(group.label);

    while (!position || occupied.has(`${position.x}:${position.y}`)) {
      position = {
        x: fallbackIndex % suggestedGroupColumns,
        y: fallbackStartRow + Math.floor(fallbackIndex / suggestedGroupColumns)
      };
      fallbackIndex += 1;
    }

    occupied.add(`${position.x}:${position.y}`);
    plannedGroups.push({
      id: group.id,
      label: group.label,
      kind: group.kind,
      nodeIds: [...group.nodeIds],
      gridX: position.x,
      gridY: position.y,
      gridWidth: 1,
      gridHeight: 1,
      packing: group.layoutIntent?.packing ?? packingForGroup(group)
    });
  }

  return {
    id: "role-band",
    grid: {
      columns: suggestedGroupColumns,
      rows: Math.max(1, ...plannedGroups.map((group) => group.gridY + 1))
    },
    groups: plannedGroups
  };
}

function applyPackingVariant(
  plan: LayoutCandidatePlan,
  variant: string,
  nodeById: Map<string, DiagramNode>,
  degreeByNodeId: Map<string, number>
): LayoutCandidatePlan {
  return {
    id: `${plan.id}-${variant}`,
    grid: plan.grid,
    groups: plan.groups.map((group) => {
      const orderedNodeIds = orderNodeIds(group.nodeIds, variant, nodeById, degreeByNodeId);
      const packing = packingForVariant(group.packing, variant);
      return {
        ...group,
        nodeIds: orderedNodeIds,
        packing
      };
    })
  };
}

function orderNodeIds(
  nodeIds: string[],
  variant: string,
  nodeById: Map<string, DiagramNode>,
  degreeByNodeId: Map<string, number>
): string[] {
  if (variant === "degree" || variant === "degree-compact") {
    return [...nodeIds].sort((left, right) => {
      const degreeDelta = (degreeByNodeId.get(right) ?? 0) - (degreeByNodeId.get(left) ?? 0);
      return degreeDelta !== 0 ? degreeDelta : left.localeCompare(right);
    });
  }

  if (variant === "degree-ascending") {
    return [...nodeIds].sort((left, right) => {
      const degreeDelta = (degreeByNodeId.get(left) ?? 0) - (degreeByNodeId.get(right) ?? 0);
      return degreeDelta !== 0 ? degreeDelta : left.localeCompare(right);
    });
  }

  if (variant === "name") {
    return [...nodeIds].sort((left, right) => {
      const leftLabel = nodeById.get(left)?.label ?? left;
      const rightLabel = nodeById.get(right)?.label ?? right;
      return leftLabel.localeCompare(rightLabel);
    });
  }

  if (variant === "name-reverse") {
    return orderNodeIds(nodeIds, "name", nodeById, degreeByNodeId).reverse();
  }

  if (variant === "reverse") {
    return [...nodeIds].reverse();
  }

  return [...nodeIds];
}

function createNodeOrderSearchCandidates(
  plan: LayoutCandidatePlan,
  nodeById: Map<string, DiagramNode>,
  degreeByNodeId: Map<string, number>,
  candidateLimit: number
): LayoutCandidatePlan[] {
  const reorderableGroups = plan.groups
    .map((group) => ({
      group,
      variants: groupNodeOrderVariants(group, nodeById, degreeByNodeId)
    }))
    .filter(({ variants }) => variants.length > 0);

  if (reorderableGroups.length === 0) {
    return [];
  }

  const maxCandidates = Math.max(1, Math.min(candidateLimit, 64));
  const candidates: LayoutCandidatePlan[] = [];
  let frontier: LayoutCandidatePlan[] = [plan];

  for (const { group, variants } of reorderableGroups) {
    const next: LayoutCandidatePlan[] = [];

    for (const candidate of frontier) {
      for (const variant of variants) {
        next.push(replaceGroupNodeOrder(candidate, group.id, variant));
      }
    }

    const merged = uniqueCandidates([...frontier, ...next]);
    frontier = merged.slice(0, maxCandidates + 1);
    candidates.push(...next);

    if (uniqueCandidates(candidates).length >= maxCandidates) {
      break;
    }
  }

  return uniqueCandidates(candidates).slice(0, maxCandidates);
}

function groupNodeOrderVariants(
  group: CandidateGroupPlan,
  nodeById: Map<string, DiagramNode>,
  degreeByNodeId: Map<string, number>
): GroupNodeOrderVariant[] {
  if (group.nodeIds.length < 2) {
    return [];
  }

  const variants = ["reverse", "degree", "degree-ascending", "name", "name-reverse"]
    .map((variantId) => ({
      id: variantId,
      nodeIds: orderNodeIds(group.nodeIds, variantId, nodeById, degreeByNodeId)
    }))
    .filter((variant) => !sameStringList(variant.nodeIds, group.nodeIds));
  variants.push(...permutationNodeOrderVariants(group.nodeIds));
  const unique = new Map<string, GroupNodeOrderVariant>();

  for (const variant of variants) {
    unique.set(variant.nodeIds.join("\u0000"), variant);
  }

  return [...unique.values()];
}

function permutationNodeOrderVariants(nodeIds: string[]): GroupNodeOrderVariant[] {
  if (nodeIds.length < 2 || nodeIds.length > 4) {
    return [];
  }

  return permutations(nodeIds)
    .filter((candidate) => !sameStringList(candidate, nodeIds))
    .map((candidate, index) => ({
      id: `perm-${index + 1}`,
      nodeIds: candidate
    }));
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) {
    return [values];
  }

  const results: T[][] = [];

  values.forEach((value, index) => {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(remaining)) {
      results.push([value, ...suffix]);
    }
  });

  return results;
}

function replaceGroupNodeOrder(
  plan: LayoutCandidatePlan,
  groupId: string,
  variant: GroupNodeOrderVariant
): LayoutCandidatePlan {
  return {
    id: `${plan.id}-order-${safePlanId(groupId)}-${variant.id}`,
    grid: plan.grid,
    groups: plan.groups.map((group) => group.id === groupId
      ? {
        ...group,
        nodeIds: [...variant.nodeIds]
      }
      : {
        ...group,
        nodeIds: [...group.nodeIds]
      })
  };
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safePlanId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function packingForVariant(currentPacking: DiagramGroupPacking, variant: string): DiagramGroupPacking {
  if (variant === "all-vertical") {
    return "vertical";
  }

  if (variant === "degree-compact") {
    return "compactGrid";
  }

  return currentPacking;
}

function materializeCandidate(
  plan: LayoutCandidatePlan,
  baseNodes: DiagramNode[],
  baseEdges: DiagramEdge[],
  routingOptions: ResolvedRoutingOptions
): LayoutAttempt {
  const nodes = baseNodes.map((node) => ({
    ...node,
    attributes: [...node.attributes],
    methods: [...node.methods],
    layout: node.layout ? { ...node.layout } : undefined
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = plan.groups.map((group) => ({
    id: group.id,
    label: group.label,
    kind: group.kind,
    nodeIds: [...group.nodeIds],
    layoutIntent: {
      gridX: group.gridX,
      gridY: group.gridY,
      gridWidth: group.gridWidth,
      gridHeight: group.gridHeight,
      packing: group.packing
    }
  }));

  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      requireNode(nodeById, nodeId).groupId = group.id;
    }
  }

  const packedGroups = groups.map((group) => packGroup(group, nodeById));
  placeGroupsOnGrid(packedGroups, plan.grid);

  const laidOutGroups = packedGroups.map((packedGroup) => packedGroup.group);
  const edges = routeEdges(baseEdges, nodes, laidOutGroups, routingOptions);
  const score = scoreLayout(edges, nodes, laidOutGroups);

  return {
    id: plan.id,
    grid: plan.grid,
    nodes,
    groups: laidOutGroups,
    edges,
    score
  };
}

function packGroup(group: DiagramGroup, nodeById: Map<string, DiagramNode>): PackedGroup {
  const nodes = group.nodeIds.map((nodeId) => requireNode(nodeById, nodeId));
  const packing = group.layoutIntent?.packing ?? packingForGroup(group);
  const relativeLayouts = packing === "vertical"
    ? packVertical(nodes)
    : packing === "horizontal"
      ? packHorizontal(nodes)
      : packCompactGrid(nodes);
  const bounds = calculateRelativeBounds(nodes, relativeLayouts);

  group.layout = bounds;

  return {
    group,
    nodes,
    relativeLayouts
  };
}

function packVertical(nodes: DiagramNode[]): Map<string, Pick<DiagramNodeLayout, "x" | "y">> {
  const layouts = new Map<string, Pick<DiagramNodeLayout, "x" | "y">>();
  let y = groupPadding;

  for (const node of nodes) {
    layouts.set(node.id, { x: groupPadding, y });
    y += requireLayout(node).height + nodeGapY;
  }

  return layouts;
}

function packHorizontal(nodes: DiagramNode[]): Map<string, Pick<DiagramNodeLayout, "x" | "y">> {
  const layouts = new Map<string, Pick<DiagramNodeLayout, "x" | "y">>();
  let x = groupPadding;

  for (const node of nodes) {
    layouts.set(node.id, { x, y: groupPadding });
    x += requireLayout(node).width + nodeGapX;
  }

  return layouts;
}

function packCompactGrid(nodes: DiagramNode[]): Map<string, Pick<DiagramNodeLayout, "x" | "y">> {
  const layouts = new Map<string, Pick<DiagramNodeLayout, "x" | "y">>();
  const columnCount = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
  const rowCount = Math.max(1, Math.ceil(nodes.length / columnCount));
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  nodes.forEach((node, index) => {
    const layout = requireLayout(node);
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    columnWidths[column] = Math.max(columnWidths[column], layout.width);
    rowHeights[row] = Math.max(rowHeights[row], layout.height);
  });

  nodes.forEach((node, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const x = groupPadding + sumBefore(columnWidths, column) + column * nodeGapX;
    const y = groupPadding + sumBefore(rowHeights, row) + row * nodeGapY;
    layouts.set(node.id, { x, y });
  });

  return layouts;
}

function calculateRelativeBounds(
  nodes: DiagramNode[],
  relativeLayouts: Map<string, Pick<DiagramNodeLayout, "x" | "y">>
): { x: number; y: number; width: number; height: number } {
  let width = groupPadding * 2;
  let height = groupPadding * 2;

  for (const node of nodes) {
    const layout = requireLayout(node);
    const relativeLayout = requireRelativeLayout(relativeLayouts, node.id);
    width = Math.max(width, relativeLayout.x + layout.width + groupPadding);
    height = Math.max(height, relativeLayout.y + layout.height + groupPadding);
  }

  return {
    x: 0,
    y: 0,
    width,
    height
  };
}

function placeGroupsOnGrid(packedGroups: PackedGroup[], grid: GridSize): void {
  const columnWidths = Array.from({ length: grid.columns }, () => 0);
  const rowHeights = Array.from({ length: grid.rows }, () => 0);

  for (const packedGroup of packedGroups) {
    const intent = requireLayoutIntent(packedGroup.group);
    const groupLayout = requireGroupLayout(packedGroup.group);
    const spanWidth = Math.max(1, intent.gridWidth);
    const spanHeight = Math.max(1, intent.gridHeight);
    const columnWidth = groupLayout.width / spanWidth;
    const rowHeight = groupLayout.height / spanHeight;

    for (let column = intent.gridX; column < intent.gridX + spanWidth; column += 1) {
      columnWidths[column] = Math.max(columnWidths[column], columnWidth);
    }

    for (let row = intent.gridY; row < intent.gridY + spanHeight; row += 1) {
      rowHeights[row] = Math.max(rowHeights[row], rowHeight);
    }
  }

  const columnOffsets = columnWidths.map((_, index) => pageMarginX + sumBefore(columnWidths, index) + index * groupGapX);
  const rowOffsets = rowHeights.map((_, index) => pageMarginY + sumBefore(rowHeights, index) + index * groupGapY);

  for (const packedGroup of packedGroups) {
    const intent = requireLayoutIntent(packedGroup.group);
    const groupLayout = requireGroupLayout(packedGroup.group);
    const spanWidth = calculateGridSpanSize(columnWidths, intent.gridX, intent.gridWidth, groupGapX);
    const spanHeight = calculateGridSpanSize(rowHeights, intent.gridY, intent.gridHeight, groupGapY);
    const x = centerWithin(columnOffsets[intent.gridX], spanWidth, groupLayout.width);
    const y = centerWithin(rowOffsets[intent.gridY], spanHeight, groupLayout.height);

    packedGroup.group.layout = {
      ...groupLayout,
      x,
      y
    };

    for (const node of packedGroup.nodes) {
      const layout = requireLayout(node);
      const relativeLayout = requireRelativeLayout(packedGroup.relativeLayouts, node.id);
      node.layout = {
        ...layout,
        x: x + relativeLayout.x,
        y: y + relativeLayout.y
      };
    }
  }
}

function calculateGridSpanSize(sizes: number[], start: number, span: number, gap: number): number {
  const normalizedSpan = Math.max(1, span);
  const size = sizes
    .slice(start, start + normalizedSpan)
    .reduce((sum, value) => sum + value, 0);

  return size + (normalizedSpan - 1) * gap;
}

function centerWithin(start: number, availableSize: number, itemSize: number): number {
  return start + (availableSize - itemSize) / 2;
}

// Changed: routeEdges now evaluates multiple anchor-order variants for the same node placement.
// This is the main crossing-reduction change: two layouts with identical node positions can still
// produce different crossing counts depending on edge order along each side of a node.
/**
 * AUTODIAGRAM CHANGE - Routing entry point
 * Route edge với nhiều anchor-order variant, sau đó chọn bộ route có score tốt nhất.
 * Phần này là thay đổi chính giúp đổi thứ tự anchor auto/manual để giảm crossing.
 */
function routeEdges(
  edges: DiagramEdge[],
  nodes: DiagramNode[],
  groups: DiagramGroup[],
  routingOptions: ResolvedRoutingOptions = defaultRoutingOptions()
): DiagramEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  // Added: instead of one fixed endpoint assignment, generate several order variants.
  const assignmentVariants = allocateEdgeRoutingAssignmentVariants(edges, nodeById, groupById, routingOptions);

  if (assignmentVariants.length === 0) {
    return edges.map((edge) => cloneEdge(edge));
  }

  const attempts = assignmentVariants.map((variant) => ({
    variant,
    routedEdges: routeEdgesWithAssignments(edges, nodes, groups, variant.assignments)
  }));

  return attempts.reduce((best, attempt) => {
    // Score every routed variant. Anchor order can change when the full route score improves,
    // including detours that reduce crossings; exact ties keep the first generated variant.
    const attemptScore = scoreLayout(attempt.routedEdges, nodes, groups);
    const bestScore = scoreLayout(best.routedEdges, nodes, groups);
    const scoreDelta = compareRoutingVariantScores(attemptScore, bestScore);

    return scoreDelta < 0
      ? attempt
      : best;
  }).routedEdges;
}

function routeEdgesWithAssignments(
  edges: DiagramEdge[],
  nodes: DiagramNode[],
  groups: DiagramGroup[],
  assignments: Map<string, EdgeRoutingAssignment>
): DiagramEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const nodeBounds = nodes.map((node) => requireLayout(node));
  const routedEdgesById = new Map<string, DiagramEdge>();
  const existingEdgePaths: EdgePath[] = [];
  const routingOrder = orderEdgesForRouting(edges, nodeById, groupById);

  for (const edge of routingOrder) {
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    const assignment = assignments.get(edge.id);

    if (!sourceNode || !targetNode || !assignment) {
      const cloned = cloneEdge(edge);
      routedEdgesById.set(edge.id, cloned);
      continue;
    }

    const sourceGroup = sourceNode.groupId ? groupById.get(sourceNode.groupId) : undefined;
    const targetGroup = targetNode.groupId ? groupById.get(targetNode.groupId) : undefined;
    const route = routeEdge(edge, sourceNode, targetNode, sourceGroup, targetGroup, nodes, nodeBounds, existingEdgePaths, assignment);
    const routedEdge: DiagramEdge = {
      ...edge,
      layout: {
        ...edge.layout,
        waypoints: route.waypoints,
        sourceAnchor: route.sourceAnchor,
        targetAnchor: route.targetAnchor
      }
    };

    routedEdgesById.set(edge.id, routedEdge);
    existingEdgePaths.push({ edge: routedEdge, points: route.points });
  }

  const routedEdges = edges.map((edge) => routedEdgesById.get(edge.id) ?? cloneEdge(edge));
  return improveRoutedEdges(routedEdges, nodes, groups, assignments, nodeBounds, routingOrder);
}

function improveRoutedEdges(
  routedEdges: DiagramEdge[],
  nodes: DiagramNode[],
  groups: DiagramGroup[],
  assignments: Map<string, EdgeRoutingAssignment>,
  nodeBounds: DiagramNodeLayout[],
  routingOrder: DiagramEdge[]
): DiagramEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const routedEdgesById = new Map(routedEdges.map((edge) => [edge.id, edge]));

  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;

    for (const orderedEdge of routingOrder) {
      const currentEdge = routedEdgesById.get(orderedEdge.id);
      const currentRoute = currentEdge ? routedCandidateFromEdge(currentEdge, nodes) : undefined;
      const assignment = assignments.get(orderedEdge.id);
      const sourceNode = currentEdge ? nodeById.get(currentEdge.sourceId) : undefined;
      const targetNode = currentEdge ? nodeById.get(currentEdge.targetId) : undefined;

      if (!currentEdge || !currentRoute || !assignment || !sourceNode || !targetNode) {
        continue;
      }

      const otherEdgePaths = [...routedEdgesById.values()]
        .filter((edge) => edge.id !== currentEdge.id)
        .map((edge) => ({
          edge,
          points: pathForEdge(edge, nodes, edge.layout?.waypoints ?? [])
        }));
      const sourceGroup = sourceNode.groupId ? groupById.get(sourceNode.groupId) : undefined;
      const targetGroup = targetNode.groupId ? groupById.get(targetNode.groupId) : undefined;
      const nextRoute = routeEdge(
        currentEdge,
        sourceNode,
        targetNode,
        sourceGroup,
        targetGroup,
        nodes,
        nodeBounds,
        otherEdgePaths,
        assignment
      );
      const currentScore = scoreRouteCandidate(currentEdge, currentRoute, nodes, otherEdgePaths);
      const nextScore = scoreRouteCandidate(currentEdge, nextRoute, nodes, otherEdgePaths);

      if (nextScore + epsilon < currentScore) {
        routedEdgesById.set(currentEdge.id, {
          ...currentEdge,
          layout: {
            ...currentEdge.layout,
            waypoints: nextRoute.waypoints,
            sourceAnchor: nextRoute.sourceAnchor,
            targetAnchor: nextRoute.targetAnchor
          }
        });
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return routedEdges.map((edge) => routedEdgesById.get(edge.id) ?? edge);
}

function routedCandidateFromEdge(edge: DiagramEdge, nodes: DiagramNode[]): RoutedEdgeCandidate | undefined {
  const sourceAnchor = edge.layout?.sourceAnchor;
  const targetAnchor = edge.layout?.targetAnchor;

  if (!sourceAnchor || !targetAnchor) {
    return undefined;
  }

  const waypoints = edge.layout?.waypoints?.map((point) => ({ ...point })) ?? [];

  return {
    sourceAnchor: { ...sourceAnchor },
    targetAnchor: { ...targetAnchor },
    waypoints,
    points: pathForEdge(edge, nodes, waypoints)
  };
}

function refineRoutedEdgeAnchors(
  routedEdges: DiagramEdge[],
  nodes: DiagramNode[],
  groups: DiagramGroup[]
): DiagramEdge[] {
  let currentEdges = routedEdges.map((edge) => cloneEdge(edge));
  let currentScore = scoreLayout(currentEdges, nodes, groups);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const nodeBounds = nodes.map((node) => requireLayout(node));

  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    const currentEdgeById = new Map(currentEdges.map((edge) => [edge.id, edge]));
    const routingOrder = orderEdgesForRouting(currentEdges, nodeById, groupById);

    for (const orderedEdge of routingOrder) {
      const currentEdge = currentEdgeById.get(orderedEdge.id);
      const sourceNode = currentEdge ? nodeById.get(currentEdge.sourceId) : undefined;
      const targetNode = currentEdge ? nodeById.get(currentEdge.targetId) : undefined;

      if (!currentEdge || !sourceNode || !targetNode || !currentEdge.layout?.sourceAnchor || !currentEdge.layout.targetAnchor) {
        continue;
      }

      const sourceGroup = sourceNode.groupId ? groupById.get(sourceNode.groupId) : undefined;
      const targetGroup = targetNode.groupId ? groupById.get(targetNode.groupId) : undefined;
      const candidates = refinedRouteCandidatesForEdge(currentEdge, sourceNode, targetNode, sourceGroup, targetGroup, nodeBounds);

      let bestEdge = currentEdge;
      let bestScore = currentScore;

      for (const candidate of candidates) {
        const candidateEdge: DiagramEdge = {
          ...currentEdge,
          layout: {
            ...currentEdge.layout,
            sourceAnchor: candidate.sourceAnchor,
            targetAnchor: candidate.targetAnchor,
            waypoints: candidate.waypoints
          }
        };
        const nextEdges = currentEdges.map((edge) => edge.id === candidateEdge.id ? candidateEdge : edge);
        const nextScore = scoreLayout(nextEdges, nodes, groups);

        if (compareScoresWithoutEdgeLength(nextScore, bestScore) < 0) {
          bestEdge = candidateEdge;
          bestScore = nextScore;
        }
      }

      if (bestEdge !== currentEdge) {
        currentEdges = currentEdges.map((edge) => edge.id === bestEdge.id ? bestEdge : edge);
        currentScore = bestScore;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return currentEdges;
}

function refinedRouteCandidatesForEdge(
  edge: DiagramEdge,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceGroup: DiagramGroup | undefined,
  targetGroup: DiagramGroup | undefined,
  nodeBounds: DiagramNodeLayout[]
): RoutedEdgeCandidate[] {
  const sourceLayout = requireLayout(sourceNode);
  const targetLayout = requireLayout(targetNode);
  const currentSourceAnchor = edge.layout?.sourceAnchor;
  const currentTargetAnchor = edge.layout?.targetAnchor;

  if (!currentSourceAnchor || !currentTargetAnchor) {
    return [];
  }

  const currentSourcePoint = anchorPoint(sourceLayout, currentSourceAnchor);
  const currentTargetPoint = anchorPoint(targetLayout, currentTargetAnchor);
  const sourceNeighbor = edge.layout?.waypoints?.[0] ?? currentTargetPoint;
  const targetNeighbor = edge.layout?.waypoints?.[edge.layout.waypoints.length - 1] ?? currentSourcePoint;
  const sourceAnchors = endpointRefinementAnchors(sourceLayout, targetLayout, currentSourceAnchor, sourceNeighbor);
  const targetAnchors = endpointRefinementAnchors(targetLayout, sourceLayout, currentTargetAnchor, targetNeighbor);

  return uniqueRoutes(sourceAnchors.flatMap((sourceAnchor) =>
    targetAnchors.flatMap((targetAnchor) =>
      routeCandidatesForAnchors(
        sourceLayout,
        targetLayout,
        sourceAnchor,
        targetAnchor,
        0,
        0,
        sourceGroup,
        targetGroup,
        nodeBounds
      )
    )
  ));
}

function endpointRefinementAnchors(
  layout: DiagramNodeLayout,
  otherLayout: DiagramNodeLayout,
  currentAnchor: DiagramEdgeAnchor,
  routeNeighbor: DiagramPoint
): DiagramEdgeAnchor[] {
  const center = centerOf(layout);
  const otherCenter = centerOf(otherLayout);
  const dx = otherCenter.x - center.x;
  const dy = otherCenter.y - center.y;
  const sides = uniqueAnchorSides([
    currentAnchor.side,
    Math.abs(dx) > epsilon ? (dx >= 0 ? "east" : "west") : undefined,
    Math.abs(dy) > epsilon ? (dy >= 0 ? "south" : "north") : undefined
  ]);
  const anchors: DiagramEdgeAnchor[] = [];

  for (const side of sides) {
    const ratios = uniqueRatios([
      side === currentAnchor.side ? currentAnchor.ratio : undefined,
      ratioForPointOnSide(layout, side, otherCenter),
      ratioForPointOnSide(layout, side, routeNeighbor)
    ]);

    for (const ratio of ratios) {
      anchors.push({ side, ratio });
    }
  }

  return uniqueAnchors(anchors);
}

function uniqueAnchorSides(sides: Array<DiagramEdgeAnchorSide | undefined>): DiagramEdgeAnchorSide[] {
  const unique: DiagramEdgeAnchorSide[] = [];
  const seen = new Set<DiagramEdgeAnchorSide>();

  for (const side of sides) {
    if (!side || seen.has(side)) {
      continue;
    }

    seen.add(side);
    unique.push(side);
  }

  return unique;
}

function uniqueRatios(ratios: Array<number | undefined>): number[] {
  const unique: number[] = [];
  const seen = new Set<string>();

  for (const ratio of ratios) {
    if (ratio === undefined || !Number.isFinite(ratio)) {
      continue;
    }

    const normalized = roundRatio(clamp(ratio, 0.05, 0.95));
    const key = formatScoreNumber(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function uniqueAnchors(anchors: DiagramEdgeAnchor[]): DiagramEdgeAnchor[] {
  const unique: DiagramEdgeAnchor[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    const key = `${anchor.side}:${formatScoreNumber(anchor.ratio)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(anchor);
  }

  return unique;
}

function ratioForPointOnSide(
  layout: DiagramNodeLayout,
  side: DiagramEdgeAnchorSide,
  point: DiagramPoint
): number {
  if (side === "north" || side === "south") {
    return (point.x - layout.x) / layout.width;
  }

  return (point.y - layout.y) / layout.height;
}

function orderEdgesForRouting(
  edges: DiagramEdge[],
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>
): DiagramEdge[] {
  return edges
    .map((edge, index) => ({
      edge,
      index,
      order: edgeRoutingOrder(edge, nodeById, groupById)
    }))
    .sort((left, right) =>
      left.order.priority - right.order.priority ||
      left.order.axis - right.order.axis ||
      left.order.lane - right.order.lane ||
      left.order.start - right.order.start ||
      left.order.end - right.order.end ||
      left.index - right.index
    )
    .map(({ edge }) => edge);
}

function edgeRoutingOrder(
  edge: DiagramEdge,
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>
): { priority: number; axis: number; lane: number; start: number; end: number } {
  const sourceGroup = groupForNodeId(edge.sourceId, nodeById, groupById);
  const targetGroup = groupForNodeId(edge.targetId, nodeById, groupById);
  const sourceIntent = sourceGroup?.layoutIntent;
  const targetIntent = targetGroup?.layoutIntent;

  if (!sourceIntent || !targetIntent) {
    return { priority: 1, axis: 2, lane: 0, start: 0, end: 0 };
  }

  const sameRow = sourceIntent.gridY === targetIntent.gridY;
  const sameColumn = sourceIntent.gridX === targetIntent.gridX;

  if (sameRow) {
    return {
      priority: 0,
      axis: 0,
      lane: sourceIntent.gridY,
      start: Math.min(sourceIntent.gridX, targetIntent.gridX),
      end: Math.max(sourceIntent.gridX, targetIntent.gridX)
    };
  }

  if (sameColumn) {
    return {
      priority: 0,
      axis: 1,
      lane: sourceIntent.gridX,
      start: Math.min(sourceIntent.gridY, targetIntent.gridY),
      end: Math.max(sourceIntent.gridY, targetIntent.gridY)
    };
  }

  return {
    priority: 1,
    axis: 2,
    lane: Math.min(sourceIntent.gridY, targetIntent.gridY),
    start: Math.min(sourceIntent.gridX, targetIntent.gridX),
    end: Math.max(sourceIntent.gridX, targetIntent.gridX)
  };
}

function groupForNodeId(
  nodeId: string,
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>
): DiagramGroup | undefined {
  const node = nodeById.get(nodeId);
  return node?.groupId ? groupById.get(node.groupId) : undefined;
}

function allocateEdgeRoutingAssignments(
  edges: DiagramEdge[],
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>
): Map<string, EdgeRoutingAssignment> {
  return allocateEdgeRoutingAssignmentVariants(edges, nodeById, groupById, defaultRoutingOptions())[0]?.assignments ?? new Map();
}

function allocateEdgeRoutingAssignmentVariants(
  edges: DiagramEdge[],
  nodeById: Map<string, DiagramNode>,
  groupById: Map<string, DiagramGroup>,
  routingOptions: ResolvedRoutingOptions
): AnchorAssignmentVariant[] {
  const endpointBuckets = new Map<string, EdgeEndpointReference[]>();

  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);

    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourceGroup = sourceNode.groupId ? groupById.get(sourceNode.groupId) : undefined;
    const targetGroup = targetNode.groupId ? groupById.get(targetNode.groupId) : undefined;

    addEndpointReference(endpointBuckets, {
      edge,
      role: "source",
      node: sourceNode,
      otherNode: targetNode,
      nodeGroup: sourceGroup,
      otherGroup: targetGroup,
      side: chooseEndpointSide("source", sourceNode, targetNode, sourceGroup, targetGroup)
    });
    addEndpointReference(endpointBuckets, {
      edge,
      role: "target",
      node: targetNode,
      otherNode: sourceNode,
      nodeGroup: targetGroup,
      otherGroup: sourceGroup,
      side: chooseEndpointSide("target", targetNode, sourceNode, targetGroup, sourceGroup)
    });
  }

  // AUTODIAGRAM CHANGE: map manual order theo bucket nodeId:side, ví dụ "manager:east".
  const manualOrderByBucket = new Map(
    routingOptions.anchorOrders.map((order) => [anchorOrderIntentKey(order.nodeId, order.side), order.edgeOrder])
  );
  const orderPlans = createAnchorOrderPlans(endpointBuckets, manualOrderByBucket, routingOptions);

  return orderPlans.map((plan) => materializeAnchorAssignmentVariant(plan, edges));
}

function createAnchorOrderPlans(
  endpointBuckets: Map<string, EdgeEndpointReference[]>,
  manualOrderByBucket: Map<string, string[]>,
  routingOptions: ResolvedRoutingOptions
): AnchorOrderPlan[] {
  const globalPlans = anchorOrderVariantIds(routingOptions).map((variantId): AnchorOrderPlan => ({
    id: `anchor-${variantId}`,
    ordersByBucket: new Map([...endpointBuckets].map(([bucketKey, endpoints]) => [
      bucketKey,
      orderEndpointBucketVariant(endpoints, variantId, manualOrderByBucket.get(bucketKey))
    ]))
  }));

  if (routingOptions.anchorOrderMode === "manual") {
    return uniqueAnchorOrderPlans(globalPlans).slice(0, routingOptions.anchorOrderVariantLimit);
  }

  const localPlans = createLocalAnchorOrderPlans(endpointBuckets, manualOrderByBucket, routingOptions);
  const baselinePlan = globalPlans[0];
  const remainingGlobalPlans = globalPlans.slice(1);
  return uniqueAnchorOrderPlans([
    ...(baselinePlan ? [baselinePlan] : []),
    ...localPlans,
    ...remainingGlobalPlans
  ]).slice(0, routingOptions.anchorOrderVariantLimit);
}

function createLocalAnchorOrderPlans(
  endpointBuckets: Map<string, EdgeEndpointReference[]>,
  manualOrderByBucket: Map<string, string[]>,
  routingOptions: ResolvedRoutingOptions
): AnchorOrderPlan[] {
  const baselineOrders = new Map([...endpointBuckets].map(([bucketKey, endpoints]) => [
    bucketKey,
    orderEndpointBucketVariant(endpoints, "geometric", manualOrderByBucket.get(bucketKey))
  ]));
  const bucketOptions = [...endpointBuckets]
    .map(([bucketKey, endpoints]) => ({
      bucketKey,
      options: endpointBucketOrderVariants(endpoints, manualOrderByBucket.get(bucketKey), routingOptions)
    }))
    .filter(({ options }) => options.length > 1)
    .sort((left, right) =>
      right.options[0].endpoints.length - left.options[0].endpoints.length ||
      left.bucketKey.localeCompare(right.bucketKey)
    );
  const plans: AnchorOrderPlan[] = [];
  const maxPlans = Math.max(1, routingOptions.anchorOrderVariantLimit);
  let frontier: AnchorOrderPlan[] = [{
    id: "anchor-local-geometric",
    ordersByBucket: baselineOrders
  }];

  for (const { bucketKey, options } of bucketOptions) {
    const nextPlans: AnchorOrderPlan[] = [];

    for (const plan of frontier) {
      const currentOrder = plan.ordersByBucket.get(bucketKey);

      for (const option of options) {
        if (currentOrder && sameEndpointOrder(currentOrder, option.endpoints)) {
          continue;
        }

        const ordersByBucket = cloneBucketOrders(plan.ordersByBucket);
        ordersByBucket.set(bucketKey, option.endpoints);
        nextPlans.push({
          id: `${plan.id}-${safePlanId(bucketKey)}-${option.id}`,
          ordersByBucket
        });
      }
    }

    plans.push(...nextPlans);
    frontier = uniqueAnchorOrderPlans([...frontier, ...nextPlans]).slice(0, maxPlans);

    if (uniqueAnchorOrderPlans(plans).length >= maxPlans) {
      break;
    }
  }

  return uniqueAnchorOrderPlans(plans).slice(0, maxPlans);
}

function endpointBucketOrderVariants(
  endpoints: EdgeEndpointReference[],
  manualEdgeOrder: string[] | undefined,
  routingOptions: ResolvedRoutingOptions
): EndpointBucketOrderVariant[] {
  const baseVariants = baseAnchorOrderVariantIds(routingOptions)
    .map((variantId) => ({
      id: variantId,
      endpoints: orderEndpointBucketVariant(endpoints, variantId, manualEdgeOrder)
    }));
  const variants: EndpointBucketOrderVariant[] = [];
  const baselineVariant = baseVariants[0];

  if (baselineVariant) {
    variants.push(baselineVariant);
  }

  if (routingOptions.anchorOrderMode !== "manual" && endpoints.length >= 2 && baselineVariant) {
    variants.push(...baseVariants.slice(1));
    variants.push(...baseVariants.flatMap((variant) =>
      adjacentEndpointSwapOrderVariants(variant.endpoints, `${variant.id}-adjacent`)
    ));
    variants.push(...singleEndpointMoveOrderVariants(baselineVariant.endpoints, "move"));

    if (endpoints.length <= exactEndpointBucketPermutationLimit) {
      variants.push(...rankedEndpointPermutationVariants(endpoints, baseVariants));
    }
  } else {
    variants.push(...baseVariants.slice(1));
  }

  const unique = new Map<string, EndpointBucketOrderVariant>();

  for (const variant of variants) {
    unique.set(endpointOrderSignature(variant.endpoints), variant);
  }

  return [...unique.values()];
}

function adjacentEndpointSwapOrderVariants(
  endpoints: EdgeEndpointReference[],
  idPrefix: string
): EndpointBucketOrderVariant[] {
  const variants: EndpointBucketOrderVariant[] = [];

  for (let index = 0; index < endpoints.length - 1; index += 1) {
    const candidate = [...endpoints];
    [candidate[index], candidate[index + 1]] = [candidate[index + 1], candidate[index]];
    variants.push({
      id: `${idPrefix}-${index + 1}-${index + 2}`,
      endpoints: candidate
    });
  }

  return variants;
}

function singleEndpointMoveOrderVariants(
  endpoints: EdgeEndpointReference[],
  idPrefix: string
): EndpointBucketOrderVariant[] {
  const variants: Array<EndpointBucketOrderVariant & { displacement: number; fromIndex: number; toIndex: number }> = [];

  for (let fromIndex = 0; fromIndex < endpoints.length; fromIndex += 1) {
    for (let toIndex = 0; toIndex < endpoints.length; toIndex += 1) {
      if (fromIndex === toIndex) {
        continue;
      }

      const candidate = [...endpoints];
      const [moved] = candidate.splice(fromIndex, 1);
      candidate.splice(toIndex, 0, moved);
      variants.push({
        id: `${idPrefix}-${fromIndex + 1}-${toIndex + 1}`,
        endpoints: candidate,
        displacement: Math.abs(toIndex - fromIndex),
        fromIndex,
        toIndex
      });
    }
  }

  return variants
    .sort((left, right) =>
      right.displacement - left.displacement ||
      left.fromIndex - right.fromIndex ||
      left.toIndex - right.toIndex
    )
    .map(({ id, endpoints }) => ({ id, endpoints }));
}

function rankedEndpointPermutationVariants(
  endpoints: EdgeEndpointReference[],
  referenceVariants: EndpointBucketOrderVariant[]
): EndpointBucketOrderVariant[] {
  const referenceOrders = referenceVariants.map((variant) => variant.endpoints);

  return permutations(sortEndpointBucket(endpoints))
    .map((candidate, index) => ({
      id: `perm-${index + 1}`,
      endpoints: candidate,
      distance: endpointOrderDistance(candidate, referenceOrders),
      signature: endpointOrderSignature(candidate)
    }))
    .sort((left, right) =>
      left.distance - right.distance ||
      left.signature.localeCompare(right.signature)
    )
    .map(({ id, endpoints }) => ({ id, endpoints }));
}

function endpointOrderDistance(
  candidate: EdgeEndpointReference[],
  referenceOrders: EdgeEndpointReference[][]
): number {
  return Math.min(...referenceOrders.map((referenceOrder) => endpointOrderDisplacement(candidate, referenceOrder)));
}

function endpointOrderDisplacement(
  candidate: EdgeEndpointReference[],
  referenceOrder: EdgeEndpointReference[]
): number {
  const indexByEndpoint = new Map(referenceOrder.map((endpoint, index) => [endpointReferenceKey(endpoint), index]));
  return candidate.reduce((total, endpoint, index) =>
    total + Math.abs(index - (indexByEndpoint.get(endpointReferenceKey(endpoint)) ?? index)),
  0);
}

function materializeAnchorAssignmentVariant(
  plan: AnchorOrderPlan,
  edges: DiagramEdge[]
): AnchorAssignmentVariant {
  const endpointAssignments = new Map<string, EdgeEndpointAssignment>();

  for (const orderedEndpoints of plan.ordersByBucket.values()) {
    const ratios = anchorRatiosForCount(orderedEndpoints.length);

    orderedEndpoints.forEach((endpoint, index) => {
      endpointAssignments.set(endpointAssignmentKey(endpoint.edge.id, endpoint.role), {
        anchor: {
          side: endpoint.side,
          ratio: ratios[index]
        },
        laneIndex: index
      });
    });
  }

  const assignments = new Map<string, EdgeRoutingAssignment>();

  for (const edge of edges) {
    const source = endpointAssignments.get(endpointAssignmentKey(edge.id, "source"));
    const target = endpointAssignments.get(endpointAssignmentKey(edge.id, "target"));

    if (source && target) {
      assignments.set(edge.id, { source, target });
    }
  }

  return {
    id: plan.id,
    assignments
  };
}

function cloneBucketOrders(ordersByBucket: Map<string, EdgeEndpointReference[]>): Map<string, EdgeEndpointReference[]> {
  return new Map([...ordersByBucket].map(([bucketKey, endpoints]) => [bucketKey, [...endpoints]]));
}

function uniqueAnchorOrderPlans(plans: AnchorOrderPlan[]): AnchorOrderPlan[] {
  const unique: AnchorOrderPlan[] = [];
  const seen = new Set<string>();

  for (const plan of plans) {
    const signature = [...plan.ordersByBucket]
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([bucketKey, endpoints]) => `${bucketKey}:${endpointOrderSignature(endpoints)}`)
      .join("|");

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(plan);
  }

  return unique;
}

function endpointOrderSignature(endpoints: EdgeEndpointReference[]): string {
  return endpoints.map((endpoint) => endpointReferenceKey(endpoint)).join(",");
}

function endpointReferenceKey(endpoint: EdgeEndpointReference): string {
  return `${endpoint.edge.id}:${endpoint.role}`;
}

function sameEndpointOrder(left: EdgeEndpointReference[], right: EdgeEndpointReference[]): boolean {
  return left.length === right.length && left.every((endpoint, index) =>
    endpoint.edge.id === right[index].edge.id && endpoint.role === right[index].role
  );
}

/**
 * AUTODIAGRAM CHANGE - Default routing options
 * Giữ behavior mặc định là auto, nhưng không khóa vào một thứ tự bucket duy nhất.
 * Router thử tối đa anchorOrderVariantLimit biến thể để tránh bùng nổ tổ hợp.
 */
function defaultRoutingOptions(): ResolvedRoutingOptions {
  return {
    anchorOrders: [],
    anchorOrderMode: "auto",
    anchorOrderVariantLimit: 8
  };
}

// AUTODIAGRAM CHANGE: validate/normalize routing options trước khi route.
function resolveRoutingOptions(options: ApplyStereotypeGridLayoutOptions, lockedGroupPlacement = false): ResolvedRoutingOptions {
  const defaultOptions = defaultRoutingOptions();
  return {
    anchorOrders: options.anchorOrders?.map((order) => ({
      nodeId: order.nodeId,
      side: requireAnchorSide(order.side, `anchor order ${order.nodeId}.side`),
      edgeOrder: order.edgeOrder.map((edgeId, index) => requireString(edgeId, `anchor order ${order.nodeId}.${order.side}.edgeOrder[${index}]`))
    })) ?? defaultOptions.anchorOrders,
    anchorOrderMode: requireAnchorOrderMode(options.anchorOrderMode ?? defaultOptions.anchorOrderMode, "anchorOrderMode"),
    anchorOrderVariantLimit: requirePositiveInteger(
      options.anchorOrderVariantLimit ?? (lockedGroupPlacement ? lockedGroupAnchorOrderVariantLimit : defaultOptions.anchorOrderVariantLimit),
      "anchorOrderVariantLimit"
    )
  };
}

function anchorOrderIntentKey(nodeId: string, side: DiagramEdgeAnchorSide): string {
  return `${nodeId}:${side}`;
}

/**
 * AUTODIAGRAM CHANGE - Anchor order variants
 * Chọn danh sách chiến lược sắp xếp anchor cần thử.
 * Không brute-force permutation toàn bộ vì diagram dày có thể nổ tổ hợp.
 */
function anchorOrderVariantIds(options: ResolvedRoutingOptions): string[] {
  return baseAnchorOrderVariantIds(options).slice(0, options.anchorOrderVariantLimit);
}

function baseAnchorOrderVariantIds(options: ResolvedRoutingOptions): string[] {
  const autoVariantIds = ["geometric", "reverse", "other-x", "other-y", "other-grid", "fanout-split", "edge-id"];

  if (options.anchorOrderMode === "manual") {
    return ["manual"];
  }

  if (options.anchorOrderMode === "autoWithManual" && options.anchorOrders.length > 0) {
    return uniqueStrings([
      "manual",
      ...autoVariantIds.map((variantId) => `manual-${variantId}`),
      ...autoVariantIds
    ]);
  }

  return autoVariantIds;
}

/**
 * AUTODIAGRAM CHANGE - Endpoint bucket ordering
 * Sinh một thứ tự cụ thể cho bucket nodeId+side.
 * Đây là heuristic có kiểm soát, không phải full permutation, để vẫn chạy nhanh.
 */
function orderEndpointBucketVariant(
  endpoints: EdgeEndpointReference[],
  variantId: string,
  manualEdgeOrder: string[] | undefined
): EdgeEndpointReference[] {
  if ((variantId === "manual" || variantId.startsWith("manual-")) && manualEdgeOrder?.length) {
    const manualOrdered = applyManualAnchorOrder(endpoints, manualEdgeOrder);
    if (variantId === "manual") {
      return manualOrdered;
    }

    const selectedIds = new Set(manualEdgeOrder);
    const selected = manualOrdered.filter((endpoint) => selectedIds.has(endpoint.edge.id));
    const remaining = endpoints.filter((endpoint) => !selectedIds.has(endpoint.edge.id));
    return [...selected, ...orderEndpointBucketVariant(remaining, variantId.replace(/^manual-/, ""), undefined)];
  }

  if (variantId === "reverse") {
    return [...sortEndpointBucket(endpoints)].reverse();
  }

  if (variantId === "other-x") {
    return [...endpoints].sort((left, right) =>
      centerOf(requireLayout(left.otherNode)).x - centerOf(requireLayout(right.otherNode)).x ||
      endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
  }

  if (variantId === "other-y") {
    return [...endpoints].sort((left, right) =>
      centerOf(requireLayout(left.otherNode)).y - centerOf(requireLayout(right.otherNode)).y ||
      endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
  }

  if (variantId === "other-grid") {
    return [...endpoints].sort((left, right) =>
      groupGridSortValue(left.otherGroup) - groupGridSortValue(right.otherGroup) ||
      endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
  }

  if (variantId === "edge-id") {
    return [...endpoints].sort((left, right) =>
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    );
  }

  if (variantId === "fanout-split") {
    return orderFanoutSplitEndpointBucket(endpoints);
  }

  return sortEndpointBucket(endpoints);
}

function orderFanoutSplitEndpointBucket(endpoints: EdgeEndpointReference[]): EdgeEndpointReference[] {
  if (
    endpoints.length < 2 ||
    !endpoints.every((endpoint) => endpoint.role === endpoints[0].role && endpoint.side === endpoints[0].side)
  ) {
    return sortEndpointBucket(endpoints);
  }

  const side = endpoints[0].side;
  const useHorizontalAxis = side === "north" || side === "south";
  const nodeCenter = centerOf(requireLayout(endpoints[0].node));
  const before: EdgeEndpointReference[] = [];
  const centered: EdgeEndpointReference[] = [];
  const after: EdgeEndpointReference[] = [];

  for (const endpoint of endpoints) {
    const otherCenter = centerOf(requireLayout(endpoint.otherNode));
    const delta = useHorizontalAxis ? otherCenter.x - nodeCenter.x : otherCenter.y - nodeCenter.y;

    if (delta < 0) {
      before.push(endpoint);
    } else if (delta > 0) {
      after.push(endpoint);
    } else {
      centered.push(endpoint);
    }
  }

  const byDistanceThenPosition = (left: EdgeEndpointReference, right: EdgeEndpointReference): number => {
    const leftOtherCenter = centerOf(requireLayout(left.otherNode));
    const rightOtherCenter = centerOf(requireLayout(right.otherNode));
    const leftDelta = useHorizontalAxis ? leftOtherCenter.x - nodeCenter.x : leftOtherCenter.y - nodeCenter.y;
    const rightDelta = useHorizontalAxis ? rightOtherCenter.x - nodeCenter.x : rightOtherCenter.y - nodeCenter.y;

    return Math.abs(leftDelta) - Math.abs(rightDelta) ||
      endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role);
  };

  return [
    ...before.sort(byDistanceThenPosition),
    ...centered.sort((left, right) =>
      endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
      left.edge.id.localeCompare(right.edge.id) ||
      left.role.localeCompare(right.role)
    ),
    ...after.sort(byDistanceThenPosition)
  ];
}

/**
 * AUTODIAGRAM CHANGE - Partial manual order
 * Giữ edge người dùng chỉ định ở đầu theo đúng thứ tự manual.
 * Các edge không được chỉ định sẽ append sau bằng geometric order cũ để không breaking.
 */
function applyManualAnchorOrder(endpoints: EdgeEndpointReference[], manualEdgeOrder: string[]): EdgeEndpointReference[] {
  const endpointsByEdgeId = new Map(endpoints.map((endpoint) => [endpoint.edge.id, endpoint]));
  const selected = manualEdgeOrder
    .map((edgeId) => endpointsByEdgeId.get(edgeId))
    .filter((endpoint): endpoint is EdgeEndpointReference => Boolean(endpoint));
  const selectedIds = new Set(selected.map((endpoint) => endpoint.edge.id));
  const remaining = sortEndpointBucket(endpoints.filter((endpoint) => !selectedIds.has(endpoint.edge.id)));

  return [...selected, ...remaining];
}

function groupGridSortValue(group: DiagramGroup | undefined): number {
  const intent = group?.layoutIntent;

  if (!intent) {
    return Number.MAX_SAFE_INTEGER;
  }

  return intent.gridY * 1000 + intent.gridX;
}

function uniqueStrings(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function addEndpointReference(
  endpointBuckets: Map<string, EdgeEndpointReference[]>,
  endpoint: EdgeEndpointReference
): void {
  const key = `${endpoint.node.id}:${endpoint.side}`;
  const bucket = endpointBuckets.get(key) ?? [];
  bucket.push(endpoint);
  endpointBuckets.set(key, bucket);
}

function chooseEndpointSide(
  role: EdgeEndpointRole,
  node: DiagramNode,
  otherNode: DiagramNode,
  nodeGroup: DiagramGroup | undefined,
  otherGroup: DiagramGroup | undefined
): DiagramEdgeAnchorSide {
  const nodeIntent = nodeGroup?.layoutIntent;
  const otherIntent = otherGroup?.layoutIntent;

  if (role === "source" && nodeIntent && otherIntent && nodeGroup?.id !== otherGroup?.id) {
    if (otherIntent.gridY > nodeIntent.gridY) {
      return "south";
    }

    if (otherIntent.gridY < nodeIntent.gridY) {
      return "north";
    }
  }

  if (role === "target" && nodeIntent && otherIntent && nodeGroup?.id !== otherGroup?.id) {
    if (otherIntent.gridY < nodeIntent.gridY) {
      if (otherIntent.gridX > nodeIntent.gridX) {
        return "east";
      }

      if (otherIntent.gridX < nodeIntent.gridX) {
        return "west";
      }

      return "north";
    }

    if (otherIntent.gridY > nodeIntent.gridY) {
      if (otherIntent.gridX > nodeIntent.gridX) {
        return "east";
      }

      if (otherIntent.gridX < nodeIntent.gridX) {
        return "west";
      }

      return "south";
    }
  }

  return sideToward(centerOf(requireLayout(node)), centerOf(requireLayout(otherNode)));
}

function sortEndpointBucket(endpoints: EdgeEndpointReference[]): EdgeEndpointReference[] {
  return [...endpoints].sort((left, right) =>
    endpointBucketSortCoordinate(left, endpoints) - endpointBucketSortCoordinate(right, endpoints) ||
    endpointSortCoordinate(left) - endpointSortCoordinate(right) ||
    left.edge.id.localeCompare(right.edge.id) ||
    left.role.localeCompare(right.role)
  );
}

function endpointBucketSortCoordinate(endpoint: EdgeEndpointReference, bucket: EdgeEndpointReference[]): number {
  if (
    endpoint.role !== "source" ||
    (endpoint.side !== "north" && endpoint.side !== "south") ||
    !bucket.every((candidate) => candidate.role === "source" && candidate.side === endpoint.side)
  ) {
    return 0;
  }

  const nodeCenter = centerOf(requireLayout(endpoint.node));
  const otherCenters = bucket.map((candidate) => centerOf(requireLayout(candidate.otherNode)));
  const sameVerticalDirection = endpoint.side === "south"
    ? otherCenters.every((center) => center.y > nodeCenter.y)
    : otherCenters.every((center) => center.y < nodeCenter.y);
  const horizontalDirections = otherCenters
    .map((center) => Math.sign(center.x - nodeCenter.x))
    .filter((direction) => direction !== 0);
  const sameHorizontalDirection = horizontalDirections.length === bucket.length &&
    new Set(horizontalDirections).size === 1;

  if (!sameVerticalDirection || !sameHorizontalDirection) {
    return 0;
  }

  const otherCenter = centerOf(requireLayout(endpoint.otherNode));
  return Math.abs(otherCenter.x - nodeCenter.x);
}

function endpointSortCoordinate(endpoint: EdgeEndpointReference): number {
  const otherCenter = centerOf(requireLayout(endpoint.otherNode));

  return endpoint.side === "north" || endpoint.side === "south" ? otherCenter.x : otherCenter.y;
}

function anchorRatiosForCount(count: number): number[] {
  return Array.from({ length: count }, (_, index) => roundRatio((index + 1) / (count + 1)));
}

function endpointAssignmentKey(edgeId: string, role: EdgeEndpointRole): string {
  return `${edgeId}:${role}`;
}

function routeEdge(
  edge: DiagramEdge,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceGroup: DiagramGroup | undefined,
  targetGroup: DiagramGroup | undefined,
  nodes: DiagramNode[],
  nodeBounds: DiagramNodeLayout[],
  existingEdgePaths: EdgePath[],
  assignment: EdgeRoutingAssignment
): RoutedEdgeCandidate {
  const sourceLayout = requireLayout(sourceNode);
  const targetLayout = requireLayout(targetNode);
  const candidates = routeCandidatesForAnchors(
    sourceLayout,
    targetLayout,
    assignment.source.anchor,
    assignment.target.anchor,
    assignment.source.laneIndex,
    assignment.target.laneIndex,
    sourceGroup,
    targetGroup,
    nodeBounds
  );

  if (candidates.length === 0) {
    throw new Error(`No route candidates were generated for edge ${edge.id}.`);
  }

  const cleanCandidates = candidates.filter((candidate) =>
    routeAvoidsExistingPaths(edge, candidate, nodes, existingEdgePaths)
  );
  const selectableCandidates = cleanCandidates.length > 0 ? cleanCandidates : candidates;

  return selectableCandidates.reduce((best, candidate) => {
    const currentScore = scoreRouteCandidate(edge, candidate, nodes, existingEdgePaths);
    const bestScore = scoreRouteCandidate(edge, best, nodes, existingEdgePaths);
    return currentScore < bestScore ? candidate : best;
  });
}

function routeCandidatesForAnchors(
  sourceLayout: DiagramNodeLayout,
  targetLayout: DiagramNodeLayout,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  sourceLaneIndex: number,
  targetLaneIndex: number,
  sourceGroup: DiagramGroup | undefined,
  targetGroup: DiagramGroup | undefined,
  nodeBounds: DiagramNodeLayout[]
): RoutedEdgeCandidate[] {
  const sourcePoint = anchorPoint(sourceLayout, sourceAnchor);
  const targetPoint = anchorPoint(targetLayout, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor, sourceLaneIndex);
  const targetPort = outsidePort(targetPoint, targetAnchor, targetLaneIndex);
  const sourceGutterBounds = sourceGroup && targetGroup && sourceGroup.id !== targetGroup.id
    ? requireGroupLayout(sourceGroup)
    : sourceLayout;
  const targetGutterBounds = sourceGroup && targetGroup && sourceGroup.id !== targetGroup.id
    ? requireGroupLayout(targetGroup)
    : targetLayout;
  const verticalGutterX = midpointBetweenHorizontalBounds(sourceGutterBounds, targetGutterBounds) +
    laneOffsetForSide(sourceAnchor.side, sourceLaneIndex).x;
  const horizontalGutterY = midpointBetweenVerticalBounds(sourceGutterBounds, targetGutterBounds) +
    laneOffsetForSide(sourceAnchor.side, sourceLaneIndex).y;
  const exteriorLanes = exteriorRoutingLanes(nodeBounds, Math.max(sourceLaneIndex, targetLaneIndex));
  const localUnderRowLane = localUnderRowRoutingLane(
    sourceLayout,
    targetLayout,
    sourcePort,
    targetPort,
    nodeBounds,
    Math.max(sourceLaneIndex, targetLaneIndex)
  );
  const targetApproachLane = targetRowApproachLane(sourceLayout, targetLayout, targetAnchor);
  const waypointSets: DiagramPoint[][] = [
    sourceAnchor.side === "north" || sourceAnchor.side === "south"
      ? [
        sourcePort,
        { x: targetPort.x, y: sourcePort.y },
        targetPort
      ]
      : [
        sourcePort,
        { x: sourcePort.x, y: targetPort.y },
        targetPort
      ],
    [
      sourcePort,
      { x: verticalGutterX, y: sourcePort.y },
      { x: verticalGutterX, y: targetPort.y },
      targetPort
    ],
    [
      sourcePort,
      { x: sourcePort.x, y: horizontalGutterY },
      { x: targetPort.x, y: horizontalGutterY },
      targetPort
    ],
    ...(targetApproachLane === undefined
      ? []
      : [[
        sourcePort,
        { x: sourcePort.x, y: targetApproachLane },
        { x: targetPort.x, y: targetApproachLane },
        targetPort
      ]]),
    [
      sourcePort,
      { x: exteriorLanes.left, y: sourcePort.y },
      { x: exteriorLanes.left, y: targetPort.y },
      targetPort
    ],
    [
      sourcePort,
      { x: exteriorLanes.right, y: sourcePort.y },
      { x: exteriorLanes.right, y: targetPort.y },
      targetPort
    ],
    [
      sourcePort,
      { x: sourcePort.x, y: exteriorLanes.top },
      { x: targetPort.x, y: exteriorLanes.top },
      targetPort
    ],
    [
      sourcePort,
      { x: sourcePort.x, y: exteriorLanes.bottom },
      { x: targetPort.x, y: exteriorLanes.bottom },
      targetPort
    ],
    ...(localUnderRowLane === undefined
      ? []
      : [[
        sourcePort,
        { x: sourcePort.x, y: localUnderRowLane },
        { x: targetPort.x, y: localUnderRowLane },
        targetPort
      ]])
  ];

  return uniqueRoutes(
    waypointSets.map((waypoints) => buildRouteCandidate(sourcePoint, targetPoint, sourceAnchor, targetAnchor, waypoints, nodeBounds))
  );
}

function targetRowApproachLane(
  sourceLayout: DiagramNodeLayout,
  targetLayout: DiagramNodeLayout,
  targetAnchor: DiagramEdgeAnchor
): number | undefined {
  const sourceCenter = centerOf(sourceLayout);
  const targetCenter = centerOf(targetLayout);

  if (targetAnchor.side === "north" && sourceCenter.y < targetCenter.y) {
    return targetLayout.y - waypointMargin;
  }

  if (targetAnchor.side === "south" && sourceCenter.y > targetCenter.y) {
    return targetLayout.y + targetLayout.height + waypointMargin;
  }

  return undefined;
}

function localUnderRowRoutingLane(
  sourceLayout: DiagramNodeLayout,
  targetLayout: DiagramNodeLayout,
  sourcePort: DiagramPoint,
  targetPort: DiagramPoint,
  nodeBounds: DiagramNodeLayout[],
  laneIndex: number
): number | undefined {
  const sourceCenter = centerOf(sourceLayout);
  const targetCenter = centerOf(targetLayout);

  if (targetCenter.y <= sourceCenter.y) {
    return undefined;
  }

  const minX = Math.min(sourcePort.x, targetPort.x) - waypointMargin;
  const maxX = Math.max(sourcePort.x, targetPort.x) + waypointMargin;
  const rowObstacles = nodeBounds.filter((bounds) =>
    !sameRectangle(bounds, sourceLayout) &&
    !sameRectangle(bounds, targetLayout) &&
    rectangleIntersectsHorizontalRange(bounds, minX, maxX) &&
    centerOf(bounds).y > sourceCenter.y
  );

  if (rowObstacles.length === 0) {
    return undefined;
  }

  const obstacleBottom = Math.max(...rowObstacles.map((bounds) => bounds.y + bounds.height));
  const lane = obstacleBottom + waypointMargin + laneIndex * anchorStubDistance;

  return lane > sourcePort.y ? lane : undefined;
}

function exteriorRoutingLanes(
  nodeBounds: DiagramNodeLayout[],
  laneIndex: number
): { left: number; right: number; top: number; bottom: number } {
  const minX = Math.min(...nodeBounds.map((bounds) => bounds.x));
  const minY = Math.min(...nodeBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...nodeBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...nodeBounds.map((bounds) => bounds.y + bounds.height));
  const distance = Math.max(nodeGapX, nodeGapY) + laneIndex * anchorStubDistance;

  return {
    left: minX - distance,
    right: maxX + distance,
    top: minY - distance,
    bottom: maxY + distance
  };
}

function buildRouteCandidate(
  sourcePoint: DiagramPoint,
  targetPoint: DiagramPoint,
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor,
  waypoints: DiagramPoint[],
  nodeBounds: DiagramNodeLayout[]
): RoutedEdgeCandidate {
  const movedWaypoints = waypoints.map((waypoint) => moveWaypointOutsideNodes(waypoint, nodeBounds));
  const cleanedPoints = normalizeRoutePointsForAnchors(
    [sourcePoint, ...movedWaypoints, targetPoint],
    sourceAnchor,
    targetAnchor
  );

  return {
    sourceAnchor,
    targetAnchor,
    waypoints: cleanedPoints.slice(1, -1),
    points: cleanedPoints
  };
}

function scoreRouteCandidate(
  edge: DiagramEdge,
  candidate: RoutedEdgeCandidate,
  nodes: DiagramNode[],
  existingEdgePaths: EdgePath[]
): number {
  const candidatePath = { edge, points: candidate.points };
  const newSegmentOverlaps = countSegmentOverlapsWithExisting(candidatePath, existingEdgePaths);
  const newCrossings = countEdgeCrossingsWithExisting(candidatePath, existingEdgePaths);

  return (
    countEdgeNodeHits([candidatePath], nodes) * scoreWeights.edgeNodeHits +
    newCrossings * scoreWeights.edgeCrossings +
    newSegmentOverlaps * scoreWeights.segmentOverlaps +
    countBends(candidate.points) * scoreWeights.edgeBends +
    pathLength(candidate.points) * scoreWeights.edgeLength
  );
}

function routeAvoidsExistingPaths(
  edge: DiagramEdge,
  candidate: RoutedEdgeCandidate,
  nodes: DiagramNode[],
  existingEdgePaths: EdgePath[]
): boolean {
  const candidatePath = { edge, points: candidate.points };

  return (
    countEdgeNodeHits([candidatePath], nodes) === 0 &&
    countSegmentOverlapsWithExisting(candidatePath, existingEdgePaths) === 0 &&
    countEdgeCrossingsWithExisting(candidatePath, existingEdgePaths) === 0
  );
}

function countSegmentOverlapsWithExisting(candidatePath: EdgePath, existingEdgePaths: EdgePath[]): number {
  const candidateSegments = pathSegments(candidatePath.points);
  let overlaps = 0;

  for (const existingPath of existingEdgePaths) {
    for (const [candidateStart, candidateEnd] of candidateSegments) {
      for (const [existingStart, existingEnd] of pathSegments(existingPath.points)) {
        if (segmentsOverlap(candidateStart, candidateEnd, existingStart, existingEnd)) {
          overlaps += 1;
        }
      }
    }
  }

  return overlaps;
}

function countEdgeCrossingsWithExisting(candidatePath: EdgePath, existingEdgePaths: EdgePath[]): number {
  const candidateSegments = pathSegments(candidatePath.points);
  let crossings = 0;

  for (const existingPath of existingEdgePaths) {
    for (const [candidateStart, candidateEnd] of candidateSegments) {
      for (const [existingStart, existingEnd] of pathSegments(existingPath.points)) {
        if (
          !segmentsOverlap(candidateStart, candidateEnd, existingStart, existingEnd) &&
          segmentsIntersect(candidateStart, candidateEnd, existingStart, existingEnd) &&
          !pointsEqual(candidateStart, existingStart) &&
          !pointsEqual(candidateStart, existingEnd) &&
          !pointsEqual(candidateEnd, existingStart) &&
          !pointsEqual(candidateEnd, existingEnd)
        ) {
          crossings += 1;
        }
      }
    }
  }

  return crossings;
}

function cloneEdge(edge: DiagramEdge): DiagramEdge {
  return edge.layout
    ? {
      ...edge,
      layout: {
        ...edge.layout,
        waypoints: edge.layout.waypoints ? edge.layout.waypoints.map((point) => ({ ...point })) : undefined,
        sourceAnchor: edge.layout.sourceAnchor ? { ...edge.layout.sourceAnchor } : undefined,
        targetAnchor: edge.layout.targetAnchor ? { ...edge.layout.targetAnchor } : undefined
      }
    }
    : { ...edge };
}

function scoreLayout(edges: DiagramEdge[], nodes: DiagramNode[], groups: DiagramGroup[]): DiagramLayoutScore {
  const edgePaths = edges.map((edge) => ({
    edge,
    points: pathForEdge(edge, nodes, edge.layout?.waypoints ?? [])
  }));
  const nodeOverlaps = countNodeOverlaps(nodes);
  const groupOverlaps = countGroupOverlaps(groups);
  const edgeNodeHits = countEdgeNodeHits(edgePaths, nodes);
  const segmentOverlaps = countSegmentOverlaps(edgePaths);
  const edgeCrossings = countEdgeCrossings(edgePaths);
  const edgeBends = edgePaths.reduce((sum, edgePath) => sum + countBends(edgePath.points), 0);
  const duplicateAnchors = countDuplicateAnchors(edgePaths);
  const totalEdgeLength = edgePaths.reduce((sum, edgePath) => sum + pathLength(edgePath.points), 0);
  const bounds = layoutBounds(nodes, groups);
  const compactness =
    bounds.width * scoreWeights.compactWidth +
    bounds.height * scoreWeights.compactHeight +
    bounds.area * scoreWeights.compactArea;
  const value =
    edgeNodeHits * scoreWeights.edgeNodeHits +
    nodeOverlaps * scoreWeights.nodeOverlaps +
    groupOverlaps * scoreWeights.groupOverlaps +
    edgeCrossings * scoreWeights.edgeCrossings +
    segmentOverlaps * scoreWeights.segmentOverlaps +
    duplicateAnchors * scoreWeights.duplicateAnchors +
    edgeBends * scoreWeights.edgeBends +
    totalEdgeLength * scoreWeights.edgeLength +
    compactness;

  return {
    value,
    nodeOverlaps,
    groupOverlaps,
    edgeNodeHits,
    segmentOverlaps,
    edgeCrossings,
    edgeBends,
    duplicateAnchors,
    totalEdgeLength,
    layoutWidth: bounds.width,
    layoutHeight: bounds.height,
    layoutArea: bounds.area
  };
}

function countNodeOverlaps(nodes: DiagramNode[]): number {
  return countRectangleOverlaps(nodes.map((node) => requireLayout(node)));
}

function countGroupOverlaps(groups: DiagramGroup[]): number {
  return countRectangleOverlaps(groups.map((group) => requireGroupLayout(group)));
}

function countRectangleOverlaps(rectangles: Array<{ x: number; y: number; width: number; height: number }>): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      if (rectanglesOverlap(rectangles[leftIndex], rectangles[rightIndex])) {
        count += 1;
      }
    }
  }
  return count;
}

function countEdgeNodeHits(edgePaths: EdgePath[], nodes: DiagramNode[]): number {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let hits = 0;

  for (const edgePath of edgePaths) {
    const segments = pathSegments(edgePath.points);

    for (const node of nodes) {
      const layout = requireLayout(node);
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        if (isAllowedEndpointSegment(edgePath.edge, node.id, segments[segmentIndex], segmentIndex, segments.length)) {
          continue;
        }

        const [start, end] = segments[segmentIndex];
        if (segmentIntersectsRectangle(start, end, layout)) {
          hits += 1;
          break;
        }
      }
    }

    if (!nodesById.has(edgePath.edge.sourceId) || !nodesById.has(edgePath.edge.targetId)) {
      hits += 1;
    }
  }

  return hits;
}

function isAllowedEndpointSegment(
  edge: DiagramEdge,
  nodeId: string,
  segment: [DiagramPoint, DiagramPoint],
  segmentIndex: number,
  segmentCount: number
): boolean {
  if (nodeId === edge.sourceId && segmentIndex === 0) {
    const sourceAnchor = edge.layout?.sourceAnchor;
    return sourceAnchor
      ? endpointSegmentApproachesAnchorFromOutside(segment[0], segment[1], sourceAnchor)
      : true;
  }

  if (nodeId === edge.targetId && segmentIndex === segmentCount - 1) {
    const targetAnchor = edge.layout?.targetAnchor;
    return targetAnchor
      ? endpointSegmentApproachesAnchorFromOutside(segment[1], segment[0], targetAnchor)
      : true;
  }

  return false;
}

function endpointSegmentApproachesAnchorFromOutside(
  anchorPointValue: DiagramPoint,
  neighbor: DiagramPoint,
  anchor: DiagramEdgeAnchor
): boolean {
  return anchorApproachIsPerpendicular(anchorPointValue, neighbor, anchor) &&
    pointIsOutsideAnchorSide(anchorPointValue, neighbor, anchor);
}

function countSegmentOverlaps(edgePaths: EdgePath[]): number {
  const segments = edgePaths.flatMap((edgePath) => pathSegments(edgePath.points));
  let overlaps = 0;

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      if (segmentsOverlap(segments[leftIndex][0], segments[leftIndex][1], segments[rightIndex][0], segments[rightIndex][1])) {
        overlaps += 1;
      }
    }
  }

  return overlaps;
}

function countEdgeCrossings(edgePaths: EdgePath[]): number {
  let crossings = 0;

  for (let leftPathIndex = 0; leftPathIndex < edgePaths.length; leftPathIndex += 1) {
    for (let rightPathIndex = leftPathIndex + 1; rightPathIndex < edgePaths.length; rightPathIndex += 1) {
      const leftSegments = pathSegments(edgePaths[leftPathIndex].points);
      const rightSegments = pathSegments(edgePaths[rightPathIndex].points);

      for (const [leftStart, leftEnd] of leftSegments) {
        for (const [rightStart, rightEnd] of rightSegments) {
          if (
            !segmentsOverlap(leftStart, leftEnd, rightStart, rightEnd) &&
            segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd) &&
            !pointsEqual(leftStart, rightStart) &&
            !pointsEqual(leftStart, rightEnd) &&
            !pointsEqual(leftEnd, rightStart) &&
            !pointsEqual(leftEnd, rightEnd)
          ) {
            crossings += 1;
          }
        }
      }
    }
  }

  return crossings;
}

function countDuplicateAnchors(edgePaths: EdgePath[]): number {
  const anchors = new Map<string, number>();

  for (const edgePath of edgePaths) {
    const sourceAnchor = edgePath.edge.layout?.sourceAnchor;
    const targetAnchor = edgePath.edge.layout?.targetAnchor;

    if (sourceAnchor) {
      incrementCount(anchors, anchorUsageKey(edgePath.edge.sourceId, sourceAnchor));
    }

    if (targetAnchor) {
      incrementCount(anchors, anchorUsageKey(edgePath.edge.targetId, targetAnchor));
    }
  }

  return [...anchors.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function pathForEdge(edge: DiagramEdge, nodes: DiagramNode[], waypoints: DiagramPoint[]): DiagramPoint[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const source = nodeById.get(edge.sourceId);
  const target = nodeById.get(edge.targetId);

  if (!source || !target) {
    return waypoints.map((point) => ({ ...point }));
  }

  const sourceLayout = requireLayout(source);
  const targetLayout = requireLayout(target);
  const sourcePoint = edge.layout?.sourceAnchor
    ? anchorPoint(sourceLayout, edge.layout.sourceAnchor)
    : centerOf(sourceLayout);
  const targetPoint = edge.layout?.targetAnchor
    ? anchorPoint(targetLayout, edge.layout.targetAnchor)
    : centerOf(targetLayout);

  return [sourcePoint, ...waypoints.map((point) => ({ ...point })), targetPoint];
}

function pathSegments(points: DiagramPoint[]): Array<[DiagramPoint, DiagramPoint]> {
  const segments: Array<[DiagramPoint, DiagramPoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

// Changed: orthogonal routing should be scored with Manhattan distance.
// This avoids rewarding diagonal shortcuts after points are orthogonalized into horizontal/vertical segments.
function pathLength(points: DiagramPoint[]): number {
  return pathSegments(points).reduce((sum, [start, end]) =>
    sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
    0);
}

function countBends(points: DiagramPoint[]): number {
  const axes = pathSegments(removeDuplicateConsecutivePoints(points))
    .map(([start, end]) => segmentAxis(start, end))
    .filter((axis): axis is string => Boolean(axis));
  let bends = 0;

  for (let index = 1; index < axes.length; index += 1) {
    if (axes[index] !== axes[index - 1]) {
      bends += 1;
    }
  }

  return bends;
}

function segmentAxis(start: DiagramPoint, end: DiagramPoint): string | undefined {
  if (pointsEqual(start, end)) {
    return undefined;
  }

  if (isHorizontal(start, end)) {
    return "h";
  }

  if (isVertical(start, end)) {
    return "v";
  }

  return `d:${Math.sign(end.x - start.x)}:${Math.sign(end.y - start.y)}`;
}

function layoutBounds(nodes: DiagramNode[], groups: DiagramGroup[]): { width: number; height: number; area: number } {
  const rectangles = [
    ...nodes.map((node) => requireLayout(node)),
    ...groups.map((group) => requireGroupLayout(group))
  ];
  const minX = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const minY = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const maxX = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const maxY = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    width,
    height,
    area: width * height
  };
}

function compareAttempts(left: LayoutAttempt, right: LayoutAttempt): number {
  return compareScores(left.score, right.score) || left.id.localeCompare(right.id);
}

function compareScores(left: DiagramLayoutScore, right: DiagramLayoutScore): number {
  return (
    left.value - right.value ||
    left.edgeNodeHits - right.edgeNodeHits ||
    left.nodeOverlaps - right.nodeOverlaps ||
    left.groupOverlaps - right.groupOverlaps ||
    left.edgeCrossings - right.edgeCrossings ||
    left.segmentOverlaps - right.segmentOverlaps ||
    left.duplicateAnchors - right.duplicateAnchors ||
    left.edgeBends - right.edgeBends ||
    left.totalEdgeLength - right.totalEdgeLength
  );
}

function compareRoutingVariantScores(left: DiagramLayoutScore, right: DiagramLayoutScore): number {
  return compareScoresWithoutEdgeLength(left, right);
}

function compareScoresWithoutEdgeLength(left: DiagramLayoutScore, right: DiagramLayoutScore): number {
  return (
    scoreValueWithoutEdgeLength(left) - scoreValueWithoutEdgeLength(right) ||
    left.edgeNodeHits - right.edgeNodeHits ||
    left.nodeOverlaps - right.nodeOverlaps ||
    left.groupOverlaps - right.groupOverlaps ||
    left.edgeCrossings - right.edgeCrossings ||
    left.segmentOverlaps - right.segmentOverlaps ||
    left.duplicateAnchors - right.duplicateAnchors ||
    left.edgeBends - right.edgeBends
  );
}

function scoreValueWithoutEdgeLength(score: DiagramLayoutScore): number {
  return (
    score.edgeNodeHits * scoreWeights.edgeNodeHits +
    score.nodeOverlaps * scoreWeights.nodeOverlaps +
    score.groupOverlaps * scoreWeights.groupOverlaps +
    score.edgeCrossings * scoreWeights.edgeCrossings +
    score.segmentOverlaps * scoreWeights.segmentOverlaps +
    score.duplicateAnchors * scoreWeights.duplicateAnchors +
    score.edgeBends * scoreWeights.edgeBends +
    score.layoutWidth * scoreWeights.compactWidth +
    score.layoutHeight * scoreWeights.compactHeight +
    score.layoutArea * scoreWeights.compactArea
  );
}

function uniqueCandidates(candidates: LayoutCandidatePlan[]): LayoutCandidatePlan[] {
  const unique: LayoutCandidatePlan[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const signature = JSON.stringify({
      grid: candidate.grid,
      groups: candidate.groups.map((group) => ({
        id: group.id,
        nodeIds: group.nodeIds,
        gridX: group.gridX,
        gridY: group.gridY,
        gridWidth: group.gridWidth,
        gridHeight: group.gridHeight,
        packing: group.packing
      }))
    });
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    unique.push(candidate);
  }

  return unique;
}

function calculateNodeDegrees(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }

  return degrees;
}

function packingForGroup(group: DiagramGroup): DiagramGroupPacking {
  if (group.kind === "synthetic") {
    return "compactGrid";
  }

  return group.label === "Model" || group.label === "DTO" || group.label === "LLBLGenEntity"
    ? "compactGrid"
    : "vertical";
}

function createUniqueGroupId(kind: DiagramGroup["kind"], label: string, usedIds: Set<string>): string {
  const prefix = kind === "synthetic" ? "group_synthetic" : "group_stereotype";
  const safeLabel = label.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "group";
  const baseId = `${prefix}_${safeLabel}`;
  let id = baseId;
  let suffix = 2;

  while (usedIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  usedIds.add(id);
  return id;
}

function normalizeIntentGroup(
  rawGroup: unknown,
  index: number,
  grid: GridSize
): StereotypeLayoutIntentGroup {
  if (!isRecord(rawGroup)) {
    throw new Error(`Layout intent group at index ${index} must be an object.`);
  }

  const id = requireString(rawGroup.id, `layout intent groups[${index}].id`);
  const label = requireString(rawGroup.label, `layout intent groups[${index}].label`);
  const kind = requireGroupKind(rawGroup.kind, `layout intent groups[${index}].kind`);
  const gridX = requireNonNegativeInteger(rawGroup.gridX, `layout intent groups[${index}].gridX`);
  const gridY = requireNonNegativeInteger(rawGroup.gridY, `layout intent groups[${index}].gridY`);
  const gridWidth = requirePositiveInteger(rawGroup.gridWidth, `layout intent groups[${index}].gridWidth`);
  const gridHeight = requirePositiveInteger(rawGroup.gridHeight, `layout intent groups[${index}].gridHeight`);
  const packing = requirePacking(rawGroup.packing, `layout intent groups[${index}].packing`);

  if (gridX + gridWidth > grid.columns) {
    throw new Error(`Layout intent group ${id} exceeds grid columns.`);
  }

  if (gridY + gridHeight > grid.rows) {
    throw new Error(`Layout intent group ${id} exceeds grid rows.`);
  }

  if (!Array.isArray(rawGroup.nodeIds)) {
    throw new Error(`Layout intent group ${id} must define nodeIds as an array.`);
  }

  return {
    id,
    label,
    kind,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    packing,
    nodeIds: rawGroup.nodeIds.map((nodeId, nodeIndex) =>
      requireString(nodeId, `layout intent group ${id} nodeIds[${nodeIndex}]`)
    )
  };
}

function requireNode(nodeById: Map<string, DiagramNode>, nodeId: string): DiagramNode {
  const node = nodeById.get(nodeId);
  if (!node) {
    throw new Error(`Group references missing node: ${nodeId}`);
  }

  return node;
}

function requireLayout(node: DiagramNode): DiagramNodeLayout {
  if (!node.layout) {
    throw new Error(`Node has not been measured: ${node.id}`);
  }

  return node.layout;
}

function requireGroupLayout(group: DiagramGroup): NonNullable<DiagramGroup["layout"]> {
  if (!group.layout) {
    throw new Error(`Group has not been measured: ${group.id}`);
  }

  return group.layout;
}

function requireLayoutIntent(group: DiagramGroup): NonNullable<DiagramGroup["layoutIntent"]> {
  if (!group.layoutIntent) {
    throw new Error(`Group is missing layout intent: ${group.id}`);
  }

  return group.layoutIntent;
}

function requireRelativeLayout(
  layouts: Map<string, Pick<DiagramNodeLayout, "x" | "y">>,
  nodeId: string
): Pick<DiagramNodeLayout, "x" | "y"> {
  const layout = layouts.get(nodeId);
  if (!layout) {
    throw new Error(`Node has not been packed into its group: ${nodeId}`);
  }

  return layout;
}

function anchorPoint(rectangle: DiagramNodeLayout, anchor: DiagramEdgeAnchor): DiagramPoint {
  if (anchor.side === "north") {
    return { x: rectangle.x + rectangle.width * anchor.ratio, y: rectangle.y };
  }

  if (anchor.side === "south") {
    return { x: rectangle.x + rectangle.width * anchor.ratio, y: rectangle.y + rectangle.height };
  }

  if (anchor.side === "west") {
    return { x: rectangle.x, y: rectangle.y + rectangle.height * anchor.ratio };
  }

  return { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height * anchor.ratio };
}

function outsidePort(point: DiagramPoint, anchor: DiagramEdgeAnchor, laneIndex: number): DiagramPoint {
  const distance = anchorStubDistance * (laneIndex + 1);

  if (anchor.side === "north") {
    return { x: point.x, y: point.y - distance };
  }

  if (anchor.side === "south") {
    return { x: point.x, y: point.y + distance };
  }

  if (anchor.side === "west") {
    return { x: point.x - distance, y: point.y };
  }

  return { x: point.x + distance, y: point.y };
}

function laneOffsetForSide(side: DiagramEdgeAnchorSide, laneIndex: number): DiagramPoint {
  const offset = anchorStubDistance * laneIndex;

  if (side === "north") {
    return { x: 0, y: -offset };
  }

  if (side === "south") {
    return { x: 0, y: offset };
  }

  if (side === "west") {
    return { x: -offset, y: 0 };
  }

  return { x: offset, y: 0 };
}

function sideToward(from: DiagramPoint, to: DiagramPoint): DiagramEdgeAnchorSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }

  return dy >= 0 ? "south" : "north";
}

function anchorUsageKey(nodeId: string, anchor: DiagramEdgeAnchor): string {
  return `${nodeId}:${anchor.side}:${formatScoreNumber(anchor.ratio)}`;
}

function uniqueRoutes(routes: RoutedEdgeCandidate[]): RoutedEdgeCandidate[] {
  const unique: RoutedEdgeCandidate[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const signature = route.points.map((point) => `${formatScoreNumber(point.x)},${formatScoreNumber(point.y)}`).join("|");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    unique.push(route);
  }

  return unique;
}

function removeDuplicateConsecutivePoints(points: DiagramPoint[]): DiagramPoint[] {
  const cleaned: DiagramPoint[] = [];

  for (const point of points) {
    if (cleaned.length === 0 || !pointsEqual(cleaned[cleaned.length - 1], point)) {
      cleaned.push(point);
    }
  }

  return cleaned;
}

function normalizeRoutePointsForAnchors(
  points: DiagramPoint[],
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor
): DiagramPoint[] {
  let normalized = removeDuplicateConsecutivePoints(orthogonalizePoints(points));

  for (let index = 0; index < 2; index += 1) {
    normalized = enforceAnchorApproachDirections(normalized, sourceAnchor, targetAnchor);
    normalized = compactOrthogonalPoints(orthogonalizePoints(removeDuplicateConsecutivePoints(normalized)));
  }

  return normalized;
}

function enforceAnchorApproachDirections(
  points: DiagramPoint[],
  sourceAnchor: DiagramEdgeAnchor,
  targetAnchor: DiagramEdgeAnchor
): DiagramPoint[] {
  if (points.length < 2) {
    return points;
  }

  const withSource = [
    points[0],
    ...anchorApproachSupportPoints(points[0], points[1], sourceAnchor, "source"),
    ...points.slice(1)
  ];
  const targetPoint = withSource[withSource.length - 1];
  const targetPrevious = withSource[withSource.length - 2];

  if (!targetPrevious) {
    return withSource;
  }

  return [
    ...withSource.slice(0, -1),
    ...anchorApproachSupportPoints(targetPoint, targetPrevious, targetAnchor, "target"),
    targetPoint
  ];
}

function anchorApproachSupportPoints(
  anchorPointValue: DiagramPoint,
  neighbor: DiagramPoint,
  anchor: DiagramEdgeAnchor,
  role: "source" | "target"
): DiagramPoint[] {
  if (anchorApproachIsPerpendicular(anchorPointValue, neighbor, anchor)) {
    return [];
  }

  const projected = projectedAnchorApproachPoint(anchorPointValue, neighbor, anchor);
  if (!pointsEqual(projected, anchorPointValue) && pointIsOutsideAnchorSide(anchorPointValue, projected, anchor)) {
    return [projected];
  }

  const port = outsidePort(anchorPointValue, anchor, 0);
  const bridge = anchor.side === "north" || anchor.side === "south"
    ? { x: neighbor.x, y: port.y }
    : { x: port.x, y: neighbor.y };

  if (pointsEqual(port, bridge)) {
    return [port];
  }

  return role === "source"
    ? [port, bridge]
    : [bridge, port];
}

function anchorApproachIsPerpendicular(
  anchorPointValue: DiagramPoint,
  neighbor: DiagramPoint,
  anchor: DiagramEdgeAnchor
): boolean {
  return anchor.side === "north" || anchor.side === "south"
    ? isVertical(anchorPointValue, neighbor)
    : isHorizontal(anchorPointValue, neighbor);
}

function projectedAnchorApproachPoint(
  anchorPointValue: DiagramPoint,
  neighbor: DiagramPoint,
  anchor: DiagramEdgeAnchor
): DiagramPoint {
  return anchor.side === "north" || anchor.side === "south"
    ? { x: anchorPointValue.x, y: neighbor.y }
    : { x: neighbor.x, y: anchorPointValue.y };
}

function pointIsOutsideAnchorSide(
  anchorPointValue: DiagramPoint,
  point: DiagramPoint,
  anchor: DiagramEdgeAnchor
): boolean {
  if (anchor.side === "north") {
    return point.y < anchorPointValue.y - epsilon;
  }

  if (anchor.side === "south") {
    return point.y > anchorPointValue.y + epsilon;
  }

  if (anchor.side === "west") {
    return point.x < anchorPointValue.x - epsilon;
  }

  return point.x > anchorPointValue.x + epsilon;
}

function compactOrthogonalPoints(points: DiagramPoint[]): DiagramPoint[] {
  const withoutDuplicates = removeDuplicateConsecutivePoints(points);
  return withoutDuplicates.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) {
      return true;
    }

    const previous = all[index - 1];
    const next = all[index + 1];
    return !(
      (isVertical(previous, point) && isVertical(point, next)) ||
      (isHorizontal(previous, point) && isHorizontal(point, next))
    );
  });
}

function orthogonalizePoints(points: DiagramPoint[]): DiagramPoint[] {
  if (points.length < 2) {
    return points;
  }

  const orthogonalPoints: DiagramPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = orthogonalPoints[orthogonalPoints.length - 1];
    const next = points[index];

    if (!isHorizontal(previous, next) && !isVertical(previous, next)) {
      orthogonalPoints.push({ x: next.x, y: previous.y });
    }

    orthogonalPoints.push(next);
  }

  return orthogonalPoints;
}

function centerOf(rectangle: { x: number; y: number; width: number; height: number }): DiagramPoint {
  return {
    x: rectangle.x + rectangle.width / 2,
    y: rectangle.y + rectangle.height / 2
  };
}

function midpointBetweenHorizontalBounds(
  source: { x: number; width: number },
  target: { x: number; width: number }
): number {
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;

  if (sourceRight <= target.x) {
    return (sourceRight + target.x) / 2;
  }

  if (targetRight <= source.x) {
    return (targetRight + source.x) / 2;
  }

  return (source.x + source.width / 2 + target.x + target.width / 2) / 2;
}

function midpointBetweenVerticalBounds(
  source: { y: number; height: number },
  target: { y: number; height: number }
): number {
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;

  if (sourceBottom <= target.y) {
    return (sourceBottom + target.y) / 2;
  }

  if (targetBottom <= source.y) {
    return (targetBottom + source.y) / 2;
  }

  return (source.y + source.height / 2 + target.y + target.height / 2) / 2;
}

function moveWaypointOutsideNodes(waypoint: DiagramPoint, nodeBounds: DiagramNodeLayout[]): DiagramPoint {
  let movedWaypoint = { ...waypoint };

  for (let attempts = 0; attempts < nodeBounds.length; attempts += 1) {
    const containingBounds = nodeBounds.find((bounds) => pointInsideRectangle(movedWaypoint, bounds));

    if (!containingBounds) {
      return movedWaypoint;
    }

    movedWaypoint = movePointOutsideRectangle(movedWaypoint, containingBounds);
  }

  return movedWaypoint;
}

function pointInsideRectangle(point: DiagramPoint, rectangle: DiagramNodeLayout): boolean {
  return (
    point.x > rectangle.x &&
    point.x < rectangle.x + rectangle.width &&
    point.y > rectangle.y &&
    point.y < rectangle.y + rectangle.height
  );
}

function movePointOutsideRectangle(point: DiagramPoint, rectangle: DiagramNodeLayout): DiagramPoint {
  const distances = [
    { axis: "x" as const, value: rectangle.x - waypointMargin, distance: point.x - rectangle.x },
    {
      axis: "x" as const,
      value: rectangle.x + rectangle.width + waypointMargin,
      distance: rectangle.x + rectangle.width - point.x
    },
    { axis: "y" as const, value: rectangle.y - waypointMargin, distance: point.y - rectangle.y },
    {
      axis: "y" as const,
      value: rectangle.y + rectangle.height + waypointMargin,
      distance: rectangle.y + rectangle.height - point.y
    }
  ].sort((left, right) => left.distance - right.distance);
  const nearestExit = distances[0];

  return nearestExit.axis === "x"
    ? { x: nearestExit.value, y: point.y }
    : { x: point.x, y: nearestExit.value };
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function sameRectangle(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    Math.abs(left.x - right.x) < epsilon &&
    Math.abs(left.y - right.y) < epsilon &&
    Math.abs(left.width - right.width) < epsilon &&
    Math.abs(left.height - right.height) < epsilon
  );
}

function rectangleIntersectsHorizontalRange(
  rectangle: { x: number; width: number },
  minX: number,
  maxX: number
): boolean {
  return rectangle.x + rectangle.width >= minX && rectangle.x <= maxX;
}

function segmentIntersectsRectangle(
  start: DiagramPoint,
  end: DiagramPoint,
  rectangle: { x: number; y: number; width: number; height: number }
): boolean {
  if (pointInClosedRectangle(start, rectangle) || pointInClosedRectangle(end, rectangle)) {
    return true;
  }

  const topLeft = { x: rectangle.x, y: rectangle.y };
  const topRight = { x: rectangle.x + rectangle.width, y: rectangle.y };
  const bottomLeft = { x: rectangle.x, y: rectangle.y + rectangle.height };
  const bottomRight = { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height };

  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function pointInClosedRectangle(point: DiagramPoint, rectangle: { x: number; y: number; width: number; height: number }): boolean {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.height
  );
}

function segmentsOverlap(leftStart: DiagramPoint, leftEnd: DiagramPoint, rightStart: DiagramPoint, rightEnd: DiagramPoint): boolean {
  if (isHorizontal(leftStart, leftEnd) && isHorizontal(rightStart, rightEnd) && Math.abs(leftStart.y - rightStart.y) < epsilon) {
    return rangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }

  if (isVertical(leftStart, leftEnd) && isVertical(rightStart, rightEnd) && Math.abs(leftStart.x - rightStart.x) < epsilon) {
    return rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }

  return false;
}

function segmentsIntersect(firstStart: DiagramPoint, firstEnd: DiagramPoint, secondStart: DiagramPoint, secondEnd: DiagramPoint): boolean {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (
    (o1 === 0 && pointOnSegment(firstStart, secondStart, firstEnd)) ||
    (o2 === 0 && pointOnSegment(firstStart, secondEnd, firstEnd)) ||
    (o3 === 0 && pointOnSegment(secondStart, firstStart, secondEnd)) ||
    (o4 === 0 && pointOnSegment(secondStart, firstEnd, secondEnd))
  );
}

function orientation(first: DiagramPoint, second: DiagramPoint, third: DiagramPoint): number {
  const value = (second.y - first.y) * (third.x - second.x) - (second.x - first.x) * (third.y - second.y);

  if (Math.abs(value) < epsilon) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function pointOnSegment(start: DiagramPoint, point: DiagramPoint, end: DiagramPoint): boolean {
  return (
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.x + epsilon >= Math.min(start.x, end.x) &&
    point.y <= Math.max(start.y, end.y) + epsilon &&
    point.y + epsilon >= Math.min(start.y, end.y)
  );
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  const leftMin = Math.min(leftStart, leftEnd);
  const leftMax = Math.max(leftStart, leftEnd);
  const rightMin = Math.min(rightStart, rightEnd);
  const rightMax = Math.max(rightStart, rightEnd);

  return Math.max(leftMin, rightMin) + epsilon < Math.min(leftMax, rightMax);
}

function isHorizontal(start: DiagramPoint, end: DiagramPoint): boolean {
  return Math.abs(start.y - end.y) < epsilon;
}

function isVertical(start: DiagramPoint, end: DiagramPoint): boolean {
  return Math.abs(start.x - end.x) < epsilon;
}

function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < epsilon && Math.abs(left.y - right.y) < epsilon;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sumBefore(values: number[], index: number): number {
  return values.slice(0, index).reduce((sum, value) => sum + value, 0);
}

function formatScoreNumber(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function roundRatio(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireGroupKind(value: unknown, label: string): DiagramGroupKind {
  if (value !== "stereotype" && value !== "synthetic") {
    throw new Error(`${label} must be "stereotype" or "synthetic".`);
  }

  return value;
}

function requirePacking(value: unknown, label: string): DiagramGroupPacking {
  if (value !== "vertical" && value !== "horizontal" && value !== "compactGrid") {
    throw new Error(`${label} must be "vertical", "horizontal", or "compactGrid".`);
  }

  return value;
}

function requirePlacement(value: unknown, label: string): NonNullable<CreateStereotypeLayoutIntentOptions["placement"]> {
  if (value !== "grid" && value !== "suggested") {
    throw new Error(`${label} must be "grid" or "suggested".`);
  }

  return value;
}

// AUTODIAGRAM CHANGE: validator cho option anchorOrderMode mới.
function requireAnchorOrderMode(value: unknown, label: string): AnchorOrderMode {
  if (value !== "auto" && value !== "manual" && value !== "autoWithManual") {
    throw new Error(`${label} must be "auto", "manual", or "autoWithManual".`);
  }

  return value;
}

// AUTODIAGRAM CHANGE: validator cho side name trong manual anchor order.
function requireAnchorSide(value: unknown, label: string): DiagramEdgeAnchorSide {
  if (value !== "north" && value !== "south" && value !== "west" && value !== "east") {
    throw new Error(`${label} must be "north", "south", "west", or "east".`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return Number(value);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
