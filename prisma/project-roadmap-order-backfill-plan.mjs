export function planProjectRoadmapOrderBackfill(input) {
  const byStage = new Map();
  for (const milestone of input.milestones) {
    const rows = byStage.get(milestone.stageId) ?? [];
    rows.push(milestone);
    byStage.set(milestone.stageId, rows);
  }
  const updates = [];
  for (const rows of byStage.values()) {
    const ordered = [...rows];
    const existing = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const contiguous = existing.every((row, index) => row.sortOrder === index);
    if (contiguous) continue;
    ordered.sort((a, b) => {
      const left = a.targetAt ? new Date(a.targetAt).getTime() : Number.POSITIVE_INFINITY;
      const right = b.targetAt ? new Date(b.targetAt).getTime() : Number.POSITIVE_INFINITY;
      return left - right || a.id.localeCompare(b.id);
    });
    ordered.forEach((row, sortOrder) => {
      if (row.sortOrder !== sortOrder) updates.push({ milestoneId: row.id, sortOrder });
    });
  }
  return { updates };
}
