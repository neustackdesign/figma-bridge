# Figma Bridge — image and motion capture

The Chrome/Edge companion captures rendered websites locally. It supports GSAP/ScrollTrigger, CSS animations, Canvas and WebGL as pixels rather than trying to reconstruct every visual effect as editable DOM layers.

## Install a ready-to-use build (recommended)

1. Open the [Bridge Motion recording workflow](https://github.com/neustackdesign/figma-bridge/actions/workflows/motion-capture.yml) and select the latest successful run.
2. Download its **figma-bridge-complete-toolkit** artifact and unzip `figma-bridge-complete-toolkit.zip`. This contains `extension/` and `figma-plugin/`.
3. Open `chrome://extensions` (Edge: `edge://extensions`), turn on Developer mode, choose **Load unpacked**, and choose the extracted `extension` directory.
4. Pin **Figma Bridge — Capture** to the browser toolbar.

Install from source, if preferred: clone/download the repository, run `npm install` and `npm run build:extension` at the repository root, and load the `extension/` directory. `recorder.js` is compiled from `recorder.source.js` with bundled MIT-licensed `mp4-muxer` and `gifenc` dependencies. There are no runtime CDN dependencies.

## Full-page still images

Open a page, choose **Export PNG** or **Export JPG**. The extension scrolls the real page to trigger lazy content, captures each section with the browser compositor, then stitches a full-height image. Use **Capture 8 scene frames (PNG)** for transforming, sticky/pinned or virtual-scroll experiences: each frame represents a separate viewport moment, not an impossible flattened montage. **Diagnose this website** reveals the page's GSAP pins, Canvas surfaces, scrolling engine and size. Existing limitations: some sticky/pinned elements may repeat, and arbitrary scroll locks may prevent reliable stitching.

## Capture animations as MP4/GIF

Open the source page, click the extension, choose a workflow, format, duration and resolution, then **Record animation**:

- **Guided full-page scroll** — captures the live viewport while Bridge automatically scrolls the page, triggering scroll-linked animations and rendering actual video/Canvas/WebGL pixels. Allows 10–60 seconds for MP4.
- **Fixed viewport / loop** — records the visible hero, animated illustration, background or looping interaction without scrolling.
- **Manual interactions** — records what happens while you scroll, hover and click yourself. Reopen the extension popup to select **Stop and export** before the recording duration elapses.

For **Guided full-page scroll**, leave **Natural wheel** selected. It sends browser-trusted wheel input to the source page, which lets GSAP/ScrollTrigger, Lenis and virtual-scroll handlers progress naturally. Use **Position-based** only for conventional native-scrolling pages. For custom drag-based effects, select **Manual interactions** instead.

### Encoding limits

| Output | Encoding | Default | Maximum |
| --- | --- | --- | --- |
| MP4 | H.264 AVC via browser WebCodecs | 720p, 24fps, 20s | 1080p, 60s |
| GIF | 128-colour palette, 8fps | up to 560px, 20s | 560px, 30s |
| PNG/JPG | Chrome-native still raster | Full page | 80 megapixels / 150 tiles |

GIF is better for short, loopable elements; MP4 is preferable for high-detail, photographic or full-page animations. Animated export is a **normal viewport video that travels down the page**, not an impossibly tall video and not a series of static screenshots. Files are recorded without site audio in v0.3.

### Privacy and behaviour

- No external screenshot/video service. Capture and encoding happen entirely on-device.
- The extension uses `activeTab`, `tabCapture`, `offscreen`, `scripting`, `downloads` and (for still images) `debugger`. It only records after a direct user click.
- Keep the page open and visible. Switching tabs, minimising Chrome, or navigating away can throttle or stop recording.
- When recording starts, the popup can close and the browser toolbar displays **REC**. Use it again to stop early.
- GIF is limited to 30 seconds and 560px to keep memory/file sizes manageable.
- H.264 uses your browser's local hardware/software encoder. If unsupported, Bridge reports an error; it does not silently save WebM under an MP4 filename.
- Guided scrolling attempts native scrolling, GSAP ScrollSmoother and common Lenis implementations. Unusual bespoke scroll engines may require **Manual interactions** mode.
- Stop/export returns the page to its prior scroll position (when permitted by the page).

This is a capture tool for user-authorised material. It does not bypass DRM or reconstruct protected streaming media.


## Why the Figma plugin has different controls

Bridge consists of three execution environments: a browser app for HTML/PDF/website → Figma, a Chrome extension for rendered screenshots and recordings, and a Figma plugin for Figma → HTML. Figma plugins cannot capture live Chrome tabs. The updated Figma plugin's Overview, Web → Figma, Capture and Figma → Web tabs show the full product with links to the right environment. The CI toolkit also includes an updated `figma-plugin/` folder; use its `manifest.json` to update the local development plugin.
