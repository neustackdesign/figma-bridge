/* Figma Bridge: browser-native capture. No remote code, server, or tracking. */
const statusNode=document.querySelector('#status');
const statusPanel=document.querySelector('#statusPanel');
const buttons=[...document.querySelectorAll('[data-format]')];
const setStatus=(message,error=false,success=false)=>{
  statusNode.textContent=message;
  if(statusPanel)statusPanel.dataset.state=error?'error':success?'success':'idle';
};
// Keep workflow navigation independent of the capture engines. Existing buttons,
// IDs and permissions remain unchanged.
const workflowTabs=[...document.querySelectorAll('[data-workflow]')];
const workflowPanels=[...document.querySelectorAll('[data-workflow-panel]')];
const hasWorkspaceUI=workflowTabs.length===3&&workflowPanels.length===3&&
  workflowTabs.every(tab=>typeof tab.setAttribute==='function'&&typeof tab.addEventListener==='function'&&tab.dataset)&&
  workflowPanels.every(panel=>panel.dataset);
function selectWorkflow(name,focus=false){
  // Capture regression harnesses intentionally mock only the controls they test.
  if(!hasWorkspaceUI)return;
  for(const tab of workflowTabs){
    const active=tab.dataset.workflow===name;
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
    if(active&&focus)tab.focus();
  }
  for(const panel of workflowPanels)panel.hidden=panel.dataset.workflowPanel!==name;
}
if(hasWorkspaceUI)workflowTabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectWorkflow(tab.dataset.workflow));
  tab.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?workflowTabs.length-1:
      (index+(event.key==='ArrowRight'?1:-1)+workflowTabs.length)%workflowTabs.length;
    selectWorkflow(workflowTabs[next].dataset.workflow,true);
  });
});
selectWorkflow('design');
const buildVersion=document.querySelector('#buildVersion');
if(buildVersion&&chrome.runtime?.getManifest)
  buildVersion.textContent='v'+chrome.runtime.getManifest().version;
if(typeof chrome.tabs?.query==='function')chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>{
  const tab=tabs?.[0],label=document.querySelector('#tabSite');
  if(!label)return;
  if(/^https?:\/\//i.test(tab?.url||'')){
    const site=new URL(tab.url).hostname;
    label.textContent=site;
    label.title=site;
  }else label.textContent='Open a website';
}).catch(()=>{});
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

/** Allow full-screen animated introductions to finish before measuring a
 * purported "full page". An intro often reports exactly one viewport in height
 * until its GSAP/WebGL sequence completes.
 */
async function waitForIntro(tabId,allowVirtual=false){
  const probe=`(() => {
    const d=document.documentElement,b=document.body||d;
    return {
      height:Math.max(d.scrollHeight,b.scrollHeight),
      viewport:innerHeight,
      gsap:window.ScrollTrigger?.getAll?.().length||0,
      canvas:document.querySelectorAll('canvas').length,
      age:performance.now()
    };
  })()`;
  const first=await evaluate(tabId,probe);
  if(!first||first.height>first.viewport*1.1||first.gsap<8||!first.canvas)return;
  const started=Date.now();
  while(Date.now()-started<13000){
    setStatus('Waiting for fullscreen animated introduction to settle… '+Math.round((Date.now()-started)/1000)+'s');
    await wait(650);
    const current=await evaluate(tabId,probe);
    if(current&&current.height>current.viewport*1.1)return;
  }
  // Still a single virtual viewport after the intro. This is not a legitimate
  // multi-section full-page screenshot; provide a more accurate recovery path.
  const current=await evaluate(tabId,probe);
  if(current&&current.height<=current.viewport*1.1&&!allowVirtual){
    throw new Error('This site uses an animated fullscreen/virtual-scroll scene, not a normal full page. Use "Capture 8 scene frames" or Guided scroll → MP4 (Natural wheel) to preserve its visual states.');
  }
}

