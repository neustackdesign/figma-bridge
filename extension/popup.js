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
    // Backgrounded pages can throttle requestAnimationFrame while the extension
    // popup is open. Use a bounded wall-clock delay instead.
    await new Promise(r=>setTimeout(r,360));
    return Math.max(0,scrollY||0,nested?.scrollTop||0,window.lenis?.scroll||0,
      window.ScrollSmoother?.get?.()?.scrollTop?.()||0);
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
    // Keep Chromium treating the recorded page as focused while a popup is open.
    try{await chrome.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:true});}catch{}
    saved = await evaluate(tabId,dimensionsScript);
    const metrics = await primePage(tabId);
    const scale=Math.min(1,Math.sqrt(MAX_PIXELS/Math.max(1,metrics.width*metrics.height)),30000/metrics.height);
    if(scale<.2)throw Error('This extremely long page cannot fit into a reliable single image. Use 8 scene frames or Guided scroll → MP4.');
    const total = Math.ceil(metrics.height / metrics.viewportHeight);
    if(total > MAX_TILES) throw new Error('This page has over 150 viewport sections. Use Scene frames or Guided scroll → MP4 instead of one enormous image.');
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.floor(metrics.width*scale));
    canvas.height=Math.max(1,Math.floor(metrics.height*scale));
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
      ctx.drawImage(tile,0,0,tile.width,tile.height,0,y*scale,metrics.viewportWidth*scale,metrics.viewportHeight*scale);
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
    setStatus(`Export ready: ${canvas.width} × ${canvas.height}px ${format==='png'?'PNG':'JPG'}.`+(scale<1?' Auto-scaled to fit browser memory limits.':''),false,true);
  } catch(error) {
    setStatus('Export failed: '+(error?.message||String(error)));
  } finally {
    if(attached) {
      if(saved && tabId) {
        try {await evaluate(tabId,scrollExpression(saved.scrollY||saved.nestedY||0));} catch {}
      }
      try{await chrome.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:false});}catch{}
      try {await chrome.debugger.detach({tabId});} catch {}
    }
    running=false;
    buttons.forEach(button=>button.disabled=false);
  }
}
buttons.forEach(button=>button.addEventListener('click',()=>capture(button.dataset.format)));

/* Lightweight on-page diagnostics: no page content or credentials are collected. */
const diagnoseButton=document.getElementById('inspectPage');
const diagnostics=document.getElementById('diagnostics');
if(diagnoseButton)diagnoseButton.addEventListener('click',async()=>{
  diagnoseButton.disabled=true;
  diagnostics.textContent='Inspecting scroll model…';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('Open a normal website.');
    const result=await chrome.scripting.executeScript({
      target:{tabId:tab.id},world:'MAIN',
      func:()=>{
        const doc=document.documentElement,body=document.body;
        const styles=getComputedStyle(doc);
        const canvases=[...document.querySelectorAll('canvas')];
        const scrollables=[...document.querySelectorAll('main,[data-scroll-container],[data-lenis-root],[data-scroll],#app')]
          .filter(el=>el.scrollHeight>el.clientHeight+100&&el.clientHeight>innerHeight*.5).length;
        const triggers=typeof window.ScrollTrigger?.getAll==='function'?window.ScrollTrigger.getAll():[];
        return {
          viewport:innerWidth+' × '+innerHeight,
          pageHeight:Math.max(doc.scrollHeight,body?.scrollHeight||0),
          browserScroll:Math.max(0,doc.scrollHeight-innerHeight),
          locked:styles.overflowY==='hidden'||getComputedStyle(body||doc).overflowY==='hidden',
          lenis:Boolean(window.lenis),
          smoother:Boolean(window.ScrollSmoother?.get?.()),
          triggers:triggers.length,pinned:triggers.filter(t=>t.pin).length,
          canvas:canvases.length,
          scrollables
        };
      }
    });
    const d=result?.[0]?.result;
    if(!d)throw Error('Could not inspect this website.');
    const virtual=d.locked||d.lenis||d.smoother||d.scrollables>0||d.pinned>0;
    const advice=virtual?'Recommended: Natural wheel MP4, or Scene frames.':'Recommended: Full-page PNG/JPG or position-based MP4.';
    diagnostics.textContent='Viewport '+d.viewport+'; page height '+d.pageHeight+'px. '
      +d.triggers+' GSAP triggers ('+d.pinned+' pinned); '+d.canvas+' canvas; '
      +(d.locked?'scroll locked; ':'')+(d.lenis?'Lenis; ':'')+(d.smoother?'ScrollSmoother; ':'')
      +advice;
  }catch(error){diagnostics.textContent='Inspection failed: '+(error?.message||String(error));}
  finally{diagnoseButton.disabled=false;}
});
/* A storyboard preserves distinct visual states instead of stitching them
 * into one physically impossible image. Captures the active, rendered tab.
 */
