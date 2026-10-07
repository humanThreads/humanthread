import { WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES } from "../workbench/workbench-document-attachments";

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

export function decodeDocumentAttachmentBase64(
  value: string,
  maxBytes = WORKBENCH_DOCUMENT_ATTACHMENT_MAX_BYTES,
) {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !BASE64_PATTERN.test(normalized)
  ) {
    throw new Error("Document attachment contentBase64 is invalid");
  }
  // Reject oversized payloads before allocating the decoded buffer.
  if (normalized.length > Math.ceil(maxBytes / 3) * 4) {
    throw new Error("Document attachment contentBase64 is too large");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) {
    throw new Error("Document attachment contentBase64 is invalid");
  }
  if (bytes.length > maxBytes) {
    throw new Error("Document attachment contentBase64 is too large");
  }
  return bytes;
}

export function createDocumentAttachmentFile(input: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}) {
  return new File([decodeDocumentAttachmentBase64(input.contentBase64)], input.fileName, {
    type: input.mimeType,
  });
}
