import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createWorkbenchRegistrationVerification,
  registerWorkbenchUser,
} from "../../../../lib/workbench/workbench-registration";

interface WorkbenchRegisterRequestBody {
  intent?: string;
  accountType?: "personal" | "company";
  companyName?: string;
  name?: string;
  email?: string;
  password?: string;
  verificationCode?: string;
}

function resolveRegisterStatus(message: string): number {
  if (message.includes("already exists")) {
    return 409;
  }

  if (message.includes("too recently")) {
    return 429;
  }

  return 400;
}

export async function POST(request: Request) {
  const body = (await request.json()) as WorkbenchRegisterRequestBody;
  const cookieStore = await cookies();

  try {
    if (body.intent === "send-verification") {
      const verification = await createWorkbenchRegistrationVerification({
        email: body.email ?? "",
      });

      return NextResponse.json({
        ok: true,
        ...verification,
      });
    }

    const account = await registerWorkbenchUser({
      ...(body.accountType ? { accountType: body.accountType } : {}),
      ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
      name: body.name ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
      verificationCode: body.verificationCode ?? "",
      request,
      cookieStore,
    });

    return NextResponse.json({
      ok: true,
      ...account,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workbench register error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: resolveRegisterStatus(message),
      },
    );
  }
}
