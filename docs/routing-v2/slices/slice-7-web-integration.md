# Slice 7: Web Integration

Artifacts:

- group drag updates `CoordinateRoutingLayoutV3`
- packing toggle reroutes
- node order change reroutes
- generated edges rerouted
- manual mxGraph overrides preserved

Gate:

- route-only does not overwrite manual overrides
- only explicit reroute selected/all can overwrite overrides
- debug panel consumes `LayoutRunReport`
