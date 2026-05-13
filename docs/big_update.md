Dưới đây là bản tổng hợp thiết kế mới và hướng dẫn migrate codebase từ engine hiện tại sang engine mới.

## 1. Thay đổi tư duy chính

Engine hiện tại đang đi theo hướng:

```text
semantic model
→ generate nhiều layout candidate
→ grid/group placement
→ thử packing/order/routing variants
→ score toàn cục
→ chọn best
→ export mxGraphModel
```

README hiện mô tả rõ engine đang sinh candidate cho group placement, class order, packing, edge routing rồi lưu selected candidate và score vào `DiagramDocument.layout`; layout intent hiện cũng dựa trên grid row/column placement và packing. ([GitHub][1])

Engine mới nên đổi thành:

```text
semantic model
→ user/suggested group placement
→ pack nodes trong group
→ route edges
→ repair cục bộ
→ diagnostics/suggestions
→ export mxGraphModel
```

Nguyên lý mới:

```text
Không tối ưu vị trí group nếu user đã set layout.
Không dùng group grid làm model chính.
Không dùng compactGrid.
Không brute-force full layout candidates.
Router là phần tự động chính.
Auto layout chỉ chạy khi chưa có layout hoặc user bấm Auto.
```

Vẫn phải giữ nguyên nguyên tắc kiến trúc của repo: parser chỉ tạo semantic data, layout code chỉ tạo/cập nhật layout data, exporter chỉ serialize final model, không phát minh semantic mới. Đây là rule đã được ghi trong AGENTS.md. ([GitHub][2])

---

# 2. Engine mode mới

Nên tách engine thành 3 mode rõ ràng.

```ts
export type LayoutEngineMode =
  | "route-only"
  | "suggest-initial"
  | "auto-arrange";
```

## `route-only`

Dùng khi user đã có layout intent.

```text
Input:
  group positions / packing / node order từ user

Engine:
  không di chuyển group
  pack nodes trong group
  route edges
  emit diagnostics/suggestions
```

Đây nên là mode chính của UI sau khi người dùng đã chỉnh layout.

## `suggest-initial`

Dùng khi CLI không có `--layout`, hoặc Mermaid mới được paste vào UI.

```text
Engine:
  tạo group positions ban đầu
  route edges
  output layout intent để user chỉnh tiếp
```

Đây không nên được gọi là “optimal layout”. Nó chỉ là layout khởi tạo.

## `auto-arrange`

Dùng khi user chủ động bấm Auto.

```text
Engine:
  được phép đặt lại group
  vẫn không dùng brute force lớn
  sau đó route
```

Auto-arrange là hành động explicit, không được tự chạy khi user đã có layout intent.

---

# 3. Layout ownership mới

## User được chỉnh

MVP nên cho user chỉnh:

```text
group.x
group.y
group.packing: vertical | horizontal
group.nodeOrder
```

Không cần cho kéo từng class tự do ngay. Nhưng cần cho chỉnh `nodeOrder`, vì nhiều crossing không đến từ vị trí group mà đến từ thứ tự class bên trong group.

## Engine được tính

Engine tự tính:

```text
node.x / node.y bên trong group
node width / height
group width / height
anchor side
anchor ratio
edge waypoints
routing dividers hợp lệ
diagnostics
```

## Không cho engine tự đổi trong `route-only`

Trong `route-only`, engine không được:

```text
move group
đổi packing nếu user lock
đổi node order nếu user lock
đổi semantic UML
```

Nếu layout quá khó route, engine phải route best-effort và gợi ý chỉnh layout, không tự ý sửa layout của user.

---

# 4. Bỏ group grid làm model chính

Hiện core model có `GroupLayoutIntent` dạng grid:

```ts
export type GroupLayoutIntent = {
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  packing: DiagramGroupPacking;
};
```

Và `DiagramGroupPacking` hiện gồm cả `"compactGrid"`. ([GitHub][3])

Engine mới nên dùng layout intent v2 dạng continuous coordinates:

