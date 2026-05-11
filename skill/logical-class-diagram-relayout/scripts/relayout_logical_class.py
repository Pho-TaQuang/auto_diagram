#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import importlib.util
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ORIGIN_X = 100.0
ORIGIN_Y = 100.0
H_GAP = 220.0
V_GAP = 110.0
BAND_GAP = 170.0
MODEL_GAP = 180.0
ENTITY_GAP = 110.0
SUPPORT_GAP = 110.0
BASE_MODEL_GAP = 190.0
ADAPTER_ROW_DROP = 300.0


BR_RE = re.compile(r"(?i)<br\s*/?>")
HTML_TAG_RE = re.compile(r"(?<!<)</?[A-Za-z][^>]*>")
STEREOTYPE_RE = re.compile(r"<<\s*([^<>]+?)\s*>>")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class ClassInfo:
    id: str
    name: str
    stereotypes: tuple[str, ...]
    text: str
    role: str
    degree: int


def load_base_module():
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "drawio-diagram-relayout" / "scripts" / "relayout_mxgraph.py",
        Path.home() / ".codex" / "skills" / "drawio-diagram-relayout" / "scripts" / "relayout_mxgraph.py",
    ]
    for path in candidates:
        if not path.exists():
            continue
        spec = importlib.util.spec_from_file_location("drawio_relayout_base", path)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    searched = "\n".join(str(path) for path in candidates)
    raise FileNotFoundError("Could not find drawio-diagram-relayout base script. Searched:\n" + searched)


BASE = load_base_module()


def clean_text(value: str) -> str:
    text = html.unescape(value or "")
    text = BR_RE.sub("\n", text)
    text = HTML_TAG_RE.sub("", text)
    return text.replace("\r", "\n")


def text_lines(value: str) -> list[str]:
    return [line.strip() for line in clean_text(value).splitlines() if line.strip()]


def parse_stereotypes(lines: Iterable[str]) -> tuple[str, ...]:
    stereotypes: list[str] = []
    for line in lines:
        stereotypes.extend(match.group(1).strip() for match in STEREOTYPE_RE.finditer(line))
    return tuple(stereotypes)


def class_name_from_lines(lines: Iterable[str]) -> str:
    for line in lines:
        without_stereo = STEREOTYPE_RE.sub("", line).strip()
        if without_stereo:
            return without_stereo
    return ""


def classify(name: str, stereotypes: tuple[str, ...], text: str) -> str:
    combined = " ".join([name, text, *stereotypes]).lower()
    compact = NON_ALNUM_RE.sub("", combined)
    name_lower = name.lower()

    if "controller" in compact or name_lower.endswith("controller"):
        return "controller"
    if "managerinterface" in compact or (name.startswith("I") and name_lower.endswith("manager")):
        return "interface"
    if "adapterfactory" in compact or "dataaccessadapter" in compact or "adapter" in compact:
        return "adapter"
    if "manager" in compact or name_lower.endswith("manager"):
        return "manager"
    if "llblgenentity" in compact or "entity" in compact or name_lower.endswith("entity"):
        return "entity"
    if (
        "dtobase" in compact
        or "dto" in compact
        or "pagemodel" in compact
        or "searchmodel" in compact
        or "optionmodel" in compact
        or "model" in compact
        or name_lower.endswith("model")
    ):
        return "model"
    return "support"


def collect_infos(root: ET.Element, boxes: dict[str, object], edges: list[object]) -> dict[str, ClassInfo]:
    cells_by_id = {cell.get("id"): cell for cell in root.findall(".//mxCell") if cell.get("id")}
    degree = Counter()
    for edge in edges:
        degree[edge.source] += 1
        degree[edge.target] += 1

    infos: dict[str, ClassInfo] = {}
    for cell_id in boxes:
        cell = cells_by_id.get(cell_id)
        value = cell.get("value", "") if cell is not None else ""
        lines = text_lines(value)
        stereotypes = parse_stereotypes(lines)
        name = class_name_from_lines(lines) or cell_id
        text = clean_text(value)
        role = classify(name, stereotypes, text)
        infos[cell_id] = ClassInfo(
            id=cell_id,
            name=name,
            stereotypes=stereotypes,
            text=text,
            role=role,
            degree=degree[cell_id],
        )
    return infos


