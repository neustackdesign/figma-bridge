import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const manifest=JSON.parse(await fs.readFile('extension/manifest.json','utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('downloads'));
assert.ok(manifest.permissions.includes('activeTab'));

const index=await fs.readFile('index.html','utf8');
const inline=index.match(/<script type="module">\s*(const \$=[\s\S]*?)<\/script>/);
assert.ok(inline,'browser app script not found');
new vm.Script(inline[1],{filename:'index.html inline'});
assert.match(inline[1],/captureLivePage\.toString\(\)\.replace/,'bookmarklet should be derived from live capture function');
assert.match(inline[1],/navigator\.clipboard\.write\(\[payload\]\)/,'bookmarklet must use a fresh click for the clipboard');
assert.match(index,/Full-page PNG \/ JPG/,'export discovery missing');

const fullSource=await fs.readFile('extension/popup.js','utf8');
new vm.Script(fullSource,{filename:'extension/popup.js'});
// Screenshot fixture supplies only the original screenshot UI mocks; motion gets its own suite.
const source=fullSource.split('/* Motion recording is independent of full-page still-image capture. */')[0];

async function scenario({format='png',screenshotError=false}={}){
  const captured={scrolls:[],draws:[],download:null,attached:0,detached:0,screenshotCount:0,status:''};
  let currentY=70;
  const height=950,viewportHeight=400,viewportWidth=600;
  const statusNode={set textContent(v){captured.status=v;},get textContent(){return captured.status;}};
  const buttons=[{dataset:{format:'png'}},{dataset:{format:'jpeg'}}].map(button=>{
    button.disabled=false;
    button.addEventListener=(_type,callback)=>{button.click=callback;};
    return button;
  });
  const ctx={
    drawImage:(_image,_a,_b,_c,_d,x,y,w,h)=>{captured.draws.push({x,y,w,h});},
    fillRect(){},
    set fillStyle(_value){}
  };
  const canvas={
    width:0,height:0,
    getContext:()=>ctx,
    toBlob:(callback,type)=>callback({type,size:12000})
  };
  const document={
    querySelector:()=>statusNode,
    querySelectorAll:()=>buttons,
    createElement:(tag)=>{assert.equal(tag,'canvas');return canvas;}
  };
  const chrome={
    tabs:{query:async()=>[{id:7,url:'https://koto.com/'}]},
    debugger:{
      attach:async()=>{captured.attached++;},
      detach:async()=>{captured.detached++;},
      sendCommand:async(_target,method,parameters)=>{
        if(method==='Runtime.evaluate'){
          const expression=parameters.expression;
          let value;
          if(expression.includes('const d=document.documentElement')){
            value={width:viewportWidth,height,viewportHeight,viewportWidth,scrollX:0,scrollY:currentY};
          }else if(expression.includes('const y=')){
            const requested=Number(expression.match(/const y=(\d+);/)?.[1]??0);
            currentY=Math.min(requested,height-viewportHeight);
            captured.scrolls.push(currentY);
            value=currentY;
          }else if(expression.includes('Math.max(0,scrollY||0)')){
            value=currentY;
          }else value=true;
          return {result:{value}};
        }
        if(method==='Page.captureScreenshot'){
          captured.screenshotCount++;
          return screenshotError?{}:{data:'aGVsbG8='};
        }
        return {};
      }
    },
    downloads:{download:async(args)=>{captured.download=args;return 15;}}
  };
  class MockImage{
    width=600;height=400;
    set src(value){assert.match(value,/^data:image\/png;base64,/);}
    decode(){return Promise.resolve();}
  }
  const URLMock=Object.assign(class extends URL {},{
    createObjectURL:()=> 'blob:extension-image',
    revokeObjectURL:()=>{}
  });
  const sandbox={document,chrome,Image:MockImage,URL:URLMock,console,
    setTimeout:(callback,ms)=>ms===60000?0:setTimeout(callback,ms),
    clearTimeout:handle=>{if(handle)clearTimeout(handle);},
    Date,Math,JSON,Promise,Error
  };
  vm.runInNewContext(source,sandbox,{filename:'extension/popup.js'});
  await buttons[format==='png'?0:1].click();
  assert.equal(captured.attached,1);
  assert.equal(captured.detached,1,'debugger must detach even after failure');
  assert.equal(currentY,70,'original scroll location must be restored');
  assert.equal(buttons.every(button=>button.disabled===false),true);
  return captured;
}

const png=await scenario();
assert.equal(png.screenshotCount,3);
assert.equal(png.draws.length,3);
assert.deepEqual(png.draws.map(x=>x.y),[0,400,550]);
assert.match(png.download.filename,/\.png$/);
assert.equal(png.download.saveAs,false);
assert.match(png.status,/Export ready/);

const jpeg=await scenario({format:'jpeg'});
assert.equal(jpeg.download.filename.endsWith('.jpg'),true);
assert.match(jpeg.status,/JPG/);

const failed=await scenario({screenshotError:true});
assert.equal(failed.download,null);
assert.match(failed.status,/Export failed/);

console.log('Animated capture assertions passed: HTML syntax, extension manifest, PNG/JPEG export, scroll stitching, failure cleanup.');