```ts
export type LayoutIntentV2 = {
  version: 2;

  groups: Record<string, GroupLayoutIntentV2>;

  routing?: RoutingIntentV2;
};

export type GroupLayoutIntentV2 = {
  id: string;
  label: string;

  x: number;
  y: number;

  packing: "vertical" | "horizontal";

  nodeOrder?: string[];

  locked?: boolean;
  packingLocked?: boolean;
  nodeOrderLocked?: boolean;
};
```

Giữ grid intent cũ để backward compatibility, nhưng convert sang v2:

```ts
function convertGridIntentToV2(
  oldIntent: StereotypeLayoutIntent
): LayoutIntentV2 {
  return {
    version: 2,
    groups: Object.fromEntries(
      oldIntent.groups.map(group => [
        group.id,
        {
          id: group.id,
          label: group.label,
          x: group.gridX * DEFAULT_GRID_CELL_WIDTH,
          y: group.gridY * DEFAULT_GRID_CELL_HEIGHT,
          packing: normalizePacking(group.packing),
          nodeOrder: group.nodeIds,
          locked: true
        }
      ])
    )
  };
}
```

`compactGrid` không nên được engine mới sinh ra nữa:

```ts
function normalizePacking(
  packing: DiagramGroupPacking
): "vertical" | "horizontal" {
  if (packing === "horizontal") return "horizontal";
  return "vertical";
}
```

Nên thêm diagnostic nếu import intent cũ có `compactGrid`:

```text
compactGrid is deprecated in routing-v2; converted to vertical.
```

---

# 5. Router mới: nguyên lý hoạt động

Bài toán router mới là:

```text
Given fixed group/node rectangles, route readable orthogonal edges.
```

Không còn phụ thuộc vào grid row/column.

## Hard constraints

```text
Không đổi source/target edge.
Không route xuyên node.
Không merge edge độc lập.
Không share segment nếu hai edge khác source và khác target.
Divider chỉ dùng cho fan-in hoặc fan-out.
Outer lane không được làm mất identity của edge.
```

Rule identity:

```text
Same-source or same-target edges do not automatically get shared segments.
Only valid engine-owned divider trunk routing may share segments.
```

Không hợp lệ:

```text
A1 → B1
A2 → B2
A3 → B3
```

Ba edge này không được gom vào trunk chung.

Hợp lệ:

```text
A → B1
A → B2
A → B3
```

hoặc:

```text
A1 → B
A2 → B
A3 → B
```

Vì có cùng source hoặc cùng target.

---

# 6. Lane model của router

Router nên dùng một lane graph thống nhất:

```ts
export type RoutingLane =
  | PrivateLane
  | CorridorLane
  | OuterLane
  | DividerLane;

export type PrivateLane = {
  kind: "private";
  edgeId: string;
  orientation: "horizontal" | "vertical";
  position: number;
  shared: false;
};

export type CorridorLane = {
  kind: "corridor";
  orientation: "horizontal" | "vertical";
  position: number;
  shared: false;
};

export type OuterLane = {
  kind: "outer";
  orientation: "horizontal" | "vertical";
  position: number;
  side: "north" | "east" | "south" | "west";
  shared: false;
};

export type DividerLane = {
  kind: "divider";
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
  shared: true;
  mode: "fanIn" | "fanOut";
  commonNodeId: string;
  edgeIds: string[];
};
```

Quan trọng: `corridor` và `outer` không có nghĩa là shared trunk. Chúng chỉ là không gian đi qua. Edge độc lập vẫn phải có private route riêng.

---

# 7. Outer lanes là phần chính thức, không phải hack

Repo hiện tại đã có exterior-lane orthogonal path trong candidate generation, và README ghi router hiện có direct, gutter, local under-row, exterior-lane paths. ([GitHub][1])

Engine mới nên giữ ý tưởng outer lane, nhưng đưa nó vào routing graph chính thức.

Cost gợi ý:

```text
node hit: hard reject
illegal non-divider segment overlap: hard reject

inner corridor route: cost thấp
private lane offset: cost thấp-trung bình
near outer lane: cost trung bình
far outer lane: cost cao
canvas expansion: cost cao
edge crossing: rất cao
bend: trung bình
length: thấp
```

Lý do cần outer lanes: case nhiều Controller/Manager cùng trỏ tới DTO rất dễ nghẹt nếu chỉ route ở corridor giữa group. Outer lanes cho phép edge vòng ngoài thay vì cắt qua trung tâm diagram.

---

# 8. Divider mới

Repo hiện tại đã có `DiagramRoutingDivider` với `mode: "fanOut" | "fanIn"` trong core model. ([GitHub][3]) README cũng ghi dense fan-out/fan-in routes có thể render qua routing dividers khi ít nhất bốn relationship cạnh tranh cùng endpoint direction. ([GitHub][1])

Engine mới giữ divider, nhưng siết rule:

```text
Divider chỉ được tạo nếu edge set là fan-in hoặc fan-out.
Không tạo divider chỉ vì nhiều edge giữa group A và group B.
```

Selection:

```ts
function selectDividerGroups(edges: DiagramEdge[]): DividerPlan[] {
  const fanOutGroups = groupBy(edges, edge => edge.sourceId);
  const fanInGroups = groupBy(edges, edge => edge.targetId);

  const plans: DividerPlan[] = [];

  for (const [sourceId, groupEdges] of fanOutGroups) {
    if (shouldUseDivider(groupEdges, "fanOut")) {
      plans.push({ mode: "fanOut", commonNodeId: sourceId, edges: groupEdges });
    }
  }

  for (const [targetId, groupEdges] of fanInGroups) {
    if (shouldUseDivider(groupEdges, "fanIn")) {
      plans.push({ mode: "fanIn", commonNodeId: targetId, edges: groupEdges });
    }
  }

  return resolveOverlappingDividerPlans(plans);
}
```

Default threshold:

```ts
const dividerThreshold = 4;
```

Có thể cho 3 nếu congestion cao, nhưng mặc định nên bảo thủ.

---

# 9. Pipeline engine mới

## Full pipeline

```text
1. Parse Mermaid → DiagramDocument semantic
2. Measure class nodes
3. Load or create LayoutIntentV2
4. Apply group positions
5. Choose/apply group packing
6. Order nodes inside groups
7. Pack nodes inside groups
8. Build obstacles
9. Assign anchors
10. Build routing lanes: corridor + outer + divider candidates
11. Select legal fan-in/fan-out dividers
12. Route divider edges
13. Route remaining edges individually
14. A* fallback if template routing fails
15. Local repair bad routes
16. Validate hard constraints
17. Score
18. Emit diagnostics + suggestions
19. Export mxGraphModel
```

## Trong `route-only`

```text
Không chạy group placement optimizer.
Không chạy grid placement.
Không chạy candidate layout search.
```

## Trong `suggest-initial`

```text
Tạo group x/y ban đầu đơn giản.
Sau đó chuyển qua cùng route pipeline.
```

## Trong `auto-arrange`

```text
Cho phép move group.
Nhưng nên là separate function, không trộn với route-only.
```

---

# 10. Thuật toán từng bước chính

## 10.1 Measure nodes

Giữ lại `estimateClassNodeLayout` trong `mvp0GridLayout.ts`.

Output:

```ts
node.layout = {
  x: 0,
  y: 0,
  width,
  height,
  headerHeight,
  lineHeight,
  separatorHeight
};
```

Không cần viết lại phần đo kích thước class box ở phase đầu.

## 10.2 Apply group layout intent

```ts
function applyGroupIntent(
  doc: DiagramDocument,
  intent: LayoutIntentV2
): DiagramGroup[] {
  return doc.groups.map(group => {
    const intentGroup = intent.groups[group.id];

    return {
      ...group,
      layout: {
        x: intentGroup.x,
        y: intentGroup.y,
        width: 0,
        height: 0
      },
      layoutIntent: undefined
    };
  });
}
```

