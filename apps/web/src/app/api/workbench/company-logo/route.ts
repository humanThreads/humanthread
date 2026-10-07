import { NextResponse } from "next/server";
import { buildWorkbenchLoginHref } from "../../../../lib/workbench/workbench-auth-guard";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { saveWorkbenchCompanyLogoUpload } from "../../../../lib/workbench/workbench-company-logo";

export const runtime = "nodejs";

function resolveRequestOrigin(request: Request): URL {
  const requestUrl = new URL(request.url);
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.trim() ??
    request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();

  if (!forwardedHost) {
    return requestUrl;
  }

  const origin = new URL(requestUrl.toString());
  origin.host = forwardedHost;
  if (!forwardedHost.includes(":")) {
    origin.port = "";
  }

  if (forwardedProto === "http" || forwardedProto === "https") {
    origin.protocol = `${forwardedProto}:`;
  }

  return origin;
}

function buildCompanyRedirect(request: Request, companyId: string, searchParams: Record<string, string>) {
  const url = new URL(`/companies/${companyId}`, resolveRequestOrigin(request));

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, 303);
}

function getCookieValueFromHeader(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;

  for (const segment of cookieHeader.split(";")) {
    const trimmedSegment = segment.trim();

    if (trimmedSegment.startsWith(prefix)) {
      return decodeURIComponent(trimmedSegment.slice(prefix.length));
    }
  }

  return undefined;
}

export async function POST(request: Request) {
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) =>
      getCookieValueFromHeader(request.headers.get("cookie"), name),
  });

  if (!session.loginEmail) {
    return NextResponse.redirect(
      new URL(buildWorkbenchLoginHref("/settings/companies"), resolveRequestOrigin(request)),
      303,
    );
  }

  const formData = await request.formData();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const logo = formData.get("logo");

  if (!companyId) {
    return buildCompanyRedirect(request, companyId, { logoError: "missing-company" });
  }

  if (!(logo instanceof File)) {
    return buildCompanyRedirect(request, companyId, { logoError: "missing-file" });
  }

  try {
    await saveWorkbenchCompanyLogoUpload({
      userId: session.context.userId,
      companyId,
      file: logo,
    });

    return buildCompanyRedirect(request, companyId, { logo: "updated" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const logoError =
      message === "Unsupported logo file type"
        ? "unsupported-file-type"
        : message === "Logo file is too large"
        ? "file-too-large"
        : "upload-failed";

    return buildCompanyRedirect(request, companyId, { logoError });
  }
}
