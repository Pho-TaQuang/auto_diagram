# AutoDiagram – Tổng quan sản phẩm

## 1. Tầm nhìn

**AutoDiagram** là công cụ sinh sơ đồ tự động, tập trung vào việc tạo file **draw.io / diagrams.net mxGraph XML** từ input có cấu trúc.

AutoDiagram **không phải là một diagram editor** và không nhằm thay thế draw.io.  
Thay vào đó, AutoDiagram là một công cụ:

```text
Input có cấu trúc
→ trích xuất model sơ đồ
→ gợi ý bố cục
→ cho người dùng chỉnh ý đồ layout
→ tự tính vị trí node và route connector
→ xuất file .drawio / mxGraph XML
```

Nếu người dùng cần chỉnh sửa chi tiết cuối cùng, app có thể mở hoặc nhúng draw.io.

---

## 2. Mục tiêu chính

AutoDiagram được thiết kế để giải quyết bài toán:

> Làm sao sinh được sơ đồ draw.io đẹp, hợp lý, ít phải kéo thả thủ công, từ dữ liệu đầu vào có cấu trúc?

Mục tiêu cụ thể:

* Sinh được `mxGraphModel XML` hợp lệ.
* Mở được output bằng draw.io / diagrams.net.
* Hỗ trợ layout tự động cho class diagram trước.
* Cho phép người dùng tùy chỉnh layout ở mức ý đồ bố cục, không chỉnh từng shape thủ công.
* Tự route connector để giảm cắt nhau, đè box, đè edge.
* Chạy hoàn toàn phía client, không cần backend.
* Dùng chung core cho web app, desktop app và Node CLI.

---

## 3. Không phải là gì?

AutoDiagram **không phải**:

* Không phải draw.io replacement.
* Không phải công cụ vẽ tay.
* Không phải editor kéo-thả shape tự do.
* Không phải app mobile.
* Không yêu cầu backend.
* Không tập trung vào realtime collaboration.
* Không phụ thuộc một domain cụ thể như Mẫu 08, bản đồ tác chiến, hay C# Controller–Manager.

---

## 4. Định vị sản phẩm

AutoDiagram là:

```text
Client-side layout planning tool
+ mxGraph XML generator
+ class diagram layout assistant
```

Nói ngắn gọn:

> Người dùng không vẽ sơ đồ bằng tay. Người dùng cung cấp input và chỉnh layout intent. Phần mềm sinh sơ đồ draw.io.

---

## 5. Phạm vi ban đầu

Giai đoạn đầu tập trung vào **class diagram theo stereotype**.

Quyết định scope ban đầu:

```text
- Diagram type đầu tiên: UML class diagram.
- Layout mode đầu tiên: Stereotype Grid Layout.
- Input đầu tiên: Mermaid classDiagram.
- Output đầu tiên: .drawio / mxGraph XML mở được bằng draw.io.
```

Lý do:

* Class diagram có nhiều box.
* Quan hệ giữa class dễ bị rối.
* Layout thủ công mất thời gian.
* Nhóm stereotype như Controller, Service, Repository, Entity, DTO tạo layout intent rõ ràng.
* Mermaid classDiagram đã chứa gần đủ ngữ nghĩa cần thiết của UML class diagram cho MVP.
* Sequence diagram thường ít cần chỉnh layout hơn.

Các loại sơ đồ khác trong UML và ngoài UML có thể hỗ trợ sau:

* Component diagram
* Deployment diagram
* Sequence diagram
* Use case diagram
* Activity diagram
* State machine diagram
* Flowchart
* ERD
* Data flow diagram
* Mind map
* Generic box-and-arrow diagram

---

## 6. Hai chế độ layout chính

AutoDiagram có 2 chế độ layout cho class diagram.

---

## 6.1. Stereotype Grid Layout

Dùng cho class diagram có các nhóm stereotype rõ ràng, ví dụ:

```text
Controller
Service
Manager
Repository
Adapter
Entity
DTO
Model
Enum
Helper
ExternalService
```

### Cách hoạt động