def normalized_domain_name(name: str) -> str:
    short_name = name.split(".")[-1]
    value = NON_ALNUM_RE.sub("", short_name.lower())
    for prefix in ("sysqlsk", "sysdm", "sys", "dm", "ql", "i"):
        if value.startswith(prefix) and len(value) > len(prefix) + 2:
            value = value[len(prefix) :]
            break
    changed = True
    suffixes = (
        "controller",
        "managerinterface",
        "manager",
        "entity",
        "pagemodel",
        "searchmodel",
        "optionmodel",
        "requestmodel",
        "responsemodel",
        "model",
        "dto",
        "base",
    )
    while changed:
        changed = False
        for suffix in suffixes:
            if value.endswith(suffix) and len(value) > len(suffix) + 2:
                value = value[: -len(suffix)]
                changed = True
                break
    return value


def by_role(infos: dict[str, ClassInfo], role: str) -> list[str]:
    return [cell_id for cell_id, info in infos.items() if info.role == role]


def sorted_by_original(ids: Iterable[str], boxes: dict[str, object]) -> list[str]:
    return sorted(ids, key=lambda cell_id: (boxes[cell_id].y, boxes[cell_id].x, cell_id))


def max_width(ids: Iterable[str], boxes: dict[str, object], minimum: float = 0.0) -> float:
    return max([boxes[cell_id].w for cell_id in ids] + [minimum])


def stack_height(ids: Iterable[str], boxes: dict[str, object], gap: float) -> float:
    id_list = list(ids)
    if not id_list:
        return 0.0
    return sum(boxes[cell_id].h for cell_id in id_list) + gap * (len(id_list) - 1)


def center_x(cell_id: str, boxes: dict[str, object], positions: dict[str, tuple[float, float]]) -> float:
    x, _y = positions[cell_id]
    return x + boxes[cell_id].w / 2.0


def center_y(cell_id: str, boxes: dict[str, object], positions: dict[str, tuple[float, float]]) -> float:
    _x, y = positions[cell_id]
    return y + boxes[cell_id].h / 2.0


def role_compact(info: ClassInfo) -> str:
    return NON_ALNUM_RE.sub("", info.name.lower() + info.text.lower() + " ".join(info.stereotypes).lower())


def is_base_model(info: ClassInfo) -> bool:
    compact = role_compact(info)
    return "dtobase" in compact or info.name.lower() == "pagemodel" or info.name.lower().endswith("basemodel")


def is_factory_adapter(info: ClassInfo) -> bool:
    return "factory" in role_compact(info)


def collect_edge_labels(root: ET.Element) -> dict[str, str]:
    labels = {}
    for cell in root.findall(".//mxCell[@edge='1']"):
        edge_id = cell.get("id")
        if edge_id:
            labels[edge_id] = clean_text(cell.get("value", "")).strip().lower()
    return labels


def base_model_targets(
    model_ids: list[str],
    infos: dict[str, ClassInfo],
    edges: list[object],
    edge_labels: dict[str, str],
) -> dict[str, str]:
    model_set = set(model_ids)
    base_ids = {cell_id for cell_id in model_ids if is_base_model(infos[cell_id])}
    targets = {}
    for edge in edges:
        if edge.source not in base_ids or edge.target not in model_set:
            continue
        label = edge_labels.get(edge.id, "")
        if label == "extends" or "extend" in label:
            targets[edge.source] = edge.target
    return targets


def choose_primary_entity(entity_ids: list[str], infos: dict[str, ClassInfo], boxes: dict[str, object]) -> str | None:
    if not entity_ids:
        return None

    core_names = {
        normalized_domain_name(info.name)
        for info in infos.values()
        if info.role in {"controller", "interface", "manager"} and normalized_domain_name(info.name)
    }

    def score(cell_id: str) -> tuple[float, str]:
        info = infos[cell_id]
        normalized = normalized_domain_name(info.name)
        match_score = 0.0
        for core in core_names:
            if core and (core == normalized or core in normalized or normalized in core):
                match_score = max(match_score, 100000.0 - abs(len(core) - len(normalized)))
        size_score = boxes[cell_id].h + boxes[cell_id].w * 0.1
        graph_score = info.degree * 100.0
        return (match_score + graph_score + size_score, info.name)

    return max(entity_ids, key=score)


