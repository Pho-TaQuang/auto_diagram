import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DiagramNode } from "../../core/src/index.js";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";
import { applyMvp0GridLayout, estimateClassNodeLayout } from "./mvp0GridLayout.js";

const demoFixture = readFileSync("docs/demo_mermaid.md", "utf8");
const dmLoaiLucLuongFixture = readFileSync("docs/dmLoaiLucLuong.md", "utf8");

export function runLayoutTests(): void {
  estimatesPositiveClassNodeSizes();
  reservesClassCompartmentsForEmptySections();
  placesDemoNodesWithoutOverlap();
  placesDmLoaiLucLuongNodesWithoutOverlap();
}

function estimatesPositiveClassNodeSizes(): void {
  const node: DiagramNode = {
    id: "SampleController",
    label: "SampleController",
    kind: "class",
    stereotype: "Controller",
    attributes: [{ kind: "attribute", visibility: "-", name: "_service", text: "-_service SampleService" }],
    methods: [
      {
        kind: "method",
        visibility: "+",
        name: "Run",
        returnType: "Task<ApiResponse>",
        text: "+Run(SampleModel model) : Task<ApiResponse>"
      }
    ]
  };

  const layout = estimateClassNodeLayout(node);

  assert.equal(layout.headerHeight, 48);
  assert.equal(layout.lineHeight, 30);
  assert.equal(layout.separatorHeight, 8);
  assert.equal(layout.height, layout.headerHeight + 2 * layout.lineHeight + layout.separatorHeight);
  assert.ok(layout.width >= 220);
  assert.ok(layout.height > 0);
}

function reservesClassCompartmentsForEmptySections(): void {
  const emptyNode: DiagramNode = {
    id: "EmptyClass",
    label: "EmptyClass",
    kind: "class",
    attributes: [],
    methods: []
  };
  const methodOnlyNode: DiagramNode = {
    id: "MethodOnly",
    label: "MethodOnly",
    kind: "class",
    attributes: [],
    methods: [{ kind: "method", visibility: "+", name: "Run", text: "+Run() void" }]
  };

  const emptyLayout = estimateClassNodeLayout(emptyNode);
  const methodOnlyLayout = estimateClassNodeLayout(methodOnlyNode);

  assert.equal(emptyLayout.separatorHeight, 8);
  assert.equal(emptyLayout.height, emptyLayout.headerHeight + emptyLayout.lineHeight + emptyLayout.separatorHeight + emptyLayout.lineHeight);
  assert.equal(methodOnlyLayout.height, methodOnlyLayout.headerHeight + methodOnlyLayout.lineHeight + methodOnlyLayout.separatorHeight + methodOnlyLayout.lineHeight);
}

function placesDemoNodesWithoutOverlap(): void {
  assertNoNodeOverlap(applyMvp0GridLayout(parseMermaidClassDiagram(demoFixture)).nodes);
}

function placesDmLoaiLucLuongNodesWithoutOverlap(): void {
  assertNoNodeOverlap(applyMvp0GridLayout(parseMermaidClassDiagram(dmLoaiLucLuongFixture)).nodes);
}

function assertNoNodeOverlap(nodes: DiagramNode[]): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = requireLayout(nodes[leftIndex]);
      const right = requireLayout(nodes[rightIndex]);

      assert.equal(rectanglesOverlap(left, right), false, `${nodes[leftIndex].id} overlaps ${nodes[rightIndex].id}`);
    }
  }
}

function requireLayout(node: DiagramNode): NonNullable<DiagramNode["layout"]> {
  assert.ok(node.layout, `Expected ${node.id} to have layout.`);
  assert.ok(node.layout.width > 0, `Expected ${node.id} to have positive width.`);
  assert.ok(node.layout.height > 0, `Expected ${node.id} to have positive height.`);
  return node.layout;
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
