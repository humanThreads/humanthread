export interface ClaimedTaskReminder {
  id: string;
  taskId: string;
  recipientUserId: string;
  remindAt: Date;
  attempts?: number;
}

export async function claimDueTaskReminders<T extends ClaimedTaskReminder>(input: {
  now: Date;
  loadCandidates(input: { now: Date; staleBefore: Date }): Promise<T[]>;
  claimOne(input: { reminder: T; now: Date; staleBefore: Date }): Promise<boolean>;
}) {
  const staleBefore = new Date(input.now.getTime() - 300_000);
  const candidates = await input.loadCandidates({ now: input.now, staleBefore });
  const claimed: T[] = [];
  for (const reminder of candidates) {
    if (await input.claimOne({ reminder, now: input.now, staleBefore })) claimed.push(reminder);
  }
  return claimed;
}

function retryAt(now: Date, attempts: number) {
  return new Date(now.getTime() + Math.min(2 ** attempts * 120_000, 300_000));
}

export async function deliverDueTaskReminders(input: {
  now: Date;
  claim(now: Date): Promise<ClaimedTaskReminder[]>;
  publish(input: { notificationId: string; reminder: ClaimedTaskReminder }): Promise<void>;
  markSent(input: { reminderId: string; sentAt: Date }): Promise<void>;
  markFailed(input: { reminderId: string; error: string; retryAt: Date }): Promise<void>;
}) {
  const reminders = await input.claim(input.now);
  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    try {
      await input.publish({ notificationId: `task-reminder:${reminder.id}`, reminder });
      await input.markSent({ reminderId: reminder.id, sentAt: input.now });
      sent += 1;
    } catch (error) {
      await input.markFailed({
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : String(error),
        retryAt: retryAt(input.now, reminder.attempts ?? 0),
      });
      failed += 1;
    }
  }
  return { claimed: reminders.length, sent, failed };
}
