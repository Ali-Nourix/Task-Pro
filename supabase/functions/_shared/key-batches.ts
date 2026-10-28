/** Bound URL-encoded PostgREST filters by bytes, not just item count. */
export function keyBatches(keys: readonly string[], maxItems = 200, maxEncodedBytes = 4000): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const key of keys) {
    // Count UTF-8 percent encoding and conservatively allow quoting/escaping.
    const cost = encodeURIComponent(key.replace(/[\\"]/g, '\\$&')).length + 16;
    if (batch.length && (batch.length >= maxItems || bytes + cost > maxEncodedBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(key);
    bytes += cost;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
