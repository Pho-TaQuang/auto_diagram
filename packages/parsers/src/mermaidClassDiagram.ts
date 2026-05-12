import {
  createClassNode,
  type ClassMember,
  type DiagramDiagnostic,
  type DiagramDocument,
  type DiagramEdge,
  type DiagramNode,
  relationshipKindFromOperator,
  type RelationshipOperator,
  type Visibility
} from "../../core/src/index.js";

const classBlockStartPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/;
const classDeclarationPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const inlineStereotypePattern = /^<<([^>]+)>>\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const relationshipPattern = /^([A-Za-z_][A-Za-z0-9_]*)\s+(<\|\.\.|<\|--|\.\.\|>|--\|>|-->|o--|\*--|<--|<\.\.|--o|--\*|\.\.>|--|\.\.)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(.+))?$/;

export function parseMermaidClassDiagram(source: string): DiagramDocument {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const orderedNodes: DiagramNode[] = [];
  const declaredNodeIds = new Set<string>();

  const ensureNode = (id: string): DiagramNode => {
    const existing = nodes.get(id);
    if (existing) {
      return existing;
    }

    const node = createClassNode(id);
    nodes.set(id, node);
    orderedNodes.push(node);
    return node;
  };

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let currentNode: DiagramNode | undefined;
  let sawClassDiagram = false;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("%%")) {
      return;
    }

    if (line === "classDiagram") {
      sawClassDiagram = true;
      return;
    }

    if (currentNode) {
      if (line === "}") {
        currentNode = undefined;
        return;
      }

      const stereotype = parseStereotype(line);
      if (stereotype) {
        currentNode.stereotype = stereotype;
        return;
      }

      const member = parseClassMember(line);
      if (member.kind === "method") {
        currentNode.methods.push(member);
      } else {
        currentNode.attributes.push(member);
      }
      return;
    }

    const classBlockMatch = line.match(classBlockStartPattern);
    if (classBlockMatch) {
      currentNode = ensureNode(classBlockMatch[1]);
      declaredNodeIds.add(currentNode.id);
      return;
    }

    const classDeclarationMatch = line.match(classDeclarationPattern);
    if (classDeclarationMatch) {
      declaredNodeIds.add(ensureNode(classDeclarationMatch[1]).id);
      return;
    }

    const inlineStereotypeMatch = line.match(inlineStereotypePattern);
    if (inlineStereotypeMatch) {
      const stereotype = parseStereotypeBody(inlineStereotypeMatch[1]);
      if (stereotype) {
        const node = ensureNode(inlineStereotypeMatch[2]);
        node.stereotype = stereotype;
        declaredNodeIds.add(node.id);
      }
      return;
    }

    const relationshipMatch = line.match(relationshipPattern);
    if (relationshipMatch) {
      const [, sourceId, operator, targetId, label] = relationshipMatch;
      ensureNode(sourceId);
      ensureNode(targetId);
      const typedOperator = operator as RelationshipOperator;
      edges.push({
        id: `edge_${edges.length + 1}_${sourceId}_${targetId}`,
        sourceId,
        targetId,
        operator: typedOperator,
        kind: relationshipKindFromOperator(typedOperator),
        label: label ? normalizeGenericMarkers(label.trim()) : undefined
      });
      return;
    }

    diagnostics.push({
      severity: "warning",
      message: `Unsupported Mermaid classDiagram line: ${line}`,
      line: lineNumber
    });
  });

  if (!sawClassDiagram) {
    diagnostics.push({
      severity: "warning",
      message: "Input does not start with a Mermaid classDiagram declaration."
    });
  }

  if (currentNode) {
    diagnostics.push({
      severity: "warning",
      message: `Class block for ${currentNode.label} was not closed.`
    });
  }

  for (const node of orderedNodes) {
    if (!declaredNodeIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        message: `Class ${node.id} is referenced by a relationship but has no class declaration or stereotype; generated as an empty class in the Ungrouped layout group.`
      });
    }
  }

  return {
    id: "diagram",
    type: "classDiagram",
    nodes: orderedNodes,
    edges,
    diagnostics
  };
}

function parseStereotype(line: string): string | undefined {
  const match = line.match(/^<<([^>]+)>>$/);
  return match ? parseStereotypeBody(match[1]) : undefined;
}

function parseStereotypeBody(value: string): string | undefined {
  const exactStereotype = value.trim();
  return exactStereotype || undefined;
}

function parseClassMember(line: string): ClassMember {
  const normalized = normalizeGenericMarkers(line);
  const visibility = parseVisibility(normalized);
  const textAfterVisibility = visibility ? normalized.slice(1).trim() : normalized.trim();
  const closingParenIndex = normalized.lastIndexOf(")");

  if (normalized.includes("(") && closingParenIndex >= 0) {
    const signature = normalized.slice(0, closingParenIndex + 1).trim();
    const returnType = normalized.slice(closingParenIndex + 1).trim();
    return {
      kind: "method",
      visibility,
      name: parseMemberName(textAfterVisibility),
      returnType: returnType || undefined,
      text: returnType ? `${signature} : ${returnType}` : signature
    };
  }

  return {
    kind: "attribute",
    visibility,
    name: parseMemberName(textAfterVisibility),
    text: normalized
  };
}

function parseVisibility(value: string): Visibility | undefined {
  const first = value[0];
  return first === "+" || first === "-" || first === "#" || first === "~" ? first : undefined;
}

function parseMemberName(value: string): string {
  const match = value.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : value.split(/\s+/)[0] ?? value;
}

function normalizeGenericMarkers(value: string): string {
  let open = true;
  let result = "";

  for (const character of value) {
    if (character === "~") {
      result += open ? "<" : ">";
      open = !open;
      continue;
    }

    result += character;
  }

  return result;
}