const sceneFramesButton=document.getElementById('sceneFrames');
async function captureSceneFrames(){
  if(running)return;
  running=true;buttons.forEach(button=>button.disabled=true);sceneFramesButton.disabled=true;
  let attached=false,tabId,original;
  const urls=[];
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//i.test(tab.url||''))throw Error('Open a website tab.');
    tabId=tab.id;
    const hostname=new URL(tab.url).hostname.replace(/[^a-z0-9.-]/gi,'-');
    await chrome.debugger.attach({tabId},'1.3');attached=true;
    await chrome.debugger.sendCommand({tabId},'Page.enable');
    await chrome.debugger.sendCommand({tabId},'Runtime.enable');
    original=await evaluate(tabId,dimensionsScript);
    if(!original?.viewportWidth||!original?.viewportHeight)throw Error('Cannot measure this page.');
    const count=8,maxScroll=Math.max(0,original.height-original.viewportHeight);
    const delta=Math.max(170,Math.min(700,Math.ceil(maxScroll/((count-1)*4))));
    await evaluate(tabId,scrollExpression(0));
    for(let i=0;i<count;i++){
      if(i>0){
        // Trusted input advances custom scroll engines and interactive pinned scenes.
        for(let step=0;step<4;step++){
          await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{
            type:'mouseWheel',
            x:Math.max(20,Math.floor(original.viewportWidth*.55)),
            y:Math.max(20,Math.floor(original.viewportHeight*.58)),
            deltaX:0,deltaY:delta,modifiers:0,pointerType:'mouse'
          });
          await wait(90);
        }
      }
      await wait(440); // Give GSAP/Lenis interpolations and Canvas frames time to draw.
      const image=await screenshot(tabId);
      const canvas=document.createElement('canvas');
      canvas.width=original.viewportWidth;canvas.height=original.viewportHeight;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('Unable to allocate frame image.');
      ctx.drawImage(image,0,0,image.width,image.height,0,0,canvas.width,canvas.height);
      const blob=await new Promise((resolve,reject)=>
        canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed.')),'image/png'));
      const url=URL.createObjectURL(blob);urls.push(url);
      await chrome.downloads.download({
        url,filename:'figma-bridge/'+hostname+'-scenes/scene-'+String(i+1).padStart(2,'0')+'.png',
        saveAs:false,conflictAction:'uniquify'
      });
      setStatus('Capturing actual animation states: '+(i+1)+'/'+count+' frames…');
    }
    setStatus('Eight separate PNG scene frames saved. For the complete motion, use Guided scroll → MP4.',false,true);
  }catch(error){
    setStatus('Scene capture failed: '+(error?.message||String(error))+' Try Guided scroll or Manual interactions as MP4.',true);
  }finally{
    if(attached){
      if(original)try{await evaluate(tabId,scrollExpression(original.scrollY||original.nestedY||0));}catch{}
      try{await chrome.debugger.detach({tabId});}catch{}
    }
    setTimeout(()=>urls.forEach(url=>URL.revokeObjectURL(url)),60000);
    running=false;buttons.forEach(button=>button.disabled=false);sceneFramesButton.disabled=false;
  }
}
if(sceneFramesButton)sceneFramesButton.addEventListener('click',captureSceneFrames);

