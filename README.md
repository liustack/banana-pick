# banana-pick

English documentation. For Chinese users, see [README.zh-CN.md](README.zh-CN.md).

A Chrome extension that adds an in-page batch downloader on:
- `gemini.google.com` (generated image originals + watermark removal)
- `notebooklm.google.com` (Infographic artifacts)

## Notice

This project is published for personal learning purposes only and must not be used for any commercial purposes.

## Features

- In-page Shadow DOM panel (no popup page)
- Site adapter architecture (`Gemini` / `NotebookLM` in separate files)
- Gemini original-image download via native button click + download-RPC interception
- NotebookLM Infographic batch download via artifact viewer image URL capture
- NotebookLM watermark cleanup via local-difference mask + bottom-strip column sampling fallback
- Batch timestamp filenames (`prefix_YYYYMMDD_HHmmss_N.png`)
- Reliability improvements for long pages / lazy loading:
  - Scroll preloading before scan and download
  - Retry with targeted container sweep
  - Capture ID mapping to avoid blob mismatch after timeout
  - Runtime message timeout guard

## Maintenance Guardrails

- Gemini stable path: click the native "Download full size" button, let the main-world interceptor capture the final image response, then let the background worker remove the watermark and save the processed file.
- Do not casually replace the Gemini main flow with display-URL rewriting, manual `gg-dl` / `rd-gg-dl` follow-chain fetches, or background-only signed-URL reconstruction. Those experiments previously caused CORS noise, thumbnail downloads, duplicate native downloads, and watermark regressions.
- The `Gemini XHR capture failed` warning alone is not proof that the main flow is broken. Treat final-image capture and saved-file quality as the source of truth.
- NotebookLM stable path: detect the infographic entry, open the viewer, read the viewer image URL, then let the background worker `fetch(..., { credentials: 'include' })`, clean the NotebookLM watermark, and save the file.
- Do not switch NotebookLM to `More -> Download` or browser-native download interception just to obtain an image URL unless the viewer path is truly unavailable. When NotebookLM changes its UI, update list/viewer selectors first and keep the direct-fetch main flow intact.
- Any NotebookLM watermark change must be validated on both landscape and portrait exports. Fixes based on one orientation often reintroduce white/gray blocks or left-side residue in the other.

## Architecture

### Runtime Layers

| Layer | File | Runtime | Role |
|-------|------|---------|------|
| Interceptor | `public/download-interceptor.js` | Main World | Patches `XMLHttpRequest` and `window.fetch` for Gemini download chain, posts captured image with `captureId` |
| Content Script | `src/content/index.ts` | Isolated World | Shared panel + adapter orchestration |
| Background | `src/background/index.ts` | Service Worker | Download processing, optional watermark removal, native blob-download suppression |

### Site Adapters

| Adapter | File | Download Strategy |
|--------|------|-------------------|
| Gemini | `src/content/adapters/gemini.ts` | Click native download button -> intercept final blob -> send `DOWNLOAD_IMAGE` |
| NotebookLM | `src/content/adapters/notebooklm.ts` | Open infographic artifact -> read viewer image URL -> send `DOWNLOAD_IMAGE_URL` |

## Message Flow

- Action click -> Background -> Content Script: `TOGGLE_PANEL` / `OPEN_PANEL`
- Content Script -> Background:
  - `DOWNLOAD_IMAGE` (dataUrl + filename)
  - `DOWNLOAD_IMAGE_URL` (imageUrl + filename + watermarkMode)
  - `SUPPRESS_DOWNLOADS` (Gemini native blob suppression on/off)
- Main World -> Content Script:
  - `GBD_IMAGE_CAPTURED` (includes `captureId`)
- Content Script -> Main World:
  - `GBD_CAPTURE_EXPECT` / `GBD_CAPTURE_CANCEL`

## Tech Stack

- Chrome Extension Manifest V3
- TypeScript 5.9
- Vite 6.4 + `@crxjs/vite-plugin` 2.3
- pnpm

## Project Structure

```text
src/
  background/index.ts                  # Action click + download processing + suppression
  content/
    index.ts                           # Shared panel + adapter coordinator
    adapters/
      index.ts                         # Host -> adapter routing
      types.ts                         # Adapter contracts
      viewport.ts                      # Lazy-load preloading helpers
      gemini.ts                        # Gemini detection/download logic
      notebooklm.ts                    # NotebookLM infographic logic
  core/
    watermarkEngine.ts                 # Gemini watermark removal
    notebooklmWatermarkEngine.ts       # NotebookLM watermark cleanup
    alphaMap.ts
    blendModes.ts
  types.ts                             # Shared message/data types
  assets/                              # Watermark reference images
public/
  download-interceptor.js              # Main-world Gemini download-chain interceptor
  rules.json                           # Declarative net request CORS rules
  icons/                               # Extension icons
docs/                                  # Operational docs
manifest.json
AGENTS.md
```

## Local Development

```bash
pnpm install
pnpm dev
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the `dist/` directory

## Build

```bash
pnpm build
```

Build output is generated in `dist/`.

## Usage

### Gemini

1. Open `https://gemini.google.com/`
2. Open a conversation with generated images
3. Click the extension icon
4. Select images in the in-page panel and start batch download

### NotebookLM (Infographic)

1. Open `https://notebooklm.google.com/`
2. Open a notebook with generated Infographic artifacts in Studio
3. Click the extension icon
4. Select infographic items in the panel and start batch download

## Troubleshooting

### Panel does not appear

- Refresh the page and retry
- Confirm the latest `dist/` build is loaded
- Confirm the current page is `gemini.google.com` or `notebooklm.google.com`

### Items are not detected on long pages

- Scroll the page once, then reopen the panel
- Keep Studio/Conversation area visible while scanning

### Downloads fail or hang

- Check extension Errors / Service Worker logs in `chrome://extensions`
- Ensure account login is valid on target site
- Retry once after page refresh

## Permissions

- `activeTab`: action-based interaction with the active tab
- `downloads`: save processed files via Chrome downloads API
- `declarativeNetRequestWithHostAccess`: adjust CORS headers for image fetches
- `host_permissions`:
  - `https://gemini.google.com/*`
  - `https://notebooklm.google.com/*`
  - `https://lh3.googleusercontent.com/*`
  - `https://lh3.google.com/*`

## License

MIT. See [LICENSE](LICENSE).
