import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XMLValidator } from "fast-xml-parser";
import { applyStereotypeGridLayout } from "../../layout/src/index.js";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import {
  extractLayoutViewModel,
  normalizeEdgeEndpointToParent,
  parseMxGraphModelXml,
  serializeMxGraphModel,
  updateCellGeometry,
  updateEdgeRoute,
  updateEdgeTerminal
} from "./mxGraphModel.js";
import { toMxGraphModelXml } from "./mxGraphExporter.js";

const fixture = readFileSync("docs/demo_mermaid.md", "utf8");

export function runMxGraphModelTests(): void {
  parsesAndSerializesMxGraphModel();
  detectsAndNormalizesChildRowEndpoints();
  updatesClassGeometryOnlyOnParentCell();
  updatesEdgeAnchorsAndWaypoints();
  updatesEdgeTerminals();
  separatesExtendsRelationships();
  parsesEdgeMarkersFromStyle();
  parsesRoutingDividersAsValidEndpoints();
  importsUncompressedDrawioWrapper();
}

function parsesAndSerializesMxGraphModel(): void {
  const xml = renderFixture();
  const model = parseMxGraphModelXml(xml);
  const view = extractLayoutViewModel(model);
  const serialized = serializeMxGraphModel(model);
  const reparsed = parseMxGraphModelXml(serialized);
  const rehydratedView = extractLayoutViewModel(reparsed);

  assert.equal(XMLValidator.validate(serialized), true);
  assert.equal(view.classes.length, 11);
  assert.equal(view.edges.length, 13);
  assert.equal(rehydratedView.classes.length, view.classes.length);
  assert.equal(rehydratedView.edges.length, view.edges.length);
  assert.ok(view.classes.some((classCell) => classCell.children.length > 0));
  assert.ok(view.edges.some((edge) => edge.waypoints.length > 0));
}

function detectsAndNormalizesChildRowEndpoints(): void {
  const xml = renderFixture();
  const model = parseMxGraphModelXml(xml);
  const firstClassWithChild = extractLayoutViewModel(model).classes.find((classCell) => classCell.children.length > 0);
  const firstEdge = model.cells.find((cell) => cell.attributes.edge === "1");

  assert.ok(firstClassWithChild);
  assert.ok(firstEdge);
  assert.ok(firstClassWithChild.children[0]);

  const childSourceModel = updateRawCell(model, firstEdge.id, (cell) => {
    cell.attributes.source = firstClassWithChild.children[0].id;
  });
  const warningView = extractLayoutViewModel(childSourceModel);
  const normalized = normalizeEdgeEndpointToParent(childSourceModel, firstEdge.id);
  const normalizedEdge = normalized.cells.find((cell) => cell.id === firstEdge.id);

  assert.ok(warningView.diagnostics.some((diagnostic) => diagnostic.message.includes("connects to source child row")));
  assert.equal(normalizedEdge?.attributes.source, firstClassWithChild.id);
}

function updatesClassGeometryOnlyOnParentCell(): void {
  const model = parseMxGraphModelXml(renderFixture());
  const classCell = extractLayoutViewModel(model).classes[0];
  const updated = updateCellGeometry(model, classCell.id, { x: 321, y: 654, width: 280 });
  const updatedClass = updated.cells.find((cell) => cell.id === classCell.id);
  const child = updated.cells.find((cell) => cell.attributes.parent === classCell.id);

  assert.ok(child);
  assert.equal(updatedClass?.geometry?.attributes.x, "321");
  assert.equal(updatedClass?.geometry?.attributes.y, "654");
  assert.equal(updatedClass?.geometry?.attributes.width, "280");
  assert.equal(child?.geometry?.attributes.y, model.cells.find((cell) => cell.id === child.id)?.geometry?.attributes.y);
}

function updatesEdgeAnchorsAndWaypoints(): void {
  const model = parseMxGraphModelXml(renderFixture());
  const edge = extractLayoutViewModel(model).edges[0];
  const updated = updateEdgeRoute(model, edge.id, {
    sourceAnchor: { side: "right", ratio: 0.25 },
    targetAnchor: { side: "left", ratio: 0.75 },
    waypoints: [
      { x: 10, y: 20 },
      { x: 30, y: 20 }
    ]
  });
  const updatedEdge = extractLayoutViewModel(updated).edges.find((candidate) => candidate.id === edge.id);

  assert.deepEqual(updatedEdge?.sourceAnchor, { side: "right", ratio: 0.25 });
  assert.deepEqual(updatedEdge?.targetAnchor, { side: "left", ratio: 0.75 });
  assert.deepEqual(updatedEdge?.waypoints, [
    { x: 10, y: 20 },
    { x: 30, y: 20 }
  ]);
}

