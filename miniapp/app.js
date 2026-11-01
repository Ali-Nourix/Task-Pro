// No tokens in URLs/storage. initData remains in memory and is validated server-side.
const API = 'https://hjycjrqsavmutdiwtwfj.supabase.co/functions/v1/miniapp';
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const fa = { heading: "برنامهٔ روز", open: "تسک باز", today: 'امروز', todayCount: "تسک‌های امروز", all: 'همه', late: 'عقب‌افتاده', search: "جست‌وجو در عنوان و برچسب‌ها", add: "افزودن تسک", refresh: "به‌روزرسانی فهرست", close: 'بستن', bot: 'بازگشت به ربات', loading: 'در حال دریافت تسک‌ها…', empty: "تسکی برای نمایش نیست", emptyHint: "تسک جدیدی اضافه کنید یا فیلتر دیگری را ببینید.", save: 'ذخیره', cancel: 'انصراف', title: "عنوان تسک", tags: "برچسب‌ها (با فاصله جدا کنید)", priority: 'اولویت', deadline: 'سررسید', repeat: 'تکرار', none: 'ندارد', status: 'وضعیت', openStatus: 'شروع نشده', doing: 'در حال انجام', done: 'انجام شد', failed: 'انجام نشد', plan: "زمان‌بندی", date: "تاریخ (میلادی)", start: "ساعت شروع", end: "ساعت پایان", removePlan: "حذف زمان‌بندی", reminder: 'یادآوری', setReminder: 'تنظیم یادآوری', off: 'حذف یادآوری', defaultReminder: "یادآوری پیش از شروع", time: 'ساعت', remove: 'حذف تسک', confirm: "این تسک حذف شود؟ حذف آن در همگام‌سازی بعدی در یادداشت‌های Obsidian هم اعمال می‌شود.", saved: "ذخیره شد. تغییرات با همگام‌سازی بعدی به Obsidian می‌رسند.", undo: "بازگردانی", sync: "آخرین دریافت از Obsidian", never: "هنوز اطلاعاتی از Obsidian دریافت نشده است.", pending: "در انتظار ارسال به Obsidian", parent: "تسک اصلی:", noParent: "بدون تسک اصلی", subtask: 'افزودن زیرتسک', session: "اعتبار ورود تمام شده است. مینی‌اپ را ببندید و از منوی ربات دوباره باز کنید.", outside: "برای دیدن تسک‌ها، مینی‌اپ را از دکمهٔ Task Pro در ربات تلگرام باز کنید.", offline: "ارتباط با سرور برقرار نشد. اینترنت را بررسی و فهرست را به‌روز کنید. اگر در حال ذخیره بودید، پیش از تکرار، نتیجه را در فهرست بررسی کنید.", invalid: "اطلاعات واردشده معتبر نیست. تاریخ و ساعت را بررسی کنید؛ ساعت پایان باید پس از شروع باشد.", missing: "این تسک دیگر در فهرست نیست. فهرست را به‌روز کنید.", error: "درخواست انجام نشد. فهرست را به‌روز کنید و پیش از تلاش دوباره، نتیجه را بررسی کنید.", help: "برای گفت‌وگو، بخش «دستیار» را باز کنید. تنظیمات بیشتر در ربات است.", gregorian: "تاریخ فرم‌ها میلادی است. تاریخ‌های فهرست با تقویم انتخاب‌شده در ربات نمایش داده می‌شوند.", hours: "منطقهٔ زمانی:", highest: "فوری", high: 'زیاد', medium: 'متوسط', low: 'کم', lowest: 'خیلی کم' };
const en = { heading: 'My day', open: 'Open tasks', today: 'Today', todayCount: 'For today', all: 'All', late: 'Overdue', search: 'Search tasks…', add: 'New task', refresh: 'Refresh', close: 'Close', bot: 'Back to bot', loading: 'Loading your tasks…', empty: 'A clear space.', emptyHint: 'Add a task or choose a different filter.', save: 'Save', cancel: 'Cancel', title: 'Title', tags: 'Tags (space-separated)', priority: 'Priority', deadline: 'Deadline', repeat: 'Repeat', none: 'None', status: 'Status', openStatus: 'Not started', doing: 'In progress', done: 'Done', failed: 'Not done', plan: 'Plan', date: 'Date', start: 'Start', end: 'End', removePlan: 'Remove plan', reminder: 'Reminder', setReminder: 'Set reminder', off: 'Remove reminder', defaultReminder: 'Before the plan', time: 'Time', remove: 'Delete task', confirm: 'Delete this task and queue the deletion for your notes?', saved: 'Saved. Obsidian will receive it on the next sync.', undo: 'Undo', sync: 'Last sync', never: 'Not synced yet', pending: 'Waiting for Obsidian', parent: 'Subtask of', noParent: 'No parent task', subtask: 'Add subtask', session: 'Your session is invalid or expired. Close and reopen the app from the bot menu.', outside: 'Open this app from the Task Pro button in your Telegram bot.', offline: 'Connection failed. Check your internet and refresh. If saving, check the result before trying again.', invalid: 'Check the fields, dates, times and time range.', missing: 'This task is no longer in the current snapshot. Refresh the list.', error: 'The request failed. Check the current state before retrying.', help: 'Chat is in the Assistant tab. Full preferences remain in the bot.', gregorian: 'Form dates use the Gregorian calendar; list dates follow your bot calendar preference.', hours: 'Times use', highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };
let lang = tg?.initDataUnsafe?.user?.language_code?.startsWith('fa') ? 'fa' : 'en', L = lang === 'fa' ? fa : en;
let chatHistory = [], chatBusy = false;
const statusKeys = ['open', 'doing', 'done', 'failed'];
let calendarStatuses = new Set(statusKeys), calendarUndated = false, records = [];
try {
    const saved = JSON.parse(localStorage.getItem('taskpro.calendar.statuses'));
    if (Array.isArray(saved) && saved.every(s => statusKeys.includes(s)))
        calendarStatuses = new Set(saved);
}
catch { }
let tasks = [], owner = null, filter = 'today', mode = 'home', selectedDay = null, weekOffset = 0, busy = false, toastTimer;
const initData = tg?.initData || '';
// Localize display only. IDs, API dates, times, form values and user content stay unchanged.
const number = value => Number(value).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB', {useGrouping:false});
const displayTime = value => lang === 'fa' ? String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : value;
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; if (cls)
    e.className = cls; return e; }
