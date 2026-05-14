from __future__ import annotations

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "autodiagram_standalone.py"
OUT_DIR = ROOT / "out" / "python-standalone-tests"

sys.path.insert(0, str(ROOT / "scripts"))
import autodiagram_standalone as standalone  # noqa: E402


EXPECTED_STEREOTYPES = {
    "AdapterFactory",
    "Controller",
    "DTO",
    "DataAccessAdapter",
    "LLBLGenEntity",
    "Manager",
    "ManagerInterface",
    "Model",
}


def tail(value: str, limit: int = 2000) -> str:
    return value[-limit:] if len(value) > limit else value


def run_cli(*args: str | Path, expect_success: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *[str(arg) for arg in args]],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if expect_success and result.returncode != 0:
        raise AssertionError(
            f"CLI failed with exit {result.returncode}\nstdout:\n{tail(result.stdout)}\nstderr:\n{tail(result.stderr)}"
        )
    if not expect_success and result.returncode == 0:
        raise AssertionError(f"CLI unexpectedly succeeded\nstdout:\n{tail(result.stdout)}\nstderr:\n{tail(result.stderr)}")
    return result


def mx_cells(xml_text: str) -> list[ET.Element]:
    root = ET.fromstring(xml_text)
    mx_root = root.find("root")
    if mx_root is None:
        raise AssertionError("mxGraphModel root cell container is missing")
    return list(mx_root.findall("mxCell"))


def class_cells(cells: list[ET.Element]) -> list[ET.Element]:
    return [
        cell
        for cell in cells
        if cell.get("vertex") == "1" and "swimlane" in (cell.get("style") or "")
    ]


def edge_cells(cells: list[ET.Element]) -> list[ET.Element]:
    return [cell for cell in cells if cell.get("edge") == "1"]


def divider_cells(cells: list[ET.Element]) -> list[ET.Element]:
    return [cell for cell in cells if "autoDiagramRoutingDivider=1" in (cell.get("style") or "")]


def test_parser_counts_and_diagnostics() -> None:
    demo = standalone.read_input(ROOT / "docs" / "demo_mermaid.md")
    assert len(demo["nodes"]) == 11
    assert len(demo["edges"]) == 13
    assert {node["stereotype"] for node in demo["nodes"]} == EXPECTED_STEREOTYPES

    controller = next(node for node in demo["nodes"] if node["id"] == "DmPhuongTienController")
    assert controller["attributes"][0]["text"] == "-_manager IDmPhuongTienManager"
    assert controller["methods"][0]["returnType"] == "Task<ApiResponse>"

    dm_loai_luc_luong = standalone.read_input(ROOT / "docs" / "dmLoaiLucLuong.md")
    assert len(dm_loai_luc_luong["nodes"]) == 8
    assert len(dm_loai_luc_luong["edges"]) == 9
    assert {node["stereotype"] for node in dm_loai_luc_luong["nodes"]} == EXPECTED_STEREOTYPES

    implicit = standalone.parse_mermaid_class_diagram(
        "classDiagram\nKnown ..> Missing : Task~Result~\nunsupported line\nclass Known\n"
    )
    assert implicit["edges"][0]["operator"] == "..>"
    assert implicit["edges"][0]["label"] == "Task<Result>"
    messages = [diagnostic["message"] for diagnostic in implicit["diagnostics"]]
    assert any("Unsupported Mermaid" in message for message in messages)
    assert any("Class Missing is referenced" in message for message in messages)


def test_layout_init_cli_and_engine_rejection() -> None:
    layout_path = OUT_DIR / "demo.layout-v3.json"
    run_cli("layout-init", "docs/demo_mermaid.md", "-o", layout_path, "--suggested-layout", "--engine", "v2")
    layout = json.loads(layout_path.read_text(encoding="utf8"))
    assert layout["version"] == 3
    assert layout["layoutMode"] == "coordinate-routing"
    assert len(layout["groups"]) == 8
    assert any(group["label"] == "Controller" and group["nodeOrder"] == ["DmPhuongTienController"] for group in layout["groups"])

    rejected = run_cli("layout-init", "docs/demo_mermaid.md", "-o", OUT_DIR / "legacy.json", "--engine", "legacy", expect_success=False)
    assert "only supports --engine v2" in rejected.stderr


