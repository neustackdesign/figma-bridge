import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const html=readFileSync('extension/popup.html','utf8');
const js=readFileSync('extension/popup.js','utf8');
const manifest=JSON.parse(readFileSync('extension/manifest.json','utf8'));
assert.equal(manifest.version,'0.3.4');
for(const name of ['design','images','motion']){
  assert.match(html,new RegExp('id="tab-'+name+'"'));
  assert.match(html,new RegExp('id="panel-'+name+'"'));
  assert.match(html,new RegExp('data-workflow-panel="'+name+'"'));
}
for(const id of ['captureRendered','sweepRendered','sceneFrames','inspectPage','startRecord','stopRecord']){
  assert.match(html,new RegExp('id="'+id+'"'));
}
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:400,height:650}});
  await page.setContent(html.replace('<script src="popup.js"></script>',''));
  await page.evaluate(()=>{
    window.chrome={
      runtime:{getManifest:()=>({version:'0.3.4'}),sendMessage:async()=>({ok:true,phase:'idle'})},
      tabs:{query:async()=>[{id:1,url:'https://chowdeck.com/'}]}
    };
  });
  await page.addScriptTag({content:js});
  assert.equal(await page.locator('#buildVersion').textContent(),'v0.3.4');
  await page.waitForFunction(()=>document.querySelector('#tabSite').textContent==='chowdeck.com');
  assert.equal(await page.locator('#tab-design').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#panel-design').isVisible(),true);
  assert.equal(await page.locator('#panel-images').isVisible(),false);
  await page.locator('#tab-images').click();
  assert.equal(await page.locator('#tab-images').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#panel-images').isVisible(),true);
  assert.equal(await page.locator('#panel-design').isVisible(),false);
  await page.locator('#tab-images').press('ArrowRight');
  assert.equal(await page.locator('#tab-motion').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#panel-motion').isVisible(),true);
  await page.locator('#tab-motion').press('Home');
  assert.equal(await page.locator('#tab-design').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#panel-design').isVisible(),true);
  // Clear state indicators are not merely text; they expose capture results.
  await page.evaluate(()=>setStatus('Capture completed',false,true));
  assert.equal(await page.locator('#statusPanel').getAttribute('data-state'),'success');
  await page.evaluate(()=>setStatus('Capture failed',true));
  assert.equal(await page.locator('#statusPanel').getAttribute('data-state'),'error');
  assert.equal(await page.locator('#status').textContent(),'Capture failed');
  console.log('Companion UI passed: version, active website, tabs, keyboard navigation, capture controls and status.');
}finally{
  await browser.close();
}