import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const messages=[];
const rect={
  id:'1:4',type:'RECTANGLE',name:'Action card',x:24,y:62,width:280,height:72,
  fills:[{type:'SOLID',color:{r:0.85,g:0.91,b:0.98},opacity:1}],
  cornerRadius:12,strokes:[],effects:[],opacity:1
};
const title={
  id:'1:3',type:'TEXT',name:'Heading',x:24,y:20,width:290,height:36,
  characters:'Vehicle <ready> & verified',fontName:{family:'Inter',style:'Semi Bold'},
  fontSize:20,textAlignHorizontal:'LEFT',lineHeight:{unit:'PIXELS',value:28},
  fills:[{type:'SOLID',color:{r:0.12,g:0.16,b:0.21},opacity:1}],
  getStyledTextSegments:()=>[],
};
const vector={
  id:'1:5',type:'VECTOR',name:'Icon',x:314,y:84,width:24,height:24,
  exportAsync:async ({format})=>{
    assert.equal(format,'SVG_STRING');
    return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg>';
  }
};
const unknown={
  id:'1:6',type:'WIDGET',name:'Unsupported widget',x:8,y:146,width:40,height:24,
  exportAsync:async ({format})=>{
    assert.equal(format,'PNG');
    return Uint8Array.from([0x89,0x50,0x4e,0x47,1,2,3,4]);
  }
};
const frame={id:'1:1',type:'FRAME',name:'Fixture UI',x:0,y:0,width:360,height:200,layoutMode:'NONE',clipsContent:true,fills:[],children:[title,rect,vector,unknown]};
const figma={
  mixed:Symbol('mixed'),
  showUI() {},
  currentPage:{name:'Test page',selection:[frame]},
  ui:{postMessage:(m)=>messages.push(m),onmessage:null},
  on:()=>{},
  base64Encode:(bytes)=>Buffer.from(bytes).toString('base64')
};
const source=await fs.readFile('plugin/code.js','utf8');
vm.runInNewContext(source,{figma,__html__:'<div></div>',Buffer,Uint8Array,console},{filename:'plugin/code.js'});
assert.equal(typeof figma.ui.onmessage,'function');
await figma.ui.onmessage({type:'export-html'});
const result=messages.find(m=>m.type==='exported');
assert.ok(result,'exported response is missing');
assert.equal(result.filename,'Fixture-UI.html');
assert.equal(result.count,1);
const html=result.html;
assert.match(html,/Vehicle &lt;ready&gt; &amp; verified/,'text was not escaped');
assert.match(html,/bridge-container/,'frame was not preserved');
assert.match(html,/bridge-rect/,'rectangle was not exported');
assert.match(html,/bridge-vector/,'vector SVG was not exported');
assert.match(html,/<circle cx="12"/,'vector content missing');
assert.match(html,/bridge-raster/,'unsupported widget was not rasterised');
assert.match(html,/data:image\/png;base64,/,'raster image missing');
assert.match(html,/width:360px;height:200px/,'frame dimensions lost');
figma.currentPage.selection=[];
await figma.ui.onmessage({type:'export-html'});
assert.ok(messages.some(m=>m.type==='error'&&/Select at least one/.test(m.message)),'empty selection should surface a recovery message');
const manifest={
  passed:true,
  source:'real plugin/code.js evaluated against synthetic Figma Plugin API nodes',
  outputName:result.filename,
  outputBytes:Buffer.byteLength(html),
  asserts:['styled text and HTML escaping','frame dimensions','native rectangle','SVG vector','unsupported raster fallback','empty selection recovery'],
  limits:'This verifies exporter serialization under a mocked Figma API. It is not a native Figma Desktop run or visual round-trip parity proof.',
};
const dir=path.resolve('tests/clipboard-proof');
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(path.join(dir,'exporter-fixture.html'),html);
await fs.writeFile(path.join(dir,'exporter-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
