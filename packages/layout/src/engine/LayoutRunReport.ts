import type { DiagramDiagnostic } from "../../../core/src/index.js";

export type LayoutEngineId =
  | "stereotype-scored"
  | "manual-routing-v2"
  | "suggest-initial-v2"
  | "auto-arrange-v2";

export type LayoutSourceFormat =
  | "coordinate-routing-v3"
  | "relative-flow-v2"
  | "stereotype-grid-v1"
  | "none";

export type LayoutLogLevel = "debug" | "info" | "warn" | "error";

export type LayoutLogPhase =
  | "normalize"
  | "measure"
  | "pack"
  | "anchor"
  | "divider"
  | "route"
  | "repair"
  | "validate"
  | "score"
  | "export";

export type LayoutLogEvent = {
  level: LayoutLogLevel;
  phase: LayoutLogPhase;
  type: string;
  message: string;
  groupId?: string;
  nodeId?: string;
  edgeId?: string;
  dividerId?: string;
  data?: Record<string, unknown>;
};

export type LayoutRunReport = {
  engine: LayoutEngineId;
  sourceFormat?: LayoutSourceFormat;
  warnings: LayoutLogEvent[];
  errors: LayoutLogEvent[];
  trace?: LayoutLogEvent[];
};

export interface LayoutLogger {
  log(event: LayoutLogEvent): void;
  debug(event: Omit<LayoutLogEvent, "level">): void;
  info(event: Omit<LayoutLogEvent, "level">): void;
  warn(event: Omit<LayoutLogEvent, "level">): void;
  error(event: Omit<LayoutLogEvent, "level">): void;
}

export class MemoryLayoutLogger implements LayoutLogger {
  readonly events: LayoutLogEvent[] = [];

  log(event: LayoutLogEvent): void {
    this.events.push(event);
  }

  debug(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "debug" });
  }

  info(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "info" });
  }

  warn(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "warn" });
  }

  error(event: Omit<LayoutLogEvent, "level">): void {
    this.log({ ...event, level: "error" });
  }

  report(engine: LayoutEngineId, sourceFormat?: LayoutSourceFormat, includeTrace = false): LayoutRunReport {
    return {
      engine,
      sourceFormat,
      warnings: this.events.filter((event) => event.level === "warn"),
      errors: this.events.filter((event) => event.level === "error"),
      ...(includeTrace ? { trace: [...this.events] } : {})
    };
  }
}

export class NoopLayoutLogger implements LayoutLogger {
  log(_event: LayoutLogEvent): void {}

  debug(_event: Omit<LayoutLogEvent, "level">): void {}

  info(_event: Omit<LayoutLogEvent, "level">): void {}

  warn(_event: Omit<LayoutLogEvent, "level">): void {}

  error(_event: Omit<LayoutLogEvent, "level">): void {}
}

export function logEventsToDiagnostics(events: LayoutLogEvent[]): DiagramDiagnostic[] {
  return events
    .filter((event) => event.level === "warn" || event.level === "error")
    .map((event): DiagramDiagnostic => ({
      severity: event.level === "error" ? "error" : "warning",
      message: event.message
    }));
}