async function primePage(tabId) {
  const initial=await evaluate(tabId,dimensionsScript);
  if(!initial||initial.height<1||initial.viewportHeight<1)
    throw Error('The page has no measurable viewport.');
  // Use a gradual, overlapping sweep. Large jumps miss IntersectionObserver
  // reveals and async content that only mounts after sustained visibility.
  const step=Math.max(180,Math.floor(initial.viewportHeight*.55));
  const maxVisits=Math.min(MAX_TILES,120);
  let y=0,visits=0,lastBottom=0;
  try {
    while(visits++<maxVisits){
      const metrics=await evaluate(tabId,dimensionsScript);
      const bottom=Math.max(0,Math.min(metrics.height-metrics.viewportHeight,150000));
      const target=Math.min(y,bottom);
      await evaluate(tabId,scrollExpression(target));
      // scrollExpression itself waits 360ms. Additional dwell gives delayed
      // section transitions, image loading and API-backed widgets a chance.
      await wait(400);
      const pending=await evaluate(tabId,'(() => {const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight};return [...document.images].filter(img=>visible(img)&&!img.complete).length})()');
      if(pending>0)await wait(700);
      setStatus('Preparing animated and lazy sections… '+Math.min(100,Math.round(target/Math.max(1,bottom)*100))+'%');
      lastBottom=bottom;
      if(target>=bottom&&y>=bottom)break;
      y+=step;
    }
    // Some requests start only after earlier lazy sections were visited.
    await evaluate(tabId,'Promise.race([Promise.all([document.fonts?.ready||Promise.resolve(),...Array.from(document.images).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener("load",resolve,{once:true});img.addEventListener("error",resolve,{once:true})}))]),new Promise(resolve=>setTimeout(resolve,5000))]).then(()=>true)',7000);
  }finally{
    // Always restore the top before scene or tile capture, including failures.
    await evaluate(tabId,scrollExpression(0));
    await wait(550);
  }
  const finalMetrics=await evaluate(tabId,dimensionsScript);
  return {...finalMetrics,primedSections:visits,scrollRange:lastBottom};
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


/**
 * A motion-driven, viewport-sized scene cannot be stitched into a spatial page.
 * Capture successive actual rendered states as one clearly labelled storyboard.
 * Unlike a synthetic tall DOM screenshot, this preserves visual transitions.
 */
const scrollModelScript=`(() => {
  const de=document.documentElement,body=document.body||de;
  const viewport=innerHeight;
  const documentHeight=Math.max(de.scrollHeight,body.scrollHeight);
  const triggerCount=window.ScrollTrigger?.getAll?.().length||0;
  const hasCanvas=!!document.querySelector('canvas');
  const tallPinned=[...document.querySelectorAll('main,section,[data-scroll-container],[class*="pin"],[class*="sticky"]')]
    .slice(0,300).filter(el=>{
      const rect=el.getBoundingClientRect();
      if(rect.height<viewport*.4)return false;
      const p=getComputedStyle(el).position;
      return p==='sticky'||p==='fixed';
    }).length;
  const virtual=documentHeight<=viewport*1.15&&(hasCanvas||triggerCount>=6);
  return{virtual,tallPinned,triggerCount,hasCanvas,documentHeight,viewport};
})()`;

function imageDifference(a,b){
  if(!a||!b)return Infinity;
  const canvas=document.createElement('canvas');
  canvas.width=96;canvas.height=64;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const values=image=>{
    ctx.clearRect(0,0,96,64);
    ctx.drawImage(image,0,0,96,64);
    return ctx.getImageData(0,0,96,64).data;
  };
  const first=values(a),last=values(b);
  let changed=0;
  for(let i=0;i<first.length;i+=4){
    const delta=Math.abs(first[i]-last[i])+Math.abs(first[i+1]-last[i+1])+Math.abs(first[i+2]-last[i+2]);
    if(delta>70)changed++;
  }
  return changed/(96*64);
}

async function saveCaptureBlob(blob,hostname,suffix,extension){
  if(!blob?.size)throw Error('Capture produced no image data.');
  const url=URL.createObjectURL(blob);
  try{
    await chrome.downloads.download({
      url,filename:'figma-bridge/'+hostname+'-'+suffix+'-'+new Date().toISOString().slice(0,10)+'.'+extension,
      saveAs:false,conflictAction:'uniquify'
    });
  }finally{
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}

async function captureSceneSheet(tabId,hostname,format,metrics,{count=8}={}){
  const width=metrics.viewportWidth,height=metrics.viewportHeight;
  const frames=[];
  // Retain current scene as the first frame; no unwanted forced GSAP rewind.
  let last=await screenshot(tabId);
  frames.push(last);
  const x=Math.max(40,Math.floor(width*.54)),y=Math.max(40,Math.floor(height*.55));
  for(let i=1;i<count;i++){
    let next=null;
    for(let attempt=0;attempt<8;attempt++){
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{
        type:'mouseWheel',x,y,deltaX:0,deltaY:240,modifiers:0,pointerType:'mouse'
      });
      await wait(210);
      const candidate=await screenshot(tabId);
      if(imageDifference(last,candidate)>.005){next=candidate;break;}
    }
    if(!next){
      // Never fabricate eight visually distinct scenes from a frozen canvas.
      break;
    }
    frames.push(next);last=next;
    setStatus('Recording real animation states: '+frames.length+'/'+count);
  }
  if(frames.length<2)throw Error('The rendered scene did not visibly advance. Try Manual interactions → MP4 or use the website’s navigation to start its presentation.');
  const maxWidth=1200;
  const scale=Math.min(1,maxWidth/width,Math.sqrt(MAX_PIXELS/(width*(height+36)*frames.length)));
  const outWidth=Math.max(200,Math.floor(width*scale));
  const imageHeight=Math.max(100,Math.floor(height*scale));
  const heading=38,gutter=12;
  const canvas=document.createElement('canvas');
  canvas.width=outWidth;canvas.height=frames.length*(imageHeight+heading+gutter)+gutter;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('The scene-sequence canvas is unavailable.');
  ctx.fillStyle='#141414';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<frames.length;i++){
    const row=gutter+i*(imageHeight+heading+gutter);
    ctx.fillStyle='#f4f4f1';ctx.fillRect(0,row,canvas.width,heading);
    ctx.fillStyle='#181818';ctx.font='600 15px Arial, sans-serif';
    ctx.fillText('SCENE '+String(i+1).padStart(2,'0')+' / '+String(frames.length).padStart(2,'0')+'   •   '+hostname,12,row+24);
    ctx.drawImage(frames[i],0,0,frames[i].width,frames[i].height,0,row+heading,outWidth,imageHeight);
  }
  const mime=format==='png'?'image/png':'image/jpeg';
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(Error('Could not encode scene sheet.')),mime,.9));
  await saveCaptureBlob(blob,hostname,'animation-scene-sequence',format==='png'?'png':'jpg');
  setStatus('Saved '+frames.length+' distinct scene states as one labelled '+(format==='png'?'PNG':'JPG')+'. For continuous scroll motion, use Guided → Natural wheel → MP4.',false,true);
  return frames.length;
}

