import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const dbMocks = vi.hoisted(() => ({
  currentQuery: vi.fn(),
  replacementQuery: vi.fn(),
  getPrismaClient: vi.fn(),
  recoverPrismaClient: vi.fn(),
  isRecoverableDatabaseConnectionError: vi.fn(),
}));

vi.mock("@humanthread/db", () => ({
  prisma: {
    $queryRaw: dbMocks.currentQuery,
  },
  getPrismaClient: dbMocks.getPrismaClient,
  recoverPrismaClient: dbMocks.recoverPrismaClient,
  isRecoverableDatabaseConnectionError:
    dbMocks.isRecoverableDatabaseConnectionError,
}));

describe("GET /api/health/db", () => {
  beforeEach(() => {
    dbMocks.currentQuery.mockReset().mockResolvedValue([{ compatible: 1 }]);
    dbMocks.replacementQuery.mockReset().mockResolvedValue([{ compatible: 1 }]);
    dbMocks.getPrismaClient.mockReset().mockReturnValue({
      $queryRaw: dbMocks.currentQuery,
    });
    dbMocks.recoverPrismaClient.mockReset().mockResolvedValue({
      $queryRaw: dbMocks.replacementQuery,
    });
    dbMocks.isRecoverableDatabaseConnectionError.mockReset().mockReturnValue(false);
  });

  it("returns database health with Tauri CORS headers", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/health/db", {
        headers: {
          origin: "tauri://localhost",
        },
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      db: string;
      schema: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(body).toEqual({
      ok: true,
      service: "humanthread-web",
      db: "connected",
      schema: "compatible",
    });
    expect(dbMocks.currentQuery).toHaveBeenCalledTimes(2);
    expect(dbMocks.getPrismaClient).toHaveBeenCalledTimes(1);
    expect(dbMocks.recoverPrismaClient).not.toHaveBeenCalled();
  });

  it("replaces the client and probes once after a recoverable failure", async () => {
    const connectionError = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    dbMocks.currentQuery.mockRejectedValueOnce(connectionError);
    dbMocks.isRecoverableDatabaseConnectionError.mockReturnValueOnce(true);

    const response = await GET(new Request("http://localhost:3000/api/health/db"));

    expect(response.status).toBe(200);
    expect(dbMocks.isRecoverableDatabaseConnectionError).toHaveBeenCalledWith(
      connectionError,
    );
    expect(dbMocks.recoverPrismaClient).toHaveBeenCalledWith(
      dbMocks.getPrismaClient.mock.results[0]?.value,
    );
    expect(dbMocks.replacementQuery).toHaveBeenCalledTimes(2);
  });

  it("stops after the replacement probe fails", async () => {
    const firstError = Object.assign(new Error("pool timeout"), { errno: 45028 });
    const secondError = Object.assign(new Error("still unavailable"), {
      code: "ECONNREFUSED",
    });
    dbMocks.currentQuery.mockRejectedValueOnce(firstError);
    dbMocks.replacementQuery.mockRejectedValueOnce(secondError);
    dbMocks.isRecoverableDatabaseConnectionError.mockReturnValueOnce(true);

    await expect(
      GET(new Request("http://localhost:3000/api/health/db")),
    ).rejects.toBe(secondError);
    expect(dbMocks.currentQuery).toHaveBeenCalledTimes(1);
    expect(dbMocks.recoverPrismaClient).toHaveBeenCalledWith(
      dbMocks.getPrismaClient.mock.results[0]?.value,
    );
    expect(dbMocks.replacementQuery).toHaveBeenCalledTimes(1);
  });

  it("does not replace the client after a non-recoverable query error", async () => {
    const queryError = Object.assign(new Error("unique constraint failed"), {
      code: "P2002",
    });
    dbMocks.currentQuery.mockRejectedValueOnce(queryError);

    await expect(
      GET(new Request("http://localhost:3000/api/health/db")),
    ).rejects.toBe(queryError);
    expect(dbMocks.isRecoverableDatabaseConnectionError).toHaveBeenCalledWith(
      queryError,
    );
    expect(dbMocks.recoverPrismaClient).not.toHaveBeenCalled();
    expect(dbMocks.replacementQuery).not.toHaveBeenCalled();
  });

  it("reports an incompatible schema when connectivity succeeds but required tables are absent", async () => {
    dbMocks.currentQuery
      .mockReset()
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([{ compatible: 0 }]);

    const response = await GET(new Request("http://localhost:3000/api/health/db"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      service: "humanthread-web",
      db: "connected",
      schema: "incompatible",
      errorCode: "database_schema_incompatible",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("WebSession");
    expect(serialized).not.toContain("inner-db");
    expect(serialized).not.toContain("SELECT");
    expect(dbMocks.recoverPrismaClient).not.toHaveBeenCalled();
  });
});
