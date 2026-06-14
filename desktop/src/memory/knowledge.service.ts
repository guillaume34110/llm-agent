import { dbQuery, dbExecute, vecToBlob, blobToVec, cosine } from '../db';
import { embedTexts, getEmbedModelInfo } from './embedding-client';
import { getKbSetting, setKbModel, invalidateKbSettingCache } from './kb-setting';
import type { EmbeddingModel } from './embedding-catalog';

export interface KbDocument {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  mimeType: string;
  sizeBytes: number;
  tags: string[];
  archived: boolean;
  createdAt: number;
}

export interface KbChunkHit {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  pageNumber?: number;
  score: number;
}

const CHUNK_MAX = 800;
const CHUNK_OVERLAP = 100;

// One-shot trigger fix: db.rs originally declared chunk_ad/chunk_au with
// `DELETE FROM knowledge_chunk_fts WHERE rowid = …`, which is invalid on
// external-content FTS5 and crashes with `no such column: T.content_rowid`.
// We drop+recreate with the correct 'delete' command. Runs once per process.
let _ftsTriggersPatched = false;
async function ensureFtsDeleteTriggers(): Promise<void> {
  if (_ftsTriggersPatched) return;
  try {
    await dbExecute(`DROP TRIGGER IF EXISTS chunk_ad`, []);
    await dbExecute(`DROP TRIGGER IF EXISTS chunk_au`, []);
    await dbExecute(
      `CREATE TRIGGER chunk_ad AFTER DELETE ON knowledge_chunk BEGIN
         INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
       END`,
      [],
    );
    await dbExecute(
      `CREATE TRIGGER chunk_au AFTER UPDATE ON knowledge_chunk BEGIN
         INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
         INSERT INTO knowledge_chunk_fts(rowid, content) VALUES (new.rowid, new.content);
       END`,
      [],
    );
    _ftsTriggersPatched = true;
  } catch (e) {
    console.warn('ensureFtsDeleteTriggers failed:', e);
  }
}

