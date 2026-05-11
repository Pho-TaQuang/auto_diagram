---
name: logical-class-diagram-relayout
description: "Relayout draw.io/diagrams.net mxGraphModel XML class diagrams at logical code level using a fixed business-code architecture layout: Controller, ManagerInterface, Manager, Adapter/DataAccessAdapter, LLBLGen Entity, DTO/Model, and related/support classes. Use when Codex is asked to relayout logical/code-aligned class diagrams, Mau 08/TKPM logical class diagrams, controller-manager-entity diagrams, or draw.io files from diagram/ori into diagram/relayout while preserving class text and relationships."
---

# Logical Class Diagram Relayout

## Workflow

1. Preserve all semantic content: class names, stereotypes, attributes, methods, enum entries, edge labels, multiplicities, source/target relationships, and parent-child cell structure.
   - Never change an edge `source` or `target` from a top-level class box to a child/member row, even if a manually edited reference diagram accidentally did so.
   - Treat member-row endpoints such as a method or field cell as accidental unless the user explicitly asks for implementation-member ports.
2. Change only layout data:
   - top-level class-box `mxGeometry` `x`/`y`
   - edge routing keys such as `edgeStyle`, `curved`, `exitX`, `exitY`, `entryX`, `entryY`
   - edge waypoint `<Array as="points">`
3. Classify top-level boxes by visible text and stereotype, never by draw.io cell ID.
4. Apply this role layout:

```text
                    adapter factory -------- data access adapter
                            |                         |
controller -- manager interface -- manager -------- primary entity
      |                                  |                |
primary model -- page/search dto -- option model     related entities
                         |
                    dto base / PageModel
```

5. Stack entities vertically in one entity band. Align the primary entity with the manager so the manager-to-primary-entity relation can route horizontally; keep related/reference entities below the primary entity.
6. Put primary domain model, page/search DTO, and option/reference models in one horizontal model band below the controller/manager band. Put base DTO classes such as `PageModel` under the derived DTO when an `extends` relation exists.
7. Place AdapterFactory/DataAccessAdapter/adapter classes as a horizontal adapter row above manager/entity: factory adapters above the manager side, data-access adapters above the entity side.
8. Put unknown support classes in a vertical support column to the right, only when they cannot be classified as controller, interface, manager, adapter, entity, or model.
9. After relayout, verify every edge keeps the same `source` and `target` IDs it had before the script ran.

## Script

Use `scripts/relayout_logical_class.py` for repeatable work.

Default sample usage:

```powershell
python C:\Users\Admin\.codex\skills\logical-class-diagram-relayout\scripts\relayout_logical_class.py D:\bca\diagram\ori\dmLucLuong.drawio
```

When no output path is provided:

- If the input is `...\diagram\ori\<name>.drawio`, write `...\diagram\relayout\<name>_relayout.drawio`.
- If the input is elsewhere, copy the original to `../diagram/ori/` relative to the current project root and write to `../diagram/relayout/`.
- If no input is provided, process all `.drawio` files under `../diagram/ori/`.

Explicit output remains supported:

```powershell
python C:\Users\Admin\.codex\skills\logical-class-diagram-relayout\scripts\relayout_logical_class.py input.drawio output.drawio
```

Process a whole folder:

```powershell
python C:\Users\Admin\.codex\skills\logical-class-diagram-relayout\scripts\relayout_logical_class.py D:\bca\diagram\ori D:\bca\diagram\relayout
```

Use `--keep-vertices` to preserve class-box coordinates and only reroute connectors.

Use `--strict` when a failed strict route should stop the run instead of falling back to simple orthogonal routing.

## Classification Rules

- `Controller`: stereotype or class name contains `Controller`.
- `ManagerInterface`: stereotype contains `ManagerInterface`, or class name starts with `I` and ends with `Manager`.
- `Manager`: stereotype or class name contains `Manager`, excluding ManagerInterface.
- `Adapter`: stereotype or class name contains `Adapter`, `AdapterFactory`, or `DataAccessAdapter`.
- `Entity`: stereotype or class name contains `Entity`, including `LLBLGenEntity`.
- `Model`: stereotype or class name contains `Model`, `DTO`, `DTOBase`, `PageModel`, `SearchModel`, or `OptionModel`.

For the primary entity, prefer the entity whose normalized name matches the controller/manager domain root, such as `DmLucLuongController` -> `SysdmLucLuongEntity`. If no name match exists, choose the highest-degree/tallest entity.

## Validation

After relayout, open the output path or inspect it in draw.io. The script first tries the stricter router from `drawio-diagram-relayout`; if routing is too dense, it falls back to simple orthogonal edge routing unless `--strict` is set.

The script validates edge endpoint preservation after routing. If a future change accidentally reattaches an edge to a class member row, the run must fail instead of writing a semantically changed diagram.
