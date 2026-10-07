export type DisconnectablePrismaClient = {
  $disconnect(): Promise<void>;
};

export type PrismaRuntime<T extends DisconnectablePrismaClient> = {
  getClient(): T;
  recoverClient(failedClient?: T): Promise<T>;
};

export function createPrismaRuntime<T extends DisconnectablePrismaClient>(options: {
  createClient: () => T;
  onDisconnectError?: (error: unknown) => void;
}): PrismaRuntime<T> {
  let currentClient: T | undefined;
  let recoveryPromise: Promise<T> | undefined;

  const getClient = (): T => {
    currentClient ??= options.createClient();
    return currentClient;
  };

  const recoverClient = (failedClient?: T): Promise<T> => {
    if (failedClient && currentClient && failedClient !== currentClient) {
      return Promise.resolve(currentClient);
    }

    if (recoveryPromise) {
      return recoveryPromise;
    }

    const attempt = Promise.resolve()
      .then(() => {
        const previousClient = currentClient;
        const replacementClient = options.createClient();
        currentClient = replacementClient;

        if (previousClient && previousClient !== replacementClient) {
          void previousClient.$disconnect().catch((error: unknown) => {
            if (options.onDisconnectError) {
              options.onDisconnectError(error);
              return;
            }

            console.warn("Failed to disconnect replaced Prisma client.");
          });
        }

        return replacementClient;
      })
      .finally(() => {
        if (recoveryPromise === attempt) {
          recoveryPromise = undefined;
        }
      });

    recoveryPromise = attempt;
    return attempt;
  };

  return { getClient, recoverClient };
}
