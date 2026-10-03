/**
 * The quick-add sheet's reader (src/board/quick-add.ts) against the Telegram
 * bot's (supabase/functions/_shared/quickadd.ts): the same words must mean the
 * same task in both places. The plugin's adds where in the line each reading
 * came from, and lets one be left as words; those are checked here too.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { parseQuickAdd as botParse } from "../supabase/functions/_shared/quickadd.ts";
      export { parseQuickAdd as pluginParse } from "../src/board/quick-add";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const { botParse, pluginParse } = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}
const bare = ({ spans, ...rest }) => rest;

// ── The same words, the same task ──────────────────────────────────────────
const days = ['today', 'tomorrow', 'friday', 'mon', 'next week', 'in 3 days', '2026-11-01', '1405/07/15', 'امروز', 'فردا', 'پس فردا', 'جمعه', 'شنبه', 'هفته بعد', '۳ روز دیگه'];
const times = ['', '9', 'at 9', '9:30', '9:30-10', '5pm', 'in 20 minutes', 'ساعت ۹', 'ساعت ۹ شب', 'ساعت ۵ عصر', 'ساعت ۹ تا ۱۰', '۲۰ دقیقه دیگه'];
const roles = ['', 'remind', 'due', 'یادآوری', 'مهلت', 'تا'];
const tails = ['', '#work', '!high', '#کار !فوری', '#a #b !low'];
const titles = ['Call Sara', 'buy 2 apples', 'خرید نان', 'send the report'];
const clocks = [
  { today: '2026-10-02', minutes: 15 * 60 },
  { today: '2026-10-03', minutes: 23 * 60 + 50 },
  { today: '2027-01-01', minutes: 0 },
];
let compared = 0;
let different = [];
for (const title of titles) {
  for (const role of roles) {
    for (const day of days) {
      for (const time of times) {
        for (const tail of tails) {
          const line = [title, role, day, time, tail].filter(Boolean).join(' ');
          for (const clock of clocks) {
            compared++;
            const a = JSON.stringify(botParse(line, clock));
            const b = JSON.stringify(bare(pluginParse(line, clock)));
            if (a !== b && different.length < 5) different.push({ line, clock, bot: a, plugin: b });
          }
        }
      }
    }
  }
}
eq(different, [], `the plugin reads like the bot, over ${compared} lines`);
eq(compared > 20000, true, 'a real corpus');

// ── Where each reading came from ───────────────────────────────────────────
const now = { today: '2026-10-02', minutes: 15 * 60 };
const line = 'Call Sara tomorrow 9 #work !high';
const read = pluginParse(line, now);
eq(read.title, 'Call Sara', 'the title');
eq(
  read.spans.map((span) => [span.kind, span.text, span.ranges.map(([a, b]) => line.slice(a, b))]),
  [
    ['tag', '#work', ['#work']],
    ['priority', '!high', ['!high']],
    ['plan', 'tomorrow 9', ['tomorrow 9']],
  ],
  'tags, priority and the plan, each with the words it was read from'
);

const remind = pluginParse('call mom remind tomorrow 18:00', now);
const reminder = remind.spans.find((span) => span.kind === 'remind');
eq(reminder.ranges.map(([a, b]) => 'call mom remind tomorrow 18:00'.slice(a, b)), ['tomorrow 18:00', 'remind'], 'a reminder owns its “remind” word too');

// ── Leaving a reading as words ─────────────────────────────────────────────
const plan = read.spans.find((span) => span.kind === 'plan');
const kept = pluginParse(line, now, new Set([plan.key]));
eq([kept.title, kept.plan], ['Call Sara tomorrow 9', undefined], 'a plan left as words goes back into the title and out of the task');
eq([kept.tags, kept.priority], [['work'], 'high'], 'the rest is read as before');
const keptRemind = pluginParse('call mom remind tomorrow 18:00', now, new Set([reminder.key]));
eq([keptRemind.title, keptRemind.remind], ['call mom remind tomorrow 18:00', undefined], 'and a reminder takes its “remind” back with it');
const keptTag = pluginParse(line, now, new Set(['tag:#work']));
eq(keptTag.tags, [], 'a tag left as words is not a tag');
eq(keptTag.title, 'Call Sara #work', 'but stays in the title');
const keptPriority = pluginParse('a !high !low', now, new Set(['priority:!low']));
eq([keptPriority.priority, keptPriority.title], ['high', 'a !low'], 'two priorities: the last one read wins, and leaving it makes the other count');

// ── Words are not lost ─────────────────────────────────────────────────────
eq(pluginParse('  tomorrow   9   ', now).title, '', 'a line of only a plan has no title');
eq(pluginParse('خرید نان فردا ساعت ۹ #خانه !بالا', now).title, 'خرید نان', 'Persian');

console.log(`QUICK_ADD_OK (${checked} checks)`);
