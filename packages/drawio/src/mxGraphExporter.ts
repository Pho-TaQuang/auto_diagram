import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramGroup,
  DiagramNode,
  DiagramNodeLayout,
  DiagramPoint,
  DiagramRoutedEdgeSegment,
  DiagramRoutingDivider
} from "../../core/src/index.js";

const classStyleParts = [
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
  "fontColor=light-dark(#333333,#cccccc)"
];

const textStyle = [
  "text",
  "strokeColor=none",
  "fillColor=none",
  "align=left",
  "verticalAlign=top",
  "spacingLeft=4",
  "spacingRight=4",
  "overflow=hidden",
  "rotatable=0",
  "points=[[0,0.5],[1,0.5]]",
  "portConstraint=eastwest"
].join(";");

const lineStyle = [
  "line",
  "strokeWidth=1",
  "fillColor=none",
  "align=left",
  "verticalAlign=middle",
  "spacingTop=-1",
  "spacingLeft=3",
  "spacingRight=3",
  "rotatable=0",
  "labelPosition=right",
  "points=[]",
  "portConstraint=eastwest",
  "strokeColor=inherit"
].join(";");

const groupFrameStyle = [
  "rounded=0",
  "whiteSpace=wrap",
  "html=1",
  "fillColor=none",
  "strokeColor=light-dark(#999999,#cccccc)",
  "dashed=1",
  "fontStyle=1",
  "fontColor=light-dark(#666666,#cccccc)",
  "align=left",
  "verticalAlign=top",
  "spacingLeft=8",
  "spacingTop=6",
  "connectable=0",
  "collapsible=0",
  "pointerEvents=0"
].join(";");

const routingDividerStyle = [
  "rounded=0",
  "whiteSpace=wrap",
  "html=1",
  "fillColor=light-dark(#666666,#cccccc)",
  "strokeColor=light-dark(#666666,#cccccc)",
  "connectable=1",
  "resizable=0",
  "rotatable=0",
  "autoDiagramRoutingDivider=1"
].join(";");

const edgeEndpointLabelStyleBase = [
  "edgeLabel",
  "resizable=0",
  "labelBackgroundColor=none",
  "fontSize=12"
];

export type DrawioExportOptions = {
  groupFrames?: boolean;
};

type ExportEndpoint = {
  id: string;
  cellId: string;
  layout: DiagramPoint & { width: number; height: number };
  kind: "class" | "divider";
};

type ExportEdgeSpec = {
  edge: DiagramEdge;
  sourceId: string;
  targetId: string;
  label: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceAnchor?: DiagramEdgeAnchor;
  targetAnchor?: DiagramEdgeAnchor;
  waypoints: DiagramPoint[];
  markerPolicy: EdgeMarkerPolicy;
  autoRoute?: boolean;
  v2Routed?: boolean;
};

type EdgeMarkerPolicy = {
  start: boolean;
  end: boolean;
};

export function toMxGraphModelXml(document: DiagramDocument, options: DrawioExportOptions = {}): string {
  const nodeIdByDiagramId = createExportCellIdMap(document.nodes, "node");
  const dividerIdByDiagramId = createExportCellIdMap(document.routingDividers ?? [], "divider");
  const endpointByDiagramId = createExportEndpointMap(document.nodes, document.routingDividers ?? [], nodeIdByDiagramId, dividerIdByDiagramId);
  const bounds = calculateBounds(document.nodes, document.groups ?? [], document.routingDividers ?? []);
  const lines: string[] = [
    `<mxGraphModel dx="${formatNumber(bounds.width)}" dy="${formatNumber(bounds.height)}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1169" pageHeight="1654" math="0" shadow="0">`,
    "  <root>",
    '    <mxCell id="0" />',
    '    <mxCell id="1" parent="0" />'
  ];

  if (options.groupFrames) {
    (document.groups ?? []).forEach((group, index) => {
      lines.push(buildGroupFrameCell(group, createSequentialCellId("group_frame", index)));
    });
  }

  document.nodes.forEach((node) => {
    const nodeCellId = nodeIdByDiagramId.get(node.id);
    if (!nodeCellId) {
      throw new Error(`Cannot export node ${node.id}: missing generated cell id.`);
    }

    lines.push(...buildClassCells(node, nodeCellId));
  });

  (document.routingDividers ?? []).forEach((divider) => {
    const dividerCellId = dividerIdByDiagramId.get(divider.id);
    if (!dividerCellId) {
      throw new Error(`Cannot export routing divider ${divider.id}: missing generated cell id.`);
    }

    lines.push(buildRoutingDividerCell(divider, dividerCellId));
  });

  buildExportEdgeSpecs(document).forEach((edge, index) => {
    lines.push(buildEdgeCell(edge, index + 1, endpointByDiagramId));
  });

  lines.push("  </root>", "</mxGraphModel>", "");
  return lines.join("\n");
}

