import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { issueAgentBindingCode } from "../../../../lib/agent/agent-binding-code-issuer";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";

interface AgentBindingCodeRequestBody {
  userId?: string;
}

export async function POST(request: Request) {
  await request.json() as AgentBindingCodeRequestBody;
  const cookieStore = await cookies();
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) => cookieStore.get(name)?.value,
  });
  if (!session.webSessionId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Workbench authentication required",
      },
      { status: 401 },
    );
  }

  try {
    const result = await issueAgentBindingCode({ userId: session.context.userId });

    return NextResponse.json({
      ok: true,
      ...result,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent binding code error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}
