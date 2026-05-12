import { XMLParser } from "fast-xml-parser";

export type MxAnchorSide = "top" | "right" | "bottom" | "left";

export type MxDiagnosticSeverity = "warning" | "error";

export type MxGraphDiagnostic = {
  severity: MxDiagnosticSeverity;
  message: string;
  cellId?: string;
};

export type MxPoint = {
  x: number;
  y: number;
};

export type MxGeometry = {
  attributes: Record<string, string>;
  waypoints: MxPoint[];
};

export type MxGraphCell = {
  id: string;
  attributes: Record<string, string>;
  geometry?: MxGeometry;
};

export type MxGraphModel = {
  attributes: Record<string, string>;
  cells: MxGraphCell[];
};

export type MxAnchor = {
  side: MxAnchorSide;
  ratio: number;
};

export type MxLayoutClass = {
  id: string;
  label: string;
  stereotype?: string;
  headerHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  children: MxGraphCell[];
};

export type MxLayoutEdgeKind = "dependency" | "realization" | "inheritance" | "association" | "directedAssociation" | "aggregation" | "composition" | "dashedAssociation";

export type MxLayoutEdgeMarker = "none" | "open" | "block" | "diamondOpen" | "diamondFilled";

export type MxLayoutEdge = {
  id: string;
  sourceId?: string;
  targetId?: string;
  label: string;
  kind: MxLayoutEdgeKind;
  markerStart: MxLayoutEdgeMarker;
  markerEnd: MxLayoutEdgeMarker;
  dashed: boolean;
  sourceAnchor?: MxAnchor;
  targetAnchor?: MxAnchor;
  waypoints: MxPoint[];
};

export type MxLayoutGroup = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  classIds: string[];
};

export type MxLayoutViewModel = {
  classes: MxLayoutClass[];
  edges: MxLayoutEdge[];
  extendsEdges: MxLayoutEdge[];
  groups: MxLayoutGroup[];
  diagnostics: MxGraphDiagnostic[];
  bounds: {
    width: number;
    height: number;
  };
};

export type MxCellGeometryPatch = Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type MxEdgeRoutePatch = Partial<{
  sourceAnchor: MxAnchor;
  targetAnchor: MxAnchor;
  waypoints: MxPoint[];
}>;

export type MxEdgeTerminalPatch = Partial<{
  sourceId: string;
  targetId: string;
}>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: false,
  isArray: (_name, jpath) => typeof jpath === "string" && (jpath.endsWith(".root.mxCell") || jpath.endsWith(".Array.mxPoint"))
});

const numericAttributes = new Set(["x", "y", "width", "height", "dx", "dy", "pageScale", "pageWidth", "pageHeight"]);

export function parseMxGraphModelXml(input: string): MxGraphModel {
  const xml = extractMxGraphModelXml(input);
  const parsed = parser.parse(xml) as {
    mxGraphModel?: Record<string, unknown> & {
      root?: {
        mxCell?: unknown[];
      };
    };
  };

  if (!parsed.mxGraphModel?.root) {
    throw new Error("Input does not contain an mxGraphModel root.");
  }

  const attributes = collectAttributes(parsed.mxGraphModel, ["root"]);
  const rawCells = asArray(parsed.mxGraphModel.root.mxCell);

  return {
    attributes,
    cells: rawCells.map(parseCell)
  };
}

export function serializeMxGraphModel(model: MxGraphModel): string {
  const lines = [
    `<mxGraphModel${serializeAttributes(model.attributes)}>`,
    "  <root>",
    ...model.cells.map((cell) => serializeCell(cell)),
    "  </root>",
    "</mxGraphModel>",
    ""
  ];

  return lines.join("\n");
}