function buildGroupFrameCell(group: DiagramGroup, groupCellId: string): string {
  const layout = requireGroupLayout(group);

  return [
    `    <mxCell id="${groupCellId}" parent="1" style="${escapeXmlAttribute(groupFrameStyle)}" value="${escapeXmlAttribute(group.label)}" vertex="1">`,
    `      <mxGeometry height="${formatNumber(layout.height)}" width="${formatNumber(layout.width)}" x="${formatNumber(layout.x)}" y="${formatNumber(layout.y)}" as="geometry" />`,
    "    </mxCell>"
  ].join("\n");
}

function buildRoutingDividerCell(divider: DiagramRoutingDivider, dividerCellId: string): string {
  const layout = divider.layout;
  const style = `${routingDividerStyle};orientation=${divider.orientation};side=${divider.side}`;

  return [
    `    <mxCell id="${dividerCellId}" parent="1" style="${escapeXmlAttribute(style)}" vertex="1">`,
    `      <mxGeometry height="${formatNumber(layout.height)}" width="${formatNumber(layout.width)}" x="${formatNumber(layout.x)}" y="${formatNumber(layout.y)}" as="geometry" />`,
    "    </mxCell>"
  ].join("\n");
}

function buildClassCells(node: DiagramNode, nodeCellId: string): string[] {
  const layout = requireLayout(node);
  const labelHtml = escapeHtmlText(node.label);
  const headerValue = node.stereotype
    ? `<b>&lt;&lt;${escapeHtmlText(node.stereotype)}&gt;&gt;</b><br>${labelHtml}`
    : labelHtml;
  const classStyle = buildClassStyle(layout);
  const lines = [
    `    <mxCell id="${nodeCellId}" parent="1" style="${escapeXmlAttribute(classStyle)}" value="${escapeXmlAttribute(headerValue)}" vertex="1">`,
    `      <mxGeometry height="${formatNumber(layout.height)}" width="${formatNumber(layout.width)}" x="${formatNumber(layout.x)}" y="${formatNumber(layout.y)}" as="geometry" />`,
    "    </mxCell>"
  ];

  let childIndex = 1;
  let y = layout.headerHeight;

  for (const attribute of node.attributes) {
    lines.push(buildChildTextCell(nodeCellId, childIndex, attribute.text, layout.width, y, layout.lineHeight));
    childIndex += 1;
    y += layout.lineHeight;
  }

  if (node.attributes.length === 0) {
    y += layout.lineHeight;
  }

  lines.push(buildSeparatorCell(nodeCellId, childIndex, layout.width, y, layout.separatorHeight));
  childIndex += 1;
  y += layout.separatorHeight;

  for (const method of node.methods) {
    lines.push(buildChildTextCell(nodeCellId, childIndex, method.text, layout.width, y, layout.lineHeight));
    childIndex += 1;
    y += layout.lineHeight;
  }

  return lines;
}

function buildClassStyle(layout: DiagramNodeLayout): string {
  return [
    ...classStyleParts.slice(0, 6),
    `startSize=${formatNumber(layout.headerHeight)}`,
    ...classStyleParts.slice(6)
  ].join(";");
}

function buildChildTextCell(
  parentId: string,
  childIndex: number,
  value: string,
  width: number,
  y: number,
  height: number
): string {
  const id = `${parentId}_child_${childIndex}`;
  return [
    `    <mxCell id="${id}" parent="${parentId}" style="${escapeXmlAttribute(textStyle)}" value="${escapeXmlAttribute(value)}" vertex="1">`,
    `      <mxGeometry height="${formatNumber(height)}" width="${formatNumber(width)}" y="${formatNumber(y)}" as="geometry" />`,
    "    </mxCell>"
  ].join("\n");
}

