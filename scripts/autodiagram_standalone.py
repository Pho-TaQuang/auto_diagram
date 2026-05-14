#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import heapq
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable


EPSILON = 0.001

CLASS_BLOCK_START_RE = re.compile(r"^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$")
CLASS_DECLARATION_RE = re.compile(r"^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*$")
INLINE_STEREOTYPE_RE = re.compile(r"^<<([^>]+)>>\s+([A-Za-z_][A-Za-z0-9_]*)\s*$")
RELATIONSHIP_RE = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_]*)\s+"
    r"(<\|\.\.|<\|--|\.\.\|>|--\|>|-->|o--|\*--|<--|<\.\.|--o|--\*|\.\.>|--|\.\.)"
    r"\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(.+))?$"
)

EXACT_STEREOTYPE_ORDER = [
    "Controller",
    "ManagerInterface",
    "Manager",
    "AdapterFactory",
    "DataAccessAdapter",
    "LLBLGenEntity",
    "Model",
    "DTO",
]
SUGGESTED_GROUP_COLUMNS = 4
SUGGESTED_GROUP_POSITIONS = {
    "AdapterFactory": {"x": 1, "y": 0},
    "DataAccessAdapter": {"x": 2, "y": 0},
    "Controller": {"x": 0, "y": 1},
    "ManagerInterface": {"x": 1, "y": 1},
    "Manager": {"x": 2, "y": 1},
    "LLBLGenEntity": {"x": 3, "y": 1},
    "Model": {"x": 0, "y": 2},
    "DTO": {"x": 1, "y": 2},
}
SUGGESTED_FALLBACK_START_ROW = 3
SYNTHETIC_UNGROUPED_LABEL = "Ungrouped"
DEFAULT_GROUP_COLUMNS = 3
DEFAULT_CELL_WIDTH = 360
DEFAULT_CELL_HEIGHT = 280
GROUP_PADDING = 32
NODE_GAP_X = 80
NODE_GAP_Y = 80
ANCHOR_STUB_DISTANCE = 24
ROUTING_DIVIDER_THICKNESS = 10
ROUTING_DIVIDER_MIN_LENGTH = 48
LANE_GRAPH_CLEARANCE = 36
LANE_GRAPH_MAX_LINES_PER_AXIS = 72
LANE_GRAPH_SEARCH_NODE_LIMIT = 7000
PRIVATE_OFFSET_SWEEP_RADIUS = 6
GENERATED_OPTIMIZATION_EDGE_LIMIT = 25
SPARSE_RECOVERY_EDGE_LIMIT = 8


def point(x: float, y: float) -> dict[str, float]:
    return {"x": float(x), "y": float(y)}


def relationship_kind_from_operator(operator: str) -> str:
    return {
        "..>": "dependency",
        "<..": "dependency",
        "<|..": "realization",
        "..|>": "realization",
        "<|--": "inheritance",
        "--|>": "inheritance",
        "--": "association",
        "-->": "directedAssociation",
        "<--": "directedAssociation",
        "o--": "aggregation",
        "--o": "aggregation",
        "*--": "composition",
        "--*": "composition",
        "..": "dashedAssociation",
    }[operator]


def create_class_node(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "label": node_id,
        "kind": "class",
        "attributes": [],
        "methods": [],
    }


def parse_mermaid_class_diagram(source: str) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    ordered_nodes: list[dict[str, Any]] = []
    declared_node_ids: set[str] = set()
    edges: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    current_node: dict[str, Any] | None = None
    saw_class_diagram = False

    def ensure_node(node_id: str) -> dict[str, Any]:
        if node_id in nodes:
            return nodes[node_id]
        node = create_class_node(node_id)
        nodes[node_id] = node
        ordered_nodes.append(node)
        return node

    for index, raw_line in enumerate(source.replace("\r\n", "\n").split("\n")):
        line_number = index + 1
        line = raw_line.strip()
        if not line or line.startswith("%%"):
            continue
        if line == "classDiagram":
            saw_class_diagram = True
            continue

        if current_node is not None:
            if line == "}":
                current_node = None
                continue
            stereotype = parse_stereotype(line)
            if stereotype:
                current_node["stereotype"] = stereotype
                continue
            member = parse_class_member(line)
            if member["kind"] == "method":
                current_node["methods"].append(member)
            else:
                current_node["attributes"].append(member)
            continue

        match = CLASS_BLOCK_START_RE.match(line)
        if match:
            current_node = ensure_node(match.group(1))
            declared_node_ids.add(current_node["id"])
            continue

        match = CLASS_DECLARATION_RE.match(line)
        if match:
            declared_node_ids.add(ensure_node(match.group(1))["id"])
            continue

        match = INLINE_STEREOTYPE_RE.match(line)
        if match:
            stereotype = parse_stereotype_body(match.group(1))
            if stereotype:
                node = ensure_node(match.group(2))
                node["stereotype"] = stereotype
                declared_node_ids.add(node["id"])
            continue

        match = RELATIONSHIP_RE.match(line)
        if match:
            source_id, operator, target_id, label = match.groups()
            ensure_node(source_id)
            ensure_node(target_id)
            edges.append(
                {
                    "id": f"edge_{len(edges) + 1}_{source_id}_{target_id}",
                    "sourceId": source_id,
                    "targetId": target_id,
                    "operator": operator,
                    "kind": relationship_kind_from_operator(operator),
                    **({"label": normalize_generic_markers(label.strip())} if label else {}),
                }
            )
            continue

        diagnostics.append(
            {
                "severity": "warning",
                "message": f"Unsupported Mermaid classDiagram line: {line}",
                "line": line_number,
            }
        )

    if not saw_class_diagram:
        diagnostics.append(
            {
                "severity": "warning",
                "message": "Input does not start with a Mermaid classDiagram declaration.",
            }
        )
    if current_node is not None:
        diagnostics.append(
            {
                "severity": "warning",
                "message": f"Class block for {current_node['label']} was not closed.",
            }
        )

    for node in ordered_nodes:
        if node["id"] not in declared_node_ids:
            diagnostics.append(
                {
                    "severity": "warning",
                    "message": (
                        f"Class {node['id']} is referenced by a relationship but has no class declaration "
                        "or stereotype; generated as an empty class in the Ungrouped layout group."
                    ),
                }
            )

    return {
        "id": "diagram",
        "type": "classDiagram",
        "nodes": ordered_nodes,
        "edges": edges,
        "diagnostics": diagnostics,
    }


def parse_stereotype(line: str) -> str | None:
    match = re.match(r"^<<([^>]+)>>$", line)
    return parse_stereotype_body(match.group(1)) if match else None


def parse_stereotype_body(value: str) -> str | None:
    value = value.strip()
    return value or None


def parse_class_member(line: str) -> dict[str, Any]:
    normalized = normalize_generic_markers(line)
    visibility = parse_visibility(normalized)
    text_after_visibility = normalized[1:].strip() if visibility else normalized.strip()
    closing_paren_index = normalized.rfind(")")

    if "(" in normalized and closing_paren_index >= 0:
        signature = normalized[: closing_paren_index + 1].strip()
        return_type = normalized[closing_paren_index + 1 :].strip()
        return {
            "kind": "method",
            **({"visibility": visibility} if visibility else {}),
            "name": parse_member_name(text_after_visibility),
            **({"returnType": return_type} if return_type else {}),
            "text": f"{signature} : {return_type}" if return_type else signature,
        }

    return {
        "kind": "attribute",
        **({"visibility": visibility} if visibility else {}),
        "name": parse_member_name(text_after_visibility),
        "text": normalized,
    }


def parse_visibility(value: str) -> str | None:
    return value[0] if value and value[0] in ["+", "-", "#", "~"] else None


def parse_member_name(value: str) -> str:
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)", value)
    if match:
        return match.group(1)
    return value.split()[0] if value.split() else value


def normalize_generic_markers(value: str) -> str:
    open_marker = True
    result: list[str] = []
    for char in value:
        if char == "~":
            result.append("<" if open_marker else ">")
            open_marker = not open_marker
        else:
            result.append(char)
    return "".join(result)


def estimate_class_node_layout(node: dict[str, Any]) -> dict[str, float]:
    member_count = len(node.get("attributes", [])) + len(node.get("methods", []))
    attribute_row_count = max(1, len(node.get("attributes", [])))
    method_row_count = max(1, len(node.get("methods", [])))
    line_height = 25 if member_count > 30 else 30
    header_height = 48 if node.get("stereotype") else 40
    separator_height = 8
    content_row_count = attribute_row_count + method_row_count
    longest_line = max(
        [len(node.get("label", ""))]
        + ([len(node.get("stereotype", "")) + 4] if node.get("stereotype") else [0])
        + [len(member["text"]) for member in node.get("attributes", [])]
        + [len(member["text"]) for member in node.get("methods", [])]
    )
    return {
        "x": 0.0,
        "y": 0.0,
        "width": float(clamp(math.ceil(longest_line * 7.4 + 40), 220, 920)),
        "height": float(header_height + content_row_count * line_height + separator_height),
        "headerHeight": float(header_height),
        "lineHeight": float(line_height),
        "separatorHeight": float(separator_height),
    }


def create_stereotype_layout_intent(document: dict[str, Any], placement: str = "grid") -> dict[str, Any]:
    columns = SUGGESTED_GROUP_COLUMNS if placement == "suggested" else DEFAULT_GROUP_COLUMNS
    nodes = [clone_node_with_layout(node) for node in document["nodes"]]
    groups = build_exact_stereotype_groups(nodes, columns)
    if placement == "suggested":
        apply_suggested_group_placement(groups)
    minimum_rows = max(1, math.ceil(len(groups) / columns))
    rows = max(
        minimum_rows,
        *[
            int(group["layoutIntent"]["gridY"] + group["layoutIntent"]["gridHeight"])
            for group in groups
        ],
    )
    return {
        "version": 1,
        "grid": {"columns": columns, "rows": rows},
        "groups": [
            {
                "id": group["id"],
                "label": group["label"],
                "kind": group["kind"],
                "gridX": group["layoutIntent"]["gridX"],
                "gridY": group["layoutIntent"]["gridY"],
                "gridWidth": group["layoutIntent"]["gridWidth"],
                "gridHeight": group["layoutIntent"]["gridHeight"],
                "packing": group["layoutIntent"]["packing"],
                "nodeIds": list(group["nodeIds"]),
            }
            for group in groups
        ],
    }


def clone_node_with_layout(node: dict[str, Any]) -> dict[str, Any]:
    cloned = copy.deepcopy(node)
    cloned["layout"] = estimate_class_node_layout(cloned)
    return cloned


def build_exact_stereotype_groups(nodes: list[dict[str, Any]], columns: int) -> list[dict[str, Any]]:
    groups_by_key: dict[str, dict[str, Any]] = {}
    first_seen_groups: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for node in nodes:
        exact = node.get("stereotype") or None
        kind = "stereotype" if exact else "synthetic"
        label = exact or SYNTHETIC_UNGROUPED_LABEL
        key = f"{kind}:{label}"
        group = groups_by_key.get(key)
        if group is None:
            group = {
                "id": create_unique_group_id(kind, label, used_ids),
                "label": label,
                "kind": kind,
                "nodeIds": [],
            }
            groups_by_key[key] = group
            first_seen_groups.append(group)
        group["nodeIds"].append(node["id"])
        node["groupId"] = group["id"]

    known_groups = [
        groups_by_key[f"stereotype:{label}"]
        for label in EXACT_STEREOTYPE_ORDER
        if f"stereotype:{label}" in groups_by_key
    ]
    known_ids = {group["id"] for group in known_groups}
    unknown = [
        group
        for group in first_seen_groups
        if group["kind"] == "stereotype" and group["id"] not in known_ids
    ]
    synthetic = [group for group in first_seen_groups if group["kind"] == "synthetic"]
    ordered = known_groups + unknown + synthetic
    for index, group in enumerate(ordered):
        group["nodeIds"] = list(group["nodeIds"])
        group["layoutIntent"] = {
            "gridX": index % columns,
            "gridY": index // columns,
            "gridWidth": 1,
            "gridHeight": 1,
            "packing": packing_for_group(group),
        }
    return ordered


def create_unique_group_id(kind: str, label: str, used_ids: set[str]) -> str:
    prefix = "group_synthetic" if kind == "synthetic" else "group_stereotype"
    safe_label = re.sub(r"[^A-Za-z0-9_-]+", "_", label).strip("_") or "group"
    base = f"{prefix}_{safe_label}"
    candidate = base
    suffix = 2
    while candidate in used_ids:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used_ids.add(candidate)
    return candidate


def packing_for_group(_group: dict[str, Any]) -> str:
    return "vertical"


def apply_suggested_group_placement(groups: list[dict[str, Any]]) -> None:
    occupied: set[str] = set()
    has_suggested = any(group["label"] in SUGGESTED_GROUP_POSITIONS for group in groups)
    fallback_start_row = SUGGESTED_FALLBACK_START_ROW if has_suggested else 0
    fallback_index = 0
    for group in groups:
        position = SUGGESTED_GROUP_POSITIONS.get(group["label"])
        while position is None or f"{position['x']}:{position['y']}" in occupied:
            position = {
                "x": fallback_index % SUGGESTED_GROUP_COLUMNS,
                "y": fallback_start_row + fallback_index // SUGGESTED_GROUP_COLUMNS,
            }
            fallback_index += 1
        occupied.add(f"{position['x']}:{position['y']}")
        group["layoutIntent"] = {
            "gridX": position["x"],
            "gridY": position["y"],
            "gridWidth": 1,
            "gridHeight": 1,
            "packing": group.get("layoutIntent", {}).get("packing", packing_for_group(group)),
        }


def create_initial_coordinate_routing_layout_v3(
    document: dict[str, Any], placement: str = "suggested"
) -> dict[str, Any]:
    return stereotype_grid_intent_to_coordinate_routing(
        create_stereotype_layout_intent(document, placement)
    )


def stereotype_grid_intent_to_coordinate_routing(intent: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 3,
        "layoutMode": "coordinate-routing",
        "groups": [
            {
                "id": group["id"],
                "label": group["label"],
                "x": group["gridX"] * DEFAULT_CELL_WIDTH,
                "y": group["gridY"] * DEFAULT_CELL_HEIGHT,
                "packing": "horizontal" if group.get("packing") == "horizontal" else "vertical",
                "nodeOrder": list(group["nodeIds"]),
                "locked": True,
            }
            for group in intent["groups"]
        ],
    }


def normalize_layout_input(
    raw_input: dict[str, Any],
    document: dict[str, Any],
    logger: "MemoryLayoutLogger",
) -> dict[str, Any]:
    source_format = "coordinate-routing-v3"
    value = raw_input
    if value.get("version") == 1 and isinstance(value.get("grid"), dict):
        logger.warn(
            {
                "phase": "normalize",
                "type": "layout-format-converted",
                "message": "stereotype-grid v1 converted to coordinate-routing v3.",
                "data": {"sourceFormat": "stereotype-grid-v1", "targetFormat": "coordinate-routing-v3"},
            }
        )
        value = stereotype_grid_intent_to_coordinate_routing(value)
        source_format = "stereotype-grid-v1"

    if value.get("version") != 3 or value.get("layoutMode") != "coordinate-routing":
        raise ValueError('Coordinate routing layout must have version 3 and layoutMode "coordinate-routing".')
    if not isinstance(value.get("groups"), list):
        raise ValueError("Coordinate routing layout must define a groups array.")

    base_intent = create_stereotype_layout_intent(document)
    base_groups_by_id = {group["id"]: group for group in base_intent["groups"]}
    output_groups: list[dict[str, Any]] = []
    seen_group_ids: set[str] = set()
    assigned_node_ids: set[str] = set()

    for index, raw_group in enumerate(value["groups"]):
        group = normalize_raw_coordinate_group(raw_group, index)
        if group["id"] in seen_group_ids:
            raise ValueError(f"Coordinate routing layout defines duplicate group id: {group['id']}")
        seen_group_ids.add(group["id"])
        base_group = base_groups_by_id.get(group["id"])
        if not base_group:
            logger.warn(
                {
                    "phase": "normalize",
                    "type": "unknown-group-ignored",
                    "message": f"Unknown group {group['id']} ignored.",
                    "groupId": group["id"],
                }
            )
            continue
        group["nodeOrder"] = normalize_node_order(group, base_group, assigned_node_ids, logger)
        output_groups.append(group)

    for base_group in base_intent["groups"]:
        if any(group["id"] == base_group["id"] for group in output_groups):
            continue
        logger.warn(
            {
                "phase": "normalize",
                "type": "missing-group-generated",
                "message": f"Missing group {base_group['label']} generated from document order.",
                "groupId": base_group["id"],
            }
        )
        output_groups.append(
            {
                "id": base_group["id"],
                "label": base_group["label"],
                "x": base_group["gridX"] * DEFAULT_CELL_WIDTH,
                "y": base_group["gridY"] * DEFAULT_CELL_HEIGHT,
                "packing": "horizontal" if base_group["packing"] == "horizontal" else "vertical",
                "nodeOrder": [node_id for node_id in base_group["nodeIds"] if node_id not in assigned_node_ids],
                "locked": True,
            }
        )
        assigned_node_ids.update(base_group["nodeIds"])

    return {
        "intent": {
            "version": 3,
            "layoutMode": "coordinate-routing",
            "groups": output_groups,
            **({"routing": normalize_routing_options(value.get("routing"))} if value.get("routing") is not None else {}),
        },
        "sourceFormat": source_format,
    }


def normalize_raw_coordinate_group(raw_group: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw_group, dict):
        raise ValueError(f"Coordinate routing group at index {index} must be an object.")
    packing = raw_group.get("packing")
    if packing == "compactGrid":
        packing = "vertical"
    if packing not in ["vertical", "horizontal"]:
        raise ValueError(f'groups[{index}].packing must be "vertical" or "horizontal".')
    node_order = raw_group.get("nodeOrder", [])
    if not isinstance(node_order, list):
        node_order = []
    group = {
        "id": require_string(raw_group.get("id"), f"groups[{index}].id"),
        "label": require_string(raw_group.get("label"), f"groups[{index}].label"),
        "x": require_finite_number(raw_group.get("x"), f"groups[{index}].x"),
        "y": require_finite_number(raw_group.get("y"), f"groups[{index}].y"),
        "packing": packing,
        "nodeOrder": [require_string(node_id, f"groups[{index}].nodeOrder") for node_id in node_order],
    }
    for key in ["locked", "packingLocked", "nodeOrderLocked"]:
        if key in raw_group:
            group[key] = bool(raw_group[key])
    return group