// Isolate Latin names in system copy without HTML interpolation or changing user content.
function mixed(tag,text,cls){const el=node(tag,undefined,cls);setMixedText(el,text);return el;}
function setMixedText(el,text){el.replaceChildren();let last=0;for(const match of String(text||'').matchAll(/[A-Za-z][A-Za-z0-9_.:/+-]*(?: [A-Za-z0-9_.:/+-]+)*/g)){el.append(document.createTextNode(text.slice(last,match.index)));const part=node('bdi',match[0]);part.dir='ltr';el.append(part);last=match.index+match[0].length;}el.append(document.createTextNode(String(text||'').slice(last)));}
function language(value) { lang = value; L = lang === 'fa' ? fa : en; document.documentElement.lang = lang; document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'; $('heading').textContent = L.heading; $('total-label').textContent = L.open; $('today-label').textContent = L.todayCount; $('late-label').textContent = L.late; $('search').placeholder = L.search; $('search').ariaLabel = L.search; $('refresh').ariaLabel = L.refresh; $('close').ariaLabel = L.close; $('add').ariaLabel = L.add; $('add').title = L.add; $('app').ariaLabel=lang==='fa'?'برنامهٔ تسک‌ها':'Task workspace'; $('day-overview').ariaLabel=lang==='fa'?'خلاصهٔ تسک‌های امروز':'Today summary'; $('week-panel').ariaLabel=lang==='fa'?'انتخاب روز':'Choose a day'; $('search').enterKeyHint='search'; $('chat-input').enterKeyHint='send'; $('bot').textContent = L.bot; $('this-week').textContent = L.today; $('tasks-label').textContent = lang === 'fa' ? "تسک‌ها" : 'To do'; $('upcoming-label').textContent = lang === 'fa' ? "برنامهٔ پیش رو" : 'Coming up'; $('view-plan').textContent = lang === 'fa' ? "مشاهدهٔ تقویم" : 'View plan'; $('prev-week').ariaLabel = lang === 'fa' ? "هفتهٔ پیش" : 'Previous week'; $('next-week').ariaLabel = lang === 'fa' ? 'هفتهٔ بعد' : 'Next week'; for (const b of $('bottom-nav').children)
    b.querySelector('span').textContent = ({ home: lang === 'fa' ? "خانه" : 'Home', tasks: lang === 'fa' ? 'تسک‌ها' : 'Tasks', calendar: lang === 'fa' ? 'تقویم' : 'Calendar', ai: lang === 'fa' ? 'دستیار' : 'Assistant' })[b.dataset.mode]; $('chat-title').textContent = lang === 'fa' ? "برای برنامه‌ریزی کمک بگیرید" : 'Think it through.'; $('chat-hint').textContent = lang === 'fa' ? "دربارهٔ تسک‌ها بپرسید یا برای برنامه‌ریزی روز کمک بگیرید. دستیار فقط پیشنهاد می‌دهد و تسک‌ها را تغییر نمی‌دهد." : 'Ask about your tasks or plan your day. This chat offers advice only; it does not change tasks.'; $('chat-input').placeholder = lang === 'fa' ? "مثلاً امروز از کدام تسک شروع کنم؟" : 'Write a message…'; document.querySelector('.composer-label').textContent = lang === 'fa' ? 'پیام به دستیار' : 'Message the assistant'; $('chat-input').ariaLabel = lang === 'fa' ? 'پیام به دستیار' : 'Message the assistant'; $('chat-send').textContent = lang === 'fa' ? 'ارسال' : 'Send'; $('chat-clear').textContent = lang === 'fa' ? "گفت‌وگوی جدید" : 'New conversation'; $('chat-privacy').textContent = lang === 'fa' ? "برای دریافت پاسخ، پیام و خلاصهٔ تسک‌ها به سرویس هوش مصنوعی ربات ارسال می‌شود. تاریخچهٔ این گفت‌وگو فقط تا زمان بسته‌شدن صفحه در مینی‌اپ نگه داشته می‌شود." : 'Your message and a task summary are sent to the bot’s AI provider. Chat history stays in memory until this page closes.'; $('filters').ariaLabel = lang === 'fa' ? 'فیلتر تسک‌ها' : 'Task filters'; $('bottom-nav').ariaLabel = lang === 'fa' ? 'ناوبری' : 'Navigation'; document.querySelector('.skip').textContent = lang === 'fa' ? "رفتن به فهرست تسک‌ها" : 'Skip to tasks'; }