function buildSeparatorCell(
  parentId: string,
  childIndex: number,
  width: number,
  y: number,
  height: number
): string {
  const id = `${parentId}_child_${childIndex}`;
  return [
    `    <mxCell id="${id}" parent="${parentId}" style="${escapeXmlAttribute(lineStyle)}" vertex="1">`,
    `      <mxGeometry height="${formatNumber(height)}" width="${formatNumber(width)}" y="${formatNumber(y)}" as="geometry" />`,
    "    </mxCell>"
  ].join("\n");
}

function buildEdgeCell(
  edgeSpec: ExportEdgeSpec,
  index: number,
  endpointByDiagramId: Map<string, ExportEndpoint>
): string {
  const source = endpointByDiagramId.get(edgeSpec.sourceId);
  const target = endpointByDiagramId.get(edgeSpec.targetId);

  if (!source || !target) {
    throw new Error(`Cannot export edge ${edgeSpec.edge.id}: missing source or target endpoint.`);
  }

  const edgeCellId = `edge_${index}`;
  return [
    `    <mxCell id="${edgeCellId}" edge="1" parent="1" source="${source.cellId}" style="${escapeXmlAttribute(edgeStyle(edgeSpec.edge, edgeSpec, edgeSpec.markerPolicy))}" target="${target.cellId}" value="${escapeXmlAttribute(edgeSpec.label)}">`,
    buildEdgeGeometry(edgeSpec, source, target),
    "    </mxCell>",
    ...buildEndpointMultiplicityCells(edgeCellId, edgeSpec)
  ].join("\n");
}

function buildExportEdgeSpecs(document: DiagramDocument): ExportEdgeSpec[] {
  const dividers = document.routingDividers ?? [];
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const dividerByEdgeId = new Map<string, DiagramRoutingDivider>();
  const claimedEdgeIds = new Set<string>();
  const specs: ExportEdgeSpec[] = [];

  for (const divider of dividers) {
    for (const edgeId of divider.sourceEdgeIds) {
      dividerByEdgeId.set(edgeId, divider);
    }
  }

  for (const edge of document.edges) {
    if (edge.layout?.routeSource === "engine-v2" && edge.layout.routedSegments && edge.layout.routedSegments.length > 0) {
      specs.push(...routedSegmentExportEdgeSpecs(edge, edge.layout.routedSegments));
      continue;
    }

    const divider = dividerByEdgeId.get(edge.id);
    if (!divider || claimedEdgeIds.has(edge.id)) {
      if (!divider) {
        specs.push(directExportEdgeSpec(edge));
      }
      continue;
    }

    const dividerEdges = divider.sourceEdgeIds
      .map((edgeId) => edgeById.get(edgeId))
      .filter((candidate): candidate is DiagramEdge => Boolean(candidate));

    if (dividerEdges.length === 0) {
      continue;
    }

    specs.push(...splitDividerEdgeSpecs(divider, dividerEdges));
    dividerEdges.forEach((dividerEdge) => claimedEdgeIds.add(dividerEdge.id));
  }

  return specs;
}

function directExportEdgeSpec(edge: DiagramEdge): ExportEdgeSpec {
  return {
    edge,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label ?? "",
    sourceMultiplicity: edge.sourceMultiplicity,
    targetMultiplicity: edge.targetMultiplicity,
    sourceAnchor: edge.layout?.sourceAnchor,
    targetAnchor: edge.layout?.targetAnchor,
    waypoints: edge.layout?.waypoints ?? [],
    markerPolicy: { start: true, end: true },
    v2Routed: edge.layout?.routeSource === "engine-v2"
  };
}

function routedSegmentExportEdgeSpecs(edge: DiagramEdge, segments: DiagramRoutedEdgeSegment[]): ExportEdgeSpec[] {
  return segments.map((segment) => ({
    edge,
    sourceId: segment.sourceId,
    targetId: segment.targetId,
    label: segment.label ?? "",
    sourceMultiplicity: segment.sourceMultiplicity,
    targetMultiplicity: segment.targetMultiplicity,
    sourceAnchor: segment.sourceAnchor,
    targetAnchor: segment.targetAnchor,
    waypoints: segment.waypoints,
    markerPolicy: segment.markerPolicy,
    v2Routed: true
  }));
}

