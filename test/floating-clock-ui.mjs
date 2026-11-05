import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
let checks=0; const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
try {
 for(const [width,height,lang] of [[1280,900,'en'],[390,844,'fa'],[320,700,'en'],[740,390,'en']]) {
  const page=await browser.newPage({viewport:{width,height},hasTouch:true,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL(`./board-preview.html?view=embeds&clock=1&lang=${lang}`,import.meta.url).href);
  // Reproduce the user's theme giving the accent button different metrics.
  await page.addStyleTag({content:'button.mod-cta {height:28px;max-height:30px;margin-bottom:10px;align-self:start;padding:0 8px;background:#68ff94;color:#101010;}'});
  const badge=page.locator('[data-embed="table"] .taskpro-timer-badge').first(); await badge.click();
  const panel=page.locator('.taskpro-clock-panel'), handle=panel.locator('.taskpro-clock__handle');
  await panel.waitFor();await page.waitForTimeout(100);
  eq(await panel.getAttribute('aria-modal'),'false','non-modal semantics');
  eq(await page.locator('.taskpro-panel-overlay').count(),0,'no blocking backdrop');
  const dims=await panel.locator('.taskpro-clock__controls').first().locator('button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.width,r.height,r.y]}));
  eq(Math.abs(dims[0][1]-dims[1][1])<1&&dims[0][1]>=44,true,'accent and reset equal height even with hostile theme');
  eq(Math.abs(dims[0][0]-dims[1][0])<1&&Math.abs(dims[0][2]-dims[1][2])<1,true,'accent and reset same width and baseline');
  const before=await panel.boundingBox(),h=await handle.boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
  await page.mouse.move(h.x+h.width/2+65,h.y+h.height/2+70,{steps:10});await page.mouse.up();
  const after=await panel.boundingBox();
  eq(after.x!==before.x||after.y!==before.y,true,'title bar moves clock');
  const fit=async()=>panel.evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
  eq(await fit(),true,'drag clamped to reachable viewport');
  // A background editing surface remains usable and outside clicks do not close.
  await page.evaluate(()=>{const input=document.createElement('input');input.id='background-edit';input.setAttribute('aria-label','Background note');input.style.cssText='position:fixed;left:0;top:0;width:90px;height:32px;z-index:1';document.body.append(input);});
  await page.locator('#background-edit').click();await page.keyboard.type('note edit');
  eq(await page.locator('#background-edit').inputValue(),'note edit','background remains editable');
  eq(await panel.count(),1,'outside click leaves clock open');
  await page.keyboard.press('Escape');eq(await panel.count(),1,'background Escape does not dismiss unrelated clock');
  // Native touch drag, both writing directions.
  const t=await handle.boundingBox(),cdp=await page.context().newCDPSession(page);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',t.x+t.width/2,t.y+t.height/2);
  await touch('touchMove',Math.max(10,t.x+t.width/2-70),t.y+t.height/2-45);await touch('touchEnd',0,0);
  await cdp.detach();
  const touched=await panel.boundingBox();eq(touched.x!==after.x||touched.y!==after.y,true,'touch drags floating clock');
  await handle.focus();const old=await panel.boundingBox();await page.keyboard.press(old.x>18?'ArrowLeft':'ArrowRight');
  eq((await panel.boundingBox()).x!==old.x,true,'keyboard moves focused handle');
  const remembered=await panel.boundingBox();await panel.getByRole('button',{name:lang==='fa'?'بستن':'Close',exact:true}).click();
  eq(await panel.count(),0,'close removes floating window');
  await badge.evaluate(e=>e.click());await panel.waitFor();await page.waitForTimeout(100);
  const reopened=await panel.boundingBox();eq(Math.abs(reopened.x-remembered.x)<1&&Math.abs(reopened.y-remembered.y)<1,true,'position remembered when reopened');
  await badge.evaluate(e=>e.click());eq(await panel.count(),1,'opening twice keeps only one clock');
  await page.screenshot({path:`/data/taskpro-floating-original-${width}-${lang}.png`});
  await page.setViewportSize({width:Math.min(width,360),height:Math.min(height,480)});await page.waitForTimeout(100);
  eq(await fit(),true,'resize keeps entire clock reachable');
  await page.screenshot({path:`/data/taskpro-floating-${width}-${lang}.png`});
  await handle.focus();await page.keyboard.press('Escape');eq(await panel.count(),0,'focused Escape closes clock');
  // Tab can leave a non-modal clock; it is not trapped in the action buttons.
  await badge.evaluate(e=>e.click());await panel.waitFor();
  await panel.getByRole('button',{name:lang==='fa'?'حذف تایمر':'Remove timer',exact:true}).focus();await page.keyboard.press('Tab');
  eq(await panel.evaluate(e=>e.contains(document.activeElement)),false,'Tab leaves floating clock');
  await page.evaluate(()=>window.embedTest.destroy());eq(await panel.count(),0,'service unload closes floating clock');
  await page.waitForTimeout(80);eq(errors,[],'no runtime or cleanup errors');await page.close();
 }
 console.log(`FLOATING_CLOCK_UI_OK (${checks} checks)`);
}finally{await browser.close();}
