# Figma Bridge — Browser ↔ Figma

A lightweight, local-first bridge for moving visual work between browser documents and Figma.

## What runs where

Figma Bridge has **two separate pieces**:

1. **Browser app** — HTML / SVG / website / PDF → Figma.
2. **Figma development plugin** — Figma → standalone HTML.

You do **not** need the Figma plugin to import HTML into Figma.

## Run the browser app locally

From the repo folder:

```bash
cd ~/Code/figma-bridge
npx vercel dev
```

The first run may ask which Vercel project to use. Choose **Create a new project in this team**, name it `figma-bridge`, and accept the current directory/default settings.

Wait until the terminal says the dev server is ready, then open:

```text
http://localhost:3000
```

Keep the Terminal process running while you use the app.

### Browser → Figma

At `http://localhost:3000`:

- **HTML file** → choose/drop a `.html` file.
- **Paste HTML / SVG** → paste markup and render it.
- **Website URL** → fetch the public server HTML. It cannot execute third-party website scripts. For live, JS-rendered, GSAP or scroll-reveal states, use the bookmarklet for editable DOM layers; for Canvas/WebGL and visual fidelity, use the browser-native image exporter below.
- **PDF** → reconstructs each page from PDF vectors/text/images first; pages fall back to raster only when reconstruction cannot be completed safely.

When the preview says **Ready**:

1. Click **Copy to Figma**.
2. Switch to any Figma design file/page.
3. Paste with `⌘V` / `Ctrl+V`.

Static HTML is inspected directly. Packaged HTML containing JavaScript is rendered first inside a sandboxed opaque-origin iframe, then the rendered DOM is converted. This supports packaged/browser artifacts that reconstruct themselves with JavaScript instead of exposing their final DOM in the source file.

Auto Layout is inferred by `@figit/dom-to-figma` for flex, grid, wrapping and block flow when the browser geometry can be reproduced exactly; otherwise that container falls back to absolute positioning.

