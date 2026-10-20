import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const urls=[
  ['heron','https://heronaiapp.com/'],
  ['bold','https://boldscandinavia.com/'],
  ['koto','https://koto.com/']
];
const out=path.resolve('tests/live-scroll-proof');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist']});
const summary=[];
const metrics=()=>({
  url:location.href,
  viewport:[innerWidth,innerHeight],
  scrollY:scrollY,
  height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),
  overflowY:getComputedStyle(document.documentElement).overflowY,
  canvas:document.querySelectorAll('canvas').length,
  smooth:!!window.ScrollSmoother?.get?.(),
  lenis:!!window.lenis,
  gsapTriggers:window.ScrollTrigger?.getAll?.().length??null,
  pinned:window.ScrollTrigger?.getAll?.().filter(trigger=>trigger.pin).length??null,
  contentTextLength:document.body?.innerText?.length||0
});
for(const [name,url] of urls){
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const record={name,url,errors:[]};
  page.on('pageerror',error=>{if(record.errors.length<5)record.errors.push(error.message);});
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
    await page.waitForTimeout(2200);
    record.before=await page.evaluate(metrics);
    await page.screenshot({path:path.join(out,name+'-top.png'),fullPage:false,timeout:12000});
    await page.mouse.move(700,500);
    for(let step=0;step<10;step++){await page.mouse.wheel(0,430);await page.waitForTimeout(240);}
    await page.waitForTimeout(900);
    record.after=await page.evaluate(metrics);
    await page.screenshot({path:path.join(out,name+'-after-wheel.png'),fullPage:false,timeout:12000});
    record.visited=true;
    record.nativeScrollDelta=(record.after?.scrollY||0)-(record.before?.scrollY||0);
  }catch(error){record.visited=false;record.error=String(error).slice(0,550);}
  summary.push(record);
  await page.close();
}
await browser.close();
await fs.writeFile(path.join(out,'results.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.some(s=>!s.visited))process.exitCode=1;
