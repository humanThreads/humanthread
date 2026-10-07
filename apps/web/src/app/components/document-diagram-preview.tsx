"use client";

import { AlertCircle, Download, FileSpreadsheet, LoaderCircle, Network } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export const DOCUMENT_DIAGRAM_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const MAX_NODES = 500;
const MAX_XML_BYTES = 4 * 1024 * 1024;

type DiagramKind = "xmind" | "vsdx";

interface DiagramNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
}

interface DiagramEdge {
  from: string;
  to: string;
}

export interface DocumentDiagramPreviewProps {
  kind: DiagramKind;
  label: string;
  href: string;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; nodes: DiagramNode[]; edges: DiagramEdge[]; title: string }
  | { status: "error"; message: string };

export function isDocumentDiagramAttachmentHref(href: string | undefined) {
  return Boolean(href && /^\/api\/document-attachments\/[A-Za-z0-9._:-]+$/u.test(href));
}

export function getDocumentDiagramKind(label: string, href?: string) {
  const normalizedLabel = label.toLowerCase();
  const normalizedHref = href?.toLowerCase() ?? "";
  if (normalizedLabel.endsWith(".xmind") || normalizedHref.includes("xmind")) return "xmind";
  if (normalizedLabel.endsWith(".vsdx") || normalizedLabel.endsWith(".vsd")) return "vsdx";
  return null;
}

export function DocumentDiagramPreview({ kind, label, href }: DocumentDiagramPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDocumentDiagramAttachmentHref(href)) return;
    const controller = new AbortController();
    let cancelled = false;
    async function loadPreview() {
      try {
        const response = await fetch(href, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? "没有权限查看此附件。" : "附件读取失败。");
        const lengthHeader = Number(response.headers.get("content-length") ?? "0");
        if (lengthHeader > DOCUMENT_DIAGRAM_PREVIEW_MAX_BYTES) throw new Error("附件过大，无法在页面内预览。");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > DOCUMENT_DIAGRAM_PREVIEW_MAX_BYTES) throw new Error("附件过大，无法在页面内预览。");
        const parsed = kind === "xmind" ? await parseXmind(bytes) : await parseVsdx(bytes);
        if (!cancelled) setState({ status: "ready", ...parsed });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "附件预览失败。" });
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [href, kind]);

  const invalidHref = !isDocumentDiagramAttachmentHref(href);
  const visibleState: PreviewState = invalidHref
    ? { status: "error", message: "仅支持受保护的文档附件预览。" }
    : state;
  const title = kind === "xmind" ? "XMind 思维导图" : "Visio 流程图";
  return (
    <div ref={containerRef} data-document-preview={kind} className="my-5 overflow-hidden rounded-md border border-[#d0d7de] bg-white" aria-label={`${title}预览`}>
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-[#d8dee4] bg-[#f6f8fa] px-3 py-2 text-sm">
        {kind === "xmind" ? <Network size={15} aria-hidden="true" /> : <FileSpreadsheet size={15} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate font-semibold text-[#24292f]">{label}</span>
        <span className="text-xs text-[#57606a]">{title}</span>
        <a href={href} download className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-2.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]">
          <Download size={14} aria-hidden="true" />下载
        </a>
      </div>
      {visibleState.status === "loading" ? <div className="flex min-h-32 items-center justify-center gap-2 px-4 py-8 text-sm text-[#57606a]"><LoaderCircle className="animate-spin" size={16} />正在解析 {title}...</div> : null}
      {visibleState.status === "error" ? <div className="flex min-h-32 items-center justify-center gap-2 px-4 py-8 text-center text-sm text-[#8c4b00]"><AlertCircle size={16} aria-hidden="true" />{visibleState.message} 可下载后用桌面应用查看。</div> : null}
      {visibleState.status === "ready" && visibleState.nodes.length === 0 ? <div className="flex min-h-32 items-center justify-center gap-2 px-4 py-8 text-sm text-[#57606a]"><AlertCircle size={16} />未找到可展示的节点。可下载后用桌面应用查看。</div> : null}
      {visibleState.status === "ready" && visibleState.nodes.length > 0 ? <DiagramSvg title={visibleState.title} nodes={visibleState.nodes} edges={visibleState.edges} /> : null}
    </div>
  );
}

function DiagramSvg({ title, nodes, edges }: { title: string; nodes: DiagramNode[]; edges: DiagramEdge[] }) {
  const markerId = `document-diagram-arrow-${useId().replace(/[^A-Za-z0-9_-]/gu, "")}`;
  const width = Math.max(560, ...nodes.map((node) => node.x + 170));
  const height = Math.max(260, ...nodes.map((node) => node.y + 70));
  return (
    <div className="max-h-[520px] overflow-auto bg-[#fbfcfd] p-4" role="img" aria-label={`${title}：${nodes.map((node) => node.label).join("，")}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-none" aria-hidden="true">
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#0969da" /></marker></defs>
        {edges.map((edge) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          return <line key={`${edge.from}-${edge.to}`} x1={from.x + 70} y1={from.y + 28} x2={to.x + 70} y2={to.y + 28} stroke="#8c959f" strokeWidth="1.5" markerEnd={`url(#${markerId})`} />;
        })}
        {nodes.map((node) => <g key={node.id}><rect x={node.x} y={node.y} width="140" height="56" rx="8" fill={node.depth === 0 ? "#ddf4ff" : "#ffffff"} stroke={node.depth === 0 ? "#0969da" : "#afb8c1"} /><text x={node.x + 70} y={node.y + 33} textAnchor="middle" fill="#24292f" fontSize="13">{truncateLabel(node.label)}</text></g>)}
      </svg>
    </div>
  );
}

function truncateLabel(value: string) {
  return value.length > 16 ? `${value.slice(0, 15)}…` : value;
}