export function extractLayoutViewModel(model: MxGraphModel): MxLayoutViewModel {
  const diagnostics: MxGraphDiagnostic[] = [];
  const cellById = new Map(model.cells.map((cell) => [cell.id, cell]));
  const parentByChildId = buildParentByChildId(model.cells);
  const classes = model.cells.filter(isClassCell).map((cell): MxLayoutClass => {
    const value = cell.attributes.value ?? cell.id;
    const { label, stereotype } = parseClassHeader(value);
    const geometry = requireGeometry(cell);
    const style = parseStyle(cell.attributes.style ?? "");

    return {
      id: cell.id,
      label,
      stereotype,
      headerHeight: readNumber(style.get("startSize"), stereotype ? 48 : 40),
      x: readNumber(geometry.attributes.x, 0),
      y: readNumber(geometry.attributes.y, 0),
      width: readNumber(geometry.attributes.width, 220),
      height: readNumber(geometry.attributes.height, 120),
      children: model.cells.filter((candidate) => candidate.attributes.parent === cell.id)
    };
  });
  const classById = new Map(classes.map((classCell) => [classCell.id, classCell]));
  const edges = model.cells.filter((cell) => cell.attributes.edge === "1").map((cell): MxLayoutEdge => {
    const sourceId = resolveClassEndpoint(cell.attributes.source, parentByChildId);
    const targetId = resolveClassEndpoint(cell.attributes.target, parentByChildId);

    if (!cell.attributes.source || !sourceId || !classById.has(sourceId)) {
      diagnostics.push({
        severity: "error",
        cellId: cell.id,
        message: `Edge ${cell.id} has a missing or invalid source.`
      });
    }

    if (!cell.attributes.target || !targetId || !classById.has(targetId)) {
      diagnostics.push({
        severity: "error",
        cellId: cell.id,
        message: `Edge ${cell.id} has a missing or invalid target.`
      });
    }

    if (cell.attributes.source && cell.attributes.source !== sourceId) {
      diagnostics.push({
        severity: "warning",
        cellId: cell.id,
        message: `Edge ${cell.id} connects to source child row ${cell.attributes.source}.`
      });
    }

    if (cell.attributes.target && cell.attributes.target !== targetId) {
      diagnostics.push({
        severity: "warning",
        cellId: cell.id,
        message: `Edge ${cell.id} connects to target child row ${cell.attributes.target}.`
      });
    }

    const style = parseStyle(cell.attributes.style ?? "");

    return {
      id: cell.id,
      sourceId,
      targetId,
      label: cell.attributes.value ?? "",
      kind: classifyEdge(style),
      markerStart: markerFromStyle(style, "start"),
      markerEnd: markerFromStyle(style, "end"),
      dashed: style.get("dashed") === "1",
      sourceAnchor: anchorFromStyle(style, "exit"),
      targetAnchor: anchorFromStyle(style, "entry"),
      waypoints: cell.geometry?.waypoints ?? []
    };
  });

  diagnostics.push(...validateDuplicateAnchors(edges));
  diagnostics.push(...validateOrthogonalEdges(edges));
  diagnostics.push(...validateClassOverlaps(classes));
  diagnostics.push(...validateEdgeClassHits(edges, classes));

  const groups = extractGroups(model, classes);
  diagnostics.push(...validateGroupOverlaps(groups));
  diagnostics.push(...validateClassesOutsideGroups(groups, classes));

  return {
    classes,
    edges,
    extendsEdges: edges.filter((edge) => edge.kind === "inheritance" || edge.kind === "realization"),
    groups,
    diagnostics,
    bounds: calculateBounds(classes, groups)
  };
}

export function updateCellGeometry(
  model: MxGraphModel,
  cellId: string,
  geometryPatch: MxCellGeometryPatch
): MxGraphModel {
  return updateCell(model, cellId, (cell) => {
    const geometry = ensureGeometry(cell);

    for (const [key, value] of Object.entries(geometryPatch)) {
      if (value !== undefined && Number.isFinite(value)) {
        geometry.attributes[key] = formatNumber(value);
      }
    }
  });
}

export function updateEdgeRoute(
  model: MxGraphModel,
  edgeId: string,
  routePatch: MxEdgeRoutePatch
): MxGraphModel {
  return updateCell(model, edgeId, (cell) => {
    if (routePatch.sourceAnchor) {
      cell.attributes.style = writeAnchorToStyle(cell.attributes.style ?? "", "exit", routePatch.sourceAnchor);
    }

    if (routePatch.targetAnchor) {
      cell.attributes.style = writeAnchorToStyle(cell.attributes.style ?? "", "entry", routePatch.targetAnchor);
    }

    if (routePatch.waypoints) {
      const geometry = ensureGeometry(cell);
      geometry.attributes.relative = geometry.attributes.relative ?? "1";
      geometry.attributes.as = geometry.attributes.as ?? "geometry";
      geometry.waypoints = routePatch.waypoints.map((point) => ({ x: point.x, y: point.y }));
    }
  });
}