function splitDividerEdgeSpecs(divider: DiagramRoutingDivider, edges: DiagramEdge[]): ExportEdgeSpec[] {
  return divider.mode === "fanOut"
    ? fanOutDividerEdgeSpecs(divider, edges)
    : fanInDividerEdgeSpecs(divider, edges);
}

function fanOutDividerEdgeSpecs(divider: DiagramRoutingDivider, edges: DiagramEdge[]): ExportEdgeSpec[] {
  const firstEdge = edges[0];
  const sourceAnchor = sharedClassAnchor(edges, "source") ?? classAnchorTowardDivider(firstEdge, "source", divider);
  const dividerInputAnchor = dividerOuterAnchor(divider);
  const orderedLeaves = orderEdgesForDivider(divider, edges, "target", oppositeSide(divider.side));

  return [
    {
      edge: firstEdge,
      sourceId: firstEdge.sourceId,
      targetId: divider.id,
      label: "",
      sourceMultiplicity: firstEdge.sourceMultiplicity,
      sourceAnchor,
      targetAnchor: dividerInputAnchor,
      waypoints: [],
      markerPolicy: { start: true, end: false },
      autoRoute: true
    },
    ...orderedLeaves.map(({ edge, dividerAnchor }) => {
      const targetAnchor = classAnchorForDividerSide(edge, "target", dividerAnchor.side);
      return {
        edge,
        sourceId: divider.id,
        targetId: edge.targetId,
        label: edge.label ?? "",
        targetMultiplicity: edge.targetMultiplicity,
        sourceAnchor: dividerAnchor,
        targetAnchor,
        waypoints: [],
        markerPolicy: { start: false, end: true },
        autoRoute: true
      };
    })
  ];
}

function fanInDividerEdgeSpecs(divider: DiagramRoutingDivider, edges: DiagramEdge[]): ExportEdgeSpec[] {
  const firstEdge = edges[0];
  const targetAnchor = sharedClassAnchor(edges, "target") ?? classAnchorTowardDivider(firstEdge, "target", divider);
  const dividerOutputAnchor = dividerOuterAnchor(divider);
  const orderedLeaves = orderEdgesForDivider(divider, edges, "source", oppositeSide(divider.side));

  return [
    ...orderedLeaves.map(({ edge, dividerAnchor }) => {
      const sourceAnchor = classAnchorForDividerSide(edge, "source", dividerAnchor.side);
      return {
        edge,
        sourceId: edge.sourceId,
        targetId: divider.id,
        label: edge.label ?? "",
        sourceMultiplicity: edge.sourceMultiplicity,
        sourceAnchor,
        targetAnchor: dividerAnchor,
        waypoints: [],
        markerPolicy: { start: true, end: false },
        autoRoute: true
      };
    }),
    {
      edge: firstEdge,
      sourceId: divider.id,
      targetId: firstEdge.targetId,
      label: "",
      targetMultiplicity: firstEdge.targetMultiplicity,
      sourceAnchor: dividerOutputAnchor,
      targetAnchor,
      waypoints: [],
      markerPolicy: { start: false, end: true },
      autoRoute: true
    }
  ];
}

function orderEdgesForDivider(
  divider: DiagramRoutingDivider,
  edges: DiagramEdge[],
  classEndpoint: "source" | "target",
  dividerSide: DiagramEdgeAnchor["side"]
): Array<{ edge: DiagramEdge; dividerAnchor: DiagramEdgeAnchor }> {
  const sorted = [...edges].sort((left, right) =>
    dividerSortCoordinate(left, classEndpoint) - dividerSortCoordinate(right, classEndpoint) ||
    left.id.localeCompare(right.id)
  );

  return sorted.map((edge, index) => ({
    edge,
    dividerAnchor: {
      side: dividerSide,
      ratio: roundRatio((index + 1) / (sorted.length + 1))
    }
  }));
}

function dividerSortCoordinate(edge: DiagramEdge, classEndpoint: "source" | "target"): number {
  const anchor = classEndpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;
  return anchor?.ratio ?? 0.5;
}

function dividerOuterAnchor(divider: DiagramRoutingDivider): DiagramEdgeAnchor {
  return {
    side: divider.side,
    ratio: 0.5
  };
}

