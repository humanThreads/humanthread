import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const DOCUMENT_DETAIL_SECTION_TITLES = [
  "文档目录",
  "Markdown 正文",
  "修订记录",
] as const;

export default async function LegacyProjectDocumentPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { documentId } = await params;
  redirect(`/documents/${encodeURIComponent(documentId)}`);
}
