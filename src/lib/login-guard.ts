const FAILURE_LIMIT = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

type FailureRecord = { count: number; lockedUntil: number | null; windowStart: number };

const failures = new Map<string, FailureRecord>();

function key(ip: string, email: string): string {
  return `${ip}:${email}`;
}

/**
 * 見 SPEC.md §10.1：登入失敗 5 次鎖定 15 分鐘（以 IP + email 計數）。
 * 跟 rate-limit.ts 一樣是單一 process 記憶體內實作，同樣的多副本限制。
 */
export function isLockedOut(ip: string, email: string): boolean {
  const record = failures.get(key(ip, email));
  if (!record?.lockedUntil) return false;
  if (record.lockedUntil <= Date.now()) {
    failures.delete(key(ip, email));
    return false;
  }
  return true;
}

export function recordLoginFailure(ip: string, email: string): void {
  const k = key(ip, email);
  const now = Date.now();
  const record = failures.get(k);

  if (!record || record.windowStart + LOCKOUT_WINDOW_MS <= now) {
    failures.set(k, { count: 1, lockedUntil: null, windowStart: now });
    return;
  }

  record.count += 1;
  if (record.count >= FAILURE_LIMIT) {
    record.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }
}

export function clearLoginFailures(ip: string, email: string): void {
  failures.delete(key(ip, email));
}
