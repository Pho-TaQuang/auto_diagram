#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ANCHOR_POSITIONS = (0.25, 0.5, 0.75)
BOX_MARGIN = 120.0
COL_GAP = 260.0
ROW_GAP = 140.0
COMPONENT_GAP = 320.0
PORT_STUB = 40.0


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass(frozen=True)
class EdgeRef:
    id: str
    source: str
    target: str


@dataclass(frozen=True)
class Anchor:
    rel_x: float
    rel_y: float
    side: str


@dataclass(frozen=True)
class LayoutCandidate:
    name: str
    positions: dict[str, tuple[float, float]]


@dataclass(frozen=True)
class LayoutScore:
    value: float
    edge_crossings: int
    edge_bends: int
    duplicate_anchors: int
    segment_overlaps: int
    box_hits: int
    box_overlaps: int
    total_edge_length: float
    layout_width: float
    layout_height: float
    layout_area: float


@dataclass(frozen=True)
class RouteAttempt:
    candidate: LayoutCandidate
    score: LayoutScore
    anchors: dict[tuple[str, str], Anchor]
    paths: dict[str, list[tuple[float, float]]]


ROUTING_STYLE_KEYS = {
    "curved": "0",
    "edgeStyle": "orthogonalEdgeStyle",
    "rounded": "0",
    "orthogonalLoop": "1",
    "jettySize": "auto",
    "html": "1",
}


def trim_float(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def parse_style(style: str) -> OrderedDict[str, str | None]:
    parts: OrderedDict[str, str | None] = OrderedDict()
    for raw_item in style.split(";"):
        item = raw_item.strip()
        if not item:
            continue
        if "=" in item:
            key, value = item.split("=", 1)
            parts[key] = value
        else:
            parts[item] = None
    return parts


def format_style(parts: OrderedDict[str, str | None]) -> str:
    rendered = []
    for key, value in parts.items():
        rendered.append(key if value is None else f"{key}={value}")
    return ";".join(rendered) + ";"


def get_geometry(cell: ET.Element) -> ET.Element:
    geometry = cell.find("mxGeometry[@as='geometry']")
    if geometry is None:
        geometry = ET.SubElement(cell, "mxGeometry", {"as": "geometry"})
    return geometry


def find_model(tree: ET.ElementTree) -> ET.Element:
    model = tree.getroot()
    if model.tag == "mxGraphModel":
        return model
    nested = model.find(".//mxGraphModel")
    if nested is None:
        raise ValueError("Input is not raw/uncompressed mxGraphModel XML.")
    return nested


def is_layout_box(cell: ET.Element) -> bool:
    if cell.get("vertex") != "1" or cell.get("parent") != "1":
        return False
    geometry = cell.find("mxGeometry[@as='geometry']")
    if geometry is None:
        return False
    width = float(geometry.get("width", "0") or 0)
    height = float(geometry.get("height", "0") or 0)
    if width < 60 or height < 60:
        return False
    style = cell.get("style", "")
    value = cell.get("value", "")
    return "swimlane" in style or "&lt;&lt;" in value or "<<" in value


def collect_boxes(root: ET.Element) -> dict[str, Box]:
    boxes = {}
    for cell in root.findall(".//mxCell"):
        if not is_layout_box(cell):
            continue
        geometry = get_geometry(cell)
        boxes[cell.get("id", "")] = Box(
            float(geometry.get("x", "0") or 0),
            float(geometry.get("y", "0") or 0),
            float(geometry.get("width", "0") or 0),
            float(geometry.get("height", "0") or 0),
        )
    return boxes


def collect_edges(root: ET.Element, boxes: dict[str, Box]) -> list[EdgeRef]:
    edges = []
    for cell in root.findall(".//mxCell[@edge='1']"):
        source = cell.get("source")
        target = cell.get("target")
        if source in boxes and target in boxes:
            edges.append(EdgeRef(cell.get("id", ""), source, target))
    return edges


def clean_label_text(value: str) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<<[^<>\n]+>>", "\n", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("\r", "\n")


def class_name_from_value(value: str) -> str | None:
    for raw_line in clean_label_text(value).splitlines():
        line = raw_line.strip()
        if not line:
            continue
        return line
    return None


def collect_box_names(root: ET.Element, boxes: dict[str, Box]) -> dict[str, str]:
    names = {}
    for cell in root.findall(".//mxCell"):
        cell_id = cell.get("id")
        if cell_id not in boxes:
            continue
        name = class_name_from_value(cell.get("value", ""))
        if name:
            names[name] = cell_id
    return names


def graph_adjacency(boxes: dict[str, Box], edges: Iterable[EdgeRef]) -> dict[str, set[str]]:
    adjacency = {box_id: set() for box_id in boxes}
    for edge in edges:
        adjacency[edge.source].add(edge.target)
        adjacency[edge.target].add(edge.source)
    return adjacency


def connected_components(boxes: dict[str, Box], edges: Iterable[EdgeRef]) -> list[list[str]]:
    adjacency = graph_adjacency(boxes, edges)
    remaining = set(boxes)
    components = []
    while remaining:
        start = min(remaining, key=lambda box_id: (boxes[box_id].y, boxes[box_id].x, box_id))
        queue = deque([start])
        remaining.remove(start)
        component = []
        while queue:
            node = queue.popleft()
            component.append(node)
            for neighbor in sorted(adjacency[node]):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
        components.append(component)
    return components


def all_pairs_distance_sum(component: list[str], adjacency: dict[str, set[str]], start: str) -> int:
    distances = {start: 0}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for neighbor in adjacency[node]:
            if neighbor not in distances:
                distances[neighbor] = distances[node] + 1
                queue.append(neighbor)
    return sum(distances.get(node, 999) for node in component)


def choose_component_root(component: list[str], boxes: dict[str, Box], adjacency: dict[str, set[str]]) -> str:
    return min(
        component,
        key=lambda node: (
            -len(adjacency[node]),
            all_pairs_distance_sum(component, adjacency, node),
            boxes[node].y,
            boxes[node].x,
            node,
        ),
    )


def bfs_levels(component: list[str], root_id: str, adjacency: dict[str, set[str]]) -> dict[str, int]:
    levels = {root_id: 0}
    queue = deque([root_id])
    while queue:
        node = queue.popleft()
        for neighbor in sorted(adjacency[node]):
            if neighbor not in levels:
                levels[neighbor] = levels[node] + 1
                queue.append(neighbor)
    for node in component:
        levels.setdefault(node, 0)
    return levels


def layout_component(
    component: list[str],
    boxes: dict[str, Box],
    adjacency: dict[str, set[str]],
    origin_x: float,
    origin_y: float,
    root_id: str | None = None,
) -> tuple[dict[str, tuple[float, float]], float, float]:
    root_id = root_id if root_id in component else choose_component_root(component, boxes, adjacency)
    levels = bfs_levels(component, root_id, adjacency)
    columns: dict[int, list[str]] = defaultdict(list)
    for node in component:
        columns[levels[node]].append(node)

    ordered_levels = sorted(columns)
    column_widths = {level: max(boxes[node].w for node in nodes) for level, nodes in columns.items()}
    column_x: dict[int, float] = {}
    cursor_x = origin_x
    for level in ordered_levels:
        column_x[level] = cursor_x
        cursor_x += column_widths[level] + COL_GAP

    column_heights = {}
    for level, nodes in columns.items():
        column_heights[level] = sum(boxes[node].h for node in nodes) + ROW_GAP * max(0, len(nodes) - 1)
    center_y = origin_y + max(column_heights.values()) / 2

    positions: dict[str, tuple[float, float]] = {}
    min_y = float("inf")
    max_y = float("-inf")
    for level in ordered_levels:
        nodes = sorted(columns[level], key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node))
        main = nodes[0]
        width = column_widths[level]
        x = column_x[level] + (width - boxes[main].w) / 2
        y = center_y - boxes[main].h / 2
        positions[main] = (x, y)
        min_y = min(min_y, y)
        max_y = max(max_y, y + boxes[main].h)

        below_y = center_y + boxes[main].h / 2 + ROW_GAP
        above_y = center_y - boxes[main].h / 2 - ROW_GAP
        for index, node in enumerate(nodes[1:]):
            x = column_x[level] + (width - boxes[node].w) / 2
            if index % 2 == 0:
                y = below_y
                below_y += boxes[node].h + ROW_GAP
            else:
                y = above_y - boxes[node].h
                above_y = y - ROW_GAP
            positions[node] = (x, y)
            min_y = min(min_y, y)
            max_y = max(max_y, y + boxes[node].h)

    if min_y < origin_y:
        shift_y = origin_y - min_y
        positions = {node: (x, y + shift_y) for node, (x, y) in positions.items()}
        max_y += shift_y

    width = cursor_x - origin_x - COL_GAP
    height = max_y - origin_y
    return positions, width, height


