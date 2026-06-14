import { dbQuery, dbExecute, vecToBlob, blobToVec, cosine } from '../db';
import { embedOne, getEmbedModelInfo } from './embedding-client';

export interface Atom {
  id: string;
  content: string;
  type: string;
  tags: string[];
  resonanceScore: number;
  sessionId: string;
  archived: boolean;
  createdAt: number;
}

export interface Dream {
  id: string;
  content: string;
  sourceAtomIds: string[];
  resonanceScore: number;
  validated: boolean;
  createdAt: number;
}

const MIN_SIM = 0.35;

function uuid(): string {
  return (globalThis.crypto as any)?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

function rowToAtom(r: any[]): Atom {
  return {
    id: r[0],
    content: r[1],
    type: r[2],
    tags: JSON.parse(r[3] || '[]'),
    resonanceScore: Number(r[4] ?? 0),
    sessionId: r[5] ?? '',
    archived: !!r[6],
    createdAt: Number(r[7] ?? 0),
  };
}

export class MemoryService {
  // ── Atoms ──────────────────────────────────────────────

  async addAtom(data: { content: string; type: string; tags?: string[]; sessionId?: string }): Promise<Atom> {
    const chunks = this.splitIntoChunks(data.content, 1000);
    if (chunks.length === 1) return this.addAtomSingle(data);
    let first: Atom | null = null;
    for (let i = 0; i < chunks.length; i++) {
      const tags = [...(data.tags ?? []), 'chunk', `chunk_${i + 1}_of_${chunks.length}`];
      const a = await this.addAtomSingle({ ...data, content: chunks[i], tags });
      if (i === 0) first = a;
    }
    return first!;
  }

  private async addAtomSingle(data: { content: string; type: string; tags?: string[]; sessionId?: string }): Promise<Atom> {
    // 1. exact match dedup
    const exact = await dbQuery<any[]>(
      `SELECT id, content, type, tags, resonance_score, session_id, archived, created_at FROM memory_atom WHERE content = ? AND archived = 0 LIMIT 1`,
      [data.content],
    );
    if (exact.length) {
      const id = exact[0][0];
      await dbExecute(`UPDATE memory_atom SET resonance_score = resonance_score + 0.05 WHERE id = ?`, [id]);
      return rowToAtom(exact[0]);
    }

    // 2. embed
    const vec = await embedOne(data.content);
    const { model, dim } = await getEmbedModelInfo();

    // 3. semantic dedup (cosine ≥ 0.95 → bump existing)
    if (vec.length === dim) {
      const candidates = await dbQuery<any[]>(
        `SELECT id, embedding_blob FROM memory_atom WHERE archived = 0 AND embedding_model = ? AND embedding_blob IS NOT NULL ORDER BY created_at DESC LIMIT 200`,
        [model],
      );
      for (const c of candidates) {
        const sim = cosine(vec, blobToVec(c[1]));
        if (sim >= 0.95) {
          await dbExecute(`UPDATE memory_atom SET resonance_score = resonance_score + 0.05 WHERE id = ?`, [c[0]]);
          const dup = await dbQuery<any[]>(
            `SELECT id, content, type, tags, resonance_score, session_id, archived, created_at FROM memory_atom WHERE id = ?`,
            [c[0]],
          );
          if (dup.length) return rowToAtom(dup[0]);
        }
      }
    }

    // 4. insert
    const id = uuid();
    const now = Date.now();
    const blob = vec.length === dim ? vecToBlob(vec) : null;
    await dbExecute(
      `INSERT INTO memory_atom (id, content, type, tags, resonance_score, session_id, archived, embedding_model, embedding_dim, embedding_blob, created_at) VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
      [
        id,
        data.content,
        data.type,
        JSON.stringify(data.tags ?? []),
        data.sessionId ?? '',
        blob ? model : null,
        blob ? dim : null,
        blob,
        now,
      ],
    );

    // 5. throttled cap enforcement
    this.maybeEnforceCap();

    return {
      id,
      content: data.content,
      type: data.type,
      tags: data.tags ?? [],
      resonanceScore: 0,
      sessionId: data.sessionId ?? '',
      archived: false,
      createdAt: now,
    };
  }

  async searchAtoms(query: string, n = 5, typeFilter?: string): Promise<Atom[]> {
    const queryVec = await embedOne(query);
    const { model } = await getEmbedModelInfo();

    // FTS
    let ftsRows: any[][] = [];
    try {
      const ftsType = typeFilter ? `AND a.type = ?` : '';
      const ftsParams: any[] = [query];
      if (typeFilter) ftsParams.push(typeFilter);
      ftsRows = await dbQuery<any[]>(
        `SELECT a.id, a.content, a.type, a.tags, a.resonance_score, a.session_id, a.archived, a.created_at
         FROM memory_atom_fts f JOIN memory_atom a ON a.rowid = f.rowid
         WHERE memory_atom_fts MATCH ? AND a.archived = 0 ${ftsType}
         ORDER BY rank LIMIT 20`,
        ftsParams,
      );
    } catch (e) {
      console.warn('fts atoms failed:', e);
    }

    // ANN (cosine côté JS)
    let annRows: any[][] = [];
    if (queryVec.length) {
      const candType = typeFilter ? `AND type = ?` : '';
      const candParams: any[] = [model];
      if (typeFilter) candParams.push(typeFilter);
      const candidates = await dbQuery<any[]>(
        `SELECT id, content, type, tags, resonance_score, session_id, archived, created_at, embedding_blob
         FROM memory_atom WHERE archived = 0 AND embedding_model = ? AND embedding_blob IS NOT NULL ${candType}
         ORDER BY created_at DESC LIMIT 500`,
        candParams,
      );
      const scored = candidates.map(r => ({ row: r, sim: cosine(queryVec, blobToVec(r[8])) }));
      annRows = scored
        .filter(s => s.sim >= MIN_SIM)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 20)
        .map(s => s.row);
    }

    // RRF fusion
    const RRF_K = 60;
    const scores = new Map<string, number>();
    annRows.forEach((r, i) => scores.set(r[0], (scores.get(r[0]) ?? 0) + 1 / (RRF_K + i + 1)));
    ftsRows.forEach((r, i) => scores.set(r[0], (scores.get(r[0]) ?? 0) + 1 / (RRF_K + i + 1)));

    const allRows = new Map<string, any[]>();
    annRows.forEach(r => allRows.set(r[0], r));
    ftsRows.forEach(r => allRows.set(r[0], r));

    const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
    return ids.map(id => rowToAtom(allRows.get(id)!));
  }

  async recentAtoms(n = 10, sessionId?: string): Promise<Atom[]> {
    const sql = sessionId
      ? `SELECT id, content, type, tags, resonance_score, session_id, archived, created_at FROM memory_atom WHERE archived = 0 AND session_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, content, type, tags, resonance_score, session_id, archived, created_at FROM memory_atom WHERE archived = 0 ORDER BY created_at DESC LIMIT ?`;
    const params = sessionId ? [sessionId, n] : [n];
    const rows = await dbQuery<any[]>(sql, params);
    return rows.map(rowToAtom);
  }

  async archiveAtom(id: string): Promise<void> {
    await dbExecute(`UPDATE memory_atom SET archived = 1 WHERE id = ?`, [id]);
  }

  async bumpResonance(id: string, delta: number): Promise<void> {
    await dbExecute(`UPDATE memory_atom SET resonance_score = resonance_score + ? WHERE id = ?`, [delta, id]);
  }

  async pruneStale(minAgeDays = 30, maxResonance = 0.05): Promise<number> {
    const cutoff = Date.now() - minAgeDays * 86400000;
    return dbExecute(
      `DELETE FROM memory_atom WHERE created_at < ? AND resonance_score < ?`,
      [cutoff, maxResonance],
    );
  }

  async enforceCap(maxAtoms = 5000): Promise<number> {
    const cnt = await dbQuery<any[]>(`SELECT COUNT(*) FROM memory_atom WHERE archived = 0`);
    const total = Number(cnt[0]?.[0] ?? 0);
    if (total <= maxAtoms) return 0;
    const toArchive = total - maxAtoms;
    const victims = await dbQuery<any[]>(
      `SELECT id FROM memory_atom WHERE archived = 0 ORDER BY resonance_score ASC, created_at ASC LIMIT ?`,
      [toArchive],
    );
    if (!victims.length) return 0;
    const placeholders = victims.map(() => '?').join(',');
    await dbExecute(
      `UPDATE memory_atom SET archived = 1 WHERE id IN (${placeholders})`,
      victims.map(v => v[0]),
    );
    return victims.length;
  }

  private capCheckCounter = 0;
  private maybeEnforceCap() {
    this.capCheckCounter++;
    if (this.capCheckCounter >= 50) {
      this.capCheckCounter = 0;
      this.enforceCap().catch(e => console.warn('enforceCap:', e));
    }
  }

  // ── Dreams ─────────────────────────────────────────────

  async addDream(data: { content: string; sourceAtomIds?: string[] }): Promise<Dream> {
    const id = uuid();
    const vec = await embedOne(data.content);
    const { model, dim } = await getEmbedModelInfo();
    const blob = vec.length === dim ? vecToBlob(vec) : null;
    const now = Date.now();
    await dbExecute(
      `INSERT INTO memory_dream (id, content, source_atom_ids, resonance_score, validated, embedding_model, embedding_dim, embedding_blob, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      [
        id,
        data.content,
        JSON.stringify(data.sourceAtomIds ?? []),
        blob ? model : null,
        blob ? dim : null,
        blob,
        now,
      ],
    );
    return {
      id,
      content: data.content,
      sourceAtomIds: data.sourceAtomIds ?? [],
      resonanceScore: 0,
      validated: false,
      createdAt: now,
    };
  }

  async searchDreams(query: string, n = 5): Promise<Dream[]> {
    const queryVec = await embedOne(query);
    const { model } = await getEmbedModelInfo();
    if (!queryVec.length) {
      const rows = await dbQuery<any[]>(
        `SELECT id, content, source_atom_ids, resonance_score, validated, created_at FROM memory_dream ORDER BY created_at DESC LIMIT ?`,
        [n],
      );
      return rows.map(r => ({
        id: r[0],
        content: r[1],
        sourceAtomIds: JSON.parse(r[2] || '[]'),
        resonanceScore: Number(r[3] ?? 0),
        validated: !!r[4],
        createdAt: Number(r[5] ?? 0),
      }));
    }
    const candidates = await dbQuery<any[]>(
      `SELECT id, content, source_atom_ids, resonance_score, validated, created_at, embedding_blob FROM memory_dream WHERE embedding_model = ? AND embedding_blob IS NOT NULL ORDER BY created_at DESC LIMIT 500`,
      [model],
    );
    const scored = candidates.map(r => ({ r, sim: cosine(queryVec, blobToVec(r[6])) }));
    return scored
      .filter(s => s.sim >= MIN_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, n)
      .map(s => ({
        id: s.r[0],
        content: s.r[1],
        sourceAtomIds: JSON.parse(s.r[2] || '[]'),
        resonanceScore: Number(s.r[3] ?? 0),
        validated: !!s.r[4],
        createdAt: Number(s.r[5] ?? 0),
      }));
  }

  // ── User profile / master model ────────────────────────

  async loadProfile(): Promise<any> {
    const r = await dbQuery<any[]>(`SELECT data FROM user_profile WHERE key = 'master' LIMIT 1`);
    if (!r.length) return { identite: {}, projets: {}, relation: { confiance: 0.5, nb_sessions: 0 } };
    try {
      return JSON.parse(r[0][0]);
    } catch {
      return {};
    }
  }

  async saveProfile(profile: any): Promise<void> {
    profile.updated_at = Date.now() / 1000;
    const json = JSON.stringify(profile);
    await dbExecute(
      `INSERT INTO user_profile (key, data, updated_at) VALUES ('master', ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [json, Date.now()],
    );
  }

  snapshotProfile(p: any): string {
    const id = p?.identite ?? {};
    const proj = p?.projets ?? {};
    const rel = p?.relation ?? {};
    const lines = [
      '=== Profil utilisateur ===',
      id.style_code ? `Style code: ${id.style_code}` : '',
      id.style_visuel_prefere ? `Style visuel: ${id.style_visuel_prefere}` : '',
      id.frustrations?.length ? `Frustrations: ${id.frustrations.join(', ')}` : '',
      proj.actifs?.length ? `Projets actifs: ${proj.actifs.join(', ')}` : '',
      rel.confiance != null ? `Confiance: ${rel.confiance} | Sessions: ${rel.nb_sessions ?? 0}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  // ── RAG context ─────────────────────────────────────────

  async buildRagContext(query: string, n = 5): Promise<string> {
    const [atoms, dreams, profile] = await Promise.all([
      this.searchAtoms(query, n).catch(e => {
        console.warn('searchAtoms failed:', e);
        return [] as Atom[];
      }),
      this.searchDreams(query, 2).catch(e => {
        console.warn('searchDreams failed:', e);
        return [] as Dream[];
      }),
      this.loadProfile().catch(() => null),
    ]);
    const sections: string[] = [];
    if (profile) {
      const snap = this.snapshotProfile(profile);
      if (snap.split('\n').length > 1) sections.push(snap);
    }
    if (atoms.length) sections.push(`Mémoire pertinente:\n${atoms.map(a => `[${a.type}] ${a.content}`).join('\n')}`);
    if (dreams.length) sections.push(`Réflexions stockées:\n${dreams.map(d => `[reve] ${d.content}`).join('\n')}`);
    return sections.join('\n\n');
  }

  // ── Chunking ────────────────────────────────────────────

  private splitIntoChunks(text: string, maxChars = 1000): string[] {
    if (text.length <= maxChars) return [text];
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let cur = '';
    for (const s of sentences) {
      if (cur.length + s.length + 1 > maxChars && cur.length > 0) {
        chunks.push(cur.trim());
        cur = s;
      } else {
        cur += (cur ? ' ' : '') + s;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }
}

export const memoryService = new MemoryService();
