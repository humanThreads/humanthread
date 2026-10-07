import { describe, expect, it } from "vitest";
import { createWorkbenchContextIdentity } from "@humanthread/workbench-client";

import {
  buildTaskCollectionSearch,
  parseTaskCollectionQuery,
  taskCollectionQueryKey,
} from "./task-queries";

describe("desktop Task queries", () => {
  it("normalizes URL filters and preserves the public Space key", () => {
    const query = parseTaskCollectionQuery(new URLSearchParams(
      "view=board&relation=assigned&status=todo,in_progress&group=status&sort=due_asc&project=project_1&taskId=task_1&page=2&pageSize=50",
    ));

    expect(query).toEqual(expect.objectContaining({
      view: "board",
      relation: "assigned",
      status: ["todo", "in_progress"],
      group: "status",
      sort: "due_asc",
      project: ["project_1"],
      taskId: "task_1",
      page: 2,
      pageSize: 50,
    }));
    const search = buildTaskCollectionSearch(query, "company:company_1");
    expect(search.get("space")).toBe("company:company_1");
    expect(search.get("project")).toBe("project_1");
    expect(search.get("taskId")).toBe("task_1");
    expect(search.get("page")).toBe("2");
    expect(search.get("pageSize")).toBe("50");
  });

  it("uses deployment, session and Space in the collection query key", () => {
    const context = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "session_1",
      spaceKey: "personal",
    });
    const query = parseTaskCollectionQuery(new URLSearchParams("relation=assigned"));

    expect(taskCollectionQueryKey(context, query).slice(0, 4)).toEqual([
      "https://ht.example.com",
      "session_1",
      "personal",
      "tasks",
    ]);
  });
});