async function parseXmind(bytes: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const contentJson = zip.file("content.json");
  if (contentJson) {
    const parsed = JSON.parse(await contentJson.async("string")) as unknown;
    return buildXmindPreview(parsed);
  }
  const contentXml = zip.file("content.xml");
  const contentXmlPath = contentXml ? null : Object.keys(zip.files).find((name) => name.toLowerCase().endsWith("content.xml"));
  const xmlFile = contentXml ?? (contentXmlPath ? zip.file(contentXmlPath) : null);
  if (!xmlFile) throw new Error("XMind 文件缺少 content.json 或 content.xml。");
  const xml = await xmlFile.async("string");
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) throw new Error("XMind 文件内容过大，无法预览。");
  const { XMLParser } = await import("fast-xml-parser");
  const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true }).parse(xml) as Record<string, unknown>;
  return buildXmindPreview(parsed);
}

function buildXmindPreview(input: unknown) {
  const roots = Array.isArray(input) ? input : [input];
  const firstSheet = roots.find((item) => isRecord(item) && isRecord(item.rootTopic));
  const jsonRoot = firstSheet && isRecord(firstSheet) && isRecord(firstSheet.rootTopic) ? firstSheet.rootTopic : null;
  const xmlRoot = findXmindXmlRoot(input);
  const root = jsonRoot ?? xmlRoot;
  if (!root) throw new Error("未找到 XMind 根主题。");
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const visit = (topic: Record<string, unknown>, depth: number, parentId?: string) => {
    if (nodes.length >= MAX_NODES) return;
    const id = `topic-${nodes.length}`;
    const label = topic.title ?? topic.topic ?? topic.name ?? "未命名主题";
    nodes.push({ id, label: sanitizeText(label), depth, x: depth * 190, y: nodes.length * 72 });
    if (parentId) edges.push({ from: parentId, to: id });
    for (const child of extractXmindChildren(topic)) visit(child, depth + 1, id);
  };
  visit(root, 0);
  return { title: sanitizeText(root.title ?? "XMind"), nodes, edges };
}

function extractXmindChildren(topic: Record<string, unknown>) {
  const children = topic.children;
  const xmlTopics = Array.isArray(topic.topic) ? topic.topic : isRecord(topic.topic) ? [topic.topic] : [];
  if (!isRecord(children)) return xmlTopics.filter(isRecord);
  return ["attached", "detached", "summary", "callout"].flatMap((key) => {
    const value = children[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    return isRecord(value) ? [value] : [];
  });
}

function findXmindXmlRoot(input: unknown): Record<string, unknown> | null {
  const found = findValue(input, "topic");
  if (Array.isArray(found)) {
    for (const candidate of found) {
      if (isRecord(candidate)) return candidate;
    }
    return null;
  }
  return isRecord(found) ? found : null;
}

async function parseVsdx(bytes: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const pageFiles = Object.keys(zip.files).filter((name) => /^visio\/pages\/page\d+\.xml$/iu.test(name)).sort();
  if (!pageFiles.length) throw new Error("Visio 文件缺少页面数据。");
  const { XMLParser } = await import("fast-xml-parser");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true });
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const fileName of pageFiles.slice(0, 3)) {
    const file = zip.file(fileName);
    if (!file) continue;
    const xml = await file.async("string");
    if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) continue;
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const shapes = findArray(parsed, "Shape");
    for (const [index, shape] of shapes.entries()) {
      if (nodes.length >= MAX_NODES) break;
      if (!isRecord(shape)) continue;
      const id = sanitizeText(shape["@_ID"] ?? `shape-${index}`);
      const label = extractVsdxText(shape) || `形状 ${index + 1}`;
      const transform = findRecord(shape, "XForm");
      const x = numberValue(transform?.["@_PinX"]);
      const y = numberValue(transform?.["@_PinY"]);
      nodes.push({ id, label, depth: 0, x: Number.isFinite(x) ? x : index * 180, y: Number.isFinite(y) ? y : 20 });
    }
    const connects = findArray(parsed, "Connect");
    for (const connect of connects) {
      if (!isRecord(connect)) continue;
      const from = sanitizeText(connect["@_FromSheet"]);
      const to = sanitizeText(connect["@_ToSheet"]);
      if (from && to && nodes.some((node) => node.id === from) && nodes.some((node) => node.id === to)) edges.push({ from, to });
    }
  }
  if (!nodes.length) throw new Error("未找到 Visio 形状。");
  return { title: pageFiles[0]?.split("/").at(-1) ?? "Visio", nodes: normalizePositions(nodes), edges };
}

function findArray(input: Record<string, unknown>, key: string): unknown[] {
  const found = findValue(input, key);
  return Array.isArray(found) ? found : found === undefined ? [] : [found];
}

function findRecord(input: Record<string, unknown>, key: string) {
  const found = findValue(input, key);
  return isRecord(found) ? found : null;
}

function findValue(input: unknown, key: string): unknown {
  if (!isRecord(input)) return undefined;
  if (key in input) return input[key];
  for (const value of Object.values(input)) {
    if (!isRecord(value)) continue;
    const found = findValue(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractVsdxText(shape: Record<string, unknown>) {
  const text = findValue(shape, "Text");
  if (typeof text === "string") return sanitizeText(text);
  const textRecord = isRecord(text) ? text : null;
  const value = textRecord?.["#text"];
  return typeof value === "string" ? sanitizeText(value) : "";
}

function normalizePositions(nodes: DiagramNode[]) {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  return nodes.map((node) => ({ ...node, x: Math.max(0, node.x - minX), y: Math.max(0, node.y - minY) }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
}

function sanitizeText(value: unknown) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 120) || "未命名";
}