## 10.3 Pack nodes trong group

Chỉ dùng 1D packing.

```ts
function packVertical(group, nodes) {
  let y = group.layout.y + GROUP_PADDING;

  for (const node of nodes) {
    node.layout.x = group.layout.x + GROUP_PADDING;
    node.layout.y = y;
    y += node.layout.height + NODE_GAP_Y;
  }

  group.layout.width =
    max(nodes.map(n => n.layout.width)) + GROUP_PADDING * 2;

  group.layout.height =
    sum(nodes.map(n => n.layout.height)) +
    NODE_GAP_Y * (nodes.length - 1) +
    GROUP_PADDING * 2;
}
```

```ts
function packHorizontal(group, nodes) {
  let x = group.layout.x + GROUP_PADDING;

  for (const node of nodes) {
    node.layout.x = x;
    node.layout.y = group.layout.y + GROUP_PADDING;
    x += node.layout.width + NODE_GAP_X;
  }

  group.layout.width =
    sum(nodes.map(n => n.layout.width)) +
    NODE_GAP_X * (nodes.length - 1) +
    GROUP_PADDING * 2;

  group.layout.height =
    max(nodes.map(n => n.layout.height)) + GROUP_PADDING * 2;
}
```

## 10.4 Assign anchors

Giữ deterministic anchor assignment:

```ts
function chooseAnchorSides(source, target) {
  const dx = centerX(target) - centerX(source);
  const dy = centerY(target) - centerY(source);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0
      ? { source: "east", target: "west" }
      : { source: "west", target: "east" };
  }

  return dy > 0
    ? { source: "south", target: "north" }
    : { source: "north", target: "south" };
}
```

Endpoint ratios vẫn dùng bucket theo `nodeId + side`:

```ts
ratio = (index + 1) / (count + 1);
```

README hiện cũng mô tả anchor ratios theo công thức `(index + 1) / (n + 1)` và ordering theo vị trí class đối diện. ([GitHub][1])

## 10.5 Build lanes

```ts
function buildRoutingLanes(context): RoutingLane[] {
  return [
    ...buildCorridorLanes(context.groups),
    ...buildOuterLanes(context.bounds),
    ...buildDividerCandidateLanes(context.edges)
  ];
}
```

Corridor:

```ts
verticalCorridorX = midpoint(groupA.right, groupB.left);
horizontalCorridorY = midpoint(groupA.bottom, groupB.top);
```

Outer lanes:

```ts
leftOuterX = bounds.left - OUTER_MARGIN;
rightOuterX = bounds.right + OUTER_MARGIN;
topOuterY = bounds.top - OUTER_MARGIN;
bottomOuterY = bounds.bottom + OUTER_MARGIN;
```

## 10.6 Route divider edges

Route fan-out:

```text
common source → divider trunk → targets
```

Route fan-in:

```text
sources → divider trunk → common target
```

Export không cần đổi nhiều, vì exporter hiện đã có routing divider cell style và export endpoint map cho dividers. ([GitHub][4])

## 10.7 Route remaining edges individually

Mỗi edge không thuộc divider plan đi riêng.

```ts
function routePrivateEdge(edge, context): RoutedEdge {
  const candidates = [
    ...templateRoutes(edge, context.corridorLanes),
    ...templateRoutes(edge, context.outerLanes)
  ];

  const valid = candidates.filter(route =>
    !hitsNode(route) &&
    !hasIllegalSharedSegment(route, context.segmentIndex)
  );

  if (valid.length > 0) {
    return minBy(valid, routeCost);
  }

  return routeWithAStarFallback(edge, context);
}
```

## 10.8 Local repair

Chỉ sửa edge xấu, không reroute toàn layout.

```ts
for (let pass = 0; pass < 2; pass++) {
  const badEdges = findBadEdges(routedEdges, scoreByEdge);

  for (const edge of badEdges) {
    removeFromSegmentIndex(edge);
    const repaired = tryAlternativePrivateRoute(edge);

    if (localScore(repaired) < localScore(edge)) {
      replace(edge, repaired);
    } else {
      restore(edge);
    }
  }
}
```

