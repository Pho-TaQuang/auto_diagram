import type { DiagramDocument, DiagramNode, DiagramNodeLayout } from "../../core/src/index.js";

const stereotypeOrder = [
  "Controller",
  "ManagerInterface",
  "Manager",
  "AdapterFactory",
  "DataAccessAdapter",
  "LLBLGenEntity",
  "Model",
  "DTO"
];

export function applyMvp0GridLayout(document: DiagramDocument): DiagramDocument {
  const sourceIndex = new Map(document.nodes.map((node, index) => [node.id, index]));
  const nodes = [...document.nodes]
    .sort((left, right) => compareNodes(left, right, sourceIndex))
    .map((node) => ({
      ...node,
      attributes: [...node.attributes],
      methods: [...node.methods],
      layout: estimateClassNodeLayout(node)
    }));

  const columns = 3;
  const marginX = 40;
  const marginY = 40;
  const gapX = 120;
  const gapY = 160;

  let x = marginX;
  let y = marginY;
  let rowHeight = 0;
  let column = 0;

  const placedNodes = nodes.map((node) => {
    if (column === columns) {
      x = marginX;
      y += rowHeight + gapY;
      rowHeight = 0;
      column = 0;
    }

    const layout = {
      ...node.layout,
      x,
      y
    };

    x += layout.width + gapX;
    rowHeight = Math.max(rowHeight, layout.height);
    column += 1;

    return {
      ...node,
      layout
    };
  });

  return {
    ...document,
    nodes: placedNodes,
    edges: document.edges.map((edge) => ({ ...edge }))
  };
}

export function estimateClassNodeLayout(node: DiagramNode): DiagramNodeLayout {
  const memberCount = node.attributes.length + node.methods.length;
  const attributeRowCount = Math.max(1, node.attributes.length);
  const methodRowCount = Math.max(1, node.methods.length);
  const lineHeight = memberCount > 30 ? 25 : 30;
  const headerHeight = node.stereotype ? 48 : 40;
  const separatorHeight = 8;
  const contentRowCount = attributeRowCount + methodRowCount;
  const longestLine = Math.max(
    node.label.length,
    node.stereotype ? node.stereotype.length + 4 : 0,
    ...node.attributes.map((member) => member.text.length),
    ...node.methods.map((member) => member.text.length)
  );

  return {
    x: 0,
    y: 0,
    width: clamp(Math.ceil(longestLine * 7.4 + 40), 220, 920),
    height: headerHeight + contentRowCount * lineHeight + separatorHeight,
    headerHeight,
    lineHeight,
    separatorHeight
  };
}

function compareNodes(
  left: DiagramNode,
  right: DiagramNode,
  sourceIndex: Map<string, number>
): number {
  const leftOrder = stereotypeIndex(left.stereotype);
  const rightOrder = stereotypeIndex(right.stereotype);

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0);
}

function stereotypeIndex(stereotype: string | undefined): number {
  if (!stereotype) {
    return stereotypeOrder.length;
  }

  const index = stereotypeOrder.indexOf(stereotype);
  return index === -1 ? stereotypeOrder.length : index;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