/* Motion recording is independent of full-page still-image capture. */
const motionFormat=document.getElementById('motionFormat');
const motionQuality=document.getElementById('motionQuality');
const motionDuration=document.getElementById('motionDuration');
const motionMode=document.getElementById('motionMode');
const motionDriver=document.getElementById('motionDriver');
const motionHelp=document.getElementById('motionHelp');
const startRecord=document.getElementById('startRecord');
const stopRecord=document.getElementById('stopRecord');
const descriptions={
  guided:'Bridge automatically scrolls from the hero to the footer and records ScrollTrigger/GSAP transitions. Keep the site visible.',
  fixed:'Record a fixed viewport while the page plays its animations or loop. Bridge will not scroll.',
  manual:'Start recording, close the popup, and scroll, hover or click naturally. Reopen Bridge to stop early.'
};
function syncMotionOptions(){
  const isGif=motionFormat.value==='gif';
  for(const option of motionDuration.options)option.disabled=isGif&&Number(option.value)>30;
  if(isGif&&Number(motionDuration.value)>30)motionDuration.value='20';
  if(isGif)motionQuality.value='720';
  motionQuality.disabled=isGif;
  motionDriver.disabled=motionMode.value!=='guided';
  motionHelp.textContent=descriptions[motionMode.value]+(isGif?' GIF is capped at 560px, 8 fps and 30 seconds.':' MP4 uses H.264 at 24 fps.');
}
motionFormat.addEventListener('change',syncMotionOptions);
motionMode.addEventListener('change',syncMotionOptions);
syncMotionOptions();
const setMotionUi=phase=>{
  const active=phase==='recording'||phase==='starting'||phase==='saving';
  startRecord.disabled=active;
  stopRecord.style.display=phase==='recording'?'block':'none';
  for(const control of [motionFormat,motionDuration,motionMode,motionQuality,motionDriver])control.disabled=active;
  if(!active)syncMotionOptions();
};
async function getMotionState(){
  try{
    const result=await chrome.runtime.sendMessage({target:'worker',type:'record-state'});
    if(!result?.ok)return;
    setMotionUi(result.phase);
    if(result.phase==='recording'){
      setStatus('Recording '+result.format?.toUpperCase()+' in the active tab. You can close this popup and return to the page.');
    }else if(result.phase==='saving'){
      setStatus('Encoding and saving recording…');
    }else if(result.error){
      setStatus('Previous recording: '+result.error,true);
    }else if(result.filename){
      setStatus('Last recording saved: '+result.filename,false,true);
    }
  }catch(error){setStatus('Motion recorder unavailable: '+error.message,true);}
}
startRecord.addEventListener('click',async()=>{
  try{
    startRecord.disabled=true;
    setStatus('Starting the tab recorder…');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//i.test(tab.url||''))throw Error('Open an ordinary website before recording.');
    const result=await chrome.runtime.sendMessage({
      target:'worker',type:'record-start',tabId:tab.id,
      mode:motionMode.value,driver:motionDriver.value,format:motionFormat.value,
      duration:Number(motionDuration.value),quality:Number(motionQuality.value)
    });
    if(!result?.ok)throw Error(result?.error||'Could not start recording.');
    setMotionUi('recording');
    setStatus('Recording. Return to the page; reopen Bridge to stop early.');
    // Leave the tab interactive for manual motion/hover/click workflows.
    window.setTimeout(()=>window.close(),500);
  }catch(error){
    setMotionUi('idle');
    setStatus('Recording failed: '+(error?.message||String(error)),true);
  }
});
stopRecord.addEventListener('click',async()=>{
  setMotionUi('saving');
  setStatus('Finishing recording…');
  try{
    const result=await chrome.runtime.sendMessage({target:'worker',type:'record-stop'});
    if(!result?.ok)throw Error(result?.error||'Could not stop recording.');
    setStatus('Encoding and downloading…');
  }catch(error){
    setStatus('Could not stop recording: '+(error.message||String(error)),true);
    await getMotionState();
  }
});
void getMotionState();