function uuid(): string {
  return (globalThis.crypto as any)?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

export class KnowledgeService {
  async addDocument(input: {
    title: string;
    rawText: string;
    source?: string;
    sourceUrl?: string;
    mimeType?: string;
    tags?: string[];
  }): Promise<KbDocument> {
    if (!input.rawText?.trim()) throw new Error('rawText vide');
    const id = uuid();
    const now = Date.now();
    const sizeBytes = new Blob([input.rawText]).size;
    const doc: KbDocument = {
      id,
      title: input.title,
      source: input.source ?? 'upload',
      sourceUrl: input.sourceUrl,
      mimeType: input.mimeType ?? 'text/plain',
      sizeBytes,
      tags: input.tags ?? [],
      archived: false,
      createdAt: now,
    };
    await dbExecute(
      `INSERT INTO knowledge_document (id, title, source, source_url, mime_type, size_bytes, raw_text, language, tags, metadata, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}', 0, ?)`,
      [
        doc.id,
        doc.title,
        doc.source,
        doc.sourceUrl ?? null,
        doc.mimeType,
        doc.sizeBytes,
        input.rawText,
        JSON.stringify(doc.tags),
        now,
      ],
    );

    const chunks = this.chunkText(input.rawText, CHUNK_MAX, CHUNK_OVERLAP);
    const vectors = await embedTexts(chunks.map(c => c.text));
    const { model, dim } = await getEmbedModelInfo();
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const v = vectors[i] ?? [];
      const blob = v.length === dim ? vecToBlob(v) : null;
      await dbExecute(
        `INSERT INTO knowledge_chunk (id, document_id, chunk_index, content, start_char, end_char, page_number, embedding_model, embedding_dim, embedding_blob, resonance_score, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
        [uuid(), doc.id, i, c.text, c.start, c.end, blob ? model : null, blob ? dim : null, blob, now],
      );
    }
    return doc;
  }

  async listDocuments(n = 50, tag?: string): Promise<KbDocument[]> {
    const sql = tag
      ? `SELECT id, title, source, source_url, mime_type, size_bytes, tags, archived, created_at FROM knowledge_document WHERE archived = 0 AND tags LIKE ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, title, source, source_url, mime_type, size_bytes, tags, archived, created_at FROM knowledge_document WHERE archived = 0 ORDER BY created_at DESC LIMIT ?`;
    const params: any[] = tag ? [`%"${tag}"%`, n] : [n];
    const rows = await dbQuery<any[]>(sql, params);
    return rows.map(r => ({
      id: r[0],
      title: r[1],
      source: r[2],
      sourceUrl: r[3] ?? undefined,
      mimeType: r[4],
      sizeBytes: Number(r[5] ?? 0),
      tags: JSON.parse(r[6] || '[]'),
      archived: !!r[7],
      createdAt: Number(r[8] ?? 0),
    }));
  }

  async archiveDocument(id: string): Promise<void> {
    await dbExecute(`UPDATE knowledge_document SET archived = 1 WHERE id = ?`, [id]);
  }

  async restoreDocument(id: string): Promise<void> {
    await dbExecute(`UPDATE knowledge_document SET archived = 0 WHERE id = ?`, [id]);
  }

  async listArchivedDocuments(n = 200): Promise<KbDocument[]> {
    const rows = await dbQuery<any[]>(
      `SELECT id, title, source, source_url, mime_type, size_bytes, tags, archived, created_at FROM knowledge_document WHERE archived = 1 ORDER BY created_at DESC LIMIT ?`,
      [n],
    );
    return rows.map(r => ({
      id: r[0],
      title: r[1],
      source: r[2],
      sourceUrl: r[3] ?? undefined,
      mimeType: r[4],
      sizeBytes: Number(r[5] ?? 0),
      tags: JSON.parse(r[6] || '[]'),
      archived: !!r[7],
      createdAt: Number(r[8] ?? 0),
    }));
  }

  async countArchived(): Promise<number> {
    const [row] = await dbQuery<any[]>(
      `SELECT COUNT(*) FROM knowledge_document WHERE archived = 1`,
      [],
    );
    return Number(row?.[0] ?? 0);
  }

  async renameDocument(id: string, title: string): Promise<void> {
    const clean = title.trim() || 'Untitled';
    await dbExecute(`UPDATE knowledge_document SET title = ? WHERE id = ?`, [clean, id]);
  }

  async setDocumentTags(id: string, tags: string[]): Promise<void> {
    const norm = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)));
    await dbExecute(`UPDATE knowledge_document SET tags = ? WHERE id = ?`, [JSON.stringify(norm), id]);
  }

  async listAllTags(): Promise<string[]> {
    const rows = await dbQuery<any[]>(
      `SELECT tags FROM knowledge_document WHERE archived = 0 AND tags != '[]' AND tags IS NOT NULL`,
      [],
    );
    const seen = new Set<string>();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r[0] || '[]');
        if (Array.isArray(arr)) for (const t of arr) if (typeof t === 'string' && t) seen.add(t);
      } catch {}
    }
    return Array.from(seen).sort();
  }

  async getLibraryStats(): Promise<{
    docCount: number;
    totalBytes: number;
    chunkCount: number;
    vectorizedChunks: number;
    tagCount: number;
    lastImportAt: number | null;
  }> {
    const [docRow] = await dbQuery<any[]>(
      `SELECT COUNT(*), COALESCE(SUM(size_bytes), 0), MAX(created_at) FROM knowledge_document WHERE archived = 0`,
      [],
    );
    const [chunkRow] = await dbQuery<any[]>(
      `SELECT COUNT(*), SUM(CASE WHEN embedding_blob IS NOT NULL THEN 1 ELSE 0 END)
         FROM knowledge_chunk ch
         JOIN knowledge_document d ON d.id = ch.document_id
        WHERE d.archived = 0`,
      [],
    );
    const tags = await this.listAllTags();
    return {
      docCount: Number(docRow?.[0] ?? 0),
      totalBytes: Number(docRow?.[1] ?? 0),
      lastImportAt: docRow?.[2] ? Number(docRow[2]) : null,
      chunkCount: Number(chunkRow?.[0] ?? 0),
      vectorizedChunks: Number(chunkRow?.[1] ?? 0),
      tagCount: tags.length,
    };
  }

  async findDuplicates(): Promise<Array<{
    key: string;
    title: string;
    sizeBytes: number;
    docs: Array<{ id: string; source: string; createdAt: number }>;
  }>> {
    const rows = await dbQuery<any[]>(
      `SELECT id, title, source, size_bytes, created_at
         FROM knowledge_document
        WHERE archived = 0
        ORDER BY title, size_bytes, created_at`,
      [],
    );
    const groups = new Map<string, Array<{ id: string; title: string; sizeBytes: number; source: string; createdAt: number }>>();
    for (const r of rows) {
      const title = String(r[1] || '');
      const size = Number(r[3] ?? 0);
      if (!title) continue;
      const key = `${title.toLowerCase()}|${size}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({
        id: String(r[0]),
        title,
        sizeBytes: size,
        source: String(r[2] || ''),
        createdAt: Number(r[4] ?? 0),
      });
    }
    const out: Array<{
      key: string;
      title: string;
      sizeBytes: number;
      docs: Array<{ id: string; source: string; createdAt: number }>;
    }> = [];
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      out.push({
        key,
        title: list[0].title,
        sizeBytes: list[0].sizeBytes,
        docs: list.map(d => ({ id: d.id, source: d.source, createdAt: d.createdAt })),
      });
    }
    return out.sort((a, b) => b.docs.length - a.docs.length);
  }

  async deleteDocument(id: string): Promise<void> {
    await dbExecute(`DELETE FROM knowledge_document WHERE id = ?`, [id]);
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    await ensureFtsDeleteTriggers();
    const placeholders = ids.map(() => '?').join(',');
    await dbExecute(`DELETE FROM knowledge_chunk WHERE document_id IN (${placeholders})`, ids);
    await dbExecute(`DELETE FROM knowledge_document WHERE id IN (${placeholders})`, ids);
    return ids.length;
  }

  async archiveMany(ids: string[], archived: boolean = true): Promise<number> {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    await dbExecute(
      `UPDATE knowledge_document SET archived = ? WHERE id IN (${placeholders})`,
      [archived ? 1 : 0, ...ids],
    );
    return ids.length;
  }

  async purgeUnindexed(): Promise<number> {
    const rows = await dbQuery<any[]>(
      `SELECT d.id FROM knowledge_document d WHERE d.archived = 0 AND NOT EXISTS (
         SELECT 1 FROM knowledge_chunk ch WHERE ch.document_id = d.id AND ch.embedding_blob IS NOT NULL
       )`,
      [],
    );
    const ids = rows.map(r => r[0] as string);
    return this.deleteMany(ids);
  }

  async countUnindexed(): Promise<number> {
    const rows = await dbQuery<any[]>(
      `SELECT COUNT(*) FROM knowledge_document d WHERE d.archived = 0 AND NOT EXISTS (
         SELECT 1 FROM knowledge_chunk ch WHERE ch.document_id = d.id AND ch.embedding_blob IS NOT NULL
       )`,
      [],
    );
    return Number(rows[0]?.[0] ?? 0);
  }

  async searchKb(query: string, n = 5): Promise<KbChunkHit[]> {
    const queryVec = await embedTexts([query]).then(r => r[0] ?? []);
    const { model } = await getEmbedModelInfo();

    // FTS
    let ftsRows: any[][] = [];
    try {
      ftsRows = await dbQuery<any[]>(
        `SELECT c.id, c.document_id, c.chunk_index, c.content, c.page_number, d.title
         FROM knowledge_chunk_fts f JOIN knowledge_chunk c ON c.rowid = f.rowid JOIN knowledge_document d ON d.id = c.document_id
         WHERE knowledge_chunk_fts MATCH ? AND d.archived = 0
         ORDER BY rank LIMIT 20`,
        [query],
      );
    } catch (e) {
      console.warn('fts kb failed:', e);
    }

    // ANN
    let annRows: any[][] = [];
    if (queryVec.length) {
      const candidates = await dbQuery<any[]>(
        `SELECT c.id, c.document_id, c.chunk_index, c.content, c.page_number, d.title, c.embedding_blob
         FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
         WHERE d.archived = 0 AND c.embedding_model = ? AND c.embedding_blob IS NOT NULL
         ORDER BY c.created_at DESC LIMIT 1000`,
        [model],
      );
      const scored = candidates.map(r => ({ r, sim: cosine(queryVec, blobToVec(r[6])) }));
      annRows = scored
        .filter(s => s.sim >= 0.3)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 20)
        .map(s => s.r);
    }

    // RRF
    const RRF_K = 60;
    const scores = new Map<string, number>();
    const all = new Map<string, any[]>();
    annRows.forEach((r, i) => {
      scores.set(r[0], (scores.get(r[0]) ?? 0) + 1 / (RRF_K + i + 1));
      all.set(r[0], r);
    });
    ftsRows.forEach((r, i) => {
      scores.set(r[0], (scores.get(r[0]) ?? 0) + 1 / (RRF_K + i + 1));
      all.set(r[0], r);
    });

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, sc]) => {
        const r = all.get(id)!;
        return {
          documentId: r[1],
          documentTitle: r[5],
          chunkIndex: Number(r[2] ?? 0),
          content: r[3],
          pageNumber: r[4] ?? undefined,
          score: sc,
        };
      });
  }

  // chunking sentences avec overlap
  private chunkText(
    text: string,
    maxChars: number,
    overlap: number,
  ): Array<{ text: string; start: number; end: number }> {
    const out: Array<{ text: string; start: number; end: number }> = [];
    if (text.length <= maxChars) return [{ text, start: 0, end: text.length }];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let cur = '';
    let curStart = 0;
    let pos = 0;
    for (const s of sentences) {
      const sStart = text.indexOf(s, pos);
      if (sStart >= 0) pos = sStart + s.length;
      if (cur.length + s.length + 1 > maxChars && cur.length > 0) {
        out.push({ text: cur.trim(), start: curStart, end: curStart + cur.length });
        const tail = cur.slice(Math.max(0, cur.length - overlap));
        cur = tail + ' ' + s;
        curStart = sStart - tail.length - 1;
        if (curStart < 0) curStart = 0;
      } else {
        if (!cur) curStart = sStart >= 0 ? sStart : 0;
        cur += (cur ? ' ' : '') + s;
      }
    }
    if (cur.trim()) out.push({ text: cur.trim(), start: curStart, end: curStart + cur.length });
    return out;
  }

  // ===== Embedding model lifecycle =====

  async getCurrentModel(): Promise<{ model: EmbeddingModel; isConfigured: boolean }> {
    return getKbSetting();
  }

  async getStatus(): Promise<{
    model: EmbeddingModel;
    isConfigured: boolean;
    totalChunks: number;
    vectorizedChunks: number;
    isActive: boolean;
  }> {
    const { model, isConfigured } = await getKbSetting();
    const totalRow = await dbQuery<any[]>(
      `SELECT COUNT(*) FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id WHERE d.archived = 0`,
      [],
    );
    const vecRow = await dbQuery<any[]>(
      `SELECT COUNT(*) FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id
       WHERE d.archived = 0 AND c.embedding_model = ? AND c.embedding_blob IS NOT NULL`,
      [model.id],
    );
    const totalChunks = Number(totalRow[0]?.[0] ?? 0);
    const vectorizedChunks = Number(vecRow[0]?.[0] ?? 0);
    const isActive = isConfigured && totalChunks > 0 && vectorizedChunks === totalChunks;
    return { model, isConfigured, totalChunks, vectorizedChunks, isActive };
  }

  // Switch model. Destroys all chunks (keeps raw documents). Caller must
  // re-vectorize afterwards via reEmbedAll() to bring the KB back to active.
  async changeModel(modelId: string): Promise<EmbeddingModel> {
    const next = await setKbModel(modelId);
    await dbExecute(`DELETE FROM knowledge_chunk`, []);
    invalidateKbSettingCache();
    return next;
  }

  // Re-chunk + re-embed all non-archived documents from their raw_text using
  // the currently selected model. Skips docs that already have chunks under the
  // current model (idempotent). Returns counts.
  async reEmbedAll(onProgress?: (done: number, total: number) => void): Promise<{
    documents: number;
    chunks: number;
  }> {
    const { model, dim } = await getEmbedModelInfo();
    const docs = await dbQuery<any[]>(
      `SELECT id, raw_text FROM knowledge_document WHERE archived = 0`,
      [],
    );
    let chunkCount = 0;
    for (let di = 0; di < docs.length; di++) {
      const [docId, rawText] = docs[di];
      const existing = await dbQuery<any[]>(
        `SELECT COUNT(*) FROM knowledge_chunk WHERE document_id = ? AND embedding_model = ?`,
        [docId, model],
      );
      const have = Number(existing[0]?.[0] ?? 0);
      if (have > 0) {
        onProgress?.(di + 1, docs.length);
        continue;
      }
      await dbExecute(`DELETE FROM knowledge_chunk WHERE document_id = ?`, [docId]);
      const chunks = this.chunkText(rawText ?? '', CHUNK_MAX, CHUNK_OVERLAP);
      const vectors = await embedTexts(chunks.map(c => c.text));
      const now = Date.now();
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const v = vectors[i] ?? [];
        const blob = v.length === dim ? vecToBlob(v) : null;
        await dbExecute(
          `INSERT INTO knowledge_chunk (id, document_id, chunk_index, content, start_char, end_char, page_number, embedding_model, embedding_dim, embedding_blob, resonance_score, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
          [uuid(), docId, i, c.text, c.start, c.end, blob ? model : null, blob ? dim : null, blob, now],
        );
        chunkCount++;
      }
      onProgress?.(di + 1, docs.length);
    }
    return { documents: docs.length, chunks: chunkCount };
  }
}

export const knowledgeService = new KnowledgeService();