// Telegram's light/dark choice is respected without importing low-contrast arbitrary accent pairs.
function theme() { const scheme=tg?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); document.documentElement.dataset.scheme=scheme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content',scheme==='dark'?'#191919':'#f8f8f8'); }
function formatDate(date) { if (!date)
    return ''; try {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { calendar: owner?.calendar === 'jalali' ? 'persian' : 'gregory', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
catch {
    return date;
} }
function isoLocal(date) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: owner.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(v => [v.type, v.value])); return `${p.year}-${p.month}-${p.day}`; }
const taskDayCache = new WeakMap();
function taskDays(t) { let cached = taskDayCache.get(t); if (!cached || cached.zone !== owner.timezone) {
    cached = { zone: owner.timezone, days: new Set([t.plan_date, t.deadline, t.remind_at ? isoLocal(new Date(t.remind_at)) : null].filter(Boolean)) };
    taskDayCache.set(t, cached);
} return cached.days; }
function onDay(t, date) { return taskDays(t).has(date); }
function onToday(t) { return onDay(t, owner?.today); }
function shifted(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function datePart(date, options) { return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { calendar: owner?.calendar === 'jalali' ? 'persian' : 'gregory', timeZone: 'UTC', ...options }).format(new Date(date + 'T12:00:00Z')); }
function week() { if (!owner)
    return; if (mode === 'calendar') {
    month();
    return;
} const strip = $('week-strip'); strip.replaceChildren(); strip.className = 'week-strip'; const today = owner.today, base = new Date(today + 'T12:00:00Z'), start = shifted(today, -((base.getUTCDay() + (lang === 'fa' ? 1 : 6)) % 7) + weekOffset * 7); $('week-label').textContent = datePart(start, { month: 'long', year: 'numeric' }); for (let i = 0; i < 7; i++) {
    const date = shifted(start, i), b = node('button', undefined, 'day');
    b.setAttribute('aria-pressed', String(date === (selectedDay || today)));
    b.ariaLabel = datePart(date, { weekday: 'long', month: 'long', day: 'numeric' });
    if (date === today)
        b.setAttribute('aria-current', 'date');
    b.append(node('span', datePart(date, { weekday: 'narrow' }), 'weekday'), node('span', datePart(date, { day: 'numeric' }), 'day-number'), node('span', undefined, 'day-dot' + (tasks.some(t => onDay(t, date)) ? '' : ' empty-dot')));
    b.onclick = () => { selectedDay = date; filter = 'today'; render(); };
    strip.append(b);
} }
const isActive = t => t.status === 'open' || t.status === 'doing';
const statusName = s => ({ open: L.openStatus, doing: L.doing, done: L.done, failed: L.failed })[s];
const calendarTasks = () => records.filter(t => calendarStatuses.has(t.status));
const isUndated = t => !t.plan_date && !t.deadline && !t.remind_at;
function rememberStatuses() { try {
    localStorage.setItem('taskpro.calendar.statuses', JSON.stringify([...calendarStatuses]));
}
catch { } }
function calendarOptions() {
    $('calendar-options').hidden = mode !== 'calendar';
    $('week-strip').hidden = mode === 'calendar' && calendarUndated;
    const size = calendarStatuses.size;
    $('calendar-filter-label').textContent = size === 4 ? (lang === 'fa' ? 'همهٔ وضعیت‌ها' : 'All statuses') : size === 0 ? (lang === 'fa' ? "بدون انتخاب وضعیت" : 'No statuses') : number(size) + ' ' + (lang === 'fa' ? 'وضعیت' : 'statuses');
    $('calendar-filter-summary').ariaLabel = (lang === 'fa' ? 'فیلتر وضعیت: ' : 'Status filter: ') + $('calendar-filter-label').textContent;
    // Keep the checkbox nodes alive so changing a filter never drops keyboard focus.
    const container = $('calendar-statuses');
    if (!container.children.length)
        for (const status of statusKeys) {
            const label = node('label', undefined, 'status-option status-' + status), input = node('input');
            input.type = 'checkbox';
            input.value = status;
            input.onchange = () => { if (input.checked)
                calendarStatuses.add(status);
            else
                calendarStatuses.delete(status); rememberStatuses(); render(); };
            label.append(input, node('span'));
            container.append(label);
        }
    for (const label of container.children) {
        const input = label.querySelector('input');
        input.checked = calendarStatuses.has(input.value);
        label.querySelector('span').textContent = statusName(input.value);
    }
    $('calendar-all').textContent = lang === 'fa' ? 'انتخاب همه' : 'Select all';
    $('calendar-none').textContent = lang === 'fa' ? "لغو انتخاب همه" : 'Clear selection';
    const count = calendarTasks().filter(isUndated).length;
    $('calendar-undated').textContent = (lang === 'fa' ? "بدون تاریخ" : 'Undated') + ' · ' + number(count);
    $('calendar-undated').setAttribute('aria-pressed', String(calendarUndated));
    $('calendar-hint').textContent = calendarUndated ? (lang === 'fa' ? "این تسک‌ها تاریخ برنامه، سررسید یا یادآوری ندارند." : 'Tasks without a plan, deadline or reminder.') : (lang === 'fa' ? "در هر روز، تسک‌های برنامه‌ریزی‌شده و تسک‌هایی با سررسید یا یادآوری همان روز نمایش داده می‌شوند." : 'Each day includes its planned tasks, deadlines and reminders.');
}
function monthBounds(anchor) { const key = d => datePart(d, { month: 'long', year: 'numeric' }); let first = anchor, last = anchor; while (key(shifted(first, -1)) === key(anchor))
    first = shifted(first, -1); while (key(shifted(last, 1)) === key(anchor))
    last = shifted(last, 1); return { first, last }; }
