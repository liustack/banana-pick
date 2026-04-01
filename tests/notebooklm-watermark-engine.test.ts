import { describe, expect, it } from 'vitest';

import {
    getNotebookLmFallbackFillRegion,
    getNotebookLmFillRegion,
    removeNotebookLmWatermarkFromImageData,
    type NotebookLmMutableImageData,
} from '../src/core/notebooklmWatermarkEngine.ts';

interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a?: number;
}

function createImageData(width: number, height: number, color: RgbaColor): NotebookLmMutableImageData {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
        data[i] = color.r;
        data[i + 1] = color.g;
        data[i + 2] = color.b;
        data[i + 3] = color.a ?? 255;
    }

    return { data, width, height };
}

function fillRect(
    imageData: NotebookLmMutableImageData,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RgbaColor,
): void {
    for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
            const offset = (y * imageData.width + x) * 4;
            imageData.data[offset] = color.r;
            imageData.data[offset + 1] = color.g;
            imageData.data[offset + 2] = color.b;
            imageData.data[offset + 3] = color.a ?? 255;
        }
    }
}

function fillHorizontalGradient(
    imageData: NotebookLmMutableImageData,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    left: RgbaColor,
    right: RgbaColor,
): void {
    const width = Math.max(1, x2 - x1 - 1);

    for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
            const t = (x - x1) / width;
            const offset = (y * imageData.width + x) * 4;
            imageData.data[offset] = Math.round(left.r * (1 - t) + right.r * t);
            imageData.data[offset + 1] = Math.round(left.g * (1 - t) + right.g * t);
            imageData.data[offset + 2] = Math.round(left.b * (1 - t) + right.b * t);
            imageData.data[offset + 3] = 255;
        }
    }
}

function readPixel(imageData: NotebookLmMutableImageData, x: number, y: number): RgbaColor {
    const offset = (y * imageData.width + x) * 4;
    return {
        r: imageData.data[offset],
        g: imageData.data[offset + 1],
        b: imageData.data[offset + 2],
        a: imageData.data[offset + 3],
    };
}

describe('NotebookLM watermark engine', () => {
    it('uses the same watermark box size for landscape and portrait 2752x1536 exports', () => {
        const landscape = getNotebookLmFillRegion(2752, 1536);
        const portrait = getNotebookLmFillRegion(1536, 2752);
        const landscapeFallback = getNotebookLmFallbackFillRegion(2752, 1536);
        const portraitFallback = getNotebookLmFallbackFillRegion(1536, 2752);

        expect(landscape.x2 - landscape.x1).toBe(230);
        expect(landscape.y2 - landscape.y1).toBe(60);
        expect(portrait.x2 - portrait.x1).toBe(230);
        expect(portrait.y2 - portrait.y1).toBe(60);
        expect(portrait.x1).toBe(1296);
        expect(portrait.y1).toBe(2682);
        expect(landscapeFallback.x2 - landscapeFallback.x1).toBe(207);
        expect(landscapeFallback.y2 - landscapeFallback.y1).toBe(38);
        expect(landscapeFallback.x1).toBe(2535);
        expect(landscapeFallback.y1).toBe(1488);
        expect(portraitFallback.x2 - portraitFallback.x1).toBe(230);
        expect(portraitFallback.y2 - portraitFallback.y1).toBe(36);
    });

    it('uses the clean bottom gradient instead of painting a white block in landscape exports', () => {
        const imageData = createImageData(2752, 1536, { r: 250, g: 244, b: 234 });
        const region = getNotebookLmFillRegion(imageData.width, imageData.height);

        fillHorizontalGradient(
            imageData,
            0,
            region.y1,
            imageData.width,
            imageData.height,
            { r: 248, g: 243, b: 235 },
            { r: 248, g: 196, b: 132 },
        );

        fillRect(
            imageData,
            region.x1 + 6,
            region.y1 + 4,
            region.x2 - 6,
            region.y1 + 14,
            { r: 82, g: 122, b: 176 },
        );

        fillRect(
            imageData,
            region.x1 - 190,
            region.y1 - 96,
            region.x1 + 48,
            region.y1 - 2,
            { r: 244, g: 241, b: 238 },
        );

        fillRect(
            imageData,
            region.x1 + 12,
            region.y1 + 10,
            region.x2 - 16,
            region.y2 - 10,
            { r: 10, g: 10, b: 10 },
        );

        removeNotebookLmWatermarkFromImageData(imageData);

        const topPixel = readPixel(imageData, region.x1 + 28, region.y1 + 8);
        const leftPixel = readPixel(imageData, region.x1 + 10, region.y1 + 24);
        const rightPixel = readPixel(imageData, region.x2 - 20, region.y1 + 24);

        expect(topPixel.r).toBeLessThan(120);
        expect(topPixel.g).toBeGreaterThan(100);
        expect(topPixel.b).toBeGreaterThan(150);
        expect(leftPixel.r).toBeGreaterThan(200);
        expect(leftPixel.g).toBeGreaterThan(180);
        expect(leftPixel.b).toBeLessThan(220);
        expect(Math.abs(rightPixel.b - leftPixel.b)).toBeGreaterThan(4);
    });

    it('covers the full left side of the watermark region for portrait exports', () => {
        const imageData = createImageData(1536, 2752, { r: 24, g: 27, b: 33 });
        const region = getNotebookLmFillRegion(imageData.width, imageData.height);

        fillRect(
            imageData,
            region.x1 + 8,
            region.y1 + 4,
            region.x2 - 12,
            region.y1 + 14,
            { r: 108, g: 186, b: 168 },
        );

        fillRect(imageData, 1308, 2692, 1488, 2736, { r: 245, g: 245, b: 245 });

        removeNotebookLmWatermarkFromImageData(imageData);

        const topPixel = readPixel(imageData, region.x1 + 20, region.y1 + 8);
        const pixel = readPixel(imageData, 1328, 2712);
        expect(topPixel.r).toBeLessThan(150);
        expect(topPixel.g).toBeGreaterThan(150);
        expect(topPixel.b).toBeGreaterThan(130);
        expect(pixel.r).toBeLessThan(80);
        expect(pixel.g).toBeLessThan(80);
        expect(pixel.b).toBeLessThan(90);
    });
});
