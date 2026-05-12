import type { DiagramDocument, DiagramLayoutScore } from "../../../packages/core/src/index.js";
import {
  extractLayoutViewModel,
  parseMxGraphModelXml,
  serializeMxGraphModel,
  toMxGraphModelXml,
  type MxAnchor,
  type MxGraphModel,
  type MxLayoutClass,
  type MxLayoutEdge,
  type MxLayoutGroup,
  type MxPoint,
  type MxLayoutViewModel
} from "../../../packages/drawio/src/index.js";
import {
  applyStereotypeGridLayout,
  createStereotypeLayoutIntent,
  normalizeStereotypeLayoutIntent
} from "../../../packages/layout/src/index.js";
import type {
  StereotypeLayoutIntent,
  StereotypeLayoutIntentGroup
} from "../../../packages/layout/src/index.js";
import { parseMermaidClassDiagram } from "../../../packages/parsers/src/index.js";

export type {
  StereotypeLayoutIntent,
  StereotypeLayoutIntentGroup
} from "../../../packages/layout/src/index.js";

export type RunWebPipelineOptions = {
  source: string;
  intent?: StereotypeLayoutIntent;
  groupFrames?: boolean;
};

export type WebPipelineResult = {
  parsed: DiagramDocument;
  intent: StereotypeLayoutIntent;
  diagram: DiagramDocument;
  mxGraph: MxGraphModel;
  layoutView: MxLayoutViewModel;
  xml: string;
};

export type WebPipelineMetadata = Pick<WebPipelineResult, "parsed" | "intent">;

export type MxGraphImportResult = {
  mxGraph: MxGraphModel;
  layoutView: MxLayoutViewModel;
  score: DiagramLayoutScore;
  xml: string;
};

export function runWebPipeline(options: RunWebPipelineOptions): WebPipelineResult {
  const parsed = parseMermaidClassDiagram(options.source);

  if (parsed.nodes.length === 0) {
    throw new Error("No class nodes were parsed from the input.");
  }

  const intent = options.intent ? normalizeStereotypeLayoutIntent(options.intent) : undefined;
  const diagram = applyStereotypeGridLayout(parsed, intent ? { intent } : undefined);
  const activeIntent = intent ?? createIntentFromSelectedLayout(diagram);
  const xml = toMxGraphModelXml(diagram, { groupFrames: options.groupFrames ?? false });
  const mxGraph = parseMxGraphModelXml(xml);
  const layoutView = extractLayoutViewModel(mxGraph);

  return {
    parsed,
    intent: activeIntent,
    diagram,
    mxGraph,
    layoutView,
    xml
  };
}

export function readWebPipelineMetadata(options: Pick<RunWebPipelineOptions, "source" | "intent">): WebPipelineMetadata {
  const parsed = parseMermaidClassDiagram(options.source);

  if (parsed.nodes.length === 0) {
    throw new Error("No class nodes were parsed from the input.");
  }

  return {
    parsed,
    intent: options.intent
      ? normalizeStereotypeLayoutIntent(options.intent)
      : createStereotypeLayoutIntent(parsed)
  };
}

function createIntentFromSelectedLayout(diagram: DiagramDocument): StereotypeLayoutIntent {
  const groups = diagram.groups;

  if (!groups || groups.some((group) => !group.layoutIntent)) {
    return createStereotypeLayoutIntent(diagram);
  }

  const columns = diagram.layout?.grid.columns ?? Math.max(1, ...groups.map((group) => group.layoutIntent!.gridX + group.layoutIntent!.gridWidth));
  const rows = diagram.layout?.grid.rows ?? Math.max(1, ...groups.map((group) => group.layoutIntent!.gridY + group.layoutIntent!.gridHeight));

  return {
    version: 1,
    grid: {
      columns,
      rows
    },
    groups: groups.map((group): StereotypeLayoutIntentGroup => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      gridX: group.layoutIntent!.gridX,
      gridY: group.layoutIntent!.gridY,
      gridWidth: group.layoutIntent!.gridWidth,
      gridHeight: group.layoutIntent!.gridHeight,
      packing: group.layoutIntent!.packing,
      nodeIds: [...group.nodeIds]
    }))
  };
}

