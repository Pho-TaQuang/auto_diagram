import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMermaidClassDiagram } from "./mermaidClassDiagram.js";

const fixture = readFileSync("docs/demo_mermaid.md", "utf8");
const dmLoaiLucLuongFixture = readFileSync("docs/dmLoaiLucLuong.md", "utf8");

export function runParserTests(): void {
  parsesTheMvp0MermaidFixture();
  preservesClassMembersReturnTypesAndRelationshipLabels();
  preservesExactStereotypeText();
  warnsAboutImplicitRelationshipClasses();
  parsesTheDmLoaiLucLuongFixture();
}

function parsesTheMvp0MermaidFixture(): void {
  const document = parseMermaidClassDiagram(fixture);

  assert.equal(document.nodes.length, 11);
  assert.equal(document.edges.length, 13);
  assert.deepEqual(uniqueStereotypes(document.nodes).sort(), [
    "AdapterFactory",
    "Controller",
    "DTO",
    "DataAccessAdapter",
    "LLBLGenEntity",
    "Manager",
    "ManagerInterface",
    "Model"
  ].sort());
}

function preservesClassMembersReturnTypesAndRelationshipLabels(): void {
  const document = parseMermaidClassDiagram(fixture);
  const controller = document.nodes.find((node) => node.id === "DmPhuongTienController");
  const manager = document.nodes.find((node) => node.id === "DmPhuongTienManager");

  assert.ok(controller);
  assert.ok(manager);
  assert.equal(controller.stereotype, "Controller");
  assert.equal(controller.attributes[0].text, "-_manager IDmPhuongTienManager");
  assert.equal(controller.methods[0].text, "+Paging(DmPhuongTienPageModel pageModel) : Task<ApiResponse>");
  assert.equal(manager.methods.at(-1)?.text, "+UpdateIconByType(string typePhuongTien, string iconId) : Task<ApiResponse>");
  assert.ok(document.edges.some((edge) => edge.operator === "<|.." && edge.label === "implements"));
  assert.ok(document.edges.some((edge) => edge.operator === "<|--" && edge.label === "extends"));
}

function preservesExactStereotypeText(): void {
  const document = parseMermaidClassDiagram([
    "classDiagram",
    "class BlockStereotype {",
    "  <<External  Service>>",
    "}",
    "<<Service>> UpperService",
    "<<service>> LowerService",
    "<<Api~Gateway~>> ApiGateway"
  ].join("\n"));

  assert.equal(document.nodes.find((node) => node.id === "BlockStereotype")?.stereotype, "External  Service");
  assert.equal(document.nodes.find((node) => node.id === "UpperService")?.stereotype, "Service");
  assert.equal(document.nodes.find((node) => node.id === "LowerService")?.stereotype, "service");
  assert.equal(document.nodes.find((node) => node.id === "ApiGateway")?.stereotype, "Api~Gateway~");
}

function warnsAboutImplicitRelationshipClasses(): void {
  const document = parseMermaidClassDiagram([
    "classDiagram",
    "class DeclaredClass {",
    "  +Id string",
    "}",
    "DeclaredClass ..> MissingClass : use"
  ].join("\n"));

  assert.equal(document.nodes.length, 2);
  assert.equal(document.nodes.find((node) => node.id === "DeclaredClass")?.attributes.length, 1);
  assert.equal(document.nodes.find((node) => node.id === "MissingClass")?.attributes.length, 0);
  assert.ok(document.diagnostics.some((diagnostic) =>
    diagnostic.message === "Class MissingClass is referenced by a relationship but has no class declaration or stereotype; generated as an empty class in the Ungrouped layout group."
  ));
  assert.equal(document.diagnostics.some((diagnostic) => diagnostic.message.includes("DeclaredClass is referenced")), false);
}

function parsesTheDmLoaiLucLuongFixture(): void {
  const document = parseMermaidClassDiagram(dmLoaiLucLuongFixture);
  const controller = document.nodes.find((node) => node.id === "DmLoaiLucLuongController");

  assert.equal(document.nodes.length, 8);
  assert.equal(document.edges.length, 9);
  assert.deepEqual(uniqueStereotypes(document.nodes).sort(), [
    "AdapterFactory",
    "Controller",
    "DTO",
    "DataAccessAdapter",
    "LLBLGenEntity",
    "Manager",
    "ManagerInterface",
    "Model"
  ].sort());
  assert.ok(controller);
  assert.equal(controller.methods[0].text, "+Paging(PageModel pageModel) : Task<ApiResponse>");
  assert.ok(document.edges.some((edge) => edge.label === "inject/call"));
  assert.ok(document.edges.some((edge) => edge.label === "implements"));
  assert.ok(document.edges.some((edge) => edge.label === "creates adapter"));
  assert.ok(document.edges.some((edge) => edge.label === "CRUD/map"));
  assert.ok(document.edges.some((edge) => edge.label === "input/output"));
}

function uniqueStereotypes(nodes: Array<{ stereotype?: string }>): string[] {
  return [...new Set(nodes.map((node) => node.stereotype).filter((value): value is string => Boolean(value)))];
}
