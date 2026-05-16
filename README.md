# Additional README Sections

## Vision

AutoDiagram is an open-source diagram generation engine focused on converting structured software architecture input into editable UML diagrams.

The long-term project goal is:

```text id="7s84e8"
source code / architecture metadata
    ↓
semantic intermediate model
    ↓
deterministic layout + routing
    ↓
editable UML diagrams
```

The project is intended to support multiple diagram types in the future, including:

* UML class diagrams
* sequence diagrams
* component diagrams
* entity relationship diagrams
* architecture dependency graphs
* bounded-context maps
* infrastructure topology diagrams

Current development focuses primarily on UML class diagrams.

---

# Current Input Model

AutoDiagram currently requires structured input.

The engine does not yet perform full codebase semantic extraction or generalized knowledge-graph inference.

At the moment, the supported production input format is:

* Mermaid `classDiagram`

This means:

```text id="2lkgwy"
codebase
→ structured semantic representation
→ AutoDiagram
```

rather than:

```text id="4bq8oq"
raw source code
→ automatic semantic understanding
→ diagram
```

Knowledge-graph generation and large-scale semantic code extraction are future roadmap items.

The current architecture intentionally separates:

* parsing
* semantic modeling
* layout
* routing
* export

so additional language parsers and semantic extractors can be added later without rewriting the routing or draw.io export engines.

---

# Open Source Status

AutoDiagram is intended as an open-source infrastructure project.

The repository is designed to support:

* reusable layout/routing packages
* CLI usage
* web-based editing
* future language adapters
* external integrations

The codebase favors:

* deterministic behavior
* stable intermediate models
* explicit diagnostics
* testable routing behavior
* reproducible export output

---

# NPM Packages

The project exposes reusable packages through npm.

Example installation:

```bash id="fuxzpq"
npm install @autodiagram/core
npm install @autodiagram/parser-mermaid
npm install @autodiagram/layout
npm install @autodiagram/export-drawio
```

Example usage:

```ts id="d6qkj7"
import { parseMermaidClassDiagram } from "@autodiagram/parser-mermaid";
import { generateLayout } from "@autodiagram/layout";
import { exportDrawioXml } from "@autodiagram/export-drawio";

const document = parseMermaidClassDiagram(input);
const layout = generateLayout(document);

const xml = exportDrawioXml(layout);
```

CLI installation:

```bash id="ygd8kt"
npm install -g @autodiagram/cli
```

CLI usage:

```bash id="n6mnfp"
autodiagram generate input.mmd -o output.drawio
```

---

# Codebase Standards

The project prioritizes long-term maintainability and deterministic behavior.

All contributions should follow the standards below.

---

# Versioning Policy

AutoDiagram follows Semantic Versioning:

```text id="hj2vr8"
MAJOR.MINOR.PATCH
```

Rules:

* MAJOR:
  breaking intermediate model or public API changes
* MINOR:
  backward-compatible features
* PATCH:
  bug fixes and deterministic behavior fixes

Examples:

```text id="jlwm4u"
2.0.0
2.3.0
2.3.4
```

Routing score changes that alter generated layout topology should be treated as MINOR changes because output structure may differ even if APIs remain stable.

Intermediate model schema changes must include migration notes.

---

# Naming Conventions

## TypeScript

### Types

Use PascalCase:

```ts id="q4az0l"
DiagramDocument
RoutingCandidate
LayoutDiagnostics
```

### Functions

Use camelCase:

```ts id="gkjlwm"
generateLayout()
routeConnectorGraph()
exportDrawioXml()
```

### Constants

Use SCREAMING_SNAKE_CASE only for true immutable constants:

```ts id="jib04j"
MAX_ROUTE_REPAIR_ITERATIONS
DEFAULT_GROUP_PADDING
```

### Files

Use:

```text id="qjlwmr"
kebab-case.ts
```

Examples:

```text id="8bxg4x"
template-router.ts
drawio-exporter.ts
routing-diagnostics.ts
```

Avoid:

```text id="n7qv1p"
TemplateRouter.ts
drawIOExporter.ts
```

---

# Routing Terminology Rules

Use terminology consistently across the repository.

Preferred terms:

| Preferred          | Avoid         |
| ------------------ | ------------- |
| semantic edge      | original edge |
| physical connector | rendered edge |
| divider            | split node    |
| waypoint           | bend point    |
| route repair       | cleanup       |
| hard validation    | strict mode   |

This is important because routing-v2 internally distinguishes:

```text id="lcuh2s"
semantic relationships
vs
physical routed segments
```

---

# Determinism Requirements

Deterministic output is a core architectural constraint.

The following are prohibited unless explicitly documented:

* random layout placement
* unstable iteration ordering
* nondeterministic hash iteration
* timestamp-derived IDs
* UUID-based exported cell IDs

Generated IDs must remain stable across runs.

Allowed:

```text id="jlwmg8"
node_1
edge_7
divider_2
```

Disallowed:

```text id="mjlwm3"
550e8400-e29b-41d4-a716-446655440000
```

---

# Public API Rules

Public packages should expose stable entry points.

Preferred:

```ts id="5st0jv"
@autodiagram/layout
@autodiagram/core
```

Avoid deep imports:

```ts id="07a1n3"
@autodiagram/layout/src/internal/router
```

Internal routing implementations may change between minor versions.

---

# Intermediate Model Stability

`DiagramDocument` is the primary semantic contract.

Layout and export systems should treat it as immutable semantic input.

Routing metadata belongs in:

```text id="jqh4d7"
document.layout
```

rather than semantic node definitions.

The architecture intentionally separates:

```text id="m9iycw"
semantic state
vs
layout state
vs
export state
```

---

# Testing Requirements

All routing and layout contributions should include:

* deterministic regression tests
* routing validation tests
* export compatibility tests
* overlap/crossing assertions
* fixture diagrams

Routing fixes should include:

```text id="i53nfr"
input
→ expected diagnostics
→ expected hard-validation state
```

rather than relying solely on screenshot comparison.

---

# XML Export Rules

The exporter should remain:

* deterministic
* human-readable
* stable under formatting changes

Avoid:

* compressed draw.io blobs
* unnecessary XML mutations
* exporter-side rerouting
* hidden geometry rewriting

Routing ownership belongs to the routing engine, not the exporter.

---

# Future Direction

Planned future work includes:

* source-code semantic extraction
* knowledge graph generation
* language-specific adapters
* incremental layout updates
* collaborative editing
* additional UML diagram types
* graph database integration
* LLM-assisted semantic enrichment
* architecture rule validation

The long-term architecture target is:

```text id="wv0l0d"
codebase
→ semantic graph
→ architecture model
→ deterministic diagram generation
→ editable visual workspace
```

while preserving deterministic export behavior and stable routing semantics.
