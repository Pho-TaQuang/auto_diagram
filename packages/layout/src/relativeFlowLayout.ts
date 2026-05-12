import type {
  DiagramDocument,
  DiagramGroupKind,
  DiagramGroupPacking,
  DiagramNode
} from "../../core/src/index.js";
import {
  createStereotypeLayoutIntent,
  type CreateStereotypeLayoutIntentOptions,
  type StereotypeLayoutIntent
} from "./stereotypeGridLayout.js";

export type RelativeFlowLayout = {
  version: 2;
  layoutMode: "relative-flow";
  groups: RelativeFlowLayoutGroup[];
};

export type CreateRelativeFlowLayoutOptions = Pick<CreateStereotypeLayoutIntentOptions, "placement">;

export type RelativeFlowLayoutGroup = {
  id: string;
  label: string;
  packing: DiagramGroupPacking;
  rank?: number;
  placedAfter?: string;
  above?: string;
  below?: string;
  nodeIds: string[];
};

type VerticalEdge = {
  higherId: string;
  lowerId: string;
};

type ComponentState = {
  id: string;
  explicitRank?: number;
  memberIds: string[];
  predecessorIds: Set<string>;
  successorIds: Set<string>;
};

const legacyLayoutError =
  "Layout version 1 is no longer supported by the CLI. Regenerate the file with `npm run layout:init` to get version 2 relative-flow JSON.";

export function createRelativeFlowLayout(
  document: DiagramDocument,
  options: CreateRelativeFlowLayoutOptions = {}
): RelativeFlowLayout {
  const intent = createStereotypeLayoutIntent(document, {
    placement: options.placement ?? "grid"
  });
  const rows = groupIntentRows(intent);
  const groups: RelativeFlowLayoutGroup[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const currentRow = rows[rowIndex];
    const previousRow = rowIndex > 0 ? rows[rowIndex - 1] : undefined;

    for (let columnIndex = 0; columnIndex < currentRow.length; columnIndex += 1) {
      const group = currentRow[columnIndex];
      const previousInRow = columnIndex > 0 ? currentRow[columnIndex - 1] : undefined;
      const previousRowGroup = previousRow?.[columnIndex];

      groups.push({
        id: group.id,
        label: group.label,
        packing: group.packing,
        rank: columnIndex,
        ...(previousInRow ? { placedAfter: previousInRow.id } : {}),
        ...(previousRowGroup ? { below: previousRowGroup.id } : {}),
        nodeIds: [...group.nodeIds]
      });
    }
  }

  return {
    version: 2,
    layoutMode: "relative-flow",
    groups
  };
}

export function normalizeRelativeFlowLayout(value: unknown): RelativeFlowLayout {
  if (!isRecord(value)) {
    throw new Error("Relative-flow layout must be a JSON object.");
  }

  if (value.version === 1) {
    throw new Error(legacyLayoutError);
  }

  if (value.version !== 2) {
    throw new Error("Relative-flow layout version must be 2.");
  }

  if (value.layoutMode !== "relative-flow") {
    throw new Error('Relative-flow layoutMode must be "relative-flow".');
  }

  if (!Array.isArray(value.groups)) {
    throw new Error("Relative-flow layout must define a groups array.");
  }

  const groups = value.groups.map((rawGroup, index) => normalizeRelativeFlowLayoutGroup(rawGroup, index));
  const groupsById = new Map<string, RelativeFlowLayoutGroup>();

  for (const group of groups) {
    if (groupsById.has(group.id)) {
      throw new Error(`Relative-flow layout defines duplicate group id: ${group.id}`);
    }
    groupsById.set(group.id, group);
  }

  for (const group of groups) {
    if (group.above && group.below) {
      throw new Error(`Group ${group.id} cannot define both above and below.`);
    }

    for (const relation of [group.placedAfter, group.above, group.below]) {
      if (!relation) {
        continue;
      }
      if (!groupsById.has(relation)) {
        throw new Error(`Group ${group.id} references unknown group: ${relation}`);
      }
      if (relation === group.id) {
        throw new Error(`Group ${group.id} cannot reference itself.`);
      }
    }
  }

  return {
    version: 2,
    layoutMode: "relative-flow",
    groups
  };
}

