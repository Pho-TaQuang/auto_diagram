import type { LayoutEngineId } from "../../../packages/layout/src/index.js";
import { runWebPipeline, type WebLayoutIntent, type WebPipelineResult } from "./pipeline.js";

export type LayoutWorkerRequest = {
  id: number;
  source: string;
  engineId: LayoutEngineId;
  intent?: WebLayoutIntent;
  groupFrames: boolean;
};

export type LayoutWorkerResponse = {
  id: number;
  result?: WebPipelineResult;
  error?: string;
};

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse) => void;
};

worker.onmessage = (event: MessageEvent<LayoutWorkerRequest>): void => {
  const request = event.data;

  try {
    const result = runWebPipeline({
      source: request.source,
      engineId: request.engineId,
      intent: request.intent,
      groupFrames: request.groupFrames
    });
    worker.postMessage({ id: request.id, result } satisfies LayoutWorkerResponse);
  } catch (error) {
    worker.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    } satisfies LayoutWorkerResponse);
  }
};
