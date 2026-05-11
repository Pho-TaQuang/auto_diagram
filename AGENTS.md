# AGENTS.md

## Project Context

AutoDiagram is a client-side tool for generating and optimizing draw.io / diagrams.net diagrams from structured input.

The product is not a diagram editor and must not grow into a draw.io clone. The core user workflow is:

```text
structured input
→ intermediate diagram model
→ layout intent
→ automatic node placement and connector routing
→ .drawio / mxGraph XML export
```

The first product scope is UML class diagrams using stereotype-based layout. The first input format is Mermaid `classDiagram`.

## Documentation Rules

- Public-facing documentation must be written in English.
- Internal planning notes may stay in Vietnamese when they are clearly not public docs.
- When adding or changing a feature, update the relevant README or documentation page.
- Keep `docs/user_thought.md` aligned with major product decisions until a formal product spec replaces it.

## Product Boundaries

AutoDiagram should:

- Generate valid `mxGraphModel` XML and `.drawio` files.
- Open generated output in draw.io / diagrams.net.
- Let users adjust layout intent rather than edit individual shapes.
- Run fully client-side where possible.
- Share core logic across CLI, web, and future desktop apps.

AutoDiagram should not:

- Become a general free-form drawing editor.
- Replace draw.io.
- Add manual shape editing, manual waypoint editing, or detailed style editing before the core generation flow is stable.
- Require a backend for the main generation pipeline.
- Couple the core model to one narrow business domain.

## Initial Implementation Priorities

Start with the smallest useful pipeline:

```text
Mermaid classDiagram → DiagramDocument → mxGraph XML → .drawio
```

Recommended MVP order:

1. Draw.io output spike:
   - Parse a tiny Mermaid `classDiagram`.
   - Create 3-5 class boxes.
   - Generate valid mxGraph XML.
   - Export a `.drawio` file that opens in diagrams.net.
2. Core + CLI:
   - Define the intermediate diagram model.
   - Parse Mermaid class diagrams.
   - Estimate class box sizes.
   - Generate a basic layout.
   - Add a CLI `generate` command.
3. Stereotype Grid Layout:
   - Extract stereotype groups.
   - Pack classes inside groups.
   - Apply group-level layout intent.
   - Route edges at a basic level.
4. Web UI:
   - Add input, extracted model, layout controls, preview, and export panels.

Defer Electron/Tauri until the CLI and web workflow are useful.

## Architecture Guidance

Prefer a modular TypeScript workspace:

```text
apps/
  cli/
  web/
  desktop/

packages/
  core/
  parsers/
  layout/
  drawio/
  templates/
  preview/
```

Keep package responsibilities strict:

- `packages/core`: intermediate model, validation, ID normalization, metadata.
- `packages/parsers`: convert input formats into the intermediate model.
- `packages/layout`: estimate sizes, place nodes, route edges, score layouts.
- `packages/drawio`: convert laid-out models into mxGraph XML / `.drawio`.
- `packages/templates`: reusable styles and spacing defaults.
- `apps/cli`: local generation, validation, and regression testing.
- `apps/web`: client-side input, preview, layout intent controls, and export.

## Model Rules

Do not generate draw.io XML directly from input parsers.

Keep semantic data separate from layout data:

- Semantic data: class names, stereotypes, attributes, methods, relationships, labels, multiplicity, source, target.
- Layout data: sizes, positions, group placement, locked state, edge routing, waypoints.

Parsers should create semantic data. Layout code should create or update layout data. Exporters should only serialize the final model and must not invent new semantic meaning.

## Layout Guidance

The first layout strategy is stereotype-based class diagram layout.

Use groups such as:

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

Early edge routing should be pragmatic:

- Prefer draw.io orthogonal edge styles first.
- Generate simple waypoints before attempting advanced custom routing.
- Prioritize avoiding node overlap and invalid XML over perfect edge aesthetics.
- Add scoring and advanced routing only after basic export is reliable.

## Future Direction

After stereotype-based class diagrams are stable, AutoDiagram should expand to other UML diagram types:

- Sequence diagram
- Use case diagram
- Component diagram
- Deployment diagram
- Activity diagram
- State machine diagram

Each diagram type should have its own parser support, templates, and layout strategy while still using a compatible intermediate model.
