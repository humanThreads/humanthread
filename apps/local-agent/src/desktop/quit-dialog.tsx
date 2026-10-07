import { LogOut, OctagonX } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  resolveQuitChoices,
  type DesktopQuitState,
  type QuitChoice,
} from "./quit-safety";

const CHOICE_LABELS: Record<QuitChoice, string> = {
  hide_to_tray: "后台继续运行",
  quit: "退出应用",
  keep_session_and_quit: "保持会话并退出",
  interrupt_and_quit: "中断命令并退出",
  cancel: "取消",
};

export function DesktopQuitDialog(props: {
  state: DesktopQuitState;
  pending: boolean;
  error?: string | null;
  onChoice(choice: QuitChoice): void;
}) {
  const choices = resolveQuitChoices(props.state);
  const hasActiveWork = props.state.managedRunning || props.state.externalSession;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (choices[0] === "hide_to_tray" ? safeRef.current : cancelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.pending) {
        event.preventDefault();
        props.onChoice("cancel");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onChoice, props.pending]);

  return (
    <div className="desktop-overlay" role="presentation">
      <section
        aria-label="退出 HumanThread"
        aria-modal="true"
        className="desktop-quit-dialog"
        role="dialog"
      >
        <header>
          <span aria-hidden="true"><LogOut size={20} /></span>
          <div>
            <h2>退出 HumanThread</h2>
            <p>{hasActiveWork ? "本地命令仍在运行" : "确认退出桌面应用"}</p>
          </div>
        </header>
        <div className="desktop-quit-dialog-copy">
          {hasActiveWork ? (
            <p>请选择是否保留外部工具会话，或先中断由 HumanThread 管理的命令。</p>
          ) : (
            <p>退出后，托盘监控和桌面通知将停止。</p>
          )}
          {props.error ? <p className="desktop-quit-error" role="alert"><OctagonX aria-hidden="true" size={15} />{props.error}</p> : null}
        </div>
        <footer>
          {choices.map((choice) => (
            <button
              className={choice === "interrupt_and_quit" || choice === "quit" ? "is-danger" : ""}
              disabled={props.pending}
              key={choice}
              onClick={() => props.onChoice(choice)}
              ref={choice === "cancel" ? cancelRef : choice === "hide_to_tray" ? safeRef : undefined}
              type="button"
            >
              {CHOICE_LABELS[choice]}
            </button>
          ))}
        </footer>
      </section>
    </div>
  );
}
