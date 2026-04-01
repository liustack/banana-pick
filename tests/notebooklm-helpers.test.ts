import { describe, expect, it } from 'vitest';

import {
    extractArtifactIdFromJslog,
    isInfographicMetadata,
    normalizeTitle,
} from '../src/content/adapters/notebooklm.ts';

function toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

describe('notebooklm adapter helpers', () => {
    it('normalizes artifact titles by removing icon labels and collapsing whitespace', () => {
        expect(normalizeTitle('  stacked_bar_chart   Q1   report   more_vert  ')).toBe(
            'Q1 report',
        );
    });

    it('extracts artifact id from jslog payloads and tolerates invalid values', () => {
        const payload = toBase64Url(JSON.stringify([[0, 'artifact-123']]));
        expect(extractArtifactIdFromJslog(`abc;0:${payload};1:xyz`)).toBe('artifact-123');
        expect(extractArtifactIdFromJslog('abc;0:not-valid-base64')).toBe('');
    });

    it('identifies infographic entries from description, icon, or fallback text', () => {
        expect(isInfographicMetadata('A generated infographic', '', '')).toBe(true);
        expect(isInfographicMetadata('', 'stacked_bar_chart', '')).toBe(true);
        expect(isInfographicMetadata('Infographic', '', '')).toBe(true);
        expect(isInfographicMetadata('', '', 'artifact stacked_bar_chart export')).toBe(true);
        expect(isInfographicMetadata('Audio overview', 'description', 'plain text')).toBe(false);
    });
});
