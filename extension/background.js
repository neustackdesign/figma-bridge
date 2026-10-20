/* Figma Bridge motion recording controller.
 * Stream acquisition and downloads remain in the extension service worker.
 * Pixel access and local encoding happen only in the offscreen document.
 */
const OFFSCREEN='record.html';
const state={phase:'idle',tabId:null,mode:null,format:null,startedAt:0,downloadId:null,error:null,lastFilename:null};
let creatingOffscreen=null;
const notify=async () => {
  const text=state.phase==='recording'?'REC':state.phase==='saving'?'SAVE':'';
  await chrome.action.setBadgeText({text});
  if(text)await chrome.action.setBadgeBackgroundColor({color:state.phase==='recording'?'#b13d2c':'#303030'});
};
async function ensureOffscreen(){
  const url=chrome.runtime.getURL(OFFSCREEN);
  const existing=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
  if(existing.length)return;
  if(!creatingOffscreen) creatingOffscreen=chrome.offscreen.createDocument({
    url:OFFSCREEN,reasons:['USER_MEDIA'],
    justification:'Record the active website tab and encode animation captures locally after a user action.'
  }).finally(()=>{creatingOffscreen=null;});
  await creatingOffscreen;
}
async function stopPageScroll(tabId){
  if(!tabId)return;
  try {
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
      window.__FIGMA_BRIDGE_STOP_MOTION__=true;
    }});
  }catch{} // Tab may have navigated or closed.
}
async function guideScroll(tabId,duration){
  try{
    await chrome.scripting.executeScript({
      target:{tabId},world:'MAIN',args:[duration],
      func:async durationMs=>{
        const sleep=ms=>new Promise(r=>setTimeout(r,ms));
        const originalX=scrollX,originalY=scrollY;
        window.__FIGMA_BRIDGE_STOP_MOTION__=false;
        const smoother=window.ScrollSmoother?.get?.();
        const containers=[...document.querySelectorAll('main,[data-scroll-container],[data-lenis-root],[data-scroll],#app')]
          .filter(el=>el.clientHeight>=innerHeight*.6 && el.clientWidth>=innerWidth*.6 && el.scrollHeight>el.clientHeight+150)
          .sort((a,b)=>b.scrollHeight-a.scrollHeight);
        const container=containers[0];
        const range=Math.max(0,document.documentElement.scrollHeight-innerHeight,document.body?.scrollHeight-innerHeight||0,container?.scrollHeight-container.clientHeight||0);
        const move=y=>{
          if(smoother)smoother.scrollTop(y,false);
          else{window.lenis?.scrollTo?.(y,{immediate:true,force:true});scrollTo({top:y,behavior:'instant'});}
          if(container&&scrollY<1)container.scrollTop=y;
          window.ScrollTrigger?.update?.();
        };
        try{
          move(0);
          await sleep(850);
          const start=performance.now(),travel=Math.max(1200,durationMs-1750);
          await new Promise(resolve=>{
            const frame=()=>{
              if(window.__FIGMA_BRIDGE_STOP_MOTION__)return resolve();
              const p=Math.min(1,(performance.now()-start)/travel);
              // Ease at the beginning/end without racing through middle sections.
              const eased=p<.08?(p*p)/.08:p>.92?1-(1-p)*(1-p)/.08:p;
              move(Math.round(range*Math.min(1,Math.max(0,eased))));
              if(p<1)requestAnimationFrame(frame);else resolve();
            };
            requestAnimationFrame(frame);
          });
          await sleep(500);
        }finally{
          move(originalY);
          if(container&&originalY===0)container.scrollTop=0;
          scrollTo(originalX,originalY);
          window.ScrollTrigger?.update?.();
          delete window.__FIGMA_BRIDGE_STOP_MOTION__;
        }
      }
    });
  }catch(error){
    console.warn('Bridge: guided scrolling unavailable:',error);
    // The recording remains a valid stationary tab capture; surface why it didn't scroll.
    state.error='Auto-scroll was blocked on this page. Try manual interaction mode.';
  }
}
async function startRecord(message){
  if(state.phase!=='idle')throw Error('A capture is already running. Stop it before starting another.');
  const tabId=Number(message.tabId);
  const tab=await chrome.tabs.get(tabId);
  if(!/^https?:\/\//.test(tab.url||''))throw Error('Open a normal website tab to record.');
  const format=message.format==='gif'?'gif':'mp4';
  const mode=['guided','fixed','manual'].includes(message.mode)?message.mode:'guided';
  const duration=Math.max(6,Math.min(format==='gif'?30:60,Number(message.duration)||20));
  const quality=format==='gif'?560:Number(message.quality)===1080?1080:720;
  state.phase='starting';state.tabId=tabId;state.mode=mode;state.format=format;state.error=null;state.downloadId=null;
  try{
    // Issue the privileged stream request while handling the explicit user gesture.
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tabId});
    await ensureOffscreen();
    const response=await chrome.runtime.sendMessage({target:'offscreen',type:'record-start',streamId,format,mode,duration,quality,hostname:new URL(tab.url).hostname});
    if(!response?.ok)throw Error(response?.error||'Could not start the offscreen recorder.');
    state.phase='recording';state.startedAt=Date.now();await notify();
    if(mode==='guided')void guideScroll(tabId,duration*1000);
    return{ok:true};
  }catch(error){
    state.phase='idle';state.tabId=null;await notify();
    try{await chrome.offscreen.closeDocument();}catch{}
    throw error;
  }
}
async function stopRecord(){
  if(state.phase!=='recording')return{ok:false,error:'No recording is active.'};
  await stopPageScroll(state.tabId);
  state.phase='saving';await notify();
  try{
    const response=await chrome.runtime.sendMessage({target:'offscreen',type:'record-stop'});
    if(!response?.ok)throw Error(response?.error||'Recorder did not respond.');
    return{ok:true};
  }catch(error){state.phase='recording';await notify();throw error;}
}
async function completeCapture(message){
  if(state.phase==='idle')return;
  state.phase='saving';await notify();
  await stopPageScroll(state.tabId);
  const hostname=(message.hostname||'website').replace(/[^a-z0-9.-]+/gi,'-').slice(0,70);
  const filename='figma-bridge/'+hostname+'-'+state.mode+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+state.format;
  try{
    const id=await chrome.downloads.download({url:message.url,filename,saveAs:false,conflictAction:'uniquify'});
    if(!Number.isInteger(id))throw Error('Download did not start.');
    state.downloadId=id;state.lastFilename=filename;
  }catch(error){
    state.error='Saving failed: '+(error.message||String(error));
    await finishCapture();
  }
}
async function finishCapture(){
  await stopPageScroll(state.tabId);
  try{await chrome.runtime.sendMessage({target:'offscreen',type:'record-release'});}catch{}
  try{await chrome.offscreen.closeDocument();}catch{}
  state.phase='idle';state.tabId=null;state.downloadId=null;await notify();
}
chrome.downloads.onChanged.addListener(delta=>{
  if(state.downloadId!==delta.id)return;
  if(delta.state?.current==='complete'||delta.state?.current==='interrupted'){
    if(delta.state.current==='interrupted')state.error='Chrome interrupted the recording download.';
    void finishCapture();
  }
});
chrome.tabs.onRemoved.addListener(tabId=>{if(tabId===state.tabId&&state.phase==='recording')void stopRecord();});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target!=='worker')return false;
  (async()=>{
    switch(message.type){
      case 'record-state':
        return {ok:true,phase:state.phase,mode:state.mode,format:state.format,startedAt:state.startedAt,error:state.error,filename:state.lastFilename};
      case 'record-start':return await startRecord(message);
      case 'record-stop':return await stopRecord();
      case 'record-ready':
        if(sender.url!==chrome.runtime.getURL(OFFSCREEN))return{ok:false,error:'Untrusted sender.'};
        await completeCapture(message);return{ok:true};
      case 'record-error':
        if(sender.url!==chrome.runtime.getURL(OFFSCREEN))return{ok:false};
        state.error=message.error||'Recording failed';await finishCapture();return{ok:true};
      case 'record-progress':
        if(sender.url!==chrome.runtime.getURL(OFFSCREEN))return{ok:false};
        if(message.phase==='encoding'){state.phase='saving';await notify();}
        return{ok:true};
      default:return{ok:false,error:'Unknown request.'};
    }
  })().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message||String(e)}));
  return true;
});
