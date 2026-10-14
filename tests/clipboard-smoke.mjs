import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve('tests/clipboard-proof');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
await page.addInitScript(()=>{
  window.__clipboardProof=[];
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    write:async(items)=>{
      for(const item of items){
        for(const type of item.types){
          const blob=await item.getType(type);
          window.__clipboardProof.push({mimeType:type,bytes:blob.size});
        }
      }
    },
    writeText:async()=>{},
  }});
});
let proof={source:'Genuine Figma Bridge browser conversion + intercepted ClipboardItem',externalFigmaPasteVerified:false,exportVerified:false};
try{
 await page.goto('http://127.0.0.1:3200/',{waitUntil:'domcontentloaded',timeout:30000});
 await page.getByRole('button',{name:/Paste HTML \/ SVG/i}).click();
 await page.locator('#pasteInput').fill('<main style="font-family:Arial;padding:32px"><h1>Bridge Clipboard Fixture</h1><div style="display:flex;gap:16px"><div style="padding:24px;background:#d9f0db">Editable text A</div><div style="padding:24px;background:#dde7f5">Editable text B</div></div><button>Continue</button></main>');
 await page.locator('#renderPaste').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Ready'),{timeout:15000});
 await page.locator('#copyFigma').click();
 await page.waitForFunction(()=>/Copied\. Paste|Conversion failed/.test(document.querySelector('#status')?.textContent||''),{timeout:45000});
 proof.status=await page.locator('#status').innerText();
 proof.payload=await page.evaluate(()=>window.__clipboardProof);
 proof.fixtureVisible=(await Promise.all(page.frames().map(async f=>(await f.locator('h1').allTextContents().catch(()=>[])).some(v=>v.includes('Bridge Clipboard Fixture'))))).some(Boolean);
 proof.clipboardWritten=proof.payload?.some(x=>x.bytes>100);
 proof.passed=proof.fixtureVisible&&proof.clipboardWritten&&proof.status.startsWith('Copied.');
 await page.screenshot({path:path.join(out,'source-preview-and-copy-state.png'),fullPage:false});
} catch(e){proof.passed=false;proof.error=String(e).slice(0,900)}
finally{await browser.close();await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));}
if(!proof.passed)process.exitCode=1;
