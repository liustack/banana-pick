import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { createNotebookLmAdapter } from '../src/content/adapters/notebooklm.ts';

const GLOBAL_KEYS = [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'Node',
    'atob',
    'btoa',
] as const;

type GlobalKey = (typeof GLOBAL_KEYS)[number];

const originalGlobals = new Map<GlobalKey, unknown>(
    GLOBAL_KEYS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
);

function toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function installDom(html: string): void {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { window } = dom;
    const globals = globalThis as Record<string, unknown>;

    globals.window = window;
    globals.document = window.document;
    globals.HTMLElement = window.HTMLElement;
    globals.HTMLButtonElement = window.HTMLButtonElement;
    globals.Node = window.Node;
    globals.atob = window.atob.bind(window);
    globals.btoa = window.btoa.bind(window);

    if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText')) {
        Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get() {
                return this.textContent ?? '';
            },
            set(value: string) {
                this.textContent = value;
            },
        });
    }
}

function restoreGlobals(): void {
    const globals = globalThis as Record<string, unknown>;

    for (const key of GLOBAL_KEYS) {
        const originalValue = originalGlobals.get(key);
        if (typeof originalValue === 'undefined') {
            delete globals[key];
            continue;
        }

        globals[key] = originalValue;
    }
}

function buildArtifactItem(options: {
    artifactId: string;
    titleMarkup: string;
    description: string;
    iconText?: string;
}): string {
    const jslogPayload = toBase64Url(JSON.stringify([['notebook-1', options.artifactId]]));
    const labelsId = `artifact-labels-${options.artifactId}`;

    return `
        <artifact-library-item>
            <div class="artifact-item-button">
                <div class="artifact-button-content">
                    <button
                        class="artifact-stretched-button"
                        aria-description="${options.description}"
                        aria-labelledby="${labelsId}"
                        jslog="261224;track:generic_click,impression;0:${jslogPayload};1:metadata"
                    ></button>
                    <div aria-hidden="true" class="artifact-primary-content">
                        <mat-icon class="artifact-icon">${options.iconText ?? ''}</mat-icon>
                        <span class="artifact-labels" id="${labelsId}">
                            ${options.titleMarkup}
                        </span>
                    </div>
                </div>
                <button class="artifact-more-button" aria-label="More">more_vert</button>
            </div>
        </artifact-library-item>
    `;
}

afterEach(() => {
    restoreGlobals();
});

describe('notebooklm adapter scan', () => {
    it('detects redesigned infographic cards and extracts titles via aria-labelledby', () => {
        installDom(`
            ${buildArtifactItem({
                artifactId: 'artifact-1',
                description: 'Infographic',
                iconText: 'stacked_bar_chart',
                titleMarkup: `
                    <div class="title-container">
                        <span class="artifact-title"> 财富自由与幸福底层逻辑 </span>
                    </div>
                    <span class="artifact-details">4 sources · 18d ago</span>
                `,
            })}
            ${buildArtifactItem({
                artifactId: 'artifact-2',
                description: 'Slides',
                iconText: 'slideshow',
                titleMarkup: `
                    <div class="title-container">
                        <span class="artifact-title"> Mastering Wealth and Happiness </span>
                    </div>
                `,
            })}
        `);

        const adapter = createNotebookLmAdapter();
        const images = adapter.scanImages();

        expect(images).toHaveLength(1);
        expect(images[0]).toMatchObject({
            title: '财富自由与幸福底层逻辑',
            selected: true,
            sourceSite: 'notebooklm',
        });
    });

    it('falls back to the first label line when the title element is missing', () => {
        installDom(`
            ${buildArtifactItem({
                artifactId: 'artifact-3',
                description: '信息图',
                titleMarkup: `
                    财富自由个人进化指南
                    4 sources · 34d ago
                `,
            })}
        `);

        const adapter = createNotebookLmAdapter();
        const images = adapter.scanImages();

        expect(images).toHaveLength(1);
        expect(images[0]?.title).toBe('财富自由个人进化指南');
    });
});
