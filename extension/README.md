# Figma Bridge — full-page image export

This is the browser-native companion to [Figma Bridge](https://bridge.neustackstudio.com/). It renders PNG/JPG exports of live websites with JavaScript, GSAP, ScrollTrigger, Canvas, and WebGL. Screenshots are raster images; editable Figma conversion remains in the web app via the live-page bookmarklet.

## Install locally in Chrome or Edge

1. Download or clone this repository and keep the `extension/` directory on disk.
2. Visit `chrome://extensions` (Edge: `edge://extensions`).
3. Enable **Developer mode**, select **Load unpacked**, and select the **extension** directory (the one containing `manifest.json`).
4. Open the webpage to capture, then click **Figma Bridge — Full-page Capture** in the browser toolbar.
5. Choose **Export PNG** or **Export JPG** and select where to save.

No SaaS rendering service, accounts or server-side browser capacity is required. The extension requests `activeTab`, `debugger`, and `downloads`. Chrome temporarily displays a debugging infobar during capture. The debugger is detached afterwards.

## Capture model

The companion scrolls through the page to load lazy assets, then captures each viewport with Chrome's native compositor, stitching the resulting screenshots into one image. This preserves actual WebGL/Canvas output, unlike HTML-to-canvas or DOM-to-Figma. It restores scroll position after capture.

**Known visual limits:** Scroll-driven animation cannot be represented at all its timeline positions in one still. Stitching may visibly repeat sticky headers or pinned elements; arbitrary smooth-scroll implementations may not respond to scripted scroll commands. Very large pages are limited to 80 megapixels or 150 tiles for safety. Some DRM-protected video, cross-origin browser surfaces, browser internal pages, and restricted tabs cannot be captured.

## Privacy

The extension operates entirely in the local browser, sends no page data to Neustack, and does not use a remote screenshot service. It only reads the active tab after the user clicks export.
