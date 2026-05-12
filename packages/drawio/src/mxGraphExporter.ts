import type {
  DiagramDocument,
  DiagramEdge,
  DiagramEdgeAnchor,
  DiagramGroup,
  DiagramNode,
  DiagramNodeLayout,
  DiagramPoint
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

export type DrawioExportOptions = {
  groupFrames?: boolean;
};

export function toMxGraphModelXml(document: DiagramDocument, options: DrawioExportOptions = {}): string {
  const nodeIdByDiagramId = createExportCellIdMap(document.nodes, "node");
  const nodeByDiagramId = new Map(document.nodes.map((node) => [node.id, node]));
  const bounds = calculateBounds(document.nodes, document.groups ?? []);
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

  document.edges.forEach((edge, index) => {
    lines.push(buildEdgeCell(edge, index + 1, nodeIdByDiagramId, nodeByDiagramId));
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
  edge: DiagramEdge,
  index: number,
  nodeIdByDiagramId: Map<string, string>,
  nodeByDiagramId: Map<string, DiagramNode>
): string {
  const source = nodeIdByDiagramId.get(edge.sourceId);
  const target = nodeIdByDiagramId.get(edge.targetId);
  const sourceNode = nodeByDiagramId.get(edge.sourceId);
  const targetNode = nodeByDiagramId.get(edge.targetId);

  if (!source || !target || !sourceNode || !targetNode) {
    throw new Error(`Cannot export edge ${edge.id}: missing source or target node.`);
  }

  return [
    `    <mxCell id="edge_${index}" edge="1" parent="1" source="${source}" style="${escapeXmlAttribute(edgeStyle(edge))}" target="${target}" value="${escapeXmlAttribute(edge.label ?? "")}">`,
    buildEdgeGeometry(edge, sourceNode, targetNode),
    "    </mxCell>"
  ].join("\n");
}

function buildEdgeGeometry(edge: DiagramEdge, sourceNode: DiagramNode, targetNode: DiagramNode): string {
  const waypoints = exportWaypoints(edge, sourceNode, targetNode);

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

function exportWaypoints(edge: DiagramEdge, sourceNode: DiagramNode, targetNode: DiagramNode): DiagramPoint[] {
  const waypoints = edge.layout?.waypoints ?? [];
  const sourcePoint = edge.layout?.sourceAnchor
    ? edgeAnchorPoint(requireLayout(sourceNode), edge.layout.sourceAnchor)
    : undefined;
  const targetPoint = edge.layout?.targetAnchor
    ? edgeAnchorPoint(requireLayout(targetNode), edge.layout.targetAnchor)
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

function edgeAnchorPoint(layout: DiagramNodeLayout, anchor: DiagramEdgeAnchor): DiagramPoint {
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

function pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function edgeStyle(edge: DiagramEdge): string {
  const semanticStyle = edgeSemanticStyle(edge);
  const anchorStyle = [
    ...anchorStyleParts("exit", edge.layout?.sourceAnchor),
    ...anchorStyleParts("entry", edge.layout?.targetAnchor)
  ];

  return [
    "curved=0",
    ...semanticStyle,
    ...anchorStyle,
    "rounded=0",
    "edgeStyle=orthogonalEdgeStyle",
    "orthogonalLoop=1",
    "jettySize=auto",
    "html=1"
  ].join(";");
}

function edgeSemanticStyle(edge: DiagramEdge): string[] {
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

function calculateBounds(nodes: DiagramNode[], groups: DiagramGroup[]): { width: number; height: number } {
  const width = Math.max(
    1169,
    ...nodes.map((node) => (node.layout ? node.layout.x + node.layout.width + 80 : 0)),
    ...groups.map((group) => (group.layout ? group.layout.x + group.layout.width + 80 : 0))
  );
  const height = Math.max(
    1654,
    ...nodes.map((node) => (node.layout ? node.layout.y + node.layout.height + 80 : 0)),
    ...groups.map((group) => (group.layout ? group.layout.y + group.layout.height + 80 : 0))
  );

  return { width, height };
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
