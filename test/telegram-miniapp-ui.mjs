import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('miniapp/dist/index.html','utf8');
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const fixture=[{n:1,title:'گزارش امروز را آماده کن',status:'open',priority:'high',deadline:null,plan_date:'2026-10-18',plan_start:'10:00',plan_end:'11:00',remind_at:null,repeat:null,tags:['work'],parent_title:null,subs_done:1,subs_total:3,pending:false},{n:2,title:'Book the dentist',status:'doing',priority:null,deadline:'2026-10-17',plan_date:'2026-10-17',plan_start:null,plan_end:null,remind_at:null,repeat:'2w',tags:['personal'],parent_title:null,subs_done:null,subs_total:null,pending:false},{n:3,title:'<img src=x onerror=alert(1)>',status:'open',priority:null,deadline:null,plan_date:null,plan_start:null,plan_end:null,remind_at:null,repeat:null,tags:[],parent_title:null,subs_done:null,subs_total:null,pending:true}];
try{
 for(const [lang,width,scheme]of [['fa',390,'dark'],['en',390,'light'],['en',1100,'light']]){
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:scheme});const errors=[];page.on('pageerror',e=>errors.push(e.message));let tasks=structuredClone(fixture),failed=false;const calls=[];
  await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
  await page.route('https://hjycjrqsavmutdiwtwfj.supabase.co/functions/v1/miniapp',async r=>{
   const data=r.request().postDataJSON();calls.push(data);if(failed){await r.abort();return;}
   if(data.action==='status'){const t=tasks.find(t=>t.n===data.n);t.status=data.status;}
   if(data.action==='create')tasks.push({...structuredClone(fixture[0]),n:4,title:data.title,tags:data.tags,plan_date:'2026-10-18',pending:true});
   const body=data.action==='list'?{ok:true,owner:{language:lang,timezone:'Asia/Tehran',calendar:lang==='fa'?'jalali':'gregorian',last_sync_at:'2026-10-18T07:00:00Z',today:'2026-10-18'},tasks:tasks.filter(t=>['open','doing'].includes(t.status))}:{ok:true};
   await r.fulfill({headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  });
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test-only-fixture',initDataUnsafe:{user:{language_code:'fa'}},themeParams:{},ready(){},expand(){},close(){window.closedBot=true;},BackButton:{show(){},hide(){},onClick(){}}}};});
  await page.route('https://taskpro.example/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://taskpro.example/');await page.waitForFunction(()=>document.querySelector('#total').textContent==='3');
  eq(await page.locator('.task').count(),1,'today filter');eq(await page.locator('#today-count').innerText(),'1','today count');eq(await page.locator('#late-count').innerText(),'1','late count');
  eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no viewport overflow');
  eq(await page.locator('#add').evaluate(e=>e.getBoundingClientRect().height>=44),true,'primary touch target');
  const snap=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);await page.screenshot({path:`/data/taskpro-mini-${name}-${lang}-${width}.png`});const doc=await page.content();fs.writeFileSync(`/data/taskpro-mini-${name}-${lang}-${width}.html`,doc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));};
  await snap('home');
  if(lang==='fa'){await page.emulateMedia({colorScheme:'light'});await snap('home-light');await page.emulateMedia({colorScheme:'dark'});}

  eq(await page.locator('#week-strip button').count(),7,'seven selectable dates');
  await page.locator('[data-mode=calendar]').click();eq(await page.locator('html').getAttribute('class'),'mode-calendar','calendar route');eq(await page.locator('#upcoming').isVisible(),false,'calendar is not duplicated dashboard');await snap('calendar');
  await page.locator('#week-strip button').nth(3).click();eq(await page.locator('.task').count(),0,'date selection filters actual plan');await snap('empty');await page.locator('#this-week').click();eq(await page.locator('.task').count(),1,'return to today');
  await page.locator('[data-mode=tasks]').click();eq(await page.locator('.task').count(),3,'Tasks route shows all open tasks');eq(await page.locator('#week-panel').isVisible(),false,'Tasks is a focused list');await snap('list');await page.locator('[data-mode=home]').click();

  await page.locator('[data-filter=all]').click();eq(await page.locator('.task').count(),3,'all open tasks');eq(await page.locator('#tasks img').count(),0,'task titles render as text not HTML');
  await page.locator('#search').fill('dentist');eq(await page.locator('.task').count(),1,'search');await page.locator('#search').fill('');
  await page.locator('.task-main').first().click();await page.locator('dialog[open]').waitFor();eq(await page.locator('dialog form').count(),4,'status details plan and reminder remain distinct');eq(await page.locator('dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true,'details fit viewport');await snap('details');
  await page.keyboard.press('Escape');eq(await page.locator('dialog[open]').count(),0,'Escape closes sheet');
  await page.locator('#add').click();await page.locator('dialog input[type=text]').first().fill(lang==='fa'?'مرور فصل تازه':'Review a new chapter');await snap('add');await page.locator('dialog button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#total').textContent==='4');eq(calls.some(c=>c.action==='create'),true,'create uses API');eq(await page.locator('dialog[open]').count(),0,'successful save closes form');
  await page.locator('.tick').first().click();await page.waitForFunction(()=>document.querySelector('#total').textContent==='3');eq(calls.some(c=>c.action==='status'&&c.status==='done'),true,'completion uses shared endpoint');await page.locator('#toast button').click();await page.waitForFunction(()=>document.querySelector('#total').textContent==='4');eq(calls.some(c=>c.action==='status'&&c.status==='open'),true,'undo restores through same endpoint');
  failed=true;await page.locator('#refresh').click();await page.locator('#notice:not([hidden])').waitFor();eq(await page.locator('.task').count(),4,'network failure keeps last successful list');await snap('error');
  eq(errors,[],'no runtime exceptions');await page.close();
 }
 const outside=await browser.newPage({viewport:{width:390,height:844},colorScheme:'dark'});await outside.route('https://telegram.org/**',r=>r.fulfill({body:''}));await outside.route('https://taskpro.example/**',r=>r.fulfill({contentType:'text/html',body:html}));await outside.goto('https://taskpro.example/');eq(await outside.locator('#add').isDisabled(),true,'outside Telegram cannot mutate');eq(await outside.locator('#notice').isVisible(),true,'outside Telegram explanation');await outside.screenshot({path:'/data/taskpro-mini-outside.png'});await outside.close();console.log(`MINIAPP_UI_OK (${checks} checks)`);
}finally{await browser.close();}