function classAnchorTowardDivider(edge: DiagramEdge, endpoint: "source" | "target", divider: DiagramRoutingDivider): DiagramEdgeAnchor {
  const anchor = endpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;
  if (anchor) {
    return anchor;
  }

  return {
    side: oppositeSide(divider.side),
    ratio: 0.5
  };
}

function classAnchorForDividerSide(edge: DiagramEdge, endpoint: "source" | "target", dividerSide: DiagramEdgeAnchor["side"]): DiagramEdgeAnchor {
  const desiredSide = oppositeSide(dividerSide);
  const existing = endpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor;

  return {
    side: desiredSide,
    ratio: existing?.side === desiredSide ? existing.ratio : stableAnchorRatio(edge.id)
  };
}

function stableAnchorRatio(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 700;
  }

  return roundRatio(0.15 + hash / 1000);
}

function sharedClassAnchor(edges: DiagramEdge[], endpoint: "source" | "target"): DiagramEdgeAnchor | undefined {
  const anchors = edges
    .map((edge) => endpoint === "source" ? edge.layout?.sourceAnchor : edge.layout?.targetAnchor)
    .filter((anchor): anchor is DiagramEdgeAnchor => Boolean(anchor));

  if (anchors.length === 0) {
    return undefined;
  }

  const side = anchors[0].side;
  if (!anchors.every((anchor) => anchor.side === side)) {
    return anchors[0];
  }

  return {
    side,
    ratio: 0.5
  };
}

function simpleSplitWaypoints(
  source: ExportEndpoint,
  target: ExportEndpoint,
  sourceAnchor: DiagramEdgeAnchor | undefined,
  targetAnchor: DiagramEdgeAnchor | undefined
): DiagramPoint[] {
  if (!sourceAnchor || !targetAnchor) {
    return [];
  }

  const sourcePoint = edgeAnchorPoint(source.layout, sourceAnchor);
  const targetPoint = edgeAnchorPoint(target.layout, targetAnchor);
  const sourcePort = outsidePort(sourcePoint, sourceAnchor);
  const targetPort = outsidePort(targetPoint, targetAnchor);
  const points = sourceAnchor.side === "north" || sourceAnchor.side === "south"
    ? [sourcePoint, sourcePort, { x: targetPort.x, y: sourcePort.y }, targetPort, targetPoint]
    : [sourcePoint, sourcePort, { x: sourcePort.x, y: targetPort.y }, targetPort, targetPoint];

  return compactOrthogonalPoints(points).slice(1, -1);
}

function buildEndpointMultiplicityCells(parentEdgeId: string, edgeSpec: ExportEdgeSpec): string[] {
  const cells: string[] = [];

  if (edgeSpec.sourceMultiplicity) {
    cells.push(buildEndpointMultiplicityCell(
      parentEdgeId,
      "source",
      edgeSpec.sourceMultiplicity,
      edgeSpec.sourceAnchor
    ));
  }

  if (edgeSpec.targetMultiplicity) {
    cells.push(buildEndpointMultiplicityCell(
      parentEdgeId,
      "target",
      edgeSpec.targetMultiplicity,
      edgeSpec.targetAnchor
    ));
  }

  return cells;
}

function buildEndpointMultiplicityCell(
  parentEdgeId: string,
  endpoint: "source" | "target",
  value: string,
  anchor: DiagramEdgeAnchor | undefined
): string {
  const id = `${parentEdgeId}_${endpoint}_multiplicity`;
  const relativeX = endpoint === "source" ? -1 : 1;
  const offset = multiplicityOffset(anchor, endpoint);

  return [
    `    <mxCell id="${id}" parent="${parentEdgeId}" style="${escapeXmlAttribute(edgeEndpointLabelStyle(endpoint, anchor))}" value="${escapeXmlAttribute(value)}" vertex="1">`,
    `      <mxGeometry relative="1" x="${relativeX}" as="geometry">`,
    `        <mxPoint x="${formatNumber(offset.x)}" y="${formatNumber(offset.y)}" as="offset" />`,
    "      </mxGeometry>",
    "    </mxCell>"
  ].join("\n");
}

