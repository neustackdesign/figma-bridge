/* Browser-side, static offline document export. Never execute a third-party page's scripts. */
const MAX_ASSETS=160;
const MAX_BYTES=48*1024*1024;
const MAX_CSS_DEPTH=4;
const HTML2CANVAS_URL='/vendor/html2canvas.js';
const JSPDF_URL='/vendor/jspdf.js';

function isIgnoredURL(value){
  return !value || /^(?:data:|#|about:)/i.test(value.trim());
}
function resolveURL(raw,base){
  const value=String(raw||'').trim();
  if(isIgnoredURL(value))return value;
  const url=new URL(value,base);
  if(!['https:','http:'].includes(url.protocol))throw new Error('Unsupported resource URL: '+value.slice(0,100));
  return url.href;
}
function escapeHTML(value){
  return String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
async function replaceAsync(text,regex,fn){
  const matches=[...text.matchAll(regex)];
  if(!matches.length)return text;
  let result='',end=0;
  for(const match of matches){
    result+=text.slice(end,match.index)+await fn(match);
    end=match.index+match[0].length;
  }
  return result+text.slice(end);
}
async function toDataURL(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Unable to encode embedded resource.'));
    reader.readAsDataURL(blob);
  });
}
function stripExecutables(doc){
  doc.querySelectorAll('script,iframe,object,embed,frame,frameset,meta[http-equiv="refresh"],link[rel="manifest"],link[rel="modulepreload"],link[rel="preconnect"],link[rel="dns-prefetch"],link[rel="preload"],link[rel="prefetch"]').forEach(el=>el.remove());
  doc.querySelectorAll('*').forEach(el=>{
    for(const attr of [...el.attributes]){
      if(/^on/i.test(attr.name) || attr.name==='srcdoc')el.removeAttribute(attr.name);
      if(['href','action','formaction'].includes(attr.name) && /^\s*javascript:/i.test(attr.value))el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll('base,meta[http-equiv="content-security-policy"]').forEach(el=>el.remove());
}
export async function bundleSnapshot(markup,baseURL,options={}){
  const base=new URL(baseURL||location.href,location.href).href;
  const doc=new DOMParser().parseFromString(markup,'text/html');
  stripExecutables(doc);
  const failures=[],warnings=[],cache=new Map();
  let count=0,bytes=0;
  const resource=async(raw,kind,from=base)=>{
    if(isIgnoredURL(raw))return String(raw||'');
    let url;
    try{url=resolveURL(raw,from)}catch(e){failures.push(e.message);return raw}
    const key=kind+'|'+url;
    if(cache.has(key))return cache.get(key);
    const promise=(async()=>{
      if(++count>MAX_ASSETS)throw new Error('Page exceeds the '+MAX_ASSETS+' resource packaging limit.');
      const response=await fetch('/api/proxy?mode='+encodeURIComponent(kind==='css'?'stylesheet':'asset')+'&url='+encodeURIComponent(url));
      if(!response.ok){
        let message='';
        try{message=(await response.json()).error||''}catch{}
        throw new Error('Could not embed '+url.slice(0,120)+': '+(message||'HTTP '+response.status));
      }
      const blob=await response.blob();
      bytes+=blob.size;
      if(bytes>MAX_BYTES)throw new Error('Page exceeds the 48 MB embedded-asset limit.');
      if(kind==='css'){
        const finalURL=response.headers.get('X-Final-Url')||url;
        return {css:await blob.text(),url:finalURL};
      }
      const mime=(blob.type||'').toLowerCase();
      if(!/^(image\/|font\/|application\/octet-stream)/.test(mime))throw new Error('Asset type blocked: '+mime);
      return toDataURL(blob);
    })();
    cache.set(key,promise);
    return promise;
  };
  const embed=async(raw,from)=>{
    try{return await resource(raw,'asset',from)}catch(e){failures.push(e.message);return raw}
  };
  async function rewriteCSS(css,from,depth=0){
    if(depth>MAX_CSS_DEPTH){failures.push('Stylesheet imports exceed '+MAX_CSS_DEPTH+' levels.');return css}
    css=await replaceAsync(css,/@import\s+(?:url\(\s*)?["']?([^"'\s);]+)["']?\s*\)?\s*([^;]*);/gi,async m=>{
      try{
        const sheet=await resource(m[1],'css',from);
        const nested=await rewriteCSS(sheet.css,sheet.url,depth+1);
        const media=(m[2]||'').trim();
        return media && !/^layer\b/i.test(media)?'@media '+media+' {\n'+nested+'\n}':nested;
      }catch(e){failures.push(e.message);return ''}
    });
    return replaceAsync(css,/url\(\s*(["']?)(.*?)\1\s*\)/gi,async m=>{
      const raw=m[2].trim();
      if(isIgnoredURL(raw))return m[0];
      const value=await embed(raw,from);
      return 'url("'+String(value).replace(/"/g,'%22')+'")';
    });
  }
  for(const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]){
    try{
      const sheet=await resource(link.getAttribute('href'),'css',base);
      const style=doc.createElement('style');
      style.textContent=await rewriteCSS(sheet.css,sheet.url);
      style.setAttribute('data-bridge-embedded','stylesheet');
      link.replaceWith(style);
    }catch(e){failures.push(e.message);link.remove()}
  }
  for(const style of doc.querySelectorAll('style')){
    if(style.hasAttribute('data-bridge-embedded'))continue;
    style.textContent=await rewriteCSS(style.textContent,base);
  }
  for(const el of doc.querySelectorAll('[style]')){
    el.setAttribute('style',await rewriteCSS(el.getAttribute('style'),base));
  }
  for(const [selector,attr] of [
    ['img[src]','src'],['input[type="image"][src]','src'],
    ['video[poster]','poster'],['link[rel~="icon"][href]','href'],
    ['image[href]','href'],['image[xlink\\:href]','xlink:href']
  ]){
    for(const el of doc.querySelectorAll(selector)){
      el.setAttribute(attr,await embed(el.getAttribute(attr),base));
    }
  }
  for(const el of doc.querySelectorAll('[srcset]')){
    // Parse the common URL + density/width-descriptor syntax.
    const pieces=el.getAttribute('srcset').split(/,\s*(?=(?:https?:\/\/|\/|\.|[^\s,]+\.(?:png|jpe?g|webp|avif|svg)))/i);
    const bundled=[];
    for(const piece of pieces){
      const match=piece.trim().match(/^(\S+)(\s+.*)?$/);
      if(!match)continue;
      bundled.push((await embed(match[1],base))+(match[2]||''));
    }
    el.setAttribute('srcset',bundled.join(', '));
  }
  for(const el of doc.querySelectorAll('a[href],area[href]')){
    try{el.setAttribute('href',resolveURL(el.getAttribute('href'),base))}catch{el.removeAttribute('href')}
  }
  // A standalone static document cannot recreate JS networking or live video.
  for(const el of doc.querySelectorAll('video,audio,source[src]')){
    if(el.matches('video,audio') && !el.hasAttribute('data-bridge-note')){
      el.setAttribute('data-bridge-note','Live media is not bundled');
      warnings.push('Live audio/video is not included in static HTML.');
    }
    el.removeAttribute('src');
  }
  if(doc.querySelector('canvas'))warnings.push('Canvas/WebGL pixels cannot be reconstructed from static HTML. Use the Capture companion for live pixels.');
  if(failures.length)throw new Error('Standalone export blocked: '+failures.slice(0,3).join(' | ')+(failures.length>3?' (+'+(failures.length-3)+' more)':''));
  doc.documentElement.setAttribute('data-figma-bridge-export','static');
  doc.querySelectorAll('form').forEach(form=>form.removeAttribute('action'));
  const output='<!doctype html>\n'+doc.documentElement.outerHTML;
  return {html:output,assets:count,bytes,warnings};
}
export function saveBlob(blob,filename){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function waitForFrame(frame){
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Export preview timed out.')),15000);
    frame.onload=()=>{clearTimeout(timeout);resolve()};
    frame.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not render bundled HTML.'))};
  });
  await Promise.race([frame.contentDocument.fonts?.ready||Promise.resolve(),new Promise(r=>setTimeout(r,4000))]);
  await Promise.all([...frame.contentDocument.images].map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;setTimeout(r,4000)})));
}
export async function renderSnapshotCanvas(html,width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('Invalid export dimensions.');
  if(width>16384||height>16384||width*height>80000000)throw new Error('Page exceeds the web image export limit (16,384px per side / 80 MP). Use the Chrome capture companion.');
  const frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-same-origin');
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-20000px;top:0;border:0;pointer-events:none;visibility:visible;width:'+width+'px;height:'+height+'px;z-index:-1';
  document.body.appendChild(frame);
  try{
    const done=waitForFrame(frame);
    frame.srcdoc=html;
    await done;
    const mod=await import(HTML2CANVAS_URL);
    const capture=mod.default||mod.html2canvas;
    if(typeof capture!=='function')throw new Error('Image capture engine unavailable.');
    const canvas=await capture(frame.contentDocument.documentElement,{
      backgroundColor:'#ffffff',scale:1,useCORS:true,allowTaint:false,logging:false,
      width,height,windowWidth:width,windowHeight:height,scrollX:0,scrollY:0
    });
    if(canvas.width<1||canvas.height<1)throw new Error('Image capture returned an empty canvas.');
    return canvas;
  }finally{frame.remove()}
}
export async function imageBlob(canvas,format){
  const mime=format==='jpg'?'image/jpeg':'image/png';
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(new Error('Could not encode '+format.toUpperCase()+' image.')),mime,0.92));
}
export async function canvasToPDF(canvas){
  const mod=await import(JSPDF_URL);
  const JsPDF=mod.jsPDF||mod.default?.jsPDF||mod.default;
  if(typeof JsPDF!=='function')throw new Error('PDF engine unavailable.');
  const pdf=new JsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
  const pageWidth=595.28,pageHeight=841.89;
  const ratio=pageWidth/canvas.width;
  const sliceHeight=Math.max(1,Math.floor(pageHeight/ratio));
  const tile=document.createElement('canvas');
  tile.width=canvas.width;
  const context=tile.getContext('2d',{alpha:false});
  for(let y=0,index=0;y<canvas.height;y+=sliceHeight,index++){
    const height=Math.min(sliceHeight,canvas.height-y);
    tile.height=height;
    context.fillStyle='#fff';context.fillRect(0,0,tile.width,height);
    context.drawImage(canvas,0,y,canvas.width,height,0,0,canvas.width,height);
    if(index)pdf.addPage();
    pdf.addImage(tile.toDataURL('image/jpeg',0.92),'JPEG',0,0,pageWidth,height*ratio,undefined,'FAST');
  }
  return pdf.output('blob');
}