"use client";

export function DocumentHtmlPreview({ title, html }: { title: string; html: string }) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:;"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`;
  return <iframe title={title} sandbox="allow-forms allow-modals allow-popups" srcDoc={srcDoc} className="h-full min-h-[620px] w-full border-0 bg-white" />;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}