export function runMxGraphImport(xml: string): MxGraphImportResult {
  const mxGraph = parseMxGraphModelXml(xml);
  const layoutView = extractLayoutViewModel(mxGraph);
  return {
    mxGraph,
    layoutView,
    score: scoreMxLayoutView(layoutView),
    xml: serializeMxGraphModel(mxGraph)
  };
}

export function serializeMxGraphState(mxGraph: MxGraphModel): MxGraphImportResult {
  const layoutView = extractLayoutViewModel(mxGraph);
  return {
    mxGraph,
    layoutView,
    score: scoreMxLayoutView(layoutView),
    xml: serializeMxGraphModel(mxGraph)
  };
}

const scoreWeights = {
  edgeNodeHits: 1000000000,
  nodeOverlaps: 1000000000,
  groupOverlaps: 1000000000,
  edgeCrossings: 250000000,
  segmentOverlaps: 100000000,
  duplicateAnchors: 10000000,
  edgeBends: 1000,
  edgeLength: 0.1,
  compactWidth: 250,
  compactHeight: 25,
  compactArea: 0.0001
};

function scoreMxLayoutView(layoutView: MxLayoutViewModel): DiagramLayoutScore {
  const edgePaths = layoutView.edges
    .map((edge) => edgePath(edge, layoutView.classes))
    .filter((path): path is { edge: MxLayoutEdge; points: MxPoint[] } => Boolean(path));
  const nodeOverlaps = countRectangleOverlaps(layoutView.classes);
  const groupOverlaps = countRectangleOverlaps(layoutView.groups);
  const edgeNodeHits = countEdgeNodeHits(edgePaths, layoutView.classes);
  const segmentOverlaps = countSegmentOverlaps(edgePaths);
  const edgeCrossings = countEdgeCrossings(edgePaths);
  const edgeBends = edgePaths.reduce((total, path) => total + countBends(path.points), 0);
  const duplicateAnchors = countDuplicateAnchors(layoutView.edges);
  const totalEdgeLength = edgePaths.reduce((total, path) => total + pathLength(path.points), 0);
  const layoutWidth = layoutView.bounds.width;
  const layoutHeight = layoutView.bounds.height;
  const layoutArea = layoutWidth * layoutHeight;
  const value =
    edgeNodeHits * scoreWeights.edgeNodeHits +
    nodeOverlaps * scoreWeights.nodeOverlaps +
    groupOverlaps * scoreWeights.groupOverlaps +
    edgeCrossings * scoreWeights.edgeCrossings +
    segmentOverlaps * scoreWeights.segmentOverlaps +
    duplicateAnchors * scoreWeights.duplicateAnchors +
    edgeBends * scoreWeights.edgeBends +
    totalEdgeLength * scoreWeights.edgeLength +
    layoutWidth * scoreWeights.compactWidth +
    layoutHeight * scoreWeights.compactHeight +
    layoutArea * scoreWeights.compactArea;

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
    layoutWidth,
    layoutHeight,
    layoutArea
  };
}

function edgePath(edge: MxLayoutEdge, classes: MxLayoutClass[]): { edge: MxLayoutEdge; points: MxPoint[] } | undefined {
  const source = classes.find((classCell) => classCell.id === edge.sourceId);
  const target = classes.find((classCell) => classCell.id === edge.targetId);
  if (!source || !target) {
    return undefined;
  }

  return {
    edge,
    points: [
      anchorPoint(source, edge.sourceAnchor),
      ...edge.waypoints,
      anchorPoint(target, edge.targetAnchor)
    ]
  };
}

function anchorPoint(classCell: MxLayoutClass, anchor: MxAnchor | undefined): MxPoint {
  if (!anchor) {
    return {
      x: classCell.x + classCell.width / 2,
      y: classCell.y + classCell.height / 2
    };
  }

  if (anchor.side === "top") {
    return { x: classCell.x + classCell.width * anchor.ratio, y: classCell.y };
  }

  if (anchor.side === "right") {
    return { x: classCell.x + classCell.width, y: classCell.y + classCell.height * anchor.ratio };
  }

  if (anchor.side === "bottom") {
    return { x: classCell.x + classCell.width * anchor.ratio, y: classCell.y + classCell.height };
  }

  return { x: classCell.x, y: classCell.y + classCell.height * anchor.ratio };
}

