// Telegram's MarkdownV2 rules, enough to tell a message it would refuse. Shared by the bot's tests.

/** Returns null, or what is wrong with the message. */
export function validateV2(text) {
  const RESERVED = '_*[]()~`>#+-=|{}.!';
  const stack = [];
  let line = 0;
  let atLineStart = true;
  let i = 0;
  const fail = (why) => `${why} at ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 12), i + 12))}`;
  while (i < text.length) {
    const ch = text[i];
    const inCode = stack.length && (stack[stack.length - 1] === '`' || stack[stack.length - 1] === '```');
    if (ch === '\\') {
      if (i + 1 >= text.length) return fail('dangling backslash');
      i += 2;
      atLineStart = false;
      continue;
    }
    if (inCode) {
      const mark = stack[stack.length - 1];
      if (text.startsWith(mark, i)) { stack.pop(); i += mark.length; } else i++;
      atLineStart = false;
      continue;
    }
    if (ch === '\n') { line++; atLineStart = true; i++; continue; }
    if (atLineStart && (ch === '>' || text.startsWith('**>', i))) {
      i += ch === '>' ? 1 : 3;
      atLineStart = false;
      continue;
    }
    atLineStart = false;
    if (text.startsWith('```', i)) { stack.push('```'); i += 3; continue; }
    if (ch === '`') { stack.push('`'); i++; continue; }
    if (text.startsWith('||', i)) {
      if (stack[stack.length - 1] === '||') stack.pop(); else if (/\n|$/.test(text.slice(i + 2, i + 3)) && stack.length === 0 && /^>|\n>/.test(text.slice(0, i))) { i += 2; continue; } else stack.push('||');
      i += 2; continue;
    }
    if (text.startsWith('__', i)) { if (stack[stack.length - 1] === '__') stack.pop(); else stack.push('__'); i += 2; continue; }
    if (ch === '_' || ch === '*' || ch === '~') {
      if (stack[stack.length - 1] === ch) stack.pop(); else stack.push(ch);
      i++; continue;
    }
    // ![words](tg://time?unix=…&format=…) is a date (and tg://emoji?id=… an emoji): the words stay as the fallback.
    if (ch === '!' && text[i + 1] === '[') { stack.push('!['); i += 2; continue; }
    if (ch === '[') { stack.push('['); i++; continue; }
    if (ch === ']') {
      const opener = stack[stack.length - 1];
      if (opener !== '[' && opener !== '![') return fail('stray ]');
      stack.pop();
      if (text[i + 1] !== '(') return fail('a link without an address');
      const close = text.slice(i + 2).search(/(?<!\\)\)/);
      if (close < 0) return fail('an address never closed');
      const address = text.slice(i + 2, i + 2 + close);
      if (opener === '![' && !/^tg:\/\/(time\?unix=\d{1,12}(&format=(r|w?[dD]?[tT]?))?|emoji\?id=\d+)$/.test(address)) return fail(`a date or emoji with a bad address ${address}`);
      i += close + 3; continue;
    }
    if (RESERVED.includes(ch)) return fail(`unescaped ${ch}`);
    i++;
  }
  return stack.length ? `unclosed ${stack.join(' ')}` : null;
}

