import { lookup } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

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
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;               // 0/8、10/8、127/8
  if (a === 169 && b === 254) return true;                          // 链路本地 + 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;                 // 172.16/12
  if (a === 192 && b === 168) return true;                          // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT（含阿里云元数据 100.100.100.200）
  if (a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;                                        // 组播 / 保留段
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const input = host.replace(/^\[|\]$/g, '');
  let h: string;
  try {
    h = new URL(`http://[${input}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return true;
  }
  if (h === '::' || h === '::1') return true;                       // 未指定 / 环回
  const first = Number.parseInt(h.split(':')[0] || '0', 16);
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00) return true;
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped：同时支持点分形式与十六进制形式（如 ::ffff:7f00:1）。
    const mapped = h.slice(7);
    if (mapped.includes('.')) return isBlockedIpv4(mapped);
    const groups = mapped.split(':');
    if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      const packed = Number.parseInt(groups[0], 16) * 0x10000 + Number.parseInt(groups[1], 16);
      const v4 = `${packed >>> 24}.${(packed >>> 16) & 255}.${(packed >>> 8) & 255}.${packed & 255}`;
      return isBlockedIpv4(v4);
    }
  }
  const second = Number.parseInt(h.split(':')[1] || '0', 16);
  return (first & 0xe000) !== 0x2000
    || first === 0x2002
    || (first === 0x2001 && (second < 0x200 || second === 0xdb8))
    || (first === 0x3fff && second < 0x1000);
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
export function enforcePublicOutbound(): boolean {
  return process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';
}

export function isSafePublicIp(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !isBlockedIpv4(address) : family === 6 ? !isBlockedIpv6(address) : false;
}

export function createPublicLookup(resolver: typeof lookup = lookup): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error || addresses.length === 0 || addresses.some(({ address, family }) => isIP(address) !== family || !isSafePublicIp(address))) {
        callback(error || new Error('Outbound DNS resolution rejected'), '', 4);
        return;
      }
      const family = typeof options === 'number' ? options : options.family;
      const matching = family ? addresses.filter((address) => address.family === family) : addresses;
      if (matching.length === 0) {
        callback(new Error('Outbound DNS resolution has no matching address family'), '', 4);
      } else if (typeof options === 'object' && options.all) {
        callback(null, matching);
      } else {
        callback(null, matching[0].address, matching[0].family);
      }
    });
  };
}

export function publicOutboundAgents(): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  const lookup = createPublicLookup();
  return { httpAgent: new HttpAgent({ lookup }), httpsAgent: new HttpsAgent({ lookup }) };
}

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
