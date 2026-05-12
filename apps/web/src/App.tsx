import React, { type ChangeEvent, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiagramLayoutScore } from "../../../packages/core/src/index.js";
import {
  AlertTriangle,
  Box,
  Check,
  Copy,
  Download,
  FileJson,
  FileText,
  Grid3X3,
  Redo2,
  RefreshCw,
  RotateCw,
  Search,
  Undo2,
  Upload,
  Moon,
  Sun,
  X
} from "lucide-react";
import demoSource from "../../../docs/demo_mermaid.md?raw";
import {
  normalizeAllEdgeEndpointsToParents,
  extractLayoutViewModel,
  updateCellGeometry,
  updateEdgeRoute,
  updateEdgeTerminal,
  type MxAnchor,
  type MxAnchorSide,
  type MxGraphCell,
  type MxGraphModel,
  type MxLayoutClass,
  type MxLayoutEdge,
  type MxLayoutGroup,
  type MxLayoutViewModel,
  type MxPoint
} from "../../../packages/drawio/src/index.js";
import "./App.css";
import {
  cloneLayoutIntent,
  readWebPipelineMetadata,
  runMxGraphImport,
  runWebPipeline,
  serializeMxGraphState,
  type MxGraphImportResult,
  type StereotypeLayoutIntent,
  type WebPipelineResult
} from "./pipeline.js";

type SourceMode = "mermaid" | "mxGraphXml" | "layoutJson";
type LeftTab = "classes" | "edges" | "groups" | "extends" | "layoutJson";
type SelectionItem =
  | { type: "class"; id: string }
  | { type: "edge"; id: string }
  | { type: "group"; id: string };
type SelectedItem = SelectionItem | undefined;
type ClassMove = { id: string; x: number; y: number };
type IntentChangeOptions = { history?: boolean; status?: string };
type EditorSnapshot = {
  mxGraphState?: MxGraphModel;
  intentOverride?: StereotypeLayoutIntent;
};
type GeneratedPipelineState = {
  key: string;
  state: ActiveState;
};
type LayoutJobState = {
  id: number;
  key: string;
  running: boolean;
  title: string;
  phase: string;
  startedAt: number;
  previousCandidate?: string;
  previousScore?: DiagramLayoutScore;
  candidate?: string;
  score?: DiagramLayoutScore;
  error?: string;
};

type ActiveState =
  | {
    result: WebPipelineResult | MxGraphImportResult;
    parsed?: WebPipelineResult["parsed"];
    intent?: WebPipelineResult["intent"];
    error?: undefined;
  }
  | {
    result?: undefined;
    parsed?: undefined;
    intent?: undefined;
    error: string;
  };

const sourceModeLabels: Record<SourceMode, string> = {
  mermaid: "Mermaid",
  mxGraphXml: "mxGraph XML",
  layoutJson: "Layout JSON"
};

