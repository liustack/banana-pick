import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const interceptorSource = await readFile(
  new URL('../public/download-interceptor.js', import.meta.url),
  'utf8',
);

describe('Gemini interceptor source', () => {
  it('keeps fetch interception as the primary capture path', () => {
    expect(interceptorSource).toContain('window.fetch = async function ()');
  });

  it('does not keep the extra XHR manual follow-chain that triggers CORS noise', () => {
    expect(interceptorSource).toContain('XMLHttpRequest.prototype.open');
    expect(interceptorSource).not.toContain('captureFromDownloadChain(');
    expect(interceptorSource).not.toContain("fetch(downloadUrl");
  });
});
