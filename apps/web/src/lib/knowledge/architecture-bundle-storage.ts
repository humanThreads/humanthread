import { createOssClient } from "../downloads/oss-client";

export async function readArchitectureBundleObject(objectKey: string): Promise<string> {
  const client = createOssClient();
  const result = await client.get(objectKey);
  if (result.content === undefined) {
    throw Object.assign(new Error("Architecture bundle object is unavailable"), { code: "not_found" });
  }
  return Buffer.from(result.content).toString("utf8");
}
