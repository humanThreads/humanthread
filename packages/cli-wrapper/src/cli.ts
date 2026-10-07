#!/usr/bin/env node
import { parseHtRunArgs, runHtRun } from "./index";

const parsed = parseHtRunArgs(process.argv.slice(2));

if (parsed.help || !parsed.context.taskId || parsed.command.length === 0) {
  console.log("Usage: ht-run --task <taskId> --project <projectId> --workflow <workflowId> -- <command> [...args]");
  process.exit(1);
}

runHtRun({
  taskId: parsed.context.taskId,
  projectId: parsed.context.projectId,
  workflowInstanceId: parsed.context.workflowInstanceId,
  cwd: process.cwd(),
  command: parsed.command,
}).then((result) => {
  process.exit(result.status === "completed" ? 0 : 1);
});