function updatesEdgeTerminals(): void {
  const model = parseMxGraphModelXml(renderFixture());
  const view = extractLayoutViewModel(model);
  const edge = view.edges[0];
  const replacementSource = view.classes.find((classCell) => classCell.id !== edge.sourceId);

  assert.ok(replacementSource);

  const updated = updateEdgeTerminal(model, edge.id, { sourceId: replacementSource.id });
  const updatedEdge = extractLayoutViewModel(updated).edges.find((candidate) => candidate.id === edge.id);

  assert.equal(updatedEdge?.sourceId, replacementSource.id);
  assert.equal(updated.cells.find((cell) => cell.id === edge.id)?.attributes.source, replacementSource.id);
}

function separatesExtendsRelationships(): void {
  const view = extractLayoutViewModel(parseMxGraphModelXml(renderFixture()));

  assert.ok(view.extendsEdges.length > 0);
  assert.ok(view.extendsEdges.every((edge) => edge.kind === "inheritance" || edge.kind === "realization"));
}

function parsesEdgeMarkersFromStyle(): void {
  const xml = toMxGraphModelXml(applyStereotypeGridLayout(parseMermaidClassDiagram([
    "classDiagram",
    "Whole *-- Part : composition-left",
    "Part --* Whole : composition-right",
    "Parent <|-- Child : inheritance-left",
    "Child --|> Parent : inheritance-right",
    "Supplier <.. Client : dependency-left",
    "Client ..> Supplier : dependency-right"
  ].join("\n"))));
  const view = extractLayoutViewModel(parseMxGraphModelXml(xml));

  assertEdgeMarkers(view.edges, "composition-left", "diamondFilled", "none", "composition");
  assertEdgeMarkers(view.edges, "composition-right", "none", "diamondFilled", "composition");
  assertEdgeMarkers(view.edges, "inheritance-left", "block", "none", "inheritance");
  assertEdgeMarkers(view.edges, "inheritance-right", "none", "block", "inheritance");
  assertEdgeMarkers(view.edges, "dependency-left", "open", "none", "dependency");
  assertEdgeMarkers(view.edges, "dependency-right", "none", "open", "dependency");
}

function parsesRoutingDividersAsValidEndpoints(): void {
  const xml = toMxGraphModelXml(applyStereotypeGridLayout(parseMermaidClassDiagram([
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
  ].join("\n"))));
  const view = extractLayoutViewModel(parseMxGraphModelXml(xml));

  assert.equal(view.classes.length, 6);
  assert.equal(view.dividers.length, 1);
  assert.equal(view.edges.length, 6);
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.message.includes("invalid source") || diagnostic.message.includes("invalid target")), false);
  assert.ok(view.edges.some((edge) => edge.sourceId === view.dividers[0].id));
  assert.ok(view.edges.some((edge) => edge.targetId === view.dividers[0].id));
}

function importsUncompressedDrawioWrapper(): void {
  const xml = renderFixture();
  const wrapped = `<mxfile><diagram id="demo">${escapeXmlText(xml)}</diagram></mxfile>`;
  const model = parseMxGraphModelXml(wrapped);

  assert.equal(extractLayoutViewModel(model).classes.length, 11);
}

function renderFixture(): string {
  return toMxGraphModelXml(applyStereotypeGridLayout(parseMermaidClassDiagram(fixture)), { groupFrames: true });
}

function updateRawCell(
  model: ReturnType<typeof parseMxGraphModelXml>,
  cellId: string,
  updater: (cell: ReturnType<typeof parseMxGraphModelXml>["cells"][number]) => void
): ReturnType<typeof parseMxGraphModelXml> {
  return {
    attributes: { ...model.attributes },
    cells: model.cells.map((cell) => {
      const next = {
        id: cell.id,
        attributes: { ...cell.attributes },
        geometry: cell.geometry
          ? {
              attributes: { ...cell.geometry.attributes },
              waypoints: cell.geometry.waypoints.map((point) => ({ ...point }))
            }
          : undefined
      };

      if (next.id === cellId) {
        updater(next);
      }

      return next;
    })
  };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assertEdgeMarkers(
  edges: ReturnType<typeof extractLayoutViewModel>["edges"],
  label: string,
  markerStart: string,
  markerEnd: string,
  kind: string
): void {
  const edge = edges.find((candidate) => candidate.label === label);
  assert.ok(edge, `Expected edge ${label}.`);
  assert.equal(edge.markerStart, markerStart);
  assert.equal(edge.markerEnd, markerEnd);
  assert.equal(edge.kind, kind);
}
