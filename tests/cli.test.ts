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
  await rejectsLegacyLayoutIntentFile();
}

async function initializesEditableLayoutIntent(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const intentPath = path.join(tempDir, "dmLoaiLucLuong.layout.json");

    await runCliCommand(["layout:init", "docs/dmLoaiLucLuong.md", "-o", intentPath]);

    const intent = JSON.parse(readFileSync(intentPath, "utf8"));
    const assignedNodeIds = intent.groups.flatMap((group: any) => group.nodeIds).sort();

    assert.equal(intent.version, 2);
    assert.equal(intent.layoutMode, "relative-flow");
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
    const adapterFactoryGroup = intent.groups.find((group: any) => group.label === "AdapterFactory");
    const dataAccessAdapterGroup = intent.groups.find((group: any) => group.label === "DataAccessAdapter");
    const modelGroup = intent.groups.find((group: any) => group.label === "Model");
    const dtoGroup = intent.groups.find((group: any) => group.label === "DTO");
    const llblGenEntityGroup = intent.groups.find((group: any) => group.label === "LLBLGenEntity");

    controllerGroup.rank = 1;
    controllerGroup.placedAfter = managerGroup.id;
    managerGroup.rank = 0;
    delete managerGroup.placedAfter;

    adapterFactoryGroup.rank = 1;
    adapterFactoryGroup.placedAfter = dataAccessAdapterGroup.id;
    dataAccessAdapterGroup.rank = 0;
    delete dataAccessAdapterGroup.placedAfter;
    llblGenEntityGroup.placedAfter = adapterFactoryGroup.id;

    modelGroup.rank = 1;
    modelGroup.placedAfter = dtoGroup.id;
    dtoGroup.rank = 0;
    delete dtoGroup.placedAfter;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, "utf8");

    await runCliCommand(["generate", "docs/demo_mermaid.md", "-o", drawioPath, "--layout", intentPath, "--group-frames"]);

    const xml = readFileSync(drawioPath, "utf8");
    assert.equal(XMLValidator.validate(xml), true);
    const cells = asArray(parseXml(xml).mxGraphModel.root.mxCell);
    const controllerFrame = cells.find((cell) => cell.value === "Controller");
    const managerFrame = cells.find((cell) => cell.value === "ManagerInterface");

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

    assert.equal(intent.version, 2);
    assert.equal(intent.layoutMode, "relative-flow");
    assert.equal(new Set(assignedNodeIds).size, assignedNodeIds.length);
    assert.ok(assignedNodeIds.includes("DmPhuongTienController"));
    assert.ok(assignedNodeIds.includes("PageModel"));
    assertLayoutGroupRank(intent, "AdapterFactory", 0);
    assertLayoutGroupRank(intent, "DataAccessAdapter", 1);
    assertLayoutGroupRank(intent, "Controller", 0);
    assertLayoutGroupRank(intent, "ManagerInterface", 1);
    assertLayoutGroupRank(intent, "Manager", 2);
    assertLayoutGroupRank(intent, "LLBLGenEntity", 3);
    assertLayoutGroupRank(intent, "Model", 0);
    assertLayoutGroupRank(intent, "DTO", 1);
    assertLayoutGroupBelow(intent, "Controller", "AdapterFactory");
    assertLayoutGroupBelow(intent, "ManagerInterface", "DataAccessAdapter");
    assertLayoutGroupBelow(intent, "Model", "Controller");
    assertLayoutGroupBelow(intent, "DTO", "ManagerInterface");
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
    const adapterFactory = findClassCell(cells, "DataAccessAdapterFactory");
    const controller = findClassCell(cells, "DmPhuongTienController");
    const manager = findClassCell(cells, "DmPhuongTienManager");

    assert.ok(Number(adapterFactory.mxGeometry.y) < Number(controller.mxGeometry.y));
    assert.ok(Number(manager.mxGeometry.x) > Number(controller.mxGeometry.x));
    assert.equal(cells.some((cell) => String(cell.id).startsWith("group_frame_")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function rejectsLegacyLayoutIntentFile(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "autodiagram-cli-"));
  try {
    const drawioPath = path.join(tempDir, "legacy.drawio");
    const legacyLayoutPath = path.join(tempDir, "legacy.layout.json");

    writeFileSync(legacyLayoutPath, `${JSON.stringify({
      version: 1,
      grid: { columns: 1, rows: 1 },
      groups: []
    }, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => runCliCommand(["generate", "docs/demo_mermaid.md", "-o", drawioPath, "--layout", legacyLayoutPath]),
      /version 1 is no longer supported/
    );
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

function assertLayoutGroupRank(intent: any, label: string, rank: number): void {
  const group = intent.groups.find((candidate: any) => candidate.label === label);
  assert.ok(group, `Expected intent group ${label} to be present.`);
  assert.equal(group.rank, rank);
}

function assertLayoutGroupBelow(intent: any, label: string, below: string): void {
  const group = intent.groups.find((candidate: any) => candidate.label === label);
  assert.ok(group, `Expected intent group ${label} to be present.`);
  assert.equal(group.below, `group_stereotype_${below}`);
}

function findCell(cells: any[], id: string): any {
  const cell = cells.find((candidate) => candidate.id === id);
  assert.ok(cell, `Expected cell ${id} to be present.`);
  return cell;
}

function findClassCell(cells: any[], label: string): any {
  const cell = cells.find((candidate) =>
    candidate.vertex === "1" &&
    candidate.parent === "1" &&
    typeof candidate.value === "string" &&
    candidate.value.includes(label)
  );
  assert.ok(cell, `Expected class cell ${label} to be present.`);
  return cell;
}