function edgeEndpointLabelStyle(endpoint: "source" | "target", anchor: DiagramEdgeAnchor | undefined): string {
  const horizontalSide = anchor?.side === "east" || anchor?.side === "west";
  const align = horizontalSide
    ? anchor?.side === "west" ? "right" : "left"
    : endpoint === "source" ? "left" : "right";
  const verticalAlign = anchor?.side === "north"
    ? "bottom"
    : anchor?.side === "south"
    ? "top"
    : endpoint === "source" ? "bottom" : "top";

  return [
    ...edgeEndpointLabelStyleBase,
    `align=${align}`,
    `verticalAlign=${verticalAlign}`
  ].join(";");
}

function multiplicityOffset(anchor: DiagramEdgeAnchor | undefined, endpoint: "source" | "target"): DiagramPoint {
  const nodeGap = 12;
  const routeGap = 18;
  const routeSide = endpoint === "source" ? -routeGap : routeGap;

  if (!anchor) {
    return endpoint === "source" ? { x: -nodeGap, y: -routeGap } : { x: nodeGap, y: routeGap };
  }

  if (anchor.side === "north") {
    return { x: routeSide, y: -nodeGap };
  }

  if (anchor.side === "south") {
    return { x: routeSide, y: nodeGap };
  }

  if (anchor.side === "west") {
    return { x: -nodeGap, y: routeSide };
  }

  return { x: nodeGap, y: routeSide };
}

function buildEdgeGeometry(edgeSpec: ExportEdgeSpec, source: ExportEndpoint, target: ExportEndpoint): string {
  const routedEdgeSpec = edgeSpec.autoRoute
    ? {
      ...edgeSpec,
      waypoints: simpleSplitWaypoints(source, target, edgeSpec.sourceAnchor, edgeSpec.targetAnchor)
    }
    : edgeSpec;
  const waypoints = exportWaypoints(routedEdgeSpec, source, target);

  if (waypoints.length === 0) {
    return [
      '      <mxGeometry relative="1" as="geometry">',
      '        <Array as="points" />',
      "      </mxGeometry>"
    ].join("\n");
  }

  return [
    '      <mxGeometry relative="1" as="geometry">',
    '        <Array as="points">',
    ...waypoints.map((point) => buildWaypointCell(point)),
    "        </Array>",
    "      </mxGeometry>"
  ].join("\n");
}

function buildWaypointCell(point: DiagramPoint): string {
  return `          <mxPoint x="${formatNumber(point.x)}" y="${formatNumber(point.y)}" />`;
}

function exportWaypoints(edgeSpec: ExportEdgeSpec, source: ExportEndpoint, target: ExportEndpoint): DiagramPoint[] {
  const waypoints = edgeSpec.waypoints;
  const sourcePoint = edgeSpec.sourceAnchor
    ? edgeAnchorPoint(source.layout, edgeSpec.sourceAnchor)
    : undefined;
  const targetPoint = edgeSpec.targetAnchor
    ? edgeAnchorPoint(target.layout, edgeSpec.targetAnchor)
    : undefined;
  const cleaned: DiagramPoint[] = [];

  for (const waypoint of waypoints) {
    if (sourcePoint && pointsEqual(waypoint, sourcePoint)) {
      continue;
    }

    if (targetPoint && pointsEqual(waypoint, targetPoint)) {
      continue;
    }

    if (cleaned.length > 0 && pointsEqual(cleaned[cleaned.length - 1], waypoint)) {
      continue;
    }

    cleaned.push(waypoint);
  }

  return cleaned;
}

function edgeAnchorPoint(layout: DiagramPoint & { width: number; height: number }, anchor: DiagramEdgeAnchor): DiagramPoint {
  if (anchor.side === "north") {
    return { x: layout.x + layout.width * anchor.ratio, y: layout.y };
  }

  if (anchor.side === "south") {
    return { x: layout.x + layout.width * anchor.ratio, y: layout.y + layout.height };
  }

  if (anchor.side === "west") {
    return { x: layout.x, y: layout.y + layout.height * anchor.ratio };
  }

  return { x: layout.x + layout.width, y: layout.y + layout.height * anchor.ratio };
}

function outsidePort(point: DiagramPoint, anchor: DiagramEdgeAnchor): DiagramPoint {
  const distance = 24;

  if (anchor.side === "north") {
    return { x: point.x, y: point.y - distance };
  }

  if (anchor.side === "south") {
    return { x: point.x, y: point.y + distance };
  }

  if (anchor.side === "west") {
    return { x: point.x - distance, y: point.y };
  }

  return { x: point.x + distance, y: point.y };
}

