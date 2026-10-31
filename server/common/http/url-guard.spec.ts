import { describe, expect, it } from 'vitest';
import { isSafePublicHttpUrl } from './url-guard';

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
