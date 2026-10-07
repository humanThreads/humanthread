function normalizeActor(event) {
  if (event.actorType === "system") {
    return { actorType: "system", actorId: event.actorUserId ?? "workflow-core" };
  }

  if (event.actorType === "human" && event.actorUserId) {
    return { actorType: "user", actorId: event.actorUserId };
  }

  return null;
}

export function planOrchestrationEventBackfill(input) {
  const existingEventIds = new Set(input.existingEvents.map((event) => event.id));
  const skippedEventIds = [];
  const errors = [];
  const events = [];
  const taskSequences = new Map();
  for (const event of input.existingEvents) {
    if (event.aggregateType !== "task") continue;
    taskSequences.set(
      event.aggregateId,
      Math.max(taskSequences.get(event.aggregateId) ?? 0, event.sequence),
    );
  }
  const sortedTaskEvents = [...input.taskEvents].sort((left, right) => {
    const taskOrder = left.taskId.localeCompare(right.taskId);
    if (taskOrder !== 0) return taskOrder;
    const timeOrder = left.createdAt.getTime() - right.createdAt.getTime();
    return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id);
  });

  for (const event of sortedTaskEvents) {
    const eventId = `legacy:${event.id}`;
    if (existingEventIds.has(eventId)) {
      skippedEventIds.push(eventId);
      continue;
    }

    const actor = normalizeActor(event);
    if (!actor) {
      errors.push({
        taskEventId: event.id,
        message: `Unsupported legacy actor: ${event.actorType}`,
      });
      continue;
    }

    const sequence = (taskSequences.get(event.taskId) ?? 0) + 1;
    taskSequences.set(event.taskId, sequence);
    events.push({
      id: eventId,
      eventType: event.type.replaceAll("_", "."),
      aggregateType: "task",
      aggregateId: event.taskId,
      aggregateVersion: sequence,
      sequence,
      correlationId: `workflow:${event.workflowInstanceId}`,
      causationId: event.id,
      commandId: null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      occurredAt: event.createdAt,
      payload: {
        legacyTaskEventId: event.id,
        ...(event.message ? { message: event.message } : {}),
        ...(event.payload === null ? {} : { legacyPayload: event.payload }),
      },
    });
  }

  return { events, skippedEventIds, errors };
}

export function summarizeOrchestrationEventBackfill(plan) {
  return {
    events: plan.events.length,
    skipped: plan.skippedEventIds.length,
    errors: plan.errors.length,
  };
}

const reconcileAggregateSequencesSql = `
  INSERT INTO \`OrchestrationAggregateSequence\`
    (\`aggregateType\`, \`aggregateId\`, \`sequence\`, \`updatedAt\`)
  SELECT e.aggregateType, e.aggregateId, e.maxSequence, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT aggregateType, aggregateId, MAX(\`sequence\`) AS maxSequence
    FROM \`OrchestrationEvent\`
    GROUP BY aggregateType, aggregateId
  ) e
  LEFT JOIN \`OrchestrationAggregateSequence\` s
    ON s.aggregateType = e.aggregateType AND s.aggregateId = e.aggregateId
  WHERE s.aggregateId IS NULL OR s.\`sequence\` < e.maxSequence
  ON DUPLICATE KEY UPDATE
    \`updatedAt\` = VALUES(\`updatedAt\`),
    \`OrchestrationAggregateSequence\`.\`sequence\` = GREATEST(
      \`OrchestrationAggregateSequence\`.\`sequence\`,
      VALUES(\`sequence\`)
    )
`;

const countAggregateSequenceGapsSql = `
  SELECT COUNT(*) AS count
  FROM (
    SELECT aggregateType, aggregateId, MAX(\`sequence\`) AS maxSequence
    FROM \`OrchestrationEvent\`
    GROUP BY aggregateType, aggregateId
  ) e
  LEFT JOIN \`OrchestrationAggregateSequence\` s
    ON s.aggregateType = e.aggregateType AND s.aggregateId = e.aggregateId
  WHERE e.maxSequence > COALESCE(s.\`sequence\`, 0)
`;

export async function reconcileOrchestrationAggregateSequences(db) {
  const repaired = await db.$executeRawUnsafe(reconcileAggregateSequencesSql);
  const rows = await db.$queryRawUnsafe(countAggregateSequenceGapsSql);
  const remaining = Number(rows[0]?.count ?? 0);
  if (remaining > 0) {
    throw new Error(
      `Orchestration aggregate sequence reconciliation left ${remaining} gap(s)`,
    );
  }
  return { repaired, remaining };
}
