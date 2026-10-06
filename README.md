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
- **Website URL** → fetch the public HTML. For JS-rendered live sites, use the bookmarklet instead.
- **PDF** → one Figma frame per page, raster content in v0.

When the preview says **Ready**:

1. Click **Copy to Figma**.
2. Switch to any Figma design file/page.
3. Paste with `⌘V` / `Ctrl+V`.

Static HTML is inspected directly. Packaged HTML containing JavaScript is rendered first inside a sandboxed opaque-origin iframe, then the rendered DOM is converted. This supports packaged/browser artifacts that reconstruct themselves with JavaScript instead of exposing their final DOM in the source file.

Auto Layout is inferred by `@figit/dom-to-figma` for flex, grid, wrapping and block flow when the browser geometry can be reproduced exactly; otherwise that container falls back to absolute positioning.

The browser conversion engine is the MIT-licensed [`@figit/dom-to-figma`](https://github.com/figitdesign/web-to-figma) package rather than a Neustack reimplementation.

## Install the Figma → HTML exporter

This is a **separate local development plugin**. It is only needed for the reverse direction.

The plugin files already exist in the repo:

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
5. Click **Export self-contained HTML**.

`http://localhost:3000/plugin/` is only an installation/helper page for those files. It is not the main Figma Bridge app.

### Figma → HTML output

- Figma Auto Layout → CSS flex
- text → editable HTML text
- vectors → inline SVG
- solid fills, borders, radii and shadows → CSS
- image fills → embedded data URIs
- unsupported/complex node types → embedded PNG fallback

No backend is required for Figma → HTML.

## The important constraint

“Pixel-perfect” and “semantically editable” are not the same problem.

HTML contains layout semantics, so browser → Figma can preserve editable text and infer native Auto Layout while verifying against measured browser geometry.

PDF is effectively a display list. It does not contain CSS flex/grid or Figma Auto Layout semantics. v0 therefore prioritizes exact page appearance. Editable PDF reconstruction requires a second inference stage for text runs, vectors, groups and layout relationships.

Likewise, a generic Figma frame can be exported faithfully to HTML, but Figma prototype interactions are not web application logic. v0 exports the visual document, not application behaviour.

## Phase 2 candidates

- direct `.fig` / `.deck` ingest and inspection using MIT-licensed [`openfig-core`](https://github.com/OpenFig-org/openfig-core)
- PDF text/vector extraction and geometry-based grouping before Auto Layout inference
- visual-diff verifier (browser screenshot ↔ Figma export)
- browser extension for reliable live-page capture, including JS-rendered states
- CSS grid inference on Figma → HTML where frame geometry indicates grid rather than flex
- prototype/interactions → links, hover/pressed states and lightweight JS where mappings are deterministic

## Security

Script-backed local/pasted HTML is executed only in a sandboxed iframe without `allow-same-origin`, so it cannot access the parent Figma Bridge page or its storage. Public URL import does not execute fetched third-party scripts inside Figma Bridge; use the live-page bookmarklet for those cases.

The URL proxy rejects obvious local/private IPv4 ranges, localhost and credential-bearing URLs, caps redirects, and limits response sizes. It is intentionally not a general-purpose fetch proxy.

## License note

Figma Bridge’s shell is Neustack code. Third-party dependencies keep their original licenses. `@figit/dom-to-figma` and `openfig-core` are MIT-licensed at the time this prototype was built.