```text
Input class diagram
→ trích xuất class
→ nhận diện stereotype
→ gom class theo stereotype
→ ước lượng kích thước từng group
→ hiển thị grid layout
→ người dùng kéo thả group trên grid
→ phần mềm layout class bên trong group
→ phần mềm route connector
→ xuất mxGraph XML
```

### UI ý tưởng

UI có thể dùng một grid, ví dụ `10x10`.

Mỗi stereotype group được biểu diễn như một block chiếm một hoặc nhiều ô.

Ví dụ:

```text
┌────────────┬────────────┬────────────┬────────────┐
│ Controller │            │ Service    │ Entity     │
├────────────┼────────────┼────────────┼────────────┤
│            │ DTO/Model  │            │ Enum       │
└────────────┴────────────┴────────────┴────────────┘
```

Người dùng không kéo từng class lúc đầu, mà kéo các group.

### Mục tiêu

* User quyết định nhóm nào nằm ở đâu.
* App quyết định tọa độ thực tế.
* App tự xếp class bên trong group.
* App tự route connector giữa các group.

---

## 6.2. Manual Layout Assist

Dùng cho class diagram nghiệp vụ hoặc class diagram không có stereotype rõ ràng.

Ví dụ:

```text
Sự kiện
Kế hoạch sự kiện
Nhiệm vụ kế hoạch
Nguồn lực
Địa điểm
Hồ sơ
Lịch sử trạng thái
```

Trong mode này không cần grid stereotype.

### Cách hoạt động

```text
Input class diagram
→ sinh box class
→ auto layout lần đầu
→ người dùng kéo thả box để chỉnh bố cục
→ phần mềm lock vị trí box đã chỉnh
→ phần mềm reroute connector
→ phần mềm tối ưu các box chưa lock
→ xuất mxGraph XML
```

### UI chỉ cho chỉnh layout

Người dùng có thể:

* Kéo thả class box.
* Lock/unlock box.
* Chọn hướng layout tổng thể.
* Yêu cầu reroute connector.
* Yêu cầu optimize lại các box chưa lock.
* Export sang `.drawio`.

Người dùng không chỉnh:

* Không sửa class name.
* Không sửa attributes.
* Không sửa methods.
* Không vẽ edge thủ công.
* Không chỉnh waypoint thủ công.
* Không chỉnh từng style chi tiết như draw.io.

---

## 7. Nguyên tắc quan trọng

AutoDiagram chỉ can thiệp vào layout, không tự ý thay đổi semantic.

Các thông tin semantic gồm:

```text
- class name
- stereotype
- attributes
- methods
- relationships
- multiplicity
- edge label
- source node
- target node
```

Các thông tin layout có thể thay đổi:

```text
- node x/y
- node width/height nếu cần đo lại
- edge routing style
- edge waypoints
- group position
- group spacing
```

---

## 8. Kiến trúc tổng quát

AutoDiagram nên được xây theo kiến trúc module.

```text
autodiagram/
  apps/
    web/
    desktop/
    cli/

  packages/
    core/
    parsers/
    layout/
    drawio/
    templates/
    preview/
```

---

## 8.1. `packages/core`

Chứa model trung gian của sơ đồ.

Nhiệm vụ:

* Định nghĩa `DiagramDocument`
* Định nghĩa `DiagramNode`
* Định nghĩa `DiagramEdge`
* Định nghĩa `DiagramGroup`
* Validate model
* Normalize ID
* Quản lý metadata

---

## 8.2. `packages/parsers`

Chuyển input thành model trung gian.

Input ban đầu nên ưu tiên:

```text
- Mermaid classDiagram
```

Lý do chọn Mermaid classDiagram trước:

```text
- Có cú pháp phổ biến, dễ paste từ tài liệu kỹ thuật.
- Biểu diễn được class, attribute, method, relationship, label và cardinality ở mức đủ tốt cho MVP.
- Giữ input gần với UML thay vì phải phát minh JSON schema riêng ngay từ đầu.
```

JSON/YAML có thể dùng như internal test fixture hoặc format import/export sau khi model ổn định.

Sau này có thể thêm:

