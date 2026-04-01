import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { createNotebookLmAdapter } from '../src/content/adapters/notebooklm.ts';

const GLOBAL_KEYS = [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLImageElement',
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

function installDom(html: string): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { window } = dom;
    const globals = globalThis as Record<string, unknown>;

    globals.window = window;
    globals.document = window.document;
    globals.HTMLElement = window.HTMLElement;
    globals.HTMLButtonElement = window.HTMLButtonElement;
    globals.HTMLImageElement = window.HTMLImageElement;
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

    if (!window.HTMLElement.prototype.scrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value() {},
        });
    }

    return dom;
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

function buildArtifactItem(artifactId: string, title: string): string {
    const labelsId = `artifact-labels-${artifactId}`;
    const jslogPayload = toBase64Url(JSON.stringify([['notebook-1', artifactId]]));

    return `
        <artifact-library-item>
            <div class="artifact-item-button">
                <div class="artifact-button-content">
                    <button
                        class="artifact-stretched-button"
                        aria-description="Infographic"
                        aria-labelledby="${labelsId}"
                        jslog="261224;track:generic_click,impression;0:${jslogPayload};1:metadata"
                    ></button>
                    <div aria-hidden="true" class="artifact-primary-content">
                        <mat-icon class="artifact-icon">stacked_bar_chart</mat-icon>
                        <span class="artifact-labels" id="${labelsId}">
                            <div class="title-container">
                                <span class="artifact-title">${title}</span>
                            </div>
                            <span class="artifact-details">4 sources · 18d ago</span>
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

describe('notebooklm adapter download', () => {
    it('captures the viewer image url and downloads it directly instead of native download interception', async () => {
        const dom = installDom(buildArtifactItem('artifact-1', '财富自由与幸福底层逻辑'));
        const { document } = dom.window;
        const artifactButton = document.querySelector<HTMLButtonElement>('button.artifact-stretched-button');
        expect(artifactButton).toBeTruthy();

        const originalClick = dom.window.HTMLButtonElement.prototype.click;
        dom.window.HTMLButtonElement.prototype.click = function clickPatched(this: HTMLButtonElement) {
            if (this === artifactButton) {
                if (!document.querySelector('dialog')) {
                    const dialog = document.createElement('dialog');
                    dialog.setAttribute('open', '');

                    const closeButton = document.createElement('button');
                    closeButton.setAttribute('aria-label', 'Close');
                    closeButton.addEventListener('click', () => dialog.remove());

                    const img = document.createElement('img');
                    img.src =
                        'https://lh3.googleusercontent.com/notebooklm/example=s0-w2752-h1536-d-mp2?authuser=0';

                    dialog.append(closeButton, img);
                    document.body.appendChild(dialog);
                }
                return;
            }

            originalClick.call(this);
        };

        const adapter = createNotebookLmAdapter();
        const [image] = adapter.scanImages();
        const downloadFromUrl = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
        const prepareNativeDownloadCapture = vi
            .fn<(...args: unknown[]) => Promise<string>>()
            .mockRejectedValue(new Error('不应走原生下载拦截'));

        await expect(
            adapter.downloadImage(image, 'notebooklm/test.png', {
                setSuppressDownload: vi.fn(),
                downloadFromDataUrl: vi.fn(),
                downloadFromUrl,
                prepareNativeDownloadCapture,
                waitForNativeDownloadCapture: vi.fn(),
                cancelNativeDownloadCapture: vi.fn(),
            }),
        ).resolves.toBeUndefined();

        expect(prepareNativeDownloadCapture).not.toHaveBeenCalled();
        expect(downloadFromUrl).toHaveBeenCalledWith(
            'https://lh3.googleusercontent.com/notebooklm/example=s0-w2752-h1536-d-mp2?authuser=0',
            'notebooklm/test.png',
            { watermarkMode: 'notebooklm' },
        );
    });
});