def layout_component_top_to_bottom(
    component: list[str],
    boxes: dict[str, Box],
    adjacency: dict[str, set[str]],
    origin_x: float,
    origin_y: float,
    root_id: str | None = None,
) -> tuple[dict[str, tuple[float, float]], float, float]:
    root_id = root_id if root_id in component else choose_component_root(component, boxes, adjacency)
    levels = bfs_levels(component, root_id, adjacency)
    rows: dict[int, list[str]] = defaultdict(list)
    for node in component:
        rows[levels[node]].append(node)

    ordered_levels = sorted(rows)
    row_heights = {level: max(boxes[node].h for node in nodes) for level, nodes in rows.items()}
    row_y: dict[int, float] = {}
    cursor_y = origin_y
    for level in ordered_levels:
        row_y[level] = cursor_y
        cursor_y += row_heights[level] + ROW_GAP

    row_widths = {}
    for level, nodes in rows.items():
        row_widths[level] = sum(boxes[node].w for node in nodes) + COL_GAP * max(0, len(nodes) - 1)
    center_x = origin_x + max(row_widths.values()) / 2

    positions: dict[str, tuple[float, float]] = {}
    min_x = float("inf")
    max_x = float("-inf")
    for level in ordered_levels:
        nodes = sorted(rows[level], key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node))
        main = nodes[0]
        height = row_heights[level]
        x = center_x - boxes[main].w / 2
        y = row_y[level] + (height - boxes[main].h) / 2
        positions[main] = (x, y)
        min_x = min(min_x, x)
        max_x = max(max_x, x + boxes[main].w)

        right_x = center_x + boxes[main].w / 2 + COL_GAP
        left_x = center_x - boxes[main].w / 2 - COL_GAP
        for index, node in enumerate(nodes[1:]):
            y = row_y[level] + (height - boxes[node].h) / 2
            if index % 2 == 0:
                x = right_x
                right_x += boxes[node].w + COL_GAP
            else:
                x = left_x - boxes[node].w
                left_x = x - COL_GAP
            positions[node] = (x, y)
            min_x = min(min_x, x)
            max_x = max(max_x, x + boxes[node].w)

    if min_x < origin_x:
        shift_x = origin_x - min_x
        positions = {node: (x + shift_x, y) for node, (x, y) in positions.items()}
        max_x += shift_x

    width = max_x - origin_x
    height = cursor_y - origin_y - ROW_GAP
    return positions, width, height


def stack_nodes(
    nodes: list[str],
    boxes: dict[str, Box],
    x: float,
    center_y: float,
) -> dict[str, tuple[float, float]]:
    if not nodes:
        return {}
    total_height = sum(boxes[node].h for node in nodes) + ROW_GAP * max(0, len(nodes) - 1)
    y = center_y - total_height / 2
    positions = {}
    max_width = max(boxes[node].w for node in nodes)
    for node in nodes:
        positions[node] = (x + (max_width - boxes[node].w) / 2, y)
        y += boxes[node].h + ROW_GAP
    return positions


def row_nodes(
    nodes: list[str],
    boxes: dict[str, Box],
    center_x: float,
    y: float,
) -> dict[str, tuple[float, float]]:
    if not nodes:
        return {}
    total_width = sum(boxes[node].w for node in nodes) + COL_GAP * max(0, len(nodes) - 1)
    x = center_x - total_width / 2
    positions = {}
    max_height = max(boxes[node].h for node in nodes)
    for node in nodes:
        positions[node] = (x, y + (max_height - boxes[node].h) / 2)
        x += boxes[node].w + COL_GAP
    return positions


def layout_component_hub_spoke(
    component: list[str],
    boxes: dict[str, Box],
    adjacency: dict[str, set[str]],
    origin_x: float,
    origin_y: float,
    root_id: str | None = None,
) -> tuple[dict[str, tuple[float, float]], float, float]:
    root_id = root_id if root_id in component else choose_component_root(component, boxes, adjacency)
    neighbors = sorted(adjacency[root_id] & set(component), key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node))
    remaining = [node for node in component if node != root_id and node not in neighbors]

    left = neighbors[0::4]
    right = neighbors[1::4]
    top = neighbors[2::4]
    bottom = neighbors[3::4]
    left_width = max((boxes[node].w for node in left), default=0.0)
    top_height = max((boxes[node].h for node in top), default=0.0)

    root_x = origin_x + left_width + (COL_GAP if left else 0.0)
    root_y = origin_y + top_height + (ROW_GAP if top else 0.0)
    root_box = boxes[root_id]
    center_x = root_x + root_box.w / 2
    center_y = root_y + root_box.h / 2

    positions: dict[str, tuple[float, float]] = {root_id: (root_x, root_y)}
    if left:
        positions.update(stack_nodes(left, boxes, origin_x, center_y))
    if right:
        positions.update(stack_nodes(right, boxes, root_x + root_box.w + COL_GAP, center_y))
    if top:
        top_row = row_nodes(top, boxes, center_x, origin_y)
        positions.update(top_row)
    if bottom:
        positions.update(row_nodes(bottom, boxes, center_x, root_y + root_box.h + ROW_GAP))
    if remaining:
        outer_x = root_x + root_box.w + COL_GAP
        if right:
            outer_x += max(boxes[node].w for node in right) + COL_GAP
        ordered = sorted(remaining, key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node))
        positions.update(stack_nodes(ordered, boxes, outer_x, center_y))

    min_x = min(x for x, _ in positions.values())
    min_y = min(y for _, y in positions.values())
    if min_x < origin_x or min_y < origin_y:
        shift_x = max(0.0, origin_x - min_x)
        shift_y = max(0.0, origin_y - min_y)
        positions = {node: (x + shift_x, y + shift_y) for node, (x, y) in positions.items()}

    width = max(x + boxes[node].w for node, (x, _) in positions.items()) - origin_x
    height = max(y + boxes[node].h for node, (_, y) in positions.items()) - origin_y
    return positions, width, height


