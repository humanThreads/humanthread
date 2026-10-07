import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createWorkbenchLoginSession } from "../../../../lib/workbench/workbench-login-session";

interface WorkbenchLoginRequestBody {
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as WorkbenchLoginRequestBody;
  const cookieStore = await cookies();

  try {
    const session = await createWorkbenchLoginSession({
      email: body.email ?? "",
      password: body.password ?? "",
      cookieStore,
      request,
    });

    return NextResponse.json({
      ok: true,
      email: session.email,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workbench login error";
    const status = message.includes("credentials") ? 401 : 400;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