export function App(): React.JSX.Element {
  const [sourceMode, setSourceMode] = useState<SourceMode>("mermaid");
  const [source, setSource] = useState(demoSource);
  const [intentOverride, setIntentOverride] = useState<StereotypeLayoutIntent | undefined>();
  const [groupFrames, setGroupFrames] = useState(false);
  const [mxGraphState, setMxGraphState] = useState<MxGraphModel | undefined>();
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab>("classes");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Ready");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [generatedPipeline, setGeneratedPipeline] = useState<GeneratedPipelineState | undefined>();
  const [layoutJob, setLayoutJob] = useState<LayoutJobState | undefined>();
  const [layoutJobTick, setLayoutJobTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const liveEditSnapshotRef = useRef<EditorSnapshot | undefined>(undefined);
  const liveEditChangedRef = useRef(false);
  const layoutJobIdRef = useRef(0);

  // Theme toggle
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const mermaidPipelineKey = useMemo(
    () => mermaidLayoutKey(source, intentOverride, groupFrames),
    [groupFrames, intentOverride, source]
  );

  const activeState = useMemo<ActiveState>(() => {
    try {
      if (mxGraphState) {
        if (sourceMode === "mermaid") {
          const metadata = readWebPipelineMetadata({
            source,
            intent: intentOverride
          });
          return {
            result: serializeMxGraphState(mxGraphState),
            parsed: metadata.parsed,
            intent: metadata.intent
          };
        }

        return {
          result: serializeMxGraphState(mxGraphState)
        };
      }

      if (sourceMode === "mermaid") {
        const matchingGenerated = generatedPipeline?.key === mermaidPipelineKey
          ? generatedPipeline.state
          : undefined;

        if (matchingGenerated) {
          return matchingGenerated;
        }

        if (layoutJob?.key === mermaidPipelineKey && layoutJob.error) {
          return {
            error: layoutJob.error
          };
        }

        if (layoutJob?.running && generatedPipeline?.state.result) {
          return generatedPipeline.state;
        }

        return {
          error: "Layout calculation is starting."
        };
      }

      if (sourceMode === "mxGraphXml") {
        return {
          result: runMxGraphImport(source)
        };
      }

      return {
        result: runMxGraphImport(readXmlFromLayoutJson(source))
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }, [generatedPipeline, groupFrames, intentOverride, layoutJob, mermaidPipelineKey, mxGraphState, source, sourceMode]);

  const result = activeState.result;
  const layoutView = result?.layoutView;
  const layoutScore = result
    ? "diagram" in result
      ? result.diagram.layout?.score
      : result.score
    : undefined;
  const activeXml = result?.xml ?? "";
  const activeGraph = result?.mxGraph;
  const isLayoutRunning = Boolean(layoutJob?.running);
  const selected = selection[0] as SelectedItem;
  const selectedClass = selected?.type === "class" ? layoutView?.classes.find((classCell) => classCell.id === selected.id) : undefined;
  const selectedEdge = selected?.type === "edge" ? layoutView?.edges.find((edge) => edge.id === selected.id) : undefined;
  const selectedGroup = selected?.type === "group" ? layoutView?.groups.find((group) => group.id === selected.id) : undefined;
  const diagnostics = useMemo(() => [
    ...(layoutView?.diagnostics ?? []),
    ...(activeState.parsed?.diagnostics ?? []).map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.line ? `Line ${diagnostic.line}: ${diagnostic.message}` : diagnostic.message
    }))
  ], [activeState.parsed, layoutView]);
  const shellClassName = [
    "app-shell",
    leftCollapsed ? "left-collapsed" : "",
    rightCollapsed ? "right-collapsed" : ""
  ].filter(Boolean).join(" ");

  const clearHistory = (): void => {
    liveEditSnapshotRef.current = undefined;
    liveEditChangedRef.current = false;
    setUndoStack([]);
    setRedoStack([]);
  };

  const captureEditorSnapshot = (): EditorSnapshot => ({
    mxGraphState: activeGraph ? cloneMxGraphForHistory(activeGraph) : undefined,
    intentOverride: intentOverride ? cloneLayoutIntent(intentOverride) : undefined
  });

  const restoreEditorSnapshot = (snapshot: EditorSnapshot): void => {
    setMxGraphState(snapshot.mxGraphState ? cloneMxGraphForHistory(snapshot.mxGraphState) : undefined);
    setIntentOverride(snapshot.intentOverride ? cloneLayoutIntent(snapshot.intentOverride) : undefined);
  };

  const pushUndoSnapshot = (snapshot: EditorSnapshot): void => {
    setUndoStack((current) => appendHistory(current, snapshot));
    setRedoStack([]);
  };

  useEffect(() => {
    if (sourceMode !== "mermaid" || mxGraphState) {
      return;
    }

    if (generatedPipeline?.key === mermaidPipelineKey) {
      return;
    }

    const jobId = layoutJobIdRef.current + 1;
    layoutJobIdRef.current = jobId;
    const requestSource = source;
    const requestIntent = intentOverride ? cloneLayoutIntent(intentOverride) : undefined;
    const requestGroupFrames = groupFrames;
    const previousSummary = layoutSummaryFromState(generatedPipeline?.state);
    let timeoutId: number | undefined;
    let frameId: number | undefined;
    let cancelled = false;

    setLayoutJob({
      id: jobId,
      key: mermaidPipelineKey,
      running: true,
      title: requestIntent ? "Applying layout intent" : "Running auto layout",
      phase: "Preparing candidate search",
      startedAt: Date.now(),
      previousCandidate: previousSummary?.candidate,
      previousScore: previousSummary?.score
    });
    setStatus(requestIntent ? "Applying layout intent..." : "Running auto layout...");

    frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (cancelled || layoutJobIdRef.current !== jobId) {
          return;
        }

        try {
          const nextResult = runWebPipeline({
            source: requestSource,
            intent: requestIntent,
            groupFrames: requestGroupFrames
          });
          if (cancelled || layoutJobIdRef.current !== jobId) {
            return;
          }

          setGeneratedPipeline({
            key: mermaidPipelineKey,
            state: {
              result: nextResult,
              parsed: nextResult.parsed,
              intent: nextResult.intent
            }
          });
          setLayoutJob({
            id: jobId,
            key: mermaidPipelineKey,
            running: false,
            title: "Layout complete",
            phase: "Complete",
            startedAt: Date.now(),
            candidate: nextResult.diagram.layout?.selectedCandidateId,
            score: nextResult.diagram.layout?.score
          });
          setStatus(layoutCompleteStatus(nextResult.diagram.layout?.score, nextResult.diagram.layout?.selectedCandidateId));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (cancelled || layoutJobIdRef.current !== jobId) {
            return;
          }

          setGeneratedPipeline({
            key: mermaidPipelineKey,
            state: { error: message }
          });
          setLayoutJob({
            id: jobId,
            key: mermaidPipelineKey,
            running: false,
            title: "Layout failed",
            phase: "Error",
            startedAt: Date.now(),
            error: message
          });
          setStatus("Layout failed");
        }
      }, 40);
    });

    return () => {
      cancelled = true;
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [generatedPipeline, groupFrames, intentOverride, mermaidPipelineKey, mxGraphState, source, sourceMode]);

  useEffect(() => {
    if (!layoutJob?.running) {
      return;
    }

    const intervalId = window.setInterval(() => setLayoutJobTick(Date.now()), 250);
    return () => window.clearInterval(intervalId);
  }, [layoutJob?.running]);

  const updateSource = (nextSource: string): void => {
    setSource(nextSource);
    setMxGraphState(undefined);
    setIntentOverride(undefined);
    setSelection([]);
    clearHistory();
  };

  const switchMode = (mode: SourceMode): void => {
    setSourceMode(mode);
    setMxGraphState(undefined);
    setIntentOverride(undefined);
    setSelection([]);
    clearHistory();
    setStatus(`Input mode: ${sourceModeLabels[mode]}`);
  };

  const selectItem = (item: SelectedItem, additive = false): void => {
    setSelection((current) => {
      if (!item) {
        return [];
      }

      return additive ? toggleSelectionItem(current, item) : [item];
    });
  };

  const ensureEditableGraph = (): MxGraphModel | undefined => {
    if (!activeGraph) {
      return undefined;
    }

    return activeGraph;
  };

  const mutateGraph = (updater: (graph: MxGraphModel) => MxGraphModel, nextStatus: string, options?: { live?: boolean }): void => {
    const graph = ensureEditableGraph();
    if (!graph) {
      return;
    }

    if (!options?.live) {
      pushUndoSnapshot(captureEditorSnapshot());
    } else {
      liveEditChangedRef.current = true;
    }

    setMxGraphState(updater(graph));
    setStatus(nextStatus);
  };

  const beginLiveEdit = (): void => {
    const graph = ensureEditableGraph();
    if (!graph || liveEditSnapshotRef.current) {
      return;
    }

    liveEditSnapshotRef.current = captureEditorSnapshot();
    liveEditChangedRef.current = false;
  };

  const finishLiveEdit = (): void => {
    if (liveEditSnapshotRef.current && liveEditChangedRef.current) {
      pushUndoSnapshot(liveEditSnapshotRef.current);
    }

    liveEditSnapshotRef.current = undefined;
    liveEditChangedRef.current = false;
  };

  const undo = (): void => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) {
      return;
    }

    liveEditSnapshotRef.current = undefined;
    liveEditChangedRef.current = false;
    const currentSnapshot = captureEditorSnapshot();
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => appendHistory(current, currentSnapshot));
    restoreEditorSnapshot(previous);
    setStatus("Undo");
  };

  const redo = (): void => {
    const next = redoStack[redoStack.length - 1];
    if (!next) {
      return;
    }

    liveEditSnapshotRef.current = undefined;
    liveEditChangedRef.current = false;
    const currentSnapshot = captureEditorSnapshot();
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => appendHistory(current, currentSnapshot));
    restoreEditorSnapshot(next);
    setStatus("Redo");
  };

  const applyIntentOverride = (nextIntent: StereotypeLayoutIntent | undefined, nextStatus: string): void => {
    liveEditSnapshotRef.current = undefined;
    liveEditChangedRef.current = false;
    setMxGraphState(undefined);
    setIntentOverride(nextIntent ? cloneLayoutIntent(nextIntent) : undefined);
    setStatus(nextStatus);
  };

  const commitIntentOverride = (nextIntent: StereotypeLayoutIntent | undefined, nextStatus: string): void => {
    pushUndoSnapshot(captureEditorSnapshot());
    applyIntentOverride(nextIntent, nextStatus);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const resetToDemo = (): void => {
    setSourceMode("mermaid");
    updateSource(demoSource);
    setStatus("Demo loaded");
  };

  const runAutoLayout = (): void => {
    if (sourceMode === "mermaid") {
      if (mxGraphState || intentOverride) {
        pushUndoSnapshot(captureEditorSnapshot());
      }
      setMxGraphState(undefined);
      setIntentOverride(undefined);
      setStatus("Auto layout regenerated from Mermaid");
      return;
    }

    mutateGraph(normalizeAllEdgeEndpointsToParents, "Imported graph normalized");
  };

  const normalizeEndpoints = (): void => {
    mutateGraph(normalizeAllEdgeEndpointsToParents, "Edge endpoints normalized to class parent cells");
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    const lowerName = file.name.toLowerCase();
    const nextMode: SourceMode = lowerName.endsWith(".json")
      ? "layoutJson"
      : lowerName.endsWith(".drawio") || text.includes("<mxGraphModel") || text.includes("<mxfile")
        ? "mxGraphXml"
        : "mermaid";

    setSourceMode(nextMode);
    updateSource(text);
    setStatus(`Imported ${file.name}`);
    event.target.value = "";
  };

  const exportLayoutJson = (): void => {
    if (!layoutView || !activeXml) {
      return;
    }

    downloadText("autodiagram.layout.json", JSON.stringify(toLayoutJson(activeXml, layoutView), null, 2), "application/json;charset=utf-8");
  };

  const exportSvg = (): void => {
    if (!layoutView) {
      return;
    }

    downloadText("autodiagram-preview.svg", renderSvgMarkup(layoutView, groupFrames), "image/svg+xml;charset=utf-8");
  };

  return (
    <div className={shellClassName}>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">AutoDiagram</h1>
        </div>
        <div className="toolbar" aria-label="Main toolbar">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setIsDark((current) => !current)}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Import">
            <Upload size={14} />
          </button>
          <input ref={fileInputRef} className="hidden-input" type="file" onChange={(event) => void importFile(event)} />
          <button type="button" className="toolbar-btn" onClick={resetToDemo} title="Reset to demo">
            <RefreshCw size={14} />
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="toolbar-btn" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
            <Undo2 size={14} />
          </button>
          <button type="button" className="toolbar-btn" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={14} />
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="toolbar-btn" onClick={runAutoLayout} disabled={!activeGraph} title="Auto Layout">
            <Grid3X3 size={14} />
          </button>
          <button type="button" className="toolbar-btn" onClick={normalizeEndpoints} disabled={!activeGraph} title="Apply">
            <Check size={14} />
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="toolbar-btn" onClick={() => setStatus(layoutView ? `${diagnostics.length} warnings/errors` : "No graph to validate")} title="Validate">
            <AlertTriangle size={14} />
          </button>
          <span className="toolbar-divider" />
          <ExportMenu xml={activeXml} onExportLayoutJson={exportLayoutJson} onExportSvg={exportSvg} />
          <div className="status-indicators">
            {result || isLayoutRunning
              ? <StatusPill kind="ok" text={isLayoutRunning ? layoutJob?.phase ?? status : status} />
              : <StatusPill kind="error" text={activeState.error || "Error"} />}
          </div>
        </div>
      </header>

      <main className="editor-main">
        <section className="canvas-container panel">
          <div className="canvas-header">
            <span className="canvas-title">Preview / Edit</span>
          </div>
          {layoutView ? (
            <>
              <DiagramPreview
                layoutView={layoutView}
                showGroupFrames={groupFrames}
                selection={selection}
                onSelect={selectItem}
                onSelectMany={(items) => setSelection(dedupeSelection(items))}
                onLiveEditStart={beginLiveEdit}
                onLiveEditEnd={finishLiveEdit}
                onClassesMove={(moves) => mutateGraph((graph) => moveClassesAndNormalizeEdges(graph, moves), "Class dragged", { live: true })}
                onEdgeWaypointsChange={(id, waypoints) => mutateGraph((graph) => updateEdgeRoute(graph, id, { waypoints }), "Edge route dragged", { live: true })}
                onEdgeTerminalConnect={(id, terminal, classId, anchor) => mutateGraph(
                  (graph) => connectEdgeTerminalAndReorderAnchors(graph, id, terminal, classId, anchor),
                  `${terminal === "source" ? "Source" : "Target"} anchor updated`
                )}
              />
              {layoutJob?.running ? <LayoutLoadingOverlay job={layoutJob} fallbackScore={layoutScore} tick={layoutJobTick} /> : null}
            </>
          ) : (
            layoutJob?.running
              ? <LayoutLoadingPanel job={layoutJob} fallbackScore={layoutScore} tick={layoutJobTick} />
              : <ErrorBlock message={activeState.error} />
          )}
        </section>
      </main>

      {!leftCollapsed && (
        <aside className="left-overlay panel">
          <div className="panel-header">
            <div className="mode-tabs" role="tablist" aria-label="Input modes">
              {(["mermaid", "mxGraphXml", "layoutJson"] as SourceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={sourceMode === mode ? "active" : ""}
                  onClick={() => switchMode(mode)}
                >
                  {sourceModeLabels[mode]}
                </button>
              ))}
            </div>
            <button type="button" className="collapse-btn" onClick={() => setLeftCollapsed(true)} title="Collapse">
              <span className="collapse-icon">&lt;</span>
            </button>
          </div>
          <textarea
            className="source-input"
            value={source}
            onChange={(event) => updateSource(event.target.value)}
            spellCheck={false}
            aria-label={`${sourceModeLabels[sourceMode]} source`}
          />
          {layoutView && (
            <CompactDataPanel
              tab={leftTab}
              onTabChange={setLeftTab}
              query={query}
              onQueryChange={setQuery}
              layoutView={layoutView}
              xml={activeXml}
              selection={selection}
              onSelect={selectItem}
            />
          )}
        </aside>
      )}

      {!rightCollapsed && (
        <aside className="right-overlay panel">
          <div className="panel-header">
            <div className="panel-title">
              <Box size={14} />
              <span>Layout Info</span>
            </div>
            <button type="button" className="collapse-btn" onClick={() => setRightCollapsed(true)} title="Collapse">
              <span className="collapse-icon">&gt;</span>
            </button>
          </div>
          {layoutView && activeGraph ? (
            <>
              <SummaryPanel layoutView={layoutView} parsed={activeState.parsed} score={layoutScore} />
              <SelectedInspector
                selectedClass={selectedClass}
                selectedEdge={selectedEdge}
                selectedGroup={selectedGroup}
                diagnostics={diagnostics}
                onClassChange={(id, patch) => mutateGraph((graph) => updateCellGeometry(graph, id, patch), "Class geometry updated")}
              />
              <LayoutIntentPanel
                intent={activeState.intent}
                hasUserPreset={Boolean(intentOverride)}
                layoutView={layoutView}
                groupFrames={groupFrames}
                onGroupFramesChange={(enabled) => {
                  setGroupFrames(enabled);
                }}
                onResetIntent={() => commitIntentOverride(undefined, "Layout intent reset")}
                onIntentChange={(nextIntent, options) => {
                  if (options?.history === false) {
                    applyIntentOverride(nextIntent, options.status ?? "Layout matrix initialized");
                    return;
                  }

                  commitIntentOverride(nextIntent, options?.status ?? "Layout intent updated");
                }}
              />
              <XmlPanel xml={activeXml} />
            </>
          ) : (
            <ErrorBlock message={activeState.error} />
          )}
        </aside>
      )}

      <footer className="statusbar">
        <div className="status-left">
          {leftCollapsed && (
            <button type="button" className="edge-toggle left" onClick={() => setLeftCollapsed(false)} title="Show input">
              Data
            </button>
          )}
          {rightCollapsed && (
            <button type="button" className="edge-toggle right" onClick={() => setRightCollapsed(false)} title="Show info">
              Info
            </button>
          )}
          <StatusPill
            kind={result || isLayoutRunning ? "ok" : "error"}
            text={isLayoutRunning ? layoutJob?.phase ?? status : result ? status : (activeState.error || "Error")}
          />
        </div>
        <div className="status-right">
          {layoutView && (
            <>
              <span className="status-item">Classes: {layoutView.classes.length}</span>
              <span className="status-item">Edges: {layoutView.edges.length}</span>
              <span className="status-item">Warnings: {diagnostics.length}</span>
            </>
          )}
          {selection.length > 0 && (
            <span className="status-item selection-info">
              {selection.map(s => `${s.type} ${s.id}`).join(', ')}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

function ExportMenu(props: { xml: string; onExportLayoutJson: () => void; onExportSvg: () => void }): React.JSX.Element {
  return (
    <div className="toolbar-group">
      <button
        type="button"
        className="primary-button"
        onClick={() => downloadText("autodiagram.drawio", props.xml, "application/xml;charset=utf-8")}
        disabled={!props.xml}
      >
        <Download aria-hidden="true" size={16} />
        .drawio
      </button>
      <button type="button" className="secondary-button" onClick={props.onExportLayoutJson} disabled={!props.xml}>
        <FileJson aria-hidden="true" size={16} />
        JSON
      </button>
      <button type="button" className="secondary-button" onClick={props.onExportSvg} disabled={!props.xml}>
        <FileText aria-hidden="true" size={16} />
        SVG
      </button>
    </div>
  );
}

function CompactDataPanel(props: {
  tab: LeftTab;
  onTabChange: (tab: LeftTab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  layoutView: MxLayoutViewModel;
  xml: string;
  selection: SelectionItem[];
  onSelect: (selected: SelectedItem, additive?: boolean) => void;
}): React.JSX.Element {
  const tabs: Array<[LeftTab, string, number]> = [
    ["classes", "Classes", props.layoutView.classes.length],
    ["edges", "Edges", props.layoutView.edges.length],
    ["groups", "Groups", props.layoutView.groups.length],
    ["extends", "Extends", props.layoutView.extendsEdges.length],
    ["layoutJson", "Layout JSON", 1]
  ];
  const query = props.query.trim().toLowerCase();

  return (
    <div className="data-panel">
      <div className="data-tabs" role="tablist" aria-label="Layout data tabs">
        {tabs.map(([tab, label, count]) => (
          <button key={tab} type="button" className={props.tab === tab ? "active" : ""} onClick={() => props.onTabChange(tab)}>
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <label className="search-box">
        <Search aria-hidden="true" size={15} />
        <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Filter" />
      </label>
      <div className="compact-scroll">
        {props.tab === "classes" ? (
          props.layoutView.classes.filter((item) => matchesQuery(item.label, query)).map((classCell) => (
            <CompactRow
              key={classCell.id}
              active={isSelectionItemSelected(props.selection, { type: "class", id: classCell.id })}
              title={classCell.label}
              meta={`${classCell.stereotype ?? "No stereotype"} | ${classCell.width}x${classCell.height}`}
              onClick={(event) => props.onSelect({ type: "class", id: classCell.id }, isAdditiveSelection(event))}
            />
          ))
        ) : null}

        {props.tab === "edges" ? (
          props.layoutView.edges.filter((item) => matchesQuery(`${item.sourceId} ${item.targetId} ${item.label}`, query)).map((edge) => (
            <CompactRow
              key={edge.id}
              active={isSelectionItemSelected(props.selection, { type: "edge", id: edge.id })}
              title={`${edge.sourceId ?? "?"} -> ${edge.targetId ?? "?"}`}
              meta={`${edge.kind}${edge.label ? ` | ${edge.label}` : ""}`}
              onClick={(event) => props.onSelect({ type: "edge", id: edge.id }, isAdditiveSelection(event))}
            />
          ))
        ) : null}

        {props.tab === "groups" ? (
          props.layoutView.groups.filter((item) => matchesQuery(item.label, query)).map((group) => (
            <CompactRow
              key={group.id}
              active={isSelectionItemSelected(props.selection, { type: "group", id: group.id })}
              title={group.label}
              meta={`${group.classIds.length} classes | ${group.width}x${group.height}`}
              onClick={(event) => props.onSelect({ type: "group", id: group.id }, isAdditiveSelection(event))}
            />
          ))
        ) : null}

        {props.tab === "extends" ? (
          props.layoutView.extendsEdges.filter((item) => matchesQuery(`${item.sourceId} ${item.targetId} ${item.kind}`, query)).map((edge) => (
            <CompactRow
              key={edge.id}
              active={isSelectionItemSelected(props.selection, { type: "edge", id: edge.id })}
              title={`${edge.sourceId ?? "?"} extends ${edge.targetId ?? "?"}`}
              meta={edge.kind === "realization" ? "realization" : "inheritance"}
              onClick={(event) => props.onSelect({ type: "edge", id: edge.id }, isAdditiveSelection(event))}
            />
          ))
        ) : null}

        {props.tab === "layoutJson" ? <pre className="layout-json-preview">{JSON.stringify(toLayoutJson(props.xml, props.layoutView), null, 2)}</pre> : null}
      </div>
    </div>
  );
}

function CompactRow(props: { active: boolean; title: string; meta: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }): React.JSX.Element {
  return (
    <button type="button" className={`compact-row ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span>{props.title}</span>
      <small>{props.meta}</small>
    </button>
  );
}

type CanvasDrag =
  | {
    kind: "pan";
    pointerId: number;
    startClientX: number;
    startClientY: number;
    scrollLeft: number;
    scrollTop: number;
  }
  | {
    kind: "marquee";
    pointerId: number;
    start: MxPoint;
    current: MxPoint;
  }
  | {
    kind: "class";
    pointerId: number;
    classId: string;
    classMoves: Array<{ id: string; startX: number; startY: number }>;
    currentMoves: ClassMove[];
    offsetX: number;
    offsetY: number;
  }
  | {
    kind: "segment";
    pointerId: number;
    edgeId: string;
    segmentIndex: number;
    direct: boolean;
    baseWaypoints: MxPoint[];
    currentWaypoints: MxPoint[];
  }
  | {
    kind: "terminal";
    pointerId: number;
    edgeId: string;
    terminal: "source" | "target";
    current: MxPoint;
  };

function DiagramPreview(props: {
  layoutView: MxLayoutViewModel;
  showGroupFrames: boolean;
  selection: SelectionItem[];
  onSelect: (selected: SelectedItem, additive?: boolean) => void;
  onSelectMany: (selected: SelectionItem[]) => void;
  onLiveEditStart: () => void;
  onLiveEditEnd: () => void;
  onClassesMove: (moves: ClassMove[]) => void;
  onEdgeWaypointsChange: (id: string, waypoints: MxPoint[]) => void;
  onEdgeTerminalConnect: (id: string, terminal: "source" | "target", classId: string, anchor: MxAnchor) => void;
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<CanvasDrag>();
  const marquee = drag?.kind === "marquee" ? normalizeRect(drag.start, drag.current) : undefined;
  const PADDING = 40;
  const contentWidth = props.layoutView.bounds.width + PADDING * 2;
  const contentHeight = props.layoutView.bounds.height + PADDING * 2;
  const scaledWidth = contentWidth * zoom;
  const scaledHeight = contentHeight * zoom;
  const edgeHitStrokeWidth = clamp(22 / zoom, 12, 80);
  const displayClasses = applyClassDragPreview(props.layoutView.classes, drag);
  const displayEdges = applySegmentDragPreview(props.layoutView.edges, drag);
  const dragCoordinate = dragCoordinateLabel(drag);

  useEffect(() => {
    if (stageRef.current && props.layoutView.bounds.width > 0 && props.layoutView.bounds.height > 0) {
      const stage = stageRef.current;
      const viewportWidth = stage.clientWidth - 32; // space for zoom controls
      const fitZoom = viewportWidth / props.layoutView.bounds.width;
      setZoom(Number(Math.max(fitZoom, 0.1).toFixed(3)));
    }
  }, [props.layoutView.bounds.width, props.layoutView.bounds.height]);

  const graphPointFromEvent = (event: PointerEvent<SVGElement>): MxPoint => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return { x: 0, y: 0 };
    }

    const graphPoint = point.matrixTransform(matrix.inverse());
    return { x: graphPoint.x, y: graphPoint.y };
  };

  const zoomBy = (factor: number): void => {
    setZoom((current) => clamp(Number((current * factor).toFixed(3)), 0.05, 5));
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const preventNativeZoom = (event: globalThis.WheelEvent): void => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    stage.addEventListener("wheel", preventNativeZoom, { passive: false });
    return () => stage.removeEventListener("wheel", preventNativeZoom);
  }, []);

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 0.88);
  };

  const beginCanvasDrag = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (event.ctrlKey && stageRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        kind: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: stageRef.current.scrollLeft,
        scrollTop: stageRef.current.scrollTop
      });
      return;
    }

    const point = graphPointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind: "marquee",
      pointerId: event.pointerId,
      start: point,
      current: point
    });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.kind === "pan") {
      if (stageRef.current) {
        stageRef.current.scrollLeft = drag.scrollLeft - (event.clientX - drag.startClientX);
        stageRef.current.scrollTop = drag.scrollTop - (event.clientY - drag.startClientY);
      }
      return;
    }

    const point = graphPointFromEvent(event);

    if (drag.kind === "marquee") {
      setDrag({ ...drag, current: point });
      return;
    }

    if (drag.kind === "class") {
      const primary = drag.classMoves.find((classMove) => classMove.id === drag.classId);
      if (!primary) {
        return;
      }

      const nextX = snap(point.x - drag.offsetX);
      const nextY = snap(point.y - drag.offsetY);
      const deltaX = nextX - primary.startX;
      const deltaY = nextY - primary.startY;
      setDrag({
        ...drag,
        currentMoves: drag.classMoves.map((classMove) => ({
          id: classMove.id,
          x: snap(classMove.startX + deltaX),
          y: snap(classMove.startY + deltaY)
        }))
      });
      return;
    }

    if (drag.kind === "segment") {
      const edge = props.layoutView.edges.find((candidate) => candidate.id === drag.edgeId);
      if (!edge) {
        return;
      }
      setDrag({
        ...drag,
        currentWaypoints: moveEdgeSegment({ ...edge, waypoints: drag.baseWaypoints }, props.layoutView.classes, drag.segmentIndex, point, drag.direct)
      });
      return;
    }

    if (drag.kind === "terminal") {
      setDrag({ ...drag, current: point });
    }
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.kind === "marquee") {
      const selection = selectByMarquee(props.layoutView, normalizeRect(drag.start, drag.current), props.showGroupFrames);
      props.onSelectMany(selection);
    }

    if (drag.kind === "terminal") {
      const connection = findClassSideAtPoint(props.layoutView.classes, drag.current);
      if (connection) {
        props.onEdgeTerminalConnect(drag.edgeId, drag.terminal, connection.classId, {
          side: connection.side,
          ratio: connection.ratio
        });
        props.onSelect({ type: "edge", id: drag.edgeId });
      }
    }

    if (drag.kind === "class") {
      if (classMovesChanged(drag.classMoves, drag.currentMoves)) {
        props.onClassesMove(drag.currentMoves);
      }
      props.onLiveEditEnd();
    }

    if (drag.kind === "segment") {
      if (!samePoints(drag.baseWaypoints, drag.currentWaypoints)) {
        props.onEdgeWaypointsChange(drag.edgeId, drag.currentWaypoints);
      }
      props.onLiveEditEnd();
    }

    setDrag(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginClassDrag = (event: PointerEvent<SVGGElement>, classCell: MxLayoutClass): void => {
    if (event.ctrlKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const point = graphPointFromEvent(event);
    event.stopPropagation();

    const item: SelectionItem = { type: "class", id: classCell.id };
    if (isAdditiveSelection(event)) {
      props.onSelect(item, true);
      return;
    }

    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    props.onLiveEditStart();
    if (!isSelectionItemSelected(props.selection, item)) {
      props.onSelect(item);
    }

    const selectedClassIds = props.selection
      .filter((selectedItem) => selectedItem.type === "class")
      .map((selectedItem) => selectedItem.id);
    const classIds = selectedClassIds.includes(classCell.id) ? selectedClassIds : [classCell.id];
    const classById = new Map(props.layoutView.classes.map((candidate) => [candidate.id, candidate]));

    setDrag({
      kind: "class",
      pointerId: event.pointerId,
      classId: classCell.id,
      classMoves: classIds.flatMap((classId) => {
        const selectedClass = classById.get(classId);
        return selectedClass ? [{ id: classId, startX: selectedClass.x, startY: selectedClass.y }] : [];
      }),
      currentMoves: classIds.flatMap((classId) => {
        const selectedClass = classById.get(classId);
        return selectedClass ? [{ id: classId, x: selectedClass.x, y: selectedClass.y }] : [];
      }),
      offsetX: point.x - classCell.x,
      offsetY: point.y - classCell.y
    });
  };

  const beginSegmentDrag = (event: PointerEvent<SVGCircleElement>, edge: MxLayoutEdge, segmentIndex: number): void => {
    if (event.ctrlKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    props.onSelect({ type: "edge", id: edge.id });
    props.onLiveEditStart();
    setDrag({
      kind: "segment",
      pointerId: event.pointerId,
      edgeId: edge.id,
      segmentIndex,
      direct: edge.waypoints.length === 0,
      baseWaypoints: edge.waypoints.map((waypoint) => ({ ...waypoint })),
      currentWaypoints: edge.waypoints.map((waypoint) => ({ ...waypoint }))
    });
  };

  const beginTerminalDrag = (event: PointerEvent<SVGCircleElement>, edgeId: string, terminal: "source" | "target"): void => {
    if (event.ctrlKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    props.onSelect({ type: "edge", id: edgeId });
    setDrag({ kind: "terminal", pointerId: event.pointerId, edgeId, terminal, current: graphPointFromEvent(event) });
  };

  return (
    <div className="svg-stage" ref={stageRef} onWheel={handleWheel}>
      <div className="canvas-controls">
        <button type="button" onClick={() => zoomBy(1.15)}>Zoom +</button>
        <button type="button" onClick={() => zoomBy(0.87)}>Zoom -</button>
        <button type="button" onClick={() => {
          if (stageRef.current && props.layoutView.bounds.width > 0) {
            const stage = stageRef.current;
            const viewportWidth = stage.clientWidth - 32;
            const fitZoom = viewportWidth / props.layoutView.bounds.width;
            setZoom(Number(Math.max(fitZoom, 0.1).toFixed(3)));
          }
        }}>Fit</button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <svg
        ref={svgRef}
        width={scaledWidth}
        height={scaledHeight}
        viewBox={`-${PADDING} -${PADDING} ${props.layoutView.bounds.width + PADDING * 2} ${props.layoutView.bounds.height + PADDING * 2}`}
        role="img"
        aria-label="Class diagram preview"
        className={drag?.kind === "pan" ? "panning" : ""}
        onPointerDown={beginCanvasDrag}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          if (drag?.kind === "class" || drag?.kind === "segment") {
            props.onLiveEditEnd();
          }
          setDrag(undefined);
        }}
      >
        <defs>
          <marker id="arrow-open" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </marker>
          <marker id="arrow-block" markerWidth="12" markerHeight="12" refX="1" refY="6" orient="auto">
            <path d="M 11 1 L 1 6 L 11 11 Z" fill="var(--bg-canvas)" stroke="currentColor" strokeWidth="1.5" />
          </marker>
          <marker id="diamond-open" markerWidth="18" markerHeight="14" refX="9" refY="7" orient="auto" viewBox="0 0 18 14">
            <path d="M 1 7 L 9 2 L 17 7 L 9 12 Z" fill="var(--bg-canvas)" stroke="currentColor" strokeWidth="1.5" />
          </marker>
          <marker id="diamond-filled" markerWidth="18" markerHeight="14" refX="9" refY="7" orient="auto" viewBox="0 0 18 14">
            <path d="M 1 7 L 9 2 L 17 7 L 9 12 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
          </marker>
        </defs>
        {props.showGroupFrames ? props.layoutView.groups.map((group) => (
          <g key={group.id} className={`preview-group ${isSelectionItemSelected(props.selection, { type: "group", id: group.id }) ? "selected" : ""}`} onPointerDown={(event) => {
            if (event.ctrlKey) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            props.onSelect({ type: "group", id: group.id }, isAdditiveSelection(event));
          }}>
            <rect x={group.x - 18} y={group.y - 26} width={group.width + 36} height={group.height + 44} rx="6" />
            <text x={group.x - 8} y={group.y - 8}>{group.label}</text>
          </g>
        )) : null}
        {displayEdges.map((edge) => (
          <PreviewEdge
            key={edge.id}
            edge={edge}
            classes={displayClasses}
            selected={isSelectionItemSelected(props.selection, { type: "edge", id: edge.id })}
            hitStrokeWidth={edgeHitStrokeWidth}
            terminalPreview={drag?.kind === "terminal" && drag.edgeId === edge.id ? drag : undefined}
            onEdgePointerDown={(event) => {
              if (event.ctrlKey) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              props.onSelect({ type: "edge", id: edge.id }, isAdditiveSelection(event));
            }}
            onSegmentPointerDown={beginSegmentDrag}
            onTerminalPointerDown={beginTerminalDrag}
          />
        ))}
        {displayClasses.map((classCell) => (
          <PreviewClass
            key={classCell.id}
            classCell={classCell}
            selected={isSelectionItemSelected(props.selection, { type: "class", id: classCell.id })}
            onPointerDown={(event) => beginClassDrag(event, classCell)}
          />
        ))}
        {dragCoordinate ? (
          <g className="drag-coordinate">
            <rect x={dragCoordinate.x + 10} y={dragCoordinate.y - 30} width={dragCoordinate.width} height="24" rx="4" />
            <text x={dragCoordinate.x + 18} y={dragCoordinate.y - 14}>{dragCoordinate.text}</text>
          </g>
        ) : null}
        {marquee ? <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} /> : null}
      </svg>
    </div>
  );
}

function applyClassDragPreview(classes: MxLayoutClass[], drag: CanvasDrag | undefined): MxLayoutClass[] {
  if (drag?.kind !== "class") {
    return classes;
  }

  const moveById = new Map(drag.currentMoves.map((move) => [move.id, move]));
  return classes.map((classCell) => {
    const move = moveById.get(classCell.id);
    return move ? { ...classCell, x: move.x, y: move.y } : classCell;
  });
}

function applySegmentDragPreview(edges: MxLayoutEdge[], drag: CanvasDrag | undefined): MxLayoutEdge[] {
  if (drag?.kind !== "segment") {
    return edges;
  }

  return edges.map((edge) => edge.id === drag.edgeId
    ? {
      ...edge,
      waypoints: drag.currentWaypoints.map((waypoint) => ({ ...waypoint }))
    }
    : edge);
}

function dragCoordinateLabel(drag: CanvasDrag | undefined): { x: number; y: number; width: number; text: string } | undefined {
  if (drag?.kind === "class") {
    const primaryMove = drag.currentMoves.find((move) => move.id === drag.classId);
    if (!primaryMove) {
      return undefined;
    }

    const text = `x ${Math.round(primaryMove.x)}, y ${Math.round(primaryMove.y)}`;
    return {
      x: primaryMove.x,
      y: primaryMove.y,
      width: coordinateLabelWidth(text),
      text
    };
  }

  if (drag?.kind === "segment" && drag.currentWaypoints.length > 0) {
    const waypoint = drag.currentWaypoints[Math.min(drag.segmentIndex, drag.currentWaypoints.length - 1)];
    const text = `x ${Math.round(waypoint.x)}, y ${Math.round(waypoint.y)}`;
    return {
      x: waypoint.x,
      y: waypoint.y,
      width: coordinateLabelWidth(text),
      text
    };
  }

  if (drag?.kind === "terminal") {
    const text = `x ${Math.round(drag.current.x)}, y ${Math.round(drag.current.y)}`;
    return {
      x: drag.current.x,
      y: drag.current.y,
      width: coordinateLabelWidth(text),
      text
    };
  }

  return undefined;
}

function coordinateLabelWidth(text: string): number {
  return Math.max(88, text.length * 7 + 18);
}

function classMovesChanged(startMoves: Array<{ id: string; startX: number; startY: number }>, currentMoves: ClassMove[]): boolean {
  const currentById = new Map(currentMoves.map((move) => [move.id, move]));
  return startMoves.some((startMove) => {
    const currentMove = currentById.get(startMove.id);
    return Boolean(currentMove && (currentMove.x !== startMove.startX || currentMove.y !== startMove.startY));
  });
}

function samePoints(left: MxPoint[], right: MxPoint[]): boolean {
  return left.length === right.length && left.every((point, index) =>
    point.x === right[index].x && point.y === right[index].y
  );
}

function PreviewClass(props: { classCell: MxLayoutClass; selected: boolean; onPointerDown: (event: PointerEvent<SVGGElement>) => void }): React.JSX.Element {
  const rows = splitClassRows(props.classCell);
  const headerHeight = rows.headerHeight;

  return (
    <g className={`preview-class ${props.selected ? "selected" : ""}`} onPointerDown={props.onPointerDown}>
      <rect x={props.classCell.x} y={props.classCell.y} width={props.classCell.width} height={props.classCell.height} rx="4" />
      <line x1={props.classCell.x} y1={props.classCell.y + headerHeight} x2={props.classCell.x + props.classCell.width} y2={props.classCell.y + headerHeight} />
      <text className="stereotype" x={props.classCell.x + props.classCell.width / 2} y={props.classCell.y + 18} textAnchor="middle">
        {props.classCell.stereotype ? `<<${props.classCell.stereotype}>>` : ""}
      </text>
      <text className="class-name" x={props.classCell.x + props.classCell.width / 2} y={props.classCell.y + 36} textAnchor="middle">
        {props.classCell.label}
      </text>
      {rows.attributes.map((child) => (
        <ClassMemberRow key={child.id} classCell={props.classCell} child={child} className="member-row" />
      ))}
      {rows.separator ? (
        <line
          className="method-separator"
          x1={props.classCell.x}
          y1={props.classCell.y + childGeometryNumber(rows.separator, "y", headerHeight) + childGeometryNumber(rows.separator, "height", 8) / 2}
          x2={props.classCell.x + props.classCell.width}
          y2={props.classCell.y + childGeometryNumber(rows.separator, "y", headerHeight) + childGeometryNumber(rows.separator, "height", 8) / 2}
        />
      ) : null}
      {rows.methods.map((child) => (
        <ClassMemberRow key={child.id} classCell={props.classCell} child={child} className="member-row" />
      ))}
    </g>
  );
}

function ClassMemberRow(props: { classCell: MxLayoutClass; child: MxGraphCell; className: string }): React.JSX.Element {
  const y = childGeometryNumber(props.child, "y", 48);
  const height = childGeometryNumber(props.child, "height", 30);
  const baseline = y + Math.min(20, Math.max(14, height * 0.68));

  return (
    <text className={props.className} x={props.classCell.x + 8} y={props.classCell.y + baseline}>
      {props.child.attributes.value ?? ""}
    </text>
  );
}

function splitClassRows(classCell: MxLayoutClass): {
  headerHeight: number;
  attributes: MxGraphCell[];
  separator?: MxGraphCell;
  methods: MxGraphCell[];
} {
  const sortedChildren = [...classCell.children].sort((left, right) => childGeometryNumber(left, "y", 0) - childGeometryNumber(right, "y", 0));
  const separatorIndex = sortedChildren.findIndex(isClassRowSeparator);
  const separator = separatorIndex >= 0 ? sortedChildren[separatorIndex] : undefined;
  const headerHeight = classCell.headerHeight;

  return {
    headerHeight,
    attributes: (separatorIndex >= 0 ? sortedChildren.slice(0, separatorIndex) : sortedChildren).filter(isClassTextRow),
    separator,
    methods: (separatorIndex >= 0 ? sortedChildren.slice(separatorIndex + 1) : []).filter(isClassTextRow)
  };
}

function isClassTextRow(cell: MxGraphCell): boolean {
  return !isClassRowSeparator(cell) && (cell.attributes.vertex === "1" || Boolean(cell.attributes.value));
}

function isClassRowSeparator(cell: MxGraphCell): boolean {
  return (cell.attributes.style ?? "").split(";").includes("line");
}

function childGeometryNumber(cell: MxGraphCell, key: "y" | "height", fallback: number): number {
  const value = cell.geometry?.attributes[key];
  const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function PreviewEdge(props: {
  edge: MxLayoutEdge;
  classes: MxLayoutClass[];
  selected: boolean;
  hitStrokeWidth: number;
  terminalPreview?: Extract<CanvasDrag, { kind: "terminal" }>;
  onEdgePointerDown: (event: PointerEvent<SVGPolylineElement>) => void;
  onSegmentPointerDown: (event: PointerEvent<SVGCircleElement>, edge: MxLayoutEdge, segmentIndex: number) => void;
  onTerminalPointerDown: (event: PointerEvent<SVGCircleElement>, edgeId: string, terminal: "source" | "target") => void;
}): React.JSX.Element | null {
  const source = props.classes.find((classCell) => classCell.id === props.edge.sourceId);
  const target = props.classes.find((classCell) => classCell.id === props.edge.targetId);

  if (!source || !target) {
    return null;
  }

  const markerEnd = edgeMarkerUrl(props.edge.markerEnd);
  const markerStart = edgeMarkerUrl(props.edge.markerStart);
  const points = [
    edgeEndpointPoint(source, props.edge.sourceAnchor, props.edge.markerStart),
    ...props.edge.waypoints,
    edgeEndpointPoint(target, props.edge.targetAnchor, props.edge.markerEnd)
  ];
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  const middle = points[Math.floor(points.length / 2)];
  const segmentHandles = buildSegmentHandles(points);
  const terminalPreviewPoint = props.terminalPreview?.current;

  return (
    <g className={`preview-edge ${props.edge.kind} ${props.selected ? "selected" : ""}`}>
      <polyline className="edge-hitbox" points={path} strokeWidth={props.hitStrokeWidth} onPointerDown={props.onEdgePointerDown} />
      <polyline className="edge-visible" points={path} markerEnd={markerEnd} markerStart={markerStart} />
      {props.edge.label ? <text x={middle.x + 6} y={middle.y - 6}>{props.edge.label}</text> : null}
      {props.selected ? (
        <>
          <circle className="terminal-handle source" cx={points[0].x} cy={points[0].y} r="7" onPointerDown={(event) => props.onTerminalPointerDown(event, props.edge.id, "source")} />
          <circle className="terminal-handle target" cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="7" onPointerDown={(event) => props.onTerminalPointerDown(event, props.edge.id, "target")} />
          {segmentHandles.map((handle) => (
            <g key={`${props.edge.id}-segment-${handle.segmentIndex}`}>
              <circle
                cx={handle.x}
                cy={handle.y}
                r="18"
                fill="transparent"
                cursor="grab"
                onPointerDown={(event) => props.onSegmentPointerDown(event, props.edge, handle.segmentIndex)}
              />
              <circle
                className={`segment-handle ${handle.orientation}`}
                cx={handle.x}
                cy={handle.y}
                r="6"
                pointerEvents="none"
              />
            </g>
          ))}
          {terminalPreviewPoint ? (
            <>
              <line className="terminal-preview-line" x1={props.terminalPreview?.terminal === "source" ? points[points.length - 1].x : points[0].x} y1={props.terminalPreview?.terminal === "source" ? points[points.length - 1].y : points[0].y} x2={terminalPreviewPoint.x} y2={terminalPreviewPoint.y} />
              <circle className="terminal-preview" cx={terminalPreviewPoint.x} cy={terminalPreviewPoint.y} r="7" />
            </>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

function edgeEndpointPoint(classCell: MxLayoutClass, anchor: MxAnchor | undefined, marker: MxLayoutEdge["markerStart"]): MxPoint {
  const point = anchorPoint(classCell, anchor);

  if (!anchor || (marker !== "diamondOpen" && marker !== "diamondFilled")) {
    return point;
  }

  const offset = 12;
  if (anchor.side === "top") {
    return { x: point.x, y: point.y - offset };
  }

  if (anchor.side === "bottom") {
    return { x: point.x, y: point.y + offset };
  }

  if (anchor.side === "left") {
    return { x: point.x - offset, y: point.y };
  }

  return { x: point.x + offset, y: point.y };
}

function edgeMarkerUrl(marker: MxLayoutEdge["markerStart"]): string | undefined {
  if (marker === "open") {
    return "url(#arrow-open)";
  }

  if (marker === "block") {
    return "url(#arrow-block)";
  }

  if (marker === "diamondOpen") {
    return "url(#diamond-open)";
  }

  if (marker === "diamondFilled") {
    return "url(#diamond-filled)";
  }

  return undefined;
}

function SummaryPanel(props: { layoutView: MxLayoutViewModel; parsed?: WebPipelineResult["parsed"]; score?: DiagramLayoutScore }): React.JSX.Element {
  return (
    <div className="summary-grid">
      <Metric label="Classes" value={String(props.layoutView.classes.length)} />
      <Metric label="Edges" value={String(props.layoutView.edges.length)} />
      <Metric label="Extends" value={String(props.layoutView.extendsEdges.length)} />
      <Metric label="Warnings" value={String(props.layoutView.diagnostics.length + (props.parsed?.diagnostics.length ?? 0))} />
      <Metric label="Score" value={formatScoreValue(props.score?.value)} />
      <Metric label="Crossings" value={formatScoreValue(props.score?.edgeCrossings)} />
      <Metric label="Node hits" value={formatScoreValue(props.score?.edgeNodeHits)} />
      <Metric label="Bends" value={formatScoreValue(props.score?.edgeBends)} />
    </div>
  );
}

type EdgeTerminal = "source" | "target";
type AnchorEndpoint = {
  edge: MxLayoutEdge;
  terminal: EdgeTerminal;
  ratio: number;
};

function connectEdgeTerminalAndReorderAnchors(
  graph: MxGraphModel,
  edgeId: string,
  terminal: EdgeTerminal,
  classId: string,
  anchor: MxAnchor
): MxGraphModel {
  const previousEdge = extractLayoutViewModel(graph).edges.find((edge) => edge.id === edgeId);
  const previousClassId = terminal === "source" ? previousEdge?.sourceId : previousEdge?.targetId;
  const previousAnchor = terminal === "source" ? previousEdge?.sourceAnchor : previousEdge?.targetAnchor;
  const changedEdgeIds = new Set<string>([edgeId]);

  let next = updateEdgeTerminal(graph, edgeId, terminal === "source" ? { sourceId: classId } : { targetId: classId });
  next = updateEdgeRoute(next, edgeId, terminal === "source" ? { sourceAnchor: anchor } : { targetAnchor: anchor });

  if (previousClassId && previousAnchor && (previousClassId !== classId || previousAnchor.side !== anchor.side)) {
    const previousSideOrder = reorderAnchorsOnSide(next, previousClassId, previousAnchor.side);
    next = previousSideOrder.graph;
    previousSideOrder.edgeIds.forEach((changedEdgeId) => changedEdgeIds.add(changedEdgeId));
  }

  const nextSideOrder = reorderAnchorsOnSide(next, classId, anchor.side, {
    edgeId,
    terminal,
    ratio: anchor.ratio
  });
  next = nextSideOrder.graph;
  nextSideOrder.edgeIds.forEach((changedEdgeId) => changedEdgeIds.add(changedEdgeId));

  return rerouteEdgesById(next, changedEdgeIds);
}

function moveClassesAndNormalizeEdges(graph: MxGraphModel, moves: ClassMove[]): MxGraphModel {
  const movedClassIds = new Set<string>();
  const movedGraph = moves.reduce((next, move) => {
    movedClassIds.add(move.id);
    return updateCellGeometry(next, move.id, { x: move.x, y: move.y });
  }, graph);

  return normalizeIncidentEdgeRoutes(movedGraph, movedClassIds);
}

function normalizeIncidentEdgeRoutes(graph: MxGraphModel, classIds: Set<string>): MxGraphModel {
  const view = extractLayoutViewModel(graph);
  const edgeIds = new Set(
    view.edges
      .filter((edge) => classIds.has(edge.sourceId ?? "") || classIds.has(edge.targetId ?? ""))
      .map((edge) => edge.id)
  );

  return normalizeEdgesById(graph, edgeIds);
}

function normalizeEdgesById(graph: MxGraphModel, edgeIds: Set<string>): MxGraphModel {
  if (edgeIds.size === 0) {
    return graph;
  }

  const view = extractLayoutViewModel(graph);
  return view.edges
    .filter((edge) => edgeIds.has(edge.id))
    .reduce((next, edge) => updateEdgeRoute(next, edge.id, { waypoints: orthogonalizeWaypoints(edge, view.classes) }), graph);
}

function rerouteEdgesById(graph: MxGraphModel, edgeIds: Set<string>): MxGraphModel {
  if (edgeIds.size === 0) {
    return graph;
  }

  const view = extractLayoutViewModel(graph);
  return view.edges
    .filter((edge) => edgeIds.has(edge.id))
    .reduce((next, edge) => updateEdgeRoute(next, edge.id, { waypoints: orthogonalizeWaypoints(edge, view.classes, []) }), graph);
}

function reorderAnchorsOnSide(
  graph: MxGraphModel,
  classId: string,
  side: MxAnchorSide,
  moved?: { edgeId: string; terminal: EdgeTerminal; ratio: number }
): { graph: MxGraphModel; edgeIds: Set<string> } {
  const view = extractLayoutViewModel(graph);
  const endpoints = collectAnchorEndpoints(view.edges, classId, side);
  if (endpoints.length === 0) {
    return { graph, edgeIds: new Set() };
  }

  const ordered = moved ? reorderMovedEndpoint(endpoints, moved) : [...endpoints].sort(compareAnchorEndpoints);
  const edgeIds = new Set<string>();
  const nextGraph = ordered.reduce((next, endpoint, index) => {
    const ratio = (index + 1) / (endpoints.length + 1);
    const anchor = { side, ratio };
    edgeIds.add(endpoint.edge.id);
    return updateEdgeRoute(next, endpoint.edge.id, endpoint.terminal === "source" ? { sourceAnchor: anchor } : { targetAnchor: anchor });
  }, graph);

  return { graph: nextGraph, edgeIds };
}

function collectAnchorEndpoints(edges: MxLayoutEdge[], classId: string, side: MxAnchorSide): AnchorEndpoint[] {
  return edges.flatMap((edge) => {
    const items: AnchorEndpoint[] = [];

    if (edge.sourceId === classId && edge.sourceAnchor?.side === side) {
      items.push({
        edge,
        terminal: "source",
        ratio: edge.sourceAnchor.ratio
      });
    }

    if (edge.targetId === classId && edge.targetAnchor?.side === side) {
      items.push({
        edge,
        terminal: "target",
        ratio: edge.targetAnchor.ratio
      });
    }

    return items;
  });
}

function reorderMovedEndpoint(
  endpoints: AnchorEndpoint[],
  moved: { edgeId: string; terminal: EdgeTerminal; ratio: number }
): AnchorEndpoint[] {
  const movedEndpoint = endpoints.find((endpoint) => endpoint.edge.id === moved.edgeId && endpoint.terminal === moved.terminal);
  if (!movedEndpoint) {
    return [...endpoints].sort(compareAnchorEndpoints);
  }

  const stationary = endpoints
    .filter((endpoint) => endpoint !== movedEndpoint)
    .sort(compareAnchorEndpoints);
  const insertIndex = stationary.filter((endpoint) => endpoint.ratio <= moved.ratio).length;

  return [
    ...stationary.slice(0, insertIndex),
    { ...movedEndpoint, ratio: moved.ratio },
    ...stationary.slice(insertIndex)
  ];
}

function compareAnchorEndpoints(first: AnchorEndpoint, second: AnchorEndpoint): number {
  const ratioOrder = first.ratio - second.ratio;
  if (Math.abs(ratioOrder) > 0.000001) {
    return ratioOrder;
  }

  return first.edge.id.localeCompare(second.edge.id) || first.terminal.localeCompare(second.terminal);
}

function buildSegmentHandles(points: MxPoint[]): Array<MxPoint & { segmentIndex: number; orientation: "horizontal" | "vertical" }> {
  const handles: Array<MxPoint & { segmentIndex: number; orientation: "horizontal" | "vertical" }> = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    handles.push({
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      segmentIndex: index,
      orientation: Math.abs(start.x - end.x) >= Math.abs(start.y - end.y) ? "horizontal" : "vertical"
    });
  }

  return handles;
}

function moveEdgeSegment(
  edge: MxLayoutEdge,
  classes: MxLayoutClass[],
  segmentIndex: number,
  point: MxPoint,
  forceDirect = false
): MxPoint[] {
  const source = classes.find((classCell) => classCell.id === edge.sourceId);
  const target = classes.find((classCell) => classCell.id === edge.targetId);
  if (!source || !target) {
    return edge.waypoints;
  }

  const sourcePoint = anchorPoint(source, edge.sourceAnchor);
  const targetPoint = anchorPoint(target, edge.targetAnchor);
  const fullPoints = [sourcePoint, ...edge.waypoints, targetPoint];
  const start = fullPoints[segmentIndex];
  const end = fullPoints[segmentIndex + 1];

  if (!start || !end) {
    return edge.waypoints;
  }

  if (forceDirect || edge.waypoints.length === 0) {
    if (Math.abs(start.x - end.x) >= Math.abs(start.y - end.y)) {
      const x = snap(point.x);
      return orthogonalizeWaypoints(edge, classes, [
        { x, y: sourcePoint.y },
        { x, y: targetPoint.y }
      ]);
    }

    const y = snap(point.y);
    return orthogonalizeWaypoints(edge, classes, [
      { x: sourcePoint.x, y },
      { x: targetPoint.x, y }
    ]);
  }

  const next = edge.waypoints.map((waypoint) => ({ ...waypoint }));
  const isHorizontal = Math.abs(start.x - end.x) >= Math.abs(start.y - end.y);

  if (isHorizontal) {
    const y = snap(point.y);
    if (segmentIndex === 0) {
      next[0] = { ...next[0], y };
      next.unshift({ x: sourcePoint.x, y });
    } else {
      next[segmentIndex - 1] = { ...next[segmentIndex - 1], y };
    }

    if (segmentIndex >= edge.waypoints.length) {
      next.push({ x: targetPoint.x, y });
    } else {
      const adjustedIndex = segmentIndex === 0 ? segmentIndex + 1 : segmentIndex;
      next[adjustedIndex] = { ...next[adjustedIndex], y };
    }
  } else {
    const x = snap(point.x);
    if (segmentIndex === 0) {
      next[0] = { ...next[0], x };
      next.unshift({ x, y: sourcePoint.y });
    } else {
      next[segmentIndex - 1] = { ...next[segmentIndex - 1], x };
    }

    if (segmentIndex >= edge.waypoints.length) {
      next.push({ x, y: targetPoint.y });
    } else {
      const adjustedIndex = segmentIndex === 0 ? segmentIndex + 1 : segmentIndex;
      next[adjustedIndex] = { ...next[adjustedIndex], x };
    }
  }

  return orthogonalizeWaypoints(edge, classes, next);
}

function orthogonalizeWaypoints(edge: MxLayoutEdge, classes: MxLayoutClass[], waypoints = edge.waypoints): MxPoint[] {
  const source = classes.find((classCell) => classCell.id === edge.sourceId);
  const target = classes.find((classCell) => classCell.id === edge.targetId);
  if (!source || !target) {
    return compactWaypoints(waypoints);
  }

  return orthogonalWaypointsBetween(
    anchorPoint(source, edge.sourceAnchor),
    anchorPoint(target, edge.targetAnchor),
    waypoints,
    edge.sourceAnchor,
    edge.targetAnchor
  );
}

function orthogonalWaypointsBetween(
  source: MxPoint,
  target: MxPoint,
  waypoints: MxPoint[],
  sourceAnchor?: MxAnchor,
  targetAnchor?: MxAnchor
): MxPoint[] {
  const full = [source, ...compactWaypoints(waypoints), target].map((point) => ({ x: snap(point.x), y: snap(point.y) }));
  const normalized = normalizeEndpointApproach(full, sourceAnchor, targetAnchor);

  return compactOrthogonalPoints(normalized).slice(1, -1);
}

function normalizeEndpointApproach(points: MxPoint[], sourceAnchor?: MxAnchor, targetAnchor?: MxAnchor): MxPoint[] {
  let normalized = orthogonalizePointList(points);

  for (let index = 0; index < 2; index += 1) {
    normalized = enforceEndpointApproach(normalized, sourceAnchor, targetAnchor);
    normalized = compactOrthogonalPoints(orthogonalizePointList(normalized));
  }

  return normalized;
}

function orthogonalizePointList(points: MxPoint[]): MxPoint[] {
  const normalized: MxPoint[] = [points[0]];

  for (const nextPoint of points.slice(1)) {
    const last = normalized[normalized.length - 1];
    if (!last) {
      normalized.push(nextPoint);
      continue;
    }

    if (last.x === nextPoint.x || last.y === nextPoint.y) {
      normalized.push(nextPoint);
      continue;
    }

    normalized.push({ x: nextPoint.x, y: last.y }, nextPoint);
  }

  return compactWaypoints(normalized);
}

function enforceEndpointApproach(points: MxPoint[], sourceAnchor?: MxAnchor, targetAnchor?: MxAnchor): MxPoint[] {
  if (points.length < 2 || !sourceAnchor || !targetAnchor) {
    return points;
  }

  const withSource = [
    points[0],
    ...endpointApproachSupportPoints(points[0], points[1], sourceAnchor, "source"),
    ...points.slice(1)
  ];
  const targetPoint = withSource[withSource.length - 1];
  const targetPrevious = withSource[withSource.length - 2];

  if (!targetPrevious) {
    return withSource;
  }

  return [
    ...withSource.slice(0, -1),
    ...endpointApproachSupportPoints(targetPoint, targetPrevious, targetAnchor, "target"),
    targetPoint
  ];
}

function endpointApproachSupportPoints(anchorPointValue: MxPoint, neighbor: MxPoint, anchor: MxAnchor, role: "source" | "target"): MxPoint[] {
  if (endpointApproachIsPerpendicular(anchorPointValue, neighbor, anchor)) {
    return [];
  }

  const projected = projectedEndpointApproachPoint(anchorPointValue, neighbor, anchor);
  if (!samePoint(projected, anchorPointValue) && pointIsOutsideEndpointSide(anchorPointValue, projected, anchor)) {
    return [projected];
  }

  const port = outsideAnchorPort(anchorPointValue, anchor);
  const bridge = anchor.side === "top" || anchor.side === "bottom"
    ? { x: neighbor.x, y: port.y }
    : { x: port.x, y: neighbor.y };

  if (samePoint(port, bridge)) {
    return [port];
  }

  return role === "source"
    ? [port, bridge]
    : [bridge, port];
}

function endpointApproachIsPerpendicular(anchorPointValue: MxPoint, neighbor: MxPoint, anchor: MxAnchor): boolean {
  return anchor.side === "top" || anchor.side === "bottom"
    ? anchorPointValue.x === neighbor.x
    : anchorPointValue.y === neighbor.y;
}

function projectedEndpointApproachPoint(anchorPointValue: MxPoint, neighbor: MxPoint, anchor: MxAnchor): MxPoint {
  return anchor.side === "top" || anchor.side === "bottom"
    ? { x: anchorPointValue.x, y: neighbor.y }
    : { x: neighbor.x, y: anchorPointValue.y };
}

function pointIsOutsideEndpointSide(anchorPointValue: MxPoint, point: MxPoint, anchor: MxAnchor): boolean {
  if (anchor.side === "top") {
    return point.y < anchorPointValue.y;
  }

  if (anchor.side === "bottom") {
    return point.y > anchorPointValue.y;
  }

  if (anchor.side === "left") {
    return point.x < anchorPointValue.x;
  }

  return point.x > anchorPointValue.x;
}

function outsideAnchorPort(point: MxPoint, anchor: MxAnchor): MxPoint {
  const distance = 24;

  if (anchor.side === "top") {
    return { x: point.x, y: point.y - distance };
  }

  if (anchor.side === "bottom") {
    return { x: point.x, y: point.y + distance };
  }

  if (anchor.side === "left") {
    return { x: point.x - distance, y: point.y };
  }

  return { x: point.x + distance, y: point.y };
}

function compactOrthogonalPoints(points: MxPoint[]): MxPoint[] {
  const withoutDuplicates = compactWaypoints(points);
  return withoutDuplicates.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) {
      return true;
    }

    const previous = all[index - 1];
    const next = all[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
}

function compactWaypoints(waypoints: MxPoint[]): MxPoint[] {
  return waypoints.filter((point, index, all) => {
    const previous = all[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function samePoint(left: MxPoint, right: MxPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function findClassSideAtPoint(classes: MxLayoutClass[], point: MxPoint): { classId: string; side: MxAnchorSide; ratio: number } | undefined {
  const tolerance = 48;
  let best: { classId: string; side: MxAnchorSide; ratio: number; distance: number } | undefined;

  for (const classCell of classes) {
    if (
      point.x < classCell.x - tolerance ||
      point.x > classCell.x + classCell.width + tolerance ||
      point.y < classCell.y - tolerance ||
      point.y > classCell.y + classCell.height + tolerance
    ) {
      continue;
    }

    const candidates: Array<{ side: MxAnchorSide; ratio: number; distance: number }> = [
      {
        side: "left",
        ratio: clamp((point.y - classCell.y) / classCell.height, 0.05, 0.95),
        distance: Math.abs(point.x - classCell.x)
      },
      {
        side: "right",
        ratio: clamp((point.y - classCell.y) / classCell.height, 0.05, 0.95),
        distance: Math.abs(point.x - (classCell.x + classCell.width))
      },
      {
        side: "top",
        ratio: clamp((point.x - classCell.x) / classCell.width, 0.05, 0.95),
        distance: Math.abs(point.y - classCell.y)
      },
      {
        side: "bottom",
        ratio: clamp((point.x - classCell.x) / classCell.width, 0.05, 0.95),
        distance: Math.abs(point.y - (classCell.y + classCell.height))
      }
    ];
    const nearest = candidates.sort((first, second) => first.distance - second.distance)[0];

    if (!best || nearest.distance < best.distance) {
      best = {
        classId: classCell.id,
        side: nearest.side,
        ratio: nearest.ratio,
        distance: nearest.distance
      };
    }
  }

  return best;
}

function isAdditiveSelection(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

function isSelectionItemSelected(selection: SelectionItem[], item: SelectionItem): boolean {
  return selection.some((selectedItem) => selectionKey(selectedItem) === selectionKey(item));
}

function toggleSelectionItem(selection: SelectionItem[], item: SelectionItem): SelectionItem[] {
  return isSelectionItemSelected(selection, item)
    ? selection.filter((selectedItem) => selectionKey(selectedItem) !== selectionKey(item))
    : dedupeSelection([...selection, item]);
}

function dedupeSelection(selection: SelectionItem[]): SelectionItem[] {
  const seen = new Set<string>();
  return selection.filter((item) => {
    const key = selectionKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function selectionKey(item: SelectionItem): string {
  return `${item.type}:${item.id}`;
}

function selectByMarquee(layoutView: MxLayoutViewModel, rect: { x: number; y: number; width: number; height: number }, includeGroups: boolean): SelectionItem[] {
  if (rect.width < 4 && rect.height < 4) {
    return [];
  }

  return dedupeSelection([
    ...layoutView.classes
      .filter((classCell) => rectanglesIntersect(rect, classCell))
      .map((classCell): SelectionItem => ({ type: "class", id: classCell.id })),
    ...(includeGroups
      ? layoutView.groups
        .filter((group) => rectanglesIntersect(rect, group))
        .map((group): SelectionItem => ({ type: "group", id: group.id }))
      : []),
    ...layoutView.edges
      .filter((edge) => edgeIntersectsRect(edge, layoutView.classes, rect))
      .map((edge): SelectionItem => ({ type: "edge", id: edge.id }))
  ]);
}

function edgeIntersectsRect(edge: MxLayoutEdge, classes: MxLayoutClass[], rect: { x: number; y: number; width: number; height: number }): boolean {
  const source = classes.find((classCell) => classCell.id === edge.sourceId);
  const target = classes.find((classCell) => classCell.id === edge.targetId);
  if (!source || !target) {
    return false;
  }

  const points = [anchorPoint(source, edge.sourceAnchor), ...edge.waypoints, anchorPoint(target, edge.targetAnchor)];
  return points.some((point) => pointInRect(point, rect)) || points.slice(0, -1).some((point, index) => segmentIntersectsRect(point, points[index + 1], rect));
}

function segmentIntersectsRect(start: MxPoint, end: MxPoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  const segmentRect = normalizeRect(start, end);
  return rectanglesIntersect(
    { x: segmentRect.x, y: segmentRect.y, width: Math.max(1, segmentRect.width), height: Math.max(1, segmentRect.height) },
    rect
  );
}

function pointInRect(point: MxPoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function normalizeRect(start: MxPoint, end: MxPoint): { x: number; y: number; width: number; height: number } {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function rectanglesIntersect(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): boolean {
  return first.x <= second.x + second.width && first.x + first.width >= second.x && first.y <= second.y + second.height && first.y + first.height >= second.y;
}

function snap(value: number): number {
  return Math.round(value);
}

function SelectedInspector(props: {
  selectedClass?: MxLayoutClass;
  selectedEdge?: MxLayoutEdge;
  selectedGroup?: MxLayoutGroup;
  diagnostics: MxLayoutViewModel["diagnostics"];
  onClassChange: (id: string, patch: Partial<Pick<MxLayoutClass, "x" | "y" | "width" | "height">>) => void;
}): React.JSX.Element {
  return (
    <section className="inspector-section">
      {props.selectedClass ? (
        <ClassInspector classCell={props.selectedClass} onChange={props.onClassChange} />
      ) : props.selectedEdge ? (
        <EdgeInspector edge={props.selectedEdge} />
      ) : props.selectedGroup ? (
        <GroupInspector group={props.selectedGroup} />
      ) : (
        <p className="empty-selection">Select a class, edge, or group.</p>
      )}

      <Diagnostics diagnostics={props.diagnostics} />
    </section>
  );
}

function ClassInspector(props: {
  classCell: MxLayoutClass;
  onChange: (id: string, patch: Partial<Pick<MxLayoutClass, "x" | "y" | "width" | "height">>) => void;
}): React.JSX.Element {
  return (
    <div>
      <h3>Class: {props.classCell.label}</h3>
      <div className="field-grid">
        <NumberField label="X" value={props.classCell.x} onChange={(value) => props.onChange(props.classCell.id, { x: value })} />
        <NumberField label="Y" value={props.classCell.y} onChange={(value) => props.onChange(props.classCell.id, { y: value })} />
        <NumberField label="Width" value={props.classCell.width} onChange={(value) => props.onChange(props.classCell.id, { width: value })} />
        <NumberField label="Height" value={props.classCell.height} onChange={(value) => props.onChange(props.classCell.id, { height: value })} />
      </div>
      <p className="inspector-meta">Group: {props.classCell.stereotype ?? "Ungrouped"} | Rows: {props.classCell.children.length}</p>
    </div>
  );
}

function EdgeInspector(props: { edge: MxLayoutEdge }): React.JSX.Element {
  return (
    <div>
      <h3>Edge: {props.edge.sourceId ?? "?"} {"->"} {props.edge.targetId ?? "?"}</h3>
      <p className="inspector-meta">Type: {props.edge.kind} | Route points: {props.edge.waypoints.length}</p>
      <div className="edge-hint">
        <p>Drag segment midpoint handles to move route segments perpendicular to the segment.</p>
        <p>Drag source/target handles onto a class side to reconnect and redistribute anchors.</p>
      </div>
      <div className="anchor-summary">
        <ReadOnlyAnchor label="Source anchor" anchor={props.edge.sourceAnchor} />
        <ReadOnlyAnchor label="Target anchor" anchor={props.edge.targetAnchor} />
      </div>
    </div>
  );
}

function ReadOnlyAnchor(props: { label: string; anchor?: MxAnchor }): React.JSX.Element {
  return (
    <div className="read-only-anchor">
      <span>{props.label}</span>
      <strong>{props.anchor ? `${props.anchor.side} @ ${props.anchor.ratio.toFixed(2)}` : "auto"}</strong>
    </div>
  );
}

function GroupInspector(props: { group: MxLayoutGroup }): React.JSX.Element {
  return (
    <div>
      <h3>Group: {props.group.label}</h3>
      <div className="field-grid">
        <ReadOnlyField label="X" value={props.group.x} />
        <ReadOnlyField label="Y" value={props.group.y} />
        <ReadOnlyField label="Width" value={props.group.width} />
        <ReadOnlyField label="Height" value={props.group.height} />
      </div>
      <p className="inspector-meta">Class count: {props.group.classIds.length}</p>
    </div>
  );
}

function LayoutIntentPanel(props: {
  intent?: StereotypeLayoutIntent;
  hasUserPreset: boolean;
  layoutView: MxLayoutViewModel;
  groupFrames: boolean;
  onGroupFramesChange: (enabled: boolean) => void;
  onResetIntent: () => void;
  onIntentChange: (nextIntent: StereotypeLayoutIntent, options?: IntentChangeOptions) => void;
}): React.JSX.Element | null {
  const baseIntent = props.intent;
  const [isGridPopupOpen, setIsGridPopupOpen] = useState(false);
  useEffect(() => {
    if (!isGridPopupOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsGridPopupOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isGridPopupOpen]);

  if (!baseIntent) {
    return null;
  }
  const matrixSize = getIntentMatrixSize(baseIntent);
  const matrixIntent = props.hasUserPreset && isGroupMatrixIntent(baseIntent)
    ? createMatrixIntentFromPreset(baseIntent, matrixSize)
    : createMatrixIntentFromCurrentLayout(baseIntent, props.layoutView, matrixSize);

  return (
    <section className="inspector-section">
      <h3>Layout Intent</h3>
      <label className="toggle-row">
        <input type="checkbox" checked={props.groupFrames} onChange={(event) => props.onGroupFramesChange(event.target.checked)} />
        Group frames
      </label>
      <button type="button" className="secondary-button full-width" onClick={() => setIsGridPopupOpen(true)}>
        <Grid3X3 aria-hidden="true" size={16} />
        Grid intent
      </button>
      <button type="button" className="secondary-button full-width" onClick={props.onResetIntent}>
        <RefreshCw aria-hidden="true" size={16} />
        Reset intent
      </button>
      {isGridPopupOpen ? (
        <GroupGridPopup
          intent={matrixIntent}
          layoutView={props.layoutView}
          onClose={() => setIsGridPopupOpen(false)}
          onSave={(nextIntent) => {
            props.onIntentChange(nextIntent, { status: "Layout intent saved" });
            setIsGridPopupOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function GroupGridPopup(props: {
  intent: StereotypeLayoutIntent;
  layoutView: MxLayoutViewModel;
  onClose: () => void;
  onSave: (nextIntent: StereotypeLayoutIntent) => void;
}): React.JSX.Element {
  const [draftIntent, setDraftIntent] = useState(() => cloneLayoutIntent(props.intent));
  const matrixSize = getIntentMatrixSize(draftIntent);
  const updateDraftIntent = (updater: (intent: StereotypeLayoutIntent) => void): void => {
    setDraftIntent((current) => {
      const next = cloneLayoutIntent(current);
      updater(next);
      return next;
    });
  };

  return (
    <div className="layout-popup-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        props.onClose();
      }
    }}>
      <div className="layout-popup" role="dialog" aria-modal="true" aria-labelledby="group-grid-popup-title">
        <div className="layout-popup-header">
          <div>
            <h3 id="group-grid-popup-title">Group Grid</h3>
            <p>{matrixSize}x{matrixSize} layout intent matrix</p>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} title="Close">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="layout-popup-toolbar">
          <div className="segmented-control" aria-label="Group grid size">
            {[10, 15].map((size) => (
              <button
                key={size}
                type="button"
                className={matrixSize === size ? "active" : ""}
                onClick={() => updateDraftIntent((intent) => resizeMatrixIntent(intent, props.layoutView, size))}
              >
                {size}x{size}
              </button>
            ))}
          </div>
          <div className="layout-popup-actions">
            <button type="button" className="secondary-button" onClick={props.onClose}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={() => props.onSave(draftIntent)}>
              Save
            </button>
          </div>
        </div>
        <GroupGridEditor
          intent={draftIntent}
          layoutView={props.layoutView}
          matrixSize={matrixSize}
          onMoveGroup={(groupId, gridX, gridY) => updateDraftIntent((intent) => moveGroupInMatrix(intent, getIntentMatrixSize(intent), groupId, gridX, gridY))}
          onRotateGroup={(groupId) => updateDraftIntent((intent) => rotateGroupInMatrix(intent, props.layoutView, getIntentMatrixSize(intent), groupId))}
        />
      </div>
    </div>
  );
}

function GroupGridEditor(props: {
  intent: StereotypeLayoutIntent;
  layoutView: MxLayoutViewModel;
  matrixSize: number;
  onMoveGroup: (groupId: string, gridX: number, gridY: number) => void;
  onRotateGroup: (groupId: string) => void;
}): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [dropPreview, setDropPreview] = useState<GroupGridDropPreview>();
  const cells = Array.from({ length: props.matrixSize * props.matrixSize }, (_, index) => ({
    index,
    x: index % props.matrixSize,
    y: Math.floor(index / props.matrixSize)
  }));
  const viewGroupByIntentId = new Map(props.layoutView.groups.map((group) => [group.id, group]));

  const handleDragStart = (event: DragEvent<HTMLDivElement>, groupId: string): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    const group = props.intent.groups.find((candidate) => candidate.id === groupId);
    if (group) {
      setDropPreview(createGroupGridDropPreview(props.intent.groups, props.matrixSize, group.id, group.gridX, group.gridY));
    }
  };

  const handleBoardDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const board = boardRef.current;
    const groupId = dropPreview?.groupId || event.dataTransfer.getData("text/plain");
    if (!board || !groupId) {
      return;
    }

    const cell = matrixCellFromDragEvent(event, board, props.matrixSize);
    if (cell) {
      setDropPreview(createGroupGridDropPreview(props.intent.groups, props.matrixSize, groupId, cell.x, cell.y));
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const groupId = dropPreview?.groupId || event.dataTransfer.getData("text/plain");
    const board = boardRef.current;
    const cell = board ? matrixCellFromDragEvent(event, board, props.matrixSize) : undefined;
    const preview = groupId && cell
      ? createGroupGridDropPreview(props.intent.groups, props.matrixSize, groupId, cell.x, cell.y)
      : dropPreview;

    if (preview?.valid) {
      props.onMoveGroup(preview.groupId, preview.gridX, preview.gridY);
    }

    setDropPreview(undefined);
  };

  return (
    <div
      ref={boardRef}
      className="group-grid-board"
      style={{
        gridTemplateColumns: `repeat(${props.matrixSize}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${props.matrixSize}, minmax(0, 1fr))`
      }}
      onDragOver={handleBoardDragOver}
      onDrop={handleDrop}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropPreview(undefined);
        }
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.index}
          className="group-grid-cell"
        />
      ))}
      {dropPreview ? (
        <div
          className={`group-grid-drop-preview ${dropPreview.valid ? "valid" : "invalid"}`}
          style={{
            gridColumn: `${dropPreview.gridX + 1} / span ${dropPreview.gridWidth}`,
            gridRow: `${dropPreview.gridY + 1} / span ${dropPreview.gridHeight}`
          }}
        >
          <span>x={dropPreview.gridX}, y={dropPreview.gridY}</span>
          <small>{dropPreview.gridWidth}x{dropPreview.gridHeight} {dropPreview.valid ? "drop" : "blocked"}</small>
        </div>
      ) : null}
      {props.intent.groups.map((group) => {
        const viewGroup = viewGroupByIntentId.get(group.id) ?? findLayoutGroupForIntentGroup(group, props.layoutView);
        const gridX = clampInteger(group.gridX, 0, props.matrixSize - 1);
        const gridY = clampInteger(group.gridY, 0, props.matrixSize - 1);
        const gridWidth = clampInteger(group.gridWidth, 1, props.matrixSize - gridX);
        const gridHeight = clampInteger(group.gridHeight, 1, props.matrixSize - gridY);

        return (
          <div
            key={group.id}
            role="button"
            tabIndex={0}
            draggable
            className={`group-grid-token ${dropPreview?.groupId === group.id ? "dragging" : ""}`}
            style={{
              gridColumn: `${gridX + 1} / span ${gridWidth}`,
              gridRow: `${gridY + 1} / span ${gridHeight}`
            }}
            onDragStart={(event) => handleDragStart(event, group.id)}
            title={`${group.label}: ${gridWidth}x${gridHeight}`}
          >
            <div className="group-grid-token-title">
              <span>{group.label}</span>
              <button
                type="button"
                className="group-grid-token-action"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onRotateGroup(group.id);
                }}
                title={`Rotate ${group.label}`}
              >
                <RotateCw aria-hidden="true" size={12} />
              </button>
            </div>
            <small>{viewGroup?.classIds.length ?? group.nodeIds.length} classes | {packingLabel(group.packing)} | {gridWidth}x{gridHeight}</small>
          </div>
        );
      })}
    </div>
  );
}

type GroupGridDropPreview = {
  groupId: string;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  valid: boolean;
};

function createGroupGridDropPreview(
  groups: StereotypeLayoutIntent["groups"],
  matrixSize: number,
  groupId: string,
  gridX: number,
  gridY: number
): GroupGridDropPreview | undefined {
  const normalizedGroups = groups.map((group) => normalizeMatrixGroup(group, matrixSize));
  const group = normalizedGroups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return undefined;
  }

  const nextX = clampInteger(gridX, 0, matrixSize - group.gridWidth);
  const nextY = clampInteger(gridY, 0, matrixSize - group.gridHeight);

  return {
    groupId,
    gridX: nextX,
    gridY: nextY,
    gridWidth: group.gridWidth,
    gridHeight: group.gridHeight,
    valid: isMatrixPlacementFree(normalizedGroups, groupId, nextX, nextY, group.gridWidth, group.gridHeight)
  };
}

function matrixCellFromDragEvent(
  event: DragEvent<HTMLElement>,
  board: HTMLDivElement,
  matrixSize: number
): { x: number; y: number } | undefined {
  const rect = board.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  const style = window.getComputedStyle(board);
  const paddingLeft = parseCssPixels(style.paddingLeft);
  const paddingRight = parseCssPixels(style.paddingRight);
  const paddingTop = parseCssPixels(style.paddingTop);
  const paddingBottom = parseCssPixels(style.paddingBottom);
  const innerWidth = Math.max(1, rect.width - paddingLeft - paddingRight);
  const innerHeight = Math.max(1, rect.height - paddingTop - paddingBottom);
  const xRatio = clamp((event.clientX - rect.left - paddingLeft) / innerWidth, 0, 0.999);
  const yRatio = clamp((event.clientY - rect.top - paddingTop) / innerHeight, 0, 0.999);

  return {
    x: clampInteger(Math.floor(xRatio * matrixSize), 0, matrixSize - 1),
    y: clampInteger(Math.floor(yRatio * matrixSize), 0, matrixSize - 1)
  };
}

function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getIntentMatrixSize(intent: StereotypeLayoutIntent): number {
  return intent.grid.columns === 15 && intent.grid.rows === 15 ? 15 : 10;
}

function isGroupMatrixIntent(intent: StereotypeLayoutIntent): boolean {
  return (intent.grid.columns === 10 && intent.grid.rows === 10) || (intent.grid.columns === 15 && intent.grid.rows === 15);
}

function createMatrixIntentFromCurrentLayout(
  baseIntent: StereotypeLayoutIntent,
  layoutView: MxLayoutViewModel,
  matrixSize: number
): StereotypeLayoutIntent {
  const next = cloneLayoutIntent(baseIntent);
  applyCurrentLayoutMatrix(next, layoutView, matrixSize);
  return next;
}

function createMatrixIntentFromPreset(
  baseIntent: StereotypeLayoutIntent,
  matrixSize: number
): StereotypeLayoutIntent {
  const next = cloneLayoutIntent(baseIntent);
  setIntentMatrixSize(next, matrixSize);
  next.groups = next.groups.map((group) => normalizeMatrixGroup(group, matrixSize));
  return next;
}

function applyCurrentLayoutMatrix(
  intent: StereotypeLayoutIntent,
  layoutView: MxLayoutViewModel,
  matrixSize: number
): void {
  const measuredGroups = intent.groups.map((group) => ({
    group,
    rectangle: currentGroupRectangle(group, layoutView)
  }));
  const bounds = rectangleBounds(measuredGroups.flatMap(({ rectangle }) => rectangle ? [rectangle] : []));

  if (!bounds) {
    applyGroupMatrix(intent, layoutView, matrixSize);
    return;
  }

  setIntentMatrixSize(intent, matrixSize);
  intent.groups = packMatrixGroups(
    measuredGroups.map(({ group, rectangle }) => {
      const footprint = estimateGroupFootprint(group, layoutView, matrixSize);
      if (!rectangle) {
        return {
          ...group,
          ...footprint
        };
      }

      return {
        ...group,
        ...matrixRectangleFromLayout(rectangle, bounds, matrixSize, footprint)
      };
    }),
    matrixSize
  );
}

function applyGroupMatrix(
  intent: StereotypeLayoutIntent,
  layoutView: MxLayoutViewModel,
  matrixSize: number
): void {
  setIntentMatrixSize(intent, matrixSize);
  intent.groups = packMatrixGroups(
    intent.groups.map((group) => ({
      ...group,
      ...estimateGroupFootprint(group, layoutView, matrixSize)
    })),
    matrixSize
  );
}

function rotateGroupInMatrix(
  intent: StereotypeLayoutIntent,
  layoutView: MxLayoutViewModel,
  matrixSize: number,
  groupId: string
): void {
  setIntentMatrixSize(intent, matrixSize);
  const groups = intent.groups.map((group) => normalizeMatrixGroup(group, matrixSize));
  const target = groups.find((group) => group.id === groupId);

  if (!target) {
    return;
  }

  const nextPacking = target.packing === "vertical" ? "horizontal" : "vertical";
  const footprint = estimateGroupFootprint({ ...target, packing: nextPacking }, layoutView, matrixSize);
  const nextWidth = clampInteger(footprint.gridWidth, 1, matrixSize - target.gridX);
  const nextHeight = clampInteger(footprint.gridHeight, 1, matrixSize - target.gridY);
  if (!isMatrixPlacementFree(groups, target.id, target.gridX, target.gridY, nextWidth, nextHeight)) {
    return;
  }

  target.gridWidth = nextWidth;
  target.gridHeight = nextHeight;
  target.packing = nextPacking;
  intent.groups = groups;
}

function moveGroupInMatrix(intent: StereotypeLayoutIntent, matrixSize: number, groupId: string, gridX: number, gridY: number): void {
  setIntentMatrixSize(intent, matrixSize);
  const groups = intent.groups.map((group) => normalizeMatrixGroup(group, matrixSize));
  const target = groups.find((group) => group.id === groupId);

  if (!target) {
    return;
  }

  const nextX = clampInteger(gridX, 0, matrixSize - target.gridWidth);
  const nextY = clampInteger(gridY, 0, matrixSize - target.gridHeight);

  if (!isMatrixPlacementFree(groups, target.id, nextX, nextY, target.gridWidth, target.gridHeight)) {
    return;
  }

  target.gridX = nextX;
  target.gridY = nextY;
  intent.groups = groups;
}

function setIntentMatrixSize(intent: StereotypeLayoutIntent, matrixSize: number): void {
  intent.grid.columns = matrixSize;
  intent.grid.rows = matrixSize;
}

function estimateGroupFootprint(
  group: StereotypeLayoutIntent["groups"][number],
  layoutView: MxLayoutViewModel,
  matrixSize: number
): Pick<StereotypeLayoutIntent["groups"][number], "gridWidth" | "gridHeight"> {
  const viewGroup = findLayoutGroupForIntentGroup(group, layoutView);
  const groupClasses = classesForIntentGroup(group, layoutView);
  const classCount = Math.max(1, groupClasses.length || group.nodeIds.length);
  const packedBounds = groupClasses.length > 0 ? estimatePackedGroupBounds(groupClasses, group.packing) : undefined;
  const referenceWidth = medianPositive(layoutView.classes.map((classCell) => classCell.width), 260);
  const referenceHeight = medianPositive(layoutView.classes.map((classCell) => classCell.height), 180);
  const gridScale = 10 / matrixSize;
  const cellWidth = Math.max(380, referenceWidth * 1.45) * gridScale;
  const cellHeight = Math.max(300, referenceHeight * 1.35) * gridScale;
  const measuredWidth = packedBounds?.width ?? viewGroup?.width ?? 0;
  const measuredHeight = packedBounds?.height ?? viewGroup?.height ?? 0;
  const maxSpan = Math.min(matrixSize, matrixSize === 15 ? 8 : 5);
  let gridWidth = clampInteger(Math.ceil(measuredWidth / cellWidth), 1, maxSpan);
  let gridHeight = clampInteger(Math.ceil(measuredHeight / cellHeight), 1, maxSpan);
  const minimumArea = Math.max(1, Math.ceil(classCount / 4));

  while (gridWidth * gridHeight < minimumArea && (gridWidth < maxSpan || gridHeight < maxSpan)) {
    if (group.packing === "vertical") {
      gridHeight = clampInteger(gridHeight + 1, 1, maxSpan);
    } else if (gridWidth <= gridHeight) {
      gridWidth = clampInteger(gridWidth + 1, 1, maxSpan);
    } else {
      gridHeight = clampInteger(gridHeight + 1, 1, maxSpan);
    }
  }

  return {
    gridWidth,
    gridHeight
  };
}

function estimatePackedGroupBounds(classes: MxLayoutClass[], packing: StereotypeLayoutIntent["groups"][number]["packing"]): { width: number; height: number } {
  if (packing === "vertical") {
    return estimateVerticalGroupBounds(classes);
  }

  if (packing === "horizontal") {
    return estimateHorizontalGroupBounds(classes);
  }

  return estimateCompactGroupBounds(classes);
}

function estimateVerticalGroupBounds(classes: MxLayoutClass[]): { width: number; height: number } {
  const groupPadding = 32;
  const nodeGapY = 80;

  return {
    width: Math.max(...classes.map((classCell) => classCell.width)) + groupPadding * 2,
    height: classes.reduce((sum, classCell) => sum + classCell.height, 0) + Math.max(0, classes.length - 1) * nodeGapY + groupPadding * 2
  };
}

function estimateHorizontalGroupBounds(classes: MxLayoutClass[]): { width: number; height: number } {
  const groupPadding = 32;
  const nodeGapX = 80;

  return {
    width: classes.reduce((sum, classCell) => sum + classCell.width, 0) + Math.max(0, classes.length - 1) * nodeGapX + groupPadding * 2,
    height: Math.max(...classes.map((classCell) => classCell.height)) + groupPadding * 2
  };
}

function estimateCompactGroupBounds(classes: MxLayoutClass[]): { width: number; height: number } {
  const groupPadding = 32;
  const nodeGapX = 80;
  const nodeGapY = 80;
  const columnCount = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(classes.length))));
  const rowCount = Math.max(1, Math.ceil(classes.length / columnCount));
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  classes.forEach((classCell, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    columnWidths[column] = Math.max(columnWidths[column], classCell.width);
    rowHeights[row] = Math.max(rowHeights[row], classCell.height);
  });

  return {
    width: columnWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, columnCount - 1) * nodeGapX + groupPadding * 2,
    height: rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowCount - 1) * nodeGapY + groupPadding * 2
  };
}

function packingLabel(packing: StereotypeLayoutIntent["groups"][number]["packing"]): string {
  if (packing === "vertical") {
    return "vertical";
  }

  if (packing === "horizontal") {
    return "horizontal";
  }

  return "grid";
}

function findLayoutGroupForIntentGroup(
  group: StereotypeLayoutIntent["groups"][number],
  layoutView: MxLayoutViewModel
): MxLayoutGroup | undefined {
  return layoutView.groups.find((candidate) => candidate.id === group.id || candidate.label === group.label);
}

function classesForIntentGroup(group: StereotypeLayoutIntent["groups"][number], layoutView: MxLayoutViewModel): MxLayoutClass[] {
  const classById = new Map(layoutView.classes.map((classCell) => [classCell.id, classCell]));
  const viewGroup = findLayoutGroupForIntentGroup(group, layoutView);
  const classIds = viewGroup?.classIds.length ? viewGroup.classIds : group.nodeIds;
  return classIds.flatMap((classId) => {
    const classCell = classById.get(classId);
    return classCell ? [classCell] : [];
  });
}

function currentGroupRectangle(
  group: StereotypeLayoutIntent["groups"][number],
  layoutView: MxLayoutViewModel
): { x: number; y: number; width: number; height: number } | undefined {
  const viewGroup = findLayoutGroupForIntentGroup(group, layoutView);
  if (viewGroup && viewGroup.width > 0 && viewGroup.height > 0) {
    return viewGroup;
  }

  return rectangleBounds(classesForIntentGroup(group, layoutView));
}

function rectangleBounds(rectangles: Array<{ x: number; y: number; width: number; height: number }>): { x: number; y: number; width: number; height: number } | undefined {
  const validRectangles = rectangles.filter((rectangle) =>
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.width) &&
    Number.isFinite(rectangle.height) &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );

  if (validRectangles.length === 0) {
    return undefined;
  }

  const x = Math.min(...validRectangles.map((rectangle) => rectangle.x));
  const y = Math.min(...validRectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...validRectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...validRectangles.map((rectangle) => rectangle.y + rectangle.height));

  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function matrixRectangleFromLayout(
  rectangle: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
  matrixSize: number,
  footprint: Pick<StereotypeLayoutIntent["groups"][number], "gridWidth" | "gridHeight">
): Pick<StereotypeLayoutIntent["groups"][number], "gridX" | "gridY" | "gridWidth" | "gridHeight"> {
  const gridWidth = clampInteger(footprint.gridWidth, 1, matrixSize);
  const gridHeight = clampInteger(footprint.gridHeight, 1, matrixSize);
  const boundsWidth = Math.max(1, bounds.width);
  const boundsHeight = Math.max(1, bounds.height);
  const centerXRatio = clamp((rectangle.x + rectangle.width / 2 - bounds.x) / boundsWidth, 0, 1);
  const centerYRatio = clamp((rectangle.y + rectangle.height / 2 - bounds.y) / boundsHeight, 0, 1);

  return {
    gridX: clampInteger(Math.round(centerXRatio * matrixSize - gridWidth / 2), 0, matrixSize - gridWidth),
    gridY: clampInteger(Math.round(centerYRatio * matrixSize - gridHeight / 2), 0, matrixSize - gridHeight),
    gridWidth,
    gridHeight
  };
}

function medianPositive(values: number[], fallback: number): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return fallback;
  }

  return sorted[Math.floor(sorted.length / 2)];
}

function normalizeMatrixGroup(
  group: StereotypeLayoutIntent["groups"][number],
  matrixSize: number
): StereotypeLayoutIntent["groups"][number] {
  const gridX = clampInteger(group.gridX, 0, matrixSize - 1);
  const gridY = clampInteger(group.gridY, 0, matrixSize - 1);
  const gridWidth = clampInteger(group.gridWidth, 1, matrixSize - gridX);
  const gridHeight = clampInteger(group.gridHeight, 1, matrixSize - gridY);

  return {
    ...group,
    gridX,
    gridY,
    gridWidth,
    gridHeight
  };
}

function packMatrixGroups(
  groups: StereotypeLayoutIntent["groups"],
  matrixSize: number
): StereotypeLayoutIntent["groups"] {
  const occupied = new Set<string>();
  const placed = groups.map((group, index) => ({ group: normalizeMatrixGroup(group, matrixSize), index }))
    .sort((first, second) =>
      first.group.gridY - second.group.gridY ||
      first.group.gridX - second.group.gridX ||
      first.index - second.index
    )
    .map(({ group, index }) => {
      let gridWidth = group.gridWidth;
      let gridHeight = group.gridHeight;
      let slot = findPreferredMatrixSlot(occupied, matrixSize, gridWidth, gridHeight, group.gridX, group.gridY);

      while (!slot && (gridWidth > 1 || gridHeight > 1)) {
        if (gridWidth >= gridHeight && gridWidth > 1) {
          gridWidth -= 1;
        } else if (gridHeight > 1) {
          gridHeight -= 1;
        }
        slot = findPreferredMatrixSlot(occupied, matrixSize, gridWidth, gridHeight, group.gridX, group.gridY);
      }

      const placedGroup = {
        ...group,
        gridX: slot?.x ?? 0,
        gridY: slot?.y ?? 0,
        gridWidth,
        gridHeight
      };
      occupyMatrixCells(occupied, placedGroup.gridX, placedGroup.gridY, placedGroup.gridWidth, placedGroup.gridHeight);
      return { group: placedGroup, index };
    });

  return placed.sort((first, second) => first.index - second.index).map(({ group }) => group);
}

function findPreferredMatrixSlot(
  occupied: Set<string>,
  matrixSize: number,
  gridWidth: number,
  gridHeight: number,
  preferredX: number,
  preferredY: number
): { x: number; y: number } | undefined {
  const x = clampInteger(preferredX, 0, matrixSize - gridWidth);
  const y = clampInteger(preferredY, 0, matrixSize - gridHeight);
  if (areMatrixCellsFree(occupied, x, y, gridWidth, gridHeight)) {
    return { x, y };
  }

  return findNearestMatrixSlot(occupied, matrixSize, gridWidth, gridHeight, x, y) ??
    findMatrixSlot(occupied, matrixSize, gridWidth, gridHeight);
}

function findNearestMatrixSlot(
  occupied: Set<string>,
  matrixSize: number,
  gridWidth: number,
  gridHeight: number,
  preferredX: number,
  preferredY: number
): { x: number; y: number } | undefined {
  let best: { x: number; y: number; distance: number } | undefined;

  for (let y = 0; y < matrixSize; y += 1) {
    for (let x = 0; x < matrixSize; x += 1) {
      if (x + gridWidth > matrixSize || y + gridHeight > matrixSize || !areMatrixCellsFree(occupied, x, y, gridWidth, gridHeight)) {
        continue;
      }

      const distance = Math.abs(x - preferredX) + Math.abs(y - preferredY);
      if (!best || distance < best.distance || (distance === best.distance && (y < best.y || (y === best.y && x < best.x)))) {
        best = { x, y, distance };
      }
    }
  }

  return best ? { x: best.x, y: best.y } : undefined;
}

function findMatrixSlot(
  occupied: Set<string>,
  matrixSize: number,
  gridWidth: number,
  gridHeight: number
): { x: number; y: number } | undefined {
  for (let y = 0; y < matrixSize; y += 1) {
    for (let x = 0; x < matrixSize; x += 1) {
      if (x + gridWidth <= matrixSize && y + gridHeight <= matrixSize && areMatrixCellsFree(occupied, x, y, gridWidth, gridHeight)) {
        return { x, y };
      }
    }
  }

  return undefined;
}

function areMatrixCellsFree(occupied: Set<string>, gridX: number, gridY: number, gridWidth: number, gridHeight: number): boolean {
  for (let x = gridX; x < gridX + gridWidth; x += 1) {
    for (let y = gridY; y < gridY + gridHeight; y += 1) {
      if (occupied.has(`${x}:${y}`)) {
        return false;
      }
    }
  }

  return true;
}

function isMatrixPlacementFree(
  groups: StereotypeLayoutIntent["groups"],
  movingGroupId: string,
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
): boolean {
  return groups.every((group) =>
    group.id === movingGroupId ||
    !matrixRectanglesOverlap(
      { gridX, gridY, gridWidth, gridHeight },
      { gridX: group.gridX, gridY: group.gridY, gridWidth: group.gridWidth, gridHeight: group.gridHeight }
    )
  );
}

function matrixRectanglesOverlap(
  first: Pick<StereotypeLayoutIntent["groups"][number], "gridX" | "gridY" | "gridWidth" | "gridHeight">,
  second: Pick<StereotypeLayoutIntent["groups"][number], "gridX" | "gridY" | "gridWidth" | "gridHeight">
): boolean {
  return (
    first.gridX < second.gridX + second.gridWidth &&
    first.gridX + first.gridWidth > second.gridX &&
    first.gridY < second.gridY + second.gridHeight &&
    first.gridY + first.gridHeight > second.gridY
  );
}

function occupyMatrixCells(occupied: Set<string>, gridX: number, gridY: number, gridWidth: number, gridHeight: number): void {
  for (let x = gridX; x < gridX + gridWidth; x += 1) {
    for (let y = gridY; y < gridY + gridHeight; y += 1) {
      occupied.add(`${x}:${y}`);
    }
  }
}

function XmlPanel(props: { xml: string }): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState("");

  const copyXml = async (): Promise<void> => {
    if (!navigator.clipboard) {
      setCopyStatus("Clipboard unavailable");
      return;
    }

    await navigator.clipboard.writeText(props.xml);
    setCopyStatus("Copied");
  };

  return (
    <section className="inspector-section">
      <div className="section-title-row">
        <h3>mxGraph XML</h3>
        <button type="button" className="icon-button" onClick={() => void copyXml()} title="Copy XML">
          <Copy aria-hidden="true" size={16} />
        </button>
      </div>
      {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
      <textarea className="xml-output" value={props.xml} readOnly aria-label="Generated mxGraph XML" />
    </section>
  );
}

function Diagnostics(props: { diagnostics: MxLayoutViewModel["diagnostics"] }): React.JSX.Element {
  if (props.diagnostics.length === 0) {
    return (
      <div className="diagnostics ok">
        <Check aria-hidden="true" size={16} />
        <span>No layout warnings.</span>
      </div>
    );
  }

  return (
    <div className="diagnostics">
      {props.diagnostics.map((diagnostic, index) => (
        <div key={`${diagnostic.message}-${index}`} className={`diagnostic ${diagnostic.severity}`}>
          <AlertTriangle aria-hidden="true" size={15} />
          <span title={diagnostic.message}>{diagnostic.message}</span>
        </div>
      ))}
    </div>
  );
}

function PanelHeading(props: { icon: ReactNode; title: string }): React.JSX.Element {
  return (
    <div className="panel-heading">
      <div className="panel-title">
        {props.icon}
        <h2>{props.title}</h2>
      </div>
    </div>
  );
}

function StatusPill(props: { kind: "ok" | "error"; text: string }): React.JSX.Element {
  return (
    <span className={`status-pill ${props.kind}`}>
      {props.kind === "ok" ? <Check aria-hidden="true" size={14} /> : <AlertTriangle aria-hidden="true" size={14} />}
      {props.text}
    </span>
  );
}

function ErrorBlock(props: { message: string | undefined }): React.JSX.Element {
  return (
    <div className="error-block" role="alert">
      <AlertTriangle aria-hidden="true" size={18} />
      <span>{props.message ?? "No diagram is available."}</span>
    </div>
  );
}

function LayoutLoadingPanel(props: { job: LayoutJobState; fallbackScore?: DiagramLayoutScore; tick: number }): React.JSX.Element {
  return (
    <div className="layout-loading-panel">
      <LayoutLoadingCard {...props} />
    </div>
  );
}

function LayoutLoadingOverlay(props: { job: LayoutJobState; fallbackScore?: DiagramLayoutScore; tick: number }): React.JSX.Element {
  return (
    <div className="layout-loading-overlay" aria-live="polite">
      <LayoutLoadingCard {...props} />
    </div>
  );
}

function LayoutLoadingCard(props: { job: LayoutJobState; fallbackScore?: DiagramLayoutScore; tick: number }): React.JSX.Element {
  const score = props.job.score ?? props.job.previousScore ?? props.fallbackScore;
  const candidate = props.job.candidate ?? props.job.previousCandidate ?? "candidate search";
  const elapsedSeconds = Math.max(0, (props.tick || Date.now()) - props.job.startedAt) / 1000;

  return (
    <div className="layout-loading-card">
      <div className="layout-loading-title">
        <span className="layout-spinner" aria-hidden="true" />
        <strong>{props.job.title}</strong>
      </div>
      <div className="layout-loading-phase">{props.job.phase}</div>
      <div className="layout-loading-strip" aria-hidden="true">
        <span>original</span>
        <span>degree</span>
        <span>fanout split</span>
        <span>bucket variants</span>
      </div>
      <div className="layout-loading-metrics">
        <span>Candidate: {shortCandidateLabel(candidate)}</span>
        <span>Crossings: {formatScoreValue(score?.edgeCrossings)}</span>
        <span>Bends: {formatScoreValue(score?.edgeBends)}</span>
        <span>{elapsedSeconds.toFixed(1)}s</span>
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function resizeMatrixIntent(
  intent: StereotypeLayoutIntent,
  layoutView: MxLayoutViewModel,
  nextMatrixSize: number
): void {
  const previousMatrixSize = getIntentMatrixSize(intent);
  const scale = nextMatrixSize / previousMatrixSize;

  setIntentMatrixSize(intent, nextMatrixSize);
  intent.groups = packMatrixGroups(
    intent.groups.map((group) => {
      const footprint = estimateGroupFootprint(group, layoutView, nextMatrixSize);
      const gridWidth = clampInteger(footprint.gridWidth, 1, nextMatrixSize);
      const gridHeight = clampInteger(footprint.gridHeight, 1, nextMatrixSize);

      return {
        ...group,
        gridX: clampInteger(Math.round(group.gridX * scale), 0, nextMatrixSize - gridWidth),
        gridY: clampInteger(Math.round(group.gridY * scale), 0, nextMatrixSize - gridHeight),
        gridWidth,
        gridHeight
      };
    }),
    nextMatrixSize
  );
}

function formatScoreValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return Math.round(value).toLocaleString("en-US");
}

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="number-field">
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={formatInputNumber(props.value)}
        onChange={(event) => props.onChange(toNumber(event.target.valueAsNumber, props.value))}
      />
    </label>
  );
}

function ReadOnlyField(props: { label: string; value: number }): React.JSX.Element {
  return (
    <label className="number-field">
      <span>{props.label}</span>
      <input type="number" value={formatInputNumber(props.value)} readOnly />
    </label>
  );
}

function anchorPoint(classCell: MxLayoutClass, anchor: MxAnchor | undefined): MxPoint {
  if (!anchor) {
    return {
      x: classCell.x + classCell.width / 2,
      y: classCell.y + classCell.height / 2
    };
  }

  if (anchor.side === "top") {
    return { x: classCell.x + classCell.width * anchor.ratio, y: classCell.y };
  }

  if (anchor.side === "right") {
    return { x: classCell.x + classCell.width, y: classCell.y + classCell.height * anchor.ratio };
  }

  if (anchor.side === "bottom") {
    return { x: classCell.x + classCell.width * anchor.ratio, y: classCell.y + classCell.height };
  }

  return { x: classCell.x, y: classCell.y + classCell.height * anchor.ratio };
}

function renderSvgMarkup(layoutView: MxLayoutViewModel, showGroupFrames: boolean): string {
  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layoutView.bounds.width} ${layoutView.bounds.height}">`,
    '<style>text{font-family:Arial,sans-serif;font-size:12px}.c{fill:#fff;stroke:#333}.g{fill:none;stroke:#999;stroke-dasharray:8 6}.e{fill:none;stroke:#555}</style>',
    ...(showGroupFrames ? layoutView.groups.map((group) => `<rect class="g" x="${group.x - 18}" y="${group.y - 26}" width="${group.width + 36}" height="${group.height + 44}" />`) : []),
    ...layoutView.edges.map((edge) => renderSvgEdge(edge, layoutView.classes)),
    ...layoutView.classes.map(renderSvgClass),
    "</svg>"
  ];

  return body.join("\n");
}

function renderSvgClass(classCell: MxLayoutClass): string {
  const rows = splitClassRows(classCell);
  const nameY = classCell.stereotype ? classCell.y + 36 : classCell.y + 24;
  const stereotype = classCell.stereotype
    ? `<text x="${classCell.x + classCell.width / 2}" y="${classCell.y + 18}" text-anchor="middle">${escapeHtml(`<<${classCell.stereotype}>>`)}</text>`
    : "";
  const separatorY = rows.separator
    ? classCell.y + childGeometryNumber(rows.separator, "y", rows.headerHeight) + childGeometryNumber(rows.separator, "height", 8) / 2
    : undefined;

  return [
    "<g>",
    `<rect class="c" x="${classCell.x}" y="${classCell.y}" width="${classCell.width}" height="${classCell.height}" />`,
    `<line class="e" x1="${classCell.x}" y1="${classCell.y + rows.headerHeight}" x2="${classCell.x + classCell.width}" y2="${classCell.y + rows.headerHeight}" />`,
    stereotype,
    `<text x="${classCell.x + classCell.width / 2}" y="${nameY}" text-anchor="middle">${escapeHtml(classCell.label)}</text>`,
    ...rows.attributes.map((child) => renderSvgClassMember(classCell, child)),
    separatorY === undefined ? "" : `<line class="e" x1="${classCell.x}" y1="${separatorY}" x2="${classCell.x + classCell.width}" y2="${separatorY}" />`,
    ...rows.methods.map((child) => renderSvgClassMember(classCell, child)),
    "</g>"
  ].filter(Boolean).join("\n");
}

function renderSvgClassMember(classCell: MxLayoutClass, child: MxGraphCell): string {
  const y = childGeometryNumber(child, "y", classCell.headerHeight);
  const height = childGeometryNumber(child, "height", 30);
  const baseline = y + Math.min(20, Math.max(14, height * 0.68));

  return `<text x="${classCell.x + 8}" y="${classCell.y + baseline}">${escapeHtml(child.attributes.value ?? "")}</text>`;
}

function renderSvgEdge(edge: MxLayoutEdge, classes: MxLayoutClass[]): string {
  const source = classes.find((classCell) => classCell.id === edge.sourceId);
  const target = classes.find((classCell) => classCell.id === edge.targetId);
  if (!source || !target) {
    return "";
  }

  const points = [anchorPoint(source, edge.sourceAnchor), ...edge.waypoints, anchorPoint(target, edge.targetAnchor)];
  return `<polyline class="e" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" />`;
}

function toLayoutJson(xml: string, layoutView: MxLayoutViewModel): unknown {
  return {
    version: 1,
    source: "mxGraphModel",
    mxGraphXml: xml,
    classes: layoutView.classes.map((classCell) => ({
      id: classCell.id,
      name: classCell.label,
      stereotype: classCell.stereotype,
      x: classCell.x,
      y: classCell.y,
      width: classCell.width,
      height: classCell.height
    })),
    edges: layoutView.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      kind: edge.kind,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
      points: edge.waypoints
    })),
    groups: layoutView.groups.map((group) => ({
      id: group.id,
      name: group.label,
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height,
      classIds: group.classIds
    }))
  };
}

function readXmlFromLayoutJson(source: string): string {
  const parsed = JSON.parse(source) as { mxGraphXml?: unknown; xml?: unknown };
  const xml = typeof parsed.mxGraphXml === "string" ? parsed.mxGraphXml : typeof parsed.xml === "string" ? parsed.xml : undefined;
  if (!xml) {
    throw new Error("Layout JSON must contain an mxGraphXml field for this MVP.");
  }
  return xml;
}

function downloadText(filename: string, content: string, type: string): void {
  if (!content) {
    return;
  }

  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function matchesQuery(value: string, query: string): boolean {
  return query.length === 0 || value.toLowerCase().includes(query);
}

function toNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function mermaidLayoutKey(source: string, intent: StereotypeLayoutIntent | undefined, groupFrames: boolean): string {
  return JSON.stringify({
    source,
    intent: intent ?? null,
    groupFrames
  });
}

function layoutSummaryFromState(state: ActiveState | undefined): { candidate?: string; score?: DiagramLayoutScore } | undefined {
  const result = state?.result;
  if (!result) {
    return undefined;
  }

  if ("diagram" in result) {
    return {
      candidate: result.diagram.layout?.selectedCandidateId,
      score: result.diagram.layout?.score
    };
  }

  return {
    score: result.score
  };
}

function layoutCompleteStatus(score: DiagramLayoutScore | undefined, candidate: string | undefined): string {
  const parts = [
    "Layout complete",
    `crossings ${formatScoreValue(score?.edgeCrossings)}`,
    `bends ${formatScoreValue(score?.edgeBends)}`
  ];

  if (candidate) {
    parts.push(shortCandidateLabel(candidate));
  }

  return parts.join(" | ");
}

function shortCandidateLabel(candidate: string): string {
  if (candidate.length <= 42) {
    return candidate;
  }

  return `${candidate.slice(0, 20)}...${candidate.slice(-18)}`;
}

function appendHistory(history: EditorSnapshot[], snapshot: EditorSnapshot): EditorSnapshot[] {
  const maxHistory = 80;
  return [...history, cloneEditorSnapshot(snapshot)].slice(-maxHistory);
}

function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    mxGraphState: snapshot.mxGraphState ? cloneMxGraphForHistory(snapshot.mxGraphState) : undefined,
    intentOverride: snapshot.intentOverride ? cloneLayoutIntent(snapshot.intentOverride) : undefined
  };
}

function cloneMxGraphForHistory(model: MxGraphModel): MxGraphModel {
  return {
    attributes: { ...model.attributes },
    cells: model.cells.map((cell) => ({
      id: cell.id,
      attributes: { ...cell.attributes },
      geometry: cell.geometry
        ? {
          attributes: { ...cell.geometry.attributes },
          waypoints: cell.geometry.waypoints.map((point) => ({ ...point }))
        }
        : undefined
    }))
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

function formatInputNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
