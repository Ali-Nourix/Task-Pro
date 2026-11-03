/** Real status capsules open the existing TaskPopover; no extra mobile menu. */
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const css=fs.readFileSync('styles.css','utf8');
const js=(await esbuild.build({stdin:{contents:`export * from './src/ui/chip-scroll'; export * from './src/ui/chips'; export {TaskPopover} from './src/task-popover';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'chips',write:false,define:{__LUCIDE__:'{}'},plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:path.resolve('test/harness/obsidian-stub.ts')}));}}]})).outputFiles[0].text;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
try {
 for(const [dir,language,width] of [['ltr','en',390],['rtl','fa',390],['ltr','en',900]]) {
  const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>${fs.readFileSync('test/obsidian-theme.css','utf8')}\n${css}\nbody{background:#202020;color:#eee;font:16px Arial;margin:24px;} .menu{position:fixed;left:8px!important;right:8px;top:auto!important;bottom:8px;background:#303030;padding:12px;max-height:65vh;overflow:auto;box-sizing:border-box;min-width:0;} .menu-item{padding:8px;} </style><body class="is-mobile theme-dark" dir="${dir}"><p>${language==='fa'?'نوشتن گزارش امروز':'Write the daily report'}</p><span class="taskpro-badge-container"></span></body>`);
  await page.addScriptTag({content:js});
  await page.evaluate(language=>{
   const row=document.querySelector('.taskpro-badge-container');window.actions=[];window.events=[];
   const task={status:'[ ]',language,filePath:'Daily/Today.md',lineContent:'- [ ] Report',blockId:'report'};
   const status=chips.createStatusChip(task);
   row.append(status,chips.createDeadlineChip('2026-10-20',language),chips.createScheduleChip({...task,schedule:{date:'2026-10-20',start:'09:00'},calendarSystem:'gregorian',timeFormat:'24h'}));
   window.original=[...row.children];
   document.addEventListener('taskpro-badge-click',e=>{
    events.push(e.detail);new chips.TaskPopover({...e.detail,app:{},priority:'high',deadline:'2026-10-20',schedule:{date:'2026-10-20',start:'09:00'},
     timer:{enabled:true,durationSeconds:1500,elapsedSeconds:0,runningSince:0,pomodoro:{phase:'focus',focusMinutes:25,shortBreakMinutes:5,longBreakMinutes:15,longBreakEvery:4,targetRounds:4,completedRounds:2,autoStart:false}},
     onPriorityChange:p=>actions.push(p),onStatusChange:s=>actions.push(s),onDeadlineChange:()=>{},onScheduleChange:()=>{},onProgressChange:()=>{},onTimerChange:()=>{},onTimerStart:()=>{},onOpenTimer:()=>actions.push('clock'),onRepeatChange:()=>{},onEditTags:()=>{}}).show();
   });
   chips.makeChipRowScrollable(row,language);
  },language);
  const row=page.locator('.taskpro-badge-container'),status=row.locator('.taskpro-interactive-badge');
  await page.waitForFunction(()=>document.querySelector('.taskpro-badge-container').classList.contains('is-mobile-single-chip'));
  eq(await row.locator('.taskpro-chip:visible').count(),1,'one capsule only');
  eq(await status.isVisible(),true,'status remains visible');
  eq(await page.locator('.taskpro-chip-more,.taskpro-mobile-chip-menu').count(),0,'no ellipsis or second popup');
  eq(await row.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'no horizontal capsule strip');
  await status.tap();const menu=page.locator('.menu');await menu.waitFor();
  eq(await menu.count(),1,'one existing Obsidian menu opens');
  eq(await page.evaluate(()=>events.length),1,'one action per tap');
  eq(await page.evaluate(()=>({file:events[0].filePath,id:events[0].blockId,anchor:events[0].targetElement===original[0]})),{file:'Daily/Today.md',id:'report',anchor:true},'original task context and visible anchor');
  const text=await menu.innerText();eq(text.includes('2/4'),true,'Pomodoro round details in same menu');
  eq(text.includes('09:00'),true,'plan details in same menu');
  eq(await menu.locator('.menu-item').count()>15,true,'existing property controls retained');
  // Stub Menu does not emulate native mobile positioning; CSS supplies a
  // bounded sheet for local visual QA. Production still uses Obsidian Menu.
  await page.screenshot({path:`/data/taskpro-single-status-${dir}-${width}.png`});
  await menu.locator('.menu-item').filter({hasText:language==='fa'?'باز کردن ساعت تمرکز':'Open focus clock'}).click();
  eq(await page.evaluate(()=>actions),['clock'],'floating clock remains reachable');
  await status.focus();await page.keyboard.press('Enter');await menu.waitFor();
  eq(await page.evaluate(()=>events.length),2,'Enter opens the same menu');
  await page.evaluate(()=>document.querySelector('.menu').remove());await status.focus();await page.keyboard.press('Space');await menu.waitFor();
  eq(await page.evaluate(()=>events.length),3,'Space opens once without page scroll');
  await page.evaluate(()=>document.querySelector('.menu').remove());
  await page.evaluate(()=>{document.body.classList.remove('is-mobile');});await page.setViewportSize({width:1100,height:844});
  await page.waitForFunction(()=>!document.querySelector('.taskpro-badge-container').classList.contains('is-mobile-single-chip'));
  eq(await row.locator('.taskpro-chip:visible').count(),3,'desktop restores all original capsules');
  eq(await row.evaluate(e=>[...e.children].every((c,i)=>c===original[i])),true,'no nodes moved or cloned');
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.taskpro-badge-container').classList.contains('is-mobile-single-chip'));
  await page.evaluate(()=>chips.releaseChipRow(document.querySelector('.taskpro-badge-container')));
  eq(await row.locator('.taskpro-chip-collapsed').count(),0,'cleanup restores capsules');
  eq(errors,[],'no runtime errors');await page.close();
 }
 console.log(`MOBILE_CHIPS_OK (${checks} checks)`);
}finally{await browser.close();}