function countRectangleOverlaps(rectangles: Array<MxLayoutClass | MxLayoutGroup>): number {
  let overlaps = 0;

  for (let firstIndex = 0; firstIndex < rectangles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < rectangles.length; secondIndex += 1) {
      if (rectanglesOverlap(rectangles[firstIndex], rectangles[secondIndex])) {
        overlaps += 1;
      }
    }
  }

  return overlaps;
}

function countEdgeNodeHits(edgePaths: Array<{ edge: MxLayoutEdge; points: MxPoint[] }>, classes: MxLayoutClass[]): number {
  let hits = 0;

  for (const edgePathItem of edgePaths) {
    const segments = pathSegments(edgePathItem.points);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const [start, end] = segments[segmentIndex];
      for (const classCell of classes) {
        if (isAllowedEndpointSegment(edgePathItem.edge, classCell.id, [start, end], segmentIndex, segments.length)) {
          continue;
        }

        if (segmentIntersectsRectangle(start, end, classCell)) {
          hits += 1;
        }
      }
    }
  }

  return hits;
}

function isAllowedEndpointSegment(
  edge: MxLayoutEdge,
  classId: string,
  segment: [MxPoint, MxPoint],
  segmentIndex: number,
  segmentCount: number
): boolean {
  if (classId === edge.sourceId && segmentIndex === 0) {
    return edge.sourceAnchor
      ? endpointSegmentApproachesAnchorFromOutside(segment[0], segment[1], edge.sourceAnchor)
      : true;
  }

  if (classId === edge.targetId && segmentIndex === segmentCount - 1) {
    return edge.targetAnchor
      ? endpointSegmentApproachesAnchorFromOutside(segment[1], segment[0], edge.targetAnchor)
      : true;
  }

  return false;
}

function endpointSegmentApproachesAnchorFromOutside(anchorPointValue: MxPoint, neighbor: MxPoint, anchor: MxAnchor): boolean {
  return endpointApproachIsPerpendicular(anchorPointValue, neighbor, anchor) &&
    pointIsOutsideAnchorSide(anchorPointValue, neighbor, anchor);
}

function endpointApproachIsPerpendicular(anchorPointValue: MxPoint, neighbor: MxPoint, anchor: MxAnchor): boolean {
  return anchor.side === "top" || anchor.side === "bottom"
    ? anchorPointValue.x === neighbor.x
    : anchorPointValue.y === neighbor.y;
}

function pointIsOutsideAnchorSide(anchorPointValue: MxPoint, point: MxPoint, anchor: MxAnchor): boolean {
  if (anchor.side === "top") {
    return point.y < anchorPointValue.y;
  }

  if (anchor.side === "bottom") {
    return point.y > anchorPointValue.y;
  }

  if (anchor.side === "left") {
    return point.x < anchorPointValue.x;
  }

  return point.x > anchorPointValue.x;
}

function countSegmentOverlaps(edgePaths: Array<{ points: MxPoint[] }>): number {
  const segments = edgePaths.flatMap((edgePathItem) => pathSegments(edgePathItem.points));
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

function countEdgeCrossings(edgePaths: Array<{ points: MxPoint[] }>): number {
  let crossings = 0;

  for (let leftIndex = 0; leftIndex < edgePaths.length; leftIndex += 1) {
    const leftSegments = pathSegments(edgePaths[leftIndex].points);
    for (let rightIndex = leftIndex + 1; rightIndex < edgePaths.length; rightIndex += 1) {
      const rightSegments = pathSegments(edgePaths[rightIndex].points);
      for (const [leftStart, leftEnd] of leftSegments) {
        for (const [rightStart, rightEnd] of rightSegments) {
          if (
            !samePoint(leftStart, rightStart) &&
            !samePoint(leftStart, rightEnd) &&
            !samePoint(leftEnd, rightStart) &&
            !samePoint(leftEnd, rightEnd) &&
            !segmentsOverlap(leftStart, leftEnd, rightStart, rightEnd) &&
            segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)
          ) {
            crossings += 1;
          }
        }
      }
    }
  }

  return crossings;
}

