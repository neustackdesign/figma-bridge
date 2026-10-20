import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html=await fs.readFile('plugin/ui.html','utf8');
const manifest=JSON.parse(await fs.readFile('plugin/manifest.json','utf8'));
const popup=await fs.readFile('extension/popup.html','utf8');
const popupScript=await fs.readFile('extension/popup.js','utf8');
const background=await fs.readFile('extension/background.js','utf8');

assert.equal(manifest.name,'Figma Bridge');
assert.equal(manifest.ui,'ui.html');
for(const panel of ['overview','import','capture','export']){
  assert.match(html,new RegExp('id="panel-'+panel+'"'),'missing Figma workflow '+panel);
  assert.match(html,new RegExp('data-tab="'+panel+'"'),'missing Figma tab '+panel);
}
for(const link of ['https://bridge.neustackstudio.com/','https://github.com/neustackdesign/figma-bridge/actions/workflows/motion-capture.yml'])
  assert.ok(html.includes(link),'missing external workflow handoff: '+link);
assert.match(html,/id="export"/);
assert.match(html,/type:'export-html'/);
assert.match(html,/target="_blank"/);

for(const id of ['sceneFrames','inspectPage','motionMode','motionFormat','motionDriver','motionDuration','motionQuality','startRecord','stopRecord']){
  assert.ok(popup.includes('id="'+id+'"'),'missing UI control '+id);
}
for(const mode of ['guided','fixed','manual'])assert.ok(popup.includes('value="'+mode+'"'));
for(const driver of ['wheel','position'])assert.ok(popup.includes('value="'+driver+'"'));
assert.match(popupScript,/captureSceneFrames/);
assert.match(popupScript,/Input.dispatchMouseEvent/);
assert.match(popupScript,/waitForIntro/);
assert.match(popupScript,/fullscreenSequence/);
assert.match(background,/guideWheel/);
assert.match(background,/Input.dispatchMouseEvent/);
assert.match(background,/record-heartbeat/);
new vm.Script(popupScript,{filename:'popup.js'});
new vm.Script(background,{filename:'background.js'});
const extracted=html.match(/<script>([\s\S]+?)<\/script>/);
assert.ok(extracted,'Figma plugin UI script missing');
new vm.Script(extracted[1],{filename:'plugin/ui.html'});
console.log('Bridge UX checks passed: unified Figma navigation, real destinations, PNG/JPG and scene frames, motion drivers, diagnostics and worker heartbeat.');