def layout_component_cluster_grid(
    component: list[str],
    boxes: dict[str, Box],
    adjacency: dict[str, set[str]],
    origin_x: float,
    origin_y: float,
    root_id: str | None = None,
) -> tuple[dict[str, tuple[float, float]], float, float]:
    root_id = root_id if root_id in component else choose_component_root(component, boxes, adjacency)
    ordered = [root_id]
    frontier = deque(sorted(adjacency[root_id] & set(component), key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node)))
    seen = {root_id}
    while frontier:
        node = frontier.popleft()
        if node in seen:
            continue
        seen.add(node)
        ordered.append(node)
        for neighbor in sorted(adjacency[node] & set(component), key=lambda item: (-len(adjacency[item]), boxes[item].y, boxes[item].x, item)):
            if neighbor not in seen:
                frontier.append(neighbor)
    for node in sorted(component, key=lambda item: (-len(adjacency[item]), boxes[item].y, boxes[item].x, item)):
        if node not in seen:
            ordered.append(node)

    columns = max(1, int(len(ordered) ** 0.5 + 0.999))
    column_widths = [0.0 for _ in range(columns)]
    row_heights: list[float] = []
    for index, node in enumerate(ordered):
        col = index % columns
        row = index // columns
        while len(row_heights) <= row:
            row_heights.append(0.0)
        column_widths[col] = max(column_widths[col], boxes[node].w)
        row_heights[row] = max(row_heights[row], boxes[node].h)

    x_by_col = []
    cursor_x = origin_x
    for width in column_widths:
        x_by_col.append(cursor_x)
        cursor_x += width + COL_GAP
    y_by_row = []
    cursor_y = origin_y
    for height in row_heights:
        y_by_row.append(cursor_y)
        cursor_y += height + ROW_GAP

    positions = {}
    for index, node in enumerate(ordered):
        col = index % columns
        row = index // columns
        positions[node] = (
            x_by_col[col] + (column_widths[col] - boxes[node].w) / 2,
            y_by_row[row] + (row_heights[row] - boxes[node].h) / 2,
        )

    width = cursor_x - origin_x - COL_GAP
    height = cursor_y - origin_y - ROW_GAP
    return positions, width, height


def arrange_components(
    boxes: dict[str, Box],
    edges: list[EdgeRef],
    layout_func,
    root_preferences: dict[str, str] | None = None,
) -> dict[str, tuple[float, float]]:
    adjacency = graph_adjacency(boxes, edges)
    components = connected_components(boxes, edges)
    components.sort(key=lambda component: (-len(component), min(boxes[node].y for node in component), min(boxes[node].x for node in component)))

    all_positions: dict[str, tuple[float, float]] = {}
    cursor_x = 100.0
    base_y = 100.0
    for component in components:
        preferred = None
        if root_preferences:
            preferred = next((root_preferences[node] for node in component if node in root_preferences), None)
        positions, width, _height = layout_func(component, boxes, adjacency, cursor_x, base_y, preferred)
        all_positions.update(positions)
        cursor_x += width + COMPONENT_GAP

    return all_positions


def arrange_components_vertical(
    boxes: dict[str, Box],
    edges: list[EdgeRef],
    layout_func,
    root_preferences: dict[str, str] | None = None,
) -> dict[str, tuple[float, float]]:
    adjacency = graph_adjacency(boxes, edges)
    components = connected_components(boxes, edges)
    components.sort(key=lambda component: (-len(component), min(boxes[node].y for node in component), min(boxes[node].x for node in component)))

    all_positions: dict[str, tuple[float, float]] = {}
    base_x = 100.0
    cursor_y = 100.0
    for component in components:
        preferred = None
        if root_preferences:
            preferred = next((root_preferences[node] for node in component if node in root_preferences), None)
        positions, _width, height = layout_func(component, boxes, adjacency, base_x, cursor_y, preferred)
        all_positions.update(positions)
        cursor_y += height + COMPONENT_GAP

    return all_positions

def apply_generic_layout(root: ET.Element, boxes: dict[str, Box], edges: list[EdgeRef]) -> dict[str, Box]:
    all_positions = arrange_components(boxes, edges, layout_component)

    for cell_id, (x, y) in all_positions.items():
        cell = root.find(f".//mxCell[@id='{cell_id}']")
        if cell is None:
            continue
        geometry = get_geometry(cell)
        geometry.set("x", trim_float(x))
        geometry.set("y", trim_float(y))

    return collect_boxes(root)


def set_box_positions(root: ET.Element, positions: dict[str, tuple[float, float]]) -> dict[str, Box]:
    if positions:
        min_x = min(x for x, _y in positions.values())
        min_y = min(y for _x, y in positions.values())
        shift_x = max(0.0, 100.0 - min_x)
        shift_y = max(0.0, 100.0 - min_y)
        if shift_x or shift_y:
            positions = {cell_id: (x + shift_x, y + shift_y) for cell_id, (x, y) in positions.items()}

    for cell_id, (x, y) in positions.items():
        cell = root.find(f".//mxCell[@id='{cell_id}']")
        if cell is None:
            continue
        geometry = get_geometry(cell)
        geometry.set("x", trim_float(x))
        geometry.set("y", trim_float(y))
    return collect_boxes(root)


def apply_danh_gia_su_kien_layout(root: ET.Element, boxes: dict[str, Box]) -> dict[str, Box]:
    return apply_scored_layout(root, boxes, collect_edges(root, boxes), preset="danh-gia-su-kien")


QL_SU_KIEN_NAMES = {
    "SysqlskSuKienEntity",
    "SysqlskSuKienSoDoEntity",
    "SysdmTinhTrangSuKienEntity",
    "SysqlskKeHoachSuKienEntity",
    "SuKienModel",
    "SuKienSearchModel",
    "ChangeTinhTrangSuKienModel",
    "ChangeMucDoRuiRoModel",
    "SuKienSoDoModel",
    "KeHoachSuKienModel",
}