export function updateEdgeTerminal(
  model: MxGraphModel,
  edgeId: string,
  terminalPatch: MxEdgeTerminalPatch
): MxGraphModel {
  return updateCell(model, edgeId, (cell) => {
    if (terminalPatch.sourceId) {
      cell.attributes.source = terminalPatch.sourceId;
    }

    if (terminalPatch.targetId) {
      cell.attributes.target = terminalPatch.targetId;
    }
  });
}

export function normalizeEdgeEndpointToParent(model: MxGraphModel, edgeId: string): MxGraphModel {
  const parentByChildId = buildParentByChildId(model.cells);

  return updateCell(model, edgeId, (cell) => {
    const source = resolveClassEndpoint(cell.attributes.source, parentByChildId);
    const target = resolveClassEndpoint(cell.attributes.target, parentByChildId);

    if (source) {
      cell.attributes.source = source;
    }

    if (target) {
      cell.attributes.target = target;
    }
  });
}

export function normalizeAllEdgeEndpointsToParents(model: MxGraphModel): MxGraphModel {
  return model.cells
    .filter((cell) => cell.attributes.edge === "1")
    .reduce((next, edge) => normalizeEdgeEndpointToParent(next, edge.id), model);
}

function parseCell(rawCell: unknown): MxGraphCell {
  if (!isRecord(rawCell) || typeof rawCell.id !== "string") {
    throw new Error("mxCell is missing a string id.");
  }

  const geometry = isRecord(rawCell.mxGeometry) ? parseGeometry(rawCell.mxGeometry) : undefined;
  return {
    id: rawCell.id,
    attributes: collectAttributes(rawCell, ["mxGeometry"]),
    geometry
  };
}

function parseGeometry(rawGeometry: Record<string, unknown>): MxGeometry {
  const rawArray = isRecord(rawGeometry.Array) ? rawGeometry.Array : undefined;
  const rawPoints = rawArray ? asArray(rawArray.mxPoint) : [];

  return {
    attributes: collectAttributes(rawGeometry, ["Array"]),
    waypoints: rawPoints.filter(isRecord).map((point) => ({
      x: readNumber(point.x, 0),
      y: readNumber(point.y, 0)
    }))
  };
}

function serializeCell(cell: MxGraphCell): string {
  if (!cell.geometry) {
    return `    <mxCell${serializeAttributes(cell.attributes)} />`;
  }

  return [
    `    <mxCell${serializeAttributes(cell.attributes)}>`,
    serializeGeometry(cell.geometry),
    "    </mxCell>"
  ].join("\n");
}

function serializeGeometry(geometry: MxGeometry): string {
  if (geometry.waypoints.length === 0) {
    return `      <mxGeometry${serializeAttributes(geometry.attributes)} />`;
  }

  return [
    `      <mxGeometry${serializeAttributes(geometry.attributes)}>`,
    '        <Array as="points">',
    ...geometry.waypoints.map((point) => `          <mxPoint x="${formatNumber(point.x)}" y="${formatNumber(point.y)}" />`),
    "        </Array>",
    "      </mxGeometry>"
  ].join("\n");
}

function extractMxGraphModelXml(input: string): string {
  const trimmed = input.trim();
  const directStart = trimmed.indexOf("<mxGraphModel");

  if (directStart >= 0) {
    const end = trimmed.lastIndexOf("</mxGraphModel>");
    if (end < directStart) {
      throw new Error("mxGraphModel is missing a closing tag.");
    }
    return trimmed.slice(directStart, end + "</mxGraphModel>".length);
  }

  const diagramMatch = trimmed.match(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/i);
  if (diagramMatch) {
    const decoded = decodeXmlText(diagramMatch[1]);
    if (decoded.includes("<mxGraphModel")) {
      return extractMxGraphModelXml(decoded);
    }
  }

  throw new Error("Only raw mxGraphModel XML or uncompressed .drawio content is supported.");
}

function collectAttributes(raw: Record<string, unknown>, excludedKeys: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("#") && !excludedKeys.includes(key) && typeof value !== "object" && value !== undefined) {
      attributes[key] = String(value);
    }
  }
  return attributes;
}

function serializeAttributes(attributes: Record<string, string>): string {
  const ordered = Object.entries(attributes);

  if (ordered.length === 0) {
    return "";
  }

  return ` ${ordered.map(([key, value]) => `${key}="${escapeXmlAttribute(value)}"`).join(" ")}`;
}