export function relativeFlowLayoutToStereotypeLayoutIntent(
  document: DiagramDocument,
  value: RelativeFlowLayout | unknown
): StereotypeLayoutIntent {
  const layout = normalizeRelativeFlowLayout(value);
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const groupsById = new Map(layout.groups.map((group) => [group.id, group]));
  const assignedNodeIds = new Map<string, string>();

  for (const group of layout.groups) {
    for (const nodeId of group.nodeIds) {
      if (!nodesById.has(nodeId)) {
        throw new Error(`Relative-flow layout group ${group.id} references unknown node: ${nodeId}`);
      }

      const previousGroupId = assignedNodeIds.get(nodeId);
      if (previousGroupId) {
        throw new Error(`Relative-flow layout assigns node ${nodeId} more than once: ${previousGroupId}, ${group.id}`);
      }
      assignedNodeIds.set(nodeId, group.id);
    }
  }

  for (const node of document.nodes) {
    if (!assignedNodeIds.has(node.id)) {
      throw new Error(`Relative-flow layout does not assign node: ${node.id}`);
    }
  }

  const columnSet = new DisjointSet(layout.groups.map((group) => group.id));
  const verticalEdges = layout.groups.flatMap((group): VerticalEdge[] => {
    const edges: VerticalEdge[] = [];
    if (group.above) {
      columnSet.union(group.id, group.above);
      edges.push({ higherId: group.id, lowerId: group.above });
    }
    if (group.below) {
      columnSet.union(group.id, group.below);
      edges.push({ higherId: group.below, lowerId: group.id });
    }
    return edges;
  });

  const verticalGraph = createGraph(layout.groups.map((group) => group.id), verticalEdges.map((edge) => [edge.higherId, edge.lowerId] as const));
  const verticalOrder = topologicalOrder(
    layout.groups.map((group) => group.id),
    verticalGraph.successorIds,
    verticalGraph.predecessorIds,
    "vertical"
  );

  const componentStates = new Map<string, ComponentState>();

  for (const group of layout.groups) {
    const componentId = columnSet.find(group.id);
    let component = componentStates.get(componentId);

    if (!component) {
      component = {
        id: componentId,
        memberIds: [],
        predecessorIds: new Set<string>(),
        successorIds: new Set<string>()
      };
      componentStates.set(componentId, component);
    }

    component.memberIds.push(group.id);

    if (group.rank !== undefined) {
      if (component.explicitRank !== undefined && component.explicitRank !== group.rank) {
        throw new Error(
          `Groups ${component.memberIds.join(", ")} share a column via above/below but declare conflicting ranks ${component.explicitRank} and ${group.rank}.`
        );
      }
      component.explicitRank = group.rank;
    }
  }

  for (const group of layout.groups) {
    if (!group.placedAfter) {
      continue;
    }

    const predecessorComponentId = columnSet.find(group.placedAfter);
    const currentComponentId = columnSet.find(group.id);

    if (predecessorComponentId === currentComponentId) {
      throw new Error(`Group ${group.id} cannot be placedAfter ${group.placedAfter} because above/below already force them into the same column.`);
    }

    const predecessorComponent = requireMapValue(componentStates, predecessorComponentId, "component");
    const currentComponent = requireMapValue(componentStates, currentComponentId, "component");
    predecessorComponent.successorIds.add(currentComponentId);
    currentComponent.predecessorIds.add(predecessorComponentId);
  }

  const componentIds = [...componentStates.keys()];
  const horizontalSuccessors = new Map(componentIds.map((componentId) => [componentId, new Set(componentStates.get(componentId)?.successorIds ?? [])]));
  const horizontalPredecessors = new Map(componentIds.map((componentId) => [componentId, new Set(componentStates.get(componentId)?.predecessorIds ?? [])]));
  const horizontalOrder = topologicalOrder(componentIds, horizontalSuccessors, horizontalPredecessors, "horizontal");
  const componentColumns = new Map<string, number>();

  for (const componentId of horizontalOrder) {
    const component = requireMapValue(componentStates, componentId, "component");
    const minimumColumn = [...component.predecessorIds].reduce((maxColumn, predecessorId) => {
      return Math.max(maxColumn, requireMapValue(componentColumns, predecessorId, "resolved column") + 1);
    }, 0);

    if (component.explicitRank !== undefined && component.explicitRank < minimumColumn) {
      throw new Error(
        `Group column constraints conflict for ${component.memberIds.join(", ")}: rank ${component.explicitRank} is left of placedAfter requirements.`
      );
    }

    componentColumns.set(componentId, component.explicitRank ?? minimumColumn);
  }

  const verticalOffsets = new Map<string, number>();

  for (const groupId of verticalOrder) {
    const offset = [...(verticalGraph.predecessorIds.get(groupId) ?? [])].reduce((maxOffset, predecessorId) => {
      return Math.max(maxOffset, requireMapValue(verticalOffsets, predecessorId, "vertical row") + 1);
    }, 0);
    verticalOffsets.set(groupId, offset);
  }

  const groupRows = new Map<string, number>();
  const groupColumns = new Map<string, number>();
  const verticalComponentIds = new Set(
    [...componentStates.values()]
      .filter((component) => component.memberIds.length > 1)
      .map((component) => component.id)
  );

  for (const group of layout.groups) {
    groupColumns.set(group.id, requireMapValue(componentColumns, columnSet.find(group.id), "resolved column"));
  }

  for (const group of layout.groups) {
    groupRows.set(group.id, resolveGroupRow(group.id, groupsById, groupRows, verticalOffsets, verticalComponentIds, columnSet));
  }

  const normalizedColumns = normalizeDenseValues(groupColumns);
  const normalizedRows = normalizeDenseValues(groupRows);
  const occupiedCells = new Map<string, string>();

  for (const group of layout.groups) {
    const gridX = requireMapValue(normalizedColumns, group.id, "normalized column");
    const gridY = requireMapValue(normalizedRows, group.id, "normalized row");
    const cellKey = `${gridX}:${gridY}`;
    const existing = occupiedCells.get(cellKey);

    if (existing) {
      throw new Error(`Groups ${existing} and ${group.id} resolve to the same grid cell (${gridX}, ${gridY}). Add above/below or change rank/placedAfter.`);
    }
    occupiedCells.set(cellKey, group.id);
  }

  return {
    version: 1,
    grid: {
      columns: uniqueSorted(normalizedColumns.values()).length,
      rows: uniqueSorted(normalizedRows.values()).length
    },
    groups: layout.groups.map((group) => ({
      id: group.id,
      label: group.label,
      kind: deriveGroupKind(group, nodesById),
      gridX: requireMapValue(normalizedColumns, group.id, "normalized column"),
      gridY: requireMapValue(normalizedRows, group.id, "normalized row"),
      gridWidth: 1,
      gridHeight: 1,
      packing: group.packing,
      nodeIds: [...group.nodeIds]
    }))
  };
}

