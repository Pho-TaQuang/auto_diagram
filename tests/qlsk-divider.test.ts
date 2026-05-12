import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMermaidClassDiagram } from "../packages/parsers/src/index.js";
import { applyStereotypeGridLayout } from "../packages/layout/src/index.js";

export function runQlskDividerTests(): void {
  testQlskDividerClusters();
}

function testQlskDividerClusters(): void {
  const source = readFileSync("docs/qlsk.md", "utf8");
  const parsed = parseMermaidClassDiagram(source);
  const laidOut = applyStereotypeGridLayout(parsed);

  const dividers = laidOut.routingDividers ?? [];
  const diagnostics = laidOut.diagnostics;

  console.log(`--- qlsk divider test ---`);
  console.log(`Dividers created: ${dividers.length}`);
  for (const d of dividers) {
    console.log(`  [${d.mode}] ${d.id}  side=${d.side}  orientation=${d.orientation}  edges=${d.sourceEdgeIds.length}`);
  }

  const warnings = diagnostics.filter((d) => d.severity === "warning");
  console.log(`Warnings: ${warnings.length}`);
  for (const w of warnings) {
    console.log(`  [warning] ${w.message}`);
  }

  // Compute per-cluster divider count (same logic as runtime)
  const perClusterCount = new Map<string, number>();
  for (const d of dividers) {
    // cluster key is embedded in id but we can derive it from the shared source edges
    // Use targetGroupId of first edge as proxy for cluster key
    const nodeById = new Map(laidOut.nodes.map((n) => [n.id, n]));
    const firstEdge = laidOut.edges.find((e) => d.sourceEdgeIds.includes(e.id));
    if (!firstEdge) continue;
    const otherId = d.mode === "fanOut" ? firstEdge.targetId : firstEdge.sourceId;
    const otherGroupId = nodeById.get(otherId)?.groupId ?? "__ungrouped__";
    const clusterKey = `${d.mode}:${otherGroupId}`;
    perClusterCount.set(clusterKey, (perClusterCount.get(clusterKey) ?? 0) + 1);
  }
  const expectWarning = [...perClusterCount.values()].some((c) => c > 2);

  if (expectWarning) {
    assert.ok(
      warnings.some((w) => w.message.includes("routing layout")),
      "Expected tooComplex warning when a cluster has > 2 dividers"
    );
    console.log("  ✓ tooComplex warning present as expected");
  } else {
    assert.ok(
      !warnings.some((w) => w.message.includes("routing layout")),
      `Did not expect tooComplex warning — per-cluster counts: ${[...perClusterCount.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`
    );
    console.log("  ✓ No tooComplex warning (no cluster has > 2 dividers)");
  }

  // Verify same-group constraint: all edges in each divider must share otherGroup
  for (const divider of dividers) {
    const edges = laidOut.edges.filter((e) => divider.sourceEdgeIds.includes(e.id));
    const nodeById = new Map(laidOut.nodes.map((n) => [n.id, n]));
    const groupById = new Map((laidOut.groups ?? []).map((g) => [g.id, g]));

    // Determine "other" node relative to the divider mode
    const otherGroupIds = new Set(edges.map((e) => {
      // For fanOut divider: source is the hub, target is the cluster
      // For fanIn divider: target is the hub, source is the cluster
      const otherId = divider.mode === "fanOut" ? e.targetId : e.sourceId;
      const node = nodeById.get(otherId);
      return node?.groupId ?? "__ungrouped__";
    }));

    assert.equal(
      otherGroupIds.size,
      1,
      `Divider ${divider.id} spans multiple other-groups: ${[...otherGroupIds].join(", ")}`
    );
    console.log(`  ✓ Divider ${divider.id}: all targets in same group (${[...otherGroupIds][0]})`);
  }

  // Verify packing-side constraint
  for (const divider of dividers) {
    const edges = laidOut.edges.filter((e) => divider.sourceEdgeIds.includes(e.id));
    if (edges.length === 0) continue;
    const nodeById = new Map(laidOut.nodes.map((n) => [n.id, n]));
    const groupById = new Map((laidOut.groups ?? []).map((g) => [g.id, g]));

    // Hub node
    const hubId = divider.mode === "fanOut" ? edges[0].sourceId : edges[0].targetId;
    const hubNode = nodeById.get(hubId);
    const hubGroup = hubNode?.groupId ? groupById.get(hubNode.groupId) : undefined;
    const packing = hubGroup?.layoutIntent?.packing;

    if (packing === "horizontal") {
      assert.ok(
        divider.side === "north" || divider.side === "south",
        `Divider ${divider.id} in horizontal group must use north/south, got ${divider.side}`
      );
      console.log(`  ✓ Divider ${divider.id}: horizontal group → side=${divider.side} ✓`);
    } else if (packing === "vertical") {
      assert.ok(
        divider.side === "west" || divider.side === "east",
        `Divider ${divider.id} in vertical group must use west/east, got ${divider.side}`
      );
      console.log(`  ✓ Divider ${divider.id}: vertical group → side=${divider.side} ✓`);
    } else {
      console.log(`  ~ Divider ${divider.id}: packing=${packing} (no constraint)`);
    }
  }

  console.log("--- qlsk divider test PASSED ---\n");
}