```text
- JSON
- YAML
- C# source
- SQL schema
- Markdown table
- AI structured output
- Mermaid sequenceDiagram
- Mermaid flowchart
- PlantUML
```

Tất cả parser đều phải xuất về cùng một model:

```text
Input → DiagramDocument
```

Parser không được ghi mxGraph XML trực tiếp.

---

## 8.3. `packages/layout`

Chứa layout engine.

Nhiệm vụ:

* Ước lượng kích thước node.
* Ước lượng kích thước group.
* Gom node theo stereotype hoặc group.
* Sinh layout candidates.
* Tính tọa độ thực tế.
* Route connector.
* Tính layout score.
* Tối ưu crossing/overlap.

---

## 8.4. `packages/drawio`

Chuyển model đã layout thành `mxGraphModel XML`.

Nhiệm vụ:

* Sinh `mxGraphModel`
* Sinh `mxCell` cho node
* Sinh `mxCell` cho edge
* Ghi geometry
* Ghi style
* Ghi waypoint
* Validate XML
* Đọc lại `.drawio` nếu cần relayout

---

## 8.5. `packages/templates`

Chứa template style cho từng loại sơ đồ.

Ví dụ:

```text
- class diagram template
- business class template
- implementation class template
- flowchart template
- generic template
```

Template định nghĩa:

```text
- shape
- fill color
- stroke color
- font size
- edge style
- arrow style
- padding
- default spacing
```

---

## 8.6. `apps/cli`

Node CLI để generate hoặc relayout bằng command line.

Ví dụ:

```bash
autodiagram generate input.yaml -o output.drawio
autodiagram relayout input.drawio -o clean.drawio
autodiagram validate output.drawio
```

CLI là cách test engine tốt nhất trước khi làm UI.

---

## 8.7. `apps/web`

Web app chạy hoàn toàn client-side.

Nhiệm vụ:

* Nhập input
* Preview sơ đồ
* Chỉnh layout intent
* Export file
* Không gọi backend

---

## 8.8. `apps/desktop`

Desktop app dùng chung core với web.

Có thể dùng:

```text
Electron
hoặc
Tauri
```

Giai đoạn đầu nên ưu tiên Electron nếu muốn nhanh và dùng Node.js filesystem dễ dàng.

---

## 9. Internal Diagram Model

AutoDiagram không nên sinh XML trực tiếp từ input.
Tất cả phải đi qua model trung gian.

Model trung gian cần tách rõ 2 lớp thông tin:

```text
- Semantic data: class, stereotype, attributes, methods, relationships, labels, multiplicity.
- Layout data: size, position, group placement, locked state, edge routing, waypoints.
```

Parser chỉ tạo semantic data. Layout engine mới được ghi layout data. Draw.io exporter chỉ chuyển model đã layout thành XML, không tự suy diễn semantic mới.

Ví dụ:

```ts
export type DiagramDocument = {
  id: string;
  title?: string;
  type: DiagramType;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
  layout?: DiagramLayoutState;
  metadata?: Record<string, unknown>;
};
```

```ts
export type DiagramNode = {
  id: string;
  label: string;
  kind: NodeKind;
  stereotype?: string;
  groupId?: string;
  compartments?: DiagramCompartment[];
  properties?: Record<string, unknown>;
  size?: DiagramSize;
  position?: DiagramPoint;
  locked?: boolean;
  style?: DiagramStyle;
};
```

```ts
export type DiagramEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  kind?: EdgeKind;
  multiplicitySource?: string;
  multiplicityTarget?: string;
  waypoints?: DiagramPoint[];
  style?: DiagramStyle;
};
```

```ts
export type DiagramGroup = {
  id: string;
  label: string;
  kind: "stereotype" | "domain" | "manual";
  nodeIds: string[];
  layoutIntent?: GroupLayoutIntent;
  estimatedSize?: DiagramSize;
};
```

---

## 10. Layout Intent

Layout intent là ý đồ bố cục do user chỉnh.

Nó không phải tọa độ cuối cùng.

Ví dụ với stereotype grid:

```ts
export type GroupLayoutIntent = {
  groupId: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  direction?: "vertical" | "horizontal" | "grid" | "auto";
  alignment?: "start" | "center" | "end";
};
```

Engine sẽ chuyển layout intent thành tọa độ thật.

---

## 11. Pipeline xử lý

Pipeline chuẩn:

```text
1. Read input
2. Parse Mermaid classDiagram
3. Build DiagramDocument
4. Normalize IDs
5. Extract groups
6. Estimate node sizes
7. Estimate group sizes
8. Generate initial layout
9. Apply user layout intent
10. Place nodes
11. Route edges
12. Score layout
13. Optimize
14. Generate mxGraph XML
15. Validate output
16. Export .drawio
```

---

## 12. Size Estimation

Trước khi layout, app phải ước lượng kích thước node.

Với class box:

```text
width = max line length * font factor + padding
height = title height
       + stereotype height
       + attributes count * line height
       + methods count * line height
       + padding
```

Với group:

```text
groupWidth = width sau khi pack node
groupHeight = height sau khi pack node
```

Packing strategy có thể là:

```text
- vertical stack
- horizontal row
- compact grid
- auto
```

Ví dụ:

```text
Controller group: vertical stack
DTO group: compact grid
Entity group: vertical stack
Enum group: compact row hoặc grid
```

---

## 13. Edge Routing

Connector không do user vẽ tay.

Phần mềm phải tự tính:

* Cạnh nào của source box để đi ra.
* Cạnh nào của target box để đi vào.
* Anchor point nào phù hợp.
* Waypoint nào giúp tránh box.
* Đường nào ít crossing hơn.
* Đường nào không đè lên segment khác.

Mục tiêu routing:

```text
1. Không đi xuyên qua box không liên quan.
2. Không đè lên edge khác.
3. Giảm crossing.
4. Giảm số bend.
5. Giữ connector dễ đọc.
```

---

## 14. Layout Scoring

Mỗi layout candidate cần được chấm điểm.

Ví dụ công thức ban đầu:

```text
score =
  boxOverlap       * 1_000_000
+ edgeHitsBox      * 800_000
+ segmentOverlap   * 500_000
+ edgeCrossing     * 100_000
+ edgeBend         * 10_000
+ totalEdgeLength
+ layoutAreaPenalty
```

Candidate có score thấp nhất được chọn.

---

## 15. UI Philosophy

UI của AutoDiagram là **layout UI**, không phải diagram editor.

UI cần giúp người dùng trả lời:

```text
- Nhóm này nên nằm bên trái hay bên phải?
- Entity nên ở gần DTO hay service?
- Class này nên ở trung tâm hay phụ trợ?
- Box này nên lock tại đây không?
- Có nên reroute lại connector không?
```

UI không giúp người dùng vẽ từng shape như draw.io.

---

## 16. UI chính

Các màn chính nên có:

```text
1. Input Panel
2. Extracted Model Panel
3. Layout Control Panel
4. Preview Panel
5. Export Panel
```

---

## 16.1. Input Panel

Cho nhập:

```text
- Mermaid classDiagram
- JSON
- YAML
- paste text
- upload file
```

---

## 16.2. Extracted Model Panel

Hiển thị:

```text
- danh sách class
- stereotype/group
- relationships
- missing/invalid relationships
- warning
```

---

## 16.3. Layout Control Panel

Với stereotype mode:

```text
- grid 10x10
- kéo thả group
- resize group block
- chọn packing trong group
- chọn direction
```

Với business mode:

```text
- kéo thả class box
- lock/unlock box
- reroute edges
- auto arrange unlocked
- reset layout
```

---

## 16.4. Preview Panel

Hiển thị preview sơ đồ.

Preview có thể dùng:

```text
- SVG preview tự sinh
- canvas preview đơn giản
- embedded draw.io
```

Giai đoạn đầu không cần editor đầy đủ.

---

## 16.5. Export Panel

Cho export:

```text
- .drawio
- .xml
- .svg
- .png
```

Có thể có nút:

```text
Open in draw.io
Copy XML
Download .drawio
```