function normalizeRelativeFlowLayoutGroup(value: unknown, index: number): RelativeFlowLayoutGroup {
  if (!isRecord(value)) {
    throw new Error(`Relative-flow layout group at index ${index} must be a JSON object.`);
  }

  const id = requireString(value.id, `groups[${index}].id`);
  const label = requireString(value.label, `groups[${index}].label`);
  const packing = requirePacking(value.packing, `groups[${index}].packing`);
  const rank = value.rank === undefined ? undefined : requireNonNegativeInteger(value.rank, `groups[${index}].rank`);
  const placedAfter = value.placedAfter === undefined ? undefined : requireString(value.placedAfter, `groups[${index}].placedAfter`);
  const above = value.above === undefined ? undefined : requireString(value.above, `groups[${index}].above`);
  const below = value.below === undefined ? undefined : requireString(value.below, `groups[${index}].below`);

  if (!Array.isArray(value.nodeIds)) {
    throw new Error(`groups[${index}].nodeIds must be an array.`);
  }

  if (value.nodeIds.length === 0) {
    throw new Error(`groups[${index}].nodeIds must not be empty.`);
  }

  const nodeIds = value.nodeIds.map((nodeId, nodeIndex) =>
    requireString(nodeId, `groups[${index}].nodeIds[${nodeIndex}]`)
  );

  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new Error(`groups[${index}].nodeIds must not contain duplicates.`);
  }

  return {
    id,
    label,
    packing,
    ...(rank === undefined ? {} : { rank }),
    ...(placedAfter ? { placedAfter } : {}),
    ...(above ? { above } : {}),
    ...(below ? { below } : {}),
    nodeIds
  };
}

