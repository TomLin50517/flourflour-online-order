type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let callCount = 0;

/**
 * 見 SPEC.md §12.1：極簡記憶體內固定視窗限流器。
 * 只在單一 process 內有效；多副本部署需要共用儲存（如 Redis），
 * 待部署拓樸底定後再處理（見 docs/OPEN-QUESTIONS.md）。
 *
 * @returns true 表示本次請求在額度內、放行；false 表示應拒絕。
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  callCount += 1;
  if (callCount % 1000 === 0) {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) {
    return false;
  }
  bucket.count += 1;
  return true;
}
