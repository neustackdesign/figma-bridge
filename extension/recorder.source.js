/* Build: npm run build:extension
 * Source for the MV3 offscreen recorder. All encoding and media acquisition is local.
 * Dependencies are bundled at build time; the extension loads no remote scripts.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

let session=null;
let objectUrl=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const notify=async(type,extra={})=>{
  try{await chrome.runtime.sendMessage({target:'worker',type,...extra});}
  catch(e){console.warn('Bridge recorder notification failed',e);}
};
function dimensions(sourceWidth,sourceHeight,quality,format){
  const maxW=format==='gif'?560:quality===1080?1920:1280;
  const maxH=format==='gif'?560:quality===1080?1080:720;
  const scale=Math.min(1,maxW/sourceWidth,maxH/sourceHeight);
  return{width:Math.max(2,Math.floor(sourceWidth*scale/2)*2),
         height:Math.max(2,Math.floor(sourceHeight*scale/2)*2)};
}
async function start(message){
  if(session)throw Error('A motion recording is already active.');
  if(!message.streamId)throw Error('Chrome did not provide a tab capture stream ID.');
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  const options={
    format:message.format==='gif'?'gif':'mp4',
    duration:Math.max(6,Math.min(60,Number(message.duration)||20)),
    quality:Number(message.quality)||720,
    hostname:(message.hostname||'website').replace(/[^a-z0-9.-]+/gi,'-')
  };
  if(options.format==='gif')options.duration=Math.min(30,options.duration);
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{mandatory:{
        chromeMediaSource:'tab',
        chromeMediaSourceId:message.streamId,
        maxWidth:1920,maxHeight:1080,maxFrameRate:30
      }}
    });
    const video=document.createElement('video');
    video.muted=true;video.autoplay=true;video.playsInline=true;
    video.srcObject=stream;
    await Promise.race([
      new Promise((resolve,reject)=>{
        video.addEventListener('loadedmetadata',resolve,{once:true});
        video.addEventListener('error',()=>reject(Error('Tab video stream failed.')),{once:true});
      }),
      sleep(6000).then(()=>{throw Error('Timed out acquiring tab video.');})
    ]);
    await video.play();
    if(!video.videoWidth||!video.videoHeight)throw Error('Captured tab has no video dimensions.');
    const {width,height}=dimensions(video.videoWidth,video.videoHeight,options.quality,options.format);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:options.format==='gif'});
    if(!ctx)throw Error('Cannot allocate the local video frame buffer.');
    let encoder=null,muxer=null,gif=null;
    const fps=options.format==='gif'?8:24;
    if(options.format==='mp4'){
      if(!globalThis.VideoEncoder)throw Error('H.264 encoding is unavailable in this Chrome version.');
      const base={width,height,framerate:fps,bitrate:options.quality===1080?6000000:3200000,latencyMode:'quality',avc:{format:'avc'}};
      const configs=['avc1.420028','avc1.4d4028','avc1.42001f'].map(codec=>({...base,codec}));
      let config;
      for(const option of configs){
        try{const info=await VideoEncoder.isConfigSupported(option);if(info.supported){config=info.config;break;}}
        catch{}
      }
      if(!config)throw Error('This browser has no supported H.264 encoder for '+width+' × '+height+'.');
      muxer=new Muxer({target:new ArrayBufferTarget(),video:{codec:'avc',width,height},fastStart:'in-memory'});
      encoder=new VideoEncoder({
        output:(chunk,metadata)=>muxer.addVideoChunk(chunk,metadata),
        error:error=>{if(session)session.failure=error?.message||String(error);}
      });
      encoder.configure(config);
    }else{
      gif=GIFEncoder();
    }
    const active={
      ...options,stream,video,canvas,ctx,width,height,fps,gif,encoder,muxer,
      started:performance.now(),lastSample:-Infinity,frames:0,raf:null,timer:null,
      stopping:false,failure:null,ended:false,heartbeat:null
    };
    session=active;
    // MV3 service workers may suspend during fixed/manual recordings with no
    // active debugger traffic. Ping while the offscreen stream is alive.
    active.heartbeat=setInterval(()=>void notify('record-heartbeat'),10000);
    stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{
      if(session===active&&!active.stopping)void stop('The captured tab stopped sharing.');
    }));
    const interval=1000/fps;
    const captureFrame=timestamp=>{
      if(session!==active||active.stopping)return;
      try{
        if(active.failure)throw Error(active.failure);
        if(timestamp-active.lastSample>=interval*.9){
          active.lastSample=timestamp;
          ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
          ctx.drawImage(video,0,0,width,height);
          if(options.format==='gif'){
            const pixels=ctx.getImageData(0,0,width,height);
            const palette=quantize(pixels.data,128);
            const index=applyPalette(pixels.data,palette);
            gif.writeFrame(index,width,height,{palette,delay:Math.round(interval),repeat:0});
          }else if(encoder.encodeQueueSize<8){
            const elapsed=Math.max(0,Math.round((timestamp-active.started)*1000));
            const frame=new VideoFrame(canvas,{timestamp:elapsed});
            try{encoder.encode(frame,{keyFrame:active.frames%48===0});}
            finally{frame.close();}
          }
          active.frames++;
        }
      }catch(error){
        active.failure=error?.message||String(error);
        void stop();
        return;
      }
      active.raf=requestAnimationFrame(captureFrame);
    };
    active.raf=requestAnimationFrame(captureFrame);
    active.timer=setTimeout(()=>void stop(),options.duration*1000);
    return{ok:true,width,height,fps,duration:options.duration};
  }catch(error){
    stream?.getTracks().forEach(t=>t.stop());
    if(session){session=null;}
    throw error;
  }
}
async function stop(reason=null){
  const active=session;
  if(!active||active.stopping)return{ok:true};
  active.stopping=true;
  clearTimeout(active.timer);
  clearInterval(active.heartbeat);
  if(active.raf!==null)cancelAnimationFrame(active.raf);
  // Release capture as soon as frame sampling has stopped.
  active.stream.getTracks().forEach(track=>track.stop());
  try{
    if(active.failure)throw Error(active.failure);
    if(active.frames===0)throw Error('No animation frames were captured. Keep the target tab visible.');
    await notify('record-progress',{phase:'encoding'});
    let blob;
    if(active.format==='gif'){
      active.gif.finish();
      blob=new Blob([active.gif.bytes()],{type:'image/gif'});
    }else{
      await active.encoder.flush();
      active.muxer.finalize();
      blob=new Blob([active.muxer.target.buffer],{type:'video/mp4'});
    }
    if(blob.size<64)throw Error('Video encoding produced an empty file.');
    if(active.format==='gif'&&blob.size>50*1024*1024)throw Error('GIF exceeded 50 MB. Record a shorter clip or use MP4.');
    objectUrl=URL.createObjectURL(blob);
    await notify('record-ready',{url:objectUrl,hostname:active.hostname,size:blob.size,reason});
  }catch(error){
    await notify('record-error',{error:error?.message||String(error)});
  }finally{
    try{active.encoder?.close();}catch{}
    active.video.pause();active.video.srcObject=null;
    session=null;
  }
  return{ok:true};
}
function release(){
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  return{ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.target!=='offscreen')return false;
  (async()=>{
    switch(message.type){
      case 'record-start':return await start(message);
      case 'record-stop':void stop();return{ok:true};
      case 'record-release':return release();
      default:return{ok:false,error:'Unsupported recording message.'};
    }
  })().then(reply).catch(error=>reply({ok:false,error:error?.message||String(error)}));
  return true;
});
