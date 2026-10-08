figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

const MIXED = figma.mixed;
const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION', 'COMPONENT_SET']);
const VECTOR_TYPES = new Set(['VECTOR', 'ELLIPSE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION', 'LINE']);

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cssString(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

function px(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 1000) / 1000}px` : '0px';
}

function colorToCss(color, opacity = 1) {
  if (!color) return 'transparent';
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = Math.max(0, Math.min(1, opacity == null ? 1 : opacity));
  return a < 0.999 ? `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})` : `rgb(${r},${g},${b})`;
}

function firstVisiblePaint(paints) {
  if (!Array.isArray(paints)) return null;
  return paints.find((p) => p && p.visible !== false) || null;
}

function gradientStopsCss(paint) {
  const opacity = paint.opacity == null ? 1 : paint.opacity;
  return paint.gradientStops.map((s) => {
    const alpha = (s.color.a == null ? 1 : s.color.a) * opacity;
    return `${colorToCss(s.color, alpha)} ${Math.round(s.position * 10000) / 100}%`;
  }).join(', ');
}

function gradientAngle(paint) {
  const t = paint?.gradientTransform;
  if (!Array.isArray(t) || !Array.isArray(t[0])) return 180;
  const ux = Number(t[0][0]);
  const uy = Number(t[0][1]);
  if (!Number.isFinite(ux) || !Number.isFinite(uy) || (Math.abs(ux) < 1e-8 && Math.abs(uy) < 1e-8)) return 180;
  const deg = Math.atan2(ux, -uy) * 180 / Math.PI;
  return Math.round(((deg % 360) + 360) % 360 * 1000) / 1000;
}

function paintToCss(paint) {
  if (!paint) return null;
  if (paint.type === 'SOLID') return colorToCss(paint.color, paint.opacity == null ? 1 : paint.opacity);
  if (paint.type === 'GRADIENT_LINEAR' && Array.isArray(paint.gradientStops)) {
    return `linear-gradient(${gradientAngle(paint)}deg, ${gradientStopsCss(paint)})`;
  }
  if (paint.type === 'GRADIENT_RADIAL' && Array.isArray(paint.gradientStops)) {
    return `radial-gradient(ellipse at center, ${gradientStopsCss(paint)})`;
  }
  if (paint.type === 'GRADIENT_ANGULAR' && Array.isArray(paint.gradientStops)) {
    return `conic-gradient(from ${gradientAngle(paint)}deg, ${gradientStopsCss(paint)})`;
  }
  return null;
}

function base64(bytes) {
  if (typeof figma.base64Encode === 'function') return figma.base64Encode(bytes);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return out;
}

function detectMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
  return 'image/png';
}

async function imagePaintCss(paint) {
  if (!paint || paint.type !== 'IMAGE' || !paint.imageHash) return null;
  const image = figma.getImageByHash(paint.imageHash);
  if (!image) return null;
  const bytes = await image.getBytesAsync();
  const mime = detectMime(bytes);
  const sizing = paint.scaleMode === 'FIT' ? 'contain' : paint.scaleMode === 'TILE' ? 'auto' : 'cover';
  const repeat = paint.scaleMode === 'TILE' ? 'repeat' : 'no-repeat';
  return `background-image:url("data:${mime};base64,${base64(bytes)}");background-size:${sizing};background-position:center;background-repeat:${repeat};`;
}

function radiusCss(node) {
  if (!('cornerRadius' in node)) return '';
  if (node.cornerRadius !== MIXED && typeof node.cornerRadius === 'number') return `border-radius:${px(node.cornerRadius)};`;
  const corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];
  if (corners.every((key) => key in node)) {
    return `border-radius:${px(node.topLeftRadius)} ${px(node.topRightRadius)} ${px(node.bottomRightRadius)} ${px(node.bottomLeftRadius)};`;
  }
  return '';
}

function strokeCss(node) {
  if (!('strokes' in node) || !Array.isArray(node.strokes) || !node.strokes.length) return '';
  const stroke = firstVisiblePaint(node.strokes);
  const color = paintToCss(stroke);
  if (!color) return '';
  const weight = 'strokeWeight' in node && node.strokeWeight !== MIXED ? node.strokeWeight : 1;
  return `border:${px(weight)} solid ${color};`;
}

function effectsCss(node) {
  if (!('effects' in node) || !Array.isArray(node.effects)) return '';
  const shadows = node.effects.filter((e) => e && e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'));
  if (!shadows.length) return '';
  const value = shadows.map((e) => {
    const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
    return `${inset}${px(e.offset?.x || 0)} ${px(e.offset?.y || 0)} ${px(e.radius || 0)} ${px(e.spread || 0)} ${colorToCss(e.color, e.color?.a == null ? 1 : e.color.a)}`;
  }).join(',');
  return `box-shadow:${value};`;
}

function opacityCss(node) {
  return 'opacity' in node && typeof node.opacity === 'number' && node.opacity < 0.999 ? `opacity:${node.opacity};` : '';
}

function blendCss(node) {
  if (!('blendMode' in node) || !node.blendMode || node.blendMode === 'PASS_THROUGH' || node.blendMode === 'NORMAL') return '';
  const map = { MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };
  return map[node.blendMode] ? `mix-blend-mode:${map[node.blendMode]};` : '';
}

function nodeBackgroundCss(node) {
  if (!('fills' in node) || node.fills === MIXED || !Array.isArray(node.fills)) return '';
  const paint = firstVisiblePaint(node.fills);
  const css = paintToCss(paint);
  return css ? `background:${css};` : '';
}

function layoutCss(node) {
  if (!('layoutMode' in node) || !node.layoutMode || node.layoutMode === 'NONE') return '';
  const dir = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  const justify = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' }[node.primaryAxisAlignItems] || 'flex-start';
  const align = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' }[node.counterAxisAlignItems] || 'flex-start';
  const alignContent = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' }[node.counterAxisAlignContent] || 'normal';
  const wrap = node.layoutWrap === 'WRAP' ? 'wrap' : 'nowrap';
  const primaryGap = typeof node.itemSpacing === 'number' ? px(node.itemSpacing) : '0px';
  const crossGap = node.layoutWrap === 'WRAP' && typeof node.counterAxisSpacing === 'number' ? px(node.counterAxisSpacing) : primaryGap;
  const rowGap = dir === 'row' ? crossGap : primaryGap;
  const columnGap = dir === 'row' ? primaryGap : crossGap;
  return `display:flex;flex-direction:${dir};flex-wrap:${wrap};justify-content:${justify};align-items:${align};align-content:${alignContent};row-gap:${rowGap};column-gap:${columnGap};padding:${px(node.paddingTop || 0)} ${px(node.paddingRight || 0)} ${px(node.paddingBottom || 0)} ${px(node.paddingLeft || 0)};`;
}

function sizingCss(node, parentIsAuto) {
  let css = `width:${px(node.width || 0)};height:${px(node.height || 0)};`;
  if (!parentIsAuto) return css;
  if ('layoutSizingHorizontal' in node) {
    if (node.layoutSizingHorizontal === 'FILL') css += 'width:auto;flex-grow:1;align-self:stretch;';
    if (node.layoutSizingHorizontal === 'HUG') css += 'width:max-content;max-width:100%;';
  }
  if ('layoutSizingVertical' in node) {
    if (node.layoutSizingVertical === 'FILL') css += 'height:auto;align-self:stretch;';
    if (node.layoutSizingVertical === 'HUG') css += 'height:max-content;';
  }
  return css;
}

function placementCss(node, parent) {
  if (!parent) return 'position:relative;';
  const parentIsAuto = 'layoutMode' in parent && parent.layoutMode && parent.layoutMode !== 'NONE';
  const absoluteInAuto = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';
  if (!parentIsAuto || absoluteInAuto) return `position:absolute;left:${px(node.x || 0)};top:${px(node.y || 0)};`;
  return 'position:relative;';
}

function textAlignCss(node) {
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[node.textAlignHorizontal] || 'left';
  return `text-align:${align};`;
}

function lineHeightCss(lineHeight) {
  if (!lineHeight || lineHeight === MIXED) return '';
  if (lineHeight.unit === 'PIXELS') return `line-height:${px(lineHeight.value)};`;
  if (lineHeight.unit === 'PERCENT') return `line-height:${lineHeight.value / 100};`;
  return 'line-height:normal;';
}

function letterSpacingCss(letterSpacing) {
  if (!letterSpacing || letterSpacing === MIXED) return '';
  if (letterSpacing.unit === 'PIXELS') return `letter-spacing:${px(letterSpacing.value)};`;
  if (letterSpacing.unit === 'PERCENT') return `letter-spacing:${letterSpacing.value / 100}em;`;
  return '';
}

function textDecorationCss(value) {
  if (value === 'UNDERLINE') return 'text-decoration:underline;';
  if (value === 'STRIKETHROUGH') return 'text-decoration:line-through;';
  return '';
}

function fontStyleCss(fontName) {
  if (!fontName || fontName === MIXED) return '';
  const style = String(fontName.style || 'Regular');
  let weight = 400;
  if (/thin/i.test(style)) weight = 100;
  else if (/extra\s*light|ultra\s*light/i.test(style)) weight = 200;
  else if (/light/i.test(style)) weight = 300;
  else if (/medium/i.test(style)) weight = 500;
  else if (/semi\s*bold|demi\s*bold/i.test(style)) weight = 600;
  else if (/extra\s*bold|ultra\s*bold/i.test(style)) weight = 800;
  else if (/black|heavy/i.test(style)) weight = 900;
  else if (/bold/i.test(style)) weight = 700;
  const italic = /italic|oblique/i.test(style) ? 'font-style:italic;' : '';
  return `font-family:"${cssString(fontName.family)}",sans-serif;font-weight:${weight};${italic}`;
}

function textFillCss(fills) {
  if (fills === MIXED || !Array.isArray(fills)) return '';
  const color = paintToCss(firstVisiblePaint(fills));
  return color ? `color:${color};` : '';
}

function segmentCss(segment) {
  return `${fontStyleCss(segment.fontName)}${typeof segment.fontSize === 'number' ? `font-size:${px(segment.fontSize)};` : ''}${textFillCss(segment.fills)}${lineHeightCss(segment.lineHeight)}${letterSpacingCss(segment.letterSpacing)}${textDecorationCss(segment.textDecoration)}`;
}

async function renderText(node, parent) {
  const base = `${placementCss(node, parent)}${sizingCss(node, !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE')}box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;${textAlignCss(node)}${opacityCss(node)}${blendCss(node)}`;
  let inner = esc(node.characters || '');
  try {
    const segments = node.getStyledTextSegments(['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing', 'textDecoration']);
    if (segments && segments.length > 1) {
      inner = segments.map((s) => `<span style="${segmentCss(s)}">${esc(s.characters)}</span>`).join('');
    } else {
      inner = `<span style="${fontStyleCss(node.fontName)}${node.fontSize !== MIXED && typeof node.fontSize === 'number' ? `font-size:${px(node.fontSize)};` : ''}${textFillCss(node.fills)}${lineHeightCss(node.lineHeight)}${letterSpacingCss(node.letterSpacing)}${textDecorationCss(node.textDecoration)}">${inner}</span>`;
    }
  } catch {
    inner = `<span>${inner}</span>`;
  }
  return `<div class="bridge-node bridge-text" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" style="${base}">${inner}</div>`;
}

async function renderVector(node, parent) {
  try {
    const svg = await node.exportAsync({ format: 'SVG_STRING' });
    const css = `${placementCss(node, parent)}${sizingCss(node, !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE')}${opacityCss(node)}${blendCss(node)}overflow:visible;`;
    return `<div class="bridge-node bridge-vector" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" style="${css}">${svg}</div>`;
  } catch {
    return renderRaster(node, parent);
  }
}

async function renderRaster(node, parent) {
  const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  const css = `${placementCss(node, parent)}${sizingCss(node, !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE')}${opacityCss(node)}${blendCss(node)}object-fit:contain;display:block;`;
  return `<img class="bridge-node bridge-raster" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" alt="" src="data:image/png;base64,${base64(bytes)}" style="${css}"/>`;
}

async function renderContainer(node, parent) {
  const parentAuto = !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  const ownAuto = 'layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE';
  let css = `${placementCss(node, parent)}${sizingCss(node, parentAuto)}box-sizing:border-box;${nodeBackgroundCss(node)}${radiusCss(node)}${strokeCss(node)}${effectsCss(node)}${opacityCss(node)}${blendCss(node)}${ownAuto ? layoutCss(node) : ''}${'clipsContent' in node && node.clipsContent ? 'overflow:hidden;' : 'overflow:visible;'}`;

  if (!ownAuto) css += 'position:' + (parent ? (placementCss(node, parent).includes('absolute') ? 'absolute' : 'relative') : 'relative') + ';';

  if ('fills' in node && node.fills !== MIXED && Array.isArray(node.fills)) {
    const imagePaint = node.fills.find((p) => p && p.visible !== false && p.type === 'IMAGE');
    if (imagePaint) {
      try { css += await imagePaintCss(imagePaint); } catch (_) {}
    }
  }

  const children = 'children' in node ? node.children : [];
  const rendered = [];
  for (const child of children) rendered.push(await renderNode(child, node));
  return `<div class="bridge-node bridge-container" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" style="${css}">${rendered.join('')}</div>`;
}

async function renderNode(node, parent = null) {
  if (!node || ('visible' in node && node.visible === false)) return '';
  if (node.type === 'TEXT') return renderText(node, parent);
  if (VECTOR_TYPES.has(node.type)) return renderVector(node, parent);
  if (CONTAINERS.has(node.type)) return renderContainer(node, parent);
  if (node.type === 'RECTANGLE') {
    const hasImage = node.fills !== MIXED && Array.isArray(node.fills) && node.fills.some((p) => p && p.visible !== false && p.type === 'IMAGE');
    if (hasImage) {
      let css = `${placementCss(node, parent)}${sizingCss(node, !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE')}box-sizing:border-box;${radiusCss(node)}${strokeCss(node)}${effectsCss(node)}${opacityCss(node)}${blendCss(node)}`;
      const paint = node.fills.find((p) => p && p.visible !== false && p.type === 'IMAGE');
      try { css += await imagePaintCss(paint); } catch (_) { return renderRaster(node, parent); }
      return `<div class="bridge-node bridge-image" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" style="${css}"></div>`;
    }
    const css = `${placementCss(node, parent)}${sizingCss(node, !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE')}box-sizing:border-box;${nodeBackgroundCss(node)}${radiusCss(node)}${strokeCss(node)}${effectsCss(node)}${opacityCss(node)}${blendCss(node)}`;
    return `<div class="bridge-node bridge-rect" data-figma-id="${esc(node.id)}" data-figma-name="${esc(node.name)}" style="${css}"></div>`;
  }
  try { return await renderRaster(node, parent); } catch { return ''; }
}

function safeFilename(name) {
  const cleaned = String(name || 'figma-export').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'figma-export') + '.html';
}

