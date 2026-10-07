import { NextResponse } from "next/server";
import { rotateAgentToken } from "../../../../lib/agent/agent-token";

interface AgentTokenRequestBody {
  userId?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as AgentTokenRequestBody;
  const userId = body.userId?.trim();

  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: "User ID is required",
      },
      { status: 400 },
    );
  }

  try {
    const result = await rotateAgentToken({
      userId,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown agent token error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}