function isClassCell(cell: MxGraphCell): boolean {
  return cell.attributes.vertex === "1" && cell.attributes.parent === "1" && (cell.attributes.style ?? "").startsWith("swimlane");
}

function requireGeometry(cell: MxGraphCell): MxGeometry {
  if (!cell.geometry) {
    throw new Error(`Cell ${cell.id} is missing mxGeometry.`);
  }
  return cell.geometry;
}

function ensureGeometry(cell: MxGraphCell): MxGeometry {
  if (!cell.geometry) {
    cell.geometry = {
      attributes: { as: "geometry" },
      waypoints: []
    };
  }
  return cell.geometry;
}

function updateCell(model: MxGraphModel, cellId: string, updater: (cell: MxGraphCell) => void): MxGraphModel {
  const next = cloneMxGraphModel(model);
  const cell = next.cells.find((candidate) => candidate.id === cellId);

  if (!cell) {
    throw new Error(`mxCell ${cellId} was not found.`);
  }

  updater(cell);
  return next;
}

function cloneMxGraphModel(model: MxGraphModel): MxGraphModel {
  return {
    attributes: { ...model.attributes },
    cells: model.cells.map((cell) => ({
      id: cell.id,
      attributes: { ...cell.attributes },
      geometry: cell.geometry
        ? {
            attributes: { ...cell.geometry.attributes },
            waypoints: cell.geometry.waypoints.map((point) => ({ ...point }))
          }
        : undefined
    }))
  };
}

function extractGroups(model: MxGraphModel, classes: MxLayoutClass[]): MxLayoutGroup[] {
  const frameGroups = model.cells
    .filter((cell) => cell.attributes.vertex === "1" && cell.attributes.parent === "1" && cell.id.startsWith("group_frame_"))
    .map((cell): MxLayoutGroup => {
      const geometry = requireGeometry(cell);
      const group = {
        id: cell.id,
        label: cell.attributes.value ?? cell.id,
        x: readNumber(geometry.attributes.x, 0),
        y: readNumber(geometry.attributes.y, 0),
        width: readNumber(geometry.attributes.width, 0),
        height: readNumber(geometry.attributes.height, 0),
        classIds: [] as string[]
      };

      group.classIds = classes
        .filter((classCell) => isInside(group, classCell))
        .map((classCell) => classCell.id);
      return group;
    });

  if (frameGroups.length > 0) {
    return frameGroups;
  }

  const byStereotype = new Map<string, MxLayoutClass[]>();
  for (const classCell of classes) {
    const key = classCell.stereotype ?? "Ungrouped";
    byStereotype.set(key, [...(byStereotype.get(key) ?? []), classCell]);
  }

  return [...byStereotype.entries()].map(([label, members], index) => {
    const x = Math.min(...members.map((member) => member.x));
    const y = Math.min(...members.map((member) => member.y));
    const right = Math.max(...members.map((member) => member.x + member.width));
    const bottom = Math.max(...members.map((member) => member.y + member.height));

    return {
      id: `group_${index}_${sanitizeId(label)}`,
      label,
      x,
      y,
      width: right - x,
      height: bottom - y,
      classIds: members.map((member) => member.id)
    };
  });
}

