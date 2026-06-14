// End-to-end encrypted collection sharing. Server stores opaque ciphertext only;
// the AES-GCM key lives in the URL fragment and never reaches the backend.
// Vectors are bundled when present, but discarded at import unless the receiver's
// embedding model + dim match exactly — otherwise raw text is kept and the user
// can re-embed locally via the existing KB pipeline.

import { dbQuery, dbExecute } from '../db';
import { getKbSetting } from '../memory/kb-setting';
import { addDocumentsToCollection, createCollection } from './collections.service';
import { encryptAndUploadShare, fetchAndDecryptShare, parseShareUrl } from '../social/share-crypto';

interface SharedChunk {
  chunk_index: number;
  content: string;
  start_char: number;
  end_char: number;
  page_number: number | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_blob: number[] | null;
}

interface SharedDoc {
  title: string;
  source: string;
  source_url: string | null;
  mime_type: string;
  size_bytes: number;
  raw_text: string;
  language: string | null;
  tags: string[];
  metadata: any;
  chunks: SharedChunk[];
}

interface CollectionBundle {
  kind: 'collection-share-v1';
  name: string;
  description: string;
  embeddingModel: string | null;
  embeddingDim: number | null;
  docs: SharedDoc[];
}

function newId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function buildBundle(collectionId: string): Promise<CollectionBundle> {
  const collRows = await dbQuery<any[]>(
    `SELECT name, description FROM knowledge_collection WHERE id = ?`,
    [collectionId],
  );
  if (!collRows[0]) throw new Error('collection not found');

  const docRows = await dbQuery<any[]>(
    `SELECT d.id, d.title, d.source, d.source_url, d.mime_type, d.size_bytes, d.raw_text, d.language, d.tags, d.metadata
       FROM knowledge_document d
       JOIN knowledge_collection_document cd ON cd.document_id = d.id
      WHERE cd.collection_id = ? AND d.archived = 0`,
    [collectionId],
  );

  let modelSeen: string | null = null;
  let dimSeen: number | null = null;
  const docs: SharedDoc[] = [];

  for (const r of docRows) {
    const docId = String(r[0]);
    const chunkRows = await dbQuery<any[]>(
      `SELECT chunk_index, content, start_char, end_char, page_number, embedding_model, embedding_dim, embedding_blob
         FROM knowledge_chunk WHERE document_id = ? ORDER BY chunk_index`,
      [docId],
    );
    const chunks: SharedChunk[] = chunkRows.map(ch => {
      if (ch[5] && !modelSeen) modelSeen = String(ch[5]);
      if (ch[6] != null && dimSeen == null) dimSeen = Number(ch[6]);
      return {
        chunk_index: Number(ch[0]),
        content: String(ch[1]),
        start_char: Number(ch[2]),
        end_char: Number(ch[3]),
        page_number: ch[4] == null ? null : Number(ch[4]),
        embedding_model: ch[5] ? String(ch[5]) : null,
        embedding_dim: ch[6] == null ? null : Number(ch[6]),
        embedding_blob: Array.isArray(ch[7]) ? (ch[7] as number[]) : null,
      };
    });
    docs.push({
      title: String(r[1]),
      source: String(r[2]),
      source_url: r[3] ? String(r[3]) : null,
      mime_type: String(r[4]),
      size_bytes: Number(r[5] ?? 0),
      raw_text: String(r[6] ?? ''),
      language: r[7] ? String(r[7]) : null,
      tags: JSON.parse((r[8] as string) || '[]'),
      metadata: JSON.parse((r[9] as string) || '{}'),
      chunks,
    });
  }

  return {
    kind: 'collection-share-v1',
    name: String(collRows[0][0]),
    description: String(collRows[0][1] ?? ''),
    embeddingModel: modelSeen,
    embeddingDim: dimSeen,
    docs,
  };
}

export async function shareCollection(collectionId: string): Promise<{ url: string; id: string; docCount: number }> {
  const bundle = await buildBundle(collectionId);
  const { id, url } = await encryptAndUploadShare(bundle, 'kind=collection');
  return { url, id, docCount: bundle.docs.length };
}

export interface ImportResult {
  collectionId: string;
  imported: number;
  vectorsKept: boolean;
  bundleModel: string | null;
  bundleDim: number | null;
}

export async function importCollectionFromUrl(url: string): Promise<ImportResult> {
  const { id, keyB64u } = parseShareUrl(url);
  const bundle = await fetchAndDecryptShare<CollectionBundle>(id, keyB64u);
  if (bundle?.kind !== 'collection-share-v1') throw new Error('not a collection share');

  const kb = await getKbSetting();
  const vectorsCompatible = !!(
    bundle.embeddingModel &&
    bundle.embeddingDim != null &&
    bundle.embeddingModel === kb.model.id &&
    bundle.embeddingDim === kb.model.dim
  );

  const created = await createCollection(bundle.name, bundle.description);
  const docIds: string[] = [];
  const now = Date.now();

  for (const d of bundle.docs) {
    const docId = `doc_${newId()}`;
    await dbExecute(
      `INSERT INTO knowledge_document (id, title, source, source_url, mime_type, size_bytes, raw_text, language, tags, metadata, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        docId,
        d.title,
        d.source,
        d.source_url,
        d.mime_type,
        d.size_bytes,
        d.raw_text,
        d.language,
        JSON.stringify(d.tags || []),
        JSON.stringify(d.metadata || {}),
        now,
      ],
    );
    if (vectorsCompatible) {
      for (const ch of d.chunks) {
        await dbExecute(
          `INSERT INTO knowledge_chunk (id, document_id, chunk_index, content, start_char, end_char, page_number, embedding_model, embedding_dim, embedding_blob, resonance_score, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            `chunk_${newId()}`,
            docId,
            ch.chunk_index,
            ch.content,
            ch.start_char,
            ch.end_char,
            ch.page_number,
            ch.embedding_model,
            ch.embedding_dim,
            ch.embedding_blob,
            now,
          ],
        );
      }
    }
    docIds.push(docId);
  }
  await addDocumentsToCollection(created.id, docIds);
  return {
    collectionId: created.id,
    imported: docIds.length,
    vectorsKept: vectorsCompatible,
    bundleModel: bundle.embeddingModel,
    bundleDim: bundle.embeddingDim,
  };
}