---

## 17. CLI

CLI dùng để chạy local và batch.

Command đề xuất:

```bash
autodiagram generate input.yaml -o output.drawio
autodiagram relayout input.drawio -o clean.drawio
autodiagram validate output.drawio
```

Sau này:

```bash
autodiagram batch ./inputs --out ./outputs
autodiagram convert input.mmd -o output.drawio
```

CLI dùng cùng core với web/desktop.

---

## 18. Client-side Only

AutoDiagram không cần backend.

Mọi xử lý chạy local:

```text
Browser:
  File API
  Web Worker
  Blob download
  IndexedDB/localStorage

Desktop:
  Electron/Tauri file system
  Local processing

CLI:
  Node.js fs
  Local processing
```

Với graph lớn, layout nên chạy trong Web Worker để không block UI.

---

## 19. Tech Stack

Stack đề xuất:

```text
Language: TypeScript
Web: React + Vite
Desktop: Electron hoặc Tauri
CLI: Node.js
Layout: custom layout engine + optional Dagre/ELK.js
XML: custom writer hoặc xmlbuilder2
Storage web: IndexedDB/localStorage
Output: mxGraphModel XML / .drawio
```

Khuyến nghị giai đoạn đầu:

```text
TypeScript + Node CLI + Mermaid parser + mxGraph XML exporter
```

React/Vite nên vào sau khi CLI sinh `.drawio` ổn định. Electron/Tauri nên để sau web app hoặc khi có nhu cầu desktop rõ ràng.

---

## 20. Roadmap MVP

### MVP 0 – Draw.io Output Spike

```text
- Define một input Mermaid classDiagram rất nhỏ.
- Parse được class name, attributes, methods và relationships cơ bản.
- Sinh 3-5 class box với tọa độ cố định hoặc layout đơn giản.
- Sinh mxGraphModel XML hợp lệ.
- Export .drawio mở được bằng draw.io / diagrams.net.
- Chưa cần UI, chưa cần routing thông minh, chưa cần optimize.
```

Mục tiêu của MVP 0 là chứng minh pipeline kỹ thuật quan trọng nhất:

```text
Mermaid classDiagram → DiagramDocument → mxGraph XML → .drawio mở được
```

---

### MVP 1 – Core + CLI

```text
- Define DiagramDocument model
- Parse Mermaid classDiagram
- Estimate class box size
- Generate basic layout
- Generate mxGraph XML
- Export .drawio
- CLI generate command
```

---

### MVP 2 – Stereotype Grid Layout

```text
- Extract stereotype groups
- Estimate group size
- Grid 10x10 layout intent
- Pack classes inside groups
- Route edges between groups
- Export draw.io
```

---

### MVP 3 – Business Layout Assist

```text
- Auto layout business class diagram
- Drag class boxes
- Lock/unlock boxes
- Reroute connector after move
- Optimize unlocked boxes
```

---

### MVP 4 – Web/Desktop UI

```text
- React UI
- Preview diagram
- Layout control panel
- Export panel
- Optional embedded draw.io
```

---

### MVP 5 – Advanced Layout

```text
- Multiple layout candidates
- Layout scoring
- ELK.js/Dagre integration
- Better edge routing
- Batch CLI
```

---

## 21. Hướng mở rộng UML

Sau khi class diagram theo stereotype ổn định, AutoDiagram nên mở rộng dần sang các diagram khác trong bộ UML.

Các hướng ưu tiên sau class diagram:

```text
1. Sequence diagram
2. Use case diagram
3. Component diagram
4. Deployment diagram
5. Activity diagram
6. State machine diagram
```

Nguyên tắc mở rộng:

```text
- Mỗi loại diagram có parser, template và layout strategy riêng.
- Tất cả vẫn đi qua DiagramDocument hoặc một model trung gian tương thích.
- Không biến UI thành editor vẽ tay.
- Người dùng vẫn chỉnh layout intent, app vẫn sinh tọa độ và connector.
- Ưu tiên input text phổ biến như Mermaid trước, rồi mới thêm format khác.
```

