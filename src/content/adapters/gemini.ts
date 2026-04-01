import type { ImageInfo } from '../../types';
import type { DownloadDispatcher, SiteAdapter } from './types';
import { getScrollableContainers, preloadLazyContent, sleep } from './viewport';

const SIZE_SUFFIX_PATTERN = /=s\d+[^?#]*/i;
const GOOGLE_USER_CONTENT_PATTERN = /googleusercontent\.com/i;
const GEMINI_PATH_PATTERN = /\/(rd-gg(?:-dl)?|gg(?:-dl)?|aip-dl)\//i;
const MIN_IMAGE_EDGE = 120;
const PANEL_HOST_ID = 'gbd-panel-host';
const DOWNLOAD_BUTTON_LABELS = [
    'Download full size image',
    '下载完整尺寸图片',
    '下载全尺寸图片',
    '下载图片',
];
const IMAGE_CONTAINER_SELECTOR = 'button.image-button, .overlay-container';
const DOWNLOAD_BUTTON_SELECTOR = 'button[data-test-id="download-generated-image-button"]';

let interceptorInjected = false;
let blobBridgeBound = false;

interface PendingCapture {
    resolve: (dataUrl: string) => void;
    timer: number;
}

const pendingCaptures = new Map<string, PendingCapture>();
let captureSequence = 0;

function nextCaptureId(): string {
    captureSequence += 1;
    return `gbd_cap_${Date.now()}_${captureSequence}`;
}

function normalizeImageKey(url: string): string {
    if (!url) {
        return '';
    }

    const withoutHash = url.split('#')[0];
    const [path, query = ''] = withoutHash.split('?');
    const normalizedPath = path.replace(SIZE_SUFFIX_PATTERN, '');
    return query ? `${normalizedPath}?${query}` : normalizedPath;
}

function extractGeminiToken(url: string): string {
    const match = url.match(/\/(?:rd-gg(?:-dl)?|gg(?:-dl)?|aip-dl)\/([^=?/#]+)/i);
    return match?.[1] ?? '';
}

function injectInterceptor(): void {
    if (interceptorInjected) {
        return;
    }

    interceptorInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('download-interceptor.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
}

function ensureBlobBridge(): void {
    injectInterceptor();

    if (blobBridgeBound) {
        return;
    }

    blobBridgeBound = true;
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.type !== 'GBD_IMAGE_CAPTURED') {
            return;
        }

        const dataUrl = event.data.dataUrl;
        if (typeof dataUrl !== 'string') {
            return;
        }

        const captureId =
            typeof event.data.captureId === 'string' ? event.data.captureId : '';

        if (captureId) {
            const pending = pendingCaptures.get(captureId);
            if (!pending) {
                return;
            }

            window.clearTimeout(pending.timer);
            pendingCaptures.delete(captureId);
            pending.resolve(dataUrl);
            return;
        }

        // Fallback for unexpected old interceptor payloads without captureId.
        if (pendingCaptures.size === 1) {
            const [id, pending] = Array.from(pendingCaptures.entries())[0];
            window.clearTimeout(pending.timer);
            pendingCaptures.delete(id);
            pending.resolve(dataUrl);
        }
    });
}

function notifyCaptureExpect(captureId: string): void {
    window.postMessage({ type: 'GBD_CAPTURE_EXPECT', captureId }, '*');
}

function notifyCaptureCancel(captureId: string): void {
    window.postMessage({ type: 'GBD_CAPTURE_CANCEL', captureId }, '*');
}

function clearPendingCaptures(): void {
    for (const [captureId, pending] of pendingCaptures.entries()) {
        window.clearTimeout(pending.timer);
        notifyCaptureCancel(captureId);
    }
    pendingCaptures.clear();
}

function rewriteSizeToken(url: string, target: string): string {
    if (SIZE_SUFFIX_PATTERN.test(url)) {
        return url.replace(SIZE_SUFFIX_PATTERN, target);
    }

    if (!GOOGLE_USER_CONTENT_PATTERN.test(url)) {
        return url;
    }

    if (!GEMINI_PATH_PATTERN.test(url)) {
        return url;
    }

    const queryOrHashIndex = url.search(/[?#]/);
    if (queryOrHashIndex === -1) {
        return `${url}${target}`;
    }

    return `${url.slice(0, queryOrHashIndex)}${target}${url.slice(queryOrHashIndex)}`;
}

function toFullSizeUrl(url: string): string {
    return rewriteSizeToken(url, '=s0');
}

function getVisualEdge(img: HTMLImageElement): number {
    const rect = img.getBoundingClientRect();
    return Math.max(img.naturalWidth, img.naturalHeight, rect.width, rect.height);
}

function hasNearbyDownloadButton(img: HTMLImageElement): boolean {
    const container = img.closest('figure, div, article, button');
    if (!container) {
        return false;
    }

    return DOWNLOAD_BUTTON_LABELS.some((label) =>
        container.querySelector(`button[aria-label*="${label}"]`) !== null,
    );
}

function isLikelyGeminiImage(img: HTMLImageElement, url: string): boolean {
    if (!url || url.startsWith('data:')) {
        return false;
    }

    if (img.closest('user-query-file-preview, user-query-file-carousel')) {
        return false;
    }

    const hasImageContainer = img.closest(IMAGE_CONTAINER_SELECTOR) !== null;
    const nearbyDownloadButton = hasNearbyDownloadButton(img);

    if (url.startsWith('blob:')) {
        return hasImageContainer || nearbyDownloadButton;
    }

    if (hasImageContainer) {
        return true;
    }

    if (GEMINI_PATH_PATTERN.test(url)) {
        return true;
    }

    const hasGoogleContentHost = GOOGLE_USER_CONTENT_PATTERN.test(url);
    if (!hasGoogleContentHost && !nearbyDownloadButton) {
        return false;
    }

    if (nearbyDownloadButton) {
        return true;
    }

    return getVisualEdge(img) >= MIN_IMAGE_EDGE;
}

function collectImagesFromRoot(root: Document | ShadowRoot): HTMLImageElement[] {
    const images = Array.from(root.querySelectorAll('img'));
    const ownerDocument = root instanceof Document ? root : root.ownerDocument;
    const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    let currentNode = walker.nextNode();
    while (currentNode) {
        if (currentNode instanceof HTMLElement && currentNode.shadowRoot) {
            if (currentNode.id !== PANEL_HOST_ID) {
                images.push(...collectImagesFromRoot(currentNode.shadowRoot));
            }
        }
        currentNode = walker.nextNode();
    }

    return images;
}

function findImageCandidates(thumbnailUrl: string): HTMLImageElement[] {
    const images = collectImagesFromRoot(document);
    const targetKey = normalizeImageKey(thumbnailUrl);
    const targetToken = extractGeminiToken(thumbnailUrl);

    return images.filter((img) => {
        const currentUrl = img.currentSrc || img.src;
        if (!currentUrl) {
            return false;
        }

        if (currentUrl === thumbnailUrl) {
            return true;
        }

        if (normalizeImageKey(currentUrl) === targetKey) {
            return true;
        }

        const token = extractGeminiToken(currentUrl);
        return !!token && token === targetToken;
    });
}

function findDownloadButton(thumbnailUrl: string): HTMLButtonElement | null {
    const candidates = findImageCandidates(thumbnailUrl);

    for (const img of candidates) {
        const container = img.closest('.overlay-container');
        if (!container) {
            continue;
        }

        const button = container.querySelector<HTMLButtonElement>(DOWNLOAD_BUTTON_SELECTOR);
        if (button) {
            return button;
        }
    }

    return null;
}

async function sweepScrollableContainersForButton(
    thumbnailUrl: string,
): Promise<HTMLButtonElement | null> {
    const containers = getScrollableContainers(3);
    if (containers.length === 0) {
        return null;
    }

    for (const container of containers) {
        const stepPx = Math.max(container.clientHeight * 0.55, 260);
        const maxSteps = Math.min(
            Math.ceil((container.scrollHeight - container.clientHeight) / stepPx) + 2,
            120,
        );

        for (let step = 0; step < maxSteps; step++) {
            const button = findDownloadButton(thumbnailUrl);
            if (button) {
                const overlay = button.closest('.overlay-container');
                if (overlay instanceof HTMLElement) {
                    overlay.scrollIntoView({ block: 'center', inline: 'nearest' });
                    await sleep(120);
                }
                return button;
            }

            if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
                break;
            }

            const nextTop = Math.min(container.scrollTop + stepPx, container.scrollHeight);
            if (nextTop <= container.scrollTop) {
                break;
            }

            container.scrollTo({ top: nextTop, behavior: 'auto' });
            await sleep(180);
        }
    }

    return null;
}

async function findDownloadButtonWithRetry(thumbnailUrl: string): Promise<HTMLButtonElement> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const button = findDownloadButton(thumbnailUrl);
        if (button) {
            const container = button.closest('.overlay-container');
            if (container instanceof HTMLElement) {
                container.scrollIntoView({ block: 'center', inline: 'nearest' });
                await sleep(80);
            }
            return button;
        }

        const sweptButton = await sweepScrollableContainersForButton(thumbnailUrl);
        if (sweptButton) {
            return sweptButton;
        }

        await preloadLazyContent({
            maxContainers: 3,
            maxStepsPerContainer: 120,
            waitMs: 220,
            restoreOriginalPosition: false,
        });
        await sleep(180);
    }

    throw new Error('未找到对应的原生下载按钮');
}

function clickAndWaitForBlob(button: HTMLButtonElement, timeoutMs = 30000): Promise<string> {
    const captureId = nextCaptureId();

    return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            if (pendingCaptures.has(captureId)) {
                pendingCaptures.delete(captureId);
                notifyCaptureCancel(captureId);
            }
            reject(new Error('等待原生下载响应超时'));
        }, timeoutMs);

        pendingCaptures.set(captureId, { resolve, timer });
        notifyCaptureExpect(captureId);

        try {
            button.click();
        } catch (error) {
            window.clearTimeout(timer);
            pendingCaptures.delete(captureId);
            notifyCaptureCancel(captureId);
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

function scanGeminiImages(): ImageInfo[] {
    const allImages = collectImagesFromRoot(document);
    const uniqueImages = new Map<string, { image: Omit<ImageInfo, 'id'>; score: number }>();

    for (const img of allImages) {
        const sourceUrl = img.currentSrc || img.src || '';
        if (!isLikelyGeminiImage(img, sourceUrl)) {
            continue;
        }

        const fullSizeUrl = toFullSizeUrl(sourceUrl);
        const score = getVisualEdge(img);
        const candidate: Omit<ImageInfo, 'id'> = {
            thumbnailUrl: sourceUrl,
            fullSizeUrl,
            selected: true,
            sourceSite: 'gemini',
        };

        const existing = uniqueImages.get(fullSizeUrl);
        if (!existing || score > existing.score) {
            uniqueImages.set(fullSizeUrl, { image: candidate, score });
        }
    }

    return Array.from(uniqueImages.values()).map((entry, index) => ({
        id: index,
        ...entry.image,
    }));
}

export function createGeminiAdapter(): SiteAdapter {
    return {
        site: 'gemini',
        panelTitle: 'Gemini 图片批量下载',
        entityName: 'Gemini 图片',
        defaultPrefix: 'gemini',
        emptyMessage: '当前页面未检测到 Gemini 生成的图片',
        async prepareForScan(): Promise<void> {
            ensureBlobBridge();
            await preloadLazyContent({ maxContainers: 2, maxStepsPerContainer: 100, waitMs: 160 });
        },
        scanImages(): ImageInfo[] {
            return scanGeminiImages();
        },
        async beforeBatchDownload(dispatcher: DownloadDispatcher): Promise<void> {
            ensureBlobBridge();
            clearPendingCaptures();
            await preloadLazyContent({
                maxContainers: 3,
                maxStepsPerContainer: 140,
                waitMs: 200,
                restoreOriginalPosition: false,
            });
            dispatcher.setSuppressDownload(true);
        },
        async downloadImage(
            image: ImageInfo,
            filename: string,
            dispatcher: DownloadDispatcher,
        ): Promise<void> {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const button = await findDownloadButtonWithRetry(image.thumbnailUrl);
                    const dataUrl = await clickAndWaitForBlob(button);
                    await dispatcher.downloadFromDataUrl(dataUrl, filename);
                    return;
                } catch (error) {
                    if (attempt >= 2) {
                        throw error;
                    }

                    await preloadLazyContent({
                        maxContainers: 3,
                        maxStepsPerContainer: 100,
                        waitMs: 200,
                        restoreOriginalPosition: false,
                    });
                    await sleep(140);
                }
            }
        },
        async afterBatchDownload(dispatcher: DownloadDispatcher): Promise<void> {
            clearPendingCaptures();
            dispatcher.setSuppressDownload(false);
        },
    };
}
