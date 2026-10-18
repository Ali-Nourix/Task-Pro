import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync('styles.css','utf8');
const js=(await esbuild.build({stdin:{contents:'export * from "./src/ui/chip-scroll";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'chipRows',write:false})).outputFiles[0].text;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
let checks=0; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
try {
 for(const [dir,lang,width] of [['ltr','en',390],['rtl','fa',390],['ltr','en',900]]) {
  const page=await browser.newPage({viewport:{width,height:740},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>:root {--background-primary:#202020;--background-modifier-border:#444;--text-normal:#eee;--text-muted:#aaa;--interactive-accent:#9879ff;}body{background:#191919;color:#eee;font:16px Arial;margin:24px;} ${css}
 .demo-chip {min-width:96px;border:1px solid #555;border-radius:8px;padding:5px 10px;background:#303030;color:#eee;} .taskpro-badge-container{gap:4px;} .taskpro-badge-container > .demo-chip {height:30px;margin:0;} </style><body class="is-mobile" dir="${dir}"><p>${lang==='fa'?'نوشتن گزارش امروز':'Write the daily report'}</p><div class="taskpro-badge-container"><span class="taskpro-block-id">hidden-id</span><button class="demo-chip taskpro-chip">${lang==='fa'?'شروع نشده':'Not started'}</button><button class="demo-chip taskpro-chip">${lang==='fa'?'امروز ۹:۰۰':'Today, 09:00'}</button><button class="demo-chip taskpro-chip">Focus · 0/4 · 25:00</button></div><input id="outside" aria-label="Note text"></body>`);
  await page.addScriptTag({content:js});
  await page.evaluate(lang=>{
   const row=document.querySelector('.taskpro-badge-container');window.originalChips=[...row.querySelectorAll('.demo-chip')];window.clicks=[];
   originalChips.forEach((c,i)=>c.addEventListener('click',()=>{clicks.push(i);c.dispatchEvent(new CustomEvent('taskpro-test-action',{bubbles:true,detail:{blockId:'demo',targetElement:c}}));}));
   document.addEventListener('taskpro-test-action',e=>window.actionContext=e.detail.blockId);
   chipRows.makeChipRowScrollable(row,lang);
  },lang);
  const row=page.locator('.taskpro-badge-container'),more=row.locator('.taskpro-chip-more');await more.waitFor();
  eq(await row.locator('.demo-chip:visible').count(),1,'exactly one capsule even with only two or more properties');
  eq(await row.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'not a clipped horizontal swipe row');
  eq((await more.boundingBox()).height>=44,true,'more is a touch-sized target');
  await more.tap();const popup=page.locator('.taskpro-mobile-chip-menu');await popup.waitFor();
  eq(await popup.locator('.demo-chip').count(),2,'other real capsules in menu');
  eq(await more.getAttribute('aria-expanded'),'true','expanded state');
  eq(await popup.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true,'popover inside viewport');
  eq(await popup.locator('.demo-chip').first().evaluate(e=>e===window.originalChips[1]),true,'original interactive controls, not inert clones');
  await page.screenshot({path:`/data/taskpro-more-${dir}-${width}.png`});
  await popup.locator('.demo-chip').first().tap();await popup.waitFor({state:'detached'});
  eq(await page.evaluate(()=>clicks),[1],'original action fired exactly once');eq(await page.evaluate(()=>window.actionContext),'demo','task context still bubbles to plugin');
  await more.click();await popup.waitFor();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await popup.waitFor({state:'detached'});
  eq(await page.evaluate(()=>clicks),[1,2],'keyboard can invoke next property');
  await more.click();await page.keyboard.press('Escape');eq(await popup.count(),0,'Escape closes properties');
  eq(await more.evaluate(e=>e===document.activeElement),true,'Escape returns focus');
  await more.click();await page.locator('#outside').tap();eq(await popup.count(),0,'outside tap dismisses menu');
  eq(await row.locator('.demo-chip').evaluateAll(es=>es.every((e,i)=>e===originalChips[i])),true,'order and identities restored');
  await page.evaluate(()=>{const row=document.querySelector('.taskpro-badge-container');row.querySelectorAll('.demo-chip')[2].remove();});await page.waitForTimeout(80);
  eq(await row.locator('.demo-chip:visible').count(),1,'two capsules also collapse to one');eq(await more.isVisible(),true,'two capsules keep explicit More');
  await page.evaluate(()=>document.body.classList.remove('is-mobile'));await page.setViewportSize({width:1100,height:740});await page.waitForTimeout(80);
  eq(await row.locator('.demo-chip:visible').count(),2,'desktop restores all capsules');eq(await more.isVisible(),false,'desktop keeps existing scroll layout without More');
  await page.setViewportSize({width:390,height:740});await more.waitFor();await more.click();
  await page.evaluate(()=>chipRows.releaseChipRow(document.querySelector('.taskpro-badge-container')));
  eq(await popup.count(),0,'destroy closes open popup');eq(await row.locator('.demo-chip').count(),2,'destroy returns all original controls');
  eq(errors,[],'no runtime errors');await page.close();
 }
 console.log(`MOBILE_CHIPS_OK (${checks} checks)`);
}finally{await browser.close();}
