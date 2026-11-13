import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

// Extract the actual extension-injected function rather than duplicating logic.
const popup=readFileSync('extension/popup.js','utf8');
const start=popup.indexOf('async function bridgeSnapshotRenderedDOM(');
const end=popup.indexOf('\nconst captureRenderedButton=',start);
assert.ok(start>0&&end>start,'Rendered DOM capture function must be exported to the Chrome popup');
const captureSource=popup.slice(start,end).trim();
assert.match(readFileSync('extension/popup.html','utf8'),/id="captureRendered"/);

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:900,height:600}});
  await page.setContent(`<!doctype html><html><head><style>
    #spacer{height:1600px}.reveal{opacity:0;transition:opacity .1s}
    #moving{animation:move 1s linear infinite}
    @keyframes move{from{transform:translateX(0)}to{transform:translateX(30px)}}
    </style></head><body>
    <h1>Hydrated page</h1><input type="text" value="hidden-input-secret">
    <textarea>hidden-textarea-secret</textarea>
    <button onclick="alert('should not execute')">Click</button>
    <canvas id="art" width="100" height="60"></canvas>
    <div id="moving">Animation</div>
    <div id="spacer"></div>
    <div id="expanding" style="width:0%;opacity:1;height:120px">
      <p>Scroll-controlled content panel containing a full row of six cards, titles,
      imagery and product descriptions. Its parent may collapse when the scroll
      sequence returns to the top, but the saved design must not lose this section.</p>
    </div><div id="lazy" class="reveal">Loaded after scroll</div>
    <p id="delayed">Still loading</p>
    <script>document.body.append(Object.assign(document.createElement('p'),{id:'hydrated',textContent:'Client-rendered content'}));
      let started=false;
      addEventListener('scroll',()=>{
        document.getElementById('lazy').style.opacity=scrollY>80?'1':'0';
        document.getElementById('expanding').style.width=scrollY>1000?'100%':'0%';
        if(scrollY>1000&&!started){
          started=true;
          setTimeout(()=>{document.getElementById('delayed').textContent='Async content loaded';},470);
        }
      });</script>
  </body></html>`);
  await page.evaluate(()=>{
    const ctx=document.querySelector('#art').getContext('2d');
    ctx.fillStyle='red';ctx.fillRect(0,0,100,60);
  });
  const captured=await page.evaluate(src=>(0,eval)('('+src+')')({sweep:true}),captureSource);
  assert.ok(captured.html.startsWith('<!doctype html>'));
  assert.match(captured.html,/id="hydrated"/,'Hydrated JavaScript DOM must survive');
  assert.doesNotMatch(captured.html,/<script\b/i,'Executable scripts must be removed');
  assert.doesNotMatch(captured.html,/on(?:click|load)=/i,'Event handlers must be removed');
  assert.doesNotMatch(captured.html,/hidden-(?:input|textarea)-secret/,'Private input contents must not be serialized');
  assert.ok(captured.html.includes('data:image/png;base64,'),'Canvas pixels should be rasterized inline');
  assert.equal(captured.canvases,1);
  assert.equal(captured.unsupportedCanvases,0);
  assert.ok(captured.observed>0,'Scroll reveal should have been observed');
  assert.match(captured.html,/Async content loaded/,'Gradual priming must wait for delayed near-footer content');
  assert.equal(captured.repairedSections,1,'Expanded content should be restored from its observed scroll state');
  assert.equal(captured.collapsedSections,0,'Restored section is no longer collapsed');
  assert.match(captured.html,/id="expanding"[^>]*style="[^"]*width:\s*[0-9.]+px\s*!important/i,
    'The cloned panel must not retain the zero-width animated end state');
  const noSweep=await page.evaluate(src=>(0,eval)('('+src+')')({sweep:false}),captureSource);
  assert.equal(noSweep.repairedSections,0,'Must not invent geometry that was never observed');
  assert.equal(noSweep.collapsedSections,1,'Unresolved collapsed section should be reported to the user');

  assert.match(captured.html,/id="lazy"[^>]*style="[^"]*opacity:\s*1\s*!important/i,'Observed reveal must remain visible');
  assert.match(captured.html,/id="bridge-rendered-capture"/,'Motion is frozen in the static import');
  const scroll=await page.evaluate(()=>scrollY);
  assert.equal(scroll,0,'Original page scroll position must be restored');
  console.log('Live DOM snapshot regression passed: hydration, delayed loading, expanded geometry, fallback reporting, sanitization and restoration.');
}finally{
  await browser.close();
}
