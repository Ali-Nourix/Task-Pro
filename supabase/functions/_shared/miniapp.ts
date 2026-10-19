import { chatInput, miniAppChat } from './miniapp-chat.ts';
import type { Ai } from './ai.ts';
import { validateMiniAppData } from './miniapp-auth.ts';
import { miniAppEffects } from './bot.ts';
import { cleanTitle, parseTags } from './taskfields.ts';
import { isRealDate, isClock, clockMinutes, localNow, localToUtc } from './time.ts';
import type { Store, Telegram, Status, TaskRow, EditPayload } from './types.ts';
import type { NewTask } from './assistant.ts';
import type { Moment, Plan, Priority } from './quickadd.ts';

interface Deps { ai?: Ai; store: Store; token: string; now: () => Date; origin: string; allowedUserId?: number; }
class InputError extends Error {}
const bad = (): never => { throw new InputError(); };
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : bad();
const day = (x: unknown): string => typeof x === 'string' && isRealDate(x) ? x : bad();
const clock = (x: unknown): string => typeof x === 'string' && isClock(x) ? x : bad();
const title = (x: unknown): string => typeof x === 'string' && x.length <= 600 && cleanTitle(x) ? cleanTitle(x) : bad();
const priority = (x: unknown): Priority | null => x === null ? null : ['highest','high','medium','low','lowest'].includes(String(x)) ? x as Priority : bad();
const repeat = (x: unknown): string | null => x === null || (typeof x === 'string' && /^[1-9]\d{0,2}[dwm]$/.test(x)) ? x : bad();
const tags = (x: unknown): string[] => Array.isArray(x) && x.length <= 20 && x.every(t => typeof t === 'string' && t.length > 0 && t.length <= 60 && parseTags(t).length === 1 && parseTags(t)[0] === t) ? x as string[] : bad();
const plan = (x: unknown): Plan | null => {
  if (x === null) return null;
  const p = object(x), result: Plan = { date: day(p.date) };
  if (p.start !== undefined && p.start !== '') result.start = clock(p.start);
  if (p.end !== undefined && p.end !== '') { result.end = clock(p.end); if (!result.start || clockMinutes(result.end) <= clockMinutes(result.start)) bad(); }
  return result;
};
const silent: Telegram = { send: async()=>{}, edit: async()=>{}, answer: async()=>{}, setCommands: async()=>{} };
const publicTask = (t: TaskRow) => ({ n:t.n,title:t.title,status:t.status,priority:t.priority,deadline:t.deadline,plan_date:t.plan_date,plan_start:t.plan_start,plan_end:t.plan_end,remind_at:t.remind_at,repeat:t.repeat,tags:t.tags,parent_title:t.parent_title,subs_done:t.subs_done,subs_total:t.subs_total,pending:t.pending });

