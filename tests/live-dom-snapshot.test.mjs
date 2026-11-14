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
  // A page that continues expanding must return a partial warning instead of
  // holding the extension popup indefinitely.
  await page.evaluate(()=>{document.body.style.minHeight='16000px';});
  const bounded=await page.evaluate(src=>(0,eval)('('+src+')')({sweep:true,maxSweepMs:1000}),captureSource);
  assert.equal(bounded.sweepPartial,true,'A tight safety budget must report incomplete preparation');
  assert.equal(await page.evaluate(()=>scrollY),0,'Timed-out preparation must restore the source scroll position');


  // Real Granola capture regression: old code copied 3,120px widths and
  // opacity:0/visibility:hidden onto media raster substitutes. When Bridge
  // reopened the page at 1,440px, artwork disappeared or overflowed.
  const mediaPage=await browser.newPage({viewport:{width:900,height:650}});
  try{
    await mediaPage.setContent('<!doctype html><html><head><style>'+
      '.w-full{width:100%}.h-full{height:100%}.video-container{width:80%;height:260px;position:relative}'+
      '</style></head><body><div class="video-container">'+
      '<canvas id="mediaCanvas" class="w-full h-full" width="600" height="300" '+
      'style="opacity:0;visibility:hidden"></canvas></div>'+
      '<div class="video-container"><video id="noFrame" class="w-full h-full" '+
      'style="opacity:0;visibility:hidden"></video></div>'+
      '<div class="video-container"><video id="needsScreenshot" class="w-full h-full"></video></div></body></html>');
    const result=await mediaPage.evaluate(async source=>{
      const can=document.querySelector('#mediaCanvas');
      const ctx=can.getContext('2d');ctx.fillStyle='#e23511';ctx.fillRect(0,0,600,300);
      const vid=document.querySelector('#noFrame');
      vid.poster=can.toDataURL('image/png');
      const captured=await (0,eval)('('+source+')')({sweep:false});
      const doc=new DOMParser().parseFromString(captured.html,'text/html');
      const image=doc.querySelector('img[data-bridge-captured-media]');
      const imgs=[...doc.querySelectorAll('img[data-bridge-captured-media]')];
      return {
        count:imgs.length,videoCount:doc.querySelectorAll('video').length,
        styles:imgs.map(img=>img.getAttribute('style')||''),
        sources:imgs.map(img=>(img.getAttribute('src')||'').slice(0,40)),
        errors:captured.error,unresolvedVideos:captured.unresolvedVideos,
        blankVideos:captured.blankVideos,
        placeholder:doc.querySelector('img[alt="Captured video fallback"]')?.getAttribute('src')
      };
    },captureSource);
    assert.equal(result.errors,undefined,'Granola-style capture failed');
    assert.equal(result.count,3,'Canvas, video poster, and pending screenshot fallback must survive');
    assert.equal(result.videoCount,0,'Static output must not leave unrenderable video tags');
    assert.equal(result.unresolvedVideos,1,'Video with no frame or poster must be identified');
    assert.equal(result.blankVideos.length,1,'Screenshot recovery job must be returned');
    assert.match(result.placeholder||'',/^bridge-video:0$/,'Unresolved video should retain a screenshot placeholder');
    for(const style of result.styles){
      assert.match(style,/width:\s*100%/,'Media must remain responsive');
      assert.match(style,/height:\s*100%/,'Media must retain parent aspect geometry');
      assert.match(style,/opacity:\s*1\s*!important/,'Captured media must be visible');
      assert.match(style,/visibility:\s*visible\s*!important/,'Captured media must not stay hidden');
      assert.doesNotMatch(style,/width:\s*900px|width:\s*3120px/,'Captured viewport size must not be hard-coded');
    }
    assert.ok(result.sources.filter(src=>src.startsWith('data:image/png;base64,')).length===2,'Bitmap pixels or poster were lost');

    // Exercise the fallback through a simulated Chrome screenshot, not just
    // the placeholder. It must return actual embedded pixels to Figma.
    const helperStart=popup.indexOf('async function fillMissingVideos(');
    const helperEnd=popup.indexOf('\ncaptureRenderedButton?.',helperStart);
    assert.ok(helperStart>0&&helperEnd>helperStart,'Video screenshot helper not found');
    const helper=popup.slice(helperStart,helperEnd).trim();
    const fallback=await mediaPage.evaluate(async source=>{
      const screenshot=document.createElement('canvas');
      screenshot.width=100;screenshot.height=100;
      const ctx=screenshot.getContext('2d');
      ctx.fillStyle='#d92b18';ctx.fillRect(0,0,100,100);
      const image=screenshot.toDataURL('image/jpeg',.85);
      const state={blankVideos:[{id:'bridge-video:0',index:2}],html:'<img src="bridge-video:0">',unresolvedVideos:1};
      const old=window.chrome;
      window.chrome={
        scripting:{executeScript:async o=>{
          if(o.args?.length===2)return [{result:true}];
          if(o.args?.length===1)return [{result:{rect:{x:10,y:15,width:30,height:40},viewport:{width:100,height:100}}}];
          return [{result:{x:0,y:0}}];
        }},
        tabs:{captureVisibleTab:async()=>image}
      };
      try{
        const restore=Function('return ('+source+')')();
        const failures=await restore({id:1,windowId:1},state);
        return {failures,recovered:state.recoveredVideos,unresolved:state.unresolvedVideos,
          hasJpeg:state.html.includes('src="data:image/jpeg;base64,'),
          length:state.html.length};
      }finally{window.chrome=old}
    },helper);
    assert.equal(fallback.failures,0,'Live-tab media screenshot fallback failed');
    assert.equal(fallback.recovered,1,'Fallback screenshot not counted as recovered');
    assert.equal(fallback.unresolved,0,'Recovered media must not be reported missing');
    assert.ok(fallback.hasJpeg&&fallback.length>300,'Actual image pixels must replace the video placeholder');

  }finally{await mediaPage.close()}

  console.log('Live DOM snapshot regression passed: hydration, delayed loading, expanded geometry, fallback reporting, sanitization and restoration.');
}finally{
  await browser.close();
}
