import { createServer } from "node:net";

export interface FindAvailablePortInput {
  preferredPort: number;
  maxAttempts?: number;
}

interface FindAvailablePortDependencies {
  isPortAvailable?: (port: number) => Promise<boolean>;
}

export async function checkPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(true);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

export async function findAvailablePort(
  input: FindAvailablePortInput,
  dependencies: FindAvailablePortDependencies = {},
): Promise<number> {
  const maxAttempts = input.maxAttempts ?? 10;
  const isPortAvailable = dependencies.isPortAvailable ?? checkPortAvailable;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = input.preferredPort + offset;

    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Failed to find an available port starting at ${input.preferredPort}.`,
  );
}

interface ExitAwareProcess {
  once(
    event: "exit",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

interface StoppableProcess extends ExitAwareProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill?(signal?: NodeJS.Signals): boolean;
}

export function waitForChildProcessExit(
  child: ExitAwareProcess,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once("exit", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
      });
    });
  });
}

export async function stopChildProcess(
  child: StoppableProcess,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = waitForChildProcessExit(child);
  child.kill?.("SIGTERM");
  await exited;
}

export interface WaitForHttpReadyInput {
  baseUrl: string;
  serverExit?: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  timeoutMs?: number;
  pollMs?: number;
}

interface WaitForHttpReadyDependencies {
  fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForHttpReady(
  input: WaitForHttpReadyInput,
  dependencies: WaitForHttpReadyDependencies = {},
): Promise<void> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  const pollMs = input.pollMs ?? 500;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  while (Date.now() < deadline) {
    if (input.serverExit) {
      const exitResult = await Promise.race([
        input.serverExit,
        sleep(pollMs).then(() => null),
      ]);

      if (exitResult) {
        throw new Error(
          `Server exited before becoming ready: ${input.baseUrl} (code=${exitResult.exitCode ?? "null"}, signal=${exitResult.signal ?? "none"})`,
        );
      }
    }

    try {
      const response = await fetchImpl(`${input.baseUrl}/api/health/db`);

      if (response.ok) {
        return;
      }
    } catch {
      // retry until deadline
    }

    await sleep(pollMs);
  }

  throw new Error(`Server did not become ready: ${input.baseUrl}`);
}
