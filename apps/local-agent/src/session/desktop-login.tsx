import { useState, type FormEvent } from "react";
import { ArrowRight, Server } from "lucide-react";

import { DEFAULT_AGENT_API_BASE_URL } from "../lib/binding";
import { useDesktopSession } from "./session-provider";

export function DesktopLogin() {
  const session = useDesktopSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_AGENT_API_BASE_URL);
  const [showDeployment, setShowDeployment] = useState(false);
  const isSubmitting = session.status === "authenticating";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void session.login({ email, password, apiBaseUrl });
  }

  return (
    <main className="desktop-auth-layout">
      <aside className="desktop-auth-brand">
        <div className="desktop-auth-brand-lockup">
          <img
            className="desktop-auth-brand-logo"
            src="./brand/humanthread-logo.svg"
            alt="HumanThread"
          />
        </div>
        <div className="desktop-auth-product">
          <span>HumanThread Desktop</span>
          <strong>本机执行操作台</strong>
        </div>
        <span className="desktop-auth-runtime">
          <span aria-hidden="true" /> 本地执行环境待连接
        </span>
      </aside>

      <section className="desktop-auth-form-region" aria-labelledby="desktop-login-title">
        <form className="desktop-auth-form" onSubmit={handleSubmit}>
          <header>
            <h1 id="desktop-login-title">登录官网账号</h1>
            <p>登录后进入开箱向导或上次使用的工作台。</p>
          </header>

          <label className="desktop-field">
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
          <label className="desktop-field">
            <span>登录密码</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {showDeployment ? (
            <label className="desktop-field">
              <span>部署地址</span>
              <input
                inputMode="url"
                onChange={(event) => setApiBaseUrl(event.target.value)}
                spellCheck={false}
                required
                type="url"
                value={apiBaseUrl}
              />
            </label>
          ) : null}

          {session.error ? (
            <p className="desktop-auth-error" role="alert">{session.error}</p>
          ) : null}

          <button className="desktop-primary-button" disabled={isSubmitting} type="submit">
            <span>{isSubmitting ? "正在验证账号" : "登录并进入工作台"}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <button
            className="desktop-secondary-action"
            onClick={() => setShowDeployment((current) => !current)}
            type="button"
          >
            <Server aria-hidden="true" size={15} />
            {showDeployment ? "使用默认部署" : "使用私有部署"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function DesktopSessionLoading(props: { label: string }) {
  return (
    <main className="desktop-session-loading" aria-live="polite">
      <img src="./brand/humanthread-mark.svg" alt="" />
      <strong>{props.label}</strong>
      <span className="desktop-session-loading-line" aria-hidden="true" />
    </main>
  );
}