def normalize_node_order(
    group: dict[str, Any],
    base_group: dict[str, Any],
    assigned_node_ids: set[str],
    logger: "MemoryLayoutLogger",
) -> list[str]:
    base_node_ids = set(base_group["nodeIds"])
    local_seen: set[str] = set()
    normalized: list[str] = []
    if len(group.get("nodeOrder", [])) == 0:
        logger.warn(
            {
                "phase": "normalize",
                "type": "missing-node-order-generated",
                "message": f"Missing nodeOrder generated from document order for group {group['label']}.",
                "groupId": group["id"],
            }
        )

    for node_id in group.get("nodeOrder", []):
        if node_id in local_seen:
            logger.warn(
                {
                    "phase": "normalize",
                    "type": "duplicate-node-removed",
                    "message": f"Duplicate node {node_id} removed from nodeOrder for group {group['label']}.",
                    "groupId": group["id"],
                    "nodeId": node_id,
                }
            )
            continue
        local_seen.add(node_id)
        if node_id not in base_node_ids:
            logger.warn(
                {
                    "phase": "normalize",
                    "type": "unknown-node-removed",
                    "message": f"Unknown or out-of-group node {node_id} removed from nodeOrder for group {group['label']}.",
                    "groupId": group["id"],
                    "nodeId": node_id,
                }
            )
            continue
        if node_id in assigned_node_ids:
            logger.warn(
                {
                    "phase": "normalize",
                    "type": "duplicate-node-assignment-removed",
                    "message": f"Node {node_id} was already assigned by another group and was removed from {group['label']}.",
                    "groupId": group["id"],
                    "nodeId": node_id,
                }
            )
            continue
        normalized.append(node_id)
        assigned_node_ids.add(node_id)

    for node_id in base_group["nodeIds"]:
        if node_id not in assigned_node_ids:
            logger.warn(
                {
                    "phase": "normalize",
                    "type": "missing-node-appended",
                    "message": f"Node {node_id} appended to nodeOrder for group {group['label']} from document order.",
                    "groupId": group["id"],
                    "nodeId": node_id,
                }
            )
            normalized.append(node_id)
            assigned_node_ids.add(node_id)

    return normalized


