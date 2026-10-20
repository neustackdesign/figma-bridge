/* Figma Bridge: browser-native capture. No remote code, server, or tracking. */
const statusNode = document.querySelector('#status');
const buttons = [...document.querySelectorAll('[data-format]')];
const setStatus = message => { statusNode.textContent = message; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_PIXELS = 80000000;
const MAX_TILES = 150;
let running = false;

async function evaluate(tabId, expression, timeoutMs = 15000) {
  const work = chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Page did not respond within the capture timeout.')), timeoutMs);
  });
  let response;
  try { response = await Promise.race([work, timeout]); }
  finally { clearTimeout(timeoutId); }
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Page evaluation failed.');
  }
  return response.result?.value;
}

const dimensionsScript = `(() => {
  const d=document.documentElement, b=document.body||d;
  const nested=[...document.querySelectorAll('main,[data-scroll-container],[data-lenis-root],[data-scroll],#app')]
    .filter(el=>el.clientHeight>=innerHeight*.6 && el.clientWidth>=innerWidth*.6
      && el.scrollHeight>el.clientHeight+100)
    .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
  return {
    width:Math.ceil(Math.max(innerWidth,1)),
    height:Math.ceil(Math.max(d.scrollHeight,b.scrollHeight,nested?.scrollHeight||0,innerHeight,1)),
    viewportHeight:innerHeight, viewportWidth:innerWidth,
    scrollX:scrollX,scrollY:scrollY,nestedY:nested?.scrollTop||0
  };
})()`;

function scrollExpression(y) {
  return `(async()=> {
    const y=${JSON.stringify(y)};
    const smoother=window.ScrollSmoother?.get?.();
    if(smoother) smoother.scrollTop(y,false);
    else {
      window.lenis?.scrollTo?.(y,{immediate:true,force:true});
      window.scrollTo({top:y,behavior:'instant'});
    }
    const nested=[...document.querySelectorAll('main,[data-scroll-container],[data-lenis-root],[data-scroll],#app')]
      .filter(el=>el.clientHeight>=innerHeight*.6 && el.clientWidth>=innerWidth*.6
        && el.scrollHeight>el.clientHeight+100)
      .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
    if(nested && scrollY<1)nested.scrollTop=y;
    window.ScrollTrigger?.update?.();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await new Promise(r=>setTimeout(r,260));
    return Math.max(0,scrollY||0,nested?.scrollTop||0);
  })()`;
}

async function primePage(tabId) {
  const initial = await evaluate(tabId, dimensionsScript);
  if (!initial || initial.height < 1 || initial.viewportHeight < 1) {
    throw new Error('The page has no measurable viewport.');
  }
  const step = Math.max(260, Math.floor(initial.viewportHeight * 0.8));
  let y = 0;
  let visits = 0;
  // Re-measure: lazy sections can grow the document as they become visible.
  while (visits++ < MAX_TILES && y < Math.min((await evaluate(tabId, dimensionsScript)).height, 150000)) {
    await evaluate(tabId, scrollExpression(y));
    y += step;
    setStatus(`Loading scroll content… ${Math.min(100,Math.round(y / Math.max(1,initial.height)*100))}%`);
  }
  await evaluate(tabId, `Promise.race([
    Promise.all([document.fonts?.ready||Promise.resolve(),...Array.from(document.images).map(img=>img.complete?Promise.resolve():new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true})}))]),
    new Promise(r=>setTimeout(r,3500))
  ]).then(()=>true)`, 6500);
  await evaluate(tabId,scrollExpression(0));
  return await evaluate(tabId,dimensionsScript);
}

async function screenshot(tabId) {
  const response = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false
  });
  if (!response?.data) throw new Error('Chrome returned an empty screenshot.');
  const image = new Image();
  image.src = 'data:image/png;base64,' + response.data;
  await image.decode();
  return image;
}

async function capture(format) {
  if (running) return;
  running = true;
  buttons.forEach(button => button.disabled = true);
  let attached = false, tabId, saved;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url||'')) {
      throw new Error('Open an ordinary http(s) webpage before exporting.');
    }
    tabId = tab.id;
    const hostname = new URL(tab.url).hostname.replace(/[^a-z0-9.-]/gi,'-');
    setStatus('Connecting to the browser renderer…');
    await chrome.debugger.attach({tabId},'1.3');
    attached = true;
    await chrome.debugger.sendCommand({tabId},'Page.enable');
    await chrome.debugger.sendCommand({tabId},'Runtime.enable');
    saved = await evaluate(tabId,dimensionsScript);
    const metrics = await primePage(tabId);
    if(metrics.width * metrics.height > MAX_PIXELS) {
      throw new Error(`Page is ${metrics.width} × ${metrics.height}px. The 80-megapixel safety limit prevents an out-of-memory export.`);
    }
    const total = Math.ceil(metrics.height / metrics.viewportHeight);
    if(total > MAX_TILES) throw new Error('Page exceeds the 150-tile safety limit.');
    const canvas=document.createElement('canvas');
    canvas.width=metrics.width;canvas.height=metrics.height;
    const ctx=canvas.getContext('2d',{alpha:format==='png'});
    if (!ctx) throw new Error('Could not initialise the image canvas.');
    if(format==='jpeg') {ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    const maxScroll=Math.max(0,metrics.height-metrics.viewportHeight);
    let previousPosition=-1;
    for(let i=0;i<total;i++) {
      const target=Math.min(i*metrics.viewportHeight,maxScroll);
      const actual=await evaluate(tabId,scrollExpression(target));
      const y=Math.max(0,Number(actual)||0);
      if(target>0 && y<target*.7)throw new Error('The website blocked scripted scrolling; full-page capture would repeat the same viewport.');
      const tile=await screenshot(tabId);
      // Paint at its real scroll offset. The last tile overlaps rather than cropping the footer.
      ctx.drawImage(tile,0,0,tile.width,tile.height,0,y,metrics.viewportWidth,metrics.viewportHeight);
      if(previousPosition===y && i>0 && maxScroll>0 && y<maxScroll-2) {
        throw new Error('The page did not advance while scrolling; its custom scroll container may be locked.');
      }
      previousPosition=y;
      setStatus(`Capturing ${i+1}/${total} sections…`);
    }
    setStatus('Encoding image…');
    const mime=format==='png'?'image/png':'image/jpeg';
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode image.')),mime,0.92));
    const url=URL.createObjectURL(blob);
    const filename=`figma-bridge/${hostname}-full-page-${new Date().toISOString().slice(0,10)}.${format==='png'?'png':'jpg'}`;
    try {
      await chrome.downloads.download({url,filename,saveAs:false,conflictAction:'uniquify'});
    } finally {
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    setStatus(`Export ready: ${metrics.width} × ${metrics.height}px ${format==='png'?'PNG':'JPG'}.`);
  } catch(error) {
    setStatus('Export failed: '+(error?.message||String(error)));
  } finally {
    if(attached) {
      if(saved && tabId) {
        try {await evaluate(tabId,scrollExpression(saved.scrollY||saved.nestedY||0));} catch {}
      }
      try {await chrome.debugger.detach({tabId});} catch {}
    }
    running=false;
    buttons.forEach(button=>button.disabled=false);
  }
}
buttons.forEach(button=>button.addEventListener('click',()=>capture(button.dataset.format)));
