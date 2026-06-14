const MODEL_ID_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['phi-4-mini:3.8b', 'phi-4-mini-instruct', 'phi-4-mini'],
  ['phi-4:14b', 'phi-4'],
  ['qwen3:4b', 'qwen3-4b'],
  ['qwen3:8b', 'qwen3-8b'],
  ['qwen3:14b', 'qwen3-14b'],
  ['qwen3:32b', 'qwen3-32b'],
];

function trimId(id: string): string {
  return (id || '').trim();
}

export function canonicalModelId(id: string): string {
  const value = trimId(id);
  if (!value) return '';
  const group = MODEL_ID_GROUPS.find(entry => entry.includes(value));
  return group ? group[0] : value;
}

export function resolveModelIdAlias(id: string, availableIds: readonly string[]): string {
  const value = trimId(id);
  if (!value) return '';
  if (availableIds.includes(value)) return value;
  const group = MODEL_ID_GROUPS.find(entry => entry.includes(value));
  if (!group) return value;
  const hit = group.find(candidate => availableIds.includes(candidate));
  return hit || group[0];
}
