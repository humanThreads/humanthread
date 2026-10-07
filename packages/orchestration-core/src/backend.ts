export interface OrchestrationBackend {
  claim(input: {
    queue: string;
    workerId: string;
    dedupeKey: string;
    expectedVersion?: number;
  }): Promise<{ leaseId: string; accepted: boolean }>;
  schedule(input: {
    topic: string;
    payload: unknown;
    correlationId: string;
    dedupeKey: string;
    availableAt: Date;
  }): Promise<{ messageId: string }>;
  signal(input: {
    aggregateId: string;
    command: string;
    correlationId: string;
    dedupeKey: string;
  }): Promise<{ accepted: boolean }>;
  timer(input: {
    timerId: string;
    dueAt: Date;
    dedupeKey: string;
  }): Promise<{ scheduled: boolean }>;
  retry(input: {
    operationId: string;
    reason: string;
    dedupeKey: string;
  }): Promise<{ scheduled: boolean }>;
}
