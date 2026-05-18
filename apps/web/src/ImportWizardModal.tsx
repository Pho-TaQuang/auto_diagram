import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DiagramDocument } from "../../../packages/core/src/index.js";
import {
  applyCoordinateRoutingLayerLayout,
  type CoordinateRoutingLayoutGroupV3,
  type CoordinateRoutingLayoutLayerV3,
  type CoordinateRoutingLayoutV3
} from "../../../packages/layout/src/index.js";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Columns,
  GripVertical,
  Layers,
  Move,
  Play,
  Rows,
  X
} from "lucide-react";

export type ImportWizardModalProps = {
  document: DiagramDocument;
  initialIntent: CoordinateRoutingLayoutV3;
  onConfirm: (modifiedIntent: CoordinateRoutingLayoutV3) => void;
  onChange?: (modifiedIntent: CoordinateRoutingLayoutV3) => void;
  onAuto: () => void;
  onCancel: () => void;
};

type ManualLayoutMode = "layers" | "free";
type DragState =
  | { kind: "group"; groupId: string }
  | { kind: "layer"; layerId: string };

export function ImportWizardModal({ document, initialIntent, onConfirm, onChange, onAuto, onCancel }: ImportWizardModalProps): React.JSX.Element {
  const [layoutMode, setLayoutMode] = useState<ManualLayoutMode>("layers");
  const [intent, setIntent] = useState<CoordinateRoutingLayoutV3>(() => toLayeredIntent(initialIntent, document));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; groupX: number; groupY: number } | null>(null);
  const dragStateRef = useRef<DragState | undefined>(undefined);
  const bounds = useMemo(() => manualLayoutBounds(intent.groups), [intent.groups]);
  const layers = useMemo(
    () => normalizeUiLayers(intent.layers ?? inferLayersFromGroups(intent.groups), intent.groups),
    [intent.groups, intent.layers]
  );
  const groupById = useMemo(() => new Map(intent.groups.map((group) => [group.id, group])), [intent.groups]);

  useEffect(() => {
    setLayoutMode("layers");
    setIntent(toLayeredIntent(initialIntent, document));
  }, [document, initialIntent]);

  const commitIntent = (updater: (current: CoordinateRoutingLayoutV3) => CoordinateRoutingLayoutV3): void => {
    setIntent((current) => {
      const next = updater(current);
      onChange?.(next);
      return next;
    });
  };

  const updateLayerIntent = (updater: (draft: CoordinateRoutingLayoutV3) => void): void => {
    commitIntent((current) => {
      const next = cloneCoordinateIntent(current);
      next.layers = normalizeUiLayers(next.layers ?? inferLayersFromGroups(next.groups), next.groups);
      updater(next);
      next.layers = normalizeUiLayers(next.layers, next.groups);
      return applyCoordinateRoutingLayerLayout(next, document);
    });
  };

  const switchMode = (nextMode: ManualLayoutMode): void => {
    setLayoutMode(nextMode);
    commitIntent((current) => nextMode === "layers" ? toLayeredIntent(current, document) : toFreeIntent(current));
  };

  const handlePointerDown = (e: React.PointerEvent, group: CoordinateRoutingLayoutGroupV3) => {
    if (layoutMode !== "free") return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    setDraggingId(group.id);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      groupX: group.x,
      groupY: group.y
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (layoutMode !== "free" || !draggingId || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    commitIntent((current) => ({
      ...toFreeIntent(current),
      groups: current.groups.map((group) =>
        group.id === draggingId
          ? { ...group, x: dragStartRef.current!.groupX + dx, y: dragStartRef.current!.groupY + dy }
          : group
      )
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDraggingId(null);
      dragStartRef.current = null;
    }
  };

  const togglePacking = (groupId: string) => {
    if (layoutMode === "layers") {
      updateLayerIntent((draft) => {
        draft.groups = draft.groups.map((group) =>
          group.id === groupId
            ? { ...group, packing: group.packing === "vertical" ? "horizontal" : "vertical" }
            : group
        );
      });
      return;
    }

    commitIntent((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? { ...group, packing: group.packing === "vertical" ? "horizontal" : "vertical" }
          : group
      )
    }));
  };

  const moveGroupInLayer = (groupId: string, delta: number): void => {
    updateLayerIntent((draft) => {
      const location = findLayerGroup(draft.layers ?? [], groupId);
      if (!location) return;
      const groupIds = draft.layers![location.layerIndex].groupIds;
      const nextIndex = location.groupIndex + delta;
      if (nextIndex < 0 || nextIndex >= groupIds.length) return;
      groupIds.splice(location.groupIndex, 1);
      groupIds.splice(nextIndex, 0, groupId);
    });
  };

  const moveGroupLayer = (groupId: string, delta: number): void => {
    updateLayerIntent((draft) => {
      draft.layers = moveGroupToAdjacentLayer(draft.layers ?? [], groupId, delta);
    });
  };

  const moveLayer = (layerId: string, delta: number): void => {
    updateLayerIntent((draft) => {
      draft.layers = moveLayerByDelta(draft.layers ?? [], layerId, delta);
    });
  };

  const handleGroupDragStart = (event: React.DragEvent, groupId: string): void => {
    dragStateRef.current = { kind: "group", groupId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
  };

  const handleLayerDragStart = (event: React.DragEvent, layerId: string): void => {
    dragStateRef.current = { kind: "layer", layerId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerId);
  };

  const handleLayerDrop = (event: React.DragEvent, targetLayerId: string): void => {
    event.preventDefault();
    const dragState = dragStateRef.current;
    dragStateRef.current = undefined;
    if (!dragState) return;

    updateLayerIntent((draft) => {
      if (dragState.kind === "layer") {
        draft.layers = moveLayerBefore(draft.layers ?? [], dragState.layerId, targetLayerId);
        return;
      }
      draft.layers = moveGroupToLayer(draft.layers ?? [], dragState.groupId, targetLayerId);
    });
  };

  const handleGroupDrop = (event: React.DragEvent, targetLayerId: string, targetGroupId: string): void => {
    event.preventDefault();
    event.stopPropagation();
    const dragState = dragStateRef.current;
    dragStateRef.current = undefined;
    if (!dragState || dragState.kind !== "group" || dragState.groupId === targetGroupId) return;

    updateLayerIntent((draft) => {
      draft.layers = moveGroupBefore(draft.layers ?? [], dragState.groupId, targetLayerId, targetGroupId);
    });
  };

  return (
    <div className="layout-popup-backdrop" role="presentation">
      <div className="layout-popup manual-layout-popup" role="dialog" aria-modal="true" aria-labelledby="manual-layout-popup-title">
        <div className="layout-popup-header">
          <div>
            <h3 id="manual-layout-popup-title">Manual Layout</h3>
            <p>{intent.groups.length} groups | {document.nodes.length} classes | {document.edges.length} edges</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} title="Close">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="layout-popup-toolbar">
          <div className="segmented-control" aria-label="Manual layout mode">
            <button type="button" className={layoutMode === "layers" ? "active" : ""} onClick={() => switchMode("layers")}>
              <Layers aria-hidden="true" size={14} />
              Layers
            </button>
            <button type="button" className={layoutMode === "free" ? "active" : ""} onClick={() => switchMode("free")}>
              <Move aria-hidden="true" size={14} />
              Free
            </button>
          </div>
          <div className="layout-popup-actions">
            <button type="button" className="secondary-button" onClick={onAuto}>
              <Play aria-hidden="true" size={16} />
              Auto
            </button>
            <button type="button" className="primary-button" onClick={() => onConfirm(intent)}>
              <Check aria-hidden="true" size={16} />
              Apply
            </button>
          </div>
        </div>

        {layoutMode === "layers" ? (
          <div className="manual-layout-canvas">
            <div className="manual-layer-board">
              {layers.map((layer, layerIndex) => (
                <div
                  key={layer.id}
                  className="manual-layout-layer"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleLayerDrop(event, layer.id)}
                >
                  <div className="manual-layout-layer-header" draggable onDragStart={(event) => handleLayerDragStart(event, layer.id)}>
                    <GripVertical aria-hidden="true" size={14} />
                    <span>{layer.label ?? `Layer ${layerIndex + 1}`}</span>
                    <button type="button" className="group-grid-token-action" onClick={() => moveLayer(layer.id, -1)} title="Move layer up">
                      <ArrowUp aria-hidden="true" size={14} />
                    </button>
                    <button type="button" className="group-grid-token-action" onClick={() => moveLayer(layer.id, 1)} title="Move layer down">
                      <ArrowDown aria-hidden="true" size={14} />
                    </button>
                  </div>
                  <div className="manual-layout-layer-row">
                    {layer.groupIds.map((groupId) => {
                      const group = groupById.get(groupId);
                      if (!group) return null;
                      return (
                        <div
                          key={group.id}
                          className="manual-layout-group manual-layout-layer-group"
                          draggable
                          onDragStart={(event) => handleGroupDragStart(event, group.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleGroupDrop(event, layer.id, group.id)}
                          style={{
                            width: group.width || 200,
                            minHeight: group.height || 100
                          }}
                        >
                          <ManualGroupContent
                            group={group}
                            onTogglePacking={() => togglePacking(group.id)}
                            extraActions={(
                              <>
                                <button type="button" className="group-grid-token-action" onClick={() => moveGroupInLayer(group.id, -1)} title="Move left">
                                  <ArrowLeft aria-hidden="true" size={14} />
                                </button>
                                <button type="button" className="group-grid-token-action" onClick={() => moveGroupInLayer(group.id, 1)} title="Move right">
                                  <ArrowRight aria-hidden="true" size={14} />
                                </button>
                                <button type="button" className="group-grid-token-action" onClick={() => moveGroupLayer(group.id, -1)} title="Move to layer above">
                                  <ArrowUp aria-hidden="true" size={14} />
                                </button>
                                <button type="button" className="group-grid-token-action" onClick={() => moveGroupLayer(group.id, 1)} title="Move to layer below">
                                  <ArrowDown aria-hidden="true" size={14} />
                                </button>
                              </>
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="manual-layout-canvas">
            <div
              className="manual-layout-board"
              style={{
                width: bounds.width,
                height: bounds.height
              }}
            >
              {intent.groups.map((group) => (
                <div
                  key={group.id}
                  className={`manual-layout-group ${draggingId === group.id ? "dragging" : ""}`}
                  onPointerDown={(e) => handlePointerDown(e, group)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{
                    left: group.x - bounds.left,
                    top: group.y - bounds.top,
                    width: group.width || 200,
                    height: group.height || 100
                  }}
                >
                  <ManualGroupContent group={group} onTogglePacking={() => togglePacking(group.id)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualGroupContent(props: {
  group: CoordinateRoutingLayoutGroupV3;
  onTogglePacking: () => void;
  extraActions?: React.ReactNode;
}): React.JSX.Element {
  const PackingIcon = props.group.packing === "vertical" ? Rows : Columns;
  return (
    <>
      <div className="manual-layout-group-header">
        <span>{props.group.label}</span>
        {props.extraActions}
        <button
          type="button"
          className="group-grid-token-action"
          onClick={props.onTogglePacking}
          title={`Toggle packing (Current: ${props.group.packing})`}
        >
          <PackingIcon aria-hidden="true" size={14} />
        </button>
      </div>
      <div className="manual-layout-group-body">
        <span>{props.group.nodeOrder.length} classes</span>
        <span>{props.group.packing}</span>
      </div>
    </>
  );
}

function toLayeredIntent(intent: CoordinateRoutingLayoutV3, document: DiagramDocument): CoordinateRoutingLayoutV3 {
  return applyCoordinateRoutingLayerLayout({
    ...cloneCoordinateIntent(intent),
    layers: normalizeUiLayers(intent.layers ?? inferLayersFromGroups(intent.groups), intent.groups)
  }, document);
}

function toFreeIntent(intent: CoordinateRoutingLayoutV3): CoordinateRoutingLayoutV3 {
  const next = cloneCoordinateIntent(intent);
  delete next.layers;
  return next;
}

function normalizeUiLayers(
  layers: CoordinateRoutingLayoutLayerV3[],
  groups: CoordinateRoutingLayoutGroupV3[]
): CoordinateRoutingLayoutLayerV3[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const assigned = new Set<string>();
  const normalized: CoordinateRoutingLayoutLayerV3[] = [];

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const layerGroupIds = layer.groupIds.filter((groupId) => {
      if (!groupIds.has(groupId) || assigned.has(groupId)) {
        return false;
      }
      assigned.add(groupId);
      return true;
    });
    if (layerGroupIds.length > 0) {
      normalized.push({
        id: layer.id || `layer_${index + 1}`,
        ...(layer.label !== undefined ? { label: layer.label } : {}),
        groupIds: layerGroupIds
      });
    }
  }

  const missing = groups.map((group) => group.id).filter((groupId) => !assigned.has(groupId));
  if (missing.length > 0) {
    normalized.push({
      id: nextLayerId(normalized),
      label: `Layer ${normalized.length + 1}`,
      groupIds: missing
    });
  }

  return normalized;
}

function inferLayersFromGroups(groups: CoordinateRoutingLayoutGroupV3[]): CoordinateRoutingLayoutLayerV3[] {
  const sortedGroups = [...groups].sort((left, right) => left.y - right.y || left.x - right.x || left.label.localeCompare(right.label));
  const rowTolerance = 160;
  const rows: CoordinateRoutingLayoutGroupV3[][] = [];

  for (const group of sortedGroups) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - group.y) <= rowTolerance);
    if (row) {
      row.push(group);
    } else {
      rows.push([group]);
    }
  }

  return rows.map((row, index) => ({
    id: `layer_${index + 1}`,
    label: `Layer ${index + 1}`,
    groupIds: row.sort((left, right) => left.x - right.x || left.label.localeCompare(right.label)).map((group) => group.id)
  }));
}

function findLayerGroup(layers: CoordinateRoutingLayoutLayerV3[], groupId: string): { layerIndex: number; groupIndex: number } | undefined {
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const groupIndex = layers[layerIndex].groupIds.indexOf(groupId);
    if (groupIndex >= 0) {
      return { layerIndex, groupIndex };
    }
  }
  return undefined;
}

function moveGroupToAdjacentLayer(
  layers: CoordinateRoutingLayoutLayerV3[],
  groupId: string,
  delta: number
): CoordinateRoutingLayoutLayerV3[] {
  const nextLayers = cloneLayers(layers);
  const location = findLayerGroup(nextLayers, groupId);
  if (!location) return nextLayers;

  nextLayers[location.layerIndex].groupIds.splice(location.groupIndex, 1);
  const targetIndex = location.layerIndex + delta;
  if (targetIndex < 0) {
    nextLayers.unshift({ id: nextLayerId(nextLayers), label: "Layer 1", groupIds: [groupId] });
  } else if (targetIndex >= nextLayers.length) {
    nextLayers.push({ id: nextLayerId(nextLayers), label: `Layer ${nextLayers.length + 1}`, groupIds: [groupId] });
  } else {
    nextLayers[targetIndex].groupIds.push(groupId);
  }
  return pruneEmptyLayers(nextLayers);
}

function moveGroupToLayer(
  layers: CoordinateRoutingLayoutLayerV3[],
  groupId: string,
  targetLayerId: string
): CoordinateRoutingLayoutLayerV3[] {
  const nextLayers = cloneLayers(layers);
  for (const layer of nextLayers) {
    layer.groupIds = layer.groupIds.filter((candidate) => candidate !== groupId);
  }
  const targetLayer = nextLayers.find((layer) => layer.id === targetLayerId);
  if (targetLayer) {
    targetLayer.groupIds.push(groupId);
  }
  return pruneEmptyLayers(nextLayers);
}

function moveGroupBefore(
  layers: CoordinateRoutingLayoutLayerV3[],
  groupId: string,
  targetLayerId: string,
  targetGroupId: string
): CoordinateRoutingLayoutLayerV3[] {
  const nextLayers = cloneLayers(layers);
  for (const layer of nextLayers) {
    layer.groupIds = layer.groupIds.filter((candidate) => candidate !== groupId);
  }
  const targetLayer = nextLayers.find((layer) => layer.id === targetLayerId);
  if (targetLayer) {
    const targetIndex = targetLayer.groupIds.indexOf(targetGroupId);
    targetLayer.groupIds.splice(Math.max(0, targetIndex), 0, groupId);
  }
  return pruneEmptyLayers(nextLayers);
}

function moveLayerByDelta(layers: CoordinateRoutingLayoutLayerV3[], layerId: string, delta: number): CoordinateRoutingLayoutLayerV3[] {
  const nextLayers = cloneLayers(layers);
  const index = nextLayers.findIndex((layer) => layer.id === layerId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= nextLayers.length) {
    return nextLayers;
  }
  const [layer] = nextLayers.splice(index, 1);
  nextLayers.splice(nextIndex, 0, layer);
  return nextLayers;
}

function moveLayerBefore(
  layers: CoordinateRoutingLayoutLayerV3[],
  layerId: string,
  targetLayerId: string
): CoordinateRoutingLayoutLayerV3[] {
  if (layerId === targetLayerId) return layers;
  const nextLayers = cloneLayers(layers);
  const index = nextLayers.findIndex((layer) => layer.id === layerId);
  const targetIndex = nextLayers.findIndex((layer) => layer.id === targetLayerId);
  if (index < 0 || targetIndex < 0) return nextLayers;
  const [layer] = nextLayers.splice(index, 1);
  const adjustedTarget = index < targetIndex ? targetIndex - 1 : targetIndex;
  nextLayers.splice(adjustedTarget, 0, layer);
  return nextLayers;
}

function pruneEmptyLayers(layers: CoordinateRoutingLayoutLayerV3[]): CoordinateRoutingLayoutLayerV3[] {
  return layers.filter((layer) => layer.groupIds.length > 0);
}

function cloneLayers(layers: CoordinateRoutingLayoutLayerV3[]): CoordinateRoutingLayoutLayerV3[] {
  return layers.map((layer) => ({
    id: layer.id,
    ...(layer.label !== undefined ? { label: layer.label } : {}),
    groupIds: [...layer.groupIds]
  }));
}

function nextLayerId(layers: CoordinateRoutingLayoutLayerV3[]): string {
  let index = layers.length + 1;
  const used = new Set(layers.map((layer) => layer.id));
  while (used.has(`layer_${index}`)) {
    index += 1;
  }
  return `layer_${index}`;
}

function cloneCoordinateIntent(intent: CoordinateRoutingLayoutV3): CoordinateRoutingLayoutV3 {
  return JSON.parse(JSON.stringify(intent)) as CoordinateRoutingLayoutV3;
}

function manualLayoutBounds(groups: CoordinateRoutingLayoutGroupV3[]): { left: number; top: number; width: number; height: number } {
  if (groups.length === 0) {
    return { left: 0, top: 0, width: 640, height: 420 };
  }

  const padding = 48;
  const left = Math.min(...groups.map((group) => group.x)) - padding;
  const top = Math.min(...groups.map((group) => group.y)) - padding;
  const right = Math.max(...groups.map((group) => group.x + (group.width || 200))) + padding;
  const bottom = Math.max(...groups.map((group) => group.y + (group.height || 100))) + padding;

  return {
    left,
    top,
    width: Math.max(640, right - left),
    height: Math.max(420, bottom - top)
  };
}
