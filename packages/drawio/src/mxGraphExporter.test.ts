import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  applyStereotypeGridLayout,
  createDefaultLayoutEngineRegistry,
  createInitialCoordinateRoutingLayoutV3
} from "../../layout/src/index.js";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import type { DiagramDocument, DiagramEdgeAnchor } from "../../core/src/index.js";
import type { DrawioExportOptions } from "./mxGraphExporter.js";
import { toMxGraphModelXml } from "./mxGraphExporter.js";

const fixture = readFileSync("docs/demo_mermaid.md", "utf8");
const dmLoaiLucLuongFixture = readFileSync("docs/dmLoaiLucLuong.md", "utf8");

export function runDrawioExporterTests(): void {
  exportsParseableRawMxGraphModelXml();
  exportsSwimlaneClassesAndRelationshipEdges();
  omitsGroupFramesByDefault();
  exportsVisibleGroupFramesWhenEnabled();
  exportsEdgeWaypoints();
  exportsOrthogonalAnchoredEdges();
  exportsDenseRoutingDividersAsSplitEdges();
  exportsEngineV2RoutedEdgesWithoutAutoJetty();
  exportsEngineOwnedDividerSegments();
  exportsOperatorSpecificArrowEnds();
  exportsExplicitSwimlaneHeaderSizes();
  exportsThreeClassCompartments();
  exportsTheDmLoaiLucLuongFixture();
}

function exportsParseableRawMxGraphModelXml(): void {
  const xml = renderFixture();
  assert.equal(XMLValidator.validate(xml), true);

  const parsed = parseXml(xml);
  assert.ok(parsed.mxGraphModel);
  const cells = asArray(parsed.mxGraphModel.root.mxCell);
  assert.ok(cells.some((cell) => cell.id === "0"));
  assert.ok(cells.some((cell) => cell.id === "1" && cell.parent === "0"));
}

function exportsSwimlaneClassesAndRelationshipEdges(): void {
  const xml = renderFixture();
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const classCells = cells.filter(isClassCell);
  const edgeCells = cells.filter((cell) => cell.edge === "1");
  const classIds = new Set(classCells.map((cell) => cell.id));

  assert.equal(classCells.length, 11);
  assert.equal(edgeCells.length, 13);
  assert.ok(classCells.every((cell) => String(cell.style).startsWith("swimlane")));
  assert.ok(edgeCells.every((cell) => classIds.has(cell.source) && classIds.has(cell.target)));
}

function omitsGroupFramesByDefault(): void {
  const xml = renderFixture();
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const groupCells = cells.filter(isGroupFrameCell);

  assert.equal(groupCells.length, 0);
}

function exportsVisibleGroupFramesWhenEnabled(): void {
  const xml = renderFixture(fixture, { groupFrames: true });
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const groupCells = cells.filter(isGroupFrameCell);
  const classCells = cells.filter(isClassCell);
  const firstGroupIndex = cells.findIndex(isGroupFrameCell);
  const firstClassIndex = cells.findIndex(isClassCell);

  assert.ok(groupCells.length > 0);
  assert.ok(groupCells.some((cell) => cell.value === "Controller"));
  assert.ok(groupCells.every((cell) => cell.parent === "1"));
  assert.ok(groupCells.every((cell) => String(cell.style).includes("connectable=0")));
  assert.ok(groupCells.every((cell) => String(cell.style).includes("collapsible=0")));
  assert.ok(groupCells.every((cell) => String(cell.style).includes("dashed=1")));
  assert.ok(groupCells.every((cell) => !String(cell.style).startsWith("swimlane")));
  assert.ok(firstGroupIndex >= 0 && firstClassIndex >= 0 && firstGroupIndex < firstClassIndex);
  assert.equal(classCells.length, 11);
}

function exportsEdgeWaypoints(): void {
  const xml = renderFixture();
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const edgeCells = cells.filter((cell) => cell.edge === "1");
  const routedEdges = edgeCells.filter((cell) => waypointCount(cell) > 0);

  assert.ok(routedEdges.length > 0);
  assert.ok(routedEdges.every((cell) => cell.mxGeometry?.Array?.mxPoint));
  assert.ok(routedEdges.every((cell) => waypointsForCell(cell).every((point) => point.as === undefined)));
}