def sort_entities(entity_ids: list[str], primary: str | None, infos: dict[str, ClassInfo], boxes: dict[str, object]) -> list[str]:
    if not primary:
        return sorted_by_original(entity_ids, boxes)
    remaining = [cell_id for cell_id in entity_ids if cell_id != primary]
    remaining.sort(key=lambda cell_id: (-infos[cell_id].degree, boxes[cell_id].y, infos[cell_id].name, cell_id))
    return [primary, *remaining]


def sort_adapters(adapter_ids: list[str], infos: dict[str, ClassInfo], boxes: dict[str, object]) -> list[str]:
    def rank(cell_id: str) -> tuple[int, float, str]:
        compact = NON_ALNUM_RE.sub("", infos[cell_id].name.lower() + infos[cell_id].text.lower())
        if "factory" in compact:
            return (0, boxes[cell_id].y, infos[cell_id].name)
        if "dataaccessadapter" in compact:
            return (1, boxes[cell_id].y, infos[cell_id].name)
        return (2, boxes[cell_id].y, infos[cell_id].name)

    return sorted(adapter_ids, key=rank)


def sort_models(model_ids: list[str], infos: dict[str, ClassInfo], boxes: dict[str, object]) -> list[str]:
    core_names = {
        normalized_domain_name(info.name)
        for info in infos.values()
        if info.role in {"controller", "interface", "manager"} and normalized_domain_name(info.name)
    }

    def rank(cell_id: str) -> tuple[int, float, str]:
        info = infos[cell_id]
        compact = role_compact(info)
        normalized = normalized_domain_name(info.name)
        if is_base_model(info):
            bucket = 9
        elif "page" in compact or "search" in compact or "filter" in compact:
            bucket = 1
        elif any(core and core == normalized for core in core_names):
            bucket = 0
        elif "option" in compact or "lookup" in compact or "ref" in compact:
            bucket = 2
        else:
            bucket = 3
        return (bucket, boxes[cell_id].x, info.name)

    return sorted(model_ids, key=rank)


def stack_vertical(
    ids: list[str],
    boxes: dict[str, object],
    x: float,
    y: float,
    gap: float,
    column_width: float | None = None,
) -> dict[str, tuple[float, float]]:
    if not ids:
        return {}
    width = column_width if column_width is not None else max_width(ids, boxes)
    positions: dict[str, tuple[float, float]] = {}
    cursor_y = y
    for cell_id in ids:
        box = boxes[cell_id]
        positions[cell_id] = (x + (width - box.w) / 2.0, cursor_y)
        cursor_y += box.h + gap
    return positions


def row_horizontal(
    ids: list[str],
    boxes: dict[str, object],
    x: float,
    y: float,
    gap: float,
) -> dict[str, tuple[float, float]]:
    if not ids:
        return {}
    positions: dict[str, tuple[float, float]] = {}
    cursor_x = x
    for cell_id in ids:
        box = boxes[cell_id]
        positions[cell_id] = (cursor_x, y)
        cursor_x += box.w + gap
    return positions


def total_row_width(ids: list[str], boxes: dict[str, object], gap: float) -> float:
    if not ids:
        return 0.0
    return sum(boxes[cell_id].w for cell_id in ids) + gap * (len(ids) - 1)


