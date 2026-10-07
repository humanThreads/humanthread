export interface E2eVerificationInput {
  port: number;
}

export interface E2eVerificationResult {
  smoke: unknown;
  verify: unknown;
}

interface StartedServer {
  port: number;
  stop(): Promise<void>;
}

interface E2eVerificationDependencies {
  startServer(input: { preferredPort: number }): Promise<StartedServer>;
  waitUntilReady(input: { baseUrl: string }): Promise<void>;
  runSmokeVerify(input: { apiBaseUrl: string }): Promise<E2eVerificationResult>;
}

export async function runE2eVerification(
  input: E2eVerificationInput,
  dependencies: E2eVerificationDependencies,
): Promise<E2eVerificationResult> {
  const server = await dependencies.startServer({
    preferredPort: input.port,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    await dependencies.waitUntilReady({
      baseUrl,
    });

    return await dependencies.runSmokeVerify({
      apiBaseUrl: baseUrl,
    });
  } finally {
    await server.stop();
  }
}
