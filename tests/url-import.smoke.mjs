import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Real Chromium acceptance for the public Website URL path.
// The server HTML proxy is mocked locally; no third-party website is contacted.
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1450,height:940}});
  await page.goto('http://127.0.0.1:3200/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Website URL'}).click();
  await page.locator('#urlInput').fill('https://example.com/');
  await page.route('**/api/proxy?**',async route=>{
    const variant=new URL(route.request().url()).searchParams.get('url');
    if(variant==='https://example.com/'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        finalUrl:'https://example.com/',
        html:'<!doctype html><html><head><style>body{margin:0} [data-aos]{opacity:0;transform:translateY(60px)} #menu{opacity:0}</style></head><body><main><h1>Agency studio website</h1><p data-aos="fade-up">This is a long and useful paragraph about a portfolio that was server-rendered but begins hidden before its animation starts.</p><div id="menu">Hidden dropdown that should remain hidden.</div></main></body></html>'
      })});
    }
    if(variant==='https://blank.example/'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        finalUrl:variant,html:'<!doctype html><html><body><main><div style="opacity:0"><p>Some application shells have server HTML containing many words yet they reveal all content only after the browser executes their JavaScript runtime.</p></div></main></body></html>'
      })});
    }
    return route.fulfill({status:502,contentType:'text/html',body:'<html><body>Bad Gateway</body></html>'});
  });
  await page.locator('#loadUrl').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Static preview:'),null,{timeout:16000});
  const frame=page.frameLocator('iframe.preview-frame');
  assert.equal(await frame.locator('[data-aos]').evaluate(el=>getComputedStyle(el).opacity),'1',
    'Scroll reveal markup should be visible after static URL import');
  assert.equal(await frame.locator('#menu').evaluate(el=>getComputedStyle(el).opacity),'0',
    'Off-canvas dropdown must not be unhidden');
  assert.equal(await page.locator('#copyFigma').isEnabled(),true);
  assert.match(await page.locator('#status').textContent(),/JavaScript is not executed/);
  await page.locator('#urlInput').fill('https://blank.example/');
  await page.locator('#loadUrl').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('no main content rendered'),null,{timeout:16000});
  assert.equal(await page.locator('#copyFigma').isDisabled(),true,
    'Do not export a blank JS app shell as an editable finished design');
  await page.locator('#urlInput').fill('https://error.example/');
  await page.locator('#loadUrl').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('invalid response'),null,{timeout:16000});
  assert.equal(await page.locator('#loadUrl').isEnabled(),true,
    'Import control should recover after proxy errors');
  console.log('Website URL passed: recovered AOS, preserved hidden UI, blank-shell failure, proxy error.');
}finally{await browser.close();}
