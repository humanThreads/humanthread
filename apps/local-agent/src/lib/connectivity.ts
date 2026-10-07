export type ConnectivityStatus = "online" | "offline" | "reconnecting";

export interface ConnectivityState {
  status: ConnectivityStatus;
  mutationsEnabled: boolean;
  lastOnlineAt: string | null;
  error: string | null;
}

export interface ReconnectDependencies {
  validateSession(): Promise<void>;
  validateDevice(): Promise<void>;
  validateSpace(): Promise<void>;
  revalidateQueries(): Promise<void>;
}

export interface ConnectivityController {
  getState(): ConnectivityState;
  markOffline(error?: string): void;
  reconnect(dependencies: ReconnectDependencies): Promise<void>;
}

export function createConnectivityController(input: {
  now?: () => Date;
} = {}): ConnectivityController {
  const now = input.now ?? (() => new Date());
  let state: ConnectivityState = {
    status: "online",
    mutationsEnabled: true,
    lastOnlineAt: now().toISOString(),
    error: null,
  };
  let reconnecting: Promise<void> | null = null;

  return {
    getState() {
      return { ...state };
    },
    markOffline(error) {
      state = {
        ...state,
        status: "offline",
        mutationsEnabled: false,
        error: error?.trim() || null,
      };
    },
    reconnect(dependencies) {
      if (reconnecting) return reconnecting;
      state = {
        ...state,
        status: "reconnecting",
        mutationsEnabled: false,
        error: null,
      };
      reconnecting = (async () => {
        try {
          await dependencies.validateSession();
          await dependencies.validateDevice();
          await dependencies.validateSpace();
          await dependencies.revalidateQueries();
          state = {
            status: "online",
            mutationsEnabled: true,
            lastOnlineAt: now().toISOString(),
            error: null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Reconnect validation failed";
          state = {
            ...state,
            status: "offline",
            mutationsEnabled: false,
            error: message,
          };
          throw error;
        } finally {
          reconnecting = null;
        }
      })();
      return reconnecting;
    },
  };
}