function exportsOrthogonalAnchoredEdges(): void {
  const xml = renderFixture();
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const edgeCells = cells.filter((cell) => cell.edge === "1");

  assert.ok(edgeCells.length > 0);
  assert.ok(edgeCells.every((cell) => String(cell.style).includes("curved=0")));
  assert.ok(edgeCells.every((cell) => String(cell.style).includes("edgeStyle=orthogonalEdgeStyle")));
  assert.ok(edgeCells.every((cell) => String(cell.style).includes("orthogonalLoop=1")));
  assert.ok(edgeCells.every((cell) => String(cell.style).includes("jettySize=auto")));
  assert.ok(edgeCells.every((cell) => String(cell.style).includes("html=1")));
  assert.ok(edgeCells.every((cell) => /(?:^|;)exitX=/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => /(?:^|;)exitY=/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => /(?:^|;)entryX=/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => /(?:^|;)entryY=/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => /(?:^|;)exitPerimeter=0(?:;|$)/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => /(?:^|;)entryPerimeter=0(?:;|$)/.test(String(cell.style))));
  assert.ok(edgeCells.every((cell) => !waypointsForCell(cell).some((point) => point.as === "sourcePoint" || point.as === "targetPoint")));
}

function exportsDenseRoutingDividersAsSplitEdges(): void {
  const xml = renderFixture([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> FirstModel",
    "<<Model>> SecondModel",
    "<<Model>> ThirdModel",
    "<<Model>> FourthModel",
    "<<Model>> FifthModel",
    "SourceController ..> FirstModel : first",
    "SourceController ..> SecondModel : second",
    "SourceController ..> ThirdModel : third",
    "SourceController ..> FourthModel : fourth",
    "SourceController ..> FifthModel : fifth"
  ].join("\n"));
  assert.equal(XMLValidator.validate(xml), true);

  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const classCells = cells.filter(isClassCell);
  const dividerCells = cells.filter((cell) => String(cell.style).includes("autoDiagramRoutingDivider=1"));
  const edgeCells = cells.filter((cell) => cell.edge === "1");
  const classIds = new Set(classCells.map((cell) => cell.id));
  const dividerIds = new Set(dividerCells.map((cell) => cell.id));

  assert.equal(classCells.length, 6);
  assert.equal(dividerCells.length, 1);
  assert.equal(edgeCells.length, 6);
  assert.ok(dividerCells.every((cell) => !String(cell.style).startsWith("swimlane")));
  assert.ok(edgeCells.every((cell) => classIds.has(cell.source) || dividerIds.has(cell.source)));
  assert.ok(edgeCells.every((cell) => classIds.has(cell.target) || dividerIds.has(cell.target)));
  assert.equal(edgeCells.filter((cell) => dividerIds.has(cell.source)).length, 5);
  assert.equal(edgeCells.filter((cell) => dividerIds.has(cell.target)).length, 1);
}

function exportsEngineV2RoutedEdgesWithoutAutoJetty(): void {
  const xml = toMxGraphModelXml(engineOwnedRouteDocument());
  assert.equal(XMLValidator.validate(xml), true);
  const edgeCells = asArray(parseXml(xml).mxGraphModel.root.mxCell).filter((cell) => cell.edge === "1");

  assert.equal(edgeCells.length, 1);
  assert.ok(!String(edgeCells[0].style).includes("jettySize=auto"));
  assert.ok(String(edgeCells[0].style).includes("edgeStyle=orthogonalEdgeStyle"));
  assert.ok(String(edgeCells[0].style).includes("exitPerimeter=0"));
  assert.ok(String(edgeCells[0].style).includes("entryPerimeter=0"));
  assert.deepEqual(waypointsForCell(edgeCells[0]).map((point) => ({ x: Number(point.x), y: Number(point.y) })), [
    { x: 160, y: 30 },
    { x: 160, y: 100 }
  ]);
}

function exportsEngineOwnedDividerSegments(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> SourceController",
    "<<Model>> FirstModel",
    "<<Model>> SecondModel",
    "<<Model>> ThirdModel",
    "<<Model>> FourthModel",
    "<<Model>> FifthModel",
    "SourceController ..> FirstModel : first",
    "SourceController ..> SecondModel : second",
    "SourceController ..> ThirdModel : third",
    "SourceController ..> FourthModel : fourth",
    "SourceController ..> FifthModel : fifth"
  ].join("\n"));
  const layout = createInitialCoordinateRoutingLayoutV3(parsed);
  const result = createDefaultLayoutEngineRegistry().get("manual-routing-v2").run({
    document: parsed,
    mode: "manual-routing-v2",
    layoutInput: layout,
    options: { routeStrategy: "template-with-outer-lanes" }
  });
  const xml = toMxGraphModelXml(result.document);
  assert.equal(XMLValidator.validate(xml), true);
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const dividerCells = cells.filter((cell) => String(cell.style).includes("autoDiagramRoutingDivider=1"));
  const edgeCells = cells.filter((cell) => cell.edge === "1");

  assert.equal(result.document.routingDividers?.length, 1);
  assert.equal(dividerCells.length, 1);
  assert.equal(edgeCells.length, 6);
  assert.ok(result.document.edges.every((edge) => edge.layout?.routeSource === "engine-v2"));
  assert.ok(result.document.edges.some((edge) => (edge.layout?.routedSegments?.length ?? 0) > 1));
  assert.equal(result.document.edges.flatMap((edge) => edge.layout?.routedSegments ?? []).filter((segment) => segment.id.endsWith(":divider-trunk")).length, 1);
  assert.ok(result.document.edges.flatMap((edge) => edge.layout?.routedSegments ?? []).filter((segment) => segment.id.endsWith(":divider-spoke")).length >= 5);
  assert.ok(edgeCells.every((cell) => !String(cell.style).includes("jettySize=auto")));
  assert.ok(edgeCells.some((cell) => waypointCount(cell) > 0));
}

