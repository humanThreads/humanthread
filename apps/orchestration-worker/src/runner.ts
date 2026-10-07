export async function runWorkerIteration(input: { publishOutbox(): Promise<unknown>; dispatch(): Promise<unknown>; recover(): Promise<unknown> }) {
  await input.publishOutbox();
  await input.dispatch();
  await input.recover();
}

export async function runWorkerLoop(input: {
  iteration(): Promise<void>;
  pollMs: number;
  signal: AbortSignal;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
  onError?(error: unknown): void;
}) {
  const wait = input.wait ?? ((ms, signal) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }));
  const onError = input.onError ?? ((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Orchestration worker iteration failed");
  });
  while (!input.signal.aborted) {
    try {
      await input.iteration();
    } catch (error) {
      onError(error);
    }
    if (!input.signal.aborted) await wait(input.pollMs, input.signal);
  }
}
