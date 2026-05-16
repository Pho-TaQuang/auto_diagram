export type DiagramType = "classDiagram";

export type DiagnosticSeverity = "warning" | "error";

export type ClassMemberKind = "attribute" | "method";

export type RelationshipKind =
  | "dependency"
  | "realization"
  | "inheritance"
  | "association"
  | "directedAssociation"
  | "aggregation"
  | "composition"
  | "dashedAssociation";

export type RelationshipOperator =
  | "..>"
  | "<.."
  | "<|.."
  | "..|>"
  | "<|--"
  | "--|>"
  | "--"
  | "-->"
  | "<--"
  | "o--"
  | "--o"
  | "*--"
  | "--*"
  | "..";

export type Visibility = "+" | "-" | "#" | "~";

export type LayoutDiagnosticReason =
  | "edge-node-hit"
  | "divider-node-hit"
  | "endpoint-divider-interior-hit"
  | "illegal-segment-overlap"
  | "routing-failure"
  | "invalid-divider"
  | "divider-side-overflow"
  | "edge-crossing";

export type LayoutRecommendedAction =
  | {
      kind: "increase-gap";
      betweenGroupIds: [string, string];
      direction: "x" | "y";
      amount: number;
    }
  | {
      kind: "move-group";
      groupId: string;
      direction: "left" | "right" | "up" | "down";
      amount: number;
    }
  | {
      kind: "change-packing";
      groupId: string;
      from: "vertical" | "horizontal";
      to: "vertical" | "horizontal";
    }
  | {
      kind: "reorder-nodes";
      groupId: string;
      suggestedNodeOrder: string[];
    };

export type DiagramDiagnostic = {
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
  type?: "layout-change-required" | "edge-crossing" | "divider-side-overflow";
  reason?: LayoutDiagnosticReason;
  edgeIds?: string[];
  groupIds?: string[];
  recommendedAction?: LayoutRecommendedAction;
  data?: Record<string, unknown>;
};

export type DiagramPoint = {
  x: number;
  y: number;
};

export type DiagramSize = {
  width: number;
  height: number;
};

export type DiagramEdgeAnchorSide = "north" | "east" | "south" | "west";

export type DiagramEdgeAnchor = {
  side: DiagramEdgeAnchorSide;
  ratio: number;
};

export type DiagramRoutedEdgeSegmentStrategy =
  | "direct"
  | "corridor"
  | "outer-lane"
  | "divider"
  | "fallback";

export type DiagramRoutedEdgeMarkerPolicy = {
  start: boolean;
  end: boolean;
};

export type DiagramRoutedEdgeSegment = {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceAnchor?: DiagramEdgeAnchor;
  targetAnchor?: DiagramEdgeAnchor;
  waypoints: DiagramPoint[];
  markerPolicy: DiagramRoutedEdgeMarkerPolicy;
  strategy: DiagramRoutedEdgeSegmentStrategy;
};

export type DiagramNodeLayout = DiagramPoint & DiagramSize & {
  headerHeight: number;
  lineHeight: number;
  separatorHeight: number;
};

export type DiagramEdgeLayout = {
  waypoints?: DiagramPoint[];
  sourceAnchor?: DiagramEdgeAnchor;
  targetAnchor?: DiagramEdgeAnchor;
  routedSegments?: DiagramRoutedEdgeSegment[];
  routeSource?: "engine-v2";
};

export type DiagramLayoutScore = {
  value: number;
  nodeOverlaps: number;
  groupOverlaps: number;
  edgeNodeHits: number;
  segmentOverlaps: number;
  edgeCrossings: number;
  edgeBends: number;
  duplicateAnchors: number;
  totalEdgeLength: number;
  layoutWidth: number;
  layoutHeight: number;
  layoutArea: number;
  dividerNodeHits?: number;
  endpointDividerInteriorHits?: number;
  dividerSideOverflow?: number;
  edgeIdentityViolations?: number;
  illegalSegmentOverlaps?: number;
  outerLaneUsages?: number;
  routingFailures?: number;
};

export type DiagramLayoutEngine =
  | "stereotype-scored"
  | "manual-routing-v2"
  | "suggest-initial-v2"
  | "auto-arrange-v2";

export type DiagramLayoutState = {
  engine: DiagramLayoutEngine;
  score: DiagramLayoutScore;
  diagnostics?: DiagramDiagnostic[];
  selectedCandidateId?: string;
  candidatesEvaluated?: number;
  grid?: {
    columns: number;
    rows: number;
  };
};

export type DiagramGroupKind = "stereotype" | "synthetic";

export type DiagramGroupPacking = "vertical" | "horizontal" | "compactGrid";

export type DiagramGroupPackingV2 = "vertical" | "horizontal";

export type GroupLayoutIntent = {
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  packing: DiagramGroupPacking;
};

export type DiagramGroupLayout = DiagramPoint & DiagramSize;

export type DiagramRoutingDividerOrientation = "vertical" | "horizontal";

export type DiagramRoutingDividerMode = "fanOut" | "fanIn";

export type DiagramRoutingDividerLayout = DiagramPoint & DiagramSize;

export type ClassMember = {
  kind: ClassMemberKind;
  visibility?: Visibility;
  name: string;
  text: string;
  returnType?: string;
};

export type DiagramNode = {
  id: string;
  label: string;
  kind: "class";
  stereotype?: string;
  groupId?: string;
  attributes: ClassMember[];
  methods: ClassMember[];
  layout?: DiagramNodeLayout;
};

export type DiagramGroup = {
  id: string;
  label: string;
  kind: DiagramGroupKind;
  nodeIds: string[];
  layoutIntent?: GroupLayoutIntent;
  layout?: DiagramGroupLayout;
};

export type DiagramEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
  operator: RelationshipOperator;
  label?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  layout?: DiagramEdgeLayout;
};

export type DiagramRoutingDivider = {
  id: string;
  orientation: DiagramRoutingDividerOrientation;
  side: DiagramEdgeAnchorSide;
  sourceEdgeIds: string[];
  mode: DiagramRoutingDividerMode;
  layout: DiagramRoutingDividerLayout;
  commonNodeId?: string;
  remoteGroupId?: string;
  remoteNodeIds?: string[];
  sideSlot?: number;
  sideOffset?: number;
};

export type DiagramDocument = {
  id: string;
  type: DiagramType;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
  routingDividers?: DiagramRoutingDivider[];
  layout?: DiagramLayoutState;
  diagnostics: DiagramDiagnostic[];
};

export function createClassNode(id: string): DiagramNode {
  return {
    id,
    label: id,
    kind: "class",
    attributes: [],
    methods: []
  };
}

export function relationshipKindFromOperator(operator: RelationshipOperator): RelationshipKind {
  switch (operator) {
    case "..>":
    case "<..":
      return "dependency";
    case "<|..":
    case "..|>":
      return "realization";
    case "<|--":
    case "--|>":
      return "inheritance";
    case "--": return "association";
    case "-->":
    case "<--":
      return "directedAssociation";
    case "o--":
    case "--o":
      return "aggregation";
    case "*--":
    case "--*":
      return "composition";
    case "..":
      return "dashedAssociation";
  }
}
