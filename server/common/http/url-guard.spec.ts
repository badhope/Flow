import { describe, expect, it } from 'vitest';
import { lookup } from 'node:dns';
import { createPublicLookup, isSafePublicHttpUrl } from './url-guard';

describe('url-guard R9: 出站 URL 防 SSRF', () => {
  it('R9: 合法公网 https 地址放行', () => {
    expect(isSafePublicHttpUrl('https://open.feishu.cn/open-apis/bot/v2/hook/xxx')).toBe(true);
    expect(isSafePublicHttpUrl('https://api.deepseek.com')).toBe(true);
    expect(isSafePublicHttpUrl('http://hooks.slack.com/services/x/y/z')).toBe(true);
  });

  it('R9: 环回地址拒绝', () => {
    expect(isSafePublicHttpUrl('http://127.0.0.1:4880/stripe')).toBe(false);
    expect(isSafePublicHttpUrl('http://localhost/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://[::1]/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://[::ffff:7f00:1]/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://[::ffff:10.0.0.1]/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://0.0.0.0/hook')).toBe(false);
  });

  it('R9: 私网段拒绝（10/8、172.16/12、192.168/16）', () => {
    expect(isSafePublicHttpUrl('http://10.0.0.5/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://172.16.1.1/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://172.31.255.255/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://192.168.1.1/hook')).toBe(false);
  });

  it('R9: 云元数据与链路本地地址拒绝', () => {
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafePublicHttpUrl('http://100.100.100.200/metadata')).toBe(false);
    expect(isSafePublicHttpUrl('http://fe80::1/hook')).toBe(false);
  });

  it('拒绝整个 IPv6 链路本地范围及非全球地址', () => {
    for (const host of ['fe80::1', 'fe90::1', 'fea0::1', 'febf::1', 'fec0::1', 'ff02::1', '::ffff:7f00:1']) {
      expect(isSafePublicHttpUrl(`http://[${host}]/`), host).toBe(false);
    }
    expect(isSafePublicHttpUrl('https://[2606:4700:4700::1111]/')).toBe(true);
  });

  it('DNS 连接只返回已验证地址并拒绝混合私网或解析失败', async () => {
    const resolve = async (addresses: Array<{ address: string; family: number }>, failure?: Error) => {
      const resolver = ((_host: string, _options: unknown, cb: (err: Error | null, entries: typeof addresses) => void) => cb(failure ?? null, addresses)) as typeof lookup;
      return new Promise<{ error: Error | null; address: string }>((done) => {
        createPublicLookup(resolver)('example.com', { family: 0 }, (error, address) => done({ error, address: address as string }));
      });
    };
    expect(await resolve([{ address: '8.8.8.8', family: 4 }])).toEqual({ error: null, address: '8.8.8.8' });
    expect((await resolve([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).error).toBeInstanceOf(Error);
    expect((await resolve([{ address: '0:0:0:0:0:ffff:7f00:1', family: 6 }])).error).toBeInstanceOf(Error);
    expect((await resolve([])).error).toBeInstanceOf(Error);
    expect((await resolve([], new Error('dns failure'))).error?.message).toBe('dns failure');
  });

  it('DNS 返回全部匹配地址并在筛选地址族前检查全部结果', async () => {
    const entries = [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ];
    const resolver = ((_host: string, _options: unknown, cb: (err: Error | null, entries: Array<{ address: string; family: number }>) => void) => cb(null, entries)) as typeof lookup;
    const publicLookup = createPublicLookup(resolver);
    const all = (family: 0 | 4 | 6) => new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      publicLookup('example.com', { all: true, family }, (error, addresses) => error ? reject(error) : resolve(addresses));
    });
    expect(await all(0)).toEqual(entries);
    expect(await all(4)).toEqual(entries.slice(1));
    expect(await all(6)).toEqual(entries.slice(0, 1));
    const selected = await new Promise<string>((resolve, reject) => {
      publicLookup('example.com', { family: 4 }, (error, address) => error ? reject(error) : resolve(address));
    });
    expect(selected).toBe('8.8.8.8');
    const numeric = await new Promise<string>((resolve, reject) => {
      publicLookup('example.com', 4, (error, address) => error ? reject(error) : resolve(address));
    });
    expect(numeric).toBe('8.8.8.8');
    entries.push({ address: '::1', family: 6 });
    await expect(all(4)).rejects.toThrow();
  });

  it('拒绝无匹配地址族的解析结果', async () => {
    const resolver = ((_host: string, _options: unknown, cb: (err: Error | null, entries: Array<{ address: string; family: number }>) => void) => cb(null, [{ address: '8.8.8.8', family: 4 }])) as typeof lookup;
    await expect(new Promise((resolve, reject) => {
      createPublicLookup(resolver)('example.com', { family: 6, all: true }, (error, addresses) => error ? reject(error) : resolve(addresses));
    })).rejects.toThrow();
  });

  it('精确区分 IPv4 边界与特殊 IPv6 地址', () => {
    for (const host of ['192.0.0.1', '192.0.0.255', '192.0.2.1', '[2001:0:1234::1]', '[2001:1ff::1]', '[2001:db8::1]', '[3fff:fff::1]', '[2002::1]', '[64:ff9b::a00:1]']) {
      expect(isSafePublicHttpUrl(`http://${host}/`), host).toBe(false);
    }
    for (const host of ['192.0.1.1', '192.0.255.255', '[2001:200::1]', '[2001:db9::1]', '[3fff:1000::1]', '[2606:4700::1]']) {
      expect(isSafePublicHttpUrl(`http://${host}/`), host).toBe(true);
    }
  });

  it('R9: 非法协议拒绝（file/gopher/无协议）', () => {
    expect(isSafePublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafePublicHttpUrl('gopher://127.0.0.1:70/x')).toBe(false);
    expect(isSafePublicHttpUrl('api.example.com/hook')).toBe(false);
  });

  it('R9: 非法输入 fail-closed', () => {
    expect(isSafePublicHttpUrl('')).toBe(false);
    expect(isSafePublicHttpUrl(undefined)).toBe(false);
    expect(isSafePublicHttpUrl('http://')).toBe(false);
  });

  it('R9: 私网域名形式拒绝（.local / .internal / 裸主机名）', () => {
    expect(isSafePublicHttpUrl('http://intranet.local/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://metadata.internal/hook')).toBe(false);
    expect(isSafePublicHttpUrl('http://myhost/hook')).toBe(false);
  });
});