function compactOrthogonalPoints(points: DiagramPoint[]): DiagramPoint[] {
  const withoutDuplicates = removeDuplicateConsecutivePoints(points);
  return withoutDuplicates.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) {
      return true;
    }

    const previous = all[index - 1];
    const next = all[index + 1];
    return !(
      (previous.x === point.x && point.x === next.x) ||
      (previous.y === point.y && point.y === next.y)
    );
  });
}

function removeDuplicateConsecutivePoints(points: DiagramPoint[]): DiagramPoint[] {
  const cleaned: DiagramPoint[] = [];

  for (const point of points) {
    if (cleaned.length === 0 || !pointsEqual(cleaned[cleaned.length - 1], point)) {
      cleaned.push(point);
    }
  }

  return cleaned;
}

function oppositeSide(side: DiagramEdgeAnchor["side"]): DiagramEdgeAnchor["side"] {
  if (side === "north") {
    return "south";
  }

  if (side === "south") {
    return "north";
  }

  if (side === "west") {
    return "east";
  }

  return "west";
}

function roundRatio(value: number): number {
  return Number(value.toFixed(3));
}

function centerOf(rectangle: { x: number; y: number; width: number; height: number }): DiagramPoint {
  return {
    x: rectangle.x + rectangle.width / 2,
    y: rectangle.y + rectangle.height / 2
  };
}

function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function edgeStyle(edge: DiagramEdge, edgeSpec: ExportEdgeSpec, markerPolicy: EdgeMarkerPolicy = { start: true, end: true }): string {
  const semanticStyle = edgeSemanticStyle(edge, markerPolicy);
  const anchorStyle = [
    ...anchorStyleParts("exit", edgeSpec.sourceAnchor),
    ...anchorStyleParts("entry", edgeSpec.targetAnchor)
  ];

  return [
    "curved=0",
    ...semanticStyle,
    ...anchorStyle,
    "rounded=0",
    "edgeStyle=orthogonalEdgeStyle",
    "orthogonalLoop=1",
    ...(edgeSpec.v2Routed ? [] : ["jettySize=auto"]),
    "html=1"
  ].join(";");
}

function edgeSemanticStyle(edge: DiagramEdge, markerPolicy: EdgeMarkerPolicy): string[] {
  const parts = baseEdgeSemanticStyle(edge);

  if (markerPolicy.start && markerPolicy.end) {
    return parts;
  }

  const strippedStart = markerPolicy.start ? parts : stripMarkerParts(parts, "start");
  const stripped = markerPolicy.end ? strippedStart : stripMarkerParts(strippedStart, "end");

  return [
    ...stripped,
    ...(markerPolicy.start ? [] : ["startArrow=none"]),
    ...(markerPolicy.end ? [] : ["endArrow=none"])
  ];
}

function stripMarkerParts(parts: string[], endpoint: "start" | "end"): string[] {
  return parts.filter((part) => !part.startsWith(`${endpoint}Arrow=`) && !part.startsWith(`${endpoint}Fill=`) && !part.startsWith(`${endpoint}Size=`));
}

function baseEdgeSemanticStyle(edge: DiagramEdge): string[] {
  switch (edge.operator) {
    case "--":
      return ["startArrow=none", "endArrow=none"];
    case "..":
      return ["dashed=1", "startArrow=none", "endArrow=none"];
    case "-->":
      return ["startArrow=none", "endArrow=open", "endFill=0", "endSize=12"];
    case "<--":
      return ["startArrow=open", "startFill=0", "startSize=12", "endArrow=none"];
    case "..>":
      return ["dashed=1", "startArrow=none", "endArrow=open", "endFill=0", "endSize=12"];
    case "<..":
      return ["dashed=1", "startArrow=open", "startFill=0", "startSize=12", "endArrow=none"];
    case "<|--":
      return ["startArrow=block", "startSize=16", "startFill=0", "endArrow=none"];
    case "--|>":
      return ["startArrow=none", "endArrow=block", "endSize=16", "endFill=0"];
    case "<|..":
      return ["dashed=1", "startArrow=block", "startSize=16", "startFill=0", "endArrow=none"];
    case "..|>":
      return ["dashed=1", "startArrow=none", "endArrow=block", "endSize=16", "endFill=0"];
    case "o--":
      return ["startArrow=diamondThin", "startFill=0", "startSize=14", "endArrow=none"];
    case "--o":
      return ["startArrow=none", "endArrow=diamondThin", "endFill=0", "endSize=14"];
    case "*--":
      return ["startArrow=diamondThin", "startFill=1", "startSize=14", "endArrow=none"];
    case "--*":
      return ["startArrow=none", "endArrow=diamondThin", "endFill=1", "endSize=14"];
  }
}

