// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentDiagramPreview, getDocumentDiagramKind, isDocumentDiagramAttachmentHref } from "./document-diagram-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DocumentDiagramPreview", () => {
  it("recognizes protected XMind and Visio attachment links", () => {
    expect(getDocumentDiagramKind("路线图.xmind")).toBe("xmind");
    expect(getDocumentDiagramKind("审批流程.vsdx")).toBe("vsdx");
    expect(getDocumentDiagramKind("说明.md")).toBeNull();
    expect(isDocumentDiagramAttachmentHref("/api/document-attachments/attachment_1")).toBe(true);
    expect(isDocumentDiagramAttachmentHref("https://example.com/attachment_1")).toBe(false);
  });

  it("parses an XMind content.json package into a mind-map preview", async () => {
    const zip = new JSZip();
    zip.file("content.json", JSON.stringify([{ title: "产品路线", rootTopic: { title: "产品", children: { attached: [{ title: "需求" }, { title: "交付" }] } } }]));
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-type": "application/vnd.xmind.workbook" } })));

    render(<DocumentDiagramPreview kind="xmind" label="路线图.xmind" href="/api/document-attachments/attachment_xmind" />);

    expect(await screen.findByRole("img", { name: /产品.*需求.*交付/ })).toBeTruthy();
    expect(screen.getByText("产品")).toBeTruthy();
    expect(screen.getByText("需求")).toBeTruthy();
    expect(screen.getByRole("link", { name: /下载/ }).getAttribute("href")).toBe("/api/document-attachments/attachment_xmind");
  });

  it("parses a Visio package into a diagram preview", async () => {
    const zip = new JSZip();
    zip.file("visio/pages/page1.xml", '<PageContents><Shapes><Shape ID="1"><XForm PinX="1" PinY="2"/><Text>开始</Text></Shape><Shape ID="2"><XForm PinX="3" PinY="2"/><Text>结束</Text></Shape></Shapes><Connects><Connect FromSheet="1" ToSheet="2"/></Connects></PageContents>');
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-type": "application/vnd.ms-visio.drawing" } })));

    render(<DocumentDiagramPreview kind="vsdx" label="审批流程.vsdx" href="/api/document-attachments/attachment_vsdx" />);

    expect(await screen.findByRole("img", { name: /开始.*结束/ })).toBeTruthy();
    expect(screen.getByText("开始")).toBeTruthy();
    expect(screen.getByText("结束")).toBeTruthy();
  });

  it("keeps the download available when the package cannot be parsed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));

    render(<DocumentDiagramPreview kind="xmind" label="损坏.xmind" href="/api/document-attachments/attachment_bad" />);

    await waitFor(() => expect(screen.getByText(/可下载后用桌面应用查看/)).toBeTruthy());
    expect(screen.getByRole("link", { name: /下载/ })).toBeTruthy();
  });
});