def normalize_routing_options(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("routing must be an object when provided.")
    output: dict[str, Any] = {}
    for key in ["dividerThreshold", "maxRepairPasses"]:
        if key in value:
            numeric = require_finite_number(value[key], f"routing.{key}")
            if numeric < 0 or not float(numeric).is_integer():
                raise ValueError(f"routing.{key} must be a non-negative integer.")
            output[key] = int(numeric)
    if "outerLaneMargin" in value:
        numeric = require_finite_number(value["outerLaneMargin"], "routing.outerLaneMargin")
        if numeric < 0:
            raise ValueError("routing.outerLaneMargin must be non-negative.")
        output["outerLaneMargin"] = numeric
    return output


def normalize_coordinate_routing_intent(
    intent: dict[str, Any], routing_options: dict[str, Any]
) -> dict[str, Any]:
    return {
        "version": 3,
        "groupOrder": [group["id"] for group in intent["groups"]],
        "groups": {
            group["id"]: {
                **group,
                "kind": "synthetic" if group["id"].startswith("group_synthetic_") else "stereotype",
            }
            for group in intent["groups"]
        },
        "routing": {
            "dividerThreshold": int(routing_options.get("dividerThreshold", 4)),
            "outerLaneMargin": float(routing_options.get("outerLaneMargin", 96)),
            "maxRepairPasses": int(routing_options.get("maxRepairPasses", 2)),
        },
    }


class MemoryLayoutLogger:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def log(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def debug(self, event: dict[str, Any]) -> None:
        self.log({**event, "level": "debug"})

    def info(self, event: dict[str, Any]) -> None:
        self.log({**event, "level": "info"})

    def warn(self, event: dict[str, Any]) -> None:
        self.log({**event, "level": "warn"})

    def error(self, event: dict[str, Any]) -> None:
        self.log({**event, "level": "error"})

    def report(
        self,
        engine: str,
        source_format: str | None,
        include_trace: bool,
        routing_summary: dict[str, Any] | None,
        diagnostics: list[dict[str, Any]],
        edge_validations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        report = {
            "engine": engine,
            **({"sourceFormat": source_format} if source_format else {}),
            "warnings": [event for event in self.events if event["level"] == "warn"],
            "errors": [event for event in self.events if event["level"] == "error"],
            "diagnostics": diagnostics,
            "edgeValidations": edge_validations,
            **({"routingSummary": routing_summary} if routing_summary else {}),
        }
        if include_trace:
            report["trace"] = list(self.events)
        return report


def run_routing_pipeline(
    document: dict[str, Any],
    *,
    engine: str,
    layout_input: dict[str, Any] | None = None,
    route_strategy: str = "template-with-outer-lanes",
    trace_routing: bool = False,
    divider_threshold: int = 4,
    outer_lane_margin: float = 96,
    max_repair_passes: int = 2,
) -> dict[str, Any]:
    if engine == "manual-routing-v2" and layout_input is None:
        raise ValueError("manual-routing-v2 requires a layout input.")
    if engine not in ["manual-routing-v2", "suggest-initial-v2", "auto-arrange-v2"]:
        raise ValueError(f"Unsupported v2 engine: {engine}")

    logger = MemoryLayoutLogger()
    if engine == "auto-arrange-v2":
        layout_input = create_initial_coordinate_routing_layout_v3(document, "suggested")
        normalize_result = {"intent": layout_input, "sourceFormat": "none"}
    elif engine == "suggest-initial-v2" and layout_input is None:
        layout_input = create_initial_coordinate_routing_layout_v3(document, "suggested")
        normalize_result = {"intent": layout_input, "sourceFormat": "none"}
    else:
        normalize_result = normalize_layout_input(layout_input or {}, document, logger)

    raw_intent = normalize_result["intent"]
    routing = {
        "dividerThreshold": raw_intent.get("routing", {}).get("dividerThreshold", divider_threshold),
        "outerLaneMargin": raw_intent.get("routing", {}).get("outerLaneMargin", outer_lane_margin),
        "maxRepairPasses": raw_intent.get("routing", {}).get("maxRepairPasses", max_repair_passes),
    }
    normalized_intent = normalize_coordinate_routing_intent(raw_intent, routing)
    include_outer_lanes = route_strategy == "template-with-outer-lanes"

    if engine in ["suggest-initial-v2", "auto-arrange-v2"] and len(document["edges"]) <= GENERATED_OPTIMIZATION_EDGE_LIMIT:
        normalized_intent = optimize_generated_routing_intent(
            document, normalized_intent, include_outer_lanes, logger
        )
    elif engine in ["suggest-initial-v2", "auto-arrange-v2"]:
        logger.warn(
            {
                "phase": "route",
                "type": "generated-layout-optimization-skipped",
                "message": "Generated layout optimization skipped for a large diagram; using the normalized initial layout.",
                "data": {"edgeCount": len(document["edges"]), "limit": GENERATED_OPTIMIZATION_EDGE_LIMIT},
            }
        )

    prepared = apply_coordinate_routing_intent(document, normalized_intent, logger)
    logger.info(
        {
            "phase": "route",
            "type": "route-strategy-selected",
            "message": f"Routing strategy {route_strategy if include_outer_lanes else 'template-only'} selected.",
            "data": {"requestedRouteStrategy": route_strategy, "routeStrategy": route_strategy if include_outer_lanes else "template-only"},
        }
    )
    route_result = route_with_template_strategy(
        prepared,
        normalized_intent,
        logger,
        include_outer_lanes=include_outer_lanes,
        include_dividers=include_outer_lanes,
    )
    routed_document = apply_route_result(prepared, route_result)
    score = score_layout(routed_document)
    validation = validate_routed_document(prepared, routed_document, logger, logger.events)
    routing_summary = build_routing_summary(
        routed_document, route_strategy if include_outer_lanes else "template-only", score, validation, logger.events
    )
    logger.log(
        {
            "level": "info" if routing_summary["hardValid"] else "error",
            "phase": "validate",
            "type": "route-validation-passed" if routing_summary["hardValid"] else "route-validation-failed",
            "message": "Routing hard validation passed." if routing_summary["hardValid"] else "Routing hard validation failed.",
            "data": {"routingSummary": routing_summary},
        }
    )
    logger.info(
        {
            "phase": "route",
            "type": "route-complete",
            "message": f"{engine} routed {len(route_result['edges'])} edges.",
            "data": {
                "hardValid": routing_summary["hardValid"],
                "validEdges": routing_summary["validEdges"],
                "invalidEdges": routing_summary["invalidEdges"],
            },
        }
    )
    structured_diagnostics = route_result["diagnostics"] + validation["diagnostics"]
    final_document = {
        **routed_document,
        "diagnostics": routed_document.get("diagnostics", []) + log_events_to_diagnostics(logger.events),
        "layout": {
            "engine": engine,
            "score": {
                **score,
                "edgeIdentityViolations": routing_summary["edgeIdentityViolations"],
                "illegalSegmentOverlaps": routing_summary["illegalSegmentOverlaps"],
                "outerLaneUsages": routing_summary["outerLaneUsages"],
                "routingFailures": routing_summary["routingFailures"],
            },
            "diagnostics": structured_diagnostics,
        },
    }
    return {
        "document": final_document,
        "report": logger.report(
            engine,
            normalize_result.get("sourceFormat"),
            trace_routing,
            routing_summary,
            structured_diagnostics,
            validation["edgeResults"],
        ),
    }


def apply_coordinate_routing_intent(
    document: dict[str, Any], intent: dict[str, Any], logger: MemoryLayoutLogger
) -> dict[str, Any]:
    node_by_id = {
        node["id"]: {**copy.deepcopy(node), "layout": estimate_class_node_layout(node)}
        for node in document["nodes"]
    }
    groups: list[dict[str, Any]] = []
    for group_id in intent["groupOrder"]:
        group_intent = intent["groups"].get(group_id)
        if not group_intent:
            continue
        group_nodes = [node_by_id[node_id] for node_id in group_intent["nodeOrder"] if node_id in node_by_id]
        for node in group_nodes:
            node["groupId"] = group_intent["id"]
        group = {
            "id": group_intent["id"],
            "label": group_intent["label"],
            "kind": group_intent["kind"],
            "nodeIds": [node["id"] for node in group_nodes],
            "layout": {"x": group_intent["x"], "y": group_intent["y"], "width": 0.0, "height": 0.0},
        }
        pack_group(group, group_nodes, group_intent["packing"])
        groups.append(group)
        logger.debug(
            {
                "phase": "pack",
                "type": "group-packed",
                "message": f"Group {group['label']} packed {group_intent['packing']}.",
                "groupId": group["id"],
                "data": {"x": group["layout"]["x"], "y": group["layout"]["y"], "nodeOrder": group["nodeIds"]},
            }
        )
    return {
        **copy.deepcopy(document),
        "nodes": list(node_by_id.values()),
        "groups": groups,
        "routingDividers": None,
    }


def pack_group(group: dict[str, Any], nodes: list[dict[str, Any]], packing: str) -> None:
    layout = group["layout"]
    if not nodes:
        layout["width"] = GROUP_PADDING * 2
        layout["height"] = GROUP_PADDING * 2
        return
    if packing == "horizontal":
        x = layout["x"] + GROUP_PADDING
        max_height = 0.0
        for node in nodes:
            node_layout = node["layout"]
            node_layout["x"] = x
            node_layout["y"] = layout["y"] + GROUP_PADDING
            x += node_layout["width"] + NODE_GAP_X
            max_height = max(max_height, node_layout["height"])
        layout["width"] = sum(node["layout"]["width"] for node in nodes) + NODE_GAP_X * (len(nodes) - 1) + GROUP_PADDING * 2
        layout["height"] = max_height + GROUP_PADDING * 2
        return
    y = layout["y"] + GROUP_PADDING
    max_width = 0.0
    for node in nodes:
        node_layout = node["layout"]
        node_layout["x"] = layout["x"] + GROUP_PADDING
        node_layout["y"] = y
        y += node_layout["height"] + NODE_GAP_Y
        max_width = max(max_width, node_layout["width"])
    layout["width"] = max_width + GROUP_PADDING * 2
    layout["height"] = sum(node["layout"]["height"] for node in nodes) + NODE_GAP_Y * (len(nodes) - 1) + GROUP_PADDING * 2


def route_with_template_strategy(
    document: dict[str, Any],
    intent: dict[str, Any],
    logger: MemoryLayoutLogger,
    *,
    include_outer_lanes: bool,
    include_dividers: bool,
) -> dict[str, Any]:
    node_by_id = {node["id"]: node for node in document["nodes"]}
    node_bounds = [require_node_rectangle(node) for node in document["nodes"]]
    assignments = assign_anchors(document["edges"], node_by_id)
    accepted_paths: list[dict[str, Any]] = []
    routed_edges: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    diagram_bounds = rectangle_bounds(node_bounds)
    allow_sparse_recovery = include_outer_lanes and len(document["edges"]) <= SPARSE_RECOVERY_EDGE_LIMIT
    segment_strategy_by_edge_id: dict[str, str] = {}
    anchored_edge_by_id = {assignment["edge"]["id"]: edge_with_anchors(assignment) for assignment in assignments}
    dividers = (
        plan_routing_dividers(list(anchored_edge_by_id.values()), document["nodes"], intent["routing"]["dividerThreshold"], logger)
        if include_dividers
        else []
    )
    divider_edge_ids = {edge_id for divider in dividers for edge_id in divider["sourceEdgeIds"]}
    accepted_paths.extend(build_divider_occupancy_paths(dividers, anchored_edge_by_id, document["nodes"], diagram_bounds))
    route_plans: list[dict[str, Any]] = []
    for index, assignment in enumerate(assignments):
        source = require_node_rectangle(node_by_id[assignment["edge"]["sourceId"]])
        target = require_node_rectangle(node_by_id[assignment["edge"]["targetId"]])
        route_plans.append(
            {
                "assignment": assignment,
                "candidates": route_candidates_for_anchors(
                    assignment["edge"]["id"],
                    index,
                    source,
                    target,
                    assignment["sourceAnchor"],
                    assignment["targetAnchor"],
                    diagram_bounds,
                    intent["routing"]["outerLaneMargin"],
                    include_outer_lanes,
                ),
            }
        )
    route_plans.sort(
        key=lambda plan: (
            -route_plan_difficulty(plan["assignment"], document["nodes"], assignments),
            plan["assignment"]["edge"]["id"],
        )
    )
    logger.debug(
        {
            "phase": "route",
            "type": "route-candidates-generated",
            "message": f"{sum(len(plan['candidates']) for plan in route_plans)} route candidates generated.",
            "data": {
                "edgeCount": len(assignments),
                "candidateCount": sum(len(plan["candidates"]) for plan in route_plans),
                "includeOuterLanes": include_outer_lanes,
            },
        }
    )
    logger.debug(
        {
            "phase": "route",
            "type": "route-order-selected",
            "message": f"{len(route_plans)} edges ordered for congestion-aware routing.",
            "data": {"edgeIds": [plan["assignment"]["edge"]["id"] for plan in route_plans]},
        }
    )

    for plan in route_plans:
        assignment = plan["assignment"]
        edge = assignment["edge"]
        if edge["id"] in divider_edge_ids:
            divider_edge = anchored_edge_by_id[edge["id"]]
            segment_strategy_by_edge_id[divider_edge["id"]] = "divider"
            routed_edges.append(divider_edge)
            continue
        source = require_node_rectangle(node_by_id[edge["sourceId"]])
        target = require_node_rectangle(node_by_id[edge["targetId"]])

        def on_attempt(edge_id: str = edge["id"]) -> None:
            logger.debug(
                {
                    "phase": "route",
                    "type": "routing-recovery-attempted",
                    "message": f"Sparse lane-graph recovery attempted for edge {edge_id}.",
                    "edgeId": edge_id,
                }
            )

        selected = select_route_candidate(
            edge,
            plan["candidates"],
            document["nodes"],
            accepted_paths,
            {
                "includeRecovery": allow_sparse_recovery,
                "source": source,
                "target": target,
                "sourceAnchor": assignment["sourceAnchor"],
                "targetAnchor": assignment["targetAnchor"],
                "bounds": diagram_bounds,
                "outerLaneMargin": intent["routing"]["outerLaneMargin"],
                "onAttempt": on_attempt,
            },
        )
        strategy = (
            "fallback"
            if selected["hardFailures"] > 0
            else "corridor"
            if selected["candidate"].get("recovery")
            else "outer-lane"
            if selected["candidate"].get("outerLane")
            else "corridor"
        )
        if selected.get("recovered"):
            logger.debug(
                {
                    "phase": "route",
                    "type": "routing-recovery-succeeded",
                    "message": f"Sparse lane-graph recovery selected for edge {edge['id']}.",
                    "edgeId": edge["id"],
                    "data": selected["failureBreakdown"],
                }
            )
        elif selected["validCandidates"] == 0:
            logger.debug(
                {
                    "phase": "route",
                    "type": "routing-recovery-failed",
                    "message": f"No hard-valid recovery route found for edge {edge['id']}; keeping best-effort route until final repair.",
                    "edgeId": edge["id"],
                    "data": selected["failureBreakdown"],
                }
            )
        if selected["candidate"].get("outerLane"):
            logger.info(
                {
                    "phase": "route",
                    "type": "outer-lane-used",
                    "message": f"Outer lane {selected['candidate']['outerLane']} used for edge {edge['id']}.",
                    "edgeId": edge["id"],
                    "data": {"side": selected["candidate"]["outerLane"]},
                }
            )
        routed_edge = copy.deepcopy(anchored_edge_by_id[edge["id"]])
        routed_edge.setdefault("layout", {})["waypoints"] = selected["candidate"]["waypoints"]
        segment_strategy_by_edge_id[routed_edge["id"]] = strategy
        routed_edges.append(routed_edge)
        accepted_paths.append({"edge": routed_edge, "points": selected["candidate"]["points"]})

    repaired = (
        repair_routed_edges(
            routed_edges,
            accepted_paths,
            assignments,
            document,
            intent,
            logger,
            diagram_bounds,
            segment_strategy_by_edge_id,
        )
        if allow_sparse_recovery and intent["routing"]["maxRepairPasses"] > 0
        else {"edges": routed_edges, "paths": accepted_paths, "accepted": 0, "rejected": 0}
    )
    emit_final_fallback_events(repaired["edges"], repaired["paths"], document, logger, segment_strategy_by_edge_id)
    logger.debug(
        {
            "phase": "repair",
            "type": "repair-complete",
            "message": f"Route repair complete: {repaired['accepted']} accepted, {repaired['rejected']} rejected.",
            "data": {
                "accepted": repaired["accepted"],
                "rejected": repaired["rejected"],
                "maxRepairPasses": intent["routing"]["maxRepairPasses"] if include_outer_lanes else 0,
            },
        }
    )
    routed_edges_with_segments = apply_engine_owned_routed_segments(
        repaired["edges"], dividers, document["nodes"], segment_strategy_by_edge_id
    )
    return {"edges": routed_edges_with_segments, "dividers": dividers, "diagnostics": diagnostics}


def edge_with_anchors(assignment: dict[str, Any]) -> dict[str, Any]:
    edge = copy.deepcopy(assignment["edge"])
    edge["layout"] = {
        **edge.get("layout", {}),
        "sourceAnchor": assignment["sourceAnchor"],
        "targetAnchor": assignment["targetAnchor"],
        "routeSource": "engine-v2",
    }
    return edge


def assign_anchors(edges: list[dict[str, Any]], node_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    side_plans: list[dict[str, Any]] = []
    for edge in edges:
        source = require_node_rectangle(node_by_id[edge["sourceId"]])
        target = require_node_rectangle(node_by_id[edge["targetId"]])
        sides = choose_anchor_sides(source, target)
        side_plans.append({"edge": edge, "sourceSide": sides["source"], "targetSide": sides["target"]})
    endpoint_buckets: dict[str, list[dict[str, Any]]] = {}
    for plan in side_plans:
        source = require_node_rectangle(node_by_id[plan["edge"]["sourceId"]])
        target = require_node_rectangle(node_by_id[plan["edge"]["targetId"]])
        push_endpoint(endpoint_buckets, plan["edge"]["sourceId"], plan["sourceSide"], {"edge": plan["edge"], "role": "source", "side": plan["sourceSide"], "opposite": target})
        push_endpoint(endpoint_buckets, plan["edge"]["targetId"], plan["targetSide"], {"edge": plan["edge"], "role": "target", "side": plan["targetSide"], "opposite": source})
    anchor_by_endpoint: dict[str, dict[str, Any]] = {}
    for bucket in endpoint_buckets.values():
        ordered = sorted(
            bucket,
            key=lambda endpoint: (
                endpoint_sort_coordinate(endpoint["side"], endpoint["opposite"]),
                endpoint["edge"]["id"],
                endpoint["role"],
            ),
        )
        for index, endpoint in enumerate(ordered):
            anchor_by_endpoint[endpoint_key(endpoint["edge"]["id"], endpoint["role"])] = {
                "side": endpoint["side"],
                "ratio": round_ratio((index + 1) / (len(ordered) + 1)),
            }
    return [
        {
            "edge": plan["edge"],
            "sourceAnchor": anchor_by_endpoint[endpoint_key(plan["edge"]["id"], "source")],
            "targetAnchor": anchor_by_endpoint[endpoint_key(plan["edge"]["id"], "target")],
        }
        for plan in side_plans
    ]


def push_endpoint(
    buckets: dict[str, list[dict[str, Any]]],
    node_id: str,
    side: str,
    endpoint: dict[str, Any],
) -> None:
    key = f"{node_id}:{side}"
    buckets.setdefault(key, []).append(endpoint)


def choose_anchor_sides(source: dict[str, float], target: dict[str, float]) -> dict[str, str]:
    dx = center_x(target) - center_x(source)
    dy = center_y(target) - center_y(source)
    if abs(dx) >= abs(dy):
        return {"source": "east", "target": "west"} if dx > 0 else {"source": "west", "target": "east"}
    return {"source": "south", "target": "north"} if dy > 0 else {"source": "north", "target": "south"}


def endpoint_sort_coordinate(side: str, opposite: dict[str, float]) -> float:
    return center_y(opposite) if side in ["east", "west"] else center_x(opposite)


def route_candidates_for_anchors(
    edge_id: str,
    edge_index: int,
    source: dict[str, Any],
    target: dict[str, Any],
    source_anchor: dict[str, Any],
    target_anchor: dict[str, Any],
    bounds: dict[str, float],
    outer_lane_margin: float,
    include_outer_lanes: bool,
) -> list[dict[str, Any]]:
    source_point = anchor_point(source, source_anchor)
    target_point = anchor_point(target, target_anchor)
    source_port = outside_port(source_point, source_anchor, 0)
    target_port = outside_port(target_point, target_anchor, 0)
    mid_x = (source_port["x"] + target_port["x"]) / 2
    mid_y = (source_port["y"] + target_port["y"]) / 2
    base_candidates: list[dict[str, Any]] = []
    for offset in deterministic_private_offsets(edge_id, edge_index):
        x_lane = mid_x + offset
        y_lane = mid_y + offset
        x_lane_a = source_port["x"] + offset
        x_lane_b = target_port["x"] - offset
        y_lane_a = source_port["y"] + offset
        y_lane_b = target_port["y"] - offset
        base_candidates.extend(
            [
                points_to_route([source_point, source_port, point(x_lane, source_port["y"]), point(x_lane, target_port["y"]), target_port, target_point]),
                points_to_route([source_point, source_port, point(source_port["x"], y_lane), point(target_port["x"], y_lane), target_port, target_point]),
                points_to_route([source_point, source_port, point(x_lane_a, source_port["y"]), point(x_lane_a, y_lane), point(x_lane_b, y_lane), point(x_lane_b, target_port["y"]), target_port, target_point]),
                points_to_route([source_point, source_port, point(source_port["x"], y_lane_a), point(x_lane, y_lane_a), point(x_lane, y_lane_b), point(target_port["x"], y_lane_b), target_port, target_point]),
            ]
        )
    if not include_outer_lanes:
        return unique_routes(base_candidates)
    outer_candidates: list[dict[str, Any]] = []
    for lane_index in range(6):
        for lane in [
            {"side": "west", "x": bounds["left"] - outer_lane_margin - ANCHOR_STUB_DISTANCE * lane_index},
            {"side": "east", "x": bounds["right"] + outer_lane_margin + ANCHOR_STUB_DISTANCE * lane_index},
        ]:
            candidate = points_to_route([source_point, source_port, point(lane["x"], source_port["y"]), point(lane["x"], target_port["y"]), target_port, target_point])
            candidate.update({"outerLane": lane["side"], "outerLaneIndex": lane_index + 1})
            outer_candidates.append(candidate)
        for lane in [
            {"side": "north", "y": bounds["top"] - outer_lane_margin - ANCHOR_STUB_DISTANCE * lane_index},
            {"side": "south", "y": bounds["bottom"] + outer_lane_margin + ANCHOR_STUB_DISTANCE * lane_index},
        ]:
            candidate = points_to_route([source_point, source_port, point(source_port["x"], lane["y"]), point(target_port["x"], lane["y"]), target_port, target_point])
            candidate.update({"outerLane": lane["side"], "outerLaneIndex": lane_index + 1})
            outer_candidates.append(candidate)
    return unique_routes(base_candidates + outer_candidates)


def points_to_route(points: list[dict[str, float]]) -> dict[str, Any]:
    source_stub = points[1] if len(points) > 1 else None
    target_stub = points[-2] if len(points) > 1 else None
    compacted = preserve_terminal_stubs(compact_orthogonal_points(points), source_stub, target_stub)
    return {"points": compacted, "waypoints": compacted[1:-1]}


def preserve_terminal_stubs(
    points: list[dict[str, float]], source_stub: dict[str, float] | None, target_stub: dict[str, float] | None
) -> list[dict[str, float]]:
    next_points = list(points)
    if source_stub is not None and len(next_points) >= 2 and not points_equal(next_points[1], source_stub):
        next_points.insert(1, source_stub)
    if target_stub is not None and len(next_points) >= 2 and not points_equal(next_points[-2], target_stub):
        next_points.insert(len(next_points) - 1, target_stub)
    return [p for index, p in enumerate(next_points) if index == 0 or not points_equal(p, next_points[index - 1])]


def select_route_candidate(
    edge: dict[str, Any],
    candidates: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
    recovery: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scored = []
    for candidate in candidates:
        breakdown = route_hard_failure_breakdown(edge, candidate["points"], nodes, accepted_paths)
        scored.append(
            {
                "candidate": candidate,
                "failureBreakdown": breakdown,
                "hardFailures": breakdown["hardFailures"],
                "score": route_cost(edge, candidate, nodes, accepted_paths),
            }
        )
    valid_templates = [candidate for candidate in scored if candidate["hardFailures"] == 0]
    best_valid_template = min(valid_templates, key=lambda c: c["score"]) if valid_templates else None
    should_try_recovery = bool(recovery and recovery.get("includeRecovery")) and (
        best_valid_template is None or count_crossings_with_accepted(best_valid_template["candidate"]["points"], accepted_paths) > 0
    )
    if should_try_recovery and recovery and recovery.get("onAttempt"):
        recovery["onAttempt"]()
    recovery_scored = score_recovery_candidate(edge, nodes, accepted_paths, recovery) if should_try_recovery and recovery else None
    all_scored = scored + ([recovery_scored] if recovery_scored else [])
    valid = [candidate for candidate in all_scored if candidate["hardFailures"] == 0]
    if valid:
        selected = min(valid, key=lambda c: c["score"])
        return {**selected, "validCandidates": len(valid), "recovered": bool(selected["candidate"].get("recovery"))}
    selected = min(all_scored, key=lambda c: c["score"])
    return {**selected, "validCandidates": 0, "recovered": False}


def score_recovery_candidate(
    edge: dict[str, Any],
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
    recovery: dict[str, Any],
) -> dict[str, Any] | None:
    recovered = recover_sparse_lane_route(
        edge,
        recovery["source"],
        recovery["target"],
        recovery["sourceAnchor"],
        recovery["targetAnchor"],
        recovery["bounds"],
        recovery["outerLaneMargin"],
        nodes,
        accepted_paths,
    )
    if not recovered:
        return None
    breakdown = route_hard_failure_breakdown(edge, recovered["points"], nodes, accepted_paths)
    return {
        "candidate": recovered,
        "failureBreakdown": breakdown,
        "hardFailures": breakdown["hardFailures"],
        "score": route_cost(edge, recovered, nodes, accepted_paths),
    }


def recover_sparse_lane_route(
    edge: dict[str, Any],
    source: dict[str, Any],
    target: dict[str, Any],
    source_anchor: dict[str, Any],
    target_anchor: dict[str, Any],
    bounds: dict[str, float],
    outer_lane_margin: float,
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
) -> dict[str, Any] | None:
    source_point = anchor_point(source, source_anchor)
    target_point = anchor_point(target, target_anchor)
    source_port = outside_port(source_point, source_anchor, 0)
    target_port = outside_port(target_point, target_anchor, 0)
    x_lines = bounded_lane_lines(
        lane_graph_x_lines(source_port, target_port, source, target, bounds, outer_lane_margin, nodes),
        source_port["x"],
        target_port["x"],
    )
    y_lines = bounded_lane_lines(
        lane_graph_y_lines(source_port, target_port, source, target, bounds, outer_lane_margin, nodes),
        source_port["y"],
        target_port["y"],
    )
    if len(x_lines) * len(y_lines) > LANE_GRAPH_SEARCH_NODE_LIMIT:
        return None
    graph = build_lane_graph(edge, x_lines, y_lines, nodes, accepted_paths)
    start_key = point_key(source_port)
    end_key = point_key(target_port)
    if start_key not in graph["points"] or end_key not in graph["points"]:
        return None
    path = shortest_lane_path(graph, start_key, end_key)
    if not path:
        return None
    candidate = points_to_route([source_point] + path + [target_point])
    candidate["recovery"] = True
    return candidate


def lane_graph_x_lines(
    source_port: dict[str, float],
    target_port: dict[str, float],
    source: dict[str, Any],
    target: dict[str, Any],
    bounds: dict[str, float],
    outer_lane_margin: float,
    nodes: list[dict[str, Any]],
) -> list[float]:
    lines = [
        source_port["x"],
        target_port["x"],
        (source_port["x"] + target_port["x"]) / 2,
        source["x"] - LANE_GRAPH_CLEARANCE,
        source["x"] + source["width"] + LANE_GRAPH_CLEARANCE,
        target["x"] - LANE_GRAPH_CLEARANCE,
        target["x"] + target["width"] + LANE_GRAPH_CLEARANCE,
        bounds["left"] - outer_lane_margin,
        bounds["right"] + outer_lane_margin,
    ]
    for index in range(1, 5):
        lines.append(bounds["left"] - outer_lane_margin - index * ANCHOR_STUB_DISTANCE)
        lines.append(bounds["right"] + outer_lane_margin + index * ANCHOR_STUB_DISTANCE)
    for node in nodes:
        layout = node.get("layout")
        if not layout:
            continue
        lines.extend([layout["x"] - LANE_GRAPH_CLEARANCE, layout["x"] + layout["width"] + LANE_GRAPH_CLEARANCE, layout["x"] + layout["width"] / 2])
    for offset in deterministic_private_offsets(f"{source['id']}:{target['id']}", 0):
        lines.extend([source_port["x"] + offset, target_port["x"] + offset, (source_port["x"] + target_port["x"]) / 2 + offset])
    return unique_sorted_numbers(lines)


def lane_graph_y_lines(
    source_port: dict[str, float],
    target_port: dict[str, float],
    source: dict[str, Any],
    target: dict[str, Any],
    bounds: dict[str, float],
    outer_lane_margin: float,
    nodes: list[dict[str, Any]],
) -> list[float]:
    lines = [
        source_port["y"],
        target_port["y"],
        (source_port["y"] + target_port["y"]) / 2,
        source["y"] - LANE_GRAPH_CLEARANCE,
        source["y"] + source["height"] + LANE_GRAPH_CLEARANCE,
        target["y"] - LANE_GRAPH_CLEARANCE,
        target["y"] + target["height"] + LANE_GRAPH_CLEARANCE,
        bounds["top"] - outer_lane_margin,
        bounds["bottom"] + outer_lane_margin,
    ]
    for index in range(1, 5):
        lines.append(bounds["top"] - outer_lane_margin - index * ANCHOR_STUB_DISTANCE)
        lines.append(bounds["bottom"] + outer_lane_margin + index * ANCHOR_STUB_DISTANCE)
    for node in nodes:
        layout = node.get("layout")
        if not layout:
            continue
        lines.extend([layout["y"] - LANE_GRAPH_CLEARANCE, layout["y"] + layout["height"] + LANE_GRAPH_CLEARANCE, layout["y"] + layout["height"] / 2])
    for offset in deterministic_private_offsets(f"{source['id']}:{target['id']}", 0):
        lines.extend([source_port["y"] + offset, target_port["y"] + offset, (source_port["y"] + target_port["y"]) / 2 + offset])
    return unique_sorted_numbers(lines)


def bounded_lane_lines(lines: list[float], start: float, end: float) -> list[float]:
    sorted_lines = unique_sorted_numbers(lines + [start, end])
    if len(sorted_lines) <= LANE_GRAPH_MAX_LINES_PER_AXIS:
        return sorted_lines
    center = (start + end) / 2
    required = {round_coordinate(start), round_coordinate(end)}
    entries = [
        {
            "value": value,
            "required": round_coordinate(value) in required,
            "distance": min(abs(value - start), abs(value - end), abs(value - center)),
        }
        for value in sorted_lines
    ]
    entries.sort(key=lambda item: (-int(item["required"]), item["distance"], item["value"]))
    return sorted(item["value"] for item in entries[:LANE_GRAPH_MAX_LINES_PER_AXIS])


def build_lane_graph(
    edge: dict[str, Any],
    x_lines: list[float],
    y_lines: list[float],
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
) -> dict[str, Any]:
    points: dict[str, dict[str, float]] = {}
    adjacency: dict[str, list[dict[str, Any]]] = {}
    for x in x_lines:
        for y in y_lines:
            lane_point = point(x, y)
            if not point_inside_blocked_node(edge, lane_point, nodes):
                points[point_key(lane_point)] = lane_point
    for x in x_lines:
        column = sorted([points[point_key(point(x, y))] for y in y_lines if point_key(point(x, y)) in points], key=lambda p: p["y"])
        connect_adjacent_lane_points(edge, column, "v", nodes, accepted_paths, adjacency)
    for y in y_lines:
        row = sorted([points[point_key(point(x, y))] for x in x_lines if point_key(point(x, y)) in points], key=lambda p: p["x"])
        connect_adjacent_lane_points(edge, row, "h", nodes, accepted_paths, adjacency)
    return {"points": points, "adjacency": adjacency}


def connect_adjacent_lane_points(
    edge: dict[str, Any],
    points: list[dict[str, float]],
    axis: str,
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
    adjacency: dict[str, list[dict[str, Any]]],
) -> None:
    for index in range(len(points) - 1):
        start = points[index]
        end = points[index + 1]
        if lane_segment_blocked(edge, start, end, nodes, accepted_paths):
            continue
        start_key = point_key(start)
        end_key = point_key(end)
        length = abs(start["x"] - end["x"]) + abs(start["y"] - end["y"])
        crossings = segment_crossings_with_accepted(start, end, accepted_paths)
        adjacency.setdefault(start_key, []).append({"key": end_key, "axis": axis, "length": length, "crossings": crossings})
        adjacency.setdefault(end_key, []).append({"key": start_key, "axis": axis, "length": length, "crossings": crossings})


def shortest_lane_path(graph: dict[str, Any], start_key: str, end_key: str) -> list[dict[str, float]] | None:
    start_state = (start_key, "none")
    distances = {start_state: 0.0}
    previous: dict[tuple[str, str], tuple[str, str]] = {}
    queue: list[tuple[float, str, str]] = [(0.0, start_key, "none")]
    best_end_state: tuple[str, str] | None = None
    while queue:
        current_distance, key, axis = heapq.heappop(queue)
        state = (key, axis)
        if current_distance > distances.get(state, math.inf) + EPSILON:
            continue
        if key == end_key:
            best_end_state = state
            break
        for item in graph["adjacency"].get(key, []):
            next_state = (item["key"], item["axis"])
            bend_cost = 10000 if axis != "none" and axis != item["axis"] else 0
            next_distance = current_distance + item["length"] + bend_cost + item["crossings"] * 1_000_000
            if next_distance + EPSILON >= distances.get(next_state, math.inf):
                continue
            distances[next_state] = next_distance
            previous[next_state] = state
            heapq.heappush(queue, (next_distance, next_state[0], next_state[1]))
    if best_end_state is None:
        return None
    keys: list[str] = []
    cursor: tuple[str, str] | None = best_end_state
    while cursor is not None:
        keys.append(cursor[0])
        cursor = previous.get(cursor)
    return [graph["points"][key] for key in reversed(keys)]


def repair_routed_edges(
    routed_edges: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    document: dict[str, Any],
    intent: dict[str, Any],
    logger: MemoryLayoutLogger,
    diagram_bounds: dict[str, float],
    segment_strategy_by_edge_id: dict[str, str],
) -> dict[str, Any]:
    assignment_by_edge_id = {assignment["edge"]["id"]: assignment for assignment in assignments}
    node_by_id = {node["id"]: node for node in document["nodes"]}
    current_edges = list(routed_edges)
    current_paths = list(accepted_paths)
    total_accepted = 0
    total_rejected = 0
    for pass_index in range(1, intent["routing"]["maxRepairPasses"] + 1):
        accepted_in_pass = 0
        for edge in list(current_edges):
            assignment = assignment_by_edge_id.get(edge["id"])
            current_path = next((path for path in current_paths if path["edge"]["id"] == edge["id"]), None)
            if not assignment or not current_path:
                continue
            source = require_node_rectangle(node_by_id[edge["sourceId"]])
            target = require_node_rectangle(node_by_id[edge["targetId"]])
            other_paths = [path for path in current_paths if path["edge"]["id"] != edge["id"]]
            current_candidate = {"points": current_path["points"], "waypoints": edge.get("layout", {}).get("waypoints", [])}
            current_hard_failures = route_hard_failure_breakdown(edge, current_candidate["points"], document["nodes"], other_paths)["hardFailures"]
            current_score = route_cost(edge, current_candidate, document["nodes"], other_paths)

            def on_attempt(edge_id: str = edge["id"]) -> None:
                logger.debug(
                    {
                        "phase": "repair",
                        "type": "routing-recovery-attempted",
                        "message": f"Sparse lane-graph recovery attempted for edge {edge_id} during repair.",
                        "edgeId": edge_id,
                    }
                )

            selected = select_route_candidate(
                edge,
                route_candidates_for_anchors(
                    edge["id"],
                    next((i for i, candidate in enumerate(current_edges) if candidate["id"] == edge["id"]), 0),
                    source,
                    target,
                    assignment["sourceAnchor"],
                    assignment["targetAnchor"],
                    diagram_bounds,
                    intent["routing"]["outerLaneMargin"],
                    True,
                ),
                document["nodes"],
                other_paths,
                {
                    "includeRecovery": True,
                    "source": source,
                    "target": target,
                    "sourceAnchor": assignment["sourceAnchor"],
                    "targetAnchor": assignment["targetAnchor"],
                    "bounds": diagram_bounds,
                    "outerLaneMargin": intent["routing"]["outerLaneMargin"],
                    "onAttempt": on_attempt,
                },
            )
            improves_hard = selected["hardFailures"] < current_hard_failures
            improves_soft = (
                selected["hardFailures"] == current_hard_failures
                and selected["score"] + EPSILON < current_score
                and not routes_equal(selected["candidate"]["points"], current_candidate["points"])
            )
            if improves_hard or improves_soft:
                repaired_edge = copy.deepcopy(edge)
                repaired_edge.setdefault("layout", {})["waypoints"] = selected["candidate"]["waypoints"]
                current_edges = [repaired_edge if candidate["id"] == edge["id"] else candidate for candidate in current_edges]
                current_paths = [
                    {"edge": repaired_edge, "points": selected["candidate"]["points"]} if path["edge"]["id"] == edge["id"] else path
                    for path in current_paths
                ]
                segment_strategy_by_edge_id[edge["id"]] = (
                    "fallback"
                    if selected["hardFailures"] > 0
                    else "corridor"
                    if selected["candidate"].get("recovery")
                    else "outer-lane"
                    if selected["candidate"].get("outerLane")
                    else "corridor"
                )
                accepted_in_pass += 1
                total_accepted += 1
                logger.info(
                    {
                        "phase": "repair",
                        "type": "route-repair-accepted",
                        "message": f"Route repair accepted for edge {edge['id']}.",
                        "edgeId": edge["id"],
                        "data": {"pass": pass_index, "previousHardFailures": current_hard_failures, "nextHardFailures": selected["hardFailures"]},
                    }
                )
            else:
                total_rejected += 1
                logger.debug(
                    {
                        "phase": "repair",
                        "type": "route-repair-rejected",
                        "message": f"Route repair rejected for edge {edge['id']}; existing route is not worse than alternatives.",
                        "edgeId": edge["id"],
                        "data": {"pass": pass_index, "hardFailures": current_hard_failures, "validCandidates": selected["validCandidates"]},
                    }
                )
        if accepted_in_pass == 0:
            break
    return {"edges": current_edges, "paths": current_paths, "accepted": total_accepted, "rejected": total_rejected}


def emit_final_fallback_events(
    edges: list[dict[str, Any]],
    paths: list[dict[str, Any]],
    document: dict[str, Any],
    logger: MemoryLayoutLogger,
    segment_strategy_by_edge_id: dict[str, str],
) -> None:
    for edge in edges:
        if segment_strategy_by_edge_id.get(edge["id"]) == "divider":
            continue
        path = next((candidate for candidate in paths if candidate["edge"]["id"] == edge["id"]), None)
        if not path:
            logger.warn({"phase": "route", "type": "routing-failed", "message": f"No routed path produced for edge {edge['id']}.", "edgeId": edge["id"]})
            continue
        other_paths = [candidate for candidate in paths if candidate["edge"]["id"] != edge["id"]]
        breakdown = route_hard_failure_breakdown(edge, path["points"], document["nodes"], other_paths)
        if breakdown["hardFailures"] == 0 and segment_strategy_by_edge_id.get(edge["id"]) != "fallback":
            continue
        logger.warn(
            {
                "phase": "route",
                "type": "routing-fallback-used",
                "message": f"Recovery routing failed for edge {edge['id']}; selected final best-effort route.",
                "edgeId": edge["id"],
                "data": breakdown,
            }
        )


def route_plan_difficulty(assignment: dict[str, Any], nodes: list[dict[str, Any]], assignments: list[dict[str, Any]]) -> float:
    source_node = next((node for node in nodes if node["id"] == assignment["edge"]["sourceId"]), None)
    target_node = next((node for node in nodes if node["id"] == assignment["edge"]["targetId"]), None)
    if not source_node or not target_node or not source_node.get("layout") or not target_node.get("layout"):
        return 0
    source = require_node_rectangle(source_node)
    target = require_node_rectangle(target_node)
    source_center = point(center_x(source), center_y(source))
    target_center = point(center_x(target), center_y(target))
    obstacle_count = sum(
        1
        for node in nodes
        if node["id"] not in [assignment["edge"]["sourceId"], assignment["edge"]["targetId"]]
        and node.get("layout")
        and segment_intersects_rectangle(source_center, target_center, expand_rectangle(node["layout"], LANE_GRAPH_CLEARANCE / 2))
    )
    degree = sum(
        1
        for candidate in assignments
        if candidate["edge"]["sourceId"] in [assignment["edge"]["sourceId"], assignment["edge"]["targetId"]]
        or candidate["edge"]["targetId"] in [assignment["edge"]["sourceId"], assignment["edge"]["targetId"]]
    )
    distance_value = abs(source_center["x"] - target_center["x"]) + abs(source_center["y"] - target_center["y"])
    return obstacle_count * 1_000_000 + degree * 10_000 + distance_value


def plan_routing_dividers(
    edges: list[dict[str, Any]], nodes: list[dict[str, Any]], threshold: int, logger: MemoryLayoutLogger
) -> list[dict[str, Any]]:
    node_by_id = {node["id"]: node for node in nodes}
    used_edge_ids: set[str] = set()
    dividers: list[dict[str, Any]] = []
    groups = [
        {"mode": "fanOut", "commonNodeId": common, "edges": bucket}
        for common, bucket in group_edges_by_endpoint(edges, "sourceId")
    ] + [
        {"mode": "fanIn", "commonNodeId": common, "edges": bucket}
        for common, bucket in group_edges_by_endpoint(edges, "targetId")
    ]
    for group in groups:
        effective_threshold = max(threshold, 4)
        if len(group["edges"]) <= effective_threshold:
            logger.debug(
                {
                    "phase": "divider",
                    "type": "divider-candidate-rejected",
                    "message": f"Divider candidate for {group['commonNodeId']} rejected at or below threshold.",
                    "nodeId": group["commonNodeId"],
                    "data": {"mode": group["mode"], "edgeCount": len(group["edges"]), "threshold": effective_threshold},
                }
            )
            continue
        if any(edge["id"] in used_edge_ids for edge in group["edges"]):
            logger.debug(
                {
                    "phase": "divider",
                    "type": "divider-candidate-rejected",
                    "message": f"Divider candidate for {group['commonNodeId']} rejected because an edge is already claimed.",
                    "nodeId": group["commonNodeId"],
                    "data": {"mode": group["mode"]},
                }
            )
            continue
        divider = materialize_divider(group, node_by_id, len(dividers))
        if not divider:
            continue
        dividers.append(divider)
        for edge in group["edges"]:
            used_edge_ids.add(edge["id"])
        logger.info(
            {
                "phase": "divider",
                "type": "divider-created",
                "message": f"{group['mode']} routing divider created for {group['commonNodeId']}.",
                "dividerId": divider["id"],
                "nodeId": group["commonNodeId"],
                "data": {"edgeIds": [edge["id"] for edge in group["edges"]]},
            }
        )
    return dividers


def group_edges_by_endpoint(edges: list[dict[str, Any]], endpoint: str) -> list[tuple[str, list[dict[str, Any]]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for edge in edges:
        groups.setdefault(edge[endpoint], []).append(edge)
    return list(groups.items())


def materialize_divider(group: dict[str, Any], node_by_id: dict[str, dict[str, Any]], index: int) -> dict[str, Any] | None:
    common_node = node_by_id.get(group["commonNodeId"])
    if not common_node or not common_node.get("layout"):
        return None
    other_nodes = [
        node_by_id.get(edge["targetId"] if group["mode"] == "fanOut" else edge["sourceId"])
        for edge in group["edges"]
    ]
    other_nodes = [node for node in other_nodes if node and node.get("layout")]
    if not other_nodes:
        return None
    common = require_node_rectangle(common_node)
    cluster = rectangle_bounds([require_node_rectangle(node) for node in other_nodes])
    dx = center_x(cluster) - center_x(common)
    dy = center_y(cluster) - center_y(common)
    side = ("west" if dx > 0 else "east") if abs(dx) >= abs(dy) else ("north" if dy > 0 else "south")
    orientation = "vertical" if side in ["west", "east"] else "horizontal"
    offset = ANCHOR_STUB_DISTANCE + ROUTING_DIVIDER_THICKNESS
    if orientation == "vertical":
        layout = {
            "x": cluster["left"] - offset if side == "west" else cluster["right"] + ANCHOR_STUB_DISTANCE,
            "y": cluster["top"],
            "width": ROUTING_DIVIDER_THICKNESS,
            "height": max(ROUTING_DIVIDER_MIN_LENGTH, cluster["bottom"] - cluster["top"]),
        }
    else:
        layout = {
            "x": cluster["left"],
            "y": cluster["top"] - offset if side == "north" else cluster["bottom"] + ANCHOR_STUB_DISTANCE,
            "width": max(ROUTING_DIVIDER_MIN_LENGTH, cluster["right"] - cluster["left"]),
            "height": ROUTING_DIVIDER_THICKNESS,
        }
    return {
        "id": f"routing_divider_{index + 1}_{group['mode']}_{group['commonNodeId']}_{side}",
        "orientation": orientation,
        "side": side,
        "sourceEdgeIds": [edge["id"] for edge in group["edges"]],
        "mode": group["mode"],
        "layout": layout,
    }


def apply_engine_owned_routed_segments(
    edges: list[dict[str, Any]],
    dividers: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    segment_strategy_by_edge_id: dict[str, str],
) -> list[dict[str, Any]]:
    edge_by_id = {edge["id"]: edge for edge in edges}
    segments_by_edge_id: dict[str, list[dict[str, Any]]] = {}
    divider_edge_ids = {edge_id for divider in dividers for edge_id in divider["sourceEdgeIds"]}
    occupancy = [
        {"edge": edge, "points": edge_route_points(edge, nodes)}
        for edge in edges
        if edge["id"] not in divider_edge_ids
    ]
    occupancy = [path for path in occupancy if len(path["points"]) >= 2]
    bounds = rectangle_bounds([require_node_rectangle(node) for node in nodes])
    for divider in dividers:
        divider_edges = [edge_by_id[edge_id] for edge_id in divider["sourceEdgeIds"] if edge_id in edge_by_id]
        for item in split_divider_segments(divider, divider_edges, nodes, occupancy, bounds):
            segments_by_edge_id.setdefault(item["edge"]["id"], []).append(item["segment"])
    output = []
    for edge in edges:
        routed_segments = segments_by_edge_id.get(edge["id"], [direct_routed_segment(edge, segment_strategy_by_edge_id.get(edge["id"], "direct"))])
        next_edge = copy.deepcopy(edge)
        next_edge["layout"] = {**next_edge.get("layout", {}), "routeSource": "engine-v2", "routedSegments": routed_segments}
        output.append(next_edge)
    return output


def build_divider_occupancy_paths(
    dividers: list[dict[str, Any]],
    edge_by_id: dict[str, dict[str, Any]],
    nodes: list[dict[str, Any]],
    bounds: dict[str, float],
) -> list[dict[str, Any]]:
    occupancy: list[dict[str, Any]] = []
    for divider in dividers:
        divider_edges = [edge_by_id[edge_id] for edge_id in divider["sourceEdgeIds"] if edge_id in edge_by_id]
        split_divider_segments(divider, divider_edges, nodes, occupancy, bounds)
    return occupancy


def direct_routed_segment(edge: dict[str, Any], strategy: str) -> dict[str, Any]:
    return {
        "id": f"{edge['id']}:direct",
        "sourceId": edge["sourceId"],
        "targetId": edge["targetId"],
        "label": edge.get("label", ""),
        "sourceAnchor": edge.get("layout", {}).get("sourceAnchor"),
        "targetAnchor": edge.get("layout", {}).get("targetAnchor"),
        "waypoints": edge.get("layout", {}).get("waypoints", []),
        "markerPolicy": {"start": True, "end": True},
        "strategy": strategy,
    }


def split_divider_segments(
    divider: dict[str, Any],
    edges: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    occupancy: list[dict[str, Any]],
    bounds: dict[str, float],
) -> list[dict[str, Any]]:
    return fan_out_divider_segments(divider, edges, nodes, occupancy, bounds) if divider["mode"] == "fanOut" else fan_in_divider_segments(divider, edges, nodes, occupancy, bounds)


def fan_out_divider_segments(
    divider: dict[str, Any],
    edges: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    occupancy: list[dict[str, Any]],
    bounds: dict[str, float],
) -> list[dict[str, Any]]:
    if not edges:
        return []
    first_edge = edges[0]
    source_anchor = shared_class_anchor(edges, "source") or class_anchor_toward_divider(first_edge, "source", divider)
    divider_input_anchor = divider_outer_anchor(divider)
    ordered_leaves = order_edges_for_divider(divider, edges, "target", opposite_side(divider["side"]), nodes)
    trunk = create_divider_segment(first_edge, f"{first_edge['id']}:divider-trunk", first_edge["sourceId"], divider["id"], "", source_anchor, divider_input_anchor, {"start": True, "end": False}, nodes, divider, occupancy, bounds)
    occupancy.append({"edge": {**first_edge, "id": trunk["segment"]["id"], "sourceId": trunk["segment"]["sourceId"], "targetId": trunk["segment"]["targetId"]}, "points": trunk["points"]})
    results = [{"edge": first_edge, "segment": trunk["segment"], "points": trunk["points"]}]
    for item in ordered_leaves:
        edge = item["edge"]
        divider_anchor = item["dividerAnchor"]
        leaf = create_divider_segment(edge, f"{edge['id']}:divider-leaf", divider["id"], edge["targetId"], edge.get("label", ""), divider_anchor, class_anchor_for_divider_side(edge, "target", divider_anchor["side"]), {"start": False, "end": True}, nodes, divider, occupancy, bounds)
        occupancy.append({"edge": {**edge, "id": leaf["segment"]["id"], "sourceId": leaf["segment"]["sourceId"], "targetId": leaf["segment"]["targetId"]}, "points": leaf["points"]})
        results.append({"edge": edge, "segment": leaf["segment"], "points": leaf["points"]})
    return results


def fan_in_divider_segments(
    divider: dict[str, Any],
    edges: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    occupancy: list[dict[str, Any]],
    bounds: dict[str, float],
) -> list[dict[str, Any]]:
    if not edges:
        return []
    first_edge = edges[0]
    target_anchor = shared_class_anchor(edges, "target") or class_anchor_toward_divider(first_edge, "target", divider)
    divider_output_anchor = divider_outer_anchor(divider)
    ordered_leaves = order_edges_for_divider(divider, edges, "source", opposite_side(divider["side"]), nodes)
    results = []
    for item in ordered_leaves:
        edge = item["edge"]
        divider_anchor = item["dividerAnchor"]
        leaf = create_divider_segment(edge, f"{edge['id']}:divider-leaf", edge["sourceId"], divider["id"], edge.get("label", ""), class_anchor_for_divider_side(edge, "source", divider_anchor["side"]), divider_anchor, {"start": True, "end": False}, nodes, divider, occupancy, bounds)
        occupancy.append({"edge": {**edge, "id": leaf["segment"]["id"], "sourceId": leaf["segment"]["sourceId"], "targetId": leaf["segment"]["targetId"]}, "points": leaf["points"]})
        results.append({"edge": edge, "segment": leaf["segment"], "points": leaf["points"]})
    trunk = create_divider_segment(first_edge, f"{first_edge['id']}:divider-trunk", divider["id"], first_edge["targetId"], "", divider_output_anchor, target_anchor, {"start": False, "end": True}, nodes, divider, occupancy, bounds)
    occupancy.append({"edge": {**first_edge, "id": trunk["segment"]["id"], "sourceId": trunk["segment"]["sourceId"], "targetId": trunk["segment"]["targetId"]}, "points": trunk["points"]})
    results.append({"edge": first_edge, "segment": trunk["segment"], "points": trunk["points"]})
    return results


def create_divider_segment(
    edge: dict[str, Any],
    segment_id: str,
    source_id: str,
    target_id: str,
    label: str,
    source_anchor: dict[str, Any],
    target_anchor: dict[str, Any],
    marker_policy: dict[str, bool],
    nodes: list[dict[str, Any]],
    divider: dict[str, Any],
    occupancy: list[dict[str, Any]],
    bounds: dict[str, float],
) -> dict[str, Any]:
    source = endpoint_rectangle(source_id, nodes, divider)
    target = endpoint_rectangle(target_id, nodes, divider)
    segment_edge = {**edge, "id": segment_id, "sourceId": source_id, "targetId": target_id}
    selected = select_route_candidate(
        segment_edge,
        route_candidates_for_anchors(
            segment_id,
            stable_hash(segment_id) % 997,
            source,
            target,
            source_anchor,
            target_anchor,
            bounds,
            max(ANCHOR_STUB_DISTANCE * 4, LANE_GRAPH_CLEARANCE * 2),
            True,
        ),
        nodes,
        occupancy,
        {
            "includeRecovery": False,
            "source": source,
            "target": target,
            "sourceAnchor": source_anchor,
            "targetAnchor": target_anchor,
            "bounds": bounds,
            "outerLaneMargin": max(ANCHOR_STUB_DISTANCE * 4, LANE_GRAPH_CLEARANCE * 2),
        },
    )
    return {
        "segment": {
            "id": segment_id,
            "sourceId": source_id,
            "targetId": target_id,
            "label": label,
            "sourceAnchor": source_anchor,
            "targetAnchor": target_anchor,
            "waypoints": selected["candidate"]["waypoints"],
            "markerPolicy": marker_policy,
            "strategy": "divider",
        },
        "points": selected["candidate"]["points"],
    }


def edge_route_points(edge: dict[str, Any], nodes: list[dict[str, Any]]) -> list[dict[str, float]]:
    source = next((node for node in nodes if node["id"] == edge["sourceId"]), None)
    target = next((node for node in nodes if node["id"] == edge["targetId"]), None)
    layout = edge.get("layout", {})
    if not source or not target or not source.get("layout") or not target.get("layout") or not layout.get("sourceAnchor") or not layout.get("targetAnchor"):
        return []
    return [
        anchor_point(require_node_rectangle(source), layout["sourceAnchor"]),
        *layout.get("waypoints", []),
        anchor_point(require_node_rectangle(target), layout["targetAnchor"]),
    ]


def endpoint_rectangle(endpoint_id: str, nodes: list[dict[str, Any]], divider: dict[str, Any]) -> dict[str, Any]:
    if endpoint_id == divider["id"]:
        layout = divider["layout"]
        return {"id": divider["id"], "x": layout["x"], "y": layout["y"], "width": layout["width"], "height": layout["height"]}
    node = next((candidate for candidate in nodes if candidate["id"] == endpoint_id), None)
    if not node:
        raise ValueError(f"Missing endpoint {endpoint_id}.")
    return require_node_rectangle(node)


def order_edges_for_divider(
    divider: dict[str, Any], edges: list[dict[str, Any]], class_endpoint: str, divider_side: str, nodes: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    sorted_edges = sorted(edges, key=lambda edge: (divider_sort_coordinate(edge, class_endpoint, divider, nodes), edge["id"]))
    return [
        {"edge": edge, "dividerAnchor": {"side": divider_side, "ratio": round_ratio((index + 1) / (len(sorted_edges) + 1))}}
        for index, edge in enumerate(sorted_edges)
    ]


def divider_sort_coordinate(edge: dict[str, Any], class_endpoint: str, divider: dict[str, Any], nodes: list[dict[str, Any]]) -> float:
    node_id = edge["sourceId"] if class_endpoint == "source" else edge["targetId"]
    node = next((candidate for candidate in nodes if candidate["id"] == node_id), None)
    if not node or not node.get("layout"):
        anchor = edge.get("layout", {}).get("sourceAnchor" if class_endpoint == "source" else "targetAnchor")
        return anchor.get("ratio", 0.5) if anchor else 0.5
    return center_y(require_node_rectangle(node)) if divider["orientation"] == "vertical" else center_x(require_node_rectangle(node))


def divider_outer_anchor(divider: dict[str, Any]) -> dict[str, Any]:
    return {"side": divider["side"], "ratio": 0.5}


def class_anchor_toward_divider(edge: dict[str, Any], endpoint: str, divider: dict[str, Any]) -> dict[str, Any]:
    anchor = edge.get("layout", {}).get("sourceAnchor" if endpoint == "source" else "targetAnchor")
    return anchor if anchor else {"side": opposite_side(divider["side"]), "ratio": 0.5}


def class_anchor_for_divider_side(edge: dict[str, Any], endpoint: str, divider_side: str) -> dict[str, Any]:
    desired_side = opposite_side(divider_side)
    existing = edge.get("layout", {}).get("sourceAnchor" if endpoint == "source" else "targetAnchor")
    return {"side": desired_side, "ratio": existing["ratio"] if existing and existing["side"] == desired_side else stable_anchor_ratio(edge["id"])}


def shared_class_anchor(edges: list[dict[str, Any]], endpoint: str) -> dict[str, Any] | None:
    anchors = [edge.get("layout", {}).get("sourceAnchor" if endpoint == "source" else "targetAnchor") for edge in edges]
    anchors = [anchor for anchor in anchors if anchor]
    if not anchors:
        return None
    side = anchors[0]["side"]
    if not all(anchor["side"] == side for anchor in anchors):
        return anchors[0]
    return {"side": side, "ratio": 0.5}


def optimize_generated_routing_intent(
    document: dict[str, Any],
    intent: dict[str, Any],
    include_outer_lanes: bool,
    logger: MemoryLayoutLogger,
) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for candidate in generated_routing_intent_candidates(document, intent):
        attempt_logger = MemoryLayoutLogger()
        prepared = apply_coordinate_routing_intent(document, candidate["intent"], attempt_logger)
        route_result = route_with_template_strategy(
            prepared,
            candidate["intent"],
            attempt_logger,
            include_outer_lanes=include_outer_lanes,
            include_dividers=include_outer_lanes,
        )
        routed = apply_route_result(prepared, route_result)
        score = score_layout(routed)
        validation = validate_routed_document(prepared, routed, attempt_logger, attempt_logger.events)
        routing_fallbacks = sum(1 for edge in validation["edgeResults"] if edge["routingFallbackUsed"] or edge["routingFailed"])
        hard_failures = (
            score["nodeOverlaps"]
            + score["groupOverlaps"]
            + validation["edgeNodeHits"]
            + validation["illegalSegmentOverlaps"]
            + validation["edgeIdentityViolations"]
            + validation["invalidDividers"]
            + routing_fallbacks
        )
        vector = [
            hard_failures,
            validation["edgeCrossings"],
            validation["illegalSegmentOverlaps"],
            routing_fallbacks,
            score["edgeBends"],
            score["totalEdgeLength"],
            score["layoutArea"],
        ]
        logger.debug(
            {
                "phase": "route",
                "type": "generated-layout-candidate-evaluated",
                "message": f"Generated routing layout candidate {candidate['name']} evaluated.",
                "data": {"candidate": candidate["name"], "score": vector},
            }
        )
        if best is None or compare_score_vector(vector, best["vector"]) < 0:
            best = {"candidate": candidate, "vector": vector}
        if vector[0] == 0 and vector[1] == 0:
            break
    return best["candidate"]["intent"] if best else intent


def generated_routing_intent_candidates(document: dict[str, Any], intent: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [{"name": "normalized", "intent": intent}]
    for variant in [
        {"xGap": 440, "yGap": 640, "packing": "vertical"},
        {"xGap": 440, "yGap": 960, "packing": "vertical"},
        {"xGap": 700, "yGap": 960, "packing": "vertical"},
        {"xGap": 700, "yGap": 640, "packing": "vertical"},
        {"xGap": 440, "yGap": 960, "packing": "original"},
    ]:
        candidates.append(
            {
                "name": f"layered-{variant['packing']}-x{variant['xGap']}-y{variant['yGap']}",
                "intent": create_layered_generated_intent(document, intent, variant["xGap"], variant["yGap"], variant["packing"]),
            }
        )
    return candidates


def create_layered_generated_intent(
    document: dict[str, Any],
    intent: dict[str, Any],
    x_gap: float,
    y_gap: float,
    packing_mode: str,
) -> dict[str, Any]:
    group_by_node_id: dict[str, str] = {}
    for group_id in intent["groupOrder"]:
        for node_id in intent["groups"][group_id]["nodeOrder"]:
            group_by_node_id[node_id] = group_id
    layers = compute_group_layers(document, intent, group_by_node_id)
    groups_by_layer: dict[int, list[str]] = {}
    for group_id in intent["groupOrder"]:
        groups_by_layer.setdefault(layers.get(group_id, 0), []).append(group_id)
    for layer, group_ids in list(groups_by_layer.items()):
        groups_by_layer[layer] = order_layer_group_ids(group_ids, document, group_by_node_id, intent)
    next_groups: dict[str, dict[str, Any]] = {}
    sizes: dict[str, dict[str, float]] = {}
    for group_id in intent["groupOrder"]:
        group = intent["groups"][group_id]
        packing = "vertical" if packing_mode == "vertical" else group["packing"]
        next_groups[group_id] = {**copy.deepcopy(group), "packing": packing}
        sizes[group_id] = measure_generated_group(document, group, packing)
    layer_ids = sorted(groups_by_layer.keys())
    layer_x: dict[int, float] = {}
    x = 0.0
    for layer in layer_ids:
        layer_x[layer] = x
        max_width = max([sizes[group_id]["width"] for group_id in groups_by_layer.get(layer, [])] or [0])
        x += max_width + x_gap
    layer_bounds: dict[int, dict[str, float]] = {}
    for layer in layer_ids:
        y = 0.0
        for group_id in groups_by_layer.get(layer, []):
            size = sizes[group_id]
            next_groups[group_id] = {**next_groups[group_id], "x": layer_x[layer], "y": y}
            y += size["height"] + y_gap
        bottom = max(0.0, y - y_gap)
        layer_bounds[layer] = {"top": 0.0, "bottom": bottom, "center": bottom / 2}
    global_center = max([bounds["center"] for bounds in layer_bounds.values()] or [0])
    for layer in layer_ids:
        group_ids = groups_by_layer.get(layer, [])
        if len(group_ids) != 1:
            continue
        group_id = group_ids[0]
        incoming_source_y = single_incoming_source_y(group_id, document, group_by_node_id, next_groups)
        has_outgoing = any(group_by_node_id.get(edge["sourceId"]) == group_id and group_by_node_id.get(edge["targetId"]) != group_id for edge in document["edges"])
        y = incoming_source_y if incoming_source_y is not None and not has_outgoing else max(0.0, global_center - sizes[group_id]["height"] / 2)
        next_groups[group_id] = {**next_groups[group_id], "y": y}
    return {**intent, "groups": {group_id: next_groups.get(group_id, intent["groups"][group_id]) for group_id in intent["groupOrder"]}}


def compute_group_layers(document: dict[str, Any], intent: dict[str, Any], group_by_node_id: dict[str, str]) -> dict[str, int]:
    layers = {group_id: 0 for group_id in intent["groupOrder"]}
    for _ in intent["groupOrder"]:
        changed = False
        for edge in document["edges"]:
            source_group = group_by_node_id.get(edge["sourceId"])
            target_group = group_by_node_id.get(edge["targetId"])
            if not source_group or not target_group or source_group == target_group:
                continue
            next_layer = min(len(intent["groupOrder"]) - 1, layers.get(source_group, 0) + 1)
            if next_layer > layers.get(target_group, 0):
                layers[target_group] = next_layer
                changed = True
        if not changed:
            break
    return layers


def order_layer_group_ids(
    group_ids: list[str], document: dict[str, Any], group_by_node_id: dict[str, str], intent: dict[str, Any]
) -> list[str]:
    return sorted(group_ids, key=lambda group_id: (first_edge_index_for_group(group_id, document, group_by_node_id), intent["groupOrder"].index(group_id), group_id))


def first_edge_index_for_group(group_id: str, document: dict[str, Any], group_by_node_id: dict[str, str]) -> int:
    for index, edge in enumerate(document["edges"]):
        if group_by_node_id.get(edge["sourceId"]) == group_id or group_by_node_id.get(edge["targetId"]) == group_id:
            return index
    return sys.maxsize


def single_incoming_source_y(
    group_id: str, document: dict[str, Any], group_by_node_id: dict[str, str], groups: dict[str, dict[str, Any]]
) -> float | None:
    incoming = []
    for edge in document["edges"]:
        source_group = group_by_node_id.get(edge["sourceId"])
        target_group = group_by_node_id.get(edge["targetId"])
        if target_group == group_id and source_group and source_group != group_id and source_group in groups:
            incoming.append(groups[source_group])
    if not incoming:
        return None
    return sum(group["y"] for group in incoming) / len(incoming)


def measure_generated_group(document: dict[str, Any], group_intent: dict[str, Any], packing: str) -> dict[str, float]:
    node_by_id = {node["id"]: clone_node_with_layout(node) for node in document["nodes"]}
    nodes = [node_by_id[node_id] for node_id in group_intent["nodeOrder"] if node_id in node_by_id]
    group = {
        "id": group_intent["id"],
        "label": group_intent["label"],
        "kind": group_intent.get("kind", "stereotype"),
        "nodeIds": [node["id"] for node in nodes],
        "layout": {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0},
    }
    pack_group(group, nodes, packing)
    return {"width": group["layout"]["width"], "height": group["layout"]["height"]}


def compare_score_vector(left: list[float], right: list[float]) -> float:
    for left_value, right_value in zip(left, right):
        if abs(left_value - right_value) > EPSILON:
            return left_value - right_value
    return 0.0


def apply_route_result(document: dict[str, Any], route_result: dict[str, Any]) -> dict[str, Any]:
    routed = copy.deepcopy(document)
    routed["edges"] = route_result["edges"]
    routed["routingDividers"] = route_result["dividers"] if route_result["dividers"] else None
    routed["diagnostics"] = routed.get("diagnostics", []) + route_result.get("diagnostics", [])
    return routed


def score_layout(document: dict[str, Any]) -> dict[str, Any]:
    paths = [path for path in collect_routing_paths(document) if len(path["points"]) >= 2]
    node_overlaps = count_rectangle_overlaps(document["nodes"])
    group_overlaps = count_rectangle_overlaps(document.get("groups") or [])
    edge_node_hits = sum(count_route_node_hits(path, document["nodes"]) for path in paths)
    segment_overlaps = count_segment_overlaps(paths)
    edge_crossings = count_edge_crossings(paths)
    edge_bends = sum(count_bends(path["points"]) for path in paths)
    duplicate_anchors = count_duplicate_anchors(document["edges"])
    total_edge_length = sum(path_length(path["points"]) for path in paths)
    bounds = layout_bounds(document)
    layout_area = bounds["width"] * bounds["height"]
    value = (
        edge_node_hits * 1_000_000_000
        + node_overlaps * 800_000_000
        + group_overlaps * 500_000_000
        + edge_crossings * 250_000_000
        + segment_overlaps * 100_000_000
        + duplicate_anchors * 10_000_000
        + edge_bends * 1_000
        + total_edge_length * 0.1
        + layout_area * 0.0001
    )
    return {
        "value": value,
        "nodeOverlaps": node_overlaps,
        "groupOverlaps": group_overlaps,
        "edgeNodeHits": edge_node_hits,
        "segmentOverlaps": segment_overlaps,
        "edgeCrossings": edge_crossings,
        "edgeBends": edge_bends,
        "duplicateAnchors": duplicate_anchors,
        "totalEdgeLength": total_edge_length,
        "layoutWidth": bounds["width"],
        "layoutHeight": bounds["height"],
        "layoutArea": layout_area,
    }


def validate_routed_document(
    original_document: dict[str, Any],
    document: dict[str, Any],
    logger: MemoryLayoutLogger,
    events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    events = events or []
    edge_identity_violations = 0
    illegal_segment_overlaps = 0
    invalid_dividers = 0
    edge_node_hits = 0
    segment_overlaps = 0
    edge_crossings = 0
    errors: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    invalid_edge_ids: set[str] = set()
    original_edge_by_id = {edge["id"]: edge for edge in original_document["edges"]}
    routed_edge_by_id = {edge["id"]: edge for edge in document["edges"]}
    edge_results_by_id = {edge["id"]: create_edge_result(edge["id"]) for edge in document["edges"]}

    for event in events:
        if event.get("type") not in ["routing-fallback-used", "routing-failed"] or not event.get("edgeId"):
            continue
        result = edge_results_by_id[event["edgeId"]]
        if event["type"] == "routing-fallback-used":
            result["routingFallbackUsed"] = True
        else:
            result["routingFailed"] = True
        invalid_edge_ids.add(event["edgeId"])
        diagnostics.append(
            layout_change_diagnostic(
                "routing-failure",
                f"Edge {event['edgeId']} used a best-effort route because no hard-valid candidate was found.",
                [event["edgeId"]],
                group_ids_for_edge_ids(document, [event["edgeId"]]),
            )
        )

    for edge in document["edges"]:
        original = original_edge_by_id.get(edge["id"])
        if original and (original["sourceId"] != edge["sourceId"] or original["targetId"] != edge["targetId"]):
            edge_identity_violations += 1
            invalid_edge_ids.add(edge["id"])
            edge_results_by_id[edge["id"]]["edgeIdentityViolations"].append("source-target-changed")
            push_validation_error(
                logger,
                errors,
                {
                    "phase": "validate",
                    "type": "edge-identity-violation",
                    "message": f"Edge {edge['id']} changed source or target during routing.",
                    "edgeId": edge["id"],
                },
            )

    divider_info = validate_routing_dividers(
        document.get("routingDividers") or [],
        routed_edge_by_id,
        edge_results_by_id,
        invalid_edge_ids,
        logger,
        errors,
        diagnostics,
        document,
    )
    valid_divider_by_id = divider_info["validDividerById"]
    invalid_dividers = len(divider_info["invalidDividerIds"])
    paths = [path for path in collect_routing_paths(document, valid_divider_by_id) if len(path["points"]) >= 2]
    node_hits_by_edge_id: dict[str, list[dict[str, Any]]] = {}
    for routing_path in paths:
        hits = collect_route_node_hits(routing_path, document["nodes"])
        if not hits:
            continue
        edge_node_hits += len(hits)
        node_hits_by_edge_id.setdefault(routing_path["edge"]["id"], []).extend(hits)
        edge_results_by_id[routing_path["edge"]["id"]]["nodeHits"].extend(hits)
        invalid_edge_ids.add(routing_path["edge"]["id"])

    for edge_id, hits in node_hits_by_edge_id.items():
        node_ids = unique([hit["nodeId"] for hit in hits])
        push_validation_error(
            logger,
            errors,
            {
                "phase": "validate",
                "type": "edge-node-hit",
                "message": f"Edge {edge_id} crosses {len(hits)} non-terminal node{'s' if len(hits) != 1 else ''}.",
                "edgeId": edge_id,
                "data": {"nodeHits": len(hits), "nodeIds": node_ids},
            },
        )
        diagnostics.append(
            layout_change_diagnostic(
                "edge-node-hit",
                f"Edge {edge_id} crosses non-terminal node{'s' if len(hits) != 1 else ''}: {', '.join(node_ids)}.",
                [edge_id],
                group_ids_for_edge_ids(document, [edge_id], node_ids),
            )
        )

    for left_index in range(len(paths)):
        for right_index in range(left_index + 1, len(paths)):
            left = paths[left_index]
            right = paths[right_index]
            if left["edge"]["id"] == right["edge"]["id"]:
                continue
            for left_segment in path_segments_with_refs(left):
                for right_segment in path_segments_with_refs(right):
                    if segments_overlap(left_segment["start"], left_segment["end"], right_segment["start"], right_segment["end"]):
                        divider_exempt = is_divider_trunk_overlap_exempt(left, right)
                        left_overlap = segment_overlap_ref(right["edge"]["id"], left_segment["ref"], right_segment["ref"], divider_exempt)
                        right_overlap = segment_overlap_ref(left["edge"]["id"], right_segment["ref"], left_segment["ref"], divider_exempt)
                        segment_overlaps += 1
                        edge_results_by_id[left["edge"]["id"]]["segmentOverlaps"].append(left_overlap)
                        edge_results_by_id[right["edge"]["id"]]["segmentOverlaps"].append(right_overlap)
                        if not divider_exempt:
                            illegal_segment_overlaps += 1
                            edge_results_by_id[left["edge"]["id"]]["illegalSegmentOverlaps"].append(left_overlap)
                            edge_results_by_id[right["edge"]["id"]]["illegalSegmentOverlaps"].append(right_overlap)
                            invalid_edge_ids.add(left["edge"]["id"])
                            invalid_edge_ids.add(right["edge"]["id"])
                            push_validation_error(
                                logger,
                                errors,
                                {
                                    "phase": "validate",
                                    "type": "illegal-segment-overlap",
                                    "message": f"Edges {left['edge']['id']} and {right['edge']['id']} share a route segment outside a valid divider.",
                                    "edgeId": left["edge"]["id"],
                                    "data": {"otherEdgeId": right["edge"]["id"], "segment": left_segment["ref"], "otherSegment": right_segment["ref"]},
                                },
                            )
                            diagnostics.append(
                                layout_change_diagnostic(
                                    "illegal-segment-overlap",
                                    f"Edges {left['edge']['id']} and {right['edge']['id']} share a route segment outside a valid divider.",
                                    [left["edge"]["id"], right["edge"]["id"]],
                                    group_ids_for_edge_ids(document, [left["edge"]["id"], right["edge"]["id"]]),
                                )
                            )
                        continue
                    if (
                        segments_intersect(left_segment["start"], left_segment["end"], right_segment["start"], right_segment["end"])
                        and not points_equal(left_segment["start"], right_segment["start"])
                        and not points_equal(left_segment["start"], right_segment["end"])
                        and not points_equal(left_segment["end"], right_segment["start"])
                        and not points_equal(left_segment["end"], right_segment["end"])
                    ):
                        crossing = edge_crossing_ref(right["edge"]["id"], left_segment["ref"], right_segment["ref"], intersection_point(left_segment["start"], left_segment["end"], right_segment["start"], right_segment["end"]))
                        edge_crossings += 1
                        edge_results_by_id[left["edge"]["id"]]["edgeCrossings"].append(crossing)
                        edge_results_by_id[right["edge"]["id"]]["edgeCrossings"].append(edge_crossing_ref(left["edge"]["id"], right_segment["ref"], left_segment["ref"], crossing.get("point")))
                        message = f"Edges {left['edge']['id']} and {right['edge']['id']} cross."
                        logger.warn(
                            {
                                "phase": "validate",
                                "type": "edge-crossing",
                                "message": message,
                                "edgeId": left["edge"]["id"],
                                "data": {"otherEdgeId": right["edge"]["id"], "segment": left_segment["ref"], "otherSegment": right_segment["ref"]},
                            }
                        )
                        diagnostics.append(
                            {
                                "severity": "warning",
                                "type": "edge-crossing",
                                "reason": "edge-crossing",
                                "message": message,
                                "edgeIds": [left["edge"]["id"], right["edge"]["id"]],
                                "groupIds": group_ids_for_edge_ids(document, [left["edge"]["id"], right["edge"]["id"]]),
                            }
                        )

    edge_results: list[dict[str, Any]] = []
    for result in edge_results_by_id.values():
        result["nodeHits"] = sorted(result["nodeHits"], key=lambda hit: (hit["nodeId"], segment_ref_key(hit["segment"])))
        result["edgeCrossings"] = sorted(result["edgeCrossings"], key=lambda hit: (hit["otherEdgeId"], segment_ref_key(hit["segment"]), segment_ref_key(hit["otherSegment"])))
        result["segmentOverlaps"] = sorted(result["segmentOverlaps"], key=lambda hit: (hit["otherEdgeId"], int(hit["dividerExempt"]), segment_ref_key(hit["segment"]), segment_ref_key(hit["otherSegment"])))
        result["illegalSegmentOverlaps"] = sorted(result["illegalSegmentOverlaps"], key=lambda hit: (hit["otherEdgeId"], int(hit["dividerExempt"]), segment_ref_key(hit["segment"]), segment_ref_key(hit["otherSegment"])))
        result["invalidDividers"] = sorted(unique(result["invalidDividers"]))
        result["edgeIdentityViolations"] = sorted(unique(result["edgeIdentityViolations"]))
        result["hardValid"] = (
            len(result["nodeHits"]) == 0
            and len(result["illegalSegmentOverlaps"]) == 0
            and not result["routingFallbackUsed"]
            and not result["routingFailed"]
            and len(result["invalidDividers"]) == 0
            and len(result["edgeIdentityViolations"]) == 0
        )
        if not result["hardValid"]:
            invalid_edge_ids.add(result["edgeId"])
        edge_results.append(result)
    invalid_edges = len(invalid_edge_ids)
    valid_edges = max(0, len(document["edges"]) - invalid_edges)
    return {
        "valid": edge_identity_violations == 0
        and edge_node_hits == 0
        and illegal_segment_overlaps == 0
        and invalid_dividers == 0
        and all(not result["routingFallbackUsed"] and not result["routingFailed"] for result in edge_results),
        "errors": errors,
        "diagnostics": diagnostics,
        "edgeResults": sorted(edge_results, key=lambda result: result["edgeId"]),
        "edgeIdentityViolations": edge_identity_violations,
        "illegalSegmentOverlaps": illegal_segment_overlaps,
        "invalidDividers": invalid_dividers,
        "edgeNodeHits": edge_node_hits,
        "segmentOverlaps": segment_overlaps,
        "edgeCrossings": edge_crossings,
        "validEdges": valid_edges,
        "invalidEdges": invalid_edges,
        "invalidEdgeIds": sorted(invalid_edge_ids),
    }


def collect_routing_paths(
    document: dict[str, Any], valid_divider_by_id: dict[str, dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    valid_divider_by_id = valid_divider_by_id or {}
    endpoint_by_id = create_endpoint_map(document)
    paths: list[dict[str, Any]] = []
    for edge in document["edges"]:
        segments = edge.get("layout", {}).get("routedSegments")
        if segments:
            for segment in segments:
                source = endpoint_by_id.get(segment["sourceId"])
                target = endpoint_by_id.get(segment["targetId"])
                if not source or not target:
                    continue
                paths.append(
                    {
                        "edge": edge,
                        "segmentId": segment["id"],
                        "trunkDividerId": trunk_divider_id_for_segment(segment, valid_divider_by_id),
                        "terminalIds": {segment["sourceId"], segment["targetId"]},
                        "points": path_points(source, target, segment.get("sourceAnchor"), segment.get("targetAnchor"), segment.get("waypoints", [])),
                    }
                )
            continue
        source = endpoint_by_id.get(edge["sourceId"])
        target = endpoint_by_id.get(edge["targetId"])
        if not source or not target:
            continue
        paths.append(
            {
                "edge": edge,
                "terminalIds": {edge["sourceId"], edge["targetId"]},
                "points": path_points(source, target, edge.get("layout", {}).get("sourceAnchor"), edge.get("layout", {}).get("targetAnchor"), edge.get("layout", {}).get("waypoints", [])),
            }
        )
    return paths


def validate_routing_dividers(
    dividers: list[dict[str, Any]],
    edge_by_id: dict[str, dict[str, Any]],
    edge_results_by_id: dict[str, dict[str, Any]],
    invalid_edge_ids: set[str],
    logger: MemoryLayoutLogger,
    errors: list[dict[str, Any]],
    diagnostics: list[dict[str, Any]],
    document: dict[str, Any],
) -> dict[str, Any]:
    valid_divider_by_id: dict[str, dict[str, Any]] = {}
    invalid_divider_ids: list[str] = []
    for divider in dividers:
        divider_edges = [edge_by_id[edge_id] for edge_id in divider["sourceEdgeIds"] if edge_id in edge_by_id]
        has_missing_edge = len(divider_edges) != len(divider["sourceEdgeIds"])
        has_enough_edges = len(divider["sourceEdgeIds"]) > 4
        source_ids = {edge["sourceId"] for edge in divider_edges}
        target_ids = {edge["targetId"] for edge in divider_edges}
        common_node_id = next(iter(source_ids), None) if divider["mode"] == "fanOut" else next(iter(target_ids), None)
        valid = (not has_missing_edge) and has_enough_edges and ((len(source_ids) == 1) if divider["mode"] == "fanOut" else (len(target_ids) == 1))
        if valid and common_node_id:
            valid_divider_by_id[divider["id"]] = {"divider": divider, "commonNodeId": common_node_id}
            continue
        invalid_divider_ids.append(divider["id"])
        for edge_id in divider["sourceEdgeIds"]:
            invalid_edge_ids.add(edge_id)
            if edge_id in edge_results_by_id:
                edge_results_by_id[edge_id]["invalidDividers"].append(divider["id"])
        push_validation_error(
            logger,
            errors,
            {
                "phase": "validate",
                "type": "invalid-divider-group",
                "message": f"Routing divider {divider['id']} is not a legal {divider['mode']} group.",
                "dividerId": divider["id"],
                "data": {"edgeCount": len(divider["sourceEdgeIds"]), "minimumExclusiveEdgeCount": 4, "hasMissingEdge": has_missing_edge},
            },
        )
        diagnostics.append(
            layout_change_diagnostic(
                "invalid-divider",
                f"Routing divider {divider['id']} is not a legal {divider['mode']} group.",
                divider["sourceEdgeIds"],
                group_ids_for_edge_ids(document, divider["sourceEdgeIds"]),
            )
        )
    return {"validDividerById": valid_divider_by_id, "invalidDividerIds": invalid_divider_ids}


def create_edge_result(edge_id: str) -> dict[str, Any]:
    return {
        "edgeId": edge_id,
        "nodeHits": [],
        "edgeCrossings": [],
        "segmentOverlaps": [],
        "illegalSegmentOverlaps": [],
        "routingFallbackUsed": False,
        "routingFailed": False,
        "invalidDividers": [],
        "edgeIdentityViolations": [],
        "hardValid": True,
    }


def collect_route_node_hits(path: dict[str, Any], nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for segment in path_segments_with_refs(path):
        for node in nodes:
            if node["id"] in path["terminalIds"] or not node.get("layout"):
                continue
            if segment_intersects_rectangle(segment["start"], segment["end"], node["layout"]):
                hits.append({"nodeId": node["id"], "segment": segment["ref"]})
    return hits


def path_segments_with_refs(path: dict[str, Any]) -> list[dict[str, Any]]:
    output = []
    for index, (start, end) in enumerate(path_segments(path["points"])):
        output.append(
            {
                "start": start,
                "end": end,
                "ref": {"edgeId": path["edge"]["id"], **({"segmentId": path["segmentId"]} if path.get("segmentId") else {}), "segmentIndex": index},
            }
        )
    return output


def trunk_divider_id_for_segment(segment: dict[str, Any], valid_divider_by_id: dict[str, dict[str, Any]]) -> str | None:
    if segment.get("strategy") != "divider":
        return None
    for info in valid_divider_by_id.values():
        divider = info["divider"]
        common_node_id = info["commonNodeId"]
        if divider["mode"] == "fanOut" and segment["sourceId"] == common_node_id and segment["targetId"] == divider["id"]:
            return divider["id"]
        if divider["mode"] == "fanIn" and segment["sourceId"] == divider["id"] and segment["targetId"] == common_node_id:
            return divider["id"]
    return None


def layout_change_diagnostic(reason: str, message: str, edge_ids: list[str], group_ids: list[str]) -> dict[str, Any]:
    return {
        "severity": "error",
        "type": "layout-change-required",
        "reason": reason,
        "message": message,
        "edgeIds": sorted(unique(edge_ids)),
        "groupIds": sorted(unique(group_ids)),
        **({"recommendedAction": recommended_action(group_ids)} if recommended_action(group_ids) else {}),
    }


def recommended_action(group_ids: list[str]) -> dict[str, Any] | None:
    unique_group_ids = unique(group_ids)
    if len(unique_group_ids) >= 2:
        return {"kind": "increase-gap", "betweenGroupIds": [unique_group_ids[0], unique_group_ids[1]], "direction": "x", "amount": 120}
    if len(unique_group_ids) == 1:
        return {"kind": "move-group", "groupId": unique_group_ids[0], "direction": "right", "amount": 120}
    return None


def group_ids_for_edge_ids(document: dict[str, Any], edge_ids: list[str], extra_node_ids: list[str] | None = None) -> list[str]:
    extra_node_ids = extra_node_ids or []
    edge_by_id = {edge["id"]: edge for edge in document["edges"]}
    node_by_id = {node["id"]: node for node in document["nodes"]}
    group_ids: list[str] = []
    for edge_id in edge_ids:
        edge = edge_by_id.get(edge_id)
        if not edge:
            continue
        for node_id in [edge["sourceId"], edge["targetId"]]:
            group_id = node_by_id.get(node_id, {}).get("groupId")
            if group_id:
                group_ids.append(group_id)
    for node_id in extra_node_ids:
        group_id = node_by_id.get(node_id, {}).get("groupId")
        if group_id:
            group_ids.append(group_id)
    return unique(group_ids)


def push_validation_error(logger: MemoryLayoutLogger, errors: list[dict[str, Any]], event: dict[str, Any]) -> None:
    full_event = {**event, "level": "error"}
    errors.append(full_event)
    logger.log(full_event)


def build_routing_summary(
    document: dict[str, Any],
    route_strategy: str,
    score: dict[str, Any],
    validation: dict[str, Any],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    routing_failures = count_events(events, "routing-fallback-used")
    hard_valid = (
        score["nodeOverlaps"] == 0
        and score["groupOverlaps"] == 0
        and validation["edgeNodeHits"] == 0
        and validation["illegalSegmentOverlaps"] == 0
        and validation["edgeIdentityViolations"] == 0
        and validation["invalidDividers"] == 0
        and routing_failures == 0
    )
    return {
        "routeStrategy": route_strategy,
        "hardValid": hard_valid,
        "totalEdges": len(document["edges"]),
        "validEdges": validation["validEdges"],
        "invalidEdges": validation["invalidEdges"],
        "nodeOverlaps": score["nodeOverlaps"],
        "groupOverlaps": score["groupOverlaps"],
        "edgeNodeHits": validation["edgeNodeHits"],
        "edgeCrossings": score["edgeCrossings"],
        "segmentOverlaps": score["segmentOverlaps"],
        "illegalSegmentOverlaps": validation["illegalSegmentOverlaps"],
        "edgeIdentityViolations": validation["edgeIdentityViolations"],
        "invalidDividers": validation["invalidDividers"],
        "outerLaneUsages": count_events(events, "outer-lane-used"),
        "routingFailures": routing_failures,
        "repairAccepted": count_events(events, "route-repair-accepted"),
        "repairRejected": count_events(events, "route-repair-rejected"),
    }


def to_mx_graph_model_xml(document: dict[str, Any], group_frames: bool = False) -> str:
    nodes = document["nodes"]
    dividers = document.get("routingDividers") or []
    groups = document.get("groups") or []
    node_id_by_diagram_id = create_export_cell_id_map(nodes, "node")
    divider_id_by_diagram_id = create_export_cell_id_map(dividers, "divider")
    endpoint_by_diagram_id = create_export_endpoint_map(nodes, dividers, node_id_by_diagram_id, divider_id_by_diagram_id)
    bounds = calculate_export_bounds(nodes, groups, dividers)
    lines = [
        f'<mxGraphModel dx="{format_number(bounds["width"])}" dy="{format_number(bounds["height"])}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1169" pageHeight="1654" math="0" shadow="0">',
        "  <root>",
        '    <mxCell id="0" />',
        '    <mxCell id="1" parent="0" />',
    ]
    if group_frames:
        for index, group in enumerate(groups):
            lines.append(build_group_frame_cell(group, create_sequential_cell_id("group_frame", index)))
    for node in nodes:
        lines.extend(build_class_cells(node, node_id_by_diagram_id[node["id"]]))
    for divider in dividers:
        lines.append(build_routing_divider_cell(divider, divider_id_by_diagram_id[divider["id"]]))
    for index, edge_spec in enumerate(build_export_edge_specs(document), start=1):
        lines.append(build_edge_cell(edge_spec, index, endpoint_by_diagram_id))
    lines.extend(["  </root>", "</mxGraphModel>", ""])
    return "\n".join(lines)


CLASS_STYLE_PARTS = [
    "swimlane",
    "fontStyle=1",
    "align=center",
    "verticalAlign=top",
    "childLayout=stackLayout",
    "horizontal=1",
    "horizontalStack=0",
    "resizeParent=1",
    "resizeParentMax=0",
    "resizeLast=0",
    "collapsible=0",
    "marginBottom=0",
    "whiteSpace=wrap",
    "html=1",
    "fillColor=light-dark(#eeeeee,#1f2020)",
    "strokeColor=light-dark(#999999,#cccccc)",
    "fontColor=light-dark(#333333,#cccccc)",
]
TEXT_STYLE = ";".join(["text", "strokeColor=none", "fillColor=none", "align=left", "verticalAlign=top", "spacingLeft=4", "spacingRight=4", "overflow=hidden", "rotatable=0", "points=[[0,0.5],[1,0.5]]", "portConstraint=eastwest"])
LINE_STYLE = ";".join(["line", "strokeWidth=1", "fillColor=none", "align=left", "verticalAlign=middle", "spacingTop=-1", "spacingLeft=3", "spacingRight=3", "rotatable=0", "labelPosition=right", "points=[]", "portConstraint=eastwest", "strokeColor=inherit"])
GROUP_FRAME_STYLE = ";".join(["rounded=0", "whiteSpace=wrap", "html=1", "fillColor=none", "strokeColor=light-dark(#999999,#cccccc)", "dashed=1", "fontStyle=1", "fontColor=light-dark(#666666,#cccccc)", "align=left", "verticalAlign=top", "spacingLeft=8", "spacingTop=6", "connectable=0", "collapsible=0", "pointerEvents=0"])
ROUTING_DIVIDER_STYLE = ";".join(["rounded=0", "whiteSpace=wrap", "html=1", "fillColor=light-dark(#666666,#cccccc)", "strokeColor=light-dark(#666666,#cccccc)", "connectable=1", "resizable=0", "rotatable=0", "autoDiagramRoutingDivider=1"])


def build_group_frame_cell(group: dict[str, Any], group_cell_id: str) -> str:
    layout = group["layout"]
    return "\n".join(
        [
            f'    <mxCell id="{group_cell_id}" parent="1" style="{escape_xml_attribute(GROUP_FRAME_STYLE)}" value="{escape_xml_attribute(group["label"])}" vertex="1">',
            f'      <mxGeometry height="{format_number(layout["height"])}" width="{format_number(layout["width"])}" x="{format_number(layout["x"])}" y="{format_number(layout["y"])}" as="geometry" />',
            "    </mxCell>",
        ]
    )


def build_routing_divider_cell(divider: dict[str, Any], divider_cell_id: str) -> str:
    layout = divider["layout"]
    style = f"{ROUTING_DIVIDER_STYLE};orientation={divider['orientation']};side={divider['side']}"
    return "\n".join(
        [
            f'    <mxCell id="{divider_cell_id}" parent="1" style="{escape_xml_attribute(style)}" vertex="1">',
            f'      <mxGeometry height="{format_number(layout["height"])}" width="{format_number(layout["width"])}" x="{format_number(layout["x"])}" y="{format_number(layout["y"])}" as="geometry" />',
            "    </mxCell>",
        ]
    )


def build_class_cells(node: dict[str, Any], node_cell_id: str) -> list[str]:
    layout = node["layout"]
    label_html = escape_html_text(node["label"])
    header_value = f"<b>&lt;&lt;{escape_html_text(node['stereotype'])}&gt;&gt;</b><br>{label_html}" if node.get("stereotype") else label_html
    lines = [
        f'    <mxCell id="{node_cell_id}" parent="1" style="{escape_xml_attribute(build_class_style(layout))}" value="{escape_xml_attribute(header_value)}" vertex="1">',
        f'      <mxGeometry height="{format_number(layout["height"])}" width="{format_number(layout["width"])}" x="{format_number(layout["x"])}" y="{format_number(layout["y"])}" as="geometry" />',
        "    </mxCell>",
    ]
    child_index = 1
    y = layout["headerHeight"]
    for attribute in node.get("attributes", []):
        lines.append(build_child_text_cell(node_cell_id, child_index, attribute["text"], layout["width"], y, layout["lineHeight"]))
        child_index += 1
        y += layout["lineHeight"]
    if len(node.get("attributes", [])) == 0:
        y += layout["lineHeight"]
    lines.append(build_separator_cell(node_cell_id, child_index, layout["width"], y, layout["separatorHeight"]))
    child_index += 1
    y += layout["separatorHeight"]
    for method in node.get("methods", []):
        lines.append(build_child_text_cell(node_cell_id, child_index, method["text"], layout["width"], y, layout["lineHeight"]))
        child_index += 1
        y += layout["lineHeight"]
    return lines


def build_class_style(layout: dict[str, Any]) -> str:
    return ";".join(CLASS_STYLE_PARTS[:6] + [f"startSize={format_number(layout['headerHeight'])}"] + CLASS_STYLE_PARTS[6:])


def build_child_text_cell(parent_id: str, child_index: int, value: str, width: float, y: float, height: float) -> str:
    cell_id = f"{parent_id}_child_{child_index}"
    return "\n".join(
        [
            f'    <mxCell id="{cell_id}" parent="{parent_id}" style="{escape_xml_attribute(TEXT_STYLE)}" value="{escape_xml_attribute(value)}" vertex="1">',
            f'      <mxGeometry height="{format_number(height)}" width="{format_number(width)}" y="{format_number(y)}" as="geometry" />',
            "    </mxCell>",
        ]
    )


def build_separator_cell(parent_id: str, child_index: int, width: float, y: float, height: float) -> str:
    cell_id = f"{parent_id}_child_{child_index}"
    return "\n".join(
        [
            f'    <mxCell id="{cell_id}" parent="{parent_id}" style="{escape_xml_attribute(LINE_STYLE)}" vertex="1">',
            f'      <mxGeometry height="{format_number(height)}" width="{format_number(width)}" y="{format_number(y)}" as="geometry" />',
            "    </mxCell>",
        ]
    )


def build_export_edge_specs(document: dict[str, Any]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for edge in document["edges"]:
        layout = edge.get("layout", {})
        routed_segments = layout.get("routedSegments")
        if layout.get("routeSource") == "engine-v2" and routed_segments:
            for segment in routed_segments:
                specs.append(
                    {
                        "edge": edge,
                        "sourceId": segment["sourceId"],
                        "targetId": segment["targetId"],
                        "label": segment.get("label", ""),
                        "sourceAnchor": segment.get("sourceAnchor"),
                        "targetAnchor": segment.get("targetAnchor"),
                        "waypoints": segment.get("waypoints", []),
                        "markerPolicy": segment["markerPolicy"],
                        "v2Routed": True,
                    }
                )
            continue
        specs.append(
            {
                "edge": edge,
                "sourceId": edge["sourceId"],
                "targetId": edge["targetId"],
                "label": edge.get("label", ""),
                "sourceAnchor": layout.get("sourceAnchor"),
                "targetAnchor": layout.get("targetAnchor"),
                "waypoints": layout.get("waypoints", []),
                "markerPolicy": {"start": True, "end": True},
                "v2Routed": layout.get("routeSource") == "engine-v2",
            }
        )
    return specs


def build_edge_cell(edge_spec: dict[str, Any], index: int, endpoint_by_diagram_id: dict[str, dict[str, Any]]) -> str:
    source = endpoint_by_diagram_id[edge_spec["sourceId"]]
    target = endpoint_by_diagram_id[edge_spec["targetId"]]
    return "\n".join(
        [
            f'    <mxCell id="edge_{index}" edge="1" parent="1" source="{source["cellId"]}" style="{escape_xml_attribute(edge_style(edge_spec["edge"], edge_spec, edge_spec["markerPolicy"]))}" target="{target["cellId"]}" value="{escape_xml_attribute(edge_spec["label"])}">',
            build_edge_geometry(edge_spec, source, target),
            "    </mxCell>",
        ]
    )


def build_edge_geometry(edge_spec: dict[str, Any], source: dict[str, Any], target: dict[str, Any]) -> str:
    waypoints = export_waypoints(edge_spec, source, target)
    if not waypoints:
        return "\n".join(['      <mxGeometry relative="1" as="geometry">', '        <Array as="points" />', "      </mxGeometry>"])
    return "\n".join(
        ['      <mxGeometry relative="1" as="geometry">', '        <Array as="points">']
        + [f'          <mxPoint x="{format_number(pt["x"])}" y="{format_number(pt["y"])}" />' for pt in waypoints]
        + ["        </Array>", "      </mxGeometry>"]
    )


def export_waypoints(edge_spec: dict[str, Any], source: dict[str, Any], target: dict[str, Any]) -> list[dict[str, float]]:
    source_point = edge_anchor_point(source["layout"], edge_spec["sourceAnchor"]) if edge_spec.get("sourceAnchor") else None
    target_point = edge_anchor_point(target["layout"], edge_spec["targetAnchor"]) if edge_spec.get("targetAnchor") else None
    cleaned: list[dict[str, float]] = []
    for waypoint in edge_spec.get("waypoints", []):
        if source_point and points_equal(waypoint, source_point):
            continue
        if target_point and points_equal(waypoint, target_point):
            continue
        if cleaned and points_equal(cleaned[-1], waypoint):
            continue
        cleaned.append(waypoint)
    return cleaned


def edge_style(edge: dict[str, Any], edge_spec: dict[str, Any], marker_policy: dict[str, bool]) -> str:
    return ";".join(
        ["curved=0"]
        + edge_semantic_style(edge, marker_policy)
        + anchor_style_parts("exit", edge_spec.get("sourceAnchor"))
        + anchor_style_parts("entry", edge_spec.get("targetAnchor"))
        + ["rounded=0", "edgeStyle=orthogonalEdgeStyle", "orthogonalLoop=1"]
        + ([] if edge_spec.get("v2Routed") else ["jettySize=auto"])
        + ["html=1"]
    )


def edge_semantic_style(edge: dict[str, Any], marker_policy: dict[str, bool]) -> list[str]:
    parts = base_edge_semantic_style(edge)
    if marker_policy.get("start", True) and marker_policy.get("end", True):
        return parts
    stripped = parts if marker_policy.get("start", True) else strip_marker_parts(parts, "start")
    stripped = stripped if marker_policy.get("end", True) else strip_marker_parts(stripped, "end")
    return stripped + ([] if marker_policy.get("start", True) else ["startArrow=none"]) + ([] if marker_policy.get("end", True) else ["endArrow=none"])


def strip_marker_parts(parts: list[str], endpoint: str) -> list[str]:
    return [part for part in parts if not part.startswith(f"{endpoint}Arrow=") and not part.startswith(f"{endpoint}Fill=") and not part.startswith(f"{endpoint}Size=")]


def base_edge_semantic_style(edge: dict[str, Any]) -> list[str]:
    return {
        "--": ["startArrow=none", "endArrow=none"],
        "..": ["dashed=1", "startArrow=none", "endArrow=none"],
        "-->": ["startArrow=none", "endArrow=open", "endFill=0", "endSize=12"],
        "<--": ["startArrow=open", "startFill=0", "startSize=12", "endArrow=none"],
        "..>": ["dashed=1", "startArrow=none", "endArrow=open", "endFill=0", "endSize=12"],
        "<..": ["dashed=1", "startArrow=open", "startFill=0", "startSize=12", "endArrow=none"],
        "<|--": ["startArrow=block", "startSize=16", "startFill=0", "endArrow=none"],
        "--|>": ["startArrow=none", "endArrow=block", "endSize=16", "endFill=0"],
        "<|..": ["dashed=1", "startArrow=block", "startSize=16", "startFill=0", "endArrow=none"],
        "..|>": ["dashed=1", "startArrow=none", "endArrow=block", "endSize=16", "endFill=0"],
        "o--": ["startArrow=diamondThin", "startFill=0", "startSize=14", "endArrow=none"],
        "--o": ["startArrow=none", "endArrow=diamondThin", "endFill=0", "endSize=14"],
        "*--": ["startArrow=diamondThin", "startFill=1", "startSize=14", "endArrow=none"],
        "--*": ["startArrow=none", "endArrow=diamondThin", "endFill=1", "endSize=14"],
    }[edge["operator"]]


def anchor_style_parts(prefix: str, anchor: dict[str, Any] | None) -> list[str]:
    if not anchor:
        return []
    relative = anchor_to_relative_point(anchor)
    return [
        f"{prefix}X={format_number(relative['x'])}",
        f"{prefix}Y={format_number(relative['y'])}",
        f"{prefix}Dx=0",
        f"{prefix}Dy=0",
        f"{prefix}Perimeter=0",
    ]


def create_export_endpoint_map(
    nodes: list[dict[str, Any]],
    dividers: list[dict[str, Any]],
    node_ids: dict[str, str],
    divider_ids: dict[str, str],
) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for node in nodes:
        output[node["id"]] = {"id": node["id"], "cellId": node_ids[node["id"]], "layout": node["layout"], "kind": "class"}
    for divider in dividers:
        output[divider["id"]] = {"id": divider["id"], "cellId": divider_ids[divider["id"]], "layout": divider["layout"], "kind": "divider"}
    return output


def create_export_cell_id_map(items: list[dict[str, Any]], item_type: str) -> dict[str, str]:
    return {item["id"]: create_sequential_cell_id(item_type, index) for index, item in enumerate(items)}


def create_sequential_cell_id(item_type: str, zero_based_index: int) -> str:
    return f"{item_type}_{zero_based_index + 1}"


def calculate_export_bounds(nodes: list[dict[str, Any]], groups: list[dict[str, Any]], dividers: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "width": max(
            [1169]
            + [node["layout"]["x"] + node["layout"]["width"] + 80 for node in nodes if node.get("layout")]
            + [group["layout"]["x"] + group["layout"]["width"] + 80 for group in groups if group.get("layout")]
            + [divider["layout"]["x"] + divider["layout"]["width"] + 80 for divider in dividers]
        ),
        "height": max(
            [1654]
            + [node["layout"]["y"] + node["layout"]["height"] + 80 for node in nodes if node.get("layout")]
            + [group["layout"]["y"] + group["layout"]["height"] + 80 for group in groups if group.get("layout")]
            + [divider["layout"]["y"] + divider["layout"]["height"] + 80 for divider in dividers]
        ),
    }


def create_endpoint_map(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for node in document["nodes"]:
        if node.get("layout"):
            output[node["id"]] = require_layout_rectangle(node["id"], node["layout"])
    for divider in document.get("routingDividers") or []:
        output[divider["id"]] = require_layout_rectangle(divider["id"], divider["layout"])
    return output


def path_points(
    source: dict[str, Any],
    target: dict[str, Any],
    source_anchor: dict[str, Any] | None,
    target_anchor: dict[str, Any] | None,
    waypoints: list[dict[str, float]],
) -> list[dict[str, float]]:
    return [
        anchor_point(source, source_anchor) if source_anchor else center(source),
        *waypoints,
        anchor_point(target, target_anchor) if target_anchor else center(target),
    ]


def route_hard_failure_breakdown(
    edge: dict[str, Any], points: list[dict[str, float]], nodes: list[dict[str, Any]], accepted_paths: list[dict[str, Any]]
) -> dict[str, int]:
    node_hits = count_edge_node_hits(edge, points, nodes)
    segment_overlaps = count_illegal_segment_overlaps(edge, points, accepted_paths)
    return {"nodeHits": node_hits, "segmentOverlaps": segment_overlaps, "hardFailures": node_hits + segment_overlaps}


def route_cost(
    edge: dict[str, Any], candidate: dict[str, Any], nodes: list[dict[str, Any]], accepted_paths: list[dict[str, Any]]
) -> float:
    node_hits = count_edge_node_hits(edge, candidate["points"], nodes)
    illegal_segment_overlaps = count_illegal_segment_overlaps(edge, candidate["points"], accepted_paths)
    crossings = count_crossings_with_accepted(candidate["points"], accepted_paths)
    bends = count_bends(candidate["points"])
    length = path_length(candidate["points"])
    return (
        illegal_segment_overlaps * 1_000_000_000_000
        + node_hits * 1_000_000_000
        + crossings * 250_000_000
        + ((50_000 + candidate.get("outerLaneIndex", 1) * 500) if candidate.get("outerLane") else 0)
        + bends * 1_000
        + length * 0.1
    )


def count_route_node_hits(path: dict[str, Any], nodes: list[dict[str, Any]]) -> int:
    return len(collect_route_node_hits(path, nodes))


def count_edge_node_hits(edge: dict[str, Any], points: list[dict[str, float]], nodes: list[dict[str, Any]]) -> int:
    hits = 0
    for start, end in path_segments(points):
        for node in nodes:
            if node["id"] in [edge["sourceId"], edge["targetId"]] or not node.get("layout"):
                continue
            if segment_intersects_rectangle(start, end, node["layout"]):
                hits += 1
    return hits


def count_illegal_segment_overlaps(edge: dict[str, Any], points: list[dict[str, float]], accepted_paths: list[dict[str, Any]]) -> int:
    overlaps = 0
    for start, end in path_segments(points):
        for accepted in accepted_paths:
            for accepted_start, accepted_end in path_segments(accepted["points"]):
                if segments_overlap(start, end, accepted_start, accepted_end):
                    overlaps += 1
    return overlaps


def count_crossings_with_accepted(points: list[dict[str, float]], accepted_paths: list[dict[str, Any]]) -> int:
    crossings = 0
    for start, end in path_segments(points):
        for accepted in accepted_paths:
            for accepted_start, accepted_end in path_segments(accepted["points"]):
                if (
                    not segments_overlap(start, end, accepted_start, accepted_end)
                    and segments_intersect(start, end, accepted_start, accepted_end)
                    and not points_equal(start, accepted_start)
                    and not points_equal(start, accepted_end)
                    and not points_equal(end, accepted_start)
                    and not points_equal(end, accepted_end)
                ):
                    crossings += 1
    return crossings


def count_segment_overlaps(paths: list[dict[str, Any]]) -> int:
    overlaps = 0
    for left_index in range(len(paths)):
        for right_index in range(left_index + 1, len(paths)):
            for left_start, left_end in path_segments(paths[left_index]["points"]):
                for right_start, right_end in path_segments(paths[right_index]["points"]):
                    if segments_overlap(left_start, left_end, right_start, right_end):
                        overlaps += 1
    return overlaps


def count_edge_crossings(paths: list[dict[str, Any]]) -> int:
    crossings = 0
    for left_index in range(len(paths)):
        for right_index in range(left_index + 1, len(paths)):
            for left_start, left_end in path_segments(paths[left_index]["points"]):
                for right_start, right_end in path_segments(paths[right_index]["points"]):
                    if (
                        not segments_overlap(left_start, left_end, right_start, right_end)
                        and segments_intersect(left_start, left_end, right_start, right_end)
                        and not points_equal(left_start, right_start)
                        and not points_equal(left_start, right_end)
                        and not points_equal(left_end, right_start)
                        and not points_equal(left_end, right_end)
                    ):
                        crossings += 1
    return crossings


def count_rectangle_overlaps(items: list[dict[str, Any]]) -> int:
    rectangles = [item["layout"] for item in items if item.get("layout")]
    return sum(1 for i in range(len(rectangles)) for j in range(i + 1, len(rectangles)) if rectangles_overlap(rectangles[i], rectangles[j]))


def count_duplicate_anchors(edges: list[dict[str, Any]]) -> int:
    seen: set[str] = set()
    duplicates = 0
    for edge in edges:
        for endpoint in ["source", "target"]:
            node_id = edge["sourceId"] if endpoint == "source" else edge["targetId"]
            anchor = edge.get("layout", {}).get("sourceAnchor" if endpoint == "source" else "targetAnchor")
            if not anchor:
                continue
            key = f"{node_id}:{anchor['side']}:{anchor['ratio']:.3f}"
            if key in seen:
                duplicates += 1
            seen.add(key)
    return duplicates


def layout_bounds(document: dict[str, Any]) -> dict[str, float]:
    rectangles = [node.get("layout") for node in document["nodes"]] + [group.get("layout") for group in document.get("groups") or []] + [divider.get("layout") for divider in document.get("routingDividers") or []]
    rectangles = [rectangle for rectangle in rectangles if rectangle]
    if not rectangles:
        return {"width": 0.0, "height": 0.0}
    min_x = min(rectangle["x"] for rectangle in rectangles)
    min_y = min(rectangle["y"] for rectangle in rectangles)
    max_x = max(rectangle["x"] + rectangle["width"] for rectangle in rectangles)
    max_y = max(rectangle["y"] + rectangle["height"] for rectangle in rectangles)
    return {"width": max_x - min_x, "height": max_y - min_y}


def require_node_rectangle(node: dict[str, Any]) -> dict[str, Any]:
    layout = node.get("layout")
    if not layout:
        raise ValueError(f"Node {node['id']} is missing layout.")
    return {"id": node["id"], "x": layout["x"], "y": layout["y"], "width": layout["width"], "height": layout["height"]}


def require_layout_rectangle(item_id: str, layout: dict[str, Any]) -> dict[str, Any]:
    return {"id": item_id, "x": layout["x"], "y": layout["y"], "width": layout["width"], "height": layout["height"]}


def anchor_point(rectangle: dict[str, Any], anchor: dict[str, Any]) -> dict[str, float]:
    if anchor["side"] == "north":
        return point(rectangle["x"] + rectangle["width"] * anchor["ratio"], rectangle["y"])
    if anchor["side"] == "south":
        return point(rectangle["x"] + rectangle["width"] * anchor["ratio"], rectangle["y"] + rectangle["height"])
    if anchor["side"] == "west":
        return point(rectangle["x"], rectangle["y"] + rectangle["height"] * anchor["ratio"])
    return point(rectangle["x"] + rectangle["width"], rectangle["y"] + rectangle["height"] * anchor["ratio"])


def edge_anchor_point(layout: dict[str, Any], anchor: dict[str, Any]) -> dict[str, float]:
    return anchor_point({"id": "", **layout}, anchor)


def outside_port(anchor_value: dict[str, float], anchor: dict[str, Any], lane_index: int) -> dict[str, float]:
    distance = ANCHOR_STUB_DISTANCE * (lane_index + 1)
    if anchor["side"] == "north":
        return point(anchor_value["x"], anchor_value["y"] - distance)
    if anchor["side"] == "south":
        return point(anchor_value["x"], anchor_value["y"] + distance)
    if anchor["side"] == "west":
        return point(anchor_value["x"] - distance, anchor_value["y"])
    return point(anchor_value["x"] + distance, anchor_value["y"])


def anchor_to_relative_point(anchor: dict[str, Any]) -> dict[str, float]:
    if anchor["side"] == "north":
        return point(anchor["ratio"], 0)
    if anchor["side"] == "south":
        return point(anchor["ratio"], 1)
    if anchor["side"] == "west":
        return point(0, anchor["ratio"])
    return point(1, anchor["ratio"])


def rectangle_bounds(rectangles: list[dict[str, Any]]) -> dict[str, float]:
    left = min(rectangle["x"] for rectangle in rectangles)
    right = max(rectangle["x"] + rectangle["width"] for rectangle in rectangles)
    top = min(rectangle["y"] for rectangle in rectangles)
    bottom = max(rectangle["y"] + rectangle["height"] for rectangle in rectangles)
    return {"id": "__bounds__", "x": left, "y": top, "width": right - left, "height": bottom - top, "left": left, "right": right, "top": top, "bottom": bottom}


def center(rectangle: dict[str, Any]) -> dict[str, float]:
    return point(center_x(rectangle), center_y(rectangle))


def center_x(rectangle: dict[str, Any]) -> float:
    return rectangle["x"] + rectangle["width"] / 2


def center_y(rectangle: dict[str, Any]) -> float:
    return rectangle["y"] + rectangle["height"] / 2


def compact_orthogonal_points(points: list[dict[str, float]]) -> list[dict[str, float]]:
    deduped: list[dict[str, float]] = []
    for item in points:
        if not deduped or not points_equal(item, deduped[-1]):
            deduped.append(item)
    output: list[dict[str, float]] = []
    for index, item in enumerate(deduped):
        if index == 0 or index == len(deduped) - 1:
            output.append(item)
            continue
        previous = deduped[index - 1]
        next_item = deduped[index + 1]
        if not ((previous["x"] == item["x"] == next_item["x"]) or (previous["y"] == item["y"] == next_item["y"])):
            output.append(item)
    return output


def unique_routes(routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique_values: list[dict[str, Any]] = []
    for route in routes:
        key = "|".join(f"{round_ratio(pt['x'])},{round_ratio(pt['y'])}" for pt in route["points"])
        if key in seen:
            continue
        seen.add(key)
        unique_values.append(route)
    return unique_values


def path_segments(points: list[dict[str, float]]) -> list[tuple[dict[str, float], dict[str, float]]]:
    return [(points[index], points[index + 1]) for index in range(len(points) - 1)]


def count_bends(points: list[dict[str, float]]) -> int:
    axes = ["v" if start["x"] == end["x"] else "h" if start["y"] == end["y"] else "d" for start, end in path_segments(points)]
    axes = [axis for axis in axes if axis != "d"]
    return sum(1 for index in range(1, len(axes)) if axes[index] != axes[index - 1])


def path_length(points: list[dict[str, float]]) -> float:
    return sum(abs(points[index]["x"] - points[index - 1]["x"]) + abs(points[index]["y"] - points[index - 1]["y"]) for index in range(1, len(points)))


def segment_intersects_rectangle(start: dict[str, float], end: dict[str, float], rect: dict[str, Any]) -> bool:
    if start["x"] == end["x"]:
        return start["x"] > rect["x"] and start["x"] < rect["x"] + rect["width"] and ranges_overlap(start["y"], end["y"], rect["y"], rect["y"] + rect["height"])
    if start["y"] == end["y"]:
        return start["y"] > rect["y"] and start["y"] < rect["y"] + rect["height"] and ranges_overlap(start["x"], end["x"], rect["x"], rect["x"] + rect["width"])
    return False


def rectangles_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left["x"] < right["x"] + right["width"] and left["x"] + left["width"] > right["x"] and left["y"] < right["y"] + right["height"] and left["y"] + left["height"] > right["y"]


def segments_overlap(left_start: dict[str, float], left_end: dict[str, float], right_start: dict[str, float], right_end: dict[str, float]) -> bool:
    if left_start["x"] == left_end["x"] and right_start["x"] == right_end["x"] and abs(left_start["x"] - right_start["x"]) < EPSILON:
        return ranges_overlap(left_start["y"], left_end["y"], right_start["y"], right_end["y"])
    if left_start["y"] == left_end["y"] and right_start["y"] == right_end["y"] and abs(left_start["y"] - right_start["y"]) < EPSILON:
        return ranges_overlap(left_start["x"], left_end["x"], right_start["x"], right_end["x"])
    return False


def segments_intersect(first_start: dict[str, float], first_end: dict[str, float], second_start: dict[str, float], second_end: dict[str, float]) -> bool:
    first_min_x = min(first_start["x"], first_end["x"])
    first_max_x = max(first_start["x"], first_end["x"])
    first_min_y = min(first_start["y"], first_end["y"])
    first_max_y = max(first_start["y"], first_end["y"])
    second_min_x = min(second_start["x"], second_end["x"])
    second_max_x = max(second_start["x"], second_end["x"])
    second_min_y = min(second_start["y"], second_end["y"])
    second_max_y = max(second_start["y"], second_end["y"])
    return (
        first_min_x <= second_max_x
        and first_max_x >= second_min_x
        and first_min_y <= second_max_y
        and first_max_y >= second_min_y
        and orientation(first_start, first_end, second_start) * orientation(first_start, first_end, second_end) <= 0
        and orientation(second_start, second_end, first_start) * orientation(second_start, second_end, first_end) <= 0
    )


def orientation(a: dict[str, float], b: dict[str, float], c: dict[str, float]) -> int:
    value = (b["y"] - a["y"]) * (c["x"] - b["x"]) - (b["x"] - a["x"]) * (c["y"] - b["y"])
    if abs(value) < EPSILON:
        return 0
    return 1 if value > 0 else -1


def ranges_overlap(a: float, b: float, c: float, d: float) -> bool:
    first_min = min(a, b)
    first_max = max(a, b)
    second_min = min(c, d)
    second_max = max(c, d)
    return first_min < second_max and first_max > second_min


def points_equal(left: dict[str, float], right: dict[str, float]) -> bool:
    return abs(left["x"] - right["x"]) < EPSILON and abs(left["y"] - right["y"]) < EPSILON


def routes_equal(left: list[dict[str, float]], right: list[dict[str, float]]) -> bool:
    return len(left) == len(right) and all(points_equal(left[index], right[index]) for index in range(len(left)))


def point_inside_blocked_node(edge: dict[str, Any], item: dict[str, float], nodes: list[dict[str, Any]]) -> bool:
    for node in nodes:
        if node["id"] in [edge["sourceId"], edge["targetId"]] or not node.get("layout"):
            continue
        rect = expand_rectangle(node["layout"], LANE_GRAPH_CLEARANCE)
        if item["x"] > rect["x"] and item["x"] < rect["x"] + rect["width"] and item["y"] > rect["y"] and item["y"] < rect["y"] + rect["height"]:
            return True
    return False


def lane_segment_blocked(
    edge: dict[str, Any],
    start: dict[str, float],
    end: dict[str, float],
    nodes: list[dict[str, Any]],
    accepted_paths: list[dict[str, Any]],
) -> bool:
    if points_equal(start, end):
        return True
    for node in nodes:
        if node["id"] in [edge["sourceId"], edge["targetId"]] or not node.get("layout"):
            continue
        if segment_intersects_rectangle(start, end, expand_rectangle(node["layout"], LANE_GRAPH_CLEARANCE)):
            return True
    for accepted in accepted_paths:
        for accepted_start, accepted_end in path_segments(accepted["points"]):
            if segments_overlap(start, end, accepted_start, accepted_end):
                return True
    return False


def segment_crossings_with_accepted(start: dict[str, float], end: dict[str, float], accepted_paths: list[dict[str, Any]]) -> int:
    crossings = 0
    for accepted in accepted_paths:
        for accepted_start, accepted_end in path_segments(accepted["points"]):
            if (
                not segments_overlap(start, end, accepted_start, accepted_end)
                and segments_intersect(start, end, accepted_start, accepted_end)
                and not points_equal(start, accepted_start)
                and not points_equal(start, accepted_end)
                and not points_equal(end, accepted_start)
                and not points_equal(end, accepted_end)
            ):
                crossings += 1
    return crossings


def expand_rectangle(rectangle: dict[str, Any], clearance: float) -> dict[str, float]:
    return {
        "x": rectangle["x"] - clearance,
        "y": rectangle["y"] - clearance,
        "width": rectangle["width"] + clearance * 2,
        "height": rectangle["height"] + clearance * 2,
    }


def intersection_point(
    first_start: dict[str, float], first_end: dict[str, float], second_start: dict[str, float], second_end: dict[str, float]
) -> dict[str, float] | None:
    if first_start["x"] == first_end["x"] and second_start["y"] == second_end["y"]:
        return point(first_start["x"], second_start["y"])
    if first_start["y"] == first_end["y"] and second_start["x"] == second_end["x"]:
        return point(second_start["x"], first_start["y"])
    return None


def is_divider_trunk_overlap_exempt(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return bool(left.get("trunkDividerId") and left.get("trunkDividerId") == right.get("trunkDividerId"))


def segment_overlap_ref(other_edge_id: str, segment: dict[str, Any], other_segment: dict[str, Any], divider_exempt: bool) -> dict[str, Any]:
    return {"otherEdgeId": other_edge_id, "segment": segment, "otherSegment": other_segment, "dividerExempt": divider_exempt}


def edge_crossing_ref(other_edge_id: str, segment: dict[str, Any], other_segment: dict[str, Any], point_value: dict[str, float] | None) -> dict[str, Any]:
    return {"otherEdgeId": other_edge_id, "segment": segment, "otherSegment": other_segment, **({"point": point_value} if point_value else {})}


def segment_ref_key(ref: dict[str, Any]) -> tuple[str, str, int]:
    return (ref.get("edgeId", ""), ref.get("segmentId", ""), ref.get("segmentIndex", 0))


def endpoint_key(edge_id: str, role: str) -> str:
    return f"{edge_id}:{role}"


def stable_anchor_ratio(value: str) -> float:
    hash_value = 0
    for char in value:
        hash_value = (hash_value * 31 + ord(char)) % 700
    return round_ratio(0.15 + hash_value / 1000)


def deterministic_private_offsets(edge_id: str, edge_index: int) -> list[float]:
    step = ANCHOR_STUB_DISTANCE
    bias = ((stable_hash(edge_id) + edge_index) % 5) - 2
    base = bias * step
    offsets = [base, 0]
    for index in range(1, PRIVATE_OFFSET_SWEEP_RADIUS + 1):
        offsets.extend([base + step * index, base - step * index, step * index, -step * index])
    return list(dict.fromkeys(offsets))


def stable_hash(value: str) -> int:
    hash_value = 0
    for char in value:
        hash_value = ((hash_value * 31 + ord(char)) & 0xFFFFFFFF)
    return hash_value


def opposite_side(side: str) -> str:
    return {"north": "south", "south": "north", "west": "east", "east": "west"}[side]


def unique_sorted_numbers(values: Iterable[float]) -> list[float]:
    return sorted(set(round_coordinate(value) for value in values if math.isfinite(value)))


def round_coordinate(value: float) -> float:
    return round(value, 3)


def point_key(item: dict[str, float]) -> str:
    return f"{round_coordinate(item['x'])},{round_coordinate(item['y'])}"


def count_events(events: list[dict[str, Any]], event_type: str) -> int:
    return sum(1 for event in events if event.get("type") == event_type)


def log_events_to_diagnostics(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"severity": "error" if event["level"] == "error" else "warning", "message": event["message"]}
        for event in events
        if event["level"] in ["warn", "error"]
    ]


def extract_mermaid_class_diagram_source(source: str) -> str:
    normalized = source.replace("\r\n", "\n")
    fence_re = re.compile(r"```(?:mermaid)?[^\n]*\n(.*?)```", re.IGNORECASE | re.DOTALL)
    for match in fence_re.finditer(normalized):
        block = match.group(1)
        if re.search(r"(?m)^\s*classDiagram\s*$", block):
            return block
    return normalized


def read_input(path: str | Path) -> dict[str, Any]:
    source = extract_mermaid_class_diagram_source(Path(path).read_text(encoding="utf8"))
    document = parse_mermaid_class_diagram(source)
    if not document["nodes"]:
        raise ValueError("No class nodes were parsed from the input.")
    return document


def emit_layout_report(report: dict[str, Any], *, verbose: bool, trace_routing: bool) -> None:
    allowed = {"warn", "error"}
    if verbose:
        allowed = {"info", "warn", "error"}
    if trace_routing:
        allowed = {"debug", "info", "warn", "error"}
    events = report.get("trace") or report["warnings"] + report["errors"]
    for event in events:
        if event["level"] not in allowed:
            continue
        prefix = {"debug": "Debug", "info": "Info", "warn": "Warning", "error": "Error"}[event["level"]]
        print(f"{prefix}: {event['message']}", file=sys.stderr if event["level"] in ["warn", "error"] else sys.stdout)


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone AutoDiagram routing-v2 Mermaid to draw.io generator.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    layout_init = subparsers.add_parser("layout-init")
    layout_init.add_argument("input")
    layout_init.add_argument("-o", "--output", required=True)
    layout_init.add_argument("--suggested-layout", action="store_true")
    layout_init.add_argument("--engine", default="v2")

    generate = subparsers.add_parser("generate")
    generate.add_argument("input")
    generate.add_argument("-o", "--output", required=True)
    generate.add_argument("--layout")
    generate.add_argument("--auto-arrange", action="store_true")
    generate.add_argument("--group-frames", action="store_true")
    generate.add_argument("--verbose", action="store_true")
    generate.add_argument("--trace-routing", action="store_true")
    generate.add_argument("--log-layout-json")
    generate.add_argument("--engine", default="v2")

    args = parser.parse_args(argv)
    if getattr(args, "engine", "v2") != "v2":
        raise SystemExit("This standalone Python script only supports --engine v2.")

    if args.command == "layout-init":
        document = read_input(args.input)
        layout = create_initial_coordinate_routing_layout_v3(document, "suggested" if args.suggested_layout else "grid")
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(layout, indent=2) + "\n", encoding="utf8")
        print(f"Generated {output}")
        return 0

    if args.command == "generate":
        if args.layout and args.auto_arrange:
            raise SystemExit("--layout and --auto-arrange cannot be used together.")
        document = read_input(args.input)
        layout_input = json.loads(Path(args.layout).read_text(encoding="utf8")) if args.layout else None
        engine = "auto-arrange-v2" if args.auto_arrange else "manual-routing-v2" if layout_input is not None else "suggest-initial-v2"
        result = run_routing_pipeline(
            document,
            engine=engine,
            layout_input=layout_input,
            route_strategy="template-with-outer-lanes",
            trace_routing=args.trace_routing or args.verbose or bool(args.log_layout_json),
        )
        xml = to_mx_graph_model_xml(result["document"], group_frames=args.group_frames)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(xml, encoding="utf8")
        if args.log_layout_json:
            report_path = Path(args.log_layout_json)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(result["report"], indent=2) + "\n", encoding="utf8")
        emit_layout_report(result["report"], verbose=args.verbose, trace_routing=args.trace_routing)
        print(f"Generated {output}")
        return 0

    return 1


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string.")
    return value


def require_finite_number(value: Any, label: str) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a finite number.") from error
    if not math.isfinite(numeric):
        raise ValueError(f"{label} must be a finite number.")
    return numeric


def unique(values: Iterable[Any]) -> list[Any]:
    output = []
    seen = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


def round_ratio(value: float) -> float:
    return round(value, 3)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def escape_xml_attribute(value: Any) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
        .replace("\r\n", "&#xa;")
        .replace("\n", "&#xa;")
    )


def escape_html_text(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def format_number(value: float) -> str:
    numeric = float(value)
    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.2f}".rstrip("0").rstrip(".")


if __name__ == "__main__":
    try:
        raise SystemExit(run_cli())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