---

# 11. Score mới

Core hiện có `DiagramLayoutScore` với node overlaps, group overlaps, edge node hits, segment overlaps, crossings, bends, duplicate anchors, length, width/height/area. ([GitHub][3])

Nên mở rộng hoặc bổ sung score v2:

```ts
export type DiagramLayoutScoreV2 = DiagramLayoutScore & {
  edgeIdentityViolations: number;
  illegalSegmentOverlaps: number;
  outerLaneUsages: number;
  routingFailures: number;
};
```

Nếu muốn backward-compatible, có thể giữ `DiagramLayoutScore` và thêm optional fields:

```ts
edgeIdentityViolations?: number;
illegalSegmentOverlaps?: number;
outerLaneUsages?: number;
routingFailures?: number;
```

Trọng số mới:

```ts
const scoreWeightsV2 = {
  edgeIdentityViolations: 1_000_000_000_000,
  illegalSegmentOverlaps: 1_000_000_000_000,
  edgeNodeHits: 1_000_000_000,
  nodeOverlaps: 800_000_000,
  groupOverlaps: 500_000_000,
  edgeCrossings: 250_000_000,
  segmentOverlaps: 100_000_000,
  duplicateAnchors: 10_000_000,
  outerLaneUsage: 50_000,
  edgeBends: 1_000,
  edgeLength: 0.1,
  layoutArea: 0.0001
};
```

Nguyên tắc:

```text
edge identity > node avoidance > crossing reduction > compactness
```

---

# 12. Diagnostics và suggestions

Khi layout quá khó route, giữ:

```text
1. best-effort route
2. structured diagnostics
3. visual suggestions
```

Không nên chỉ giữ route + text suggestion. Diagnostics có cấu trúc giúp UI highlight và CLI in warning được.

```ts
export type LayoutDiagnosticV2 =
  | InsufficientCorridorSpaceDiagnostic
  | EdgeCrossingDiagnostic
  | IllegalSharedSegmentAvoidedDiagnostic
  | OuterLaneRequiredDiagnostic
  | DeprecatedPackingDiagnostic;

export type InsufficientCorridorSpaceDiagnostic = {
  type: "insufficient-corridor-space";
  severity: "warning";
  groupIds: string[];
  edgeIds: string[];
  recommendedAction: {
    kind: "increase-gap";
    direction: "x" | "y";
    amount: number;
  };
};
```

UI có thể hiển thị:

```text
Kéo DTO sang phải thêm khoảng 120px để giảm crossing.
```

CLI có thể in:

```text
Warning: insufficient corridor space between Manager and DTO; recommended +120px horizontal gap.
```

---

# 13. Codebase migration plan

## Phase 1 — Tách type và intent

Sửa `packages/core/src/index.ts`.

Hiện `DiagramLayoutState.engine` chỉ là `"stereotype-scored"` và `DiagramGroupPacking` có `"compactGrid"`. ([GitHub][3])

Đổi thành:

```ts
export type DiagramLayoutEngine =
  | "stereotype-scored"
  | "manual-routing-v2"
  | "suggest-initial-v2"
  | "auto-arrange-v2";

export type DiagramLayoutState = {
  engine: DiagramLayoutEngine;
  selectedCandidateId: string;
  candidatesEvaluated: number;
  score: DiagramLayoutScore;
  grid?: { columns: number; rows: number };
};
```

Giữ `DiagramGroupPacking` cũ để không phá import:

```ts
export type DiagramGroupPacking =
  | "vertical"
  | "horizontal"
  | "compactGrid";
```

Nhưng thêm type mới:

```ts
export type DiagramGroupPackingV2 = "vertical" | "horizontal";
```

Thêm layout intent v2 trong `packages/layout/src/layoutIntent.ts`, không nhất thiết nhét hết vào core.

---

## Phase 2 — Thêm module engine mới

Tạo các file:

