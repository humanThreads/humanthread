import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { buildWorkbenchLoginHref } from "../../../../lib/workbench/workbench-auth-guard";
import { saveWorkbenchAvatarUpload } from "../../../../lib/workbench/workbench-avatar";
import { buildWorkbenchAccountSettingsCacheTag } from "../../../../lib/workbench/workbench-settings";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";

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

function buildAccountRedirect(
  request: Request,
  searchParams: Record<string, string>,
) {
  const url = new URL("/settings/account", resolveRequestOrigin(request));

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, 303);
}

function resolveAvatarUploadErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (message === "Unsupported avatar file type") {
    return "unsupported-file-type";
  }

  if (message === "Avatar file is too large") {
    return "file-too-large";
  }

  if (message === "Avatar file is required") {
    return "missing-file";
  }

  return "upload-failed";
}

export async function POST(request: Request) {
  const session = await resolveWorkbenchSession({
    getCookieValue: (name) =>
      getCookieValueFromHeader(request.headers.get("cookie"), name),
  });

  if (!session.loginEmail) {
    return NextResponse.redirect(
      new URL(
        buildWorkbenchLoginHref("/settings/account"),
        resolveRequestOrigin(request),
      ),
      303,
    );
  }

  const formData = await request.formData();
  const avatar = formData.get("avatar");

  if (!(avatar instanceof File)) {
    return buildAccountRedirect(request, {
      avatarError: "missing-file",
    });
  }

  try {
    await saveWorkbenchAvatarUpload({
      userId: session.context.userId,
      file: avatar,
    });
    revalidateTag(
      buildWorkbenchAccountSettingsCacheTag(session.context.userId),
      "max",
    );

    return buildAccountRedirect(request, {
      avatar: "updated",
    });
  } catch (error) {
    return buildAccountRedirect(request, {
      avatarError: resolveAvatarUploadErrorCode(error),
    });
  }
}