function countDuplicateAnchors(edges: MxLayoutEdge[]): number {
  const seen = new Set<string>();
  let duplicates = 0;

  for (const edge of edges) {
    for (const endpoint of ["source", "target"] as const) {
      const classId = endpoint === "source" ? edge.sourceId : edge.targetId;
      const anchor = endpoint === "source" ? edge.sourceAnchor : edge.targetAnchor;
      if (!classId || !anchor) {
        continue;
      }

      const key = `${classId}:${anchor.side}:${anchor.ratio.toFixed(3)}`;
      if (seen.has(key)) {
        duplicates += 1;
      } else {
        seen.add(key);
      }
    }
  }

  return duplicates;
}

function pathLength(points: MxPoint[]): number {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }

  return length;
}

function countBends(points: MxPoint[]): number {
  const axes = pathSegments(compactPoints(points))
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

function segmentAxis(start: MxPoint, end: MxPoint): string | undefined {
  if (samePoint(start, end)) {
    return undefined;
  }

  if (Math.abs(start.y - end.y) < 0.001) {
    return "h";
  }

  if (Math.abs(start.x - end.x) < 0.001) {
    return "v";
  }

  return `d:${Math.sign(end.x - start.x)}:${Math.sign(end.y - start.y)}`;
}

function compactPoints(points: MxPoint[]): MxPoint[] {
  const compacted: MxPoint[] = [];

  for (const point of points) {
    if (compacted.length === 0 || !samePoint(compacted[compacted.length - 1], point)) {
      compacted.push(point);
    }
  }

  return compacted;
}

function pathSegments(points: MxPoint[]): Array<[MxPoint, MxPoint]> {
  const segments: Array<[MxPoint, MxPoint]> = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }

  return segments;
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): boolean {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
}

function segmentIntersectsRectangle(
  start: MxPoint,
  end: MxPoint,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  if (pointInsideRectangle(start, rect) || pointInsideRectangle(end, rect)) {
    return true;
  }

  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.width, y: rect.y };
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bottomLeft = { x: rect.x, y: rect.y + rect.height };

  return segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft);
}

function pointInsideRectangle(point: MxPoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height;
}

function segmentsOverlap(leftStart: MxPoint, leftEnd: MxPoint, rightStart: MxPoint, rightEnd: MxPoint): boolean {
  if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
    return rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y);
  }

  if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
    return rangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x);
  }

  return false;
}

function segmentsIntersect(firstStart: MxPoint, firstEnd: MxPoint, secondStart: MxPoint, secondEnd: MxPoint): boolean {
  const firstMinX = Math.min(firstStart.x, firstEnd.x);
  const firstMaxX = Math.max(firstStart.x, firstEnd.x);
  const firstMinY = Math.min(firstStart.y, firstEnd.y);
  const firstMaxY = Math.max(firstStart.y, firstEnd.y);
  const secondMinX = Math.min(secondStart.x, secondEnd.x);
  const secondMaxX = Math.max(secondStart.x, secondEnd.x);
  const secondMinY = Math.min(secondStart.y, secondEnd.y);
  const secondMaxY = Math.max(secondStart.y, secondEnd.y);

  return firstMinX <= secondMaxX &&
    firstMaxX >= secondMinX &&
    firstMinY <= secondMaxY &&
    firstMaxY >= secondMinY &&
    orientation(firstStart, firstEnd, secondStart) * orientation(firstStart, firstEnd, secondEnd) <= 0 &&
    orientation(secondStart, secondEnd, firstStart) * orientation(secondStart, secondEnd, firstEnd) <= 0;
}

function orientation(a: MxPoint, b: MxPoint, c: MxPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.001) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  const firstMin = Math.min(a, b);
  const firstMax = Math.max(a, b);
  const secondMin = Math.min(c, d);
  const secondMax = Math.max(c, d);
  return firstMin < secondMax && firstMax > secondMin;
}

function samePoint(left: MxPoint, right: MxPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

export function cloneLayoutIntent(intent: StereotypeLayoutIntent): StereotypeLayoutIntent {
  return {
    version: intent.version,
    grid: { ...intent.grid },
    groups: intent.groups.map((group): StereotypeLayoutIntentGroup => ({
      ...group,
      nodeIds: [...group.nodeIds]
    }))
  };
}
