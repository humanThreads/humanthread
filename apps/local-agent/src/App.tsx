import { useCallback, useState } from "react";
import { HashRouter } from "react-router-dom";

import { AppProviders } from "./app/providers";
import { LoopWorkerLifecycle } from "./app/loop-worker-lifecycle";
import { DesktopAppRouter } from "./app/router";
import { selectDesktopStartupRoute } from "./app/route-restore";
import { DesktopNativeLifecycle } from "./desktop/native-lifecycle";
import {
  loadAgentState,
  saveAgentState,
  type LocalAgentState,
  type StorageLike,
} from "./lib/binding";
import type { Appearance } from "./theme/appearance";
import {
  DesktopSessionProvider,
  useOptionalDesktopSession,
} from "./session/session-provider";
import { createLocalRuntime } from "./lib/runtime";

function fallbackDeviceName() {
  return navigator.platform?.trim() || "humanthread-device";
}

function browserStorage(): StorageLike {
  return window.localStorage;
}

function currentDesktopHashRoute(): string | null {
  return window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : null;
}

function initializeDesktopRoute(input: {
  lastSuccessfulRoute: string;
  onboardingRequired: boolean;
}) {
  const startupRoute = selectDesktopStartupRoute({
    overrideRoute: currentDesktopHashRoute(),
    lastSuccessfulRoute: input.lastSuccessfulRoute,
    onboardingRequired: input.onboardingRequired,
  });
  const startupHash = `#${startupRoute}`;

  if (window.location.hash !== startupHash) {
    window.history.replaceState(window.history.state, "", startupHash);
  }
}

function desktopPlatform(): "macos" | "windows" | "linux" {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "macos";
}

function AuthenticatedLoopWorker(props: {
  accountSession: LocalAgentState["accountSessions"][string] | null;
  isNative: boolean;
}) {
  const session = useOptionalDesktopSession();
  if (!session) return null;
  return <LoopWorkerLifecycle
    accountSession={props.accountSession}
    isNative={props.isNative}
    session={{
      status: session.status,
      nativeExecution: Boolean(session.bootstrap?.capabilities.nativeExecution),
      runtimeCredentials: session.runtimeCredentials,
    }}
  />;
}

export default function App() {
  const [storage] = useState(browserStorage);
  const [deviceName] = useState(fallbackDeviceName);
  const [platform] = useState(desktopPlatform);
  const [runtime] = useState(createLocalRuntime);
  const [state, setState] = useState<LocalAgentState>(() => {
    const loadedState = loadAgentState({
      storage,
      fallbackDeviceName: deviceName,
    });

    initializeDesktopRoute({
      lastSuccessfulRoute: loadedState.installProfile.lastSuccessfulRoute,
      onboardingRequired: !loadedState.installProfile.onboardingSkipped
        && !loadedState.installProfile.onboardingCompletedAt,
    });
    return loadedState;
  });

  const updateInstallProfile = useCallback((input: {
    appearance?: Appearance;
    lastSuccessfulRoute?: string;
    onboardingSkipped?: boolean;
    onboardingCompletedAt?: string | null;
  }) => {
    setState((current) => saveAgentState(
      { storage, fallbackDeviceName: deviceName },
      {
        ...current,
        installProfile: {
          ...current.installProfile,
          ...input,
          lastUsedAt: new Date().toISOString(),
        },
      },
    ));
  }, [deviceName, storage]);
  const handleAppearanceChange = useCallback((appearance: Appearance) => {
    updateInstallProfile({ appearance });
  }, [updateInstallProfile]);
  const handleSuccessfulRoute = useCallback((route: string) => {
    updateInstallProfile({ lastSuccessfulRoute: route });
  }, [updateInstallProfile]);
  const activeAccountSession = state.activeSessionKey
    ? state.accountSessions[state.activeSessionKey] ?? null
    : null;

  return (
    <AppProviders
      initialAppearance={state.installProfile.appearance}
      onAppearanceChange={handleAppearanceChange}
    >
      <DesktopSessionProvider
        environment={{ storage, fallbackDeviceName: deviceName }}
        onStateChange={setState}
        platform={platform}
        state={state}
      >
        <AuthenticatedLoopWorker
          accountSession={activeAccountSession}
          isNative={runtime.isNative}
        />
        <HashRouter>
          <DesktopNativeLifecycle
            accountSession={activeAccountSession}
            runtime={runtime}
          />
          <DesktopAppRouter
            native={{ accountSession: activeAccountSession, runtime }}
            onOnboardingChange={(input) => updateInstallProfile({
              ...(input.skipped === undefined ? {} : { onboardingSkipped: input.skipped }),
              ...(input.completedAt === undefined ? {} : { onboardingCompletedAt: input.completedAt }),
            })}
            onSuccessfulRoute={handleSuccessfulRoute}
          />
        </HashRouter>
      </DesktopSessionProvider>
    </AppProviders>
  );
}
