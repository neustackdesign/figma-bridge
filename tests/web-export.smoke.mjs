import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1512,height:950},acceptDownloads:true});
const results=[];
const out=path.resolve('tests/web-export-proof');
await fs.mkdir(out,{recursive:true});
async function download(format){
  await page.locator('#exportFormat').selectOption(format);
  const pending=page.waitForEvent('download',{timeout:60000});
  await page.locator('#exportBtn').click();
  const item=await pending;
  const file=path.join(out,'output-'+format+'.'+format);
  await item.saveAs(file);
  const bytes=await fs.readFile(file);
  results.push({format,filename:item.suggestedFilename(),size:bytes.length,status:await page.locator('#status').innerText()});
  return bytes;
}
try{
  await page.goto('http://127.0.0.1:3200/',{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#copyFigma').isDisabled(),true);
  assert.equal(await page.locator('#exportBtn').isDisabled(),true);
  for(const label of ['Get Figma HTML exporter','Install Chrome capture extension']){
    assert.equal(await page.getByRole('link',{name:label}).count(),1,'Missing companion discovery: '+label);
  }
  await page.getByRole('button',{name:'Paste HTML / SVG'}).click();
  await page.locator('#pasteInput').fill('<!doctype html><html><head><title>Export check</title><style>body{margin:0;background:#fff}main{padding:35px}h1{color:#124b38}</style></head><body><main><h1>Standalone proof</h1><p>Copy remains usable.</p></main></body></html>');
  await page.locator('#renderPaste').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Ready:'),{timeout:20000});
  assert.equal(await page.locator('#copyFigma').isEnabled(),true,'Figma copy path was disabled');
  assert.equal(await page.locator('#exportBtn').isEnabled(),true);
  const html=String(await download('html'));
  assert.match(html,/Standalone proof/);
  assert.match(html,/data-figma-bridge-export="static"/);
  assert.match(html,/h1\{color:#124b38\}/);
  assert.doesNotMatch(html,/<script/i,'Snapshot must not execute third-party scripts');
  const png=await download('png');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Invalid PNG header');
  assert.ok(png.readUInt32BE(16)>=1440,'Image capture width unexpectedly cropped');
  const jpg=await download('jpg');
  assert.equal(jpg.subarray(0,2).toString('hex'),'ffd8','Invalid JPG header');
  const pdf=await download('pdf');
  assert.ok(pdf.subarray(0,8).toString().startsWith('%PDF-'),'Invalid PDF header');
  // Exercise absolute resource bundling and stylesheet URL rewriting without public network fixtures.
  await page.route('**/api/proxy?**',async route=>{
    const target=new URL(route.request().url());
    if(target.searchParams.get('mode')==='stylesheet'){
      return route.fulfill({contentType:'text/css',headers:{'X-Final-Url':'https://assets.example/design.css'},body:'h1{background-image:url("pixel.png")}'});
    }
    if(target.searchParams.get('mode')==='asset'){
      return route.fulfill({contentType:'image/png',body:png});
    }
    if(target.searchParams.get('mode')==='html'){
      const data={html:'<!doctype html><html><head><title>Remote fixture</title><link rel="stylesheet" href="https://assets.example/design.css"></head><body><h1>Imported URL proof</h1><img src="https://assets.example/pixel.png"></body></html>',finalUrl:'https://assets.example/landing'};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    return route.continue();
  });
  const packaged=await page.evaluate(async()=>{
    const {bundleSnapshot}=await import('/exporter/snapshot.js');
    const content='<html><head><link rel="stylesheet" href="https://assets.example/design.css"></head><body><img src="https://assets.example/pixel.png"><h1>assets</h1><script>alert("never execute")</script></body></html>';
    return bundleSnapshot(content,'https://assets.example/');
  });
  assert.ok(packaged.assets>=2);
  assert.match(packaged.html,/data:image\/png;base64,/);
  assert.doesNotMatch(packaged.html,/https:\/\/assets\.example\/design\.css/);
  assert.doesNotMatch(packaged.html,/<script/);
  // Server-HTML URL import, relative asset resolution and standalone download.
  await page.getByRole('button',{name:'Website URL'}).click();
  await page.locator('#urlInput').fill('https://assets.example/landing');
  await page.locator('#loadUrl').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Ready:'),{timeout:20000});
  const importedHTML=String(await download('html'));
  assert.match(importedHTML,/Imported URL proof/);
  assert.match(importedHTML,/data:image\/png;base64,/);
  // Source PDF remains byte-for-byte original after importing/reconstructing it.
  await page.getByRole('button',{name:'PDF',exact:true}).click();
  await page.locator('#pdfInput').setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer:pdf});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Ready: 1 PDF'),{timeout:30000});
  const restoredPdf=await download('pdf');
  assert.deepEqual(restoredPdf,pdf,'Original PDF bytes were unnecessarily changed');
  results.push({format:'pdf-reimport',passed:true,size:restoredPdf.length});
  // JavaScript-backed uploaded artifacts remain sandboxed, but export a static DOM result.
  await page.getByRole('button',{name:'Paste HTML / SVG'}).click();
  await page.locator('#pasteInput').fill('<html><head><style>body{margin:0}</style></head><body><main id="result">Loading…</main><script>document.getElementById("result").textContent="Rendered by script"</script></body></html>');
  await page.locator('#renderPaste').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Ready:'),{timeout:35000});
  const scriptedHTML=String(await download('html'));
  assert.match(scriptedHTML,/Rendered by script/);
  assert.doesNotMatch(scriptedHTML,/<script/i);
  results.push({format:'scripted-dom',passed:true});
  await page.locator('#clearBtn').click();
  assert.equal(await page.locator('#exportBtn').isDisabled(),true);
  assert.equal(await page.locator('#copyFigma').isDisabled(),true);
  await page.screenshot({path:path.join(out,'web-export-ui.png'),fullPage:false});
  console.log(JSON.stringify({passed:true,results,assetTest:true,baselineProtected:true},null,2));
}catch(error){
  console.error(JSON.stringify({passed:false,results,error:String(error),status:await page.locator('#status').innerText().catch(()=>null)},null,2));
  await page.screenshot({path:path.join(out,'web-export-failed.png')}).catch(()=>{});
  process.exitCode=1;
}finally{await browser.close();}
