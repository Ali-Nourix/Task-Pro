import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
try {
 for(const [width,language,light] of [[1280,'en',true],[390,'fa',false],[320,'en',true]]) {
  const page=await browser.newPage({viewport:{width,height:width===1280?900:740},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL(`./board-preview.html?view=embeds&clock=1&lang=${language}${light?'&light=1':''}`,import.meta.url).href);
  const table=page.locator('[data-embed="table"]');
  await table.locator('.taskpro-timer-badge').first().waitFor();
  await table.locator('.taskpro-timer-badge').first().click();
  const panel=page.locator('.taskpro-clock-panel');
  await panel.waitFor();
  eq(await panel.locator('.taskpro-clock__time').innerText(),'25:00','readable idle countdown');
  eq(await panel.locator('.taskpro-clock__rounds').innerText().then(t=>t.includes('4')),true,'target rounds visible');
  await panel.getByRole('button',{name:language==='fa'?'شروع تایمر':'Start timer',exact:true}).click();
  await page.waitForTimeout(1200);
  eq(await page.evaluate(()=>window.embedTest.getTimer().runningSince>0),true,'clock starts service timer');
  eq(await panel.locator('.taskpro-clock__time').innerText()!=='25:00',true,'live countdown updates without reopening');
  await panel.getByRole('button',{name:language==='fa'?'توقف تایمر':'Pause timer',exact:true}).click();
  eq(await page.evaluate(()=>window.embedTest.getTimer().runningSince),0,'pause banks countdown');
  const paused=await panel.locator('.taskpro-clock__time').innerText();
  await page.waitForTimeout(1100);
  eq(await panel.locator('.taskpro-clock__time').innerText(),paused,'paused clock stays still');
  await panel.getByRole('button',{name:language==='fa'?'بازنشانی تایمر':'Reset timer',exact:true}).click();
  eq(await panel.locator('.taskpro-clock__time').innerText(),'25:00','reset starts fresh');
  const overflow=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.height>innerHeight;});
  eq(overflow,false,'clock fits phone and desktop');
  await panel.getByRole('button',{name:language==='fa'?'تغییر مدت تایمر':'Change duration',exact:true}).click();
  await page.locator('.taskpro-timer-panel input[type="number"]').first().fill('20');
  await page.locator('.taskpro-timer-panel button.mod-cta').click();
  await panel.waitFor();eq(await panel.locator('.taskpro-clock__time').innerText(),'20:00','settings returns to live clock');
  await page.evaluate(async()=>{
    const api=window.embedTest,timer=api.getTimer();
    await api.service.set(api.service.host.getEntries()[0].filePath,'demo',{...timer,elapsedSeconds:540,runningSince:Date.now()});
  });
  await page.screenshot({path:`/data/taskpro-clock-${width}-${language}.png`});
  await page.keyboard.press('Escape');eq(await panel.count(),0,'Escape closes clock');
  const cal=page.locator('[data-embed="calendar"]');await cal.scrollIntoViewIfNeeded();
  await cal.locator('.taskpro-timer-badge').first().waitFor();
  eq(await cal.locator('.taskpro-timer-badge').first().innerText().then(t=>t.includes('0/4')),true,'calendar round progress');
  eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no page overflow');
  await cal.screenshot({path:`/data/taskpro-clock-calendar-${width}-${language}.png`});
  // A desktop split pane must also use compact rendering, independent of window width.
  if(width===1280){await cal.evaluate(el=>{el.style.width='300px';});await page.waitForTimeout(150);eq(await cal.locator('.taskpro-board').evaluate(el=>el.classList.contains('is-compact')),true,'split-pane embed compacts');await cal.screenshot({path:'/data/taskpro-clock-split.png'});}
  await page.evaluate(()=>window.embedTest.destroy());eq(errors,[],'no runtime exceptions');await page.close();
 }
 console.log(`CLOCK_UI_OK (${checks} checks)`);
}finally{await browser.close();}
