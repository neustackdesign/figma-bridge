import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const ext='extension/';
const manifest=JSON.parse(readFileSync(ext+'manifest.json','utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(manifest.permissions.includes('tabCapture'));
assert.ok(manifest.permissions.includes('offscreen'));
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.permissions.includes('activeTab'));
assert.equal(manifest.background.service_worker,'background.js');
assert.equal(manifest.minimum_chrome_version,'116');
const popup=readFileSync(ext+'popup.html','utf8');
const popupScript=readFileSync(ext+'popup.js','utf8');
const offscreenSource=readFileSync(ext+'recorder.source.js','utf8');
const bundled=readFileSync(ext+'recorder.js','utf8');
for(const id of ['motionMode','motionFormat','motionDuration','motionQuality','startRecord','stopRecord'])
  assert.match(popup,new RegExp('id="'+id+'"'));
for(const mode of ['guided','fixed','manual'])
  assert.match(popup,new RegExp('value="'+mode+'"'));
assert.match(popup,/value="mp4"/);
assert.match(popup,/value="gif"/);
new Script(popupScript,{filename:'popup.js'});
new Script(readFileSync(ext+'background.js','utf8'),{filename:'background.js'});
new Script(bundled,{filename:'recorder.js'});
assert.match(offscreenSource,/new VideoEncoder/);
assert.match(offscreenSource,/new Muxer/);
assert.match(offscreenSource,/gif\.writeFrame/);
assert.match(offscreenSource,/navigator\.mediaDevices\.getUserMedia/);
assert.match(offscreenSource,/URL\.createObjectURL/);
assert.match(readFileSync(ext+'record.html','utf8'),/src="recorder.js"/);

// Validate a real GIF bitstream using the same GIF encoder bundled for the extension.
const width=4,height=4,pixels=new Uint8ClampedArray(width*height*4);
for(let i=0;i<pixels.length;i+=4){
  pixels[i]=(i/4)%2?255:0;pixels[i+1]=40;pixels[i+2]=180;pixels[i+3]=255;
}
const palette=quantize(pixels,16);
const gif=GIFEncoder();
gif.writeFrame(applyPalette(pixels,palette),width,height,{palette,delay:100,repeat:0});
gif.writeFrame(applyPalette(pixels,palette),width,height,{palette,delay:100});
gif.finish();
const gifBytes=gif.bytes();
assert.equal(Buffer.from(gifBytes.slice(0,6)).toString(),'GIF89a');
assert.ok(gifBytes.length>60);

// Simulate service worker lifecycle, preventing external tabs or downloads.
let requestHandler,downloadHandler,badge=[],downloadArgs,offscreenCreated=0,offscreenClosed=0;
const mockChrome={
  runtime:{
    getURL:p=>'chrome-extension://bridge/'+p,
    getContexts:async()=>offscreenCreated&&!offscreenClosed?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
    sendMessage:async msg=>{
      if(msg.target==='offscreen'){
        if(msg.type==='record-start')return {ok:true};
        if(msg.type==='record-stop')return {ok:true};
        if(msg.type==='record-release')return {ok:true};
      }
      throw Error('Unexpected offscreen message');
    },
    onMessage:{addListener:fn=>{requestHandler=fn;}},
  },
  tabCapture:{getMediaStreamId:async()=> 'tab-stream-test'},
  tabs:{get:async id=>({id,url:'https://koto.com/'}),onRemoved:{addListener:()=>{}}},
  offscreen:{createDocument:async()=>{offscreenCreated++;offscreenClosed=0;},closeDocument:async()=>{offscreenClosed++;}},
  scripting:{executeScript:async()=>[{result:true}]},
  action:{setBadgeText:async x=>badge.push(x.text),setBadgeBackgroundColor:async()=>{}},
  downloads:{download:async opts=>{downloadArgs=opts;return 5;},onChanged:{addListener:fn=>{downloadHandler=fn;}}},
};
runInNewContext(readFileSync(ext+'background.js','utf8'),{chrome:mockChrome,console,Date,Number,URL,Promise,setTimeout,clearTimeout},{filename:'background.js'});
const dispatch=message=>new Promise((resolve,reject)=>{
  const result=requestHandler(message,{url:message.type==='record-ready'||message.type==='record-error'?'chrome-extension://bridge/record.html':'chrome-extension://bridge/popup.html'},resolve);
  if(result!==true)reject(Error('Background listener must keep the response port alive.'));
});
const started=await dispatch({target:'worker',type:'record-start',tabId:7,mode:'fixed',format:'mp4',duration:10,quality:720});
assert.equal(started.ok,true);
assert.equal(offscreenCreated,1);
assert.ok(badge.includes('REC'));
const stop=await dispatch({target:'worker',type:'record-stop'});
assert.equal(stop.ok,true);
assert.ok(badge.includes('SAVE'));
const ready=await dispatch({target:'worker',type:'record-ready',url:'blob:chrome-extension://bridge/sample',hostname:'koto.com'});
assert.equal(ready.ok,true);
assert.match(downloadArgs.filename,/\.mp4$/);
assert.equal(downloadArgs.saveAs,false);
downloadHandler({id:5,state:{current:'complete'}});
await new Promise(r=>setTimeout(r,20));
assert.equal(offscreenClosed,1,'offscreen must close after download completes');
const after=await dispatch({target:'worker',type:'record-state'});
assert.equal(after.phase,'idle');

// The format-specific GIF duration cap is enforced by source and control state.
assert.match(readFileSync(ext+'recorder.source.js','utf8'),/Math\.min\(30,options\.duration\)/);
console.log('Motion recording checks passed: MV3 permissions, bundled code syntax, genuine GIF bitstream, start/stop/download/cleanup.');