function htmlDocument(body, title, width, height) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fff}.bridge-canvas{position:relative;width:${px(width)};height:${px(height)};overflow:visible}.bridge-root{position:absolute}.bridge-root>.bridge-node{left:0!important;top:0!important}.bridge-node{box-sizing:border-box}.bridge-vector>svg{display:block;width:100%;height:100%}.bridge-text{word-break:normal}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function exportSelection() {
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error('Select at least one frame or layer first.');

  const gap = 80;
  const outputs = [];
  let cursorX = 0;
  let canvasH = 0;

  for (const node of selection) {
    const raw = await renderNode(node, null);
    outputs.push(
      `<div class="bridge-root" style="position:absolute;left:${px(cursorX)};top:0;width:${px(node.width)};height:${px(node.height)};">${raw}</div>`
    );
    cursorX += node.width + gap;
    canvasH = Math.max(canvasH, node.height);
  }

  const canvasW = Math.max(1, cursorX - gap);
  const title = selection.length === 1 ? selection[0].name : `${figma.currentPage.name} export`;
  const body = `<main class="bridge-canvas">${outputs.join('')}</main>`;
  return { html: htmlDocument(body, title, canvasW, canvasH), filename: safeFilename(title), count: selection.length };
}

figma.ui.onmessage = async (message) => {
  if (!message || message.type !== 'export-html') return;
  try {
    figma.ui.postMessage({ type: 'status', message: 'Reading selected layers…' });
    const result = await exportSelection();
    figma.ui.postMessage({ type: 'exported', ...result });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};

figma.on('selectionchange', () => {
  figma.ui.postMessage({ type: 'selection', count: figma.currentPage.selection.length });
});

figma.ui.postMessage({ type: 'selection', count: figma.currentPage.selection.length });
