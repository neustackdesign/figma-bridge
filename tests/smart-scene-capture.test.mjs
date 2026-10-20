import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const all=await fs.readFile('extension/popup.js','utf8');
const screenshotModule=all.split('/* Lightweight on-page diagnostics:')[0];
new vm.Script(screenshotModule,{filename:'extension/popup.js'});
assert.match(screenshotModule,/initialModel\?\.virtual/);
assert.match(screenshotModule,/captureSceneSheet\(tabId,hostname,format,saved\)/);
assert.match(screenshotModule,/setRepeatedChromeVisible\(tabId,false\)/);
assert.match(screenshotModule,/setRepeatedChromeVisible\(tabId,true\)/);
assert.match(screenshotModule,/Input\.dispatchMouseEvent/);

let status='',seenWheel=0,downloads=[],debuggerDetached=0,images=0;
const button={disabled:false,dataset:{format:'png'},addEventListener:(_event,handler)=>{button.click=handler;}};
const makeContext=()=>({
  image:null,drawImage(image){this.image=image;},
  clearRect(){},fillRect(){},fillText(){},set fillStyle(v){},set font(v){},
  getImageData(){
    const a=new Uint8ClampedArray(96*64*4);
    const colour=((this.image?.id||0)*97)%255;
    for(let i=0;i<a.length;i+=4){a[i]=colour;a[i+1]=20;a[i+2]=colour;a[i+3]=255;}
    return{data:a};
  }
});
const document={
  querySelector:()=>({set textContent(value){status=value;},get textContent(){return status;},set className(value){}}),
  querySelectorAll:()=>[button],
  createElement:tag=>{
    assert.equal(tag,'canvas');
    const ctx=makeContext();
    return{width:0,height:0,getContext:()=>ctx,toBlob:callback=>callback({size:2048})};
  }
};
const chrome={
  tabs:{query:async()=>[{id:4,url:'https://heronaiapp.com/'}]},
  debugger:{
    attach:async()=>{},detach:async()=>{debuggerDetached++;},
    sendCommand:async(_tab,method,params)=>{
      if(method==='Runtime.evaluate'){
        const e=params.expression;
        let value=true;
        if(e.includes('const d=document.documentElement, b=document.body||d'))
          value={width:1440,height:900,viewportWidth:1440,viewportHeight:900,scrollY:0,nestedY:0};
        if(e.includes('const de=document.documentElement,body=document.body||de'))
          value={virtual:true,tallPinned:0,triggerCount:41,hasCanvas:true,documentHeight:900,viewport:900};
        return{result:{value}};
      }
      if(method==='Input.dispatchMouseEvent'){seenWheel++;return{};}
      if(method==='Page.captureScreenshot')return{data:'ZHVtbXk='};
      return{};
    }
  },
  downloads:{download:async options=>{downloads.push(options);return 5;}}
};
class ImageMock{
  id=++images;width=1440;height=900;
  set src(value){assert.match(value,/^data:image\/png;base64,/);}
  async decode(){}
}
const URLMock=Object.assign(class extends URL{},{createObjectURL:()=> 'blob:bridge',revokeObjectURL:()=>{}});
const sandbox={document,chrome,Image:ImageMock,URL:URLMock,Date,Number,Math,JSON,Promise,Error,
  console,setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout};
vm.runInNewContext(screenshotModule,sandbox);
await button.click();
assert.ok(seenWheel>=7,'virtual-scene capture must advance with trusted wheel input');
assert.equal(downloads.length,1);
assert.match(downloads[0].filename,/heronaiapp\.com-animation-scene-sequence-.*\.png$/);
assert.match(status,/distinct scene states/);
assert.equal(debuggerDetached,1);
assert.equal(button.disabled,false);
console.log('Smart capture passed: virtual Heron-style site exports one labelled scene sheet and cleans debugger.');
