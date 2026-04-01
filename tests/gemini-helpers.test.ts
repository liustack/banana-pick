import { describe, expect, it } from 'vitest';

import {
    extractGeminiToken,
    normalizeImageKey,
    toFullSizeUrl,
} from '../src/content/adapters/gemini.ts';

describe('gemini adapter helpers', () => {
    it('normalizes image keys by removing Gemini size suffixes while preserving query', () => {
        expect(
            normalizeImageKey(
                'https://lh3.googleusercontent.com/gg/abc123=s1024-rj?foo=bar#frag',
            ),
        ).toBe('https://lh3.googleusercontent.com/gg/abc123?foo=bar');
    });

    it('extracts the Gemini token from preview and download paths', () => {
        expect(
            extractGeminiToken(
                'https://lh3.googleusercontent.com/rd-gg-dl/AOI_d_token-value=s0-d-I?alr=yes',
            ),
        ).toBe('AOI_d_token-value');

        expect(
            extractGeminiToken('https://lh3.googleusercontent.com/gg/AMW1TP-preview-token=s1024-rj'),
        ).toBe('AMW1TP-preview-token');
    });

    it('rewrites Gemini image URLs to full-size originals without touching unrelated URLs', () => {
        expect(
            toFullSizeUrl('https://lh3.googleusercontent.com/gg/abc123=s1024-rj?foo=bar'),
        ).toBe('https://lh3.googleusercontent.com/gg/abc123=s0?foo=bar');

        expect(toFullSizeUrl('https://example.com/image.png?foo=bar')).toBe(
            'https://example.com/image.png?foo=bar',
        );
    });
});
