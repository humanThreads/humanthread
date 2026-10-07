import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/mcp/route";
import { createWorkbenchSpaceDocument } from "../workbench/workbench-documents";
import { createUserTask } from "../tasks/task-commands";

vi.mock("./mcp-auth", () => ({
  authenticateMcpRequest: vi.fn().mockResolvedValue({
    credentialId: "mcp_cred_1",
    userId: "user_owner",
    credentialName: "Codex",
  }),
}));

vi.mock("../workbench/workbench-spaces", () => ({
  listWorkbenchSpaces: vi.fn().mockResolvedValue([
    {
      id: "space:personal:user_owner",
      type: "personal",
      name: "Personal",
      role: "owner",
      ownerUserId: "user_owner",
      companyId: null,
    },
  ]),
}));

vi.mock("../workbench/workbench-documents", async () => {
  const actual = await vi.importActual<typeof import("../workbench/workbench-documents")>(
    "../workbench/workbench-documents",
  );

  return {
    ...actual,
    createWorkbenchSpaceDocument: vi.fn().mockResolvedValue({
      id: "doc_root",
      version: 1,
    }),
  };
});

vi.mock("../tasks/task-commands", async () => {
  const actual = await vi.importActual<typeof import("../tasks/task-commands")>("../tasks/task-commands");
  return {
    ...actual,
    createUserTask: vi.fn().mockResolvedValue({ taskId: "task_mcp", statusCategory: "todo", version: 1 }),
  };
});

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("MCP protocol integration", () => {
  it("lets a standard Streamable HTTP client initialize, discover and call tools", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost:3000/api/mcp"),
      {
        requestInit: {
          headers: { authorization: "Bearer ht_mcp_token_123" },
        },
        fetch: async (url, init) => {
          const request = new Request(url, init);
          return request.method === "POST" ? POST(request) : GET();
        },
      },
    );
    const client = new Client({ name: "humanthread-integration", version: "1.0.0" });
    clients.push(client);

    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    const result = await client.callTool({ name: "list_spaces", arguments: {} });
    const created = await client.callTool({
      name: "create_document",
      arguments: {
        spaceId: "space:personal:user_owner",
        title: "Notes",
        path: "需求文档/主题/notes.md",
        contentMarkdown: "# Notes",
      },
    });
    const task = await client.callTool({
      name: "create_task",
      arguments: {
        commandId: "cmd_task_mcp",
        spaceId: "space:personal:user_owner",
        title: "MCP Task",
        contentMarkdown: "# Acceptance",
      },
    });

    expect(client.getServerVersion()).toMatchObject({ name: "humanthread" });
    expect(tools.tools.map((tool) => tool.name)).toContain("append_document");
    expect(tools.tools.map((tool) => tool.name)).toContain("list_document_tree");
    expect(tools.tools.map((tool) => tool.name)).toContain("move_document");
    expect(tools.tools.map((tool) => tool.name)).toContain("create_task");
    expect(result.structuredContent).toEqual({
      spaces: [expect.objectContaining({ id: "space:personal:user_owner" })],
    });
    expect(created.structuredContent).toEqual({
      document: { id: "doc_root", version: 1 },
    });
    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith({
      spaceId: "space:personal:user_owner",
      userId: "user_owner",
      title: "Notes",
      path: "需求文档/主题/notes.md",
      contentMarkdown: "# Notes",
      source: "mcp",
    });
    expect(task.structuredContent).toEqual({
      result: { taskId: "task_mcp", statusCategory: "todo", version: 1 },
    });
    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_owner" },
    }));
  });
});
