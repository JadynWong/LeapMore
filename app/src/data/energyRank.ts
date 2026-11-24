export function energyRankOf(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
  return match && Number(match[1]) <= 100 ? `${match[1]}%` : null;
}
