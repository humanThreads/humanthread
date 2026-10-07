export async function recoverExpiredRuns(input: {
  now: Date;
  loadExpired(now: Date): Promise<Array<{
    id: string;
    loopRunId: string | null;
    leaseGeneration: number;
    workerId: string | null;
  }>>;
  recoverAtomically(run: {
    id: string;
    loopRunId: string | null;
    leaseGeneration: number;
    workerId: string | null;
    now: Date;
  }): Promise<boolean>;
}) {
  const expired = await input.loadExpired(input.now);
  let recovered = 0;
  for (const run of expired) {
    if (!await input.recoverAtomically({ ...run, now: input.now })) continue;
    recovered += 1;
  }
  return { recovered };
}
