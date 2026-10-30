/**
 * 出站 URL 防 SSRF 校验（同步、零依赖，解析前即可拒绝）。
 * 覆盖：环回 / 私网段 / 链路本地 / 云元数据 / ULA / 非法协议 / 内网域名后缀 / 裸主机名。
 *
 * 注意：这是「入口校验」而非完整 DNS 解析级防护——攻击者用解析到内网的公网域名
 * （DNS rebinding）可绕过本检查；对高安全场景应在 fetch 层加自定义 lookup 钉住解析结果。
 * 本项目出站目标为用户配置的 webhook / LLM 端点，入口校验 + 文档标注为当前规模的合理防线。
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

const BLOCKED_DOMAIN_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.localdomain',
  '.lan',
  '.home.arpa',
];

function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => p === '' || p.length > 3)) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;               // 0/8、10/8、127/8
  if (a === 169 && b === 254) return true;                          // 链路本地 + 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;                 // 172.16/12
  if (a === 192 && b === 168) return true;                          // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT（含阿里云元数据 100.100.100.200）
  if (a >= 224) return true;                                        // 组播 / 保留段
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;                       // 未指定 / 环回
  if (h.startsWith('fe80')) return true;                            // 链路本地
  if (h.startsWith('fc') || h.startsWith('fd')) return true;        // ULA fc00::/7
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped：取出内嵌 IPv4 再判
    const v4 = h.slice(7);
    if (v4.includes('.')) return isBlockedIpv4(v4);
  }
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_DOMAIN_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // 裸主机名（无点且非 IPv4/IPv6 字面量）→ 内网机器名，拒绝
  const looksLikeIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!host.includes(':') && !host.includes('.') && !looksLikeIpv4) return true;
  if (looksLikeIpv4) return isBlockedIpv4(host);
  if (host.includes(':') || host.startsWith('[')) return isBlockedIpv6(host);
  return false;
}

/**
 * 校验 URL 是否为「公网可达的 http(s) 地址」。
 * 任何解析失败、协议不符、主机落在保留段的情况一律返回 false（fail-closed）。
 */
export function isSafePublicHttpUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isBlockedHost(parsed.hostname);
}