function groupIntentRows(intent: StereotypeLayoutIntent): StereotypeLayoutIntent["groups"][] {
  const rows = new Map<number, StereotypeLayoutIntent["groups"]>();

  for (const group of intent.groups) {
    const row = rows.get(group.gridY) ?? [];
    row.push(group);
    rows.set(group.gridY, row);
  }

  return [...rows.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, groups]) =>
      [...groups].sort((left, right) =>
        left.gridX - right.gridX ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id)
      )
    );
}

function createGraph(
  nodeIds: string[],
  edges: Array<readonly [string, string]>
): {
  predecessorIds: Map<string, Set<string>>;
  successorIds: Map<string, Set<string>>;
} {
  const predecessorIds = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  const successorIds = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));

  for (const [from, to] of edges) {
    successorIds.get(from)?.add(to);
    predecessorIds.get(to)?.add(from);
  }

  return {
    predecessorIds,
    successorIds
  };
}

function topologicalOrder(
  nodeIds: string[],
  successorIds: Map<string, Set<string>>,
  predecessorIds: Map<string, Set<string>>,
  axisLabel: "horizontal" | "vertical"
): string[] {
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, predecessorIds.get(nodeId)?.size ?? 0]));
  const ready = [...nodeIds]
    .filter((nodeId) => (indegree.get(nodeId) ?? 0) === 0)
    .sort();
  const ordered: string[] = [];

  while (ready.length > 0) {
    const currentId = ready.shift();
    if (!currentId) {
      continue;
    }

    ordered.push(currentId);

    for (const successorId of successorIds.get(currentId) ?? []) {
      const nextIndegree = (indegree.get(successorId) ?? 0) - 1;
      indegree.set(successorId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(successorId);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodeIds.length) {
    throw new Error(`Relative-flow layout contains a ${axisLabel} cycle.`);
  }

  return ordered;
}

function resolveGroupRow(
  groupId: string,
  groupsById: Map<string, RelativeFlowLayoutGroup>,
  resolvedRows: Map<string, number>,
  verticalOffsets: Map<string, number>,
  verticalComponentIds: Set<string>,
  columnSet: DisjointSet
): number {
  const cached = resolvedRows.get(groupId);
  if (cached !== undefined) {
    return cached;
  }

  if (verticalComponentIds.has(columnSet.find(groupId))) {
    const row = requireMapValue(verticalOffsets, groupId, "vertical row");
    resolvedRows.set(groupId, row);
    return row;
  }

  const group = requireMapValue(groupsById, groupId, "group");
  const row = group.placedAfter
    ? resolveGroupRow(group.placedAfter, groupsById, resolvedRows, verticalOffsets, verticalComponentIds, columnSet)
    : 0;

  resolvedRows.set(groupId, row);
  return row;
}

function normalizeDenseValues(valuesById: Map<string, number>): Map<string, number> {
  const uniqueValues = uniqueSorted(valuesById.values());
  const denseValueBySource = new Map(uniqueValues.map((value, index) => [value, index]));
  const normalized = new Map<string, number>();

  for (const [id, value] of valuesById) {
    normalized.set(id, requireMapValue(denseValueBySource, value, "dense value"));
  }

  return normalized;
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function deriveGroupKind(group: RelativeFlowLayoutGroup, nodesById: Map<string, DiagramNode>): DiagramGroupKind {
  const stereotypes = uniqueStrings(
    group.nodeIds
      .map((nodeId) => requireMapValue(nodesById, nodeId, "node").stereotype)
      .filter((stereotype): stereotype is string => Boolean(stereotype))
  );

  if (stereotypes.length === 1) {
    return "stereotype";
  }

  return "synthetic";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

function requirePacking(value: unknown, label: string): DiagramGroupPacking {
  if (value !== "vertical" && value !== "horizontal" && value !== "compactGrid") {
    throw new Error(`${label} must be "vertical", "horizontal", or "compactGrid".`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return Number(value);
}

function requireMapValue<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, label: string): TValue {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${label}: ${String(key)}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class DisjointSet {
  private readonly parentById = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parentById.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.parentById.get(id);
    if (!parent) {
      throw new Error(`Unknown disjoint-set id: ${id}`);
    }

    if (parent === id) {
      return id;
    }

    const root = this.find(parent);
    this.parentById.set(id, root);
    return root;
  }

  union(leftId: string, rightId: string): void {
    const leftRoot = this.find(leftId);
    const rightRoot = this.find(rightId);

    if (leftRoot !== rightRoot) {
      this.parentById.set(rightRoot, leftRoot);
    }
  }
}