function exportsOperatorSpecificArrowEnds(): void {
  const xml = renderFixture([
    "classDiagram",
    "Parent <|-- Child : inheritance-left",
    "Child --|> Parent : inheritance-right",
    "Interface <|.. Implementation : realization-left",
    "Implementation ..|> Interface : realization-right",
    "Whole *-- Part : composition-left",
    "Part --* Whole : composition-right",
    "Whole o-- Part : aggregation-left",
    "Part --o Whole : aggregation-right",
    "Supplier <.. Client : dependency-left",
    "Client ..> Supplier : dependency-right",
    "B <-- A : directed-left",
    "A --> B : directed-right"
  ].join("\n"));
  const edgeCells = asArray(parseXml(xml).mxGraphModel.root.mxCell).filter((cell) => cell.edge === "1");

  assertStyleForLabel(edgeCells, "inheritance-left", ["startArrow=block", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "inheritance-right", ["startArrow=none", "endArrow=block"]);
  assertStyleForLabel(edgeCells, "realization-left", ["dashed=1", "startArrow=block", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "realization-right", ["dashed=1", "startArrow=none", "endArrow=block"]);
  assertStyleForLabel(edgeCells, "composition-left", ["startArrow=diamondThin", "startFill=1", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "composition-right", ["startArrow=none", "endArrow=diamondThin", "endFill=1"]);
  assertStyleForLabel(edgeCells, "aggregation-left", ["startArrow=diamondThin", "startFill=0", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "aggregation-right", ["startArrow=none", "endArrow=diamondThin", "endFill=0"]);
  assertStyleForLabel(edgeCells, "dependency-left", ["dashed=1", "startArrow=open", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "dependency-right", ["dashed=1", "startArrow=none", "endArrow=open"]);
  assertStyleForLabel(edgeCells, "directed-left", ["startArrow=open", "endArrow=none"]);
  assertStyleForLabel(edgeCells, "directed-right", ["startArrow=none", "endArrow=open"]);
}

function exportsExplicitSwimlaneHeaderSizes(): void {
  const xml = renderFixture();
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);

  assertExplicitSwimlaneHeaderSizes(cells);
}

function exportsThreeClassCompartments(): void {
  const xml = renderFixture([
    "classDiagram",
    "class MethodOnly {",
    "  +Run() void",
    "}",
    "class AttributeOnly {",
    "  +Name string",
    "}",
    "class EmptyClass"
  ].join("\n"));
  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);

  assertClassCompartments(cells, "node_1", 40, 30, 8);
  assertClassCompartments(cells, "node_2", 40, 30, 8);
  assertClassCompartments(cells, "node_3", 40, 30, 8);
}

function exportsTheDmLoaiLucLuongFixture(): void {
  const xml = renderFixture(dmLoaiLucLuongFixture);
  assert.equal(XMLValidator.validate(xml), true);

  const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
  const classCells = cells.filter(isClassCell);
  const edgeCells = cells.filter((cell) => cell.edge === "1");
  const childCells = cells.filter((cell) => cell.vertex === "1" && cell.parent !== "1");
  const classIds = new Set(classCells.map((cell) => cell.id));

  assert.equal(classCells.length, 8);
  assert.equal(edgeCells.length, 9);
  assert.equal(childCells.length, 62);
  assert.ok(classCells.every((cell) => String(cell.style).startsWith("swimlane")));
  assert.ok(edgeCells.every((cell) => classIds.has(cell.source) && classIds.has(cell.target)));
  assertExplicitSwimlaneHeaderSizes(cells);
}

function assertExplicitSwimlaneHeaderSizes(cells: any[]): void {
  const classCells = cells.filter(isClassCell);
  const childCells = cells.filter((cell) => cell.vertex === "1" && cell.parent !== "1");

  for (const classCell of classCells) {
    const startSize = extractStartSize(String(classCell.style));
    assert.ok(startSize > 0, `Expected ${classCell.id} to define a swimlane startSize.`);

    const classChildren = childCells.filter((cell) => cell.parent === classCell.id);
    assert.ok(
      classChildren.every((cell) => Number(cell.mxGeometry.y) >= startSize),
      `Expected all child rows for ${classCell.id} to start below the swimlane header.`
    );

    const firstTextChild = classChildren.find((cell) => !String(cell.style).split(";").includes("line"));
    if (firstTextChild && Number(firstTextChild.mxGeometry.y) < Number(classChildren.find((cell) => String(cell.style).split(";").includes("line"))?.mxGeometry.y ?? Number.POSITIVE_INFINITY)) {
      assert.equal(Number(firstTextChild.mxGeometry.y), startSize);
    }
  }
}

function assertClassCompartments(cells: any[], classCellId: string, headerHeight: number, lineHeight: number, separatorHeight: number): void {
  const classCell = cells.find((cell) => cell.id === classCellId);
  const separator = cells.find((cell) => cell.parent === classCellId && String(cell.style).split(";").includes("line"));

  assert.ok(classCell, `Expected class cell ${classCellId}.`);
  assert.ok(separator, `Expected ${classCellId} to include an attributes/methods separator.`);
  assert.equal(extractStartSize(String(classCell.style)), headerHeight);
  assert.equal(Number(separator.mxGeometry.y), headerHeight + lineHeight);
  assert.equal(Number(separator.mxGeometry.height), separatorHeight);
  assert.ok(Number(classCell.mxGeometry.height) >= headerHeight + lineHeight + separatorHeight + lineHeight);
}

function extractStartSize(style: string): number {
  const match = style.match(/(?:^|;)startSize=([^;]+)/);
  return match ? Number(match[1]) : 0;
}

function isClassCell(cell: any): boolean {
  return cell.vertex === "1" && cell.parent === "1" && String(cell.style).startsWith("swimlane");
}

function isGroupFrameCell(cell: any): boolean {
  return cell.vertex === "1" && cell.parent === "1" && String(cell.id).startsWith("group_frame_");
}

function waypointCount(cell: any): number {
  return waypointsForCell(cell).length;
}

function waypointsForCell(cell: any): any[] {
  const points = cell.mxGeometry?.Array?.mxPoint;
  return points ? asArray(points) : [];
}

function renderFixture(source = fixture, options?: DrawioExportOptions): string {
  return toMxGraphModelXml(applyStereotypeGridLayout(parseMermaidClassDiagram(source)), options);
}

function engineOwnedRouteDocument(): DiagramDocument {
  const east: DiagramEdgeAnchor = { side: "east", ratio: 0.5 };
  const west: DiagramEdgeAnchor = { side: "west", ratio: 0.5 };
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "Source --> Target : custom"
  ].join("\n"));
  const [source, target] = parsed.nodes;

  return {
    ...parsed,
    nodes: [
      {
        ...source,
        layout: {
          x: 0,
          y: 0,
          width: 120,
          height: 60,
          headerHeight: 32,
          lineHeight: 20,
          separatorHeight: 8
        }
      },
      {
        ...target,
        layout: {
          x: 280,
          y: 70,
          width: 120,
          height: 60,
          headerHeight: 32,
          lineHeight: 20,
          separatorHeight: 8
        }
      }
    ],
    edges: parsed.edges.map((edge) => ({
      ...edge,
      layout: {
        sourceAnchor: east,
        targetAnchor: west,
        routeSource: "engine-v2" as const,
        routedSegments: [{
          id: `${edge.id}:direct`,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          label: edge.label ?? "",
          sourceAnchor: east,
          targetAnchor: west,
          waypoints: [{ x: 160, y: 30 }, { x: 160, y: 100 }],
          markerPolicy: { start: true, end: true },
          strategy: "corridor" as const
        }]
      }
    }))
  };
}

function parseXml(xml: string): any {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false
  }).parse(xml);
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function assertStyleForLabel(edgeCells: any[], label: string, expectedParts: string[]): void {
  const edge = edgeCells.find((cell) => cell.value === label);
  assert.ok(edge, `Expected edge with label ${label}.`);
  const style = String(edge.style);

  for (const expectedPart of expectedParts) {
    assert.ok(style.includes(expectedPart), `Expected ${label} style to include ${expectedPart}: ${style}`);
  }
}