function parseClassHeader(value: string): { label: string; stereotype?: string } {
  let text = value.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeXmlText(text);

  const lines = text.split(/\r?\n|&#xa;/).map((line) => line.trim()).filter(Boolean);
  const stereotypeMatch = lines[0]?.match(/^<<(.+)>>$/);

  if (stereotypeMatch) {
    return {
      stereotype: stereotypeMatch[1],
      label: lines[1] ?? ""
    };
  }

  return {
    label: lines[0] ?? text
  };
}

function parseStyle(style: string): Map<string, string> {
  const entries = style.split(";").filter(Boolean).map((part): [string, string] => {
    const separator = part.indexOf("=");
    return separator >= 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
  });

  return new Map(entries);
}

function serializeStyle(style: Map<string, string>): string {
  return [...style.entries()].map(([key, value]) => (value === "" ? key : `${key}=${value}`)).join(";");
}

function classifyEdge(style: Map<string, string>): MxLayoutEdgeKind {
  const startMarker = markerFromStyle(style, "start");
  const endMarker = markerFromStyle(style, "end");
  const dashed = style.get("dashed") === "1";

  if (startMarker === "block" || endMarker === "block") {
    return dashed ? "realization" : "inheritance";
  }

  if (startMarker === "diamondFilled" || endMarker === "diamondFilled") {
    return "composition";
  }

  if (startMarker === "diamondOpen" || endMarker === "diamondOpen") {
    return "aggregation";
  }

  if (startMarker === "open" || endMarker === "open") {
    return dashed ? "dependency" : "directedAssociation";
  }

  if (dashed) {
    return "dashedAssociation";
  }

  return "association";
}

function markerFromStyle(style: Map<string, string>, endpoint: "start" | "end"): MxLayoutEdgeMarker {
  const arrow = style.get(`${endpoint}Arrow`);
  const fill = style.get(`${endpoint}Fill`);

  if (!arrow || arrow === "none") {
    return "none";
  }

  if (arrow === "open") {
    return "open";
  }

  if (arrow === "block") {
    return "block";
  }

  if (arrow === "diamondThin" || arrow === "diamond") {
    return fill === "1" ? "diamondFilled" : "diamondOpen";
  }

  return "none";
}

function anchorFromStyle(style: Map<string, string>, prefix: "exit" | "entry"): MxAnchor | undefined {
  const x = style.get(`${prefix}X`);
  const y = style.get(`${prefix}Y`);

  if (x === undefined || y === undefined) {
    return undefined;
  }

  return anchorFromRelativePoint(readNumber(x, 0.5), readNumber(y, 0.5));
}

function writeAnchorToStyle(styleText: string, prefix: "exit" | "entry", anchor: MxAnchor): string {
  const style = parseStyle(styleText);
  const point = anchorToRelativePoint(anchor);
  style.set(`${prefix}X`, formatNumber(point.x));
  style.set(`${prefix}Y`, formatNumber(point.y));
  style.set(`${prefix}Dx`, "0");
  style.set(`${prefix}Dy`, "0");
  style.set(`${prefix}Perimeter`, "0");
  return serializeStyle(style);
}

function anchorFromRelativePoint(x: number, y: number): MxAnchor {
  if (y <= 0) {
    return { side: "top", ratio: clamp(x, 0, 1) };
  }

  if (x >= 1) {
    return { side: "right", ratio: clamp(y, 0, 1) };
  }

  if (y >= 1) {
    return { side: "bottom", ratio: clamp(x, 0, 1) };
  }

  return { side: "left", ratio: clamp(y, 0, 1) };
}

function anchorToRelativePoint(anchor: MxAnchor): MxPoint {
  if (anchor.side === "top") {
    return { x: anchor.ratio, y: 0 };
  }

  if (anchor.side === "right") {
    return { x: 1, y: anchor.ratio };
  }

  if (anchor.side === "bottom") {
    return { x: anchor.ratio, y: 1 };
  }

  return { x: 0, y: anchor.ratio };
}

function resolveClassEndpoint(endpoint: string | undefined, parentByChildId: Map<string, string | undefined>): string | undefined {
  if (!endpoint) {
    return undefined;
  }

  let current = endpoint;
  const visited = new Set<string>();

  while (parentByChildId.has(current) && !visited.has(current)) {
    visited.add(current);
    const parent = parentByChildId.get(current);
    if (!parent || parent === "1" || parent === "0") {
      break;
    }
    current = parent;
  }

  return current;
}

function validateDuplicateAnchors(edges: MxLayoutEdge[]): MxGraphDiagnostic[] {
  const diagnostics: MxGraphDiagnostic[] = [];
  const seen = new Map<string, string>();

  for (const edge of edges) {
    for (const endpoint of ["source", "target"] as const) {
      const classId = endpoint === "source" ? edge.sourceId : edge.targetId;
      const anchor = endpoint === "source" ? edge.sourceAnchor : edge.targetAnchor;
      if (!classId || !anchor) {
        continue;
      }

      const key = `${classId}:${anchor.side}:${anchor.ratio.toFixed(3)}`;
      const previous = seen.get(key);
      if (previous) {
        diagnostics.push({
          severity: "warning",
          cellId: edge.id,
          message: `Edge ${edge.id} shares the ${anchor.side} anchor on ${classId} with ${previous}.`
        });
      } else {
        seen.set(key, edge.id);
      }
    }
  }

  return diagnostics;
}

function validateOrthogonalEdges(edges: MxLayoutEdge[]): MxGraphDiagnostic[] {
  const diagnostics: MxGraphDiagnostic[] = [];

  for (const edge of edges) {
    for (let index = 1; index < edge.waypoints.length; index += 1) {
      const previous = edge.waypoints[index - 1];
      const current = edge.waypoints[index];
      if (previous.x !== current.x && previous.y !== current.y) {
        diagnostics.push({
          severity: "warning",
          cellId: edge.id,
          message: `Edge ${edge.id} has a diagonal waypoint segment.`
        });
        break;
      }
    }
  }

  return diagnostics;
}

function validateClassOverlaps(classes: MxLayoutClass[]): MxGraphDiagnostic[] {
  const diagnostics: MxGraphDiagnostic[] = [];

  for (let firstIndex = 0; firstIndex < classes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < classes.length; secondIndex += 1) {
      if (rectanglesOverlap(classes[firstIndex], classes[secondIndex])) {
        diagnostics.push({
          severity: "warning",
          cellId: classes[firstIndex].id,
          message: `Class ${classes[firstIndex].label} overlaps ${classes[secondIndex].label}.`
        });
      }
    }
  }

  return diagnostics;
}

