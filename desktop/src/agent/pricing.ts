export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostCents(
  promptText: string,
  model: { inputCostPer1MTokensCents?: number; outputCostPer1MTokensCents?: number } | null | undefined,
  expectedOutputTokens: number = 500
): number {
  if (!model) return 0;

  const inputPrice = model.inputCostPer1MTokensCents ?? 0;
  const outputPrice = model.outputCostPer1MTokensCents ?? 0;

  if (inputPrice === 0 && outputPrice === 0) return 0;

  const inTokens = estimateTokens(promptText);
  const outTokens = expectedOutputTokens;

  return (inTokens * inputPrice + outTokens * outputPrice) / 1_000_000;
}

export function formatCostBadge(cents: number): string {
  if (cents <= 0) return '—';
  if (cents < 0.1) return '<0.1¢';
  if (cents < 1) return `${cents.toFixed(2)}¢`;
  if (cents < 100) return `${cents.toFixed(1)}¢`;
  return `${(cents / 100).toFixed(2)}€`;
}
