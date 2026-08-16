/** 從 `X-Forwarded-For` 取第一個 IP。反向代理（Cloudflare、Nginx…）背後才會有這個標頭。 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
