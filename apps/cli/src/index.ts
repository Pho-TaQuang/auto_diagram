import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMxGraphModelXml } from "../../../packages/drawio/src/index.js";
import {
  applyStereotypeGridLayout,
  createStereotypeLayoutIntent,
  normalizeStereotypeLayoutIntent
} from "../../../packages/layout/src/index.js";
import type { StereotypeLayoutIntent } from "../../../packages/layout/src/index.js";
import { parseMermaidClassDiagram } from "../../../packages/parsers/src/index.js";

type GenerateArgs = {
  input: string;
  output: string;
  layout?: string;
  suggestedLayout: boolean;
  groupFrames: boolean;
};

type LayoutInitArgs = {
  input: string;
  output: string;
  suggestedLayout: boolean;
};

export async function runCliCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "layout:init") {
    const options = parseLayoutInitArgs(args.slice(1));
    const parsed = await parseInput(options.input);
    const intent = createStereotypeLayoutIntent(parsed, {
      placement: options.suggestedLayout ? "suggested" : "grid"
    });

    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
    console.log(`Generated ${options.output}`);
    return;
  }

  if (command === "generate") {
    const options = parseGenerateArgs(args.slice(1));
    const parsed = await parseInput(options.input);
    const intent = options.layout
      ? await readLayoutIntent(options.layout)
      : options.suggestedLayout
        ? createStereotypeLayoutIntent(parsed, { placement: "suggested" })
        : undefined;
    const laidOut = applyStereotypeGridLayout(parsed, intent ? { intent } : undefined);
    const xml = toMxGraphModelXml(laidOut, { groupFrames: options.groupFrames });

    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, xml, "utf8");
    console.log(`Generated ${options.output}`);
    return;
  }

  throw new Error(usage());
}

async function parseInput(inputPath: string): Promise<ReturnType<typeof parseMermaidClassDiagram>> {
  const source = await readFile(inputPath, "utf8");
  const parsed = parseMermaidClassDiagram(source);

  if (parsed.nodes.length === 0) {
    throw new Error("No class nodes were parsed from the input.");
  }

  for (const diagnostic of parsed.diagnostics) {
    const location = diagnostic.line ? ` line ${diagnostic.line}` : "";
    console.warn(`${diagnostic.severity.toUpperCase()}${location}: ${diagnostic.message}`);
  }

  return parsed;
}

async function readLayoutIntent(layoutPath: string): Promise<StereotypeLayoutIntent> {
  try {
    const content = await readFile(layoutPath, "utf8");
    return normalizeStereotypeLayoutIntent(JSON.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid layout intent ${layoutPath}: ${message}`);
  }
}

function parseGenerateArgs(args: string[]): GenerateArgs {
  const input = args[0];
  const outputFlagIndex = args.findIndex((arg) => arg === "-o" || arg === "--output");
  const output = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
  const layoutFlagIndex = args.findIndex((arg) => arg === "--layout");
  const layout = layoutFlagIndex >= 0 ? args[layoutFlagIndex + 1] : undefined;
  const suggestedLayout = args.includes("--suggested-layout");
  const groupFrames = args.includes("--group-frames");

  if (!input || !output) {
    throw new Error(usage());
  }

  if (layoutFlagIndex >= 0 && !layout) {
    throw new Error(usage());
  }

  if (layout && suggestedLayout) {
    throw new Error(usage());
  }

  return { input, output, layout, suggestedLayout, groupFrames };
}

function parseLayoutInitArgs(args: string[]): LayoutInitArgs {
  const input = args[0];
  const outputFlagIndex = args.findIndex((arg) => arg === "-o" || arg === "--output");
  const output = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
  const suggestedLayout = args.includes("--suggested-layout");

  if (!input || !output) {
    throw new Error(usage());
  }

  return { input, output, suggestedLayout };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run layout:init -- <input.mmd> -o <layout.json> [--suggested-layout]",
    "  npm run generate -- <input.mmd> -o <output.drawio> [--layout <layout.json> | --suggested-layout] [--group-frames]",
    "",
    "Example:",
    "  npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json",
    "  npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json --suggested-layout",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --suggested-layout",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json --group-frames"
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCliCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
