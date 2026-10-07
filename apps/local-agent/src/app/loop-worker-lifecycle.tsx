import { useEffect } from "react";

import type { LocalAgentAccountSession } from "../lib/binding";
import {
  createNativeLoopWorker,
  type NativeLoopWorkerCredentials,
} from "../lib/loop-worker-runtime";
import { createNativeExecutionConfigStore } from "../desktop/execution-config-store";
import {
  DEFAULT_LOCAL_WORKER_PREFERENCES,
  LOCAL_WORKER_PREFERENCES_CHANGED,
  type LocalWorkerPreferences,
} from "../desktop/worker-preferences";

type WorkerHandle = {
  onOnline(): Promise<void>;
  stop(): void;
  deactivate?(): Promise<unknown>;
  updateMaxConcurrency?(maxConcurrency: number): void;
};

type LoopWorkerSession = {
  status: string;
  nativeExecution: boolean;
  runtimeCredentials: { deviceToken: string; apiToken: string } | null;
};

export function shouldStartLoopWorker(input: {
  isNative: boolean;
  sessionStatus: string;
  nativeExecution: boolean;
  hasCredentials: boolean;
  hasAccountSession: boolean;
  workerEnabled: boolean;
}): boolean {
  return input.isNative
    && input.sessionStatus === "ready"
    && input.nativeExecution
    && input.hasCredentials
    && input.hasAccountSession
    && input.workerEnabled;
}

export function LoopWorkerLifecycle(props: {
  isNative: boolean;
  accountSession: Pick<LocalAgentAccountSession, "apiBaseUrl" | "userId" | "deviceId"> | null;
  session: LoopWorkerSession;
  pollIntervalMs?: number;
  createWorker?: (credentials: NativeLoopWorkerCredentials, options: { maxConcurrency: number }) => Promise<WorkerHandle>;
  loadWorkerPreferences?: (deviceId: string) => Promise<LocalWorkerPreferences>;
}) {
  useEffect(() => {
    if (!props.accountSession || !props.session.runtimeCredentials) return;
    let disposed = false;
    let worker: WorkerHandle | null = null;
    let timer: ReturnType<typeof globalThis.setInterval> | null = null;
    const createWorker = props.createWorker ?? ((credentials, options) => createNativeLoopWorker(credentials, {}, options));
    const loadPreferences = props.loadWorkerPreferences ?? (async (deviceId: string) => (
      createNativeExecutionConfigStore({ deviceId }).then((store) => store.getWorkerPreferences())
    ));
    const start = async (preferences: LocalWorkerPreferences) => {
      if (!shouldStartLoopWorker({
        isNative: props.isNative,
        sessionStatus: props.session.status,
        nativeExecution: props.session.nativeExecution,
        hasCredentials: true,
        hasAccountSession: true,
        workerEnabled: true,
      })) return;
      const created = await createWorker({
        ...props.accountSession!,
        ...props.session.runtimeCredentials!,
      }, { maxConcurrency: preferences.maxConcurrency });
      if (disposed) {
        created.stop();
        return;
      }
      worker = created;
      if (!preferences.enabled) {
        await worker.deactivate?.().catch(() => undefined);
        worker = null;
        return;
      }
      void worker.onOnline().catch(() => undefined);
      timer = globalThis.setInterval(() => {
        void worker?.onOnline().catch(() => undefined);
      }, props.pollIntervalMs ?? 5_000);
    };
    void loadPreferences(props.accountSession.deviceId)
      .catch(() => DEFAULT_LOCAL_WORKER_PREFERENCES)
      .then(start)
      .catch(() => undefined);
    const onPreferences = (event: Event) => {
      const preferences = (event as CustomEvent<LocalWorkerPreferences>).detail;
      if (worker && preferences.enabled) {
        worker.updateMaxConcurrency?.(preferences.maxConcurrency);
        void worker.onOnline().catch(() => undefined);
        return;
      }
      if (timer) globalThis.clearInterval(timer);
      timer = null;
      if (worker && !preferences.enabled) void worker.deactivate?.().catch(() => undefined);
      else worker?.stop();
      worker = null;
      void start(preferences).catch(() => undefined);
    };
    globalThis.addEventListener(LOCAL_WORKER_PREFERENCES_CHANGED, onPreferences);
    const onOnline = () => { void worker?.onOnline().catch(() => undefined); };
    globalThis.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      globalThis.removeEventListener("online", onOnline);
      globalThis.removeEventListener(LOCAL_WORKER_PREFERENCES_CHANGED, onPreferences);
      if (timer) globalThis.clearInterval(timer);
      worker?.stop();
    };
  }, [
    props.accountSession?.apiBaseUrl,
    props.accountSession?.deviceId,
    props.accountSession?.userId,
    props.createWorker,
    props.isNative,
    props.pollIntervalMs,
    props.session.nativeExecution,
    props.session.runtimeCredentials?.apiToken,
    props.session.runtimeCredentials?.deviceToken,
    props.session.status,
  ]);
  return null;
}
