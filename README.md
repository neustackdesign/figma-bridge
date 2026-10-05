# Figma Bridge — Browser ↔ Figma

A lightweight, local-first bridge for moving visual work between browser documents and Figma.

## v0 scope

### Browser → Figma

- HTML file → editable Figma layers
- pasted HTML / SVG → editable Figma layers
- public URL → fetched HTML → editable Figma layers
- PDF → one Figma frame per page, raster content in v0
- Auto Layout is inferred by `@figit/dom-to-figma` for flex, grid, wrapping and block flow when the browser geometry can be reproduced exactly; otherwise that container falls back to absolute positioning.

The browser conversion engine is the MIT-licensed [`@figit/dom-to-figma`](https://github.com/figitdesign/web-to-figma) package rather than a Neustack reimplementation.

### Figma → HTML

The companion development plugin exports selected Figma frames/layers as one standalone HTML file:

- Figma Auto Layout → CSS flex
- text → editable HTML text
- vectors → inline SVG
- solid fills, borders, radii and shadows → CSS
- image fills → embedded data URIs
- unsupported/complex node types → embedded PNG fallback

No backend is required for Figma → HTML.

## Run locally

The browser application is static apart from `api/proxy.js`, which exists only to fetch cross-origin public pages/assets.

Use any local server for HTML/SVG/PDF file import. URL import requires a Vercel-compatible serverless runtime or an equivalent proxy route.

## Install the Figma exporter

Open `/plugin/` in the deployed app, download `manifest.json`, `code.js`, and `ui.html` into one folder, then:

1. Figma Desktop → Plugins → Development.
2. Import plugin from manifest.
3. Select frame(s).
4. Run **Figma Bridge — Export HTML**.
5. Export.

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

The URL proxy rejects obvious local/private IPv4 ranges, localhost and credential-bearing URLs, caps redirects, and limits response sizes. It is intentionally not a general-purpose fetch proxy.

## License note

Figma Bridge’s shell is Neustack code. Third-party dependencies keep their original licenses. `@figit/dom-to-figma` and `openfig-core` are MIT-licensed at the time this prototype was built.