function month() {
    const anchor = selectedDay || owner.today, { first, last } = monthBounds(anchor), strip = $('week-strip');
    strip.className = 'month-grid';
    strip.replaceChildren();
    $('week-label').textContent = datePart(first, { month: 'long', year: 'numeric' });
    $('prev-week').ariaLabel = lang === 'fa' ? "ماه پیش" : 'Previous month';
    $('next-week').ariaLabel = lang === 'fa' ? 'ماه بعد' : 'Next month';
    const offset = (new Date(first + 'T12:00:00Z').getUTCDay() + (lang === 'fa' ? 1 : 6)) % 7, gridStart = shifted(first, -offset), days = Math.ceil((offset + Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1) / 7) * 7;
    for (let i = 0; i < 7; i++)
        strip.append(node('span', datePart(shifted(gridStart, i), { weekday: 'narrow' }), 'month-weekday'));
    for (let i = 0; i < days; i++) {
        const date = shifted(gridStart, i), inMonth = date >= first && date <= last, items = calendarTasks().filter(t => onDay(t, date)), b = button('', () => { selectedDay = date; calendarUndated = false; filter = 'today'; render(); }, 'month-cell' + (inMonth ? '' : ' outside-month'));
        b.dataset.date = date;
        b.setAttribute('aria-pressed', String(!calendarUndated && date === anchor));
        if (date === owner.today)
            b.setAttribute('aria-current', 'date');
        b.ariaLabel = datePart(date, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + number(items.length) + ' ' + (lang === 'fa' ? 'تسک' : 'tasks');
        b.append(node('span', datePart(date, { day: 'numeric' }), 'month-number'));
        if (items.length) {
            const count = node('span', (items.length > 99 ? items.length.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB') : number(items.length) + ' ' + (lang === 'fa' ? "تسک" : items.length === 1 ? 'task' : 'tasks')), 'month-task-count sr-only');
            b.append(count);
            const marks = node('span', undefined, 'month-status-marks');
            for (const status of statusKeys)
                if (items.some(t => t.status === status)) {
                    const mark = node('span', undefined, 'status-mark status-' + status);
                    mark.setAttribute('aria-hidden', 'true');
                    marks.append(mark);
                }
            b.append(marks);
            b.title = items.map(t => (t.plan_start ? t.plan_start + ' · ' : '') + t.title).join('\n');
        }
        strip.append(b);
    }
}
function overview() {
    const today = records.filter(onToday), done = today.filter(t => t.status === 'done').length, total = today.length;
    $('overview-label').textContent = lang === 'fa' ? "خلاصهٔ امروز" : 'One task at a time';
    $('overview-progress').textContent = lang === 'fa' ? `${done.toLocaleString('fa-IR')} از ${total.toLocaleString('fa-IR')} انجام شده` : `${done} of ${total} done`;
    for (const [id, value, label] of [['overview-today', tasks.filter(onToday).length, L.today], ['overview-open', tasks.length, lang === 'fa' ? "تسک باز" : 'Open'], ['overview-done', done, lang === 'fa' ? "انجام‌شدهٔ امروز" : 'Done today']]) {
        const el = $(id);
        el.querySelector('strong').textContent = value.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB');
        el.querySelector('span').textContent = label;
        el.ariaLabel = label + ' · ' + number(value);
    }
    $('completion-fill').style.width = (total ? done / total * 100 : 0) + '%';
    $('calendar-legend').hidden = mode !== 'calendar' || calendarUndated;
    $('calendar-legend').replaceChildren(...statusKeys.map(s => { const label = node('span', undefined, 'legend-item'); label.append(node('i', undefined, 'status-mark status-' + s), document.createTextNode(statusName(s))); return label; }));
    $('day-add').textContent = lang === 'fa' ? "+ افزودن" : '+ Task';
    $('day-add').ariaLabel = lang === 'fa' ? "افزودن تسک به روز انتخاب‌شده" : 'Add a task to the selected day';
}
function timeRange(t) { const range=node('span',undefined,'time-range'); range.dir=lang==='fa'?'rtl':'ltr'; const first=node('bdi',displayTime(t.plan_start)); first.dir='ltr'; range.append(first); if(t.plan_end){const last=node('bdi',displayTime(t.plan_end));last.dir='ltr';range.append(document.createTextNode(lang==='fa'?' تا ':' – '),last);}return range; }
function upcoming() { const card = $('next-task'); card.replaceChildren(); const target = selectedDay || owner.today, t = tasks.filter(t => t.plan_date && t.plan_date > target).sort((a, b) => (a.plan_date + (a.plan_start || '')).localeCompare(b.plan_date + (b.plan_start || '')))[0]; if (mode === 'home')
    $('upcoming').hidden = !t; card.classList.toggle('event-empty', !t); if (!t) {
    card.append(node('strong', lang === 'fa' ? "هنوز برنامه‌ای ثبت نشده است" : 'Room for a fresh plan'), node('small', lang === 'fa' ? "تسک جدیدی اضافه و زمان آن را مشخص کنید." : 'Add a task and make time for it.'));
    card.onclick = () => add();
    return;
} const date = node('span', undefined, 'event-date'); date.append(node('span', datePart(t.plan_date, { month: 'short' })), node('strong', datePart(t.plan_date, { day: 'numeric' }))); const content = node('span'); const meta = node('span', undefined, 'event-meta'); meta.append(t.plan_start ? timeRange(t) : document.createTextNode(L.plan), document.createTextNode(' · ' + datePart(t.plan_date, { weekday: 'long' }))); content.append(node('span', t.title, 'event-title'), meta); card.append(date, content, node('span', '›', 'event-arrow')); card.onclick = () => details(t); }
function navigate(next) { mode = next; calendarUndated = false; notice(''); $('toast').hidden = true; filter = next === 'tasks' ? 'all' : 'today'; selectedDay = owner?.today || null; weekOffset = 0; render(); $('app').scrollTop = 0; }
function late(t) { return (t.deadline && t.deadline < owner?.today) || (!t.deadline && t.plan_date && t.plan_date < owner?.today); }
function notice(text) { $('notice').hidden = !text; setMixedText($('notice'),text || ''); }
function toast(text, undo) { clearTimeout(toastTimer); const e = $('toast'); e.replaceChildren(mixed('span', text)); if (undo) {
    const b = node('button', L.undo);
    b.onclick = undo;
    e.append(b);
} e.hidden = false; toastTimer = setTimeout(() => e.hidden = true, 7000); }
function lock(v) { busy = v; $('app').ariaBusy = String(v); document.documentElement.classList.toggle('saving', v); $('progress').hidden = !v; $('progress').textContent = lang === 'fa' ? "در حال دریافت اطلاعات…" : 'Working…'; for (const b of document.querySelectorAll('#sheet button[type=submit]')) {
    if (v) {
        b.dataset.label = b.textContent;
        b.textContent = lang === 'fa' ? 'در حال ذخیره…' : 'Saving…';
    }
    else if (b.dataset.label) {
        b.textContent = b.dataset.label;
        delete b.dataset.label;
    }
} for (const e of document.querySelectorAll('#sheet button,.tick,#add,#refresh'))
    if (e.id !== 'close')
        e.disabled = v; }
function adopt(data) { records = data.tasks; tasks = records.filter(isActive); owner = data.owner; selectedDay = selectedDay || owner.today; language(owner.language); notice(''); render(); }
async function request(body) { if (!initData)
    throw { code: 'outside' }; const controller = new AbortController(), timer = setTimeout(() => controller.abort(), body.action === 'chat' ? 35000 : 15000); try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData }, body: JSON.stringify(body), signal: controller.signal });
    const data = await r.json();
    if (!r.ok)
        throw { code: data.error };
    return data;
}
catch (e) {
    if (e.code)
        throw e;
    throw { code: 'offline' };
}
finally {
    clearTimeout(timer);
} }
function errorMessage(e) { const code = e.code; return code === 'unauthorized' || code === 'forbidden' ? L.session : code === 'outside' ? L.outside : code === 'invalid_input' ? L.invalid : code === 'not_found' ? L.missing : code === 'offline' ? L.offline : L.error; }
function error(e) { clearTimeout(toastTimer); $('toast').hidden = true; notice(errorMessage(e)); }
function render() {
    const focusedDate = document.activeElement?.closest('.month-cell')?.dataset.date;
    const aiMode = mode === 'ai', cal = mode === 'calendar', list = $('tasks');
    $('day-overview').hidden = mode !== 'home';
    const overdueCount = tasks.filter(late).length;
    $('overdue-callout').hidden = mode !== 'home' || !overdueCount || filter === 'late';
    $('overdue-callout').replaceChildren(node('span', lang === 'fa' ? `${number(overdueCount)} تسک عقب‌افتاده از روزهای قبل` : `${overdueCount} overdue tasks from previous days`),node('span',lang === 'fa' ? 'مشاهده' : 'Review','callout-action'));
    $('add-label').textContent = L.add;
    $('day-add').hidden = !cal;
    $('chat-panel').hidden = !aiMode;
    document.querySelector('.task-section').hidden = aiMode;
    document.documentElement.classList.toggle('mode-calendar', cal);
    $('week-panel').hidden = aiMode || mode === 'tasks';
    $('upcoming').hidden = mode !== 'home';
    document.querySelector('.list-tools').hidden = cal;
    document.querySelector('.search').hidden = cal || mode === 'home' && filter === 'today';
    $('heading').textContent = cal ? (lang === 'fa' ? "تقویم تسک‌ها" : 'Task calendar') : mode === 'tasks' ? (lang === 'fa' ? "همهٔ تسک‌ها" : 'My tasks') : mode === 'ai' ? (lang === 'fa' ? "دستیار" : 'My assistant') : L.heading;
    $('total-label').textContent = lang === 'fa' ? 'تسک' : 'tasks';
    $('today-count').textContent = number(tasks.filter(onToday).length);
    $('late-count').textContent = number(tasks.filter(late).length);
    const target = selectedDay || owner?.today, search = cal ? '' : $('search').value.toLocaleLowerCase();
    const source = cal ? calendarTasks() : tasks;
    const shown = source.filter(t => (cal ? (calendarUndated ? isUndated(t) : onDay(t, target)) : (filter === 'all' || filter === 'today' && onDay(t, target) || filter === 'late' && late(t))) && [t.title, ...t.tags].join(' ').toLocaleLowerCase().includes(search)).sort((a, b) => cal ? ((a.plan_date === target ? a.plan_start : null) || '99:99').localeCompare((b.plan_date === target ? b.plan_start : null) || '99:99') || a.n - b.n : 0);
    $('total').textContent = number(shown.length);
    $('tasks-label').textContent = cal ? (calendarUndated ? (lang === 'fa' ? "تسک‌های بدون تاریخ" : 'Undated tasks') : datePart(target, { weekday: 'long', day: 'numeric', month: 'long' })) : (filter === 'late' ? L.late : filter === 'all' ? (lang === 'fa' ? "تسک‌های باز" : 'All open tasks') : (lang === 'fa' ? 'برنامهٔ روز' : 'Daily plan'));
    list.replaceChildren();
    for (const t of shown) {
        const row = node('article', undefined, 'task status-' + t.status), tick = node('button', undefined, 'tick'), ring = node('span', undefined, 'check-ring');
        ring.setAttribute('aria-hidden', 'true');
        if (t.status === 'done' || t.status === 'failed') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2.2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('d', t.status === 'done' ? 'M5 12l4 4L19 6' : 'M7 7l10 10M17 7L7 17');
            svg.append(path);
            ring.append(svg);
        }
        else if (t.status === 'doing')
            ring.append(node('span', undefined, 'doing-dot'));
        tick.append(ring);
        tick.ariaLabel = (t.status === 'done' ? (lang === 'fa' ? "بازگشایی تسک" : 'Reopen') : L.done) + ': ' + t.title;
        tick.setAttribute('aria-pressed', String(t.status === 'done'));
        tick.onclick = () => mutate({ action: 'status', n: t.n, status: t.status === 'done' ? 'open' : 'done' }, () => toast(L.saved, () => mutate({ action: 'status', n: t.n, status: t.status })));
        const main = node('button', undefined, 'task-main');
        main.append(node('span', t.title, 'task-title'));
        const meta = node('span', undefined, 'task-meta');
        if (cal) {
            const badge = node('span', statusName(t.status), 'status-badge status-' + t.status);
            meta.append(badge);
        }
        if (cal && t.plan_date !== target && !calendarUndated) {
            if (t.deadline === target)
                meta.append(node('span', L.deadline));
            if (t.remind_at && isoLocal(new Date(t.remind_at)) === target)
                meta.append(node('span', L.reminder + ' · ' + new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: owner.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(t.remind_at))));
        }
        else if (t.plan_date) {
            const date = node('span', cal ? '' : formatDate(t.plan_date), isActive(t) && late(t) ? 'late' : '');
            if (t.plan_start) {
                if (!cal)
                    date.append(document.createTextNode(' · '));
                if (!cal)
                    date.append(timeRange(t));
            }
            else if (cal)
                date.textContent = '';
            if (date.textContent)
                meta.append(date);
        }
        else if (t.deadline)
            meta.append(node('span', L.deadline + ' · ' + formatDate(t.deadline), isActive(t) && late(t) ? 'late' : ''));
        if (!cal && t.status === 'doing')
            meta.append(node('span', L.doing, 'pill'));
        if (t.priority)
            meta.append(node('span', L[t.priority], 'pill'));
        if (t.parent_title)
            meta.append(node('span', L.parent + ' ' + t.parent_title));
        if (t.subs_total)
            meta.append(node('span', `${number(t.subs_done || 0)}/${number(t.subs_total)}`));
        for (const tag of t.tags.slice(0, 3))
            meta.append(node('span', '#' + tag));
        if (t.pending)
            meta.append(mixed('span', L.pending));
        main.append(meta);
        main.onclick = () => details(t);
        const tm = node('span', undefined, 'agenda-time');
        if (t.plan_date === target && t.plan_start) {
            tm.append(node('bdi', displayTime(t.plan_start)));
            if (t.plan_end)
                tm.append(node('bdi', displayTime(t.plan_end), 'agenda-end'));
        }
        else
            tm.textContent = t.plan_date === target ? (lang === 'fa' ? "بدون ساعت" : 'All day') : '—';
        row.append(tm, tick, main);
        list.append(row);
    }
    if (!shown.length) {
        const empty = node('div', undefined, 'empty');
        let title, hint;
        if (search) { title=lang === 'fa' ? 'نتیجه‌ای پیدا نشد' : 'No results'; hint=lang === 'fa' ? 'عبارت کوتاه‌تری بنویسید یا برچسب دیگری را جست‌وجو کنید.' : 'Try a shorter phrase or a different tag.'; }
        else if (cal && !calendarStatuses.size) { title=lang === 'fa' ? 'هیچ وضعیتی انتخاب نشده است' : 'No statuses selected'; hint=lang === 'fa' ? 'از فیلتر وضعیت، دست‌کم یک مورد را انتخاب کنید.' : 'Choose at least one status in the filter.'; }
        else if (cal && calendarUndated) { title=lang === 'fa' ? 'تسک بدون تاریخ ندارید' : 'No undated tasks'; hint=lang === 'fa' ? 'برای دیدن تسک‌های تاریخ‌دار، دوباره «بدون تاریخ» را بزنید.' : 'Toggle Undated off to see scheduled tasks.'; }
        else if (cal || filter === 'today') { title=lang === 'fa' ? 'برای این روز تسکی نیست' : 'No tasks for this day'; hint=lang === 'fa' ? 'روز دیگری را ببینید یا تسک جدیدی اضافه کنید.' : 'Choose another day or add a task.'; }
        else if (filter === 'late') { title=lang === 'fa' ? 'تسک عقب‌افتاده‌ای ندارید' : 'No overdue tasks'; hint=lang === 'fa' ? 'برای ادامه، تسک‌های امروز یا همهٔ تسک‌های باز را ببینید.' : 'Continue with today or all open tasks.'; }
        else { title=lang === 'fa' ? 'تسک بازی ندارید' : 'No open tasks'; hint=lang === 'fa' ? 'تسک جدیدی اضافه کنید. تسک‌های انجام‌شده در تقویم هستند.' : 'Add a task. Completed tasks are in the calendar.'; }
        empty.append(node('strong',title),node('span',hint));
        list.append(empty);
    }
    for (const b of $('filters').children) {
        b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
        const counter = b.querySelector('span');
        const label = b.dataset.filter === 'today' && selectedDay && selectedDay !== owner?.today ? formatDate(selectedDay) : L[b.dataset.filter];
        if (counter) {
            b.replaceChildren(document.createTextNode(label + ' '), counter);
            counter.className = 'filter-count';
            counter.textContent = number(b.dataset.filter === 'today' ? tasks.filter(t => onDay(t, target)).length : tasks.filter(late).length);
        }
        else
            b.textContent = label;
    }
    for (const b of $('bottom-nav').children)
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const syncDate = owner?.last_sync_at ? new Date(owner.last_sync_at) : null;
    const pendingCount = records.filter(t => t.pending).length;
    const syncText = syncDate ? L.sync + ' · ' + new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: owner.timezone, month:'short', day:'numeric', hour: '2-digit', minute: '2-digit' }).format(syncDate) + (pendingCount ? ' · ' + number(pendingCount) + (lang==='fa'?' تسک ':' tasks ') + L.pending : '') : L.never;
    setMixedText($('sync'),syncText);
    $('sync').title = lang === 'fa' ? "این زمان، آخرین دریافت اطلاعات از Obsidian است؛ باز بودن برنامه به معنی انجام همگام‌سازی نیست." : 'Last snapshot received from Obsidian, not a connection indicator.';
    $('date').textContent = owner ? datePart(owner.today, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    if (owner) {
        overview();
        calendarOptions();
        week();
        upcoming();
    }
    if (focusedDate)
        document.querySelector('.month-cell[data-date="' + focusedDate + '"]')?.focus({ preventScroll: true });
}
async function load() { adopt(await request({ action: 'list', scope: 'all' })); }
async function refresh() { if (busy)
    return; lock(true); try {
    await load();
}
catch (e) {
    error(e);
}
finally {
    lock(false);
} }
async function mutate(body, after) { if (busy)
    return; lock(true); try {
    const data = await request({ ...body, snapshot: true, scope: 'all' });
    $('sheet').close();
    if (data.tasks && data.owner)
        adopt(data);
    else
        await load();
    if (after)
        after();
    else
        toast(L.saved);
}
catch (e) {
    error(e);
    if ($('sheet').open) {
        $('sheet-body').querySelector('[data-form-error]')?.remove();
        const msg = node('p', errorMessage(e), 'notice');
        msg.dataset.formError = 'true';
        msg.setAttribute('role', 'alert');
        $('sheet-body').prepend(msg);
        msg.scrollIntoView({ block: 'nearest' });
    }
}
finally {
    lock(false);
} }
function openSheet(title) { $('sheet-title').textContent = title; $('sheet-body').replaceChildren(); if (!$('sheet').open)
    $('sheet').showModal(); tg?.BackButton?.show(); }
