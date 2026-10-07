import { GET as downloadReleaseArtifact } from "../../artifacts/[...artifact]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return downloadReleaseArtifact(request, {
    params: Promise.resolve({ artifact: ["desktop", "macos", "arm64"] }),
  });
}