def generate_ql_su_kien_candidates(boxes: dict[str, Box], by_name: dict[str, str]) -> list[LayoutCandidate]:
    if not QL_SU_KIEN_NAMES.issubset(by_name):
        return []

    status = "SysdmTinhTrangSuKienEntity"
    plan_entity = "SysqlskKeHoachSuKienEntity"
    risk_change = "ChangeMucDoRuiRoModel"
    status_change = "ChangeTinhTrangSuKienModel"
    event_dto = "SuKienModel"
    event_entity = "SysqlskSuKienEntity"
    search = "SuKienSearchModel"
    plan_dto = "KeHoachSuKienModel"
    map_dto = "SuKienSoDoModel"
    map_entity = "SysqlskSuKienSoDoEntity"

    def box(name: str) -> Box:
        return boxes[by_name[name]]

    def build_layered(horizontal_gap: float, bottom_extra: float) -> dict[str, tuple[float, float]]:
        left_status_x = 100.0
        left_column_width = max(box(plan_entity).w, box(risk_change).w, box(status_change).w)
        center_column_width = max(box(event_dto).w, box(event_entity).w, box(search).w, box(plan_dto).w)
        right_column_width = max(box(map_dto).w, box(map_entity).w)

        left_column_x = left_status_x + box(status).w + horizontal_gap / 2
        center_column_x = left_column_x + left_column_width + horizontal_gap
        right_column_x = center_column_x + center_column_width + horizontal_gap
        center_x = center_column_x + center_column_width / 2

        top_y = 100.0
        event_dto_y = top_y + box(plan_dto).h + ROW_GAP
        event_entity_y = event_dto_y + box(event_dto).h + ROW_GAP
        bottom_y = event_entity_y + box(event_entity).h + ROW_GAP + bottom_extra

        positions: dict[str, tuple[float, float]] = {}

        def put(name: str, x: float, y: float) -> None:
            positions[by_name[name]] = (x, y)

        def put_centered(name: str, cx: float, y: float) -> None:
            put(name, cx - box(name).w / 2, y)

        put_centered(plan_dto, center_x, top_y)
        put_centered(event_dto, center_x, event_dto_y)
        put_centered(event_entity, center_x, event_entity_y)
        put(plan_entity, left_column_x, event_dto_y + (box(event_dto).h - box(plan_entity).h) / 2)
        put(
            risk_change,
            left_column_x + (left_column_width - box(risk_change).w) / 2,
            event_entity_y + box(event_entity).h * 0.64,
        )
        put(status_change, left_column_x + (left_column_width - box(status_change).w) / 2, bottom_y)
        put(status, left_status_x, bottom_y - 35)
        put(search, center_column_x + (center_column_width - box(search).w) / 2, bottom_y)
        put(
            map_dto,
            right_column_x + (right_column_width - box(map_dto).w) / 2,
            event_entity_y + (box(event_entity).h - box(map_dto).h) / 2,
        )
        put(map_entity, right_column_x + (right_column_width - box(map_entity).w) / 2, bottom_y)
        return positions

    def build_compact_ring(side_gap: float) -> dict[str, tuple[float, float]]:
        left_x = 100.0
        left_width = max(box(status).w, box(plan_entity).w, box(risk_change).w, box(status_change).w)
        center_width = max(box(event_dto).w, box(event_entity).w, box(plan_dto).w)
        right_width = max(box(search).w, box(map_dto).w, box(map_entity).w)
        center_x = left_x + left_width + side_gap
        right_x = center_x + center_width + side_gap

        top_y = 100.0
        event_dto_y = top_y + box(plan_dto).h + ROW_GAP
        event_entity_y = event_dto_y + box(event_dto).h + ROW_GAP
        search_y = event_entity_y + box(event_entity).h + 20
        status_change_y = search_y + box(search).h - box(status_change).h

        positions: dict[str, tuple[float, float]] = {}

        def put_in_column(name: str, x: float, width: float, y: float) -> None:
            positions[by_name[name]] = (x + (width - box(name).w) / 2, y)

        put_in_column(plan_dto, center_x, center_width, top_y)
        put_in_column(event_dto, center_x, center_width, event_dto_y)
        put_in_column(event_entity, center_x, center_width, event_entity_y)

        put_in_column(plan_entity, left_x, left_width, event_dto_y + (box(event_dto).h - box(plan_entity).h) / 2)
        put_in_column(status, left_x, left_width, event_entity_y + (box(event_entity).h - box(status).h) * 0.2)
        put_in_column(risk_change, left_x, left_width, event_entity_y + box(event_entity).h * 0.64)
        put_in_column(status_change, left_x, left_width, status_change_y)

        put_in_column(map_dto, right_x, right_width, event_dto_y + (box(event_dto).h - box(map_dto).h) / 2)
        put_in_column(map_entity, right_x, right_width, event_entity_y + (box(event_entity).h - box(map_entity).h) * 0.5)
        put_in_column(search, right_x, right_width, search_y)
        return positions

    return [
        LayoutCandidate("ql-su-kien-compact-ring", build_compact_ring(side_gap=177.0)),
        LayoutCandidate("ql-su-kien-compact-ring-spacious", build_compact_ring(side_gap=190.0)),
        LayoutCandidate("ql-su-kien-layered-balanced", build_layered(horizontal_gap=300.0, bottom_extra=0.0)),
        LayoutCandidate("ql-su-kien-layered-compact", build_layered(horizontal_gap=240.0, bottom_extra=0.0)),
        LayoutCandidate("ql-su-kien-layered-spacious-bottom", build_layered(horizontal_gap=300.0, bottom_extra=100.0)),
    ]


def side_rel(side: str, position: float) -> tuple[float, float]:
    if side == "left":
        return (0.0, position)
    if side == "right":
        return (1.0, position)
    if side == "top":
        return (position, 0.0)
    if side == "bottom":
        return (position, 1.0)
    raise ValueError(f"Unknown side: {side}")


def opposite_side(side: str) -> str:
    return {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}[side]


def side_candidates(preferred: str) -> tuple[str, ...]:
    if preferred in ("left", "right"):
        return (preferred, "top", "bottom", opposite_side(preferred))
    return (preferred, "left", "right", opposite_side(preferred))


def directional_side_candidates(preferred: str, box: Box, other_box: Box) -> tuple[str, ...]:
    if preferred in ("left", "right"):
        adjacent = ("bottom", "top") if other_box.cy >= box.cy else ("top", "bottom")
        return (preferred, adjacent[0], adjacent[1], opposite_side(preferred))
    adjacent = ("right", "left") if other_box.cx >= box.cx else ("left", "right")
    return (preferred, adjacent[0], adjacent[1], opposite_side(preferred))


def anchor_position_order(box: Box, other_box: Box, side: str) -> tuple[float, ...]:
    if side in ("top", "bottom"):
        delta = other_box.cx - box.cx
        tolerance = max(20.0, box.w * 0.1)
    else:
        delta = other_box.cy - box.cy
        tolerance = max(20.0, box.h * 0.1)

    if delta < -tolerance:
        ideal = 0.25
    elif delta > tolerance:
        ideal = 0.75
    else:
        ideal = 0.5
    return tuple(sorted(ANCHOR_POSITIONS, key=lambda position: (abs(position - ideal), position)))


def preferred_sides(source_box: Box, target_box: Box) -> tuple[str, str]:
    dx = target_box.cx - source_box.cx
    dy = target_box.cy - source_box.cy
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")


def allocate_anchors(boxes: dict[str, Box], edges: list[EdgeRef]) -> dict[tuple[str, str], Anchor]:
    endpoint_requests: dict[str, list[tuple[str, bool, str, str]]] = defaultdict(list)
    for edge in edges:
        source_side, target_side = preferred_sides(boxes[edge.source], boxes[edge.target])
        endpoint_requests[edge.source].append((edge.id, True, source_side, edge.target))
        endpoint_requests[edge.target].append((edge.id, False, target_side, edge.source))

    assignments: dict[tuple[str, str], Anchor] = {}
    for cell_id, requests in endpoint_requests.items():
        used: set[tuple[str, float]] = set()
        box = boxes[cell_id]

        def request_key(item: tuple[str, bool, str, str]) -> tuple[str, float, str, bool]:
            edge_id, is_source, preferred, other_id = item
            other_box = boxes[other_id]
            direction = other_box.cy - box.cy if preferred in ("left", "right") else other_box.cx - box.cx
            return (preferred, direction, edge_id, is_source)

        for edge_id, is_source, preferred, other_id in sorted(requests, key=request_key):
            other_box = boxes[other_id]
            chosen_anchor = None
            for side in directional_side_candidates(preferred, box, other_box):
                for position in anchor_position_order(box, other_box, side):
                    usage_key = (side, position)
                    if usage_key in used:
                        continue
                    rel_x, rel_y = side_rel(side, position)
                    chosen_anchor = Anchor(rel_x, rel_y, side)
                    used.add(usage_key)
                    break
                if chosen_anchor is not None:
                    break
            if chosen_anchor is None:
                raise ValueError(f"{cell_id}: more than 12 edge endpoints cannot use unique 25/50/75 anchors.")
            key = (edge_id, "source" if is_source else "target")
            assignments[key] = chosen_anchor

    return assignments


def connection_point(box: Box, anchor: Anchor) -> tuple[float, float]:
    return (box.x + box.w * anchor.rel_x, box.y + box.h * anchor.rel_y)


def stub_distance(anchor: Anchor) -> float:
    position = anchor.rel_y if anchor.side in ("left", "right") else anchor.rel_x
    try:
        index = ANCHOR_POSITIONS.index(position)
    except ValueError:
        index = 0
    return PORT_STUB * (index + 1)


def outside_port(point: tuple[float, float], anchor: Anchor) -> tuple[float, float]:
    x, y = point
    distance = stub_distance(anchor)
    if anchor.side == "left":
        return (x - distance, y)
    if anchor.side == "right":
        return (x + distance, y)
    if anchor.side == "top":
        return (x, y - distance)
    if anchor.side == "bottom":
        return (x, y + distance)
    return point


def points_aligned(a: tuple[float, float], b: tuple[float, float], eps: float = 0.001) -> bool:
    return abs(a[0] - b[0]) < eps or abs(a[1] - b[1]) < eps