function button(text, fn, cls) { const e = node('button', text, cls); e.type = 'button'; e.onclick = fn; return e; }
function field(form, label, type, value = '', required = false) { const wrap = node('label', undefined, 'field'); wrap.append(node('span', label)); const input = node('input'); input.type = type; input.value = value ?? ''; input.required = required; wrap.append(input); form.append(wrap); return input; }
let selectId = 0;
function select(form, label, options, value) {
    const wrap = node('div', undefined, 'field custom-select'), caption = node('span', label), trigger = button('', () => { }), list = node('div', undefined, 'select-options'), id = 'choice-' + (++selectId), state = { value };
    caption.id = id + '-label';
    trigger.id = id;
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-labelledby', caption.id + ' ' + id + '-value');
    trigger.setAttribute('aria-controls', id + '-options');
    list.id = id + '-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', caption.id);
    list.hidden = true;
    const text = node('span', undefined, 'choice-value'), chevron = node('span', undefined, 'choice-chevron');
    text.id = id + '-value';
    trigger.append(text, chevron);
    const items = [];
    const close = () => { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant'); };
    const choose = (i) => { state.value = options[i][0]; text.textContent = options[i][1]; items.forEach((b, j) => b.setAttribute('aria-selected', String(i === j))); close(); trigger.focus(); };
    let active = Math.max(0, options.findIndex(o => o[0] === value));
    const highlight = i => { active = (i + options.length) % options.length; items.forEach((b, j) => b.classList.toggle('is-active', j === active)); trigger.setAttribute('aria-activedescendant', items[active].id); items[active].scrollIntoView({ block: 'nearest' }); };
    const open = () => { document.querySelectorAll('.select-trigger[aria-expanded=true]').forEach(b => { if (b !== trigger)
        b.click(); }); list.hidden = false; trigger.setAttribute('aria-expanded', 'true'); highlight(Math.max(0, options.findIndex(o => o[0] === state.value))); list.scrollIntoView({ block: 'nearest' }); };
    options.forEach(([v, t], i) => { const item = node('div', t, 'select-option'); item.id = id + '-option-' + i; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(v === value)); item.onpointerdown = e => e.preventDefault(); item.onclick = () => choose(i); items.push(item); list.append(item); });
    text.textContent = options[active][1];
    trigger.onclick = () => list.hidden ? open() : close();
    trigger.onkeydown = e => { if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(e.key)) {
        if (e.key === 'Tab') {
            close();
            return;
        }
        if (e.key === 'Escape' && list.hidden)
            return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (list.hidden) {
            open();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ')
            choose(active);
        else
            highlight(e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : active + (e.key === 'ArrowDown' ? 1 : -1));
    } };
    wrap.onfocusout = () => queueMicrotask(() => { if (!wrap.contains(document.activeElement))
        close(); });
    wrap.append(caption, trigger, list);
    form.append(wrap);
    return state;
}
function form(title) { const f = node('form'); f.append(node('h3', title)); $('sheet-body').append(f); return f; }
function save(f, text = L.save) { const b = node('button', text, 'primary'); b.type = 'submit'; f.append(b); }
const priorities = () => [['', L.none], ...['highest', 'high', 'medium', 'low', 'lowest'].map(p => [p, L[p]])];
function add(parent) {
    openSheet(L.add);
    const f = form(L.add);
    f.querySelector('h3').remove();
    const name = field(f, L.title, 'text', '', true);
    name.maxLength = 300;
    name.placeholder = lang === 'fa' ? "مثلاً بازبینی گزارش هفتگی" : 'What needs to get done?';
    const schedule = node('fieldset', undefined, 'create-schedule');
    schedule.append(node('legend', L.plan));
    f.append(schedule);
    const date = field(schedule, L.date, 'date', mode === 'calendar' && !calendarUndated ? selectedDay : '');
    const times = node('div', undefined, 'form-row');
    schedule.append(times);
    const start = field(times, L.start, 'time'), end = field(times, L.end, 'time');
    schedule.append(mixed('p', L.hours + ' ' + owner.timezone + ' · ' + (lang === 'fa' ? "تاریخ را به میلادی وارد کنید." : 'Gregorian date input'), 'help'));
    const more = node('details', undefined, 'create-more');
    more.open = !!parent;
    more.append(node('summary', lang === 'fa' ? "گزینه‌های بیشتر" : 'Priority, tags & subtasks'));
    const options = node('div');
    more.append(options);
    f.append(more);
    const priority = select(options, L.priority, priorities(), '');
    const tag = field(options, L.tags, 'text');
    const parentTasks = tasks.filter(t => !t.parent_title), subLabel = node('label', undefined, 'subtask-toggle'), sub = node('input');
    sub.type = 'checkbox';
    sub.checked = !!parent;
    sub.disabled = !parentTasks.length;
    subLabel.append(sub, node('span', lang === 'fa' ? "این مورد، زیرتسک است" : 'Make this a subtask'));
    options.append(subLabel);
    const parentWrap = node('div', undefined, 'parent-picker');
    options.append(parentWrap);
    const p = select(parentWrap, lang === 'fa' ? "تسک اصلی" : 'Parent task', parentTasks.length ? parentTasks.map(t => [String(t.n), t.title]) : [['', L.noParent]], parent ? String(parent.n) : String(parentTasks[0]?.n || ''));
    parentWrap.hidden = !sub.checked;
    sub.onchange = () => parentWrap.hidden = !sub.checked;
    if (!parentTasks.length)
        f.append(node('p', lang === 'fa' ? "برای افزودن زیرتسک، ابتدا یک تسک اصلی اضافه کنید." : 'Create a parent task first to add subtasks.', 'help'));
    save(f, L.add);
    f.onsubmit = e => {
        e.preventDefault();
        f.querySelector('[data-validation]')?.remove();
        if ((start.value || end.value) && !date.value || end.value && (!start.value || end.value <= start.value)) {
            const msg = node('p', L.invalid, 'notice');
            msg.dataset.validation = 'true';
            msg.setAttribute('role', 'alert');
            schedule.prepend(msg);
            msg.scrollIntoView({ block: 'nearest' });
            return;
        }
        mutate({ action: 'create', title: name.value, tags: cleanTags(tag.value), ...(date.value ? { plan: { date: date.value, ...(start.value ? { start: start.value } : {}), ...(end.value ? { end: end.value } : {}) } } : {}), ...(priority.value ? { priority: priority.value } : {}), ...(sub.checked && p.value ? { parent: Number(p.value) } : {}) });
    };
    name.focus();
}
function cleanTags(s) { return [...new Set(s.normalize('NFC').toLowerCase().split(/[\s,،#]+/).filter(Boolean))]; }
function details(t) {
    openSheet(t.title);
    const facts = node('div', undefined, 'detail-facts');
    if (t.subs_total)
        facts.append(node('span', `${number(t.subs_done || 0)}/${number(t.subs_total)} · ${lang === 'fa' ? "زیرتسک انجام شده" : 'subtasks complete'}`));
    facts.append(mixed('span', L.hours + ' ' + owner.timezone));
    $('sheet-body').append(facts);
    const st = form(L.status);
    const status = select(st, L.status, [['open', L.openStatus], ['doing', L.doing], ['done', L.done], ['failed', L.failed]], t.status);
    save(st);
    st.onsubmit = e => { e.preventDefault(); mutate({ action: 'status', n: t.n, status: status.value }); };
    const f = form(lang==='fa'?'جزئیات تسک':'Task details'), name = field(f, L.title, 'text', t.title, true), p = select(f, L.priority, priorities(), t.priority || ''), due = field(f, L.deadline+(lang==='fa'?' (میلادی)':''), 'date', t.deadline), repeat = field(f, L.repeat, 'text', t.repeat), tags = field(f, L.tags, 'text', t.tags.join(' '));
    name.maxLength = 300;
    repeat.pattern = '[1-9][0-9]{0,2}[dwm]';
    const repeatHint=node('p',undefined,'help');
    if(lang==='fa') repeatHint.append(document.createTextNode('کد تکرار: '),node('bdi','1d'),document.createTextNode(' روزانه، '),node('bdi','2w'),document.createTextNode(' هر دو هفته، '),node('bdi','1m'),document.createTextNode(' ماهانه. برای حذف تکرار، این کادر را خالی بگذارید.'));
    else repeatHint.textContent='Repeat code: 1d daily, 2w every two weeks, 1m monthly. Leave blank to stop repeating.';
    repeat.dir='ltr'; repeat.autocapitalize='none'; repeat.spellcheck=false; repeat.parentElement.append(repeatHint);
    save(f);
    f.onsubmit = e => { e.preventDefault(); mutate({ action: 'edit', n: t.n, fields: { title: name.value, priority: p.value || null, deadline: due.value || null, repeat: repeat.value || null, tags: cleanTags(tags.value) } }); };
    const pf = form(L.plan), date = field(pf, L.date, 'date', t.plan_date, true), row = node('div', undefined, 'form-row');
    pf.append(row);
    const start = field(row, L.start, 'time', t.plan_start), end = field(row, L.end, 'time', t.plan_end);
    pf.append(mixed('p', L.hours + ' ' + owner.timezone, 'help'));
    save(pf);
    pf.append(button(L.removePlan, () => mutate({ action: 'plan', n: t.n, plan: null }), 'text-button'));
    pf.onsubmit = e => { e.preventDefault(); if (end.value && (!start.value || end.value <= start.value)) {
        error({ code: 'invalid_input' });
        const msg = node('p', L.invalid, 'notice');
        pf.querySelector('.notice')?.remove();
        pf.prepend(msg);
        msg.scrollIntoView({ block: 'nearest' });
        return;
    } mutate({ action: 'plan', n: t.n, plan: { date: date.value, ...(start.value ? { start: start.value } : {}), ...(end.value ? { end: end.value } : {}) } }); };
    const rf = form(L.reminder), rd = field(rf, L.date, 'date', owner.today, true), rt = field(rf, L.time, 'time', '09:00', true);
    if (t.remind_at)
        rf.append(node('p', new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: owner.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t.remind_at)), 'help'));
    save(rf, L.setReminder);
    rf.onsubmit = e => { e.preventDefault(); mutate({ action: 'remind', n: t.n, moment: { date: rd.value, time: rt.value } }); };
    const ra = node('div', undefined, 'actions');
    ra.append(button(L.off, () => mutate({ action: 'remind', n: t.n, moment: 'off' })), button(L.defaultReminder, () => mutate({ action: 'remind', n: t.n, moment: 'default' })));
    rf.append(ra);
    $('sheet-body').append(node('p', L.gregorian, 'help'), button(L.subtask, () => add(t), 'text-button'), node('p', L.help, 'help'), button(L.remove, () => { if (window.confirm(L.confirm))
        mutate({ action: 'delete', n: t.n, confirm: true }); }, 'danger'));
    for (const [i, f] of [...$('sheet-body').querySelectorAll('form')].entries()) {
        const group = node('details', undefined, 'editor-group'), summary = node('summary', f.querySelector('h3').textContent);
        group.open = i === 1;
        f.querySelector('h3').remove();
        f.before(group);
        group.append(summary, f);
    }
}
function chatMessage(role, text) { const article = node('article', undefined, 'chat-message ' + role); article.append(node('span', role === 'user' ? (lang === 'fa' ? "شما" : 'You') : (lang === 'fa' ? 'دستیار' : 'Assistant'), 'chat-author'), node('p', text)); $('chat-messages').append(article); return article; }
function sizeMessage() { const input = $('chat-input'); input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; }
$('chat-input').addEventListener('input', sizeMessage);
$('chat-clear').onclick = () => { if (chatBusy)
    return; chatHistory = []; $('chat-messages').replaceChildren(); $('chat-error').hidden = true; };
$('chat-form').onsubmit = async (e) => { e.preventDefault(); if (chatBusy || busy)
    return; const input = $('chat-input'), text = input.value.trim(); if (!text)
    return; chatBusy = true; $('chat-send').disabled = true; $('chat-clear').disabled = true; $('chat-error').hidden = true; chatMessage('user', text); input.value = ''; sizeMessage(); const pending = chatMessage('assistant', lang === 'fa' ? "در حال آماده‌کردن پاسخ…" : 'Thinking…'); pending.classList.add('thinking'); $('chat-messages').ariaBusy = 'true'; pending.scrollIntoView({ block: 'nearest' }); try {
    const data = await request({ action: 'chat', text, history: chatHistory.slice(-8) });
    pending.remove();
    chatMessage('assistant', data.text);
    chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: data.text });
    chatHistory = chatHistory.slice(-8);
}
catch (err) {
    pending.remove();
    const msg = err.code === 'offline' ? (lang === 'fa' ? "پاسخی دریافت نشد. اینترنت را بررسی کنید؛ متن پیام حفظ شده است." : 'No reply received. Check your connection; your draft is preserved.') : err.code === 'ai_unavailable' ? (lang === 'fa' ? "دستیار هنوز راه‌اندازی نشده است. تنظیمات هوش مصنوعی را در ربات بررسی کنید." : 'The bot’s AI provider is not configured yet.') : err.code === 'ai_busy' ? (lang === 'fa' ? "دستیار در دسترس نیست. کمی بعد دوباره پیام بفرستید." : 'The AI service did not respond. Try again later.') : errorMessage(err);
    $('chat-error').textContent = msg;
    $('chat-error').hidden = false;
    input.value = text;
    sizeMessage();
}
finally {
    chatBusy = false;
    $('chat-send').disabled = false;
    $('chat-clear').disabled = false;
    $('chat-messages').ariaBusy = 'false';
} };
// Calendar popover is dismissible without losing the selected statuses.
document.addEventListener('pointerdown', e => { if (!$('calendar-filter').contains(e.target))
    $('calendar-filter').open = false; });
$('calendar-filter').addEventListener('keydown', e => { if (e.key === 'Escape') {
    $('calendar-filter').open = false;
    $('calendar-filter-summary').focus();
    e.preventDefault();
    e.stopPropagation();
} });
$('week-strip').addEventListener('keydown', e => { const cell = e.target.closest('.month-cell'); if (!cell || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key))
    return; e.preventDefault(); const horizontal = (e.key === 'ArrowRight' ? 1 : -1) * (lang === 'fa' ? -1 : 1), step = e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : horizontal; selectedDay = shifted(cell.dataset.date, step); calendarUndated = false; render(); document.querySelector('.month-cell[data-date="' + selectedDay + '"]')?.focus({ preventScroll: true }); });
