import { desktopDocumentTreeResponseSchema } from "@humanthread/workbench-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDesktopDocumentTree } from "@/lib/desktop/desktop-document-models";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-document-models", () => ({ readDesktopDocumentTree: vi.fn() }));

describe("desktop Document tree route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a runtime-validated tree with desktop CORS", async () => {
    vi.mocked(readDesktopDocumentTree).mockResolvedValue({ groups: [], trash: [] });
    const request = new Request("http://localhost:3000/api/desktop/documents/tree?space=personal", {
      headers: { origin: "http://localhost:1420" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(desktopDocumentTreeResponseSchema.parse(await response.json()).data.groups).toEqual([]);
  });
});
