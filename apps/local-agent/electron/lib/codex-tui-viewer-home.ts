import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function prepareCodexTuiViewerHome(rootDirectory: string): string {
  const home = join(rootDirectory, "codex-tui-viewer");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configPath = join(home, "config.toml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, "check_for_update_on_startup = false\n", { mode: 0o600 });
  }
  return home;
}