```text
packages/layout/src/manualRoutingLayout.ts
packages/layout/src/layoutIntentV2.ts
packages/layout/src/groupPackingV2.ts
packages/layout/src/anchorAssignmentV2.ts
packages/layout/src/dividerPlanningV2.ts
packages/layout/src/laneGraph.ts
packages/layout/src/orthogonalRouterV2.ts
packages/layout/src/segmentIndex.ts
packages/layout/src/routeRepair.ts
packages/layout/src/layoutDiagnosticsV2.ts
packages/layout/src/layoutScoreV2.ts
```

Entry point:

```ts
export function applyManualRoutingLayout(
  document: DiagramDocument,
  intent: LayoutIntentV2,
  options?: ManualRoutingOptions
): DiagramDocument;
```

```ts
export function createInitialLayoutIntentV2(
  document: DiagramDocument,
  options?: InitialLayoutOptions
): LayoutIntentV2;
```

```ts
export function autoArrangeLayoutV2(
  document: DiagramDocument,
  options?: AutoArrangeOptions
): LayoutIntentV2;
```

---

## Phase 3 — Giữ engine cũ làm fallback

Không xóa `stereotypeGridLayout.ts` ngay.

Hiện file này chứa exact stereotype order, suggested group positions, grid constants, candidate limit, anchor-order variants và score weights. ([GitHub][5])

Nên để lại:

```ts
export function applyStereotypeGridLayout(...) {
  // legacy engine
}
```

Thêm engine mới song song:

```ts
export function applyLayoutV2(...) {
  // new route-first engine
}
```

Trong `packages/layout/src/index.ts`, export cả hai.

```ts
export {
  applyStereotypeGridLayout
} from "./stereotypeGridLayout.js";

export {
  applyManualRoutingLayout,
  createInitialLayoutIntentV2,
  autoArrangeLayoutV2
} from "./manualRoutingLayout.js";
```

---

## Phase 4 — CLI migration

CLI hiện có workflow `layout:init`, `generate --layout`, `--suggested-layout`, `--group-frames`; README cũng mô tả `--layout` là source of truth và không combine với `--suggested-layout`. ([GitHub][1])

Đổi behavior đề xuất:

```text
npm run generate -- input.md -o out.drawio
  → suggest-initial-v2 + route

npm run generate -- input.md -o out.drawio --layout layout.json
  → route-only v2

npm run generate -- input.md -o out.drawio --auto-arrange
  → auto-arrange-v2 + route

npm run layout:init -- input.md -o layout.json
  → create LayoutIntentV2
```

Backward compatibility:

```text
Nếu layout.json version 1:
  convert to v2
  emit warning
```

Nếu cần giữ engine cũ:

```text
--engine legacy
--engine v2
```

Default sau khi ổn định:

```text
--engine v2
```

---

## Phase 5 — Web UI migration

README hiện nói web UI đã có grid intent popup, class geometry editing, edge segment route editing, terminal drag, group-grid matrix, zoom/pan, multi-select, export layout JSON, v.v. ([GitHub][1])

Với engine mới, UI nên chuyển trọng tâm:

```text
Primary controls:
  drag group
  rotate packing vertical/horizontal
  reorder node list trong group
  reroute

Secondary/advanced:
  view edge diagnostics
  show outer lane usage
  show fan-in/fan-out dividers
```

Nên giảm phụ thuộc vào manual waypoint editing. Có thể giữ edge segment editing tạm thời, nhưng engine v2 không nên cần user chỉnh waypoint để có output đọc được.

UI behavior:

```text
User moves group:
  update LayoutIntentV2.groups[groupId].x/y
  run route-only v2
  rerender

User rotates packing:
  update packing
  repack nodes
  reroute

User reorders nodes:
  update nodeOrder
  repack group
  reroute

User clicks Auto:
  run auto-arrange-v2
  overwrite group layout intent
  reroute
```

---

## Phase 6 — Draw.io exporter

Không cần viết lại lớn.