/** Hide only small, repeated, fixed/sticky UI chrome after its first screenshot.
 * Never hide large pinned panels that are part of the visual work itself.
 */
async function setRepeatedChromeVisible(tabId,visible){
  const statement=visible
    ?`(() => {for(const el of document.querySelectorAll('[data-bridge-repeat-chrome]')){
       el.style.visibility=el.getAttribute('data-bridge-repeat-chrome');
       el.removeAttribute('data-bridge-repeat-chrome');
     }return true;})()`
    :`(() => {for(const el of document.querySelectorAll('header,nav,[role="banner"]')){
       const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
       if(rect.height>0&&rect.height<innerHeight*.18&&rect.width>innerWidth*.35
          &&(style.position==='fixed'||style.position==='sticky')
          &&!el.hasAttribute('data-bridge-repeat-chrome')){
         el.setAttribute('data-bridge-repeat-chrome',el.style.visibility||'');
         el.style.visibility='hidden';
       }
     }return true;})()`;
  await evaluate(tabId,statement);
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
    const initialModel=await evaluate(tabId,scrollModelScript);
    if(initialModel?.virtual){
      await captureSceneSheet(tabId,hostname,format,saved);
      return;
    }
    await waitForIntro(tabId);
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
      if(i===1)await setRepeatedChromeVisible(tabId,false);
      // Wait for scroll-triggered transitions and smooth-scroller interpolation.
      await wait(440);
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
      if(tabId)try{await setRepeatedChromeVisible(tabId,true);}catch{}
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
    const viewportHeight=Number(d.viewport.split(' × ')[1])||1;
    const fullscreenSequence=d.pageHeight<=viewportHeight*1.1&&(d.triggers>=8||d.canvas>0);
    const virtual=fullscreenSequence||d.locked||d.lenis||d.smoother||d.scrollables>0||d.pinned>0;
    const advice=virtual?'Recommended: Natural wheel MP4 or eight Scene frames. A single full-page image cannot include all the animated states.':'Recommended: Full-page PNG/JPG or position-based MP4.';
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
    await waitForIntro(tabId,true); // Retain virtual-scroll sequences but skip unfinished page loaders.
    setStatus("Preparing the full page before scene capture…");
    // Scene capture previously skipped the priming pass used by full-page
    // screenshots, so lazy sections appeared as skeletons or empty regions.
    original=await primePage(tabId);
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

/* Rendered DOM capture: Chrome executes this function on the actual tab, not in
 * the sandboxed URL importer. The document is CLONED and sanitized; live scripts
 * are never bundled or run again in the exported snapshot. */
async function bridgeSnapshotRenderedDOM({sweep=true}={}){
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const root=document.documentElement;
  const oldX=window.scrollX,oldY=window.scrollY;
  const nested=[...document.querySelectorAll('main,[data-scroll-container],[data-lenis-root],[data-scroll],#app')]
    .filter(el=>el.clientHeight>=innerHeight*.6&&el.clientWidth>=innerWidth*.6&&el.scrollHeight>el.clientHeight+100)
    .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
  const oldNested=nested?.scrollTop||0;
  const visibleStates=new WeakMap();
  const revealSelector='[data-reveal],[data-gsap],[data-animate],[data-animation],[data-aos],.reveal,.aos-init,[style*="opacity"]';
  const dimensions=()=>Math.max(root.scrollHeight,document.body?.scrollHeight||0,nested?.scrollHeight||0,innerHeight);
  let observed=0,canvases=0,unsupportedCanvases=0,videos=0;
  async function move(y){
    const smoother=window.ScrollSmoother?.get?.();
    if(smoother)smoother.scrollTop(y,false);
    else if(window.lenis?.scrollTo)window.lenis.scrollTo(y,{immediate:true,force:true});
    else if(nested)nested.scrollTop=y;
    if(!nested||smoother||window.lenis)window.scrollTo({top:y,behavior:'instant'});
    window.ScrollTrigger?.update?.();
    // A quick jump does not allow async widgets and IntersectionObserver
    // transitions to resolve. Hold the viewport while content hydrates.
    await sleep(620);
    // Re-query: lazy sections often mount fresh nodes during the sweep.
    for(const el of [...document.querySelectorAll(revealSelector)].slice(0,2500)){
      if(!el.isConnected)continue;
      const rect=el.getBoundingClientRect();
      if(rect.bottom<=0||rect.top>=innerHeight||rect.width<=0||rect.height<=0)continue;
      const cs=getComputedStyle(el);
      if(cs.visibility!=='hidden'&&Number(cs.opacity)>.85){
        if(!visibleStates.has(el))observed++;
        visibleStates.set(el,{transform:cs.transform});
      }
    }
  }
  try{
    if(sweep){
      const step=Math.max(220,Math.floor(innerHeight*.55));
      const maxSteps=Math.min(120,Math.ceil(dimensions()/step)+2);
      for(let i=0;i<=maxSteps;i++){
        const bottom=Math.max(0,dimensions()-innerHeight);
        const target=Math.min(i*step,bottom);
        await move(target);
        if(target>=bottom)break;
      }
      await move(oldY);
    }
    await Promise.race([document.fonts?.ready||Promise.resolve(),sleep(2500)]);
    // Wait for images actually triggered by the gradual sweep, not only fonts.
    await Promise.race([Promise.all([...document.images].map(img=>img.complete?Promise.resolve():
      new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true})}))),sleep(4000)]);
    const clone=root.cloneNode(true);
    const sourceElements=[root,...root.querySelectorAll('*')];
    const cloneElements=[clone,...clone.querySelectorAll('*')];
    if(sourceElements.length!==cloneElements.length)throw Error('The DOM changed during capture. Try again after the page settles.');
    for(let i=0;i<sourceElements.length;i++){
      const original=sourceElements[i],copy=cloneElements[i];
      if(!copy||!original.isConnected)continue;
      if(original instanceof HTMLCanvasElement){
        try{
          const url=original.toDataURL('image/png');
          if(url==='data:,')throw Error('Canvas has no pixels');
          const image=document.createElement('img');
          const box=original.getBoundingClientRect();
          image.src=url;image.alt=original.getAttribute('aria-label')||'Captured canvas frame';
          image.className=copy.className||'';
          image.style.cssText=copy.style.cssText;
          image.style.width=box.width+'px';image.style.height=box.height+'px';
          copy.replaceWith(image);canvases++;
        }catch{unsupportedCanvases++;}
        continue;
      }
      if(original instanceof HTMLVideoElement&&original.readyState>=2&&original.videoWidth&&original.videoHeight){
        try{
          const frame=document.createElement('canvas');
          frame.width=original.videoWidth;frame.height=original.videoHeight;
          frame.getContext('2d').drawImage(original,0,0);
          const image=document.createElement('img');
          image.src=frame.toDataURL('image/png');
          const box=original.getBoundingClientRect();
          image.style.cssText=copy.style.cssText;
          image.className=copy.className||'';
          image.alt=original.getAttribute('aria-label')||'Captured video frame';
          image.style.width=box.width+'px';image.style.height=box.height+'px';
          copy.replaceWith(image);videos++;
        }catch{}
        continue;
      }
      if(original instanceof HTMLImageElement&&original.currentSrc&&
          !original.currentSrc.startsWith('blob:')&&!original.currentSrc.startsWith('data:')){
        copy.setAttribute('src',original.currentSrc);
        copy.removeAttribute('srcset');
        copy.removeAttribute('sizes');
        copy.setAttribute('loading','eager');
      }
      const computed=getComputedStyle(original);
      if(computed.animationName!=='none'){
        copy.style.setProperty('transform',computed.transform,'important');
        copy.style.setProperty('opacity',computed.opacity,'important');
        copy.style.setProperty('visibility',computed.visibility,'important');
      }
      // A revealed element may be hidden again when scrolling to its original
      // position. Preserve the visible state observed in the earlier sweep.
      const state=visibleStates.get(original);
      if(state&&(Number(computed.opacity)<.85||computed.visibility==='hidden')){
        copy.style.setProperty('opacity','1','important');
        copy.style.setProperty('visibility','visible','important');
        if(state.transform&&state.transform!=='none')copy.style.setProperty('transform',state.transform,'important');
      }
    }
    // Private input values and executable page code must never be exported.
    clone.querySelectorAll('script,noscript,iframe,object,embed,link[rel="preload"],link[rel="prefetch"],link[rel="preconnect"]').forEach(el=>el.remove());
    clone.querySelectorAll('*').forEach(el=>{
      for(const attr of [...el.attributes]){
        if(/^on/i.test(attr.name))el.removeAttribute(attr.name);
      }
      if(el.tagName==='INPUT'){
        el.removeAttribute('value');el.removeAttribute('checked');
      }else if(el.tagName==='TEXTAREA'){
        el.textContent='';
      }else if(el.tagName==='SELECT'){
        el.querySelectorAll('option').forEach(option=>option.removeAttribute('selected'));
      }
      if(el.hasAttribute('srcdoc'))el.removeAttribute('srcdoc');
    });
    const head=clone.querySelector('head')||clone.insertBefore(document.createElement('head'),clone.firstChild);
    head.querySelectorAll('base,meta[http-equiv="Content-Security-Policy"],meta[http-equiv="refresh"]').forEach(el=>el.remove());
    const base=document.createElement('base');base.href=location.href;head.prepend(base);
    const freeze=document.createElement('style');
    freeze.id='bridge-rendered-capture';
    freeze.textContent='html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    head.append(freeze);
    const html='<!doctype html>\n'+clone.outerHTML;
    if(html.length>12000000)throw Error('Rendered page exceeds the 12 MB capture limit. Capture smaller sections instead.');
    // Surface unresolved placeholders; not every spinner is caused by motion.
    const unsettled=[...document.querySelectorAll('[aria-busy="true"],[class*="skeleton"],[class*="Skeleton"],[data-state="loading"]')]
      .filter(el=>{const r=el.getBoundingClientRect(),st=getComputedStyle(el);
        return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'}).length;
    return {html,source:location.href,nodes:sourceElements.length,observed,canvases,unsupportedCanvases,videos,unsettled};
  }finally{
    try{
      if(nested)nested.scrollTop=oldNested;
      const smoother=window.ScrollSmoother?.get?.();
      if(smoother)smoother.scrollTop(oldY,false);
      else if(window.lenis?.scrollTo)window.lenis.scrollTo(oldY,{immediate:true,force:true});
      window.scrollTo(oldX,oldY);
      window.ScrollTrigger?.update?.();
    }catch{}
  }
}
const captureRenderedButton=document.getElementById('captureRendered');
captureRenderedButton?.addEventListener('click',async()=>{
  if(running)return;
  running=true;captureRenderedButton.disabled=true;
  let blobUrl=null;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//i.test(tab.url||''))throw Error('Open an ordinary website tab to capture rendered HTML.');
    const motion=await chrome.runtime.sendMessage({target:'worker',type:'record-state'}).catch(()=>null);
    if(['recording','starting','saving'].includes(motion?.phase))throw Error('Stop the active video recording before capturing HTML.');
    setStatus('Capturing the rendered page and its scroll-reveal states…');
    const output=await chrome.scripting.executeScript({
      target:{tabId:tab.id},world:'MAIN',func:bridgeSnapshotRenderedDOM,
      args:[{sweep:document.getElementById('sweepRendered')?.checked!==false}]
    });
    const data=output?.[0]?.result;
    if(!data?.html)throw Error('The tab did not return a rendered document.');
    const blob=new Blob([data.html],{type:'text/html;charset=utf-8'});
    blobUrl=URL.createObjectURL(blob);
    const host=new URL(data.source).hostname.replace(/[^a-z0-9.-]/gi,'-');
    const id=await chrome.downloads.download({
      url:blobUrl,filename:'figma-bridge/'+host+'-rendered.html',saveAs:false,conflictAction:'uniquify'
    });
    if(typeof id!=='number')throw Error('Chrome did not start the HTML download.');
    const warning=(data.unsupportedCanvases?' '+data.unsupportedCanvases+' protected canvas(es) need PNG fallback.':'')
      +(data.unsettled?' '+data.unsettled+' loading placeholder(s) remained; inspect the source page or capture screenshots as a fallback.':'');
    setStatus('Rendered HTML download started ('+data.nodes+' DOM nodes). Import it in Bridge, then Copy to Figma.'+warning);
  }catch(error){
    setStatus('Rendered HTML capture failed: '+(error?.message||String(error)));
  }finally{
    running=false;captureRenderedButton.disabled=false;
    if(blobUrl)setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);
  }
});

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
      selectWorkflow('motion');
      setStatus('Recording '+result.format?.toUpperCase()+' in the active tab. You can close this popup and return to the page.');
    }else if(result.phase==='saving'){
      selectWorkflow('motion');
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