$('calendar-all').onclick = () => { calendarStatuses = new Set(statusKeys); rememberStatuses(); render(); };
$('calendar-none').onclick = () => { calendarStatuses.clear(); rememberStatuses(); render(); };
$('calendar-undated').onclick = () => { calendarUndated = !calendarUndated; render(); };
$('bottom-nav').onclick = e => { const b = e.target.closest('button[data-mode]'); if (b)
    navigate(b.dataset.mode); };
$('view-plan').onclick = () => navigate('calendar');
$('this-week').onclick = () => { calendarUndated = false; weekOffset = 0; selectedDay = owner?.today; filter = 'today'; render(); };
for (const [id, step] of [['prev-week', -1], ['next-week', 1]])
    $(id).onclick = () => { if (!owner)
        return; if (mode === 'calendar') {
        calendarUndated = false;
        const bounds = monthBounds(selectedDay || owner.today);
        selectedDay = step < 0 ? shifted(bounds.first, -1) : shifted(bounds.last, 1);
    }
    else {
        weekOffset += step;
        selectedDay = shifted(owner.today, weekOffset * 7);
    } filter = 'today'; render(); };
$('filters').onclick = e => { const b = e.target.closest('button[data-filter]'); if (b) {
    filter = b.dataset.filter;
    if (filter === 'today') {
        selectedDay = owner?.today;
        weekOffset = 0;
    }
    render();
} };
$('overdue-callout').onclick = () => { filter = 'late'; render(); };
$('search').oninput = render;
$('refresh').onclick = refresh;
$('add').onclick = () => add();
$('day-add').onclick = () => add();
$('overview-today').onclick = () => { filter = 'today'; selectedDay = owner.today; render(); document.querySelector('.task-section').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
$('overview-open').onclick = () => navigate('tasks');
$('overview-done').onclick = () => { navigate('calendar'); calendarStatuses = new Set(['done']); rememberStatuses(); render(); };
$('close').onclick = () => $('sheet').close();
$('sheet').addEventListener('close', () => tg?.BackButton?.hide());
tg?.BackButton?.onClick(() => $('sheet').close());
$('bot').onclick = () => tg?.close?.();
tg?.onEvent?.('themeChanged', theme);
language(lang);
theme();
tg?.ready?.();
tg?.expand?.();
const skeleton=node('div',undefined,'task-skeleton'); skeleton.setAttribute('aria-hidden','true'); skeleton.append(node('span'),node('span'),node('span')); $('tasks').append(skeleton,node('p',L.loading,'loading-copy')); 
if (!initData) {
    $('heading').textContent = 'Task Pro';
    $('week-panel').hidden = true;
    $('upcoming').hidden = true;
    document.querySelector('.task-section').hidden = true;
    document.querySelector('.dock').hidden = true;
    document.querySelector('footer').hidden = true;
    $('notice').classList.add('info');
    notice(L.outside);
    $('tasks').replaceChildren();
    for (const e of document.querySelectorAll('button'))
        if (e.id !== 'bot')
            e.disabled = true;
    $('app').ariaBusy = 'false';
}
else
    refresh();
window.addEventListener('offline', () => notice(L.offline));

// Re-read on return; never submit writes automatically.
window.addEventListener('online', () => { if(initData && !$('sheet').open && !chatBusy) refresh(); });
let hiddenAt=0; document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(initData && hiddenAt && Date.now()-hiddenAt>30000 && !$('sheet').open && !chatBusy)refresh();});
