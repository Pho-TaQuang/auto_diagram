import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStereotypeGridLayout } from "./stereotypeGridLayout.js";
import {
  createRelativeFlowLayout,
  normalizeRelativeFlowLayout,
  relativeFlowLayoutToStereotypeLayoutIntent,
  type RelativeFlowLayout
} from "./relativeFlowLayout.js";
import { parseMermaidClassDiagram } from "../../parsers/src/index.js";

const demoFixture = readFileSync("docs/demo_mermaid.md", "utf8");

export function runRelativeFlowLayoutTests(): void {
  createsRelativeFlowLayoutFromSuggestedPlacement();
  resolvesRankOnlyColumns();
  resolvesPlacedAfterWithoutRank();
  resolvesVerticalConstraintsWithinOneColumn();
  resolvesMixedHorizontalAndVerticalConstraints();
  convertsRelativeFlowLayoutAndKeepsRouting();
  rejectsInvalidRelativeFlowLayouts();
}

function createsRelativeFlowLayoutFromSuggestedPlacement(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const layout = createRelativeFlowLayout(parsed, { placement: "suggested" });
  const controller = requireLayoutGroup(layout, "Controller");
  const manager = requireLayoutGroup(layout, "Manager");
  const model = requireLayoutGroup(layout, "Model");
  const adapterFactory = requireLayoutGroup(layout, "AdapterFactory");
  const managerInterface = requireLayoutGroup(layout, "ManagerInterface");

  assert.equal(layout.version, 2);
  assert.equal(layout.layoutMode, "relative-flow");
  assert.equal(adapterFactory.rank, 0);
  assert.equal(controller.rank, 0);
  assert.equal(manager.rank, 2);
  assert.equal(manager.placedAfter, "group_stereotype_ManagerInterface");
  assert.equal(managerInterface.below, "group_stereotype_DataAccessAdapter");
  assert.equal(model.below, "group_stereotype_Controller");
}

function resolvesRankOnlyColumns(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> Left",
    "<<Manager>> Right"
  ].join("\n"));
  const intent = relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
    version: 2,
    layoutMode: "relative-flow",
    groups: [
      {
        id: "left",
        label: "Controller",
        packing: "vertical",
        rank: 0,
        nodeIds: ["Left"]
      },
      {
        id: "right",
        label: "Manager",
        packing: "vertical",
        rank: 1,
        nodeIds: ["Right"]
      }
    ]
  } satisfies RelativeFlowLayout);

  assertIntentPosition(intent, "left", 0, 0);
  assertIntentPosition(intent, "right", 1, 0);
}

function resolvesPlacedAfterWithoutRank(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> A",
    "<<Manager>> B",
    "<<Model>> C"
  ].join("\n"));
  const intent = relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
    version: 2,
    layoutMode: "relative-flow",
    groups: [
      {
        id: "a",
        label: "Controller",
        packing: "vertical",
        rank: 0,
        nodeIds: ["A"]
      },
      {
        id: "b",
        label: "Manager",
        packing: "vertical",
        placedAfter: "a",
        nodeIds: ["B"]
      },
      {
        id: "c",
        label: "Model",
        packing: "compactGrid",
        placedAfter: "b",
        nodeIds: ["C"]
      }
    ]
  } satisfies RelativeFlowLayout);

  assertIntentPosition(intent, "a", 0, 0);
  assertIntentPosition(intent, "b", 1, 0);
  assertIntentPosition(intent, "c", 2, 0);
}

function resolvesVerticalConstraintsWithinOneColumn(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> Top",
    "<<Manager>> Middle",
    "<<Model>> Bottom"
  ].join("\n"));
  const intent = relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
    version: 2,
    layoutMode: "relative-flow",
    groups: [
      {
        id: "top",
        label: "Controller",
        packing: "vertical",
        rank: 0,
        nodeIds: ["Top"]
      },
      {
        id: "middle",
        label: "Manager",
        packing: "vertical",
        below: "top",
        nodeIds: ["Middle"]
      },
      {
        id: "bottom",
        label: "Model",
        packing: "compactGrid",
        below: "middle",
        nodeIds: ["Bottom"]
      }
    ]
  } satisfies RelativeFlowLayout);

  assertIntentPosition(intent, "top", 0, 0);
  assertIntentPosition(intent, "middle", 0, 1);
  assertIntentPosition(intent, "bottom", 0, 2);
}

