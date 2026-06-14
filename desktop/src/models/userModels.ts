// User-loaded models: GGUF / safetensors / whisper.cpp .bin files the user
// dropped in from their own disk. Stored as JSON in localStorage; the actual
// file stays where the user put it (absolute path), we never copy it.
//
// Family is auto-detected from the filename so the picker can group it under
// Phi / Llama / Qwen when the heuristic hits. Otherwise it lands in 'custom'.

import type { Modality, Family } from './catalog';

const STORAGE_KEY = 'userModels';

export interface UserModel {
  id: string;          // 'user:<hex>'
  displayName: string;
  modality: Modality;
  family: Family;
  absolutePath: string;
  sizeBytes: number;
  addedAt: number;
}

export function loadUserModels(): UserModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isUserModel) : [];
  } catch {
    return [];
  }
}

export function saveUserModels(models: UserModel[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}

export function addUserModel(model: UserModel): UserModel[] {
  const all = loadUserModels();
  const next = [...all.filter(m => m.id !== model.id), model];
  saveUserModels(next);
  return next;
}

export function removeUserModel(id: string): UserModel[] {
  const all = loadUserModels().filter(m => m.id !== id);
  saveUserModels(all);
  return all;
}

export function findUserModel(id: string): UserModel | undefined {
  return loadUserModels().find(m => m.id === id);
}

export function userModelsByModality(modality: Modality): UserModel[] {
  return loadUserModels().filter(m => m.modality === modality);
}

export function detectFamily(filename: string): Family {
  const f = filename.toLowerCase();
  if (f.includes('phi')) return 'phi';
  if (f.includes('llama')) return 'llama';
  if (f.includes('qwen')) return 'qwen';
  if (f.includes('mistral') || f.includes('ministral')) return 'mistral';
  if (f.includes('whisper')) return 'whisper';
  if (f.includes('flux') || f.includes('stable-diffusion') || f.startsWith('sd-')) return 'flux';
  return 'custom';
}

export function makeUserModelId(absolutePath: string): string {
  let h = 5381;
  for (let i = 0; i < absolutePath.length; i++) {
    h = ((h << 5) + h + absolutePath.charCodeAt(i)) | 0;
  }
  return `user:${(h >>> 0).toString(36)}`;
}

export function basenameStem(absolutePath: string): string {
  const base = absolutePath.split(/[\\/]/).pop() || absolutePath;
  return base.replace(/\.(gguf|bin|safetensors)$/i, '');
}

function isUserModel(v: any): v is UserModel {
  return v
    && typeof v.id === 'string' && v.id.startsWith('user:')
    && typeof v.displayName === 'string'
    && typeof v.modality === 'string'
    && typeof v.family === 'string'
    && typeof v.absolutePath === 'string'
    && typeof v.sizeBytes === 'number'
    && typeof v.addedAt === 'number';
}