function anchorStyleParts(prefix: "exit" | "entry", anchor: DiagramEdgeAnchor | undefined): string[] {
  if (!anchor) {
    return [];
  }

  const point = anchorToRelativePoint(anchor);
  return [
    `${prefix}X=${formatNumber(point.x)}`,
    `${prefix}Y=${formatNumber(point.y)}`,
    `${prefix}Dx=0`,
    `${prefix}Dy=0`,
    `${prefix}Perimeter=0`
  ];
}

function anchorToRelativePoint(anchor: DiagramEdgeAnchor): DiagramPoint {
  if (anchor.side === "north") {
    return { x: anchor.ratio, y: 0 };
  }

  if (anchor.side === "south") {
    return { x: anchor.ratio, y: 1 };
  }

  if (anchor.side === "west") {
    return { x: 0, y: anchor.ratio };
  }

  return { x: 1, y: anchor.ratio };
}

function requireLayout(node: DiagramNode): DiagramNodeLayout {
  if (!node.layout) {
    throw new Error(`Cannot export node ${node.id}: missing layout.`);
  }

  return node.layout;
}

function requireGroupLayout(group: DiagramGroup): NonNullable<DiagramGroup["layout"]> {
  if (!group.layout) {
    throw new Error(`Cannot export group ${group.id}: missing layout.`);
  }

  return group.layout;
}

function calculateBounds(nodes: DiagramNode[], groups: DiagramGroup[], dividers: DiagramRoutingDivider[]): { width: number; height: number } {
  const width = Math.max(
    1169,
    ...nodes.map((node) => (node.layout ? node.layout.x + node.layout.width + 80 : 0)),
    ...groups.map((group) => (group.layout ? group.layout.x + group.layout.width + 80 : 0)),
    ...dividers.map((divider) => divider.layout.x + divider.layout.width + 80)
  );
  const height = Math.max(
    1654,
    ...nodes.map((node) => (node.layout ? node.layout.y + node.layout.height + 80 : 0)),
    ...groups.map((group) => (group.layout ? group.layout.y + group.layout.height + 80 : 0)),
    ...dividers.map((divider) => divider.layout.y + divider.layout.height + 80)
  );

  return { width, height };
}

function createExportEndpointMap(
  nodes: DiagramNode[],
  dividers: DiagramRoutingDivider[],
  nodeIdByDiagramId: Map<string, string>,
  dividerIdByDiagramId: Map<string, string>
): Map<string, ExportEndpoint> {
  return new Map([
    ...nodes.map((node): [string, ExportEndpoint] => {
      const cellId = nodeIdByDiagramId.get(node.id);
      if (!cellId) {
        throw new Error(`Cannot export node ${node.id}: missing generated cell id.`);
      }

      return [node.id, {
        id: node.id,
        cellId,
        layout: requireLayout(node),
        kind: "class"
      }];
    }),
    ...dividers.map((divider): [string, ExportEndpoint] => {
      const cellId = dividerIdByDiagramId.get(divider.id);
      if (!cellId) {
        throw new Error(`Cannot export routing divider ${divider.id}: missing generated cell id.`);
      }

      return [divider.id, {
        id: divider.id,
        cellId,
        layout: divider.layout,
        kind: "divider"
      }];
    })
  ]);
}

function createExportCellIdMap(items: Array<{ id: string }>, type: string): Map<string, string> {
  return new Map(items.map((item, index) => [item.id, createSequentialCellId(type, index)]));
}

function createSequentialCellId(type: string, zeroBasedIndex: number): string {
  return `${type}_${zeroBasedIndex + 1}`;
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

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
