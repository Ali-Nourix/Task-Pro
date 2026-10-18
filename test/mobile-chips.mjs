import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync('styles.css','utf8');
const js=(await esbuild.build({stdin:{contents:'export * from "./src/ui/chip-scroll";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'chipRows',write:false})).outputFiles[0].text;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
try {
 for(const dir of ['ltr','rtl']) {
  const page=await browser.newPage({viewport:{width:390,height:740},hasTouch:true});
  await page.setContent(`<style>${css}\n.taskpro-badge-container > button {width:98px;min-width:98px;height:32px;margin:0;} body{margin:24px;} .taskpro-badge-container{gap:4px;}</style><body class="is-mobile" dir="${dir}"><div class="taskpro-badge-container"><button>One</button><button>Two</button><button>Three</button></div></body>`);
  await page.addScriptTag({content:js});await page.evaluate(()=>chipRows.makeChipRowScrollable(document.querySelector('.taskpro-badge-container')));
  const row=page.locator('.taskpro-badge-container');await page.waitForFunction(()=>document.querySelector('.has-many-chips.is-overflowing'));
  ok(await row.evaluate(e=>e.clientWidth<=e.children[0].getBoundingClientRect().width+6),'one capsule viewport');
  ok(await row.evaluate(e=>new Set([...e.children].map(c=>Math.round(c.getBoundingClientRect().top))).size===1),'capsules never wrap');
  await page.evaluate(()=>{window.chipClicks=0;document.querySelector('.taskpro-badge-container').addEventListener('click',()=>window.chipClicks++);});
  const box=await row.boundingBox();
  const delta=await row.evaluate(e=>{const r=e.getBoundingClientRect();return [...e.children].some(c=>c.getBoundingClientRect().right>r.right+1)?-70:70;});
  const before=await row.evaluate(e=>e.scrollLeft),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta,y,{steps:12});await page.mouse.up();
  ok(Math.abs(await row.evaluate(e=>e.scrollLeft)-before)>10,'mouse drag reaches other capsules');
  ok(await page.evaluate(()=>window.chipClicks===0),'drag does not activate chip');
  await page.screenshot({path:`/data/taskpro-mobile-chips-${dir}.png`});
  // Restore initial position, then test the browser's native touch scroll.
  await row.evaluate(e=>{e.scrollLeft=0;});await page.waitForTimeout(300);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+delta*i/8,y}]});await page.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
  ok(Math.abs(await row.evaluate(e=>e.scrollLeft))>10,'native touch swipe reaches other capsules');
  await page.close();
 }
 console.log(`MOBILE_CHIPS_OK (${checks} checks)`);
}finally{await browser.close();}
