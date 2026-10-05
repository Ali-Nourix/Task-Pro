/**
 * MarkdownV2 for the bot's classic messages: the HTML the screens are written in becomes
 * MarkdownV2 that Telegram will accept. A message with one unescaped `.` is refused whole, so
 * besides exact cases this checks every output with a validator that follows Telegram's rules.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `export { htmlToMarkdownV2, escapeV2 } from "../supabase/functions/_shared/markdownv2.ts";`,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));

let checked = 0;
const eq = (actual, expected, label) => {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
};

import { validateV2 } from './md2-validator.mjs';

const v2 = mod.htmlToMarkdownV2;
const valid = (html, label) => {
  const out = v2(html);
  const problem = validateV2(out);
  eq(problem, null, `${label} (${JSON.stringify(out)})`);
  return out;
};

// ── what plain text needs ──────────────────────────────────────────────────
eq(mod.escapeV2('a.b-c!d_e*f(g)[h]~i`j>k#l+m=n|o{p}q\\r'), 'a\\.b\\-c\\!d\\_e\\*f\\(g\\)\\[h\\]\\~i\\`j\\>k\\#l\\+m\\=n\\|o\\{p\\}q\\\\r', 'every reserved character is escaped');
eq(v2('Hello, world'), 'Hello, world', 'plain words stay');
eq(v2('1.5 - 2 = ok!'), '1\\.5 \\- 2 \\= ok\\!', 'punctuation in plain text');
eq(v2('&lt;tag&gt; &amp; &quot;q&quot;'), '<tag\\> & "q"', 'HTML entities are decoded, then escaped as needed');
eq(v2('«سلام» ۱۲.'), '«سلام» ۱۲\\.', 'Persian text keeps its marks and escapes the full stop');

// ── styles ─────────────────────────────────────────────────────────────────
eq(v2('<b>Hi</b>'), '*Hi*', 'bold');
eq(v2('<i>Hi</i> <u>there</u> <s>old</s>'), '_Hi_ __there__ ~old~', 'italic, underline, strikethrough');
eq(v2('<strong>a</strong><em>b</em><ins>c</ins><del>d</del>'), '*a*_b_ __c__~d~'.replace(' ', '\r'), 'the other names of the same tags');
eq(v2('<b>a <i>b</i> c</b>'), '*a _b_ c*', 'a style inside another');
eq(v2('<u>x</u><i>y</i>'), '__x__\r_y_', 'underline then italic are kept apart with a carriage return');
eq(v2('<tg-spoiler>secret</tg-spoiler>'), '||secret||', 'a spoiler');
eq(v2('<span class="tg-spoiler">secret</span> and <span>plain</span>'), '||secret|| and plain', 'a span is a spoiler only when it says so');
eq(v2('<b></b>x<i> </i>'), 'x_ _', 'an empty style is dropped');
eq(v2('<b>x</b>'), '*x*', 'and a full one is not');
eq(v2('<b>bold <i>both</b> italic</i>'), '*bold _both_*_ italic_', 'styles that cross are closed and opened again');
eq(v2('<code>a.b `c` \\d</code>'), '`a.b \\`c\\` \\\\d`', 'inside code only the backtick and the backslash are escaped');
eq(v2('<pre>line 1\nline 2.</pre>'), '```\nline 1\nline 2.\n```', 'a pre block');
eq(v2('<b>x <code>1.5</code></b>'), '*x `1.5`*', 'code inside bold');
eq(v2('<a href="https://x.y/a_(b)?q=1&amp;r=2">t.x</a>'), '[t\\.x](https://x.y/a_(b\\)?q=1&r=2)', 'a link: the text escaped, the address only for its closing bracket');
eq(v2('<a>no address</a>'), 'no address', 'a link without an address is its text');
eq(v2('<unknown>kept</unknown>'), 'kept', 'an unknown tag is dropped and its text kept');

// ── quotes ─────────────────────────────────────────────────────────────────
eq(v2('<blockquote>one\ntwo</blockquote>\nafter'), '>one\n>two\nafter', 'a quote, a line to each');
eq(v2('<b>T</b>\n<blockquote>one\ntwo</blockquote>\n\n<b>U</b>'), '*T*\n>one\n>two\n\n*U*', 'a quote between headings keeps their spacing');
eq(v2('<blockquote expandable>one\ntwo\nthree</blockquote>'), '**>one\n>two\n>three||', 'an expandable quote starts with **> and ends with ||');
eq(v2('<blockquote><b>a\nb</b></blockquote>'), '>*a*\n>*b*', 'a style over two lines of a quote is closed and opened again, so the > is never inside it');
eq(v2('<blockquote>a</blockquote><blockquote>b</blockquote>'), '>a\n\n>b', 'two quotes in a row stay two');
eq(v2('text<blockquote>q</blockquote>'), 'text\n>q', 'a quote starts on its own line');
eq(v2('<blockquote>q</blockquote>tail'), '>q\ntail', 'and what follows it too');
eq(v2('<blockquote>1.5 - x</blockquote>'), '>1\\.5 \\- x', 'a quote’s text is escaped');

// ── every output must be one Telegram accepts ─────────────────────────────
const samples = [
  '<b>TaskPro</b> — <i>۳ باز</i>\n<blockquote>⚠️ ۱ عقب‌افتاده\n📅 ۲ برای امروز\n📋 ۸ تسک باز</blockquote>\n🟢 آخرین همگام‌سازی: همین الان\n\n<i>هر چیزی بنویسی، تسک می‌شود.</i>',
  '<b>1.</b> Buy bread (2 of 3) <code>#home</code> • 📅 Tomorrow 9:00 — ⏳ Fri 2 Oct',
  '<blockquote expandable>/start — منوی اصلی\n/done ۱۲ — انجام شد (عدد = «شناسه»)\n/lang fa|en · /tz Asia/Tehran</blockquote>',
  '<s>Done: call the bank.</s>\n<blockquote>a_b c*d [e] (f) ~g~ `h` > i # j + k - l = m | n { o } p . q !</blockquote>',
  '<u>Underlined</u> <b>bold <i>and italic</i></b> <tg-spoiler>hidden!</tg-spoiler> <a href="https://t.me/x">link</a>',
  '<pre>function a() {\n  return 1;\n}</pre>',
  'x'.repeat(50) + '\u2800'.repeat(60),
];
for (const [i, html] of samples.entries()) valid(html, `sample ${i + 1} is valid MarkdownV2`);

// The validator itself notices what Telegram would refuse.
eq(validateV2('a.b') !== null, true, 'the validator refuses an unescaped full stop');
eq(validateV2('*open') !== null, true, 'and an entity never closed');
eq(validateV2('a\\.b *c*'), null, 'and accepts what is right');

console.log(`TELEGRAM_MARKDOWN_OK (${checked} checks)`);
