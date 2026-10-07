import { useNavigate } from "react-router-dom";

import type { LocalAgentAccountSession } from "../../lib/binding";
import type { LocalRuntime } from "../../lib/runtime";
import type { DesktopSessionValue } from "../../session/session-provider";
import { OnboardingPage } from "./onboarding-page";

export function OnboardingRoute(props: {
  accountSession: LocalAgentAccountSession | null;
  runtime: LocalRuntime;
  session: DesktopSessionValue;
  onSkip(): void;
  onComplete(): void;
}) {
  const navigate = useNavigate();

  function leaveWizard(action: () => void) {
    action();
    navigate("/dashboard", { replace: true });
  }

  return (
    <OnboardingPage
      accountSession={props.accountSession}
      onComplete={() => leaveWizard(props.onComplete)}
      onSkip={() => leaveWizard(props.onSkip)}
      platform={props.runtime.platform === "windows"
        ? "windows"
        : props.runtime.platform === "linux"
          ? "linux"
          : "macos"}
      runtime={props.runtime}
      session={props.session}
      storage={window.localStorage}
    />
  );
}
