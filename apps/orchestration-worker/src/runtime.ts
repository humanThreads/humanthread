export interface WorkerFlags {
  dispatch: boolean;
  loop: boolean;
  taskReminders: boolean;
  scheduledTasks: boolean;
}

interface RuntimeDependencies {
  flags: WorkerFlags;
  publishOutbox(): Promise<unknown>;
  dispatch(): Promise<unknown>;
  scheduleScheduledTasks(): Promise<unknown>;
  scheduleLoops(): Promise<unknown>;
  recover(): Promise<unknown>;
  deliverTaskReminders(): Promise<unknown>;
}

export function createWorkerIteration(input: RuntimeDependencies) {
  return async () => {
    await input.publishOutbox();
    if (input.flags.taskReminders) await input.deliverTaskReminders();
    if (input.flags.dispatch) await input.dispatch();
    if (input.flags.scheduledTasks) await input.scheduleScheduledTasks();
    if (input.flags.loop) await input.scheduleLoops();
    await input.recover();
  };
}

function isEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export function readWorkerFlags(environment: NodeJS.ProcessEnv = process.env): WorkerFlags {
  return {
    dispatch: isEnabled(environment.HUMANTHREAD_ORCHESTRATION_DISPATCH),
    loop: isEnabled(environment.HUMANTHREAD_ORCHESTRATION_LOOP),
    taskReminders: isEnabled(environment.HUMANTHREAD_TASK_REMINDERS),
    scheduledTasks: isEnabled(environment.HUMANTHREAD_ORCHESTRATION_SCHEDULED_TASKS),
  };
}