Về lâu dài, AutoDiagram có thể trở thành một bộ công cụ sinh nhiều loại UML diagram từ input có cấu trúc, trong đó draw.io là định dạng export và chỉnh sửa cuối.

---

## 22. Success Criteria

AutoDiagram được xem là thành công nếu:

```text
- Người dùng nhập structured input và nhận được file .drawio mở được.
- Layout ban đầu đã đủ tốt để đọc.
- Người dùng có thể chỉnh ý đồ layout nhanh hơn kéo tay trong draw.io.
- Connector tự reroute hợp lý.
- Không cần backend.
- CLI, web và desktop dùng chung core.
- App không biến thành một draw.io clone.
```

---

## 23. Câu chốt

**AutoDiagram là công cụ client-side dùng để sinh và tối ưu layout sơ đồ draw.io từ input có cấu trúc.**

Nó không phải diagram editor.
Nó là layout planning tool và mxGraph XML generator.

Người dùng chỉnh layout intent.
Phần mềm tính toán node position, edge routing và xuất `.drawio`.
draw.io chỉ là nơi mở hoặc chỉnh cuối nếu cần.

---

## 24. MVP 1 Hardening Decision

The current MVP 0 .drawio output is accepted as the first visual baseline because it opens in draw.io and preserves class headers, compartments, and relationships.

Baseline policy:

```text
- Store the MVP 0 baseline output as a tracked test fixture.
- Use structural regression checks instead of exact XML text comparison.
- Keep out/demo.drawio as generated output only.
- Treat exact XML ordering, indentation, and draw.io-generated IDs as non-contract details.
```

MVP 1 hardening focuses on parser, layout, exporter, and CLI confidence before adding stereotype group layout or web UI.

---

## 25. MVP 2a Exact Stereotype Grouping Decision

MVP 2a introduces logical stereotype groups for class diagram layout.

Decision:

```text
- Group labels come from Mermaid stereotype text exactly after removing << >> and trimming outer whitespace.
- Do not alias, lowercase, enum-normalize, or infer stereotype groups.
- Preserve case, spelling, punctuation, internal spaces, and ~ markers inside stereotypes.
- Keep groups logical only for now; draw.io export still emits class boxes and edges, not visible group containers.
- Use a built-in order only when the group label exactly matches a known stereotype.
- Unknown exact stereotypes are still valid groups and are placed after known groups in first-seen order.
```

---

## 26. MVP 2b/2c Group Routing and Visible Frame Decision

MVP 2b and MVP 2c keep group layout pragmatic and deterministic.

Decision:

```text
- Inter-group edges receive simple orthogonal waypoints based on source and target group bounds.
- Same-group edges remain direct in this phase.
- Waypoints are stored in DiagramEdge.layout.waypoints, not in a new core type.
- Visible stereotype groups are exported as background draw.io frames by default.
- Group frames use the exact DiagramGroup.label.
- Group frames are not draw.io parents of class cells.
- Class cells remain top-level cells, and edges still target class cells.
- Advanced crossing minimization, segment overlap scoring, and manual waypoint editing remain out of scope for now.
```

---

## 27. MVP 2d Scored Layout Intent Decision

MVP 2d introduces the first scored layout engine for stereotype class diagrams.

Decision:

```text
- The layout engine generates multiple deterministic candidates and selects the lowest-scoring result.
- Candidate scoring considers node overlaps, group overlaps, edge hits through non-terminal nodes, segment overlaps, crossings, bends, duplicate anchors, route length, and layout area.
- DiagramDocument.layout stores the selected candidate id, evaluated candidate count, grid size, and score metrics.
- The CLI can emit an editable layout intent JSON file after Mermaid import.
- The CLI can generate .drawio output using an edited layout intent JSON file.
- Layout JSON can adjust grid size, group grid placement, packing, and node assignment to layout groups.
- Layout JSON changes layout only and must not mutate semantic stereotype text or relationships.
- Python relayout scripts remain reference material only, not runtime dependencies.
```

---

## 28. MVP 2e Optional Frames and Orthogonal Anchored Routing Decision