def segment_hits_box(a: tuple[float, float], b: tuple[float, float], box: Box, eps: float = 0.001) -> bool:
    ax, ay = a
    bx, by = b
    if abs(ax - bx) < eps:
        x = ax
        y1, y2 = sorted((ay, by))
        return box.x + eps < x < box.x + box.w - eps and max(y1, box.y + eps) < min(y2, box.y + box.h - eps)
    if abs(ay - by) < eps:
        y = ay
        x1, x2 = sorted((ax, bx))
        return box.y + eps < y < box.y + box.h - eps and max(x1, box.x + eps) < min(x2, box.x + box.w - eps)
    raise ValueError(f"Non-orthogonal segment: {a} -> {b}")


def ranges_overlap(a: float, b: float, c: float, d: float, eps: float = 0.001) -> bool:
    lower = max(min(a, b), min(c, d))
    upper = min(max(a, b), max(c, d))
    return upper - lower > eps


def segments_overlap(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
    eps: float = 0.001,
) -> bool:
    if abs(a[0] - b[0]) < eps and abs(c[0] - d[0]) < eps and abs(a[0] - c[0]) < eps:
        return ranges_overlap(a[1], b[1], c[1], d[1], eps)
    if abs(a[1] - b[1]) < eps and abs(c[1] - d[1]) < eps and abs(a[1] - c[1]) < eps:
        return ranges_overlap(a[0], b[0], c[0], d[0], eps)
    return False


def segments_cross(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
    eps: float = 0.001,
) -> bool:
    if segments_overlap(a, b, c, d, eps):
        return False
    first_vertical = abs(a[0] - b[0]) < eps
    second_vertical = abs(c[0] - d[0]) < eps
    if first_vertical == second_vertical:
        return False

    vertical_start, vertical_end = (a, b) if first_vertical else (c, d)
    horizontal_start, horizontal_end = (c, d) if first_vertical else (a, b)
    cross_x = vertical_start[0]
    cross_y = horizontal_start[1]
    return (
        min(vertical_start[1], vertical_end[1]) + eps < cross_y < max(vertical_start[1], vertical_end[1]) - eps
        and min(horizontal_start[0], horizontal_end[0]) + eps < cross_x < max(horizontal_start[0], horizontal_end[0]) - eps
    )