Exporter hiện đọc `document.nodes`, `document.groups`, `document.routingDividers`, build class cells, divider cells, edge specs và export XML. ([GitHub][4])

Cần kiểm tra:

```text
edge waypoints vẫn dùng được
sourceAnchor/targetAnchor vẫn dùng được
routingDividers vẫn dùng được
groupFrames vẫn optional
```

Vì core output contract không đổi, exporter gần như giữ nguyên.

Chỉ cần cập nhật nếu `DiagramRoutingDivider` thêm field mới. Nếu không muốn đụng exporter, giữ shape cũ:

```ts
export type DiagramRoutingDivider = {
  id: string;
  orientation: DiagramRoutingDividerOrientation;
  side: DiagramEdgeAnchorSide;
  sourceEdgeIds: string[];
  mode: DiagramRoutingDividerMode;
  layout: DiagramRoutingDividerLayout;
};
```

---

# 14. Migration cụ thể theo file

## Giữ / reuse

```text
packages/core/src/index.ts
  giữ model chính, mở rộng engine/layout score nhẹ

packages/layout/src/mvp0GridLayout.ts
  reuse estimateClassNodeLayout

packages/drawio/src/mxGraphExporter.ts
  giữ exporter, chỉ sửa nếu divider type đổi

packages/parsers/src/*
  không sửa
```

## Thêm mới

```text
packages/layout/src/layoutIntentV2.ts
packages/layout/src/manualRoutingLayout.ts
packages/layout/src/groupPackingV2.ts
packages/layout/src/anchorAssignmentV2.ts
packages/layout/src/dividerPlanningV2.ts
packages/layout/src/laneGraph.ts
packages/layout/src/orthogonalRouterV2.ts
packages/layout/src/segmentIndex.ts
packages/layout/src/routeRepair.ts
packages/layout/src/layoutScoreV2.ts
packages/layout/src/layoutDiagnosticsV2.ts
packages/layout/src/initialLayoutV2.ts
packages/layout/src/autoArrangeV2.ts
```

## Giữ legacy

```text
packages/layout/src/stereotypeGridLayout.ts
  giữ engine cũ
  không refactor sâu ngay
```

## Sửa CLI

```text
apps/cli/src/index.ts
  detect layout version
  route-only nếu --layout
  suggest-initial nếu không --layout
  auto-arrange nếu explicit flag
```

## Sửa Web

```text
apps/web/src/*
  layout JSON version 2
  group drag updates x/y
  packing toggle
  node order control
  reroute on change
  diagnostics panel
```

---

# 15. Test plan

## Unit tests

```text
layoutIntentV2.test.ts
  convert v1 grid intent to v2
  compactGrid converted to vertical/horizontal

groupPackingV2.test.ts
  vertical packing no overlap
  horizontal packing no overlap
  nodeOrder respected

anchorAssignmentV2.test.ts
  side selection stable
  ratios evenly spaced
  bucket ordering deterministic

dividerPlanningV2.test.ts
  fan-out divider allowed only with one source and more than four edges
  fan-in divider allowed only with one target and more than four edges
  arbitrary group-to-group cluster rejected

segmentIndex.test.ts
  crossing detection
  divider-owned trunk segment exemption
  illegal segment overlap detection

orthogonalRouterV2.test.ts
  private routes do not hit nodes
  outer lanes used when inner corridor blocked
  independent edges do not overlap segments
```

## Integration tests

```text
route-only fixed layout
  group coordinates unchanged after routing

suggest-initial
  no layout input produces usable drawio

legacy layout input
  v1 layout json converted and routed

fan-in/fan-out diagram
  divider created only for fan-in/fan-out groups with more than four edges

DTO bottleneck case
  outer lanes used without illegal non-divider segment overlap
```

## Regression tests

Giữ baseline cũ cho legacy engine, thêm baseline mới cho v2. README hiện đã nói regression tests so sánh cấu trúc thay vì exact XML text, nên nên tiếp tục theo hướng này. ([GitHub][1])

---

# 16. Thứ tự triển khai khuyến nghị

