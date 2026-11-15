// JavaScript port of dizione (Apache-2.0, Muhammed Nazeem): text normalisation and the phonemizer engine.
'use strict';
(function (G) {
const D = G.Dz;
const { isUpper, isLower, isAlpha, isDigit, isAlnum, isSpace, isAscii, tupleKey, startsWithAny, endsWithAny, fromText, convert, isArpabet } = D;

// ---------- regex helpers (Python re.sub semantics with a match object) ----------
class M {
  constructor(m, string) { this.m = m; this.string = string; this.index = m.index; }
  group(k = 0) { const v = typeof k === 'string' ? (this.m.groups || {})[k] : this.m[k]; return v === undefined ? null : v; }
  groups() { return this.m.slice(1).map(v => v === undefined ? null : v); }
  start(k = 0) { if (k === 0) return this.m.index; return this.m.indices ? this.m.indices[k][0] : this.string.indexOf(this.m[k], this.m.index); }
  end(k = 0) { if (k === 0) return this.m.index + this.m[0].length; const s = this.start(k); return s + this.m[k].length; }
}
function sub(re, text, fn) {
  let flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  if (!flags.includes('d')) flags += 'd';
  const r = new RegExp(re.source, flags);
  let out = '', last = 0, m;
  while ((m = r.exec(text)) !== null) {
    if (m[0] === '') { r.lastIndex++; continue; }
    out += text.slice(last, m.index);
    out += typeof fn === 'string' ? fn.replace(/\\(\d)/g, (_, d) => m[+d] || '') : fn(new M(m, text));
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}
const reMatch = (re, s) => { const m = new RegExp('^(?:' + re.source + ')', re.flags.replace('g', '')).exec(s); return m ? new M(m, s) : null; };
const fullmatch = (re, s) => new RegExp('^(?:' + re.source + ')$', re.flags.replace('g', '')).test(s);
const findall = (re, s) => { const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); const out = []; let m; while ((m = r.exec(s)) !== null) { if (m[0] === '') { r.lastIndex++; continue; } out.push(m.length > 2 ? m.slice(1) : (m.length === 2 ? (m[1] === undefined ? '' : m[1]) : m[0])); } return out; };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
const setOf = s => new Set(s.split(/\s+/).filter(Boolean));
const divmod = (a, b) => [Math.floor(a / b), a % b];

class Word { constructor(text, o = {}) { this.text = text; this.attach = o.attach || false; this.raw = o.raw || ''; this.spell = o.spell || false; this.phones = o.phones || null; } with(o) { return new Word(o.text !== undefined ? o.text : this.text, Object.assign({ attach: this.attach, raw: this.raw, spell: this.spell, phones: this.phones }, o)); } }
class Punct { constructor(mark) { this.mark = mark; } }

const SPELL = '\uE000', END = '\uE001', INLINE = '\uE003', INLINE_BASE = 0xE100;
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const SCALES = ['thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion'];
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const MONTHS = 'January February March April May June July August September October November December'.split(' ');
const MONTH_NUMBER = {}; MONTHS.forEach((n, i) => { MONTH_NUMBER[n.toLowerCase().slice(0, 3)] = i + 1; });
const MONTH_PATTERN = MONTHS.join('|') + '|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DAY_PATTERN = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Thurs|Thur|Tues|Mon|Tue|Wed|Thu|Fri|Sat|Sun';
const CURRENCY = { '$': ['dollar', 'dollars', 'cent', 'cents'], '£': ['pound', 'pounds', 'penny', 'pence'], '€': ['euro', 'euros', 'cent', 'cents'], '¥': ['yen', 'yen', '', ''], '₹': ['rupee', 'rupees', 'paisa', 'paise'] };
Object.assign(CURRENCY, { USD: CURRENCY['$'], EUR: CURRENCY['€'], GBP: CURRENCY['£'], JPY: CURRENCY['¥'], INR: CURRENCY['₹'], CHF: ['Swiss franc', 'Swiss francs', 'centime', 'centimes'],
  CAD: ['Canadian dollar', 'Canadian dollars', 'cent', 'cents'], AUD: ['Australian dollar', 'Australian dollars', 'cent', 'cents'], CNY: ['yuan', 'yuan', '', ''] });
const CURRENCY_CODES = 'USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY';
const SCALE_LETTER = { k: 'thousand', m: 'million', b: 'billion', bn: 'billion', t: 'trillion' };
const FRACTION = { 2: ['half', 'halves'], 4: ['quarter', 'quarters'] };
const SYMBOL_WORDS = { '&': 'and', '@': 'at', '+': 'plus', '=': 'equals', '%': 'percent', '×': 'times', '÷': 'divided by', '±': 'plus or minus', '©': 'copyright', '§': 'section', '°': 'degrees',
  '≥': 'greater than or equal to', '≤': 'less than or equal to', '≠': 'not equal to', '≈': 'approximately', '∞': 'infinity', '√': 'square root of', 'π': 'pi' };
const COMPARISONS = { '>=': 'greater than or equal to', '<=': 'less than or equal to', '!=': 'not equal to' };
const INITIALISMS = setOf('US IT AI ID UN EU UK LA AD BC AM PM OS PE PA MA LED SAT RIP ER');
const SENTENCE_STARTERS = setOf('the he she it i we they this that there but and in on at a an if when what why how who my our you then so now after before however');
const YEAR_CONTEXT = setOf('in since by from until till before after during around circa of year early late mid summer winter spring fall autumn class');
const CARDINAL_AFTER = setOf('war chapter part book volume act scene section phase type class level stage title article appendix world');
const LABELLED = setOf('plan vitamin grade type option class section part team group exhibit appendix point model series hepatitis level');
const ROMAN = { II: 2, III: 3, IV: 4, VI: 6, VII: 7, VIII: 8, IX: 9, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVIII: 18, XX: 20 };
const LEADING_APOSTROPHE = new Set(["'em", "'tis", "'twas", "'til", "'cause", "'bout", "'round", "'n"]);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u{1F1E6}-\u{1F1FF}\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u200D\u20E3]+/gu;
const EMOTICON = /(?<![A-Za-z0-9])(?:[:;=]['^-]?[DPpOo3|\/\\*\]\[}{><]+|[)(\]\[][-^']?[:;=]|<3+|<\/3|\^_?\^|-_-|[oO]_[oO]|>_<|T_T|\\o\/|:'[()])(?![A-Za-z0-9])|[:;=]['^-]?[)(]+/g;
const PHONE_WORDS = setOf('call dial ring phone telephone tel mobile cell fax hotline text sms whatsapp');
const PHONE_LINKS = setOf('to on at or us me him her them back');
const PIN_WORDS = setOf('code pin extension ext passcode password zip postcode cvv cvc otp');
const STRONG_WORDS = setOf('number id reference ref serial account tracking booking confirmation');
const WEAK_WORDS = setOf('order ticket invoice case claim policy receipt transaction parcel shipment container payment reservation membership customer batch lot item job issue bug request');
const LINK_WORDS = setOf('is was are were ends ending in with starts starting begins beginning');
const NOT_COUNTED = setOf('is was has does goes ships arrives departs leaves shows needs blocks remains includes contains says reads starts ends closes opens runs takes comes this his its us as yes plus minus less');
const NUMBERED = setOf('ref reference serial account order invoice tracking part model phone tel fax id room flight case ticket policy licence license booking customer vat tax reg registration');
const DATE_BEFORE = setOf('on dated due until till by since from before after for shipped delivered arriving arrives arrive arrived expires expired ends ending starts starting begins beginning monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun');
const CLASSIC_FRACTIONS = new Set([2, 3, 4, 5, 6, 8, 10, 16, 32, 64, 100]);
const RATIO_WORDS = setOf('ratio ratios scale odds aspect mix split proportion');
const DURATION_WORDS = setOf('lasted took duration runtime recording video clip track lap pace length long');
const CLOCK_WORDS = setOf('window slot open opens opening hours shift session served service available booked appointment delivery arrive arrives arriving');
const CAPITAL_WORDS = setOf('IN ON AT TO OF BY OR IS AS IF NO SO WE HE MY ME DO GO UP AN AM PM BE IT US THE AND FOR BUT NOT ALL');
const SHORT_WORDS = setOf('my to in on of go up no do me we us it is at by be so or an as if he hi ok');
const ZONES = 'ET|CT|MT|PT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|GMT|UTC|BST|CET|CEST|IST|AEST|AEDT|JST';
const SIZES = 'XXXL|XXL|XXS|XL|XS|S|M|L';
const LENGTHS = 'mm|cm|km|m|ft|in|inch|inches|feet|foot|metres?|meters?|yards?|yd|px|pixels?';
const VERSIONED = 'version|ver|release|firmware|patch|kernel|build|python|node|nodejs|ios|ipados|macos|watchos|tvos|android|chrome|firefox|safari|java|php|ruby|rust|swift|kotlin|golang|django|rails|react|angular|vue|docker|kubernetes|ubuntu|debian|fedora|windows|linux|postgres|postgresql|mysql|redis|numpy|pytorch|tensorflow|cuda|xcode|gcc|clang|unity|minecraft|typescript|bluetooth|usb|hdmi|opengl|vulkan|directx|upgrade[ds]?|update[ds]?|downgrade[ds]?';
const SEPARATORS = { '.': 'dot', '/': 'slash', '@': 'at', '-': 'dash', '_': 'underscore', ':': 'colon', '=': 'equals', '&': 'and', '+': 'plus' };
const HALF_DAY = String.raw`(?:\s?([AaPp])\.[Mm]\.?|\s?([AaPp])[Mm]\b)`;
const AMOUNT = String.raw`(?<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<fraction>\d+))?`;
const MONEY = new RegExp(String.raw`(?:(?<![\w.])(?<minus>-)\s?)?(?<symbol>[$£€¥₹]|(?<![A-Za-z])(?:` + CURRENCY_CODES + String.raw`)(?![A-Za-z]))\s?(?<inner>-)?` + AMOUNT + String.raw`(?:\s?(?<scale>thousand|million|billion|trillion|bn|[kKmMbB])(?![A-Za-z]))?`, 'g');
const MONEY_AFTER = new RegExp(String.raw`(?<![\w.,])` + AMOUNT + String.raw`\s?(?<symbol>` + CURRENCY_CODES + String.raw`)(?![A-Za-z])`, 'g');
const VULGAR = /(?<![\d.,\/])(?:(\d+)\s?)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g;
const ADDRESS = new RegExp(String.raw`(?<url>(?:https?:\/\/|www\.)[^\s<>"']+)|(?<mail>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(?<file>(?<![\w@.\/-])(?<folder>\/?(?:[\w~-]+\/)+)?(?<stem>[\w-]+(?:\.[\w-]+)*)\.(?<ending>[A-Za-z][A-Za-z0-9]{0,9})(?![\w-])(?<path>\/[^\s<>"']*)?)`, 'g');
const DAY_RANGE = new RegExp(String.raw`\b(` + DAY_PATTERN + '|' + MONTH_PATTERN + String.raw`)\b(\.?)\s?[-–]\s?(` + DAY_PATTERN + '|' + MONTH_PATTERN + String.raw`)\b(\.?)`, 'g');
const RATIO = /(?<![\d:.,])(\d{1,3}):(\d{1,3}(?:,\d{3})+|\d+)(?![\d:]|[.,]\d)/g;
const CODE = /(?<![\w.,\/-])(#)?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)(?![\w-]|[.,]\d)/g;
const SLASHED = /(?<![\w.,\/-])(\d+(?:\/\d+){2,})(?![\w\/]|[.,]\d)/g;
// Python uses a conditional group for the trailing letters; handled in the callback.
const GROUPED = /(?<![\w.,:\/#+-])(?<plus>\+)?(?:(?<lead>[A-Z]{2}) )?(?<core>[A-Z0-9]*\d[A-Z0-9]*(?: [A-Z0-9]*\d[A-Z0-9]*)+)(?: (?<trail>[A-Z]{2})(?![\w]))?(?![\w]|[.,:\/-]\d|\s?[%°])/g;
const GROUPED_NOLEAD_TAIL = /(?![\w]|[.,:\/-]\d|\s?[%°])/;
const GLUED = /(?<![\w'.])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+(?![\w']|\.\d)/g;
const ACCENT_DECIDES = { 'résumé': 'R EH1 Z AH0 M EY2', 'resumé': 'R EH1 Z AH0 M EY2', 'exposé': 'EH2 K S P OW0 Z EY1', 'rosé': 'R OW0 Z EY1', 'pâté': 'P AA0 T EY1', 'maté': 'M AA1 T EY2', 'saké': 'S AA1 K EY2', 'lamé': 'L AA0 M EY1' };
const ACCENTED = new RegExp('(?<![\\p{L}\\p{N}_])(' + Object.keys(ACCENT_DECIDES).join('|') + ')(s?)(?![\\p{L}\\p{N}_])', 'giu');
const LETTER_FORMS = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'ł': 'l', 'Ł': 'L' };
function plainLetter(ch) {
  if (isAscii(ch) || !/\p{L}/u.test(ch)) return ch;
  if (ch in LETTER_FORMS) return LETTER_FORMS[ch];
  const b = ch.normalize('NFKD').replace(/\p{M}/gu, '');
  return isAscii(b) && isAlpha(b) ? b : ch;
}

// ---------- numbers ----------
function digits(text, zero = 'zero') { return [...text].filter(c => /\d/.test(c)).map(c => c === '0' ? zero : ONES[+c]).join(' '); }
function cardinalBig(n) { // n: BigInt
  if (n < 0n) return 'minus ' + cardinalBig(-n);
  if (n < 1000n) return cardinal(Number(n));
  if (n >= 1000n ** BigInt(SCALES.length + 1)) return digits(n.toString());
  const parts = [];
  for (let p = SCALES.length; p > 0; p--) { const unit = 1000n ** BigInt(p); const c = n / unit; n = n % unit; if (c) parts.push(cardinalBig(c) + ' ' + SCALES[p - 1]); }
  if (n) parts.push(cardinal(Number(n)));
  return parts.join(' ');
}
function cardinal(n) {
  if (typeof n === 'bigint') return cardinalBig(n);
  if (!Number.isSafeInteger(n)) return cardinalBig(BigInt(n));
  if (n < 0) return 'minus ' + cardinal(-n);
  if (n < 20) return ONES[n];
  if (n < 100) { const [t, o] = divmod(n, 10); return TENS[t - 2] + (o ? ' ' + ONES[o] : ''); }
  if (n < 1000) { const [h, r] = divmod(n, 100); return ONES[h] + ' hundred' + (r ? ' ' + cardinal(r) : ''); }
  return cardinalBig(BigInt(n));
}
const intOf = s => { const b = BigInt(s); return b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b; };
function ordinal(n) { const w = cardinal(n).split(' '); const last = w[w.length - 1]; w[w.length - 1] = ORDINAL[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th'); return w.join(' '); }
function year(n) {
  if (!(n >= 1000 && n <= 2999)) return cardinal(n);
  const [high, low] = divmod(n, 100);
  if (low === 0) return high % 10 === 0 ? cardinal(n) : cardinal(high) + ' hundred';
  if (high === 20 && low < 10) return 'two thousand ' + ONES[low];
  return cardinal(high) + (low < 10 ? ' oh ' + ONES[low] : ' ' + cardinal(low));
}
function pairs(n) {
  const [high, low] = divmod(n, 100);
  if (!(n >= 100 && n <= 9999) || (low === 0 && (high < 10 || high % 10 === 0))) return cardinal(n);
  if (low === 0) return cardinal(high) + ' hundred';
  return cardinal(high) + (low < 10 ? ' oh ' + ONES[low] : ' ' + cardinal(low));
}
function numberWords(text) {
  const t = text.replace(/,/g, ''); const k = t.indexOf('.');
  const whole = k < 0 ? t : t.slice(0, k), fraction = k < 0 ? '' : t.slice(k + 1);
  if (fraction) return (whole ? cardinal(intOf(whole)) : '') + ' point ' + digits(fraction);
  if ((whole.length > 1 && whole.startsWith('0')) || whole.length > 18) return digits(whole);
  return cardinal(intOf(whole));
}
function duration(h, m, s) {
  const parts = [[h, 'hour'], [m, 'minute'], [s, 'second']].filter(([c]) => c).map(([c, n]) => `${cardinal(c)} ${c === 1 ? n : n + 's'}`);
  if (parts.length < 2) return parts.length ? parts[0] : 'zero seconds';
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}
function pluralOf(words) { const k = words.lastIndexOf(' '); const head = k < 0 ? '' : words.slice(0, k); let last = k < 0 ? words : words.slice(k + 1); last = last.endsWith('y') ? last.slice(0, -1) + 'ies' : last + 's'; return (head ? head + ' ' : '') + last; }
function fractionWords(top, bottom, article = false) {
  const [one, many] = FRACTION[bottom] || [ordinal(bottom), ordinal(bottom) + 's'];
  if (top !== 1) return `${cardinal(top)} ${many}`;
  return (article ? ('aeiou'.includes(one[0]) ? 'an ' : 'a ') : 'one ') + one;
}
const versionPart = p => p.length > 2 ? digits(p) : numberWords(p);
const minor = p => p.startsWith('0') ? digits(p, 'oh') : cardinal(intOf(p));
const shortNumber = t => !t.startsWith('0') && (t.length <= 2 || new Set(t.slice(1)).size === 1 && t.slice(1)[0] === '0');
const spelled = l => `${SPELL}${l}${END}`;
function before(text, position, count = 4) {
  const seg = text.slice(Math.max(0, position - 80), position).split(/[.!?;…]\s|[()"]/);
  const clause = seg[seg.length - 1];
  return (clause.match(/[A-Za-z]+/g) || []).map(w => w.toLowerCase()).slice(-count);
}
function identifier(text, position) {
  const words = before(text, position);
  if (!words.length) return null;
  const lastw = words[words.length - 1];
  if (PHONE_WORDS.has(lastw) || (PHONE_LINKS.has(lastw) && words.slice(-3, -1).some(w => PHONE_WORDS.has(w)))) return 'phone';
  let index = words.length - 1;
  while (index > 0 && LINK_WORDS.has(words[index])) index--;
  for (const [kind, grp] of [['phone', PHONE_WORDS], ['pin', PIN_WORDS], ['strong', STRONG_WORDS], ['weak', WEAK_WORDS]]) if (grp.has(words[index])) return kind;
  return lastw === 'enter' ? 'enter' : null;
}
function addressDigits(t) {
  if (t.length <= 2 && !(t.length === 2 && t[0] === '0')) return cardinal(+t);
  if (t.length === 4 && +t >= 1900 && +t <= 2099) return year(+t);
  return digits(t);
}
const words4 = s => (s.match(/[A-Za-z]+/g) || []);

class Normalizer {
  constructor(isWord, tables) {
    this.isWord = isWord || (() => true);
    this.abbreviations = new Map(tables.rows('abbreviations.txt').map(([, c]) => [c[0], [c[1], c[2]]]));
    this.units = new Map(); this.exactUnits = new Map();
    for (const [, c] of tables.rows('units.txt')) {
      if (c.length > 3 && c[3] === 'exact') this.exactUnits.set(c[0], [c[1], c[2]]); else this.units.set(c[0].toLowerCase(), [c[1], c[2]]);
    }
    this.chat = new Map(tables.rows('chat.txt').map(([, c]) => [c[0], c.length > 1 ? c[1] : '-']));
    this.endings = tables.mapping('endings.txt');
    const names = [...new Set([...this.units.keys(), ...this.exactUnits.keys()].map(escapeRe))].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    this.unitNames = names.join('|');
    this.unitRe = new RegExp(String.raw`(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?:[-–](\d[\d,]*(?:\.\d+)?))?\s?(` + this.unitNames + String.raw`)(?![A-Za-z])(\.(?=\s+[a-z]))?`, 'gi');
    this.area = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(km|cm|mm|m|ft|mi|yd|in)([²³])/g;
    this.areaPlain = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(km|cm|mm|m|ft)([23])(?![\w])/g;
    this.inline = []; this.dayFirst = false; this.dated = false;
  }
  amount(symbol, whole, fraction, scale) {
    const [one, many, cent, cents] = CURRENCY[symbol];
    if (scale) { scale = SCALE_LETTER[scale.toLowerCase()] || scale.toLowerCase(); return `${numberWords(whole + (fraction ? '.' + fraction : ''))} ${scale} ${many}`; }
    if (fraction && (fraction.length > 2 || !cent)) return `${numberWords(whole + '.' + fraction)} ${many}`;
    const amount = intOf(whole), change = +(fraction || '0').padEnd(2, '0');
    const parts = [];
    if (amount || !change) parts.push(`${cardinal(amount)} ${amount === 1 ? one : many}`);
    if (change && cent) parts.push(`${cardinal(change)} ${change === 1 ? cent : cents}`);
    return parts.join(' and ');
  }
  money(m) {
    const words = this.amount(m.group('symbol'), m.group('whole').replace(/,/g, ''), m.group('fraction'), m.group('scale'));
    return (m.group('minus') || m.group('inner') ? ' minus ' : ' ') + words + ' ';
  }
  halfDay(m, dotted, plain) {
    if (!(dotted || plain)) return '';
    const following = m.string.slice(m.end()).replace(/^\s+/, '');
    const first = /^[A-Za-z']+/.exec(following);
    const closes = !!dotted && m.group(0).endsWith('.') && (!following || (isUpper(following[0]) && first !== null && SENTENCE_STARTERS.has(first[0].toLowerCase())));
    return `${SPELL}${(dotted || plain).toUpperCase()}M${END}${closes ? ' .' : ''} `;
  }
  time(m) {
    const hour = +m.group(1), minute = +m.group(2), second = m.group(3);
    const half = m.group(4) || m.group(5);
    const bef = before(m.string, m.start(), 3);
    if (second !== null && !half && !(bef.length && bef[bef.length - 1] === 'at')) return ` ${duration(hour, minute, +second)} `;
    if (hour > 24 && second === null && !half) {
      const after = /^\s*([A-Za-z]+)/.exec(m.string.slice(m.end()));
      if (bef.some(w => DURATION_WORDS.has(w)) || (after && DURATION_WORDS.has(after[1].toLowerCase()))) return ` ${duration(0, hour, minute)} `;
      return ` ${cardinal(hour)} ${minute < 10 ? 'oh ' : ''}${cardinal(minute)} `;
    }
    if (hour > 24) return m.group(0);
    let words = cardinal(hour);
    if (minute === 0) { if (half) {} else if (hour === 0) words = 'midnight'; else if (hour > 12) words += ' hundred'; else words += " o'clock"; }
    else words += (minute < 10 ? ' oh ' : ' ') + cardinal(minute);
    if (second) words += ' and ' + cardinal(+second) + (+second === 1 ? ' second' : ' seconds');
    return ` ${words} ` + this.halfDay(m, m.group(4), m.group(5));
  }
  dotTimes(m) {
    const following = m.string.slice(m.end());
    if (+m.group(1) > 23 || +m.group(4) > 23 || !before(m.string, m.start()).some(w => CLOCK_WORDS.has(w))
        || new RegExp(String.raw`^\s?(?:%|percent|million|billion|` + this.unitNames + String.raw`)(?![A-Za-z])`, 'i').test(following)) return m.group(0);
    return `${m.group(1)}:${m.group(2)}${m.group(3)}${m.group(4)}:${m.group(5)}`;
  }
  ratio(m) {
    const first = m.group(1), second = m.group(2);
    if (first.length <= 2 && second.length === 2 && '012345'.includes(second[0])) {
      const after = /^\s*([A-Za-z]+)/.exec(m.string.slice(m.end()));
      if (!(before(m.string, m.start(), 3).some(w => RATIO_WORDS.has(w)) || (after && RATIO_WORDS.has(after[1].toLowerCase())))) return m.group(0);
    }
    return ` ${numberWords(first)} to ${numberWords(second)} `;
  }
  date(month, day, yearText = null, the = false) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    let words = the ? `the ${ordinal(day)} of ${MONTHS[month - 1]}` : `${MONTHS[month - 1]} ${ordinal(day)}`;
    if (yearText) words += ' ' + (yearText.length === 4 ? year(+yearText) : (+yearText < 10 ? 'oh ' : '') + cardinal(+yearText));
    return ` ${words} `;
  }
  slashDate(m) {
    let first = +m.group(1), second = +m.group(2);
    if ((first > 12 && 12 >= second) || (this.dayFirst && second <= 12)) [first, second] = [second, first];
    return this.date(first, second, m.group(3)) || m.group(0);
  }
  dotDate(m) {
    let day = +m.group(1), month = +m.group(2);
    if (month > 12 && 12 >= day) [day, month] = [month, day];
    return this.date(month, day, m.group(3)) || m.group(0);
  }
  dayMonth(m) {
    const month = m.group(2);
    const spoken = this.date(MONTH_NUMBER[month.toLowerCase().slice(0, 3)], +m.group(1), m.group(4), true);
    if (spoken === null) return m.group(0);
    return spoken + (m.group(3) && MONTHS.includes(month) ? '. ' : '');
  }
  daysOfMonth(m) {
    const monthFirst = /^\p{L}/u.test(m.group(1));
    let [month, first, second] = monthFirst ? [m.group(1), m.group(2), m.group(3)] : [m.group(3), m.group(1), m.group(2)];
    first = +first; second = +second;
    if (!(first >= 1 && first <= 31 && second >= 1 && second <= 31)) return m.group(0);
    const name = MONTHS[MONTH_NUMBER[month.toLowerCase().slice(0, 3)] - 1];
    const words = monthFirst ? `${name} ${ordinal(first)} to ${ordinal(second)}` : `the ${ordinal(first)} to the ${ordinal(second)} of ${name}`;
    return ` ${words}${m.group(4) ? ' ' + year(+m.group(4)) : ''} `;
  }
  dayRange(m) {
    const names = [m.group(1), m.group(3)].map(name => { const key = name.toLowerCase(); return this.abbreviations.has(key) ? this.abbreviations.get(key)[1] : (DAY_NAMES[key] || name); });
    const following = m.string.slice(m.end()).replace(/^\s+/, '');
    const first = /^[A-Za-z']+/.exec(following);
    const ends = !!m.group(4) && (!following || (isUpper(following[0]) && first !== null && SENTENCE_STARTERS.has(first[0].toLowerCase())));
    return `${names[0]} to ${names[1]}${ends ? ' .' : ''}`;
  }
  shortDate(m) {
    const ft = m.group(1), st = m.group(2);
    if (ft.length > 2 || st.length > 2) return null;
    let first = +ft, second = +st;
    const bef = before(m.string, m.start());
    if (first >= 1 && first <= 12 && second >= 20 && second <= 49 && bef.includes('card')) return ` ${MONTHS[first - 1]} ${year(2000 + second)} `;
    const last = bef.length ? bef[bef.length - 1] : '';
    const classic = first < second && CLASSIC_FRACTIONS.has(second);
    const zero = (ft.length === 2 && ft[0] === '0') || (st.length === 2 && st[0] === '0');
    if (!(zero || (first > 12 && first <= 31 && second <= 12 && !(first === 24 && second === 7)) || (DATE_BEFORE.has(last) && (!classic || last === 'on'))
        || (this.dated && !classic && first !== second))) return null;
    if (first > 12 || (this.dayFirst && second <= 12)) [first, second] = [second, first];
    return this.date(first, second);
  }
  fraction(m) {
    const spoken = this.shortDate(m);
    if (spoken) return spoken;
    const top = intOf(m.group(1)), bottom = intOf(m.group(2));
    if ((top === 24 && bottom === 7) || top === bottom) return ` ${cardinal(top)} ${cardinal(bottom)} `;
    if (!(top > 0 && top < 100) || !(bottom > 1 && bottom <= 100)) return ` ${cardinal(top)} over ${cardinal(bottom)} `;
    return ` ${fractionWords(top, bottom)} `;
  }
  mixedFraction(m) {
    const top = +m.group(2), bottom = +m.group(3);
    if (!(top > 0 && top < bottom)) return m.group(0);
    return ` ${numberWords(m.group(1))} and ${fractionWords(top, bottom, true)} `;
  }
  vulgar(m) {
    const [top, bottom] = m.group(2).normalize('NFKC').split('⁄').map(Number);
    if (m.group(1) === null) return ` ${top}/${bottom} `;
    return ` ${cardinal(intOf(m.group(1)))} and ${fractionWords(top, bottom, true)} `;
  }
  phone(m) { return ' ' + m.groups().filter(g => g).map(g => g === '800' ? 'eight hundred' : digits(g, 'oh')).join(', ') + ' '; }
  measure(m) {
    const unit = m.group(3);
    let tail = '';
    if (m.group(4) !== null) { // Python's (?-i:[a-z]): the stop is only taken before a small letter
      const nxt = /^\.\s+(.)/.exec(m.string.slice(m.end(3)));
      if (!(nxt && /[a-z]/.test(nxt[1]))) tail = '.';
    }
    const names = this.exactUnits.get(unit) || this.units.get(unit.toLowerCase());
    const e3 = m.end(3);
    if (!names || (unit.length === 1 && ['-', "'", '/'].includes(m.string.slice(e3, e3 + 1)))) return m.group(0);
    const [one, many] = names, value = m.group(1), upper = m.group(2);
    if (upper) return ` ${numberWords(value)} to ${numberWords(upper)} ${many} ` + tail;
    return ` ${numberWords(value)} ${value === '1' || value === '1.0' ? one : many} ` + tail;
  }
  square(m) {
    const unit = m.group(2);
    const [one, many] = (unit === 'in' ? ['inch', 'inches'] : null) || this.exactUnits.get(unit) || this.units.get(unit);
    const kind = '²2'.includes(m.group(3)) ? 'square' : 'cubic';
    return ` ${numberWords(m.group(1))} ${kind} ${m.group(1) === '1' || m.group(1) === '1.0' ? one : many} `;
  }
  counted(text, end) {
    const after = /^\s*([A-Za-z]+)/.exec(text.slice(end));
    if (!after) return false;
    const word = after[1].toLowerCase();
    if (['people', 'men', 'women', 'children', 'feet', 'miles'].includes(word)) return true;
    return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !NOT_COUNTED.has(word) && this.isWord(word.slice(0, -1));
  }
  number(m, text) {
    const value = m.group(0), plain = value.replace(/,/g, '');
    if (!plain.includes('.') && !value.includes(',') && !plain.startsWith('0') && plain.length > 2) {
      const kind = identifier(text, m.start());
      const limit = { phone: 3, pin: 3, strong: 4, enter: 4, weak: 5 }[kind] || 7;
      if (plain.length >= limit && !(kind === null && plain.endsWith('000')) && !(kind === 'enter' && plain.length === 4 && +plain >= 1900 && +plain <= 2099)
          && !([null, 'phone', 'weak'].includes(kind) && this.counted(text, m.end()))) return ` ${digits(plain, kind === 'phone' ? 'oh' : 'zero')} `;
    }
    if (!plain.includes('.') && !value.includes(',') && plain.length === 4 && !plain.startsWith('0')) {
      const number = +plain;
      const bef = words4(text.slice(0, m.start()).slice(-24));
      const after = /^\s*([A-Za-z]+)/.exec(text.slice(m.end()));
      const counted = !!after && /(?:[^s]s|people|men|women|children|feet|miles)$/.test(after[1].toLowerCase());
      const dated = bef.length > 0 && (YEAR_CONTEXT.has(bef[bef.length - 1].toLowerCase()) || bef[bef.length - 1].toLowerCase().slice(0, 3) in MONTH_NUMBER);
      const model = /(?<![A-Za-z])([A-Z]{2,5}) $/.exec(text.slice(0, m.start()));
      if (model && !CAPITAL_WORDS.has(model[1]) && !counted) return ` ${pairs(number)} `;
      if ((number >= 1100 && number <= 1999) || (number >= 2000 && number <= 2099 && (dated || !counted))) return ` ${year(number)} `;
    }
    return ` ${numberWords(value)} `;
  }
  readsAsWord(letters) {
    const lower = letters.toLowerCase();
    if (lower.length < 3 || !this.isWord(lower)) return false;
    return lower.length > 3 || ['s', 'es', 'ed', 'ing'].some(e => this.isWord(lower + e));
  }
  alnum(group, zero = 'zero') { return findall(/[A-Za-z]+|\d+/, group).map(r => isDigit(r) ? digits(r, zero) : spelled(r)).join(' '); }
  digitGroups(groups, zero = 'zero') {
    if (groups.every(g => shortNumber(g) && g.length <= 2)) return groups.map(g => cardinal(+g)).join(' , ');
    return groups.map(g => digits(g, zero)).join(' , ');
  }
  codeWords(groups, m) {
    const token = groups.join('-');
    if (!/\d/.test(token)) return null;
    const kinds = groups.map(g => isDigit(g) ? 'd' : /\d/.test(g) ? 'm' : isUpper(g) ? 'u' : 'l');
    if (kinds.every(k => k === 'd')) {
      if (groups.length === 2) {
        const years = groups.every(g => g.length === 4 && +g >= 1000 && +g <= 2100);
        if (!(m.group(1) || groups.some(g => g.length > 1 && g[0] === '0') || (Math.min(...groups.map(g => g.length)) >= 4 && !years)
            || ['strong', 'pin'].includes(identifier(m.string, m.start())))) return null;
      }
      return this.digitGroups(groups);
    }
    if (groups.length === 2 && kinds[1] === 'd' && 'ul'.includes(kinds[0])) {
      const [letters, number] = groups;
      if ((kinds[0] === 'l' && letters.length > 1) || this.readsAsWord(letters)) return null;
      if (shortNumber(number)) return `${spelled(letters)} ${cardinal(intOf(number))}`;
      return `${spelled(letters)} , ${digits(number)}`;
    }
    if (groups.length === 2 && kinds[0] === 'd' && (kinds[1] === 'l' || groups[1].length === 1 || fullmatch(/\d+[A-Za-z]+/, groups[1]))) return null;
    if (kinds.some((k, i) => (k === 'l' && groups[i].length > 2) || (k === 'm' && fullmatch(/\d+(?:s|st|nd|rd|th)/, groups[i])))) return null;
    if (!/\p{Lu}/u.test(token) && (kinds.includes('l') || kinds.includes('m'))) return null;
    const parts = [];
    kinds.forEach((k, i) => {
      const g = groups[i];
      if (k === 'd') parts.push(digits(g));
      else if (k === 'm') parts.push(this.alnum(g));
      else if (g.length > 3 && this.isWord(g.toLowerCase())) parts.push(g);
      else parts.push(g.length <= 5 ? spelled(g) : g);
    });
    return parts.join(' , ');
  }
  code(m) { const w = this.codeWords(m.group(2).split('-'), m); if (w === null) return m.group(0); return (m.group(1) ? ' number ' : ' ') + w + ' '; }
  grouped(m) {
    // Python's conditional group: trailing letters only belong to the number when it has leading ones.
    if (m.group('trail') && !m.group('lead')) {
      const trailText = ' ' + m.group('trail');
      const shortStr = m.group(0).slice(0, m.group(0).length - trailText.length);
      return this.groupedCore(m, m.string, shortStr, null) + trailText;
    }
    return this.groupedCore(m, m.string, m.group(0), m.group('trail'));
  }
  groupedCore(m, text, whole, trailIn) {
    const plus = m.group('plus'); let lead = m.group('lead'), trail = trailIn;
    const core = m.group('core').split(' ');
    const mEnd = m.index + whole.length;
    let head = '', tail = '';
    if (lead && CAPITAL_WORDS.has(lead)) { head = lead + ' '; tail = trail ? ' ' + trail : ''; lead = null; trail = null; }
    const kind = identifier(text, m.start());
    const pure = core.every(isDigit);
    if (pure && !plus && !lead) {
      const following = text.slice(mEnd);
      const amount = this.counted(text, mEnd) || new RegExp(String.raw`^\s?(?:` + this.unitNames + String.raw`)(?![A-Za-z])`, 'i').test(following);
      if (kind === null && core[0][0] !== '0' && core[0].length <= 3 && core.slice(1).every(p => p.length === 3) && (core[core.length - 1] === '000' || (amount && core.length > 2))) return head + core.join(',') + tail;
      if (!(kind || (core[0].length > 1 && core[0][0] === '0') || (core.length > 2 && core.some(p => p.length > 2)))) return whole;
    } else if (!pure && !lead && !plus && kind === null) return whole;
    const zero = plus || kind === 'phone' || (pure && core[0][0] === '0' && core.reduce((a, p) => a + p.length, 0) >= 10) ? 'oh' : 'zero';
    let spoken = pure ? this.digitGroups(core, zero) : core.map(p => isDigit(p) ? digits(p, zero) : this.alnum(p, zero)).join(' , ');
    if (lead) spoken = `${spelled(lead)} , ${spoken}`;
    if (trail) spoken = `${spoken} , ${spelled(trail)}`;
    return head + (plus ? ' plus ' : ' ') + spoken + ' ' + tail;
  }
  glued(m) {
    const out = [];
    for (const run of findall(/[A-Za-z]+|\d+/, m.group(0))) {
      if (isDigit(run)) out.push(shortNumber(run) ? cardinal(intOf(run)) : digits(run));
      else if (run.length === 1 || ((isUpper(run) || run.length <= 3) && !this.readsAsWord(run))) out.push(spelled(run));
      else out.push(run);
    }
    return ' ' + out.join(' ') + ' ';
  }
  addressPart(part) {
    const lower = part.toLowerCase();
    if (part.length > 1 && this.isWord(lower) && (part.length > 2 || SHORT_WORDS.has(lower))) return part;
    return part.length <= 3 ? spelled(part) : part;
  }
  spokenAddress(core) {
    const pieces = findall(/[A-Za-z]+|\d+|./s, core);
    const mail = core.includes('@'); let host = false;
    const out = [];
    pieces.forEach((piece, index) => {
      const following = index + 1 < pieces.length ? pieces[index + 1] : '';
      if (piece === '@') host = true;
      if (isDigit(piece)) out.push(addressDigits(piece));
      else if (!isAlpha(piece)) out.push(SEPARATORS[piece] || '');
      else if (index && pieces[index - 1] === '.' && (host || !mail) && (['', '/', ':', '?', '#'].includes(following)
          || (piece.length <= 3 && (this.endings.has(piece.toLowerCase()) || !this.isWord(piece.toLowerCase()))))) {
        out.push(this.endings.get(piece.toLowerCase()) === 'word' ? piece.toLowerCase() : spelled(piece));
      } else {
        let letters = '';
        for (const part of findall(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/, piece)) {
          const sp = this.addressPart(part);
          if (sp.startsWith(SPELL)) { letters += part; continue; }
          if (letters) { out.push(spelled(letters)); letters = ''; }
          out.push(sp);
        }
        if (letters) out.push(spelled(letters));
      }
    });
    return out.filter(Boolean).join(' ');
  }
  address(m) {
    const whole = m.group(0);
    let text = whole.replace(/[.,;:!?)]+$/, '');
    const tail = whole.slice(text.length);
    if (m.group('file')) {
      const ending = m.group('ending');
      const known = this.endings.has(ending.toLowerCase());
      const marked = !!(m.group('folder') || m.group('path')) || m.group('stem').includes('_');
      if (!(known || (marked && ending.length <= 5 && (isLower(ending) || isUpper(ending)) && !this.isWord(ending.toLowerCase())))) return whole;
    }
    const core = text.replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/+$/, '');
    return ` ${this.spokenAddress(core)} ${tail}`;
  }
  chatForm(m) {
    const said = this.chat.get(m.group(0).toLowerCase());
    if (said === undefined) return m.group(0);
    if (said === '-') return ' ';
    return ' ' + said.split(/\s+/).map(p => p.startsWith('*') ? `${SPELL}${p.slice(1)}${END}` : p).join(' ') + ' ';
  }
  inlineP(m) {
    const symbols = m.group(2).split(/\s+/).filter(Boolean);
    if (!symbols.length) throw new Error('empty pronunciation {} in the text');
    const phones = isArpabet(symbols) ? convert('', symbols) : fromText(symbols.join(' '));
    this.inline.push([m.group(1) || '', phones]);
    return ` ${INLINE}${String.fromCharCode(INLINE_BASE + this.inline.length - 1)}${INLINE} `;
  }
  dotted(m, text) {
    const letters = m.group(0).replace(/\./g, ''), key = letters.toLowerCase();
    const following = text.slice(m.end()).replace(/^\s+/, '');
    const words = key === 'eg' ? 'for example' : key === 'ie' ? 'that is' : `${SPELL}${letters.toUpperCase()}${END}`;
    const first = /^[A-Za-z']+/.exec(following);
    const ends = !following || (isUpper(following[0]) && first && SENTENCE_STARTERS.has(first[0].toLowerCase()));
    return ` ${words}${ends && m.group(0).endsWith('.') ? ' .' : ''} `;
  }
  abbreviation(m, text) {
    const token = m.group(1), stop = m.group(2), key = token.toLowerCase();
    const following = text.slice(m.end());
    const nextWord = /^\s*([A-Za-z]+|\d)/.exec(following);
    const capitalNext = !!nextWord && isUpper(nextWord[1][0]);
    const capitalBefore = /[A-Z][a-z]+\s+$/.test(text.slice(0, m.start()));
    if ((key === 'st' || key === 'dr') && isUpper(token[0])) {
      if (capitalNext && (stop || key === 'dr')) return key === 'st' ? ' saint ' : ' doctor ';
      if (capitalBefore && stop) return (key === 'st' ? ' street' : ' drive') + (!following.trim() ? ' .' : ' ');
      return m.group(0);
    }
    if (!this.abbreviations.has(key)) return m.group(0);
    let [when, words] = this.abbreviations.get(key);
    const numberNext = !!nextWord && isDigit(nextWord[1]);
    if (when === 'title') { if (!(isUpper(token[0]) && (capitalNext || stop))) return m.group(0); }
    else if (when === 'number') {
      const previous = /([A-Za-z]+)\.?\s+$/.exec(text.slice(0, m.start()));
      if (!(stop && (numberNext || (key === 'no' && previous && NUMBERED.has(previous[1].toLowerCase()))))) return m.group(0);
    } else if (!stop || (when === 'small' && isUpper(token))) return m.group(0);
    else if (['mar', 'sun', 'sat', 'jan', 'dec', 'max', 'min', 'est', 'no'].includes(key) && !isUpper(token[0]) && !numberNext) {
      if (!(['max', 'min', 'est'].includes(key) && nextWord && isLower(nextWord[1][0]))) return m.group(0);
    }
    if (key === 'est' && !numberNext) words = 'estimated';
    const ends = when !== 'title' && (!following.trim() || (capitalNext && SENTENCE_STARTERS.has(nextWord[1].toLowerCase())));
    return ` ${words}${ends ? ' .' : ''} `;
  }
  rewrite(text) {
    text = sub(VULGAR, text, m => this.vulgar(m));
    text = sub(this.area, text, m => this.square(m));
    text = text.replace(/²/g, ' squared ').replace(/³/g, ' cubed ');
    text = text.normalize('NFKC').replace(/⁄/g, '/').replace(/−/g, ' minus ');
    if (!isAscii(text)) {
      text = sub(ACCENTED, text, m => '{' + ACCENT_DECIDES[m.group(1).toLowerCase()] + (m.group(2) ? ' Z' : '') + '}');
      text = [...text].map(plainLetter).join('');
    }
    text = text.replace(/(?<=\d)–(?=\d)/g, '-');
    text = sub(DAY_RANGE, text, m => this.dayRange(m));
    for (const [o, n] of [['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], ['`', "'"], ['´', "'"], ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'], ['«', '"'], ['»', '"'], ['–', '—'], ['―', '—'], ['[', '('], [']', ')']]) text = text.split(o).join(n);
    this.inline = [];
    text = sub(/([A-Za-z']+)?\{([^{}]*)\}/g, text, m => this.inlineP(m));
    text = text.replace(/\{/g, '(').replace(/\}/g, ')');
    text = sub(ADDRESS, text, m => this.address(m));
    text = text.replace(/→/g, ' to ');
    text = text.replace(EMOJI, ' ');
    text = text.replace(EMOTICON, ' ');
    text = text.replace(/\.{3,}/g, '…');
    text = text.replace(/(?<=\d)\s-\s(?=\d[\d.,]*\s?=)/g, ' minus ');
    text = text.replace(/-{2,}|\s-\s/g, '—');
    text = text.replace(/\bw\/o\b/gi, ' without ');
    text = text.replace(/\bw\/(?=\s|$)/gi, ' with ');
    text = text.replace(/\bn\/a\b/gi, ' not applicable ');
    text = text.split("'n'").join(" 'n ");
    if (/\d/.test(text)) text = this.figures(text);
    return this.signs(text);
  }
  figures(text) {
    text = sub(MONEY, text, m => this.money(m));
    text = sub(MONEY_AFTER, text, m => this.money(m));
    text = sub(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?¢/g, text, m => ` ${numberWords(m.group(1))} ${m.group(1) === '1' ? 'cent' : 'cents'} `);
    const clock = String.raw`\d{1,2}:[0-5]\d(?:\s?[AaPp]\.?[Mm]\.?)?|\b\d{1,2}\s?[AaPp]\.?[Mm]\.?`;
    text = sub(new RegExp('(' + clock + String.raw`)\s(` + ZONES + String.raw`)\b`, 'g'), text, m => `${m.group(1)} ${spelled(m.group(2))}`);
    text = text.replace(/(?<![\d.,:])(\d{1,2})\.([0-5]\d)(?=\s?[AaPp]\.?[Mm]\b)/g, '$1:$2');
    text = sub(/(?<![\d.,:])(\d{1,2})\.(00|15|30|45)(\s?(?:to|until|till|and|[-—])\s?)(\d{1,2})\.(00|15|30|45)(?!\d|\.\d)/g, text, m => this.dotTimes(m));
    text = text.replace(new RegExp('(' + clock + String.raw`)\s?[-—]\s?(?=\d{1,2}(?::[0-5]\d|\s?[AaPp]\.?[Mm]\b))`, 'g'), '$1 to ');
    text = sub(RATIO, text, m => this.ratio(m));
    text = sub(new RegExp(String.raw`(?<![\d:])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?` + HALF_DAY + String.raw`?(?![\d:])`, 'g'), text, m => this.time(m));
    text = sub(new RegExp(String.raw`(?<![\d.:,])(\d{1,2})` + HALF_DAY + String.raw`(?![A-Za-z])`, 'g'), text, m => ` ${cardinal(+m.group(1))} ` + this.halfDay(m, m.group(2), m.group(3)));
    let seen = findall(/(?<![\d\/.])(\d{1,2})\/(\d{1,2})(?:\/(?:\d{4}|\d{2}))?(?![\d\/])/, text).map(([a, b]) => [+a, +b]).filter(([a, b]) => !(a === 24 && b === 7));
    this.dayFirst = seen.some(([a, b]) => a > 12 && 12 >= b) && !seen.some(([a, b]) => b > 12 && 12 >= a);
    this.dated = /(?<![\d\/])\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})(?![\d\/])/.test(text);
    text = sub(/(?<![\d-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d-])/g, text, m => this.date(+m.group(2), +m.group(3), m.group(1)) || m.group(0));
    text = sub(/(?<![\d\/])(\d{4})\/(\d{1,2})\/(\d{1,2})(?![\d\/])/g, text, m => this.date(+m.group(2), +m.group(3), m.group(1)) || m.group(0));
    text = sub(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d|\.\d)/g, text, m => this.dotDate(m));
    text = sub(/(?<![\d\/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d\/])/g, text, m => this.slashDate(m));
    text = sub(new RegExp(String.raw`\b(` + MONTH_PATTERN + String.raw`)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s?[-—]\s?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d:])`, 'g'), text, m => this.daysOfMonth(m));
    text = sub(new RegExp(String.raw`(?<![\d.,\/:-])(\d{1,2})(?:st|nd|rd|th)?\s?[-—]\s?(\d{1,2})(?:st|nd|rd|th)?\s+(` + MONTH_PATTERN + String.raw`)\b(?:,?\s+(\d{4}))?`, 'g'), text, m => this.daysOfMonth(m));
    text = sub(new RegExp(String.raw`\b(` + MONTH_PATTERN + String.raw`)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d:])`, 'g'), text,
      m => this.date(MONTH_NUMBER[m.group(1).toLowerCase().slice(0, 3)], +m.group(2), m.group(3)) || m.group(0));
    text = sub(new RegExp(String.raw`(?<![\d.,\/:-])(\d{1,2})(?:st|nd|rd|th)?\s+(` + MONTH_PATTERN + String.raw`)\b(\.(?=\s+[a-z\d]))?(?:,?\s+(\d{4}))?`, 'g'), text, m => this.dayMonth(m));
    text = sub(/(?<![\d-])(?:\+?(1)[-.\s])?\(?(\d{3})\)?[-.\s](\d{3})[-.\s](\d{4})(?![\d-])/g, text, m => this.phone(m));
    text = sub(/(?<![\w.,-])(\d{3})-(\d{4})(?![\w-])/g, text, m => this.phone(m));
    text = sub(/(?<![\w.])([vV])?(\d+(?:\.\d+){2,})(?:-(\d+)(?![\w-]|\.\d))?(?![\w])/g, text,
      m => ' ' + (m.group(1) ? spelled(m.group(1)) + ' ' : '') + m.group(2).split('.').map(versionPart).join(' point ') + (m.group(3) ? ' dash ' + numberWords(m.group(3)) : '') + ' ');
    text = sub(/(?<![\w.])([vV])(\d+)\.(\d{2,3})(?!\d|\.\d|\w)/g, text, m => ` ${spelled(m.group(1))} ${cardinal(intOf(m.group(2)))} point ${minor(m.group(3))} `);
    text = sub(new RegExp(String.raw`\b(` + VERSIONED + String.raw`)(\.?\s(?:(?:from|to)\s)?)(\d+)\.(\d{2,3})(?:(\s(?:to|or|and)\s)(\d+)\.(\d{2,3}))?(?!\d|\.\d|\s?%|\s(?:percent|million|billion)\b)`, 'gi'), text,
      m => `${m.group(1)}${m.group(2)}${cardinal(intOf(m.group(3)))} point ${minor(m.group(4))}` + (m.group(5) ? `${m.group(5)}${cardinal(intOf(m.group(6)))} point ${minor(m.group(7))}` : '') + ' ');
    text = sub(CODE, text, m => this.code(m));
    text = sub(SLASHED, text, m => ' ' + this.digitGroups(m.group(1).split('/')) + ' ');
    text = sub(GROUPED, text, m => this.grouped(m));
    text = text.replace(/(?<![\w.])-(?=\d)/g, ' minus ');
    text = text.replace(new RegExp(String.raw`(?:(?<=\d)\s?[xX×]|×)\s?(?=\d[\d.,]*\s?(?:` + LENGTHS + String.raw`)\b)`, 'g'), ' by ');
    text = text.replace(/(?<=\d)\s[xX×]\s(?=\d)/g, ' times ');
    text = sub(/(?<![\w\/'])[A-Za-z0-9\/]*[0-9\/][A-Za-z0-9\/]*(?![\w\/'])/g, text, m => this.chatForm(m));
    text = sub(/(?<![\w.])'?(\d{2}|\d{4})'?s\b/g, text, m => ' ' + pluralOf(m.group(1).length === 4 ? year(+m.group(1)) : cardinal(+m.group(1))) + ' ');
    text = sub(/(?<![\w.])(\d+)(?:st|nd|rd|th)\b/g, text, m => ` ${ordinal(intOf(m.group(1)))} `);
    text = sub(/(?<![\w.])(144|240|360|480|540|576|720|900|1080|1440|2160|4320)([pi])\b/g, text, m => ` ${pairs(+m.group(1))} ${spelled(m.group(2))} `);
    text = sub(/(\d[\d,]*(?:\.\d+)?)\s?%/g, text, m => ` ${numberWords(m.group(1))} percent `);
    text = sub(this.areaPlain, text, m => this.square(m));
    text = sub(this.unitRe, text, m => this.measure(m));
    text = sub(/(?<![\d\/.,-])(\d+) (\d)\/(2|3|4|5|6|8|10|16)(?![\d\/]|\.\d)/g, text, m => this.mixedFraction(m));
    text = sub(/(?<![\d\/.])(\d+)\/(\d+)(?![\d\/]|\.\d)/g, text, m => this.fraction(m));
    text = sub(/(?<![\w.,-])(\d{4})[-–](\d{4})(?![\w.,-])/g, text, m => ` ${year(+m.group(1))} to ${year(+m.group(2))} `);
    text = sub(/(?<![\w.,-])(\d+)[-–](\d+)(?![\w-]|[.,]\d)/g, text, m => ` ${numberWords(m.group(1))} to ${numberWords(m.group(2))} `);
    text = sub(/(?<![\w.])(\d+)x\b/g, text, m => ` ${numberWords(m.group(1))} times `);
    text = text.replace(/(?<=\d)\^(?=\d)/g, ' to the power of ');
    return text;
  }
  signs(text) {
    text = sub(new RegExp(String.raw`(?<![\w-])(` + SIZES + ')-(' + SIZES + String.raw`)(?![\w-])`, 'g'), text, m => ` ${spelled(m.group(1))} to ${spelled(m.group(2))} `);
    text = text.replace(/#(?=\d)/g, ' number ');
    text = text.replace(/#(?=[A-Z]{1,4}-?\d)/g, ' number ');
    text = text.replace(/#(?=[A-Za-z])/g, ' hashtag ');
    text = text.replace(/~(?=\s?\d)/g, ' about ');
    text = sub(/(?<=[\w\s])(>=|<=|!=)(?=[\w\s])/g, text, m => ` ${COMPARISONS[m.group(1)]} `);
    text = text.replace(/(?<=\d) Ti\b/g, ` ${spelled('TI')}`);
    text = text.replace(/\b([Rr])ef\.\s?[Nn]o\.(?=\s)/g, '$1eference number');
    if (text.includes('.')) { const t0 = text; text = sub(/\b((?:[A-Za-z]\.){2,})/g, text, m => this.dotted(m, t0)); }
    { const t0 = text; text = sub(/\b([A-Za-z]{1,6})\b(\.?)(?![A-Za-z'’])/g, text, m => this.abbreviation(m, t0)); }
    if (/\d/.test(text)) {
      text = sub(GLUED, text, m => this.glued(m));
      const t0 = text;
      text = sub(/(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|(?<![\w.])\.\d+/g, text, m => this.number(m, t0));
    }
    text = text.replace(/(?<=[A-Za-z])\/(?=[A-Za-z])/g, ' ');
    text = sub(/(?<=\d)\s?[<>]\s?(?=\d)|(?<=\s)[<>](?=\s)/g, text, m => m.group(0).includes('<') ? ' less than ' : ' greater than ');
    text = sub(new RegExp('[' + escapeRe(Object.keys(SYMBOL_WORDS).join('')) + ']', 'g'), text, m => ` ${SYMBOL_WORDS[m.group(0)]} `);
    return text;
  }
  unstretched(word) {
    if (!/(.)\1\1/.test(word)) return [];
    const cut = (inside, fin) => word.replace(/(.)\1{2,}/g, (m0, c, off) => c.repeat((off + m0.length === word.length ? fin : inside) ? 2 : 1));
    const liked = /([lfsz])\1\1+$/.test(word) || word.replace(/(.)\1{2,}$/, '$1') === 'to';
    return [...new Set([cut(true, liked), cut(true, !liked), cut(false, liked), cut(false, !liked)])];
  }
  wordTokens(raw, allCaps, previous, following = true, fresh = false) {
    const lower = raw.toLowerCase();
    const chat = this.chat.get(lower);
    if (chat !== undefined && (raw.length > 1 || isLower(raw))) {
      if (chat === '-') return [];
      return chat.split(/\s+/).map(p => p.startsWith('*') ? new Word(p.slice(1).toLowerCase(), { raw, spell: true }) : new Word(p.toLowerCase(), { raw: p }));
    }
    if (raw in ROMAN && previous && isUpper(previous[0])) {
      const n = ROMAN[raw];
      const words = CARDINAL_AFTER.has(previous.toLowerCase()) ? cardinal(n) : 'the ' + ordinal(n);
      return words.split(' ').map(w => new Word(w, { raw }));
    }
    const letters = raw.replace(/'/g, '');
    const possessive = lower.endsWith("'s");
    const stem = possessive ? raw.slice(0, -2) : raw;
    if (stem.length === 1 && isAlpha(stem)) {
      const label = stem === 'A' && previous && (!following || (!fresh && LABELLED.has(previous.toLowerCase())));
      if (['a', 'A', 'I', 'i'].includes(stem) && !possessive && !label) return [new Word(stem.toLowerCase(), { raw })];
      return [new Word(lower, { raw, spell: true })];
    }
    if (isUpper(stem) && isAlpha(stem) && stem.length >= 2 && stem.length <= 5 && (!allCaps || !this.isWord(stem.toLowerCase()))) {
      if (INITIALISMS.has(stem) || !this.isWord(stem.toLowerCase())) return [new Word(lower, { raw, spell: true })];
    }
    if (!isAlpha(letters)) return [];
    const capitals = fullmatch(/[a-z]+(?:[A-Z][a-z]+)*[A-Z]{2,}(?:'s)?/, raw);
    if (capitals || !this.isWord(lower)) {
      for (const cand of capitals ? [] : this.unstretched(lower)) if (this.isWord(cand)) return [new Word(cand, { raw })];
      const parts = findall(/[A-Z]?[a-z']+|[A-Z]+(?![a-z])/, raw);
      if (parts.length > 1 && parts.join('') === raw) {
        const out = [];
        for (const part of parts) {
          const named = capitals && isUpper(part) ? INITIALISMS.has(part) : false;
          const sp = part.length === 1 || named || (isUpper(part) && !this.isWord(part.toLowerCase()));
          if (capitals && out.length && out[out.length - 1].spell && (sp || part === "'s")) {
            const l = out[out.length - 1]; out[out.length - 1] = l.with({ text: l.text + part.toLowerCase(), raw: l.raw + part });
          } else out.push(new Word(part.toLowerCase(), { attach: out.length > 0, raw: part, spell: sp }));
        }
        return out;
      }
    }
    return [new Word(lower, { raw })];
  }
  tokens(text) {
    text = this.rewrite(text);
    const runs = text.match(/[A-Za-z]{2,}/g) || [];
    const allCaps = runs.length >= 3 && runs.filter(isUpper).length >= 0.6 * runs.length;
    const out = [];
    const pattern = new RegExp(SPELL + '([A-Za-z ]+)' + END + '|' + INLINE + '(.)' + INLINE + String.raw`|('?[A-Za-z]+(?:'[A-Za-z]+)*)|(\d+)|(-)|(\S)`, 'gsu');
    let attach = false, previous = '', fresh = true, m;
    while ((m = pattern.exec(text)) !== null) {
      let [, sp, inline, word, number, hyphen, other] = m;
      const end = m.index + m[0].length;
      const bef = m.index ? text[m.index - 1] : ' ';
      if (hyphen !== undefined) {
        attach = out.length > 0 && out[out.length - 1] instanceof Word && !isSpace(bef) && end < text.length && isAlnum(text[end]);
        continue;
      }
      let nw = [];
      if (sp !== undefined) nw = [new Word(sp.replace(/ /g, '').toLowerCase(), { raw: sp, spell: true })];
      else if (inline !== undefined) { const [written, phones] = this.inline[inline.charCodeAt(0) - INLINE_BASE]; nw = [new Word(written.toLowerCase(), { raw: written, phones })]; }
      else if (word !== undefined) {
        if (word.startsWith("'") && !LEADING_APOSTROPHE.has(word.toLowerCase())) { out.push(new Punct("'")); word = word.slice(1); }
        else if (word.startsWith("'") && !this.isWord(word.toLowerCase())) word = word.slice(1);
        nw = this.wordTokens(word, allCaps, previous, /^\s*[A-Za-z]/.test(text.slice(end)), fresh);
        previous = word;
      } else if (number !== undefined) nw = numberWords(number).split(' ').map(p => new Word(p, { raw: number }));
      else if (D.PUNCTUATION.includes(other)) {
        if (!(other === "'" && isAlnum(bef) && end < text.length && isAlnum(text[end]))) out.push(new Punct(other));
        if ('.!?;…'.includes(other)) fresh = true;
        attach = false; continue;
      }
      if (nw.length && attach) nw[0] = nw[0].with({ attach: true });
      out.push(...nw);
      attach = false;
      fresh = fresh && !nw.length;
    }
    return out;
  }
}

// ---------- engine ----------
class Phonemizer {
  constructor(data) {
    // data: { lexicon (text), align, g2pSettings, g2pBuffer, homographs, tables }
    this.lexicon = new Map();
    for (const line of data.lexicon.split('\n')) { if (!line) continue; const k = line.indexOf('\t'); this.lexicon.set(line.slice(0, k), line.slice(k + 1)); }
    this.T = D.makeTables(data.tables);
    this.aligner = new D.Aligner(data.align);
    this.model = data.g2pBuffer ? new D.G2P(data.g2pSettings, data.g2pBuffer) : null;
    this.homographs = data.homographs ? new D.Homographs(data.homographs, data.tables['homograph_rules.txt']) : null;
    this.functions = this.T.functionWords();
    this.phrases = this.T.phrases();
    this.phraseLength = Math.max(1, ...[...this.phrases.values()].map(v => v[3]));
    this.exceptions = this.T.pronunciations('exceptions.txt');
    this.names = this.T.names('exceptions.txt');
    this.nameStarts = new Set([...this.names.values()].map(v => v.words[0]));
    this.nameLength = Math.max(1, ...[...this.names.values()].map(v => v.words.length));
    this.userNames = new Set(); this.overrides = new Map();
    this.normalizer = new Normalizer(w => this.isWord(w), this.T);
    this.cache = new Map(); this.letterNames = null;
  }
  entry(word, [kind, value]) { return kind === 'phones' ? value.map(x => x.slice()) : convert(word, value, this.aligner.align(word, value)); }
  known(word) {
    if (this.overrides.has(word)) return this.entry(word, this.overrides.get(word));
    if (this.exceptions.has(word)) return this.entry(word, this.exceptions.get(word));
    const t = this.lexicon.get(word);
    return t !== undefined ? fromText(t) : null;
  }
  ordinary(word) {
    if (word.length < 3 || !['s', 'es', 'ed', 'ing'].some(e => this.lexicon.has(word + e))) return null;
    return this.known(word);
  }
  guess(word) {
    if (!this.model) return this.spell(word);
    const spelling = this.model.spellable(word);
    const symbols = this.model.predict(spelling);
    symbols.forEach((s, k) => {
      if (s === 'R' && ![k - 1, k + 1].some(j => j >= 0 && j < symbols.length && '012'.includes(symbols[j][symbols[j].length - 1]))) symbols[k] = 'ER0';
    });
    if (!symbols.some(s => '012'.includes(s[s.length - 1]))) return this.spell(word);
    return D.sentence.promote(convert(spelling, symbols, this.aligner.align(spelling, symbols)));
  }
  spell(letters) {
    if (!this.letterNames) { this.letterNames = new Map(); for (const [k, v] of this.T.mapping('letters.txt')) this.letterNames.set(k, fromText(v)); }
    const possessive = letters.toLowerCase().endsWith("'s");
    const names = [...(possessive ? letters.slice(0, -2) : letters).toLowerCase()].filter(c => this.letterNames.has(c)).map(c => this.letterNames.get(c));
    const out = [];
    names.forEach((name, i) => { for (const [p, s] of name) out.push([p, s && i < names.length - 1 ? 2 : s]); });
    return possessive && out.length ? D.morph.plural(out) : out;
  }
  isWord(w) { return this.lexicon.has(w) || this.functions.has(w) || this.exceptions.has(w) || this.overrides.has(w); }
  word(word) {
    if (this.cache.has(word)) return this.cache.get(word);
    let phones = this.known(word), source = 'dictionary';
    if (phones === null) {
      phones = D.morph.derive(word, w => this.known(w), w => this.ordinary(w)); source = 'ending';
      if (phones !== null) phones = D.settleStress(phones);
    }
    if (phones === null && word.endsWith("'s") && word.length > 3) { phones = D.morph.plural(this.guess(word.slice(0, -2))); source = 'model'; }
    if (phones === null) { phones = this.guess(word); source = 'model'; }
    const r = [phones, source]; this.cache.set(word, r); return r;
  }
  units(words, places, written) {
    const { Unit } = D.sentence;
    const units = []; let index = 0;
    const cp = p => p.map(x => x.slice());
    while (index < words.length) {
      const tok = words[index];
      if (tok.phones !== null) units.push(new Unit(tok.text, cp(tok.phones), 'p', null, tok.attach, 'inline'));
      else if (tok.spell) units.push(new Unit(tok.text, this.spell(tok.text), 'p', null, tok.attach, 'letters'));
      else {
        let size = this.nameStarts.has(tok.text) ? this.nameSize(words, index) : 0;
        if (size) {
          const key = words.slice(index, index + size).map(w => w.text);
          const entry = this.names.get(tupleKey(key));
          key.forEach((text, pos) => units.push(new Unit(text, this.entry(text, entry.prons[pos]), 'p', null, tok.attach && pos === 0, 'name')));
          index += size; continue;
        }
        size = this.phraseSize(words, index);
        if (size) {
          const key = words.slice(index, index + size).map(w => w.text);
          const [kind, forms, final] = this.phrases.get(tupleKey(key));
          if (forms.length === 1) units.push(new Unit(key.join(' '), cp(forms[0]), kind, final, tok.attach, 'phrase'));
          else key.forEach((text, pos) => units.push(new Unit(text, cp(forms[pos]), kind, null, tok.attach && pos === 0, 'phrase')));
          index += size; continue;
        }
        if (this.overrides.has(tok.text)) units.push(new Unit(tok.text, this.known(tok.text), 'c', null, tok.attach, 'override'));
        else if (this.homographs && written && this.homographs.covers(tok.text) && !this.exceptions.has(tok.text)) {
          const [ph, ending] = this.homographs.pronounce(tok.text, written, places[index]);
          const phones = ending ? D.morph.plural(fromText(ph)) : fromText(ph);
          units.push(new Unit(tok.text, phones, 'c', null, tok.attach, 'homograph'));
        } else if (this.functions.has(tok.text)) {
          const [kind, form, final] = this.functions.get(tok.text);
          units.push(new Unit(tok.text, cp(form), kind, final, tok.attach, 'function'));
        } else {
          const [phones, source] = this.word(tok.text);
          units.push(new Unit(tok.text, cp(phones), 'c', null, tok.attach, source));
        }
      }
      index++;
    }
    return units;
  }
  nameSize(words, index) {
    for (let size = Math.min(this.nameLength, words.length - index); size > 1; size--) {
      const span = words.slice(index, index + size), key = tupleKey(span.map(w => w.text));
      if (this.names.has(key) && span.every(w => w.phones === null && !w.spell) && !span.slice(1).some(w => w.attach)
          && (this.userNames.has(key) || !span.some(w => this.overrides.has(w.text)))) return size;
    }
    return 0;
  }
  phraseSize(words, index) {
    for (let size = Math.min(this.phraseLength, words.length - index); size > 1; size--) {
      const span = words.slice(index, index + size);
      if (span.slice(1).every(w => w.phones === null && !w.spell && !w.attach) && span[0].phones === null && !span[0].spell
          && this.phrases.has(tupleKey(span.map(w => w.text))) && !span.some(w => this.overrides.has(w.text))) return size;
    }
    return 0;
  }
  analyse(text) {
    const stream = this.normalizer.tokens(text);
    const written = stream.map(t => t instanceof Punct ? t.mark : (t.raw || t.text || 'x'));
    const out = [], words = [], places = [];
    const flush = () => {
      if (words.length) {
        const units = this.units(words, places, written);
        D.sentence.stressClause(units); D.sentence.joinClause(units);
        out.push(['clause', units]); words.length = 0; places.length = 0;
      }
    };
    stream.forEach((t, place) => { if (t instanceof Punct) { flush(); out.push(['punct', t.mark]); } else { words.push(t); places.push(place); } });
    flush();
    return out;
  }
  pieces(text) { return this.analyse(text).map(([k, v]) => k === 'punct' ? [true, v] : [false, D.sentence.groups(v)]); }
  phonemize(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('text must not be empty');
    return D.tokenize(this.pieces(text));
  }
}
D.Phonemizer = Phonemizer; D.Normalizer = Normalizer; D.WordTok = Word; D.Punct = Punct;
D._n = { cardinal, ordinal, year, numberWords, digits, sub };
})(typeof self !== 'undefined' ? self : globalThis);
