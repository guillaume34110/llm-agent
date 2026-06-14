import { dbQuery } from '../db';
import { knowledgeService } from '../memory/knowledge.service';

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';

export interface LibraryMemoryItem {
  id: string;
  content: string;
  type: string;
  tags: string[];
  sessionId: string;
  createdAt: number;
}

export interface LibraryDocumentItem {
  id: string;
  title: string;
  source: string;
  mimeType: string;
  sizeBytes: number;
  tags: string[];
  createdAt: number;
}

async function fetchAtoms(limit: number, q?: string): Promise<LibraryMemoryItem[]> {
  const url = new URL(`${SIDECAR_BASE}/memory/atoms`);
  url.searchParams.set('limit', String(limit));
  if (q) url.searchParams.set('q', q);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((it: any) => ({
      id: String(it.id || ''),
      content: String(it.content || ''),
      type: String(it.type || 'atom'),
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
      sessionId: String(it.sessionId || ''),
      createdAt: Number(it.createdAt || 0),
    }));
  } catch {
    return [];
  }
}

export async function listMemoryItems(limit = 50): Promise<LibraryMemoryItem[]> {
  return fetchAtoms(limit);
}

export async function searchMemoryItems(query: string, limit = 20): Promise<LibraryMemoryItem[]> {
  return fetchAtoms(limit, query);
}

export async function summarizeMemoryItems(modelId?: string, limit = 200): Promise<{ summary: string; count: number }> {
  try {
    const res = await fetch(`${SIDECAR_BASE}/memory/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId || '', limit }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    return { summary: String(data?.summary || ''), count: Number(data?.count || 0) };
  } catch (e: any) {
    return { summary: `Erreur: ${e?.message || e}`, count: 0 };
  }
}

export async function archiveMemoryItem(atomId: string) {
  try {
    await fetch(`${SIDECAR_BASE}/memory/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: atomId }),
    });
  } catch {}
}

export async function listLibraryDocuments(limit = 50): Promise<LibraryDocumentItem[]> {
  const docs = await knowledgeService.listDocuments(limit);
  return docs.map(doc => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    tags: doc.tags,
    createdAt: doc.createdAt,
  }));
}

export async function searchLibraryDocuments(query: string, limit = 10) {
  return knowledgeService.searchKb(query, limit);
}

export async function getLibraryDocumentPreview(documentId: string) {
  const rows = await dbQuery<any[]>(
    `SELECT raw_text FROM knowledge_document WHERE id = ? LIMIT 1`,
    [documentId],
  );
  return String(rows[0]?.[0] ?? '');
}

export async function archiveLibraryDocument(documentId: string) {
  await knowledgeService.archiveDocument(documentId);
}

export async function restoreLibraryDocument(documentId: string) {
  await knowledgeService.restoreDocument(documentId);
}

export async function listArchivedLibraryDocuments(limit = 200): Promise<LibraryDocumentItem[]> {
  const docs = await knowledgeService.listArchivedDocuments(limit);
  return docs.map(doc => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    tags: doc.tags,
    createdAt: doc.createdAt,
  }));
}

export async function countArchivedLibraryDocuments(): Promise<number> {
  return knowledgeService.countArchived();
}

export async function renameLibraryDocument(documentId: string, title: string) {
  await knowledgeService.renameDocument(documentId, title);
}

export async function setLibraryDocumentTags(documentId: string, tags: string[]) {
  await knowledgeService.setDocumentTags(documentId, tags);
}

export async function listAllLibraryTags(): Promise<string[]> {
  return knowledgeService.listAllTags();
}

export async function getLibraryStats() {
  return knowledgeService.getLibraryStats();
}

export async function findLibraryDuplicates() {
  return knowledgeService.findDuplicates();
}

export async function deleteLibraryDocument(documentId: string) {
  await knowledgeService.deleteDocument(documentId);
}

export async function deleteManyLibraryDocuments(ids: string[]) {
  return knowledgeService.deleteMany(ids);
}

export async function archiveManyLibraryDocuments(ids: string[]) {
  return knowledgeService.archiveMany(ids, true);
}

export async function purgeUnindexedLibraryDocuments() {
  return knowledgeService.purgeUnindexed();
}

export async function countUnindexedLibraryDocuments() {
  return knowledgeService.countUnindexed();
}

export async function searchLibraryDocumentsRag(query: string, n = 30): Promise<LibraryDocumentItem[]> {
  const hits = await knowledgeService.searchKb(query, n);
  const seen = new Set<string>();
  const docIds: string[] = [];
  for (const h of hits) {
    if (!seen.has(h.documentId)) {
      seen.add(h.documentId);
      docIds.push(h.documentId);
    }
  }
  if (!docIds.length) return [];
  const placeholders = docIds.map(() => '?').join(',');
  const rows = await dbQuery<any[]>(
    `SELECT id, title, source, mime_type, size_bytes, tags, created_at FROM knowledge_document WHERE id IN (${placeholders})`,
    docIds,
  );
  const byId = new Map<string, LibraryDocumentItem>();
  for (const r of rows) {
    byId.set(r[0] as string, {
      id: r[0],
      title: r[1],
      source: r[2],
      mimeType: r[3],
      sizeBytes: Number(r[4] ?? 0),
      tags: JSON.parse(r[5] || '[]'),
      createdAt: Number(r[6] ?? 0),
    });
  }
  return docIds.map(id => byId.get(id)).filter(Boolean) as LibraryDocumentItem[];
}