function resolvesMixedHorizontalAndVerticalConstraints(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> A",
    "<<Manager>> B",
    "<<DTO>> C",
    "<<Model>> D"
  ].join("\n"));
  const intent = relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
    version: 2,
    layoutMode: "relative-flow",
    groups: [
      {
        id: "a",
        label: "Controller",
        packing: "vertical",
        rank: 0,
        nodeIds: ["A"]
      },
      {
        id: "b",
        label: "Manager",
        packing: "vertical",
        placedAfter: "a",
        nodeIds: ["B"]
      },
      {
        id: "c",
        label: "DTO",
        packing: "compactGrid",
        below: "a",
        nodeIds: ["C"]
      },
      {
        id: "d",
        label: "Model",
        packing: "compactGrid",
        below: "b",
        nodeIds: ["D"]
      }
    ]
  } satisfies RelativeFlowLayout);

  assertIntentPosition(intent, "a", 0, 0);
  assertIntentPosition(intent, "b", 1, 0);
  assertIntentPosition(intent, "c", 0, 1);
  assertIntentPosition(intent, "d", 1, 1);
}

function convertsRelativeFlowLayoutAndKeepsRouting(): void {
  const parsed = parseMermaidClassDiagram(demoFixture);
  const relativeLayout = createRelativeFlowLayout(parsed, { placement: "suggested" });
  const intent = relativeFlowLayoutToStereotypeLayoutIntent(parsed, relativeLayout);
  const document = applyStereotypeGridLayout(parsed, { intent });

  assert.equal(document.layout?.score.edgeCrossings, 0);
  assert.ok(document.edges.every((edge) => edge.layout?.sourceAnchor && edge.layout?.targetAnchor));
  assert.ok(document.edges.some((edge) => (edge.layout?.waypoints?.length ?? 0) > 0));
}

function rejectsInvalidRelativeFlowLayouts(): void {
  const parsed = parseMermaidClassDiagram([
    "classDiagram",
    "<<Controller>> A",
    "<<Manager>> B"
  ].join("\n"));

  assert.throws(
    () => normalizeRelativeFlowLayout({ version: 1, groups: [] }),
    /version 1 is no longer supported/
  );

  assert.throws(
    () => relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
      version: 2,
      layoutMode: "relative-flow",
      groups: [
        {
          id: "a",
          label: "Controller",
          packing: "vertical",
          rank: 0,
          nodeIds: ["A"]
        },
        {
          id: "b",
          label: "Manager",
          packing: "vertical",
          rank: 0,
          nodeIds: ["B"]
        }
      ]
    } satisfies RelativeFlowLayout),
    /same grid cell/
  );

  assert.throws(
    () => relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
      version: 2,
      layoutMode: "relative-flow",
      groups: [
        {
          id: "a",
          label: "Controller",
          packing: "vertical",
          below: "b",
          nodeIds: ["A"]
        },
        {
          id: "b",
          label: "Manager",
          packing: "vertical",
          below: "a",
          nodeIds: ["B"]
        }
      ]
    } satisfies RelativeFlowLayout),
    /vertical cycle/
  );

  assert.throws(
    () => relativeFlowLayoutToStereotypeLayoutIntent(parsed, {
      version: 2,
      layoutMode: "relative-flow",
      groups: [
        {
          id: "a",
          label: "Controller",
          packing: "vertical",
          rank: 0,
          nodeIds: ["A"]
        },
        {
          id: "b",
          label: "Manager",
          packing: "vertical",
          rank: 1,
          below: "a",
          nodeIds: ["B"]
        }
      ]
    } satisfies RelativeFlowLayout),
    /conflicting ranks/
  );
}

function requireLayoutGroup(layout: RelativeFlowLayout, label: string): RelativeFlowLayout["groups"][number] {
  const group = layout.groups.find((candidate) => candidate.label === label);
  assert.ok(group, `Expected layout group ${label} to exist.`);
  return group;
}

function assertIntentPosition(intent: ReturnType<typeof relativeFlowLayoutToStereotypeLayoutIntent>, id: string, gridX: number, gridY: number): void {
  const group = intent.groups.find((candidate) => candidate.id === id);
  assert.ok(group, `Expected group ${id} to exist.`);
  assert.equal(group.gridX, gridX);
  assert.equal(group.gridY, gridY);
}
