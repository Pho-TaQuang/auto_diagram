import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { runCliCommand } from "../apps/cli/src/index.js";

export async function runCliTests(): Promise<void> {
  await initializesEditableLayoutIntent();
  await initializesSuggestedLayoutIntent();
  await generatesWithoutGroupFramesByDefault();
  await generatesWithLayoutIntent();
  await generatesWithSuggestedLayout();
  await rejectsLayoutFileAndSuggestedLayoutTogether();
}

async function initializesEditableLayoutIntent(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const intentPath = path.join(tempDir, "dmLoaiLucLuong.layout.json");

    await runCliCommand(["layout:init", "docs/dmLoaiLucLuong.md", "-o", intentPath]);

    const intent = JSON.parse(readFileSync(intentPath, "utf8"));
    const assignedNodeIds = intent.groups.flatMap((group: any) => group.nodeIds).sort();

    assert.equal(intent.version, 1);
    assert.equal(intent.grid.columns, 3);
    assert.ok(intent.groups.some((group: any) => group.label === "Controller"));
    assert.ok(assignedNodeIds.includes("DmLoaiLucLuongController"));
    assert.ok(assignedNodeIds.includes("PageModel"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function generatesWithLayoutIntent(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const intentPath = path.join(tempDir, "demo.layout.json");
    const drawioPath = path.join(tempDir, "demo.drawio");

    await runCliCommand(["layout:init", "docs/demo_mermaid.md", "-o", intentPath]);
    const intent = JSON.parse(readFileSync(intentPath, "utf8"));
    const controllerGroup = intent.groups.find((group: any) => group.label === "Controller");
    const managerGroup = intent.groups.find((group: any) => group.label === "ManagerInterface");
    controllerGroup.gridX = 1;
    managerGroup.gridX = 0;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, "utf8");

    await runCliCommand(["generate", "docs/demo_mermaid.md", "-o", drawioPath, "--layout", intentPath, "--group-frames"]);

    const xml = readFileSync(drawioPath, "utf8");
    assert.equal(XMLValidator.validate(xml), true);
    const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
    const controllerFrame = cells.find((cell) => cell.id === "group_frame_group_stereotype_Controller");
    const managerFrame = cells.find((cell) => cell.id === "group_frame_group_stereotype_ManagerInterface");

    assert.ok(controllerFrame);
    assert.ok(managerFrame);
    assert.ok(Number(controllerFrame.mxGeometry.x) > Number(managerFrame.mxGeometry.x));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function initializesSuggestedLayoutIntent(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const intentPath = path.join(tempDir, "demo.layout.json");

    await runCliCommand(["layout:init", "docs/demo_mermaid.md", "-o", intentPath, "--suggested-layout"]);

    const intent = JSON.parse(readFileSync(intentPath, "utf8"));
    const assignedNodeIds = intent.groups.flatMap((group: any) => group.nodeIds).sort();

    assert.equal(intent.version, 1);
    assert.equal(intent.grid.columns, 4);
    assert.equal(new Set(assignedNodeIds).size, assignedNodeIds.length);
    assert.ok(assignedNodeIds.includes("DmPhuongTienController"));
    assert.ok(assignedNodeIds.includes("PageModel"));
    assertIntentGroupPosition(intent, "AdapterFactory", 1, 0);
    assertIntentGroupPosition(intent, "DataAccessAdapter", 2, 0);
    assertIntentGroupPosition(intent, "Controller", 0, 1);
    assertIntentGroupPosition(intent, "ManagerInterface", 1, 1);
    assertIntentGroupPosition(intent, "Manager", 2, 1);
    assertIntentGroupPosition(intent, "LLBLGenEntity", 3, 1);
    assertIntentGroupPosition(intent, "Model", 0, 2);
    assertIntentGroupPosition(intent, "DTO", 1, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function generatesWithSuggestedLayout(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const drawioPath = path.join(tempDir, "demo.drawio");

    await runCliCommand(["generate", "docs/demo_mermaid.md", "-o", drawioPath, "--suggested-layout"]);

    const xml = readFileSync(drawioPath, "utf8");
    assert.equal(XMLValidator.validate(xml), true);
    const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
    const adapterFactory = findCell(cells, "node_DataAccessAdapterFactory");
    const controller = findCell(cells, "node_DmPhuongTienController");
    const manager = findCell(cells, "node_DmPhuongTienManager");

    assert.ok(Number(adapterFactory.mxGeometry.y) < Number(controller.mxGeometry.y));
    assert.ok(Number(manager.mxGeometry.x) > Number(controller.mxGeometry.x));
    assert.equal(cells.some((cell) => String(cell.id).startsWith("group_frame_")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function rejectsLayoutFileAndSuggestedLayoutTogether(): Promise<void> {
  await assert.rejects(
    () => runCliCommand([
      "generate",
      "docs/demo_mermaid.md",
      "-o",
      "out/demo.drawio",
      "--layout",
      "out/demo.layout.json",
      "--suggested-layout"
    ]),
    /Usage/
  );
}

async function generatesWithoutGroupFramesByDefault(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const drawioPath = path.join(tempDir, "demo.drawio");

    await runCliCommand(["generate", "docs/demo_mermaid.md", "-o", drawioPath]);

    const xml = readFileSync(drawioPath, "utf8");
    assert.equal(XMLValidator.validate(xml), true);
    const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);

    assert.equal(cells.some((cell) => String(cell.id).startsWith("group_frame_")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseXml(xml: string): any {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false
  }).parse(xml);
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function assertIntentGroupPosition(intent: any, label: string, gridX: number, gridY: number): void {
  const group = intent.groups.find((candidate: any) => candidate.label === label);
  assert.ok(group, `Expected intent group ${label} to be present.`);
  assert.equal(group.gridX, gridX);
  assert.equal(group.gridY, gridY);
}

function findCell(cells: any[], id: string): any {
  const cell = cells.find((candidate) => candidate.id === id);
  assert.ok(cell, `Expected cell ${id} to be present.`);
  return cell;
}