def place_adapters(
    adapters: list[str],
    infos: dict[str, ClassInfo],
    boxes: dict[str, object],
    positions: dict[str, tuple[float, float]],
    chain_y: float,
    managers: list[str],
    entities: list[str],
    entity_column_x: float,
    entity_column_width: float,
) -> None:
    if not adapters:
        return

    row_height = max(boxes[cell_id].h for cell_id in adapters)
    adapter_y = max(ORIGIN_Y, chain_y - row_height - ADAPTER_ROW_DROP)
    factory_adapters = [cell_id for cell_id in adapters if is_factory_adapter(infos[cell_id])]
    other_adapters = [cell_id for cell_id in adapters if cell_id not in factory_adapters]

    manager_anchor = managers[0] if managers else None
    entity_anchor = entities[0] if entities else None

    if factory_adapters and manager_anchor in positions:
        manager_center = center_x(manager_anchor, boxes, positions)
        cursor_x = manager_center - total_row_width(factory_adapters, boxes, MODEL_GAP) / 2.0
        positions.update(row_horizontal(factory_adapters, boxes, cursor_x, adapter_y, MODEL_GAP))

    if other_adapters:
        if entity_anchor in positions:
            adapter_center = center_x(entity_anchor, boxes, positions)
        else:
            adapter_center = entity_column_x + entity_column_width / 2.0
        cursor_x = adapter_center - total_row_width(other_adapters, boxes, MODEL_GAP) / 2.0
        positions.update(row_horizontal(other_adapters, boxes, cursor_x, adapter_y, MODEL_GAP))

    remaining = [cell_id for cell_id in adapters if cell_id not in positions]
    if remaining:
        positions.update(row_horizontal(remaining, boxes, entity_column_x, adapter_y, MODEL_GAP))


def build_logical_layout(root: ET.Element, boxes: dict[str, object], edges: list[object]) -> dict[str, tuple[float, float]]:
    infos = collect_infos(root, boxes, edges)
    edge_labels = collect_edge_labels(root)
    controllers = sorted_by_original(by_role(infos, "controller"), boxes)
    interfaces = sorted_by_original(by_role(infos, "interface"), boxes)
    managers = sorted_by_original(by_role(infos, "manager"), boxes)
    adapters = sort_adapters(by_role(infos, "adapter"), infos, boxes)
    entity_ids = by_role(infos, "entity")
    primary_entity = choose_primary_entity(entity_ids, infos, boxes)
    entities = sort_entities(entity_ids, primary_entity, infos, boxes)
    model_ids = sort_models(by_role(infos, "model"), infos, boxes)
    base_targets = base_model_targets(model_ids, infos, edges, edge_labels)
    base_models = [cell_id for cell_id in model_ids if cell_id in base_targets]
    models = [cell_id for cell_id in model_ids if cell_id not in base_models]
    supports = sorted_by_original(by_role(infos, "support"), boxes)

    positions: dict[str, tuple[float, float]] = {}

    main_groups = [
        ("controller", controllers),
        ("interface", interfaces),
        ("manager", managers),
    ]
    main_groups = [(name, ids) for name, ids in main_groups if ids]

    group_x: dict[str, float] = {}
    group_width: dict[str, float] = {}
    cursor_x = ORIGIN_X
    for name, ids in main_groups:
        width = max_width(ids, boxes, minimum=260.0)
        group_x[name] = cursor_x
        group_width[name] = width
        cursor_x += width + H_GAP

    if not main_groups:
        cursor_x = ORIGIN_X

    entity_column_width = max(max_width(entities, boxes, minimum=300.0), max_width(adapters, boxes, minimum=0.0))
    entity_column_x = cursor_x
    support_column_x = entity_column_x + entity_column_width + H_GAP

    adapter_block_height = stack_height(adapters, boxes, V_GAP)
    chain_y = ORIGIN_Y + adapter_block_height + V_GAP if adapters else ORIGIN_Y

    for name, ids in main_groups:
        positions.update(stack_vertical(ids, boxes, group_x[name], chain_y, V_GAP, group_width[name]))

    if controllers and interfaces:
        interface_anchor = interfaces[0]
        interface_center_y = center_y(interface_anchor, boxes, positions)
        for controller_id in controllers:
            x, _y = positions[controller_id]
            positions[controller_id] = (x - 20.0, interface_center_y - boxes[controller_id].h / 2.0)

    if entities:
        primary = entities[0]
        positions.update(stack_vertical([primary], boxes, entity_column_x, chain_y, ENTITY_GAP, entity_column_width))
        if managers:
            manager_anchor = managers[0]
            manager_y = positions[manager_anchor][1]
            primary_y = manager_y + boxes[manager_anchor].h * 0.75 - boxes[primary].h * 0.25
            positions[primary] = (positions[primary][0], primary_y)
        if len(entities) > 1:
            related_start_y = chain_y + boxes[primary].h + ENTITY_GAP
            positions.update(stack_vertical(entities[1:], boxes, entity_column_x, related_start_y, ENTITY_GAP, entity_column_width))

    place_adapters(
        adapters=adapters,
        infos=infos,
        boxes=boxes,
        positions=positions,
        chain_y=chain_y,
        managers=managers,
        entities=entities,
        entity_column_x=entity_column_x,
        entity_column_width=entity_column_width,
    )

    if supports:
        support_width = max_width(supports, boxes, minimum=240.0)
        positions.update(stack_vertical(supports, boxes, support_column_x, chain_y, SUPPORT_GAP, support_width))

    main_band_height = max([stack_height(ids, boxes, V_GAP) for _name, ids in main_groups] + [0.0])
    entity_band_height = stack_height(entities, boxes, ENTITY_GAP)
    support_band_height = stack_height(supports, boxes, SUPPORT_GAP)
    model_width = total_row_width(models, boxes, MODEL_GAP)

    if models:
        model_y = chain_y + main_band_height + BAND_GAP
        row_right = ORIGIN_X + model_width
        overlaps_entity_column = row_right > entity_column_x - H_GAP * 0.5
        overlaps_support_column = supports and row_right > support_column_x - H_GAP * 0.5
        if overlaps_entity_column or overlaps_support_column:
            model_y = max(model_y, chain_y + max(entity_band_height, support_band_height) + BAND_GAP)
        model_x = ORIGIN_X
        if controllers:
            model_x = positions[controllers[0]][0] + boxes[controllers[0]].w * 0.1
        positions.update(row_horizontal(models, boxes, model_x, model_y, MODEL_GAP))

    for base_id in base_models:
        target_id = base_targets.get(base_id)
        if target_id not in positions:
            continue
        target_x, target_y = positions[target_id]
        base_x = target_x + (boxes[target_id].w - boxes[base_id].w) / 2.0
        base_y = target_y + boxes[target_id].h + BASE_MODEL_GAP
        positions[base_id] = (base_x, base_y)

    missing = set(boxes) - set(positions)
    if missing:
        fallback_y = chain_y + max(main_band_height, entity_band_height, support_band_height) + BAND_GAP
        positions.update(stack_vertical(sorted_by_original(missing, boxes), boxes, support_column_x, fallback_y, SUPPORT_GAP))

    return positions


