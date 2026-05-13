# Web Ownership

The web app is mxGraph-first today. Routing v2 integration must preserve generated-vs-manual ownership.

Generated-owned:

- generated node geometry
- generated group frames
- generated anchors
- generated edge waypoints
- generated routing dividers

User override-owned:

- manually moved class
- manually edited edge segment
- manual mxGraph edits

Route-only must not overwrite manual overrides unless the user explicitly reroutes selected edges or all edges. The debug panel should consume `LayoutRunReport`.
