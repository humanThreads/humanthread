export interface WorkbenchSmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

type WorkbenchSmtpEnv = Record<string, string | undefined>;

function readEnvValue(env: WorkbenchSmtpEnv, key: string): string | null {
  const value = env[key]?.trim();

  return value ? value : null;
}

export function getWorkbenchGlobalSmtpConfig(
  env: WorkbenchSmtpEnv = process.env,
): WorkbenchSmtpConfig | null {
  const host = readEnvValue(env, "HUMANTHREAD_SMTP_HOST");
  const portText = readEnvValue(env, "HUMANTHREAD_SMTP_PORT");
  const username = readEnvValue(env, "HUMANTHREAD_SMTP_USERNAME");
  const password = readEnvValue(env, "HUMANTHREAD_SMTP_PASSWORD");
  const port = Number(portText);

  if (!host || !username || !password) {
    return null;
  }

  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  return {
    host,
    port,
    username,
    password,
  };
}
