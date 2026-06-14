import { dbQuery, dbExecute } from '../db';
import type { LibraryDocumentItem } from './library.service';

export interface DocumentCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

function newId(): string {
  return `coll_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listCollections(): Promise<DocumentCollection[]> {
  const rows = await dbQuery<any[]>(
    `SELECT c.id, c.name, c.description, c.color, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM knowledge_collection_document d WHERE d.collection_id = c.id) AS doc_count
       FROM knowledge_collection c
       ORDER BY c.updated_at DESC`,
    [],
  );
  return rows.map(r => ({
    id: String(r[0]),
    name: String(r[1]),
    description: String(r[2] ?? ''),
    color: String(r[3] ?? ''),
    createdAt: Number(r[4] ?? 0),
    updatedAt: Number(r[5] ?? 0),
    documentCount: Number(r[6] ?? 0),
  }));
}

export async function createCollection(name: string, description = '', color = ''): Promise<DocumentCollection> {
  const id = newId();
  const now = Date.now();
  await dbExecute(
    `INSERT INTO knowledge_collection (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name.trim() || 'Untitled', description, color, now, now],
  );
  return { id, name: name.trim() || 'Untitled', description, color, documentCount: 0, createdAt: now, updatedAt: now };
}

export async function renameCollection(id: string, name: string) {
  await dbExecute(
    `UPDATE knowledge_collection SET name = ?, updated_at = ? WHERE id = ?`,
    [name.trim() || 'Untitled', Date.now(), id],
  );
}

export async function updateCollectionDescription(id: string, description: string) {
  await dbExecute(
    `UPDATE knowledge_collection SET description = ?, updated_at = ? WHERE id = ?`,
    [description, Date.now(), id],
  );
}

export async function updateCollectionColor(id: string, color: string) {
  await dbExecute(
    `UPDATE knowledge_collection SET color = ?, updated_at = ? WHERE id = ?`,
    [color, Date.now(), id],
  );
}

export async function deleteCollection(id: string) {
  await dbExecute(`DELETE FROM knowledge_collection WHERE id = ?`, [id]);
}

export async function addDocumentsToCollection(collectionId: string, documentIds: string[]) {
  if (!documentIds.length) return;
  const now = Date.now();
  for (const docId of documentIds) {
    await dbExecute(
      `INSERT OR IGNORE INTO knowledge_collection_document (collection_id, document_id, added_at) VALUES (?, ?, ?)`,
      [collectionId, docId, now],
    );
  }
  await dbExecute(`UPDATE knowledge_collection SET updated_at = ? WHERE id = ?`, [now, collectionId]);
}

export async function removeDocumentsFromCollection(collectionId: string, documentIds: string[]) {
  if (!documentIds.length) return;
  const placeholders = documentIds.map(() => '?').join(',');
  await dbExecute(
    `DELETE FROM knowledge_collection_document WHERE collection_id = ? AND document_id IN (${placeholders})`,
    [collectionId, ...documentIds],
  );
  await dbExecute(`UPDATE knowledge_collection SET updated_at = ? WHERE id = ?`, [Date.now(), collectionId]);
}

export async function listDocumentsInCollection(collectionId: string): Promise<LibraryDocumentItem[]> {
  const rows = await dbQuery<any[]>(
    `SELECT d.id, d.title, d.source, d.mime_type, d.size_bytes, d.tags, d.created_at
       FROM knowledge_document d
       JOIN knowledge_collection_document cd ON cd.document_id = d.id
      WHERE cd.collection_id = ? AND d.archived = 0
      ORDER BY cd.added_at DESC`,
    [collectionId],
  );
  return rows.map(r => ({
    id: String(r[0]),
    title: String(r[1]),
    source: String(r[2]),
    mimeType: String(r[3]),
    sizeBytes: Number(r[4] ?? 0),
    tags: JSON.parse((r[5] as string) || '[]'),
    createdAt: Number(r[6] ?? 0),
  }));
}

export async function listCollectionIdsForDocument(documentId: string): Promise<string[]> {
  const rows = await dbQuery<any[]>(
    `SELECT collection_id FROM knowledge_collection_document WHERE document_id = ?`,
    [documentId],
  );
  return rows.map(r => String(r[0]));
}
