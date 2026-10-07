import { ArrowRight, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { usePreviewSession } from "./preview-session";

export function LoginPage(props: {
  login?: (input: { email: string; password: string }) => Promise<void>;
  onSkip?: () => void;
}) {
  const navigate = useNavigate();
  const session = usePreviewSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const busy = session.status === "authenticating" || session.status === "bootstrapping";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await (props.login ?? session.login)({ email, password });
  }

  function skip() {
    if (props.onSkip) {
      props.onSkip();
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <main className="login-layout">
      <section className="login-brand-panel" aria-label="HumanThread Desktop">
        <div className="brand-lockup">
          <img alt="" src="/brand/humanthread-mark.svg" />
          <span>HumanThread</span>
        </div>
        <div className="login-product-copy">
          <h1>桌面操作台设计预览</h1>
          <p>使用官网账号读取当前有权访问的任务、项目、文档与 Agent 状态。预览默认只读，不会领取真实任务。</p>
        </div>
        <span className="login-runtime-note">本机执行桥接未连接</span>
      </section>
      <section className="login-form-region">
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <header>
            <h2>登录官网账号</h2>
            <p>验证通过后进入开箱向导或工作台。</p>
          </header>
          <label className="field">
            <span>登录邮箱</span>
            <input
              autoComplete="email"
              autoFocus
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label className="field">
            <span>登录密码</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {session.error ? <p className="login-error" role="alert">{session.error}</p> : null}
          <details>
            <summary>部署与连接</summary>
            <div className="deployment-note">
              当前请求通过局域网预览代理连接 http://localhost:3000，令牌仅保留在当前页面内存。
            </div>
          </details>
          <button className="primary-button" disabled={busy} type="submit">
            <LockKeyhole aria-hidden="true" size={16} />
            {busy ? "正在验证账号" : "登录并进入工作台"}
            <ArrowRight aria-hidden="true" size={16} />
          </button>
          <button className="text-button" onClick={skip} type="button">
            跳过开箱向导，直接进入工作台
          </button>
        </form>
      </section>
    </main>
  );
}

export function SessionLoading(props: { label: string }) {
  return (
    <main className="session-loading" aria-live="polite">
      <img alt="" height="30" src="/brand/humanthread-mark.svg" width="30" />
      <strong>{props.label}</strong>
      <span className="skeleton-line short" />
    </main>
  );
}