The browser conversion engine is the MIT-licensed [`@figit/dom-to-figma`](https://github.com/figitdesign/web-to-figma) package rather than a Neustack reimplementation.

## Record scroll and animation journeys as MP4 or GIF

The same local [browser companion](./extension/) now includes three video workflows: **Guided full-page scroll**, **Fixed viewport / loop**, and **Manual interactions**. It captures the actual Chrome tab video stream (including animations and Canvas/WebGL) and exports local H.264 MP4 or animated GIF.

- MP4: up to 1080p, 24fps and 60 seconds, silent.
- GIF: up to 560px, 8fps and 30 seconds.
- Chrome 116+; no remote rendering server or billable infrastructure.
- Use the [latest successful CI build](https://github.com/neustackdesign/figma-bridge/actions/workflows/motion-capture.yml) to install the packaged extension, or run `npm install && npm run build:extension` locally before loading `extension/`.

This records the viewport moving through a site over time, not a static tall screenshot. Hover and click-triggered animations require Manual interactions mode. Chrome's tab capture and H.264 encoding support vary by browser/platform; the CI suite validates logic and bundling but is not a substitute for visual tests against a site.

## Full-page PNG / JPG from animated live websites

Bridge also includes a browser-native [Chrome / Edge extension](./extension/) for full-height screenshots. Use this when you need the **actual rendered pixels** of GSAP/ScrollTrigger, smooth-scrolling, video, Canvas, WebGL or otherwise heavily animated websites.

1. Download/clone this repository and open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on Developer mode, choose **Load unpacked**, and select the `extension/` directory.
3. Visit the source website directly, then use the **Figma Bridge — Full-page Capture** toolbar action.
4. Choose **Export PNG** or **Export JPG**. Chrome downloads one stitched, full-height image.

The companion also offers **8 independent scene-frame PNGs** for pinned/transformed sections when a single stitched image would be misleading, plus a **Diagnose this website** view to reveal scroll locks, Lenis/ScrollSmoother, GSAP pins and Canvas. Guided video now defaults to trusted wheel scrolling instead of jumping scroll positions. The companion operates **locally**, uses the existing browser render output, has no server-side screenshot service, and releases its temporary debugger session after still-image capture. On one-viewport virtual-scroll sites such as Heron it saves a labelled PNG/JPG storyboard of distinct animated states rather than reporting a false "page blocked scrolling" error. It does not produce editable Figma layers. Scroll-driven pinned elements/sticky headers can repeat in a stitched static image; DRM video and arbitrary locked scrollers remain limitations.

### Live-page editable Figma import

For editable DOM content, use **Copy live-page bookmarklet** in Bridge, install it as a browser bookmark, then run it on the site you are viewing. The bookmarklet scrolls to prime lazy content and reveal states, tries to coordinate GSAP/ScrollTrigger, and presents a **Copy to Figma** button after conversion. Click that button before pasting into Figma: the additional click is important because a long conversion expires the browser's clipboard user-activation permission.

The live-page bookmarklet still depends on the source website's content-security policy allowing the converter module, and Canvas/WebGL frames are not natively editable. The image exporter is the fidelity fallback for these sites.

## Install the Figma → HTML exporter

This is a **separate local development plugin**. It is only needed for the reverse direction.

The Figma companion now opens with an **Overview** that describes the entire Bridge suite, alongside Web → Figma, Capture and Figma → Web tabs. Only the native Figma → Web exporter runs inside the Figma sandbox; the other tabs take you to the browser app and Chrome extension. The plugin files already exist in the repo:

```text
~/Code/figma-bridge/plugin/manifest.json
~/Code/figma-bridge/plugin/code.js
~/Code/figma-bridge/plugin/ui.html
```

In **Figma Desktop**:

1. Plugins → Development → Import plugin from manifest…
2. Choose `~/Code/figma-bridge/plugin/manifest.json`.
3. Select one or more frames/layers.
4. Run **Figma Bridge — Export HTML** from Development plugins.
5. Use the **Overview** to discover Bridge capabilities, or select **Figma → Web** and click **Export selected layers**.

`http://localhost:3000/plugin/` is only an installation/helper page for those files. It is not the main Figma Bridge app.

### Figma → HTML output

- Figma Auto Layout → CSS flex
- text → editable HTML text
- vectors → inline SVG
- solid fills, borders, radii and shadows → CSS
- image fills → embedded data URIs
- unsupported/complex node types → embedded PNG fallback
- multiple selected roots → stable side-by-side export without root-position collisions

No backend is required for Figma → HTML.

## The important constraint

“Pixel-perfect” and “semantically editable” are not the same problem.

HTML contains layout semantics, so browser → Figma can preserve editable text and infer native Auto Layout while verifying against measured browser geometry.

PDF is effectively a display list. It does not contain CSS flex/grid or Figma Auto Layout semantics. Figma Bridge now reconstructs vector drawing operations, PDF text and embedded imagery into editable browser geometry before handing the result to the Figma converter. That recovers editable primitives, not the original authoring semantics. Auto Layout still requires a separate geometry-inference stage.

Likewise, a generic Figma frame can be exported faithfully to HTML, but Figma prototype interactions are not web application logic. v0 exports the visual document, not application behaviour.

## Phase 2 candidates

- direct `.fig` / `.deck` ingest and inspection using MIT-licensed [`openfig-core`](https://github.com/OpenFig-org/openfig-core)
- PDF geometry-based grouping and Auto Layout inference after primitive reconstruction
- visual-diff verifier (browser screenshot ↔ Figma export)
- direct hybrid imports: editable DOM plus raster fallbacks for unsupported Canvas/WebGL regions
- CSS grid inference on Figma → HTML where frame geometry indicates grid rather than flex
- prototype/interactions → links, hover/pressed states and lightweight JS where mappings are deterministic

## Security

Script-backed local/pasted HTML is executed only in a sandboxed iframe without `allow-same-origin`, so it cannot access the parent Figma Bridge page or its storage. Public URL import does not execute fetched third-party scripts inside Figma Bridge; use the live-page bookmarklet for those cases.

The URL proxy rejects credential-bearing URLs, literal private/reserved IPv4 and IPv6 ranges, and hostnames that resolve to private/local addresses. Redirect targets are revalidated, response bodies are size-limited while streaming, and asset mode rejects non-image/non-font content. It is intentionally not a general-purpose fetch proxy.

## License note

Figma Bridge’s shell is Neustack code. Third-party dependencies keep their original licenses. `@figit/dom-to-figma` and `openfig-core` are MIT-licensed at the time this prototype was built.