## Milestone 1 — Routing v2 không auto layout

```text
- LayoutIntentV2
- group x/y + packing + nodeOrder
- pack nodes
- anchor assignment
- private edge routing
- segment index
- basic diagnostics
```

Mục tiêu: `--layout layout.v2.json` chạy được và không move group.

## Milestone 2 — Divider đúng rule

```text
- fan-in/fan-out detection
- divider planning
- divider routing
- illegal segment overlap validation
```

Mục tiêu: không còn bundle sai semantic.

## Milestone 3 — Outer lanes

```text
- outer lane generation
- route cost
- A* fallback hoặc lane graph search
- DTO bottleneck test
```

Mục tiêu: các edge tới DTO/Manager không nghẹt khi corridor trong bị kín.

## Milestone 4 — Initial layout

```text
- createInitialLayoutIntentV2
- CLI no-layout mode dùng suggest-initial-v2
- layout:init xuất v2
```

Mục tiêu: user mới có layout khởi tạo để chỉnh.

## Milestone 5 — Web integration

```text
- group drag writes LayoutIntentV2
- packing toggle
- node order editor
- reroute button/live reroute
- diagnostics/suggestions panel
```

## Milestone 6 — Legacy cleanup

```text
- keep --engine legacy for a while
- make v2 default
- deprecate grid intent
- document migration
```

---

# 17. API đề xuất

```ts
export type ManualRoutingOptions = {
  clearance?: number;
  laneGap?: number;
  outerLaneMargin?: number;
  dividerThreshold?: number;
  maxRepairPasses?: number;
};

export function routeDiagramFromLayoutIntentV2(
  document: DiagramDocument,
  intent: LayoutIntentV2,
  options?: ManualRoutingOptions
): DiagramDocument;

export function createInitialLayoutIntentV2(
  document: DiagramDocument,
  options?: InitialLayoutOptions
): LayoutIntentV2;

export function autoArrangeLayoutIntentV2(
  document: DiagramDocument,
  previousIntent?: LayoutIntentV2,
  options?: AutoArrangeOptions
): LayoutIntentV2;
```

Wrapper CLI/web:

```ts
export function layoutDiagramV2(
  document: DiagramDocument,
  request: LayoutRequestV2
): DiagramDocument {
  if (request.mode === "route-only") {
    return routeDiagramFromLayoutIntentV2(
      document,
      request.intent,
      request.routing
    );
  }

  if (request.mode === "suggest-initial") {
    const intent = createInitialLayoutIntentV2(document, request.initial);
    return routeDiagramFromLayoutIntentV2(document, intent, request.routing);
  }

  const intent = autoArrangeLayoutIntentV2(
    document,
    request.previousIntent,
    request.auto
  );

  return routeDiagramFromLayoutIntentV2(document, intent, request.routing);
}
```

---

# 18. Tóm tắt quyết định cuối

## Bỏ

```text
group grid làm layout model chính
compactGrid trong engine mới
full candidate search
global anchor-order variant brute force
arbitrary group-to-group edge bundling
auto move group khi user đã set layout
```

## Giữ

```text
Mermaid → DiagramDocument
exact stereotype grouping
class size estimation
draw.io mxGraphModel export
orthogonal anchors
waypoints
fan-in/fan-out dividers
layout score
diagnostics
```

## Thêm

```text
LayoutIntentV2 continuous coordinates
route-only mode
suggest-initial mode
auto-arrange mode
private lanes
outer lanes
lane graph
edge identity validation
structured routing diagnostics
visual suggestions
```

## Cốt lõi mới

```text
User controls group layout.
Engine controls routing.
Auto layout is only initial or explicit.
Router must preserve semantic identity.
Outer lanes are first-class routing lanes.
Divider is only legal for fan-in/fan-out.
```

Đây là hướng migrate ít rủi ro nhất: không phá parser/exporter, không xóa engine cũ ngay, và chuyển phần phức tạp nhất từ “tối ưu layout toàn cục” sang “route tốt trên layout đã biết”.
