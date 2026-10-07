import { NextResponse } from "next/server";
import { issueMcpCredential } from "@/lib/mcp/mcp-auth";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";

interface CreateMcpCredentialRequestBody {
  name?: string;
}

export async function POST(request: Request) {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const body = (await request.json()) as CreateMcpCredentialRequestBody;
    const credential = await issueMcpCredential({
      userId: actor.userId,
      name: body.name?.trim() || "Codex",
    });

    return NextResponse.json(
      {
        ok: true,
        credential: {
          credentialId: credential.credentialId,
          userId: credential.userId,
          name: credential.name,
        },
        token: credential.token,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP credential creation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Workbench API authentication required" ? 401 : 400 });
  }
}
