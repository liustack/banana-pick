import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const rules = JSON.parse(await readFile(new URL('../public/rules.json', import.meta.url), 'utf8'));
const requiredHosts = [
  'https://lh3.googleusercontent.com/*',
  'https://lh3.google.com/*',
];
const requiredUrlFilters = ['||lh3.googleusercontent.com', '||lh3.google.com'];

describe('Gemini 下载链路配置', () => {
  it('覆盖所有必需的下载域名 host_permissions', () => {
    for (const host of requiredHosts) {
      expect(manifest.host_permissions).toContain(host);
    }
  });

  it('保留主世界抓取所需的 DNR CORS 规则', () => {
    expect(manifest.permissions ?? []).toContain('declarativeNetRequestWithHostAccess');
    expect(manifest.declarative_net_request).toBeTruthy();

    for (const filter of requiredUrlFilters) {
      const rule = rules.find((entry) => entry.condition?.urlFilter === filter);
      expect(rule, `${filter} 应存在对应规则`).toBeTruthy();
      expect(rule.action.responseHeaders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            header: 'Access-Control-Allow-Origin',
            value: 'https://gemini.google.com',
          }),
          expect.objectContaining({
            header: 'Access-Control-Allow-Credentials',
            value: 'true',
          }),
        ]),
      );
    }
  });
});