def count_path_crossings_with_segments(
    path: list[tuple[float, float]],
    existing_segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> int:
    crossings = 0
    for start, end in zip(path, path[1:]):
        for existing_start, existing_end in existing_segments:
            if segments_cross(start, end, existing_start, existing_end):
                crossings += 1
    return crossings


def dedupe_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    deduped = []
    for point in points:
        if not deduped or abs(deduped[-1][0] - point[0]) > 0.001 or abs(deduped[-1][1] - point[1]) > 0.001:
            deduped.append(point)
    return deduped


def normalize_path(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    points = dedupe_points(points)
    changed = True
    while changed:
        changed = False
        normalized = []
        for point in points:
            normalized.append(point)
            while len(normalized) >= 3:
                a, b, c = normalized[-3:]
                if points_aligned(a, b) and points_aligned(b, c) and points_aligned(a, c):
                    normalized.pop(-2)
                    changed = True
                else:
                    break
        points = normalized
    return points


def path_length(points: list[tuple[float, float]]) -> float:
    return sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(points, points[1:]))


def build_lanes(boxes: dict[str, Box]) -> tuple[list[float], list[float]]:
    min_x = min(box.x for box in boxes.values())
    max_x = max(box.x + box.w for box in boxes.values())
    min_y = min(box.y for box in boxes.values())
    max_y = max(box.y + box.h for box in boxes.values())

    vertical = {min_x - BOX_MARGIN, min_x - BOX_MARGIN * 2, max_x + BOX_MARGIN, max_x + BOX_MARGIN * 2}
    horizontal = {min_y - BOX_MARGIN, min_y - BOX_MARGIN * 2, max_y + BOX_MARGIN, max_y + BOX_MARGIN * 2}

    x_intervals = sorted((box.x, box.x + box.w) for box in boxes.values())
    y_intervals = sorted((box.y, box.y + box.h) for box in boxes.values())

    for (_, left_end), (right_start, _) in zip(x_intervals, x_intervals[1:]):
        if right_start - left_end > BOX_MARGIN:
            vertical.add((left_end + right_start) / 2)
    for (_, top_end), (bottom_start, _) in zip(y_intervals, y_intervals[1:]):
        if bottom_start - top_end > BOX_MARGIN:
            horizontal.add((top_end + bottom_start) / 2)

    for box in boxes.values():
        vertical.add(box.x - BOX_MARGIN / 2)
        vertical.add(box.x + box.w + BOX_MARGIN / 2)
        horizontal.add(box.y - BOX_MARGIN / 2)
        horizontal.add(box.y + box.h + BOX_MARGIN / 2)

    return sorted(vertical), sorted(horizontal)


def nearest(values: list[float], target: float, limit: int = 24) -> list[float]:
    return sorted(values, key=lambda value: (abs(value - target), value))[:limit]


def candidate_paths(
    start: tuple[float, float],
    end: tuple[float, float],
    vertical_lanes: list[float],
    horizontal_lanes: list[float],
) -> list[list[tuple[float, float]]]:
    candidates = [
        [start, end],
        [start, (end[0], start[1]), end],
        [start, (start[0], end[1]), end],
    ]
    mid_x = (start[0] + end[0]) / 2
    mid_y = (start[1] + end[1]) / 2
    x_lanes = nearest(vertical_lanes, mid_x)
    y_lanes = nearest(horizontal_lanes, mid_y)
    for x in x_lanes:
        candidates.append([start, (x, start[1]), (x, end[1]), end])
    for y in y_lanes:
        candidates.append([start, (start[0], y), (end[0], y), end])
    for x in x_lanes[:8]:
        for y in y_lanes[:8]:
            candidates.append([start, (x, start[1]), (x, y), (end[0], y), end])
            candidates.append([start, (start[0], y), (x, y), (x, end[1]), end])
    normalized = []
    seen = set()
    for path in candidates:
        path = normalize_path(path)
        key = tuple((round(x, 4), round(y, 4)) for x, y in path)
        if key not in seen:
            seen.add(key)
            normalized.append(path)
    normalized.sort(key=lambda path: (len(path), path_length(path)))
    return normalized


def path_clear_of_boxes(
    path: list[tuple[float, float]],
    boxes: dict[str, Box],
    source_id: str,
    target_id: str,
) -> bool:
    for start, end in zip(path, path[1:]):
        if not points_aligned(start, end):
            return False
        for box_id, box in boxes.items():
            if box_id in (source_id, target_id):
                continue
            if segment_hits_box(start, end, box):
                return False
    return True


def path_overlaps_existing(
    path: list[tuple[float, float]],
    existing_segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> bool:
    for start, end in zip(path, path[1:]):
        for other_start, other_end in existing_segments:
            if segments_overlap(start, end, other_start, other_end):
                return True
    return False


def build_edge_path(
    edge: EdgeRef,
    boxes: dict[str, Box],
    anchors: dict[tuple[str, str], Anchor],
    vertical_lanes: list[float],
    horizontal_lanes: list[float],
    existing_segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[tuple[float, float]]:
    start_anchor = anchors[(edge.id, "source")]
    end_anchor = anchors[(edge.id, "target")]
    start = connection_point(boxes[edge.source], start_anchor)
    end = connection_point(boxes[edge.target], end_anchor)
    start_port = outside_port(start, start_anchor)
    end_port = outside_port(end, end_anchor)
    clear_box_candidates = []
    non_overlapping_candidates: list[tuple[int, list[tuple[float, float]]]] = []
    for middle_path in candidate_paths(start_port, end_port, vertical_lanes, horizontal_lanes):
        path = normalize_path([start, *middle_path, end])
        if not path_clear_of_boxes(path, boxes, edge.source, edge.target):
            continue
        if path_overlaps_existing(path, existing_segments):
            clear_box_candidates.append(path)
            continue
        crossing_count = count_path_crossings_with_segments(path, existing_segments)
        if crossing_count == 0:
            return path
        non_overlapping_candidates.append((crossing_count, path))
    if non_overlapping_candidates:
        return min(non_overlapping_candidates, key=lambda item: (item[0], len(item[1]), path_length(item[1])))[1]
    if clear_box_candidates:
        return min(clear_box_candidates, key=lambda path: (len(path), path_length(path)))
    raise ValueError(f"{edge.id}: could not route without crossing a non-terminal box")


def set_style(cell: ET.Element, source_anchor: Anchor, target_anchor: Anchor) -> None:
    style = parse_style(cell.get("style", ""))
    for key, value in ROUTING_STYLE_KEYS.items():
        style[key] = value
    style["exitX"] = trim_float(source_anchor.rel_x)
    style["exitY"] = trim_float(source_anchor.rel_y)
    style["entryX"] = trim_float(target_anchor.rel_x)
    style["entryY"] = trim_float(target_anchor.rel_y)
    cell.set("style", format_style(style))


def set_edge_points(cell: ET.Element, points: Iterable[tuple[float, float]]) -> None:
    geometry = get_geometry(cell)
    geometry.set("relative", "1")
    for child in list(geometry):
        if child.tag == "Array" and child.get("as") == "points":
            geometry.remove(child)
    points_array = ET.SubElement(geometry, "Array", {"as": "points"})
    for x, y in points:
        ET.SubElement(points_array, "mxPoint", {"x": trim_float(x), "y": trim_float(y)})


def anchor_key(cell_id: str, anchor: Anchor) -> tuple[str, str, float]:
    if anchor.side in ("left", "right"):
        return (cell_id, anchor.side, anchor.rel_y)
    return (cell_id, anchor.side, anchor.rel_x)


def validate_routes(
    edges: list[EdgeRef],
    boxes: dict[str, Box],
    anchors: dict[tuple[str, str], Anchor],
    paths: dict[str, list[tuple[float, float]]],
) -> list[str]:
    errors = []
    anchor_usage: dict[tuple[str, str, float], list[str]] = defaultdict(list)
    all_segments: list[tuple[str, tuple[float, float], tuple[float, float]]] = []

    for edge in edges:
        source_anchor = anchors[(edge.id, "source")]
        target_anchor = anchors[(edge.id, "target")]
        anchor_usage[anchor_key(edge.source, source_anchor)].append(edge.id)
        anchor_usage[anchor_key(edge.target, target_anchor)].append(edge.id)
        path = paths[edge.id]
        for start, end in zip(path, path[1:]):
            if not points_aligned(start, end):
                errors.append(f"{edge.id}: non-orthogonal segment {start}->{end}")
                continue
            for box_id, box in boxes.items():
                if box_id in (edge.source, edge.target):
                    continue
                if segment_hits_box(start, end, box):
                    errors.append(f"{edge.id}: segment {start}->{end} intersects {box_id}")
            all_segments.append((edge.id, start, end))

    for key, edge_ids in anchor_usage.items():
        if len(edge_ids) > 1:
            errors.append(f"{key[0]} {key[1]} {key[2]}: duplicate anchor used by {', '.join(edge_ids)}")

    for i, (first_edge_id, first_start, first_end) in enumerate(all_segments):
        for second_edge_id, second_start, second_end in all_segments[i + 1:]:
            if first_edge_id == second_edge_id:
                continue
            if segments_overlap(first_start, first_end, second_start, second_end):
                errors.append(
                    f"{first_edge_id} overlaps {second_edge_id}: "
                    f"{first_start}->{first_end} and {second_start}->{second_end}"
                )

    return errors


def route_edge_paths(
    boxes: dict[str, Box],
    edges: list[EdgeRef],
) -> tuple[dict[tuple[str, str], Anchor], dict[str, list[tuple[float, float]]]]:
    anchors = allocate_anchors(boxes, edges)
    vertical_lanes, horizontal_lanes = build_lanes(boxes)
    existing_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    paths: dict[str, list[tuple[float, float]]] = {}

    for edge in sorted(edges, key=lambda item: item.id):
        path = build_edge_path(edge, boxes, anchors, vertical_lanes, horizontal_lanes, existing_segments)
        paths[edge.id] = path
        existing_segments.extend(zip(path, path[1:]))

    return anchors, paths


def routed_segments(
    paths: dict[str, list[tuple[float, float]]],
) -> list[tuple[str, tuple[float, float], tuple[float, float]]]:
    segments = []
    for edge_id, path in paths.items():
        for start, end in zip(path, path[1:]):
            segments.append((edge_id, start, end))
    return segments


def count_duplicate_anchors(edges: list[EdgeRef], anchors: dict[tuple[str, str], Anchor]) -> int:
    anchor_usage: dict[tuple[str, str, float], int] = defaultdict(int)
    for edge in edges:
        anchor_usage[anchor_key(edge.source, anchors[(edge.id, "source")])] += 1
        anchor_usage[anchor_key(edge.target, anchors[(edge.id, "target")])] += 1
    return sum(count - 1 for count in anchor_usage.values() if count > 1)


def count_box_hits(
    edges: list[EdgeRef],
    boxes: dict[str, Box],
    paths: dict[str, list[tuple[float, float]]],
) -> int:
    hits = 0
    edge_by_id = {edge.id: edge for edge in edges}
    for edge_id, start, end in routed_segments(paths):
        edge = edge_by_id[edge_id]
        for box_id, box in boxes.items():
            if box_id in (edge.source, edge.target):
                continue
            if segment_hits_box(start, end, box):
                hits += 1
    return hits


def boxes_overlap(first: Box, second: Box, eps: float = 0.001) -> bool:
    return (
        max(first.x, second.x) + eps < min(first.x + first.w, second.x + second.w)
        and max(first.y, second.y) + eps < min(first.y + first.h, second.y + second.h)
    )


def count_box_overlaps(boxes: dict[str, Box]) -> int:
    overlap_count = 0
    box_items = list(boxes.items())
    for index, (_first_id, first_box) in enumerate(box_items):
        for _second_id, second_box in box_items[index + 1:]:
            if boxes_overlap(first_box, second_box):
                overlap_count += 1
    return overlap_count


def count_segment_overlaps(paths: dict[str, list[tuple[float, float]]]) -> int:
    overlaps = 0
    segments = routed_segments(paths)
    for i, (first_edge_id, first_start, first_end) in enumerate(segments):
        for second_edge_id, second_start, second_end in segments[i + 1:]:
            if first_edge_id == second_edge_id:
                continue
            if segments_overlap(first_start, first_end, second_start, second_end):
                overlaps += 1
    return overlaps


def strictly_between(value: float, a: float, b: float, eps: float = 0.001) -> bool:
    lower, upper = sorted((a, b))
    return lower + eps < value < upper - eps


def count_edge_crossings(paths: dict[str, list[tuple[float, float]]]) -> int:
    crossings = 0
    segments = routed_segments(paths)
    for i, (first_edge_id, first_start, first_end) in enumerate(segments):
        for second_edge_id, second_start, second_end in segments[i + 1:]:
            if first_edge_id == second_edge_id:
                continue
            if segments_overlap(first_start, first_end, second_start, second_end):
                continue

            first_vertical = abs(first_start[0] - first_end[0]) < 0.001
            second_vertical = abs(second_start[0] - second_end[0]) < 0.001
            if first_vertical == second_vertical:
                continue

            vertical_start, vertical_end = (first_start, first_end) if first_vertical else (second_start, second_end)
            horizontal_start, horizontal_end = (second_start, second_end) if first_vertical else (first_start, first_end)
            cross_x = vertical_start[0]
            cross_y = horizontal_start[1]
            if strictly_between(cross_y, vertical_start[1], vertical_end[1]) and strictly_between(
                cross_x, horizontal_start[0], horizontal_end[0]
            ):
                crossings += 1
    return crossings


def layout_bounds(boxes: dict[str, Box]) -> tuple[float, float, float]:
    min_x = min(box.x for box in boxes.values())
    max_x = max(box.x + box.w for box in boxes.values())
    min_y = min(box.y for box in boxes.values())
    max_y = max(box.y + box.h for box in boxes.values())
    width = max_x - min_x
    height = max_y - min_y
    return width, height, width * height


def score_routed_layout(
    edges: list[EdgeRef],
    boxes: dict[str, Box],
    anchors: dict[tuple[str, str], Anchor],
    paths: dict[str, list[tuple[float, float]]],
) -> LayoutScore:
    edge_crossings = count_edge_crossings(paths)
    edge_bends = sum(max(0, len(path) - 2) for path in paths.values())
    duplicate_anchors = count_duplicate_anchors(edges, anchors)
    segment_overlaps = count_segment_overlaps(paths)
    box_hits = count_box_hits(edges, boxes, paths)
    box_overlaps = count_box_overlaps(boxes)
    total_edge_length = sum(path_length(path) for path in paths.values())
    layout_width, layout_height, layout_area = layout_bounds(boxes)
    compactness = layout_width * 250 + layout_height * 25 + layout_area / 10000
    value = (
        box_hits * 1000000000
        + box_overlaps * 500000000
        + segment_overlaps * 100000000
        + duplicate_anchors * 10000000
        + edge_crossings * 1000000
        + edge_bends * 10000
        + total_edge_length
        + compactness
    )
    return LayoutScore(
        value=value,
        edge_crossings=edge_crossings,
        edge_bends=edge_bends,
        duplicate_anchors=duplicate_anchors,
        segment_overlaps=segment_overlaps,
        box_hits=box_hits,
        box_overlaps=box_overlaps,
        total_edge_length=total_edge_length,
        layout_width=layout_width,
        layout_height=layout_height,
        layout_area=layout_area,
    )


def clone_boxes_with_positions(boxes: dict[str, Box], positions: dict[str, tuple[float, float]]) -> dict[str, Box]:
    updated = {}
    for cell_id, box in boxes.items():
        x, y = positions.get(cell_id, (box.x, box.y))
        updated[cell_id] = Box(x, y, box.w, box.h)
    return updated


def generate_diagonal_flip_candidates(
    candidates: list[LayoutCandidate],
    boxes: dict[str, Box],
    edges: list[EdgeRef],
) -> list[LayoutCandidate]:
    variants: list[LayoutCandidate] = []
    horizontal_gap = max(COL_GAP, BOX_MARGIN * 2)
    vertical_gap = max(ROW_GAP, BOX_MARGIN)
    for candidate in candidates:
        candidate_boxes = clone_boxes_with_positions(boxes, candidate.positions)
        for edge in edges:
            source_box = candidate_boxes[edge.source]
            target_box = candidate_boxes[edge.target]
            dx = target_box.cx - source_box.cx
            dy = target_box.cy - source_box.cy
            if abs(dx) < max(40.0, source_box.w * 0.15) or abs(dy) < max(40.0, source_box.h * 0.1):
                continue

            positions = dict(candidate.positions)
            if dy > 0:
                y = max(target_box.y, source_box.y + source_box.h + vertical_gap)
            else:
                y = min(target_box.y, source_box.y - target_box.h - vertical_gap)

            if dx > 0:
                x = source_box.x - target_box.w - horizontal_gap
                side_name = "left"
            else:
                x = source_box.x + source_box.w + horizontal_gap
                side_name = "right"

            positions[edge.target] = (x, y)
            variants.append(LayoutCandidate(f"{candidate.name}-flip-{edge.id}-{side_name}", positions))
    return variants


def collect_box_texts(root: ET.Element, boxes: dict[str, Box]) -> dict[str, str]:
    texts = {}
    for cell in root.findall(".//mxCell"):
        cell_id = cell.get("id")
        if cell_id not in boxes:
            continue
        raw = html.unescape(cell.get("value", ""))
        texts[cell_id] = f"{raw}\n{clean_label_text(raw)}"
    return texts


def classify_box(text: str) -> str:
    lower = text.lower()
    compact = re.sub(r"\s+", "", lower)
    if "enumeration" in lower or "<<enum" in lower or "enum" in lower:
        return "enum"
    if "search" in lower or "filter" in lower or "query" in lower:
        return "search"
    if "lichs" in compact or "history" in lower or "audit" in lower:
        return "audit"
    if any(token in compact for token in ("duyet", "dexuat", "request", "response", "dto", "workflow", "action")):
        return "workflow"
    if "ref" in lower or "lookup" in lower or "dm" in compact:
        return "reference"
    return "entity"


def layout_component_grouped(
    component: list[str],
    boxes: dict[str, Box],
    adjacency: dict[str, set[str]],
    origin_x: float,
    origin_y: float,
    category_by_id: dict[str, str],
) -> tuple[dict[str, tuple[float, float]], float, float]:
    groups: dict[str, list[str]] = defaultdict(list)
    for node in component:
        groups[category_by_id.get(node, "entity")].append(node)

    category_order = ["entity", "workflow", "search", "audit", "reference", "enum"]
    ordered_categories = [category for category in category_order if groups.get(category)]
    ordered_categories.extend(sorted(category for category in groups if category not in category_order))

    column_widths = {category: max(boxes[node].w for node in groups[category]) for category in ordered_categories}
    column_heights = {
        category: sum(boxes[node].h for node in groups[category]) + ROW_GAP * max(0, len(groups[category]) - 1)
        for category in ordered_categories
    }
    center_y = origin_y + max(column_heights.values()) / 2

    positions: dict[str, tuple[float, float]] = {}
    cursor_x = origin_x
    min_y = float("inf")
    max_y = float("-inf")
    for category in ordered_categories:
        nodes = sorted(groups[category], key=lambda node: (-len(adjacency[node]), boxes[node].y, boxes[node].x, node))
        total_height = column_heights[category]
        y = center_y - total_height / 2
        for node in nodes:
            x = cursor_x + (column_widths[category] - boxes[node].w) / 2
            positions[node] = (x, y)
            min_y = min(min_y, y)
            max_y = max(max_y, y + boxes[node].h)
            y += boxes[node].h + ROW_GAP
        cursor_x += column_widths[category] + COL_GAP

    if min_y < origin_y:
        shift_y = origin_y - min_y
        positions = {node: (x, y + shift_y) for node, (x, y) in positions.items()}
        max_y += shift_y

    width = cursor_x - origin_x - COL_GAP
    height = max_y - origin_y
    return positions, width, height


def high_degree_roots(boxes: dict[str, Box], edges: list[EdgeRef]) -> list[str]:
    adjacency = graph_adjacency(boxes, edges)
    return sorted(boxes, key=lambda node: (-len(adjacency[node]), boxes[node].h, boxes[node].y, boxes[node].x, node))


def preset_root_ids(root: ET.Element, boxes: dict[str, Box], edges: list[EdgeRef], preset: str) -> list[str]:
    by_name = collect_box_names(root, boxes)
    roots = []
    if preset in {"danh-gia-su-kien", "event-monitoring", "event-assessment-closure", "ql-su-kien"}:
        for name in ("DanhGiaSuKienModel", "QLSuKien", "DMLucLuong", "SuKienModel", "SysqlskSuKienEntity", "KeHoachSuKienModel"):
            if name in by_name:
                roots.append(by_name[name])
    roots.extend(high_degree_roots(boxes, edges)[:3])

    unique_roots = []
    seen = set()
    for root_id in roots:
        if root_id not in boxes or root_id in seen:
            continue
        seen.add(root_id)
        unique_roots.append(root_id)
    return unique_roots


def generate_layout_candidates(
    root: ET.Element,
    boxes: dict[str, Box],
    edges: list[EdgeRef],
    preset: str,
) -> list[LayoutCandidate]:
    texts = collect_box_texts(root, boxes)
    category_by_id = {cell_id: classify_box(text) for cell_id, text in texts.items()}

    def grouped_layout(component, component_boxes, adjacency, origin_x, origin_y, root_id=None):
        return layout_component_grouped(component, component_boxes, adjacency, origin_x, origin_y, category_by_id)

    candidates = []
    if preset in {"auto", "ql-su-kien"}:
        candidates.extend(generate_ql_su_kien_candidates(boxes, collect_box_names(root, boxes)))

    candidates.extend([
        LayoutCandidate("layered-left-to-right", arrange_components(boxes, edges, layout_component)),
        LayoutCandidate("layered-top-to-bottom", arrange_components(boxes, edges, layout_component_top_to_bottom)),
        LayoutCandidate("hub-and-spoke", arrange_components(boxes, edges, layout_component_hub_spoke)),
        LayoutCandidate("grouped-by-stereotype", arrange_components(boxes, edges, grouped_layout)),
        LayoutCandidate("grouped-by-relationship", arrange_components(boxes, edges, layout_component_cluster_grid)),
        LayoutCandidate("layered-left-to-right-stacked-components", arrange_components_vertical(boxes, edges, layout_component)),
        LayoutCandidate("layered-top-to-bottom-stacked-components", arrange_components_vertical(boxes, edges, layout_component_top_to_bottom)),
        LayoutCandidate("hub-and-spoke-stacked-components", arrange_components_vertical(boxes, edges, layout_component_hub_spoke)),
        LayoutCandidate("grouped-by-relationship-stacked-components", arrange_components_vertical(boxes, edges, layout_component_cluster_grid)),
    ])

    roots = preset_root_ids(root, boxes, edges, preset)
    for root_id in roots:
        root_preferences = {root_id: root_id}
        candidates.append(
            LayoutCandidate(
                f"hub-and-spoke-root-{root_id}",
                arrange_components(boxes, edges, layout_component_hub_spoke, root_preferences),
            )
        )
        candidates.append(
            LayoutCandidate(
                f"layered-left-to-right-root-{root_id}",
                arrange_components(boxes, edges, layout_component, root_preferences),
            )
        )
        candidates.append(
            LayoutCandidate(
                f"layered-top-to-bottom-root-{root_id}",
                arrange_components(boxes, edges, layout_component_top_to_bottom, root_preferences),
            )
        )

    if len(roots) > 1:
        split_root = roots[1]
        candidates.append(
            LayoutCandidate(
                f"split-hub-root-{split_root}",
                arrange_components(boxes, edges, layout_component_hub_spoke, {split_root: split_root}),
            )
        )

    candidates.extend(generate_diagonal_flip_candidates(candidates, boxes, edges))

    unique_candidates = []
    seen_signatures = set()
    for candidate in candidates:
        signature = tuple(sorted((cell_id, round(x, 3), round(y, 3)) for cell_id, (x, y) in candidate.positions.items()))
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        unique_candidates.append(candidate)
    return unique_candidates


def evaluate_layout_candidate(
    candidate: LayoutCandidate,
    boxes: dict[str, Box],
    edges: list[EdgeRef],
) -> RouteAttempt | None:
    candidate_boxes = clone_boxes_with_positions(boxes, candidate.positions)
    try:
        anchors, paths = route_edge_paths(candidate_boxes, edges)
        score = score_routed_layout(edges, candidate_boxes, anchors, paths)
    except ValueError:
        return None
    return RouteAttempt(candidate=candidate, score=score, anchors=anchors, paths=paths)


def apply_scored_layout(root: ET.Element, boxes: dict[str, Box], edges: list[EdgeRef], preset: str) -> dict[str, Box]:
    attempts = []
    for candidate in generate_layout_candidates(root, boxes, edges, preset):
        attempt = evaluate_layout_candidate(candidate, boxes, edges)
        if attempt is not None:
            attempts.append(attempt)

    if not attempts:
        return apply_generic_layout(root, boxes, edges)

    best = min(
        attempts,
        key=lambda attempt: (
            attempt.score.value,
            attempt.score.box_hits,
            attempt.score.duplicate_anchors,
            attempt.score.segment_overlaps,
            attempt.score.edge_crossings,
            attempt.score.edge_bends,
            attempt.score.total_edge_length,
            attempt.candidate.name,
        ),
    )
    return set_box_positions(root, best.candidate.positions)


def route_edges(root: ET.Element, boxes: dict[str, Box], edges: list[EdgeRef], validate: bool) -> None:
    anchors, paths = route_edge_paths(boxes, edges)
    for edge in sorted(edges, key=lambda item: item.id):
        cell = root.find(f".//mxCell[@id='{edge.id}']")
        if cell is None:
            continue
        set_style(cell, anchors[(edge.id, "source")], anchors[(edge.id, "target")])
        set_edge_points(cell, paths[edge.id][1:-1])

    if validate:
        errors = validate_routes(edges, boxes, anchors, paths)
        if errors:
            raise ValueError("Route validation failed:\n" + "\n".join(errors))


def relayout(input_path: Path, output_path: Path, validate: bool, keep_vertices: bool, preset: str) -> None:
    tree = ET.parse(input_path)
    model = find_model(tree)
    root = model.find("root")
    if root is None:
        raise ValueError("Missing <root> in mxGraphModel.")

    boxes = collect_boxes(root)
    if not boxes:
        raise ValueError("No top-level draw.io class boxes were detected.")
    edges = collect_edges(root, boxes)
    if not keep_vertices:
        boxes = apply_scored_layout(root, boxes, edges, preset)
    route_edges(root, boxes, edges, validate=validate)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_path, encoding="utf-8", xml_declaration=False)


def default_diagram_root() -> Path:
    return Path.cwd().resolve().parent / "diagram"


def resolve_default_paths(input_path: Path, diagram_root: Path | None) -> tuple[Path, Path]:
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    if diagram_root is None:
        diagram_root = default_diagram_root()

    original_dir = diagram_root / "ori"
    relayout_dir = diagram_root / "relayout"
    original_dir.mkdir(parents=True, exist_ok=True)
    relayout_dir.mkdir(parents=True, exist_ok=True)

    original_path = original_dir / input_path.name
    output_name = f"{input_path.stem}_relayout{input_path.suffix or '.drawio'}"
    output_path = relayout_dir / output_name

    source = input_path.resolve()
    target = original_path.resolve()
    if source != target:
        shutil.copy2(source, target)

    return original_path, output_path


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument(
        "--preset",
        default="auto",
        choices=["auto", "danh-gia-su-kien", "event-monitoring", "event-assessment-closure", "ql-su-kien"],
        help="Use auto for generic relayout, or a domain preset such as danh-gia-su-kien.",
    )
    parser.add_argument(
        "--diagram-root",
        type=Path,
        default=None,
        help=(
            "Root folder for default artifacts. Defaults to a diagram folder next to the current project root "
            "(for example father/root and father/diagram)."
        ),
    )
    parser.add_argument("--keep-vertices", action="store_true", help="Only reroute edges; do not move class boxes.")
    parser.add_argument("--skip-validation", action="store_true")
    args = parser.parse_args(argv)
    try:
        input_path = args.input
        output_path = args.output
        if output_path is None:
            input_path, output_path = resolve_default_paths(input_path, args.diagram_root)
            print(f"Original: {input_path}")
            print(f"Relayout: {output_path}")
        relayout(
            input_path,
            output_path,
            validate=not args.skip_validation,
            keep_vertices=args.keep_vertices,
            preset=args.preset,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))














