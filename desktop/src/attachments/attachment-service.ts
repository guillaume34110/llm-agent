import { open } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, stat } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { rememberRecentFile } from '../integrations/recent-files-service';
import type { ComposerAttachment, MessageAttachment } from '../types';

const SIDECAR_URL = (import.meta.env.VITE_SIDECAR_URL || 'http://localhost:3471').replace(/\/$/, '');
const TEXT_LIKE_RE = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rs|java|go|html|css|scss|yml|yaml|xml)$/i;
const PREVIEW_LIMIT = 18_000;

function inferKind(name: string, mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image' as const;
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf' as const;
  if (mimeType.startsWith('text/') || TEXT_LIKE_RE.test(name)) return 'text' as const;
  return 'binary' as const;
}

function encodeFileUrl(path: string) {
  return `${SIDECAR_URL}/file?path=${encodeURIComponent(path)}`;
}

async function extractPdfText(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${SIDECAR_URL}/extract-pdf?path=${encodeURIComponent(path)}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    const text = typeof data?.text === 'string' ? data.text : '';
    if (!text || text.startsWith('ERREUR:')) return undefined;
    return text.length > PREVIEW_LIMIT
      ? `${text.slice(0, PREVIEW_LIMIT)}\n…[truncated ${text.length - PREVIEW_LIMIT} chars — call pdf_extract_text with pages= to read more]`
      : text;
  } catch {
    return undefined;
  }
}

async function uploadTmpFile(file: File): Promise<string | undefined> {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${SIDECAR_URL}/upload-tmp`, { method: 'POST', body: form });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data?.path === 'string' ? data.path : undefined;
  } catch {
    return undefined;
  }
}

function toDisplayAttachment(input: ComposerAttachment): MessageAttachment {
  return {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
    absolutePath: input.absolutePath,
  };
}

async function ensureFsAccess(path: string) {
  try {
    await invoke('allow_fs_path', { path });
  } catch {}
}

async function fromAbsolutePath(path: string): Promise<ComposerAttachment> {
  await ensureFsAccess(path);
  const info = await stat(path);
  const name = path.split('/').pop() || path;
  const mimeType = name.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : name.toLowerCase().match(/\.(png|jpg|jpeg|gif|webp|svg)$/)
      ? `image/${name.split('.').pop() === 'jpg' ? 'jpeg' : name.split('.').pop()}`
      : 'application/octet-stream';
  const kind = inferKind(name, mimeType);
  let textContent: string | undefined;
  let previewUrl: string | undefined;
  if (kind === 'text') {
    const raw = await readTextFile(path);
    textContent = raw.length > PREVIEW_LIMIT ? `${raw.slice(0, PREVIEW_LIMIT)}\n…[tronqué ${raw.length - PREVIEW_LIMIT} caractères]` : raw;
  }
  if (kind === 'image' || kind === 'pdf') previewUrl = encodeFileUrl(path);
  if (kind === 'pdf') {
    textContent = await extractPdfText(path);
  }
  const attachment: ComposerAttachment = {
    id: crypto.randomUUID(),
    name,
    mimeType,
    sizeBytes: Number(info.size ?? 0),
    kind,
    absolutePath: path,
    textContent,
    previewUrl,
  };
  rememberRecentFile({
    name,
    mimeType,
    sizeBytes: attachment.sizeBytes,
    absolutePath: path,
  });
  return attachment;
}

async function fromFile(file: File): Promise<ComposerAttachment> {
  const name = file.name;
  const mimeType = file.type || 'application/octet-stream';
  const kind = inferKind(name, mimeType);
  let textContent: string | undefined;
  let previewUrl: string | undefined;
  if (kind === 'text') {
    const raw = await file.text();
    textContent = raw.length > PREVIEW_LIMIT ? `${raw.slice(0, PREVIEW_LIMIT)}\n…[tronqué ${raw.length - PREVIEW_LIMIT} caractères]` : raw;
  } else if (kind === 'image') {
    previewUrl = URL.createObjectURL(file);
  } else if (kind === 'pdf') {
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type || 'application/pdf' });
    previewUrl = URL.createObjectURL(blob);
  }
  let absolutePath = typeof (file as File & { path?: string }).path === 'string'
    ? (file as File & { path?: string }).path || undefined
    : undefined;
  if (!absolutePath && (kind === 'pdf' || kind === 'binary' || kind === 'image')) {
    absolutePath = await uploadTmpFile(file);
  }
  if (kind === 'pdf' && absolutePath) {
    textContent = await extractPdfText(absolutePath);
  }
  rememberRecentFile({
    name,
    mimeType,
    sizeBytes: file.size,
    absolutePath,
  });
  return {
    id: crypto.randomUUID(),
    name,
    mimeType,
    sizeBytes: file.size,
    kind,
    absolutePath,
    textContent,
    previewUrl,
  };
}

export async function pickAttachments() {
  const selected = await open({
    multiple: true,
    directory: false,
    title: 'Choisir des pièces jointes',
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return Promise.all(paths.map(path => fromAbsolutePath(String(path))));
}

export async function loadDroppedAttachments(files: FileList | File[]) {
  return Promise.all(Array.from(files).map(file => fromFile(file)));
}

export function serializeAttachmentsForPrompt(attachments: ComposerAttachment[]) {
  if (!attachments.length) return '';
  const blocks = attachments.map(attachment => {
    const header = [
      `Nom: ${attachment.name}`,
      `Type: ${attachment.mimeType}`,
      `Taille: ${attachment.sizeBytes} octets`,
      attachment.absolutePath ? `Chemin local: ${attachment.absolutePath}` : '',
    ].filter(Boolean).join('\n');
    let content: string;
    if (attachment.textContent) {
      content = `Contenu extrait:\n${attachment.textContent}`;
    } else if (attachment.kind === 'pdf') {
      content = 'Texte PDF non extrait (pypdf indisponible côté sidecar ?). Appelle pdf_extract_text(path) — invoque expand_tools([\'media\']) avant si nécessaire.';
    } else if (attachment.kind === 'image') {
      content = 'Image. Pour OCR: ocr_image(path). Pour analyse visuelle: utilise un modèle multimodal.';
    } else {
      content = 'Binaire non extrait. Utilise un tool dédié au type de fichier.';
    }
    return `${header}\n${content}`;
  });
  return `\n\n<pieces_jointes_locales>\n${blocks.map((block, index) => `--- Pièce jointe ${index + 1} ---\n${block}`).join('\n\n')}\n</pieces_jointes_locales>`;
}

export function toMessageAttachments(attachments: ComposerAttachment[]) {
  return attachments.map(toDisplayAttachment);
}

export async function readTextAttachmentFromPath(path: string) {
  await ensureFsAccess(path);
  return readTextFile(path);
}

export async function readBinaryAttachmentFromPath(path: string) {
  await ensureFsAccess(path);
  return readFile(path);
}
