import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMxGraphModelXml } from "../../../packages/drawio/src/index.js";
import {
  applyStereotypeGridLayout,
  createDefaultLayoutEngineRegistry,
  createInitialCoordinateRoutingLayoutV3,
  createRelativeFlowLayout,
  createStereotypeLayoutIntent,
  relativeFlowLayoutToStereotypeLayoutIntent,
  type LayoutEngineId,
  type LayoutRunReport
} from "../../../packages/layout/src/index.js";
import type { RelativeFlowLayout } from "../../../packages/layout/src/index.js";
import { parseMermaidClassDiagram } from "../../../packages/parsers/src/index.js";

type CliEngine = "legacy" | "v2";

type GenerateArgs = {
  input: string;
  output: string;
  layout?: string;
  suggestedLayout: boolean;
  groupFrames: boolean;
  engine: CliEngine;
  autoArrange: boolean;
  verbose: boolean;
  traceRouting: boolean;
  logLayoutJson?: string;
};

type LayoutInitArgs = {
  input: string;
  output: string;
  suggestedLayout: boolean;
  engine: CliEngine;
};

export async function runCliCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "layout:init") {
    const options = parseLayoutInitArgs(args.slice(1));
    const parsed = await parseInput(options.input);
    const layout = options.engine === "v2"
      ? createInitialCoordinateRoutingLayoutV3(parsed, options.suggestedLayout ? "suggested" : "grid")
      : createRelativeFlowLayout(parsed, {
        placement: options.suggestedLayout ? "suggested" : "grid"
      });

    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
    console.log(`Generated ${options.output}`);
    return;
  }

  if (command === "generate") {
    const options = parseGenerateArgs(args.slice(1));
    const parsed = await parseInput(options.input);

    if (options.engine === "v2") {
      const layoutInput = options.layout ? await readJsonFile(options.layout) : undefined;
      const mode = resolveV2EngineMode(options, layoutInput);
      const registry = createDefaultLayoutEngineRegistry();
      const result = registry.get(mode).run({
        document: parsed,
        mode,
        layoutInput,
        options: {
          traceRouting: options.traceRouting || options.verbose || Boolean(options.logLayoutJson)
        }
      });
      const xml = toMxGraphModelXml(result.document, { groupFrames: options.groupFrames });

      emitLayoutReport(result.report, options);
      if (options.logLayoutJson) {
        await mkdir(path.dirname(options.logLayoutJson), { recursive: true });
        await writeFile(options.logLayoutJson, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
      }

      await mkdir(path.dirname(options.output), { recursive: true });
      await writeFile(options.output, xml, "utf8");
      console.log(`Generated ${options.output}`);
      return;
    }

    const intent = options.layout
      ? relativeFlowLayoutToStereotypeLayoutIntent(parsed, await readRelativeFlowLayout(options.layout))
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

async function readRelativeFlowLayout(layoutPath: string): Promise<RelativeFlowLayout> {
  return readJsonFile(layoutPath) as Promise<RelativeFlowLayout>;
}

async function readJsonFile(layoutPath: string): Promise<unknown> {
  try {
    const content = await readFile(layoutPath, "utf8");
    return JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid layout file ${layoutPath}: ${message}`);
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
  const engine = parseEngine(args);
  const autoArrange = args.includes("--auto-arrange");
  const verbose = args.includes("--verbose");
  const traceRouting = args.includes("--trace-routing");
  const logLayoutFlagIndex = args.findIndex((arg) => arg === "--log-layout-json");
  const logLayoutJson = logLayoutFlagIndex >= 0 ? args[logLayoutFlagIndex + 1] : undefined;

  if (!input || !output) {
    throw new Error(usage());
  }

  if (layoutFlagIndex >= 0 && !layout) {
    throw new Error(usage());
  }

  if (layout && suggestedLayout) {
    throw new Error(usage());
  }

  if (layout && autoArrange) {
    throw new Error(usage());
  }

  if (logLayoutFlagIndex >= 0 && !logLayoutJson) {
    throw new Error(usage());
  }

  return { input, output, layout, suggestedLayout, groupFrames, engine, autoArrange, verbose, traceRouting, logLayoutJson };
}

function parseLayoutInitArgs(args: string[]): LayoutInitArgs {
  const input = args[0];
  const outputFlagIndex = args.findIndex((arg) => arg === "-o" || arg === "--output");
  const output = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
  const suggestedLayout = args.includes("--suggested-layout");
  const engine = parseEngine(args);

  if (!input || !output) {
    throw new Error(usage());
  }

  return { input, output, suggestedLayout, engine };
}

function parseEngine(args: string[]): CliEngine {
  const engineFlagIndex = args.findIndex((arg) => arg === "--engine");
  if (engineFlagIndex < 0) {
    return "legacy";
  }

  const value = args[engineFlagIndex + 1];
  if (value !== "legacy" && value !== "v2") {
    throw new Error(usage());
  }
  return value;
}

function resolveV2EngineMode(options: GenerateArgs, layoutInput: unknown): LayoutEngineId {
  if (options.autoArrange) {
    return "auto-arrange-v2";
  }
  return layoutInput === undefined ? "suggest-initial-v2" : "manual-routing-v2";
}

function emitLayoutReport(report: LayoutRunReport, options: GenerateArgs): void {
  const events = report.trace ?? [...report.warnings, ...report.errors];
  const allowedLevels = options.traceRouting
    ? new Set(["debug", "info", "warn", "error"])
    : options.verbose
      ? new Set(["info", "warn", "error"])
      : new Set(["warn", "error"]);

  for (const event of events) {
    if (!allowedLevels.has(event.level)) {
      continue;
    }
    const prefix = event.level === "warn"
      ? "Warning"
      : event.level === "error"
        ? "Error"
        : event.level === "debug"
          ? "Debug"
          : "Info";
    const line = `${prefix}: ${event.message}`;
    if (event.level === "error" || event.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

function usage(): string {
  return [
    "Usage:",
    "  npm run layout:init -- <input.mmd> -o <layout.json> [--suggested-layout] [--engine legacy|v2]",
    "  npm run generate -- <input.mmd> -o <output.drawio> [--layout <layout.json> | --suggested-layout | --auto-arrange] [--group-frames] [--engine legacy|v2] [--verbose] [--trace-routing] [--log-layout-json <report.json>]",
    "",
    "Example:",
    "  npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json",
    "  npm run layout:init -- docs/demo_mermaid.md -o out/demo.layout.json --suggested-layout",
    "  npm run layout:init -- docs/demo_mermaid.md -o out/demo.routing-v3.json --engine v2",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --suggested-layout",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo.drawio --layout out/demo.layout.json --group-frames",
    "  npm run generate -- docs/demo_mermaid.md -o out/demo-v2.drawio --engine v2 --layout out/demo.routing-v3.json --log-layout-json out/demo.routing-report.json"
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCliCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
