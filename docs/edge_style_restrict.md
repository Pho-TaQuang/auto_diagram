# UML Class Relationship Edge Styles

This table documents the Mermaid classDiagram operators currently supported by AutoDiagram and the draw.io marker style emitted for each relationship.

Parser rule: `sourceId` and `targetId` keep the same left-to-right order as the Mermaid line. Export rule: the concrete operator decides whether the marker is written on the draw.io start or end side.

| UML relationship | Meaning | Mermaid operator | draw.io marker side | Style essentials |
| --- | --- | --- | --- | --- |
| Association | Two classes are related | `A -- B` | none | `startArrow=none;endArrow=none;` |
| Directed association | A navigates to B | `A --> B` | end | `endArrow=open;endFill=0;` |
| Directed association | A navigates to B, written with the arrow on the left | `B <-- A` | start | `startArrow=open;startFill=0;` |
| Aggregation | Whole-part, part can live independently | `Whole o-- Part` | start | `startArrow=diamondThin;startFill=0;` |
| Aggregation | Whole-part, diamond on the right | `Part --o Whole` | end | `endArrow=diamondThin;endFill=0;` |
| Composition | Strong whole-part lifecycle ownership | `Whole *-- Part` | start | `startArrow=diamondThin;startFill=1;` |
| Composition | Strong whole-part, diamond on the right | `Part --* Whole` | end | `endArrow=diamondThin;endFill=1;` |
| Inheritance | Child extends parent | `Parent <|-- Child` | start | `startArrow=block;startFill=0;` |
| Inheritance | Child extends parent, triangle on the right | `Child --|> Parent` | end | `endArrow=block;endFill=0;` |
| Realization | Class implements interface | `Interface <|.. Class` | start | `dashed=1;startArrow=block;startFill=0;` |
| Realization | Class implements interface, triangle on the right | `Class ..|> Interface` | end | `dashed=1;endArrow=block;endFill=0;` |
| Dependency | A uses B | `A ..> B` | end | `dashed=1;endArrow=open;endFill=0;` |
| Dependency | A uses B, arrow on the left | `B <.. A` | start | `dashed=1;startArrow=open;startFill=0;` |
| Dashed association | Non-navigable dashed relation | `A .. B` | none | `dashed=1;startArrow=none;endArrow=none;` |

AutoDiagram deliberately does not rewrite endpoints for reverse-looking operators. Layout quality depends on stable semantic endpoints; draw.io marker placement is an export concern.