MVP 2e changes group frames from default output to an opt-in export visual and makes anchored orthogonal routing the default connector behavior.

Decision:

```text
- Group frames are background visuals only and are hidden by default.
- The CLI exposes group frames with --group-frames; layout JSON does not store frame visibility.
- Draw.io edges use edgeStyle=orthogonalEdgeStyle with curved=0.
- Edges connect class parent cells, not member rows and not group frames.
- Edge layout stores source and target anchors on class bounds.
- Anchor routing prefers 25%, 50%, and 75% side positions.
- Endpoints sharing a class side are ordered by the opposite class position before routing.
- When more endpoints compete for a side, routing can use 20%, 40%, 60%, and 80% ratios or evenly spaced ratios for larger sets.
- Edges sharing a source side receive separate orthogonal lanes so they do not all stack on the same segment.
- Programmatic callers may provide anchorOrders, anchorOrderMode, and anchorOrderVariantLimit to control endpoint ordering on a node side.
- Auto anchor-order variants may change endpoint order when the full route score improves, including cases where a longer orthogonal detour reduces crossings.
- The scored layout search may reorder classes inside a fixed stereotype group using bounded reverse, degree-based, name-based, and small permutation variants when the resulting score improves.
- Explicit layout intent locks group grid positions. After a user saves a group grid preset, reruns may reroute edges and reorder classes inside each group, but must not auto-move groups to different grid cells.
- Draw.io export serializes routed bend/control points in `<Array as="points">` as plain `<mxPoint x="..." y="..." />` entries; it does not emit `sourcePoint` or `targetPoint`.
- Route scoring works on vectorized orthogonal segments and penalizes non-terminal class hits, segment overlaps, crossings, duplicate anchors, bends, Manhattan route length, and layout area. Crossing penalties are intentionally much larger than bend and length penalties so longer routes can win when they reduce crossing count.
- Fixed-grid reruns use a larger bounded search budget and try local anchor-order variants per node side, including split fan-out and bounded bucket permutations, so explicit grid presets can still find crossing-reducing detours instead of falling back to the original edge order.
- After selecting the winning routed layout, a post-routing refinement pass may move anchors away from evenly spaced `1/(n+1)` ratios or onto a better adjacent side, then rewrite edge waypoints, but only when the full layout score improves.
- The web UI exposes the generated layout score, crossing count, node-hit count, and bend count in the summary panel.
- Mermaid layout calculation should leave render first, then show a lightweight loading overlay with compact candidate/score context while the synchronous layout job runs.
- Group-grid popup edits are draft-only. Opening the popup should derive the matrix from the currently displayed layout until the user saves a grid preset; after that, opening the popup should use the saved preset. Moving, resizing, or rotating groups in the matrix should not run layout until the user presses Save.
- Python relayout scripts remain reference material only, not runtime dependencies.
```

---

## 29. MVP Web UI Decision

Decision:

```text
- Add a client-side React + Vite web app under apps/web.
- The first screen is the working AutoDiagram tool, not a landing page.
- The web app uses the existing Mermaid parser, stereotype layout engine, and draw.io exporter directly in the browser.
- The UI supports Mermaid input, extracted model inspection, numeric layout intent controls, embedded draw.io preview, and .drawio/XML export.
- Layout editing starts with gridX/gridY/gridWidth/gridHeight and packing controls for stereotype groups.
- Drag-and-drop group editing, manual node editing, and manual waypoint editing remain deferred.
- Embedded draw.io preview uses embed.diagrams.net with the JSON postMessage protocol.
- AutoDiagram does not persist manual edits made inside the draw.io iframe; Mermaid source and layout intent remain the source of truth.
- Export must continue to work when the external draw.io iframe cannot load.
```

---

## 30. mxGraph-First Web Layout Editor Decision

Decision:

```text
- The web UI should evolve into a specialized class diagram layout editor, not a draw.io clone.
- mxGraphModel / .drawio XML is the source of truth after import or generation.
- SVG is only a preview/export view layer and must never be converted back into mxGraphModel.
- Mermaid import still flows through DiagramDocument and the existing draw.io exporter, then enters the mxGraph editor state.
- XML/.drawio import parses mxCell ids, parent/child structure, style, value, source, target, mxGeometry, anchors, and Array as="points".
- Layout edits write directly to mxGraphModel: class mxGeometry, group mxGeometry, edge exit/entry anchors, and edge mxPoint waypoints.
- Edge source/target must resolve to class parent cells. Edges pointing to member rows should be warned about and normalized to parent class cells when applying validation fixes.
- The app may expose numeric controls for class geometry, edge anchors, and waypoints before full drag/resize interaction.
- The UI should show compact tabs for Classes, Edges, Groups, Extends, and Layout JSON.
- Semantic UML content stays read-only in the layout editor: class names, stereotypes, attributes, methods, relationship source/target, labels, and multiplicity are not edited here.
```

---

## 31. Interactive SVG Canvas Decision

Decision:

```text
- The web canvas can support direct layout interaction while keeping mxGraphModel as source of truth.
- Logical groups remain available for layout data and inspector panels, but visible group frames stay off by default and only render when the Group frames toggle is enabled.
- Undo/redo should restore mxGraphModel layout snapshots. Drag gestures should be coalesced into a single history checkpoint so undo does not step through every mousemove.
- Left input/data and right layout-info panels can collapse to small buttons so the diagram gets more working area.
- Ctrl + mouse wheel zooms the internal SVG preview.
- Native canvas overflow provides horizontal and vertical scrolling.
- Holding Alt and dragging pans the scroll container.
- Click-drag on empty canvas creates a marquee selection rectangle.
- Selection can contain multiple classes, groups, and edges. Shift/Ctrl/Command click toggles items, and marquee selection returns all components intersecting the marquee rectangle.
- Dragging a class updates the parent class cell mxGeometry x/y.
- Dragging a selected class moves the selected class set and re-normalizes incident edge routes so source/target anchor movement does not create diagonal segments.
- Edge editing should not expose raw mxPoint editing as the primary UX.
- Edge hit targets should be larger than the visible line and should scale inversely with zoom so thin edges remain selectable at common zoom presets.
- Selecting an edge shows midpoint handles on route segments.
- Dragging a segment midpoint moves that segment along its perpendicular axis and updates the edge Array as="points".
- Segment edits must preserve orthogonal route geometry. If an imported or intermediate route contains a diagonal segment, the edit path is normalized back to horizontal/vertical segments before writing mxPoint[].
- Dragging source/target terminal handles onto a class side updates the edge source/target cell and computes side anchors.
- Dropping a terminal handle on a class side uses that drop position to reorder anchors on the side; dragging anchor A to the right/below anchor B makes B appear before A in the side order.
- After a terminal drop, anchors on that side are redistributed with evenly spaced ratios in the user-controlled order.
- These interactions are layout edits only. They do not edit UML semantic content or convert SVG back into mxGraph.
```

---

## 32. Group Grid Intent UI Decision

Decision:

```text
- The right Layout Info panel exposes stereotype group placement as a group-grid matrix, not as raw column/row number fields.
- The group-grid matrix opens in a large popup from the right Layout Info panel so group drag/drop has enough working area.
- The first supported matrix sizes are 10x10 and 15x15.
- Group tokens can be drag-dropped on the grid board; the UI rounds pointer position to gridX/gridY, previews the computed x/y/span, and writes only gridX/gridY/gridWidth/gridHeight in StereotypeLayoutIntent.
- Group footprint estimation uses the class width/height set and the group's packing mode to estimate vertical or compact-grid packed bounds, then maps that measured area to a compact matrix footprint so normal groups do not reserve excessive cells.
- Rotation is a per-group packing operation: it toggles vertical versus horizontal arrangement and recalculates the group footprint from the unchanged class dimensions. It must not swap width and height as if class boxes themselves could rotate, and explicit user intent must not be overridden by scored packing variants.
- The preview canvas should not show a visual grid background; the group-grid matrix is the dedicated layout-intent control.
- The preview should render all class attribute and method rows in separate compartments; it should not hide member rows behind a fixed row limit.
```