def test_demo_generate_v2_invariants_and_export() -> None:
    drawio_path = OUT_DIR / "demo.drawio"
    report_path = OUT_DIR / "demo.report.json"
    run_cli("generate", "docs/demo_mermaid.md", "-o", drawio_path, "--log-layout-json", report_path, "--engine", "v2")

    report = json.loads(report_path.read_text(encoding="utf8"))
    summary = report["routingSummary"]
    assert summary["hardValid"] is True
    assert summary["totalEdges"] == 13
    assert summary["edgeNodeHits"] == 0
    assert summary["illegalSegmentOverlaps"] == 0
    assert summary["routingFailures"] == 0
    assert summary["invalidDividers"] == 0
    assert summary["edgeIdentityViolations"] == 0

    cells = mx_cells(drawio_path.read_text(encoding="utf8"))
    classes = class_cells(cells)
    edges = edge_cells(cells)
    dividers = divider_cells(cells)
    assert len(classes) == 11
    assert len(dividers) == 1
    assert len(edges) == summary["totalEdges"] + len(dividers)
    assert all("jettySize=auto" not in (edge.get("style") or "") for edge in edges)

    divider_ids = {divider.get("id") for divider in dividers}
    assert sum(1 for edge in edges if edge.get("source") in divider_ids) == 6
    assert sum(1 for edge in edges if edge.get("target") in divider_ids) == 1


def test_qlsk_generate_parseable_xml() -> None:
    drawio_path = OUT_DIR / "qlsk.drawio"
    report_path = OUT_DIR / "qlsk.report.json"
    run_cli("generate", "docs/qlsk.md", "-o", drawio_path, "--log-layout-json", report_path, "--engine", "v2")

    report = json.loads(report_path.read_text(encoding="utf8"))
    cells = mx_cells(drawio_path.read_text(encoding="utf8"))
    assert report["routingSummary"]["totalEdges"] == 39
    assert len(class_cells(cells)) == 27
    assert len(edge_cells(cells)) >= 39


def test_fanout_divider_and_arrow_styles() -> None:
    fanout = standalone.parse_mermaid_class_diagram(
        """classDiagram
class Hub {
<<Controller>>
}
class T1 {
<<Model>>
}
class T2 {
<<Model>>
}
class T3 {
<<Model>>
}
class T4 {
<<Model>>
}
class T5 {
<<Model>>
}
Hub ..> T1 : use
Hub ..> T2 : use
Hub ..> T3 : use
Hub ..> T4 : use
Hub ..> T5 : use
"""
    )
    fanout_result = standalone.run_routing_pipeline(
        fanout,
        engine="suggest-initial-v2",
        route_strategy="template-with-outer-lanes",
    )
    fanout_summary = fanout_result["report"]["routingSummary"]
    assert fanout_summary["hardValid"] is True
    assert fanout_summary["illegalSegmentOverlaps"] == 0
    assert fanout_summary["invalidDividers"] == 0

    fanout_cells = mx_cells(standalone.to_mx_graph_model_xml(fanout_result["document"]))
    dividers = divider_cells(fanout_cells)
    edges = edge_cells(fanout_cells)
    assert len(dividers) == 1
    assert len(edges) == 6
    assert all("jettySize=auto" not in (edge.get("style") or "") for edge in edges)

    operators = standalone.parse_mermaid_class_diagram(
        """classDiagram
class A
class B
class C
class D
class E
class F
class G
class H
A <|-- B : inherits
C --* D : owns
E --> F : points
G ..|> H : realizes
"""
    )
    operator_result = standalone.run_routing_pipeline(
        operators,
        engine="suggest-initial-v2",
        route_strategy="template-with-outer-lanes",
    )
    operator_cells = mx_cells(standalone.to_mx_graph_model_xml(operator_result["document"]))
    styles_by_label = {cell.get("value"): cell.get("style") or "" for cell in edge_cells(operator_cells)}
    assert "startArrow=block" in styles_by_label["inherits"]
    assert "endArrow=diamondThin" in styles_by_label["owns"]
    assert "endFill=1" in styles_by_label["owns"]
    assert "endArrow=open" in styles_by_label["points"]
    assert "dashed=1" in styles_by_label["realizes"]
    assert "endArrow=block" in styles_by_label["realizes"]


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tests: list[tuple[str, Callable[[], None]]] = [
        ("parser counts, stereotypes, operators, diagnostics", test_parser_counts_and_diagnostics),
        ("layout-init CoordinateRoutingLayoutV3 and engine rejection", test_layout_init_cli_and_engine_rejection),
        ("demo generate v2 invariants and exporter", test_demo_generate_v2_invariants_and_export),
        ("qlsk generate parseable mxGraphModel", test_qlsk_generate_parseable_xml),
        ("fanout divider and UML arrow styles", test_fanout_divider_and_arrow_styles),
    ]
    for index, (name, test) in enumerate(tests, start=1):
        test()
        print(f"ok {index} - {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