def edge_endpoint_snapshot(root: ET.Element) -> dict[str, tuple[str | None, str | None]]:
    snapshot = {}
    for cell in root.findall(".//mxCell[@edge='1']"):
        edge_id = cell.get("id")
        if edge_id:
            snapshot[edge_id] = (cell.get("source"), cell.get("target"))
    return snapshot


def assert_edge_endpoints_unchanged(
    before: dict[str, tuple[str | None, str | None]],
    root: ET.Element,
) -> None:
    after = edge_endpoint_snapshot(root)
    changed = []
    for edge_id, endpoints in before.items():
        if after.get(edge_id) != endpoints:
            changed.append(f"{edge_id}: {endpoints} -> {after.get(edge_id)}")
    if changed:
        raise ValueError("Edge source/target changed unexpectedly:\n" + "\n".join(changed))


def anchor_for_delta(source_box, target_box):
    dx = target_box.cx - source_box.cx
    dy = target_box.cy - source_box.cy
    if abs(dx) >= abs(dy):
        if dx >= 0:
            return BASE.Anchor(1.0, 0.5, "right"), BASE.Anchor(0.0, 0.5, "left")
        return BASE.Anchor(0.0, 0.5, "left"), BASE.Anchor(1.0, 0.5, "right")
    if dy >= 0:
        return BASE.Anchor(0.5, 1.0, "bottom"), BASE.Anchor(0.5, 0.0, "top")
    return BASE.Anchor(0.5, 0.0, "top"), BASE.Anchor(0.5, 1.0, "bottom")


def point_for_anchor(box, anchor) -> tuple[float, float]:
    return (box.x + box.w * anchor.rel_x, box.y + box.h * anchor.rel_y)


