import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Regression for imported Claude/Playlab multi-screen HTML bundles.
// Runtime completion, visible preview, populated encoded artwork and clipboard all matter.
const ids=['screen-1','screen-2','screen-3','screen-4'];
const manifest={};
for(let i=0;i<ids.length;i++){
  const page='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:16px Arial,sans-serif;background:#edf2f8;width:1440px;height:900px">'+
    '<header style="background:#027bc7;color:#fff;padding:28px;font-size:26px">Teacher builder — screen '+(i+1)+'</header>'+
    '<main style="padding:40px"><section style="background:#fff;min-height:560px;padding:30px;border:1px solid #bbb">'+
    '<h1>Editable heading '+(i+1)+'</h1><p>Four independent bundled screens with content.</p>'+
    '<button style="background:#027bc7;color:#fff;padding:18px">Continue</button>'+
    '<p>Designing decisions for classroom learning and student evidence.</p>'+
    '</section></main></body></html>';
  manifest[ids[i]]={mime:'text/html',compressed:true,data:gzipSync(Buffer.from(page)).toString('base64')};
}
const document='<!doctype html><html><head><meta charset="utf-8"></head><body>'+
  '<script type="__bundler/page_order">'+JSON.stringify(ids)+'</script>'+
  '<script type="__bundler/manifest">'+JSON.stringify(manifest)+'</script>'+
  '</body></html>';

const out=path.resolve('tests/clipboard-proof');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1512,height:1000},permissions:['clipboard-read','clipboard-write']});
const browserErrors=[];
page.on('pageerror',error=>browserErrors.push(error.message));
await page.addInitScript(()=>{
  window.__figmaClipboard=[];
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    write:async items=>{
      for(const item of items)for(const type of item.types){
        const blob=await item.getType(type);
        window.__figmaClipboard.push({type,bytes:blob.size});
      }
    },writeText:async()=>{}
  }});
});
try{
  await page.goto('http://127.0.0.1:3200/',{waitUntil:'domcontentloaded'});
  await page.locator('#htmlInput').setInputFiles({
    name:'classroom-ready-trial.html',
    mimeType:'text/html',
    buffer:Buffer.from(document)
  });
  await page.waitForFunction(()=>{
    const status=document.querySelector('#status')?.textContent||'';
    return status.includes('Ready: 4 editable screen frames') || /import failed|Conversion failed/i.test(status);
  },null,{timeout:180000});
  const status=await page.locator('#status').innerText();
  assert.match(status,/Ready: 4 editable screen frames/, 'The real bundled HTML path failed: '+status);
  assert.equal(await page.locator('#copyFigma').isEnabled(),true);
  for(let i=1;i<=4;i++){
    const frame=page.frameLocator('#bridgeBundledScreens iframe:nth-child('+i+')');
    assert.equal(await frame.locator('img[data-bridge-visual-reference]').count(),1,'Missing bitmap reference');
    assert.equal(await frame.getByRole('heading',{name:'Editable heading '+i}).count(),1,'Missing editable content');
  }
  await page.locator('#copyFigma').click();
  await page.waitForFunction(()=>/Copied 4 editable frames/.test(document.querySelector('#status')?.textContent||''),{timeout:5000});
  const result=await page.evaluate(()=>window.__figmaClipboard);
  assert.ok(result.some(x=>x.type==='text/html'&&x.bytes>6000),'Figma clipboard payload missing or undersized');
  assert.equal(browserErrors.filter(x=>/ReferenceError|capture is not defined/.test(x)).length,0,'Unhandled JavaScript ReferenceError');
  await page.screenshot({path:path.join(out,'packaged-import-ready.png')});
  console.log(JSON.stringify({passed:true,frames:4,clipboard:result,status,browserErrors},null,2));
}catch(error){
  await page.screenshot({path:path.join(out,'packaged-import-failed.png')}).catch(()=>{});
  console.error(JSON.stringify({passed:false,error:String(error),status:await page.locator('#status').innerText().catch(()=>''),browserErrors},null,2));
  process.exitCode=1;
}finally{await browser.close();}