export async function handleMiniApp(request: Request, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers: Record<string,string> = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Origin' };
  const reply = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers});
  if (origin) {
    if (!deps.origin || origin !== deps.origin) return reply({error:'origin_denied'},403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (request.method === 'GET') return reply({service:'TaskPro Mini App',version:1,ready:!!deps.token && !!deps.origin});
  if (request.method !== 'POST') return reply({error:'method_not_allowed'},405);
  const auth = request.headers.get('authorization') ?? '';
  const user = await validateMiniAppData(auth.startsWith('tma ') ? auth.slice(4) : '', deps.token, deps.now());
  if (!user || (deps.allowedUserId !== undefined && user !== deps.allowedUserId)) return reply({error:'unauthorized'},401);
  try {
    const owner = await deps.store.getOwner();
    if (!owner || owner.chat_id !== user) return reply({error:'forbidden'},403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({error:'json_required'},415);
    if (Number(request.headers.get('content-length')) > 16384) return reply({error:'too_large'},413);
    // Bound streamed bodies too; Content-Length alone is not trustworthy.
    const reader = request.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    if (!reader) return reply({error:'invalid_input'},400);
    while (true) { const {done,value} = await reader.read(); if(done) break; bytes += value.length; if(bytes>16384){await reader.cancel();return reply({error:'too_large'},413);} chunks.push(value); }
    const all = new Uint8Array(bytes); let offset=0; for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
    let data: Record<string,unknown>; try { data=object(JSON.parse(new TextDecoder().decode(all))); } catch { return reply({error:'invalid_input'},400); }
    const now=deps.now(), effects=miniAppEffects({store:deps.store,tg:silent,pairingCode:'',now:deps.now},owner);
    const meta = { language:owner.language,timezone:owner.timezone,calendar:owner.calendar,last_sync_at:owner.last_sync_at,today:localNow(owner.timezone,now).date };
    const moment = (x: unknown): Moment | 'off' | 'default' => {
      if(x==='off'||x==='default')return x;
      const m=object(x),result={date:day(m.date),time:clock(m.time)};
      const utc=localToUtc(owner.timezone,result.date,result.time);
      if(!Number.isFinite(utc.getTime()) || utc.getTime() <= now.getTime())bad();return result;
    };
    const snapshot=async()=>({owner:meta,tasks:(await (data.scope==='all'?deps.store.allTasks():deps.store.openTasks())).map(publicTask)});
    if(data.action==='list') return reply({ok:true,...await snapshot()});
    if(data.action==='chat') {
      const input=chatInput(data);if(!input)bad();
      if(!deps.ai)return reply({error:'ai_unavailable'},503);
      try{return reply({ok:true,text:await miniAppChat(deps.ai,owner,await deps.store.openTasks(),now,input!)});}
      catch{return reply({error:'ai_busy'},503);}
    }
    if(data.action==='create') {
      const spec: NewTask={title:title(data.title),tags:data.tags===undefined?[]:tags(data.tags)};
      if(data.plan)spec.plan=plan(data.plan)??undefined;
      if(data.deadline)spec.deadline=day(data.deadline);
      if(data.priority)spec.priority=priority(data.priority)??undefined;
      if(data.repeat)spec.repeat=repeat(data.repeat)??undefined;
      if(data.remind){const r=moment(data.remind);if(typeof r!=='string')spec.remind=r;else bad();}
      if(data.parent!==undefined){if(!Number.isSafeInteger(data.parent)||Number(data.parent)<1)bad();const parent=await deps.store.taskByN(Number(data.parent));if(!parent)return reply({error:'not_found'},404);spec.parent=parent;}
      const result=await effects.create(spec);return reply({ok:true,task:publicTask(result.row),warning:result.warning??null,...(data.snapshot===true?await snapshot():{})});
    }
    if(!Number.isSafeInteger(data.n)||Number(data.n)<1)return reply({error:'invalid_input'},400);
    const task=await deps.store.taskByN(Number(data.n));if(!task)return reply({error:'not_found'},404);
    if(data.action==='status') {
      if(!['open','doing','done','failed'].includes(String(data.status)))bad();
      if(task.status!==data.status)await effects.setStatus(task,data.status as Status);
    } else if(data.action==='edit') {
      const v=object(data.fields),fields:Omit<EditPayload,'key'>={};
      if(Object.keys(v).some(k=>!['title','priority','deadline','repeat','tags'].includes(k)))bad();
      if('title'in v)fields.title=title(v.title);
      if('priority'in v)fields.priority=priority(v.priority);
      if('deadline'in v)fields.deadline=v.deadline===null?null:day(v.deadline);
      if('repeat'in v)fields.repeat=repeat(v.repeat);
      if('tags'in v)fields.tags=tags(v.tags);
      if(!Object.keys(fields).length)bad();
      if(!await effects.edit(task,fields,fields))return reply({error:'save_failed'},503);
    } else if(data.action==='plan') await effects.setPlan(task,plan(data.plan));
    else if(data.action==='remind') await effects.setRemind(task,moment(data.moment));
    else if(data.action==='delete') {
      if(data.confirm!==true)bad();await effects.remove(task);return reply({ok:true,...(data.snapshot===true?await snapshot():{})});
    } else return reply({error:'unknown_action'},400);
    return reply(data.snapshot===true?{ok:true,...await snapshot()}:{ok:true,task:publicTask((await deps.store.taskByN(task.n))??task)});
  } catch(error) {
    if(error instanceof InputError)return reply({error:'invalid_input'},400);
    console.error('miniapp request failed');return reply({error:'server_error'},500);
  }
}