def simple_path(start: tuple[float, float], end: tuple[float, float]) -> list[tuple[float, float]]:
    if abs(start[0] - end[0]) >= abs(start[1] - end[1]):
        mid_x = (start[0] + end[0]) / 2.0
        return [start, (mid_x, start[1]), (mid_x, end[1]), end]
    mid_y = (start[1] + end[1]) / 2.0
    return [start, (start[0], mid_y), (end[0], mid_y), end]


def simple_route_edges(root: ET.Element, boxes: dict[str, object], edges: list[object]) -> None:
    cells_by_id = {cell.get("id"): cell for cell in root.findall(".//mxCell[@edge='1']") if cell.get("id")}
    for edge in edges:
        cell = cells_by_id.get(edge.id)
        if cell is None:
            continue
        source_anchor, target_anchor = anchor_for_delta(boxes[edge.source], boxes[edge.target])
        start = point_for_anchor(boxes[edge.source], source_anchor)
        end = point_for_anchor(boxes[edge.target], target_anchor)
        path = simple_path(start, end)
        BASE.set_style(cell, source_anchor, target_anchor)
        BASE.set_edge_points(cell, path[1:-1])


def relayout_file(input_path: Path, output_path: Path, keep_vertices: bool, validate: bool, strict: bool) -> None:
    tree = ET.parse(input_path)
    model = BASE.find_model(tree)
    root = model.find("root")
    if root is None:
        raise ValueError("Missing <root> in mxGraphModel.")
    original_edge_endpoints = edge_endpoint_snapshot(root)

    boxes = BASE.collect_boxes(root)
    if not boxes:
        raise ValueError("No top-level draw.io class boxes were detected.")

    edges = BASE.collect_edges(root, boxes)
    if not keep_vertices:
        positions = build_logical_layout(root, boxes, edges)
        boxes = BASE.set_box_positions(root, positions)

    try:
        BASE.route_edges(root, boxes, edges, validate=validate)
    except Exception as exc:
        if strict:
            raise
        print(f"WARNING: strict router failed for {input_path.name}; using simple orthogonal routing: {exc}", file=sys.stderr)
        simple_route_edges(root, boxes, edges)

    assert_edge_endpoints_unchanged(original_edge_endpoints, root)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_path, encoding="utf-8", xml_declaration=False)


def default_diagram_root() -> Path:
    return Path.cwd().resolve().parent / "diagram"


def output_for_file(input_path: Path, output_arg: Path | None) -> Path:
    if output_arg is not None:
        if output_arg.suffix:
            return output_arg
        return output_arg / f"{input_path.stem}_relayout{input_path.suffix or '.drawio'}"

    if input_path.parent.name.lower() == "ori":
        return input_path.parent.parent / "relayout" / f"{input_path.stem}_relayout{input_path.suffix or '.drawio'}"

    diagram_root = default_diagram_root()
    original_dir = diagram_root / "ori"
    original_dir.mkdir(parents=True, exist_ok=True)
    original_path = original_dir / input_path.name
    if input_path.resolve() != original_path.resolve():
        shutil.copy2(input_path, original_path)
    return diagram_root / "relayout" / f"{input_path.stem}_relayout{input_path.suffix or '.drawio'}"


def input_files(input_arg: Path | None) -> list[Path]:
    if input_arg is None:
        input_arg = default_diagram_root() / "ori"
    if input_arg.is_dir():
        return sorted(input_arg.glob("*.drawio"))
    return [input_arg]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--keep-vertices", action="store_true", help="Only reroute edges; do not move class boxes.")
    parser.add_argument("--skip-validation", action="store_true", help="Skip strict route validation.")
    parser.add_argument("--strict", action="store_true", help="Fail instead of using fallback routing when strict routing fails.")
    args = parser.parse_args(argv)

    try:
        files = input_files(args.input)
        if not files:
            raise FileNotFoundError("No .drawio files found to process.")

        if len(files) > 1 and args.output is not None and args.output.suffix:
            raise ValueError("When processing multiple files, output must be omitted or be a directory.")

        for input_path in files:
            if not input_path.exists():
                raise FileNotFoundError(input_path)
            output_path = output_for_file(input_path, args.output)
            relayout_file(
                input_path=input_path,
                output_path=output_path,
                keep_vertices=args.keep_vertices,
                validate=not args.skip_validation,
                strict=args.strict,
            )
            print(f"Relayout: {output_path}")
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