function validateGroupOverlaps(groups: MxLayoutGroup[]): MxGraphDiagnostic[] {
  const diagnostics: MxGraphDiagnostic[] = [];

  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < groups.length; secondIndex += 1) {
      if (rectanglesOverlap(groups[firstIndex], groups[secondIndex])) {
        diagnostics.push({
          severity: "warning",
          cellId: groups[firstIndex].id,
          message: `Group ${groups[firstIndex].label} overlaps ${groups[secondIndex].label}.`
        });
      }
    }
  }

  return diagnostics;
}

function validateClassesOutsideGroups(groups: MxLayoutGroup[], classes: MxLayoutClass[]): MxGraphDiagnostic[] {
  if (groups.length === 0 || groups.every((group) => group.id.startsWith("group_"))) {
    return [];
  }

  const diagnostics: MxGraphDiagnostic[] = [];

  for (const group of groups) {
    for (const classId of group.classIds) {
      const classCell = classes.find((candidate) => candidate.id === classId);
      if (classCell && !isInside(group, classCell)) {
        diagnostics.push({
          severity: "warning",
          cellId: classCell.id,
          message: `Class ${classCell.label} is outside group ${group.label}.`
        });
      }
    }
  }

  return diagnostics;
}

function validateEdgeClassHits(edges: MxLayoutEdge[], classes: MxLayoutClass[]): MxGraphDiagnostic[] {
  const diagnostics: MxGraphDiagnostic[] = [];

  for (const edge of edges) {
    const points = edge.waypoints;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      for (const classCell of classes) {
        if (classCell.id === edge.sourceId || classCell.id === edge.targetId) {
          continue;
        }

        if (segmentHitsRect(start, end, classCell)) {
          diagnostics.push({
            severity: "warning",
            cellId: edge.id,
            message: `Edge ${edge.id} crosses class ${classCell.label}.`
          });
        }
      }
    }
  }

  return diagnostics;
}

function calculateBounds(classes: MxLayoutClass[], groups: MxLayoutGroup[]): { width: number; height: number } {
  return {
    width: Math.max(1169, ...classes.map((classCell) => classCell.x + classCell.width + 80), ...groups.map((group) => group.x + group.width + 80)),
    height: Math.max(900, ...classes.map((classCell) => classCell.y + classCell.height + 80), ...groups.map((group) => group.y + group.height + 80))
  };
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): boolean {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function isInside(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function segmentHitsRect(start: MxPoint, end: MxPoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  if (start.x === end.x) {
    return start.x > rect.x && start.x < rect.x + rect.width && rangesOverlap(start.y, end.y, rect.y, rect.y + rect.height);
  }

  if (start.y === end.y) {
    return start.y > rect.y && start.y < rect.y + rect.height && rangesOverlap(start.x, end.x, rect.x, rect.x + rect.width);
  }

  return false;
}

function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  const firstMin = Math.min(a, b);
  const firstMax = Math.max(a, b);
  const secondMin = Math.min(c, d);
  const secondMax = Math.max(c, d);
  return firstMin < secondMax && firstMax > secondMin;
}

function buildParentByChildId(cells: MxGraphCell[]): Map<string, string> {
  const parentByChildId = new Map<string, string>();
  for (const cell of cells) {
    const parent = cell.attributes.parent;
    if (parent) {
      parentByChildId.set(cell.id, parent);
    }
  }
  return parentByChildId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r?\n/g, "&#xa;");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_:-]/g, "_");
}
