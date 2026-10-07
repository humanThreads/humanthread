import {
  getPrismaClient,
  isRecoverableDatabaseConnectionError,
  recoverPrismaClient,
} from "@humanthread/db";
import { createAgentJsonResponse } from "../../../../lib/agent/agent-cors";

const HEALTH_DB_CORS_METHODS = ["GET"] as const;

async function probeDatabase(
  client: ReturnType<typeof getPrismaClient>,
): Promise<boolean> {
  await client.$queryRaw`SELECT 1`;
  const rows = await client.$queryRaw<Array<{ compatible: number | bigint }>>`
    SELECT CASE WHEN COUNT(*) = 4 THEN 1 ELSE 0 END AS compatible
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('Space', 'Task', 'WebSession', 'LoopNodeAttempt')
  `;
  const compatible = rows[0]?.compatible;
  return compatible === 1 || compatible === 1n;
}

export async function GET(request: Request) {
  const currentClient = getPrismaClient();

  try {
    if (!await probeDatabase(currentClient)) {
      return createAgentJsonResponse(request, HEALTH_DB_CORS_METHODS, {
        ok: false,
        service: "humanthread-web",
        db: "connected",
        schema: "incompatible",
        errorCode: "database_schema_incompatible",
      }, { status: 503 });
    }
  } catch (error) {
    if (!isRecoverableDatabaseConnectionError(error)) {
      throw error;
    }

    if (!await probeDatabase(await recoverPrismaClient(currentClient))) {
      return createAgentJsonResponse(request, HEALTH_DB_CORS_METHODS, {
        ok: false,
        service: "humanthread-web",
        db: "connected",
        schema: "incompatible",
        errorCode: "database_schema_incompatible",
      }, { status: 503 });
    }
  }

  return createAgentJsonResponse(request, HEALTH_DB_CORS_METHODS, {
    ok: true,
    service: "humanthread-web",
    db: "connected",
    schema: "compatible",
  });
}
