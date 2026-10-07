export function planDocumentBackfill(input) {
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const assignments = [];
  const skippedDocumentIds = [];
  const errors = [];

  for (const document of input.documents) {
    if (!document.projectId) {
      if (document.spaceId && document.containerKey === `space:${document.spaceId}`) {
        skippedDocumentIds.push(document.id);
      } else {
        errors.push({
          documentId: document.id,
          message: "Root document ownership is incomplete",
        });
      }
      continue;
    }

    const project = projects.get(document.projectId);

    if (!project?.spaceId) {
      errors.push({
        documentId: document.id,
        message: "Document project has no space",
      });
      continue;
    }

    const expectedContainerKey = `project:${document.projectId}`;

    if (document.spaceId || document.containerKey) {
      if (
        document.spaceId === project.spaceId &&
        document.containerKey === expectedContainerKey
      ) {
        skippedDocumentIds.push(document.id);
      } else {
        errors.push({
          documentId: document.id,
          message: "Document ownership conflicts with project",
        });
      }
      continue;
    }

    assignments.push({
      documentId: document.id,
      spaceId: project.spaceId,
      containerKey: expectedContainerKey,
    });
  }

  return { assignments, skippedDocumentIds, errors };
}

export function summarizeDocumentBackfill(plan) {
  return {
    assignments: plan.assignments.length,
    skippedDocuments: plan.skippedDocumentIds.length,
    errors: plan.errors.length,
  };
}
