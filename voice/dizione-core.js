// JavaScript port of dizione (Apache-2.0, Muhammed Nazeem, https://github.com/n4ze3m/dizione):
// English text -> phoneme ids for the tiny-voca speech model. Core: symbols, tables,
// conversion, alignment, unknown-word model, endings, sentence rules, homographs.
'use strict';
(function (G) {
const D = G.Dz = G.Dz || {};

// ---------------- small Python-like helpers ----------------
const isUpper = s => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s);
const isLower = s => /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s);
const isAlpha = s => s.length > 0 && /^\p{L}+$/u.test(s);
const isDigit = s => s.length > 0 && /^\p{Nd}+$/u.test(s);
const isAlnum = s => s.length > 0 && /^[\p{L}\p{Nd}]+$/u.test(s);
const isSpace = s => s.length > 0 && /^\s+$/.test(s);
const isAscii = s => /^[\x00-\x7f]*$/.test(s);
const tupleKey = arr => arr.join('\u0001');
const rstrip = (s, chars) => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
const strip = (s, chars) => { let b = 0, e = s.length; while (b < e && chars.includes(s[b])) b++; while (e > b && chars.includes(s[e - 1])) e--; return s.slice(b, e); };
const startsWithAny = (s, arr) => arr.some(p => s.startsWith(p));
const endsWithAny = (s, arr) => arr.some(p => s.endsWith(p));
Object.assign(D, { isUpper, isLower, isAlpha, isDigit, isAlnum, isSpace, isAscii, tupleKey, rstrip, strip, startsWithAny, endsWithAny });

// ---------------- symbols ----------------
const PAD = '<pad>', BOS = '<bos>', EOS = '<eos>', SP = '<sp>', UNK = '<unk>';
const PUNCTUATION = [',', '.', '?', '!', ';', ':', '"', "'", '(', ')', '—', '…'];
const CONS = ['p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ', 'l', 'ɹ', 'j', 'w', 'tʃ', 'dʒ', 'ɾ', 'ʔ'];
const VOWELS = ['ə', 'ɐ', 'ɚ', 'ᵻ', 'ɪ', 'i', 'iː', 'ɛ', 'æ', 'ʌ', 'ɑː', 'ɔ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'ɔɪ', 'oʊ', 'aʊ', 'iə', 'oː',
  'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɪɹ', 'ɛɹ', 'ʊɹ', 'aɪɚ', 'aɪə', 'əl', 'n̩'];
const PHONES = CONS.concat(VOWELS);
const SYMBOLS = [PAD, BOS, EOS, SP, UNK].concat(PUNCTUATION, PHONES);
const SYMBOL_TO_ID = new Map(SYMBOLS.map((s, i) => [s, i]));
const PHONE_SET = new Set(PHONES), VOWEL_SET = new Set(VOWELS);
Object.assign(D, { SP, BOS, EOS, UNK, PUNCTUATION, PHONE_SET, VOWEL_SET, SYMBOLS, SYMBOL_TO_ID });

function tokenize(pieces) {
  const symbols = [BOS], stress = [0], unknown = [];
  for (const [punct, value] of pieces) {
    if (punct) { if (symbols[symbols.length - 1] !== value) { symbols.push(value); stress.push(0); } continue; }
    for (const word of value) {
      const last = symbols[symbols.length - 1];
      if (PHONE_SET.has(last) || last === UNK) { symbols.push(SP); stress.push(0); }
      for (const [phone, level] of word) {
        if (PHONE_SET.has(phone)) { symbols.push(phone); stress.push(level); }
        else { unknown.push(phone); symbols.push(UNK); stress.push(0); }
      }
    }
  }
  symbols.push(EOS); stress.push(0);
  if (!symbols.some(s => PHONE_SET.has(s) || s === UNK)) throw new Error('the text has nothing to pronounce');
  return { symbols, ids: symbols.map(s => SYMBOL_TO_ID.get(s)), stress, unknown };
}
D.tokenize = tokenize;

// ---------------- align ----------------
const MAX_RUN = 4, UNSEEN = -14.0;
const base = s => rstrip(s, '012');
class Aligner {
  constructor(table) { this.table = table; }
  score(phone, run) {
    const known = this.table[phone];
    const v = known ? known[run] : undefined;
    return v !== undefined ? v : UNSEEN - 2.0 * Math.abs(run.length - 1);
  }
  align(word, phones) {
    phones = phones.map(base);
    const letters = word.length, count = phones.length;
    if (!count || letters > MAX_RUN * count) return null;
    const low = -1e18;
    const best = [], step = [];
    for (let j = 0; j <= count; j++) { best.push(new Array(letters + 1).fill(low)); step.push(new Array(letters + 1).fill(0)); }
    best[0][0] = 0.0;
    for (let j = 1; j <= count; j++) {
      const phone = phones[j - 1], prev = best[j - 1], row = best[j], trace = step[j];
      for (let i = 0; i <= letters; i++) {
        for (let k = 0; k <= Math.min(MAX_RUN, i); k++) {
          if (prev[i - k] > low) {
            const v = prev[i - k] + this.score(phone, word.slice(i - k, i));
            if (v > row[i]) { row[i] = v; trace[i] = k; }
          }
        }
      }
    }
    if (best[count][letters] <= low) return null;
    const runs = []; let i = letters;
    for (let j = count; j > 0; j--) { const k = step[j][i]; runs.push(word.slice(i - k, i)); i -= k; }
    return runs.reverse();
  }
}
D.Aligner = Aligner; D.base = base;

// ---------------- convert ----------------
const ARPA_VOWELS = new Set('AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.split(' '));
const CONSONANTS = { B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ' };
const FULL_VOWELS = { AA: 'ɑː', AE: 'æ', AH: 'ʌ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɜː', EY: 'eɪ', IH: 'ɪ', IY: 'iː', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː' };
const ARPABET = new Set(Object.keys(CONSONANTS));
for (const v of ARPA_VOWELS) for (const d of '012') ARPABET.add(v + d);
const SIBILANTS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const VOWEL_LETTERS = 'aeiouy';
const FORCE_SPELLINGS = ['forc', 'ford', 'sword', 'worn', 'torn', 'sworn', 'borne', 'shorn', 'pork', 'divorc'];
const C_PREFIXES = ['dis', 'mis', 'un', 'in', 're', 'non', 'over', 'pre'];
const WEAK_PREFIXES = ['be', 'de', 're', 'pre'];
const IRE_ENDINGS = ['ing', 'ings', 'ingly', 'able', 'y', 'er', 'ers', 'est'];

const isArpabet = symbols => symbols.length > 0 && symbols.every(s => ARPABET.has(s));
const vowelLetters = run => [...run].filter(c => VOWEL_LETTERS.includes(c)).join('');
function fromText(text) {
  const phones = [];
  for (const unit of text.split(/\s+/).filter(Boolean)) {
    const stress = unit[0] === 'ˈ' ? 1 : unit[0] === 'ˌ' ? 2 : 0;
    const phone = stress ? unit.slice(1) : unit;
    if (!PHONE_SET.has(phone)) throw new Error(`${phone} is not a phone of the inventory`);
    if (stress && !VOWEL_SET.has(phone)) throw new Error(`stress mark on the consonant ${phone}`);
    phones.push([phone, stress]);
  }
  return phones;
}
Object.assign(D, { isArpabet, fromText });

class Word {
  constructor(word, arpabet, runs) {
    this.word = word;
    this.bases = arpabet.map(base);
    this.stress = arpabet.map(s => '012'.includes(s[s.length - 1]) ? +s[s.length - 1] : null);
    arpabet.forEach((symbol, k) => { const n = this.bases[k]; if (!(n in CONSONANTS) && !ARPA_VOWELS.has(n)) throw new Error(`${symbol} is not an ARPABET symbol`); });
    this.aligned = runs != null;
    this.runs = runs != null ? runs.slice() : arpabet.map(() => '');
    this.starts = []; let pos = 0;
    for (const run of this.runs) { this.starts.push(pos); pos += run.length; }
    this.count = this.bases.length;
  }
  base(i) { return i >= 0 && i < this.count ? this.bases[i] : null; }
  vowel(i) { return i >= 0 && i < this.count && ARPA_VOWELS.has(this.bases[i]); }
  unstressed(i) { return this.vowel(i) && !this.stress[i]; }
  letters(i) { return vowelLetters(this.runs[i]); }
  before(i) { return this.aligned ? this.word.slice(0, this.starts[i]) : ''; }
  after(i) { return this.aligned ? this.word.slice(this.starts[i] + this.runs[i].length) : ''; }
  endsWith(i, ...symbols) { const rest = this.bases.slice(i + 1); return rest.length === symbols.length && rest.every((b, k) => b === symbols[k]); }
  firstVowel(i) { return !this.bases.slice(0, i).some(b => ARPA_VOWELS.has(b)); }
  nextVowelStress(i) { for (let j = i + 1; j < this.count; j++) if (ARPA_VOWELS.has(this.bases[j])) return this.stress[j]; return null; }
  weakPrefix(i) {
    return this.aligned && this.firstVowel(i) && this.letters(i) === 'e' && startsWithAny(this.word, WEAK_PREFIXES) && ['b', 'd', 'r', 'pr'].includes(this.before(i));
  }
}

function northOrForce(w, i, beforeVowel) {
  if (!w.aligned) return 'ɔː';
  const spelled = w.letters(i);
  if (['oa', 'oo', 'ou'].includes(spelled)) return 'oː';
  if (spelled !== 'o') return 'ɔː';
  const run = w.runs[i];
  const tail = run.slice(run.indexOf('o') + 1) + w.after(i);
  const rest = tail.slice(1);
  if (!beforeVowel) {
    if (rest.startsWith('e')) return 'oː';
    if (w.before(i).endsWith('p') && rest.startsWith('t')) return 'oː';
    return FORCE_SPELLINGS.some(s => w.word.includes(s)) ? 'oː' : 'ɔː';
  }
  if (rest.startsWith('r')) return 'ɔː';
  if (['y', 'ies', 'ied', 'a', 'as', 'ah', 'er', 'ers'].includes(rest) || startsWithAny(rest, ['ia', 'io', 'iu', 'ing', 'age'])) return 'oː';
  return 'ɔː';
}
function weakI(w, i) {
  const nxt = w.base(i + 1), nxt2 = w.base(i + 2);
  if (nxt === 'F' && nxt2 === 'AH' && w.base(i + 3) === 'L') return 'i';
  if ((nxt === 'T' && nxt2 === 'IY') || (nxt === 'B' && (nxt2 === 'AH' || nxt2 === 'L')) || (nxt === 'F' && nxt2 === 'AY')) return 'ᵻ';
  if (nxt === 'T' && w.endsWith(i, 'T') && ['R', 'ER'].includes(w.base(i - 1)) && w.word.endsWith('ite')) return 'ᵻ';
  return 'ɪ';
}
function weakE(w, i) {
  const nxt = w.base(i + 1), prev = w.base(i - 1);
  if (nxt === 'T' && (w.endsWith(i, 'T') || w.endsWith(i, 'T', 'S'))) return prev === 'L' ? 'ə' : prev === 'R' ? 'ᵻ' : 'ɪ';
  if (nxt === 'S' && (w.endsWith(i, 'S', 'T') || w.endsWith(i, 'S', 'T', 'L', 'IY'))) return 'ɪ';
  if (nxt === 'JH') return 'ɪ';
  if (nxt === 'K' && w.base(i + 2) === 'T') return 'ɛ';
  if (nxt === 'D' && w.endsWith(i, 'D')) return 'ɪ';
  return 'ə';
}
function inflection(w, i) {
  if (i + 1 >= w.count || (w.aligned && !(w.runs[i] + w.runs[i + 1]).includes('e'))) return false;
  const nxt = w.base(i + 1), prev = w.base(i - 1);
  if (nxt === 'D' && (prev === 'T' || prev === 'D') && (w.endsWith(i, 'D') || w.endsWith(i, 'D', 'L', 'IY'))) return true;
  return nxt === 'Z' && SIBILANTS.has(prev) && w.endsWith(i, 'Z');
}
function firstSyllable(w, i) {
  if (!w.aligned || !w.firstVowel(i) || !w.nextVowelStress(i)) return null;
  const word = w.word;
  if (i === 0 && word.startsWith('e')) {
    if (word.startsWith('ex')) return 'ɛ';
    const c1 = word.slice(1, 2), c2 = word.slice(2, 3);
    if (['n', 'm', 's'].includes(c1) && c2 && !VOWEL_LETTERS.includes(word[2]) && word[2] !== word[1]) return 'ɛ';
    return 'ɪ';
  }
  if (w.weakPrefix(i)) {
    if (word.startsWith('pre') || (word.startsWith('be') && ['c', 'g'].includes(word.slice(2, 3)))) return 'ɪ';
    return 'ᵻ';
  }
  if (w.letters(i) === 'i' && word.startsWith('di') && word.length > 3 && !VOWEL_LETTERS.includes(word[2]) && word[2] !== 's' && VOWEL_LETTERS.includes(word[3])) return 'ᵻ';
  return null;
}
function reduced(w, i) {
  const name = w.bases[i], spelled = w.letters(i), nxt = w.base(i + 1), prev = w.base(i - 1);
  if (name === 'IH' && nxt === 'NG') return 'ɪ';
  if (inflection(w, i)) return 'ᵻ';
  if (name === 'AH') {
    if (prev === 'Y' && (w.runs[i - 1] + w.runs[i]).includes('u')) return 'ʊ';
    if (i === 0 && w.word.startsWith('a')) return 'ɐ';
    if (i === 0 && nxt === 'N' && w.word.startsWith('un')) return 'ʌ';
    if (spelled === 'a' && C_PREFIXES.includes(w.before(i)) && w.runs[i].startsWith('a')) return 'ɐ';
  }
  const prefix = firstSyllable(w, i);
  if (prefix) return prefix;
  if (spelled === 'e' && (nxt === 'K' || nxt === 'G') && w.runs[i + 1].startsWith('x') && w.nextVowelStress(i)) return 'ɛ';
  if (['i', 'ai', 'ui', 'y'].includes(spelled)) return weakI(w, i);
  if (spelled === 'e') return weakE(w, i);
  if (spelled === 'a') {
    if (nxt === 'JH' || (nxt === 'N' && w.base(i + 2) === 'JH')) return 'ɪ';
    if (nxt === 'S' && w.endsWith(i, 'S') && w.word.endsWith('ace')) return 'ɪ';
    if (name === 'IH' && !(nxt === 'T' && w.endsWith(i, 'T'))) return 'ɪ';
    return 'ə';
  }
  if (name === 'AH' && nxt === 'M' && w.endsWith(i, 'M') && w.word.endsWith('ome')) return 'ʌ';
  return name === 'IH' && !['o', 'u', 'ou'].includes(spelled) ? 'ɪ' : 'ə';
}
function unstressedIy(w, i) {
  const nxt = w.base(i + 1);
  if (nxt === null || w.endsWith(i, 'Z') || w.endsWith(i, 'D')) return ['i', 0];
  if (w.vowel(i + 1)) return [nxt === 'IH' && w.base(i + 2) === 'NG' ? 'i' : 'ɪ', 0];
  if (w.weakPrefix(i)) return w.nextVowelStress(i) === 1 ? ['ᵻ', 0] : ['iː', 2];
  return ['ɪ', 0];
}

function convert(word, arpabet, runs = null) {
  const w = new Word(word, arpabet.slice(), runs);
  const out = [];
  const emit = (phone, stress = 0) => out.push([phone, stress || 0]);
  let i = 0;
  while (i < w.count) {
    const name = w.bases[i], stress = w.stress[i] || 0, nxt = w.base(i + 1);
    if (!ARPA_VOWELS.has(name)) {
      if (name === 'Y' && nxt === 'AH' && w.unstressed(i + 1) && ['N', 'L'].includes(w.base(i - 1)) && w.base(i + 2) !== 'L'
          && (!w.aligned || (w.runs[i] + w.runs[i + 1]).includes('i'))) { emit('iə'); i += 2; continue; }
      emit(CONSONANTS[name]); i += 1; continue;
    }
    const beforeVowel = w.vowel(i + 2);
    if (name === 'ER') {
      emit(stress ? 'ɜː' : 'ɚ', stress);
      if (nxt === 'R') i += 1;
      if (w.vowel(i + 1)) emit('ɹ');
    } else if (nxt === 'R' && name === 'AW') {
      emit('aʊ', stress); emit('ɚ'); if (beforeVowel) emit('ɹ'); i += 1;
    } else if (nxt === 'R' && ['AA', 'AO', 'IH', 'IY', 'EH', 'UH', 'UW', 'AY'].includes(name)) {
      let quality, single;
      if (name === 'AA') { quality = 'ɑː'; single = 'ɑːɹ'; }
      else if (name === 'AO') { quality = northOrForce(w, i, beforeVowel); single = quality + 'ɹ'; }
      else if (name === 'IH' || name === 'IY') { quality = stress && ['e', 'eo'].includes(w.letters(i)) ? 'iə' : 'ɪ'; single = 'ɪɹ'; }
      else if (name === 'EH') {
        const doubled = (w.runs[i + 1] + w.after(i + 1)).startsWith('rr') || (w.runs[i].endsWith('r') && w.runs[i + 1].startsWith('r'));
        quality = w.letters(i) === 'a' && doubled ? 'æ' : 'ɛ'; single = 'ɛɹ';
      } else if (name === 'UH' || name === 'UW') { quality = single = 'ʊɹ'; }
      else { quality = !w.aligned || IRE_ENDINGS.includes(w.after(i + 1)) ? 'aɪɚ' : 'aɪ'; single = 'aɪɚ'; }
      if (beforeVowel) { emit(quality, stress); emit('ɹ'); } else emit(single, stress);
      i += 1;
    } else if (name === 'AY' && nxt === 'ER' && w.unstressed(i + 1) && w.runs[i + 1] === 'er' && w.runs[i] !== 'i') {
      emit('aɪ', stress);
    } else if (name === 'AY' && nxt === 'ER' && w.unstressed(i + 1)) {
      emit('aɪɚ', stress); i += 1; if (w.vowel(i + 1)) emit('ɹ');
    } else if (name === 'AY' && nxt === 'AH' && w.unstressed(i + 1)) {
      emit('aɪə', stress); i += 1;
    } else if (name === 'IY' && nxt === 'AH' && w.unstressed(i + 1) && !w.weakPrefix(i)) {
      const after = w.base(i + 2);
      if (stress !== 1 && (['L', 'D', 'T'].includes(after) || (after === 'N' && w.base(i + 3) === 'S'))) emit('ɪ');
      else { emit('iə', stress); i += 1; }
    } else if (!stress && name === 'AH' && nxt === 'N' && w.base(i - 1) === 'T' && w.base(i + 2) !== 'T'
        && out.length >= 2 && out[out.length - 1][0] === 't' && VOWEL_SET.has(out[out.length - 2][0]) && out[out.length - 2][1]) {
      out[out.length - 1][0] = 'ʔ'; emit('n̩'); i += 1;
    } else if (!stress && name === 'AH' && nxt === 'W' && w.base(i + 2) === 'AH' && w.unstressed(i + 2) && (w.runs[i] + w.runs[i + 1]).includes('u')) {
      emit('uː'); i += 1;
    } else if (!stress && name === 'AH' && nxt === 'L' && i > 0 && !(w.vowel(i + 2) && w.stress[i + 2])) {
      if (w.letters(i) === 'i' && w.vowel(i + 2)) emit('ɪ');
      else if (w.base(i - 1) === 'Y' && (w.runs[i - 1] + w.runs[i]).includes('u')) emit('ʊ');
      else { emit('əl'); i += 1; }
    } else if (!stress && (name === 'AH' || name === 'IH')) {
      emit(reduced(w, i));
    } else if (name === 'IY' && (!stress || (stress === 2 && nxt === null))) {
      emit(...unstressedIy(w, i));
    } else if (!stress && name === 'AE' && i === 0 && startsWithAny(w.word, ['ad', 'acc']) && (nxt === 'D' || nxt === 'K')) {
      emit('ɐ');
    } else if (!stress && name === 'ER') {
      emit('ɚ');
    } else if ((name === 'AA' || name === 'AO') && w.letters(i) === 'a' && endsWithAny(w.before(i), ['w', 'qu']) && nxt === 'N') {
      emit('ɔ', stress);
    } else if (name === 'AO' && w.letters(i) === 'o') {
      emit('ɔ', stress);
    } else {
      emit(FULL_VOWELS[name], stress);
    }
    i += 1;
  }
  flap(out);
  for (let k = 0; k < out.length - 1; k++) if (out[k][0] === 'n' && (out[k + 1][0] === 'k' || out[k + 1][0] === 'ɡ')) out[k][0] = 'ŋ';
  settleStressInPlace(out);
  return out.map(([p, s]) => [p, s]);
}
function flap(out) {
  for (let k = 1; k < out.length - 1; k++) {
    if (out[k][0] !== 't') continue;
    const before = out[k - 1][0], [after, stress] = out[k + 1];
    if ((!VOWEL_SET.has(before) && before !== 'ɹ') || before === 'n̩' || before === 'əl' || !VOWEL_SET.has(after) || after === 'n̩') continue;
    const finalO = after === 'oʊ' && (k + 2 === out.length || (k + 3 === out.length && out[k + 2][0] === 'z'));
    if (stress && !finalO) continue;
    if ((after === 'ə' || after === 'ɚ') && k + 2 < out.length && out[k + 2][0] === 'n') continue;
    out[k][0] = 'ɾ';
  }
}
function settleStress(phones) { const out = phones.map(([p, s]) => [p, s]); settleStressInPlace(out); return out; }
function settleStressInPlace(out) {
  const vowels = []; out.forEach(([p], k) => { if (VOWEL_SET.has(p)) vowels.push(k); });
  const primaries = vowels.filter(k => out[k][1] === 1);
  for (const k of primaries.slice(0, -1)) out[k][1] = 2;
  vowels.forEach((k, pos) => {
    if (out[k][1] !== 2) return;
    const nb = [pos - 1, pos + 1].filter(p => p >= 0 && p < vowels.length).map(p => vowels[p]);
    if (nb.some(n => out[n][1] === 1)) out[k][1] = 0;
  });
}
Object.assign(D, { convert, settleStress });

// ---------------- tables ----------------
const STRESS_CLASSES = new Set(['u', 'uf', 'ur', 's', 'ss', 'si', 'pf', 'p']);
function rows(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, n) => {
    line = line.trim();
    if (line && !line.startsWith('#')) out.push([n + 1, line.split(/\t+| {2,}/).map(c => c.trim())]);
  });
  return out;
}
function makeTables(T) {
  const t = name => T[name];
  const pron = text => { const symbols = text.split(/\s+/).filter(Boolean); return isArpabet(symbols) ? ['arpabet', symbols] : ['phones', fromText(text)]; };
  return {
    rows: name => rows(t(name)),
    functionWords() {
      const table = new Map();
      for (const [, c] of rows(t('function_words.txt'))) table.set(c[0], [c[1], fromText(c[2]), c.length === 4 ? fromText(c[3]) : null]);
      return table;
    },
    phrases() {
      const table = new Map();
      for (const [, c] of rows(t('phrases.txt'))) table.set(tupleKey(c[0].split(/\s+/)), [c[1], c[2].split('|').map(fromText), c.length === 4 ? fromText(c[3]) : null, c[0].split(/\s+/).length]);
      return table;
    },
    pronunciations(name) {
      const table = new Map();
      for (const [, c] of rows(t(name))) if (c.length === 2 && c[0].split(/\s+/).length === 1) table.set(c[0].toLowerCase(), pron(c[1]));
      return table;
    },
    names(name) {
      const table = new Map();
      for (const [, c] of rows(t(name))) {
        const words = c[0].toLowerCase().split(/\s+/);
        if (c.length !== 2 || words.length < 2) continue;
        table.set(tupleKey(words), { words, prons: c[1].split('|').map(p => pron(p.trim())) });
      }
      return table;
    },
    mapping(name) { const m = new Map(); for (const [, c] of rows(t(name))) m.set(c[0], c.length > 1 ? c[1] : ''); return m; },
  };
}
D.rows = rows; D.makeTables = makeTables;

// ---------------- g2p (unknown-word model) ----------------
class G2P {
  constructor(settings, buffer) {
    this.settings = settings;
    this.w = {};
    for (const t of settings.tensors) {
      const n = t.shape.reduce((a, b) => a * b, 1);
      this.w[t.name] = { data: new Float32Array(buffer, t.offset, n), shape: t.shape };
    }
    this.letters = new Map([...settings.letters].map((c, i) => [c, i + 1]));
    this.symbols = settings.symbols;
  }
  spellable(word) {
    const plain = word.toLowerCase().normalize('NFKD');
    return strip([...plain].filter(c => this.letters.has(c)).join(''), "'");
  }
  logits(word) {
    const S = this.settings, W = this.w, slots = S.slots;
    const ids = [...word].map(c => this.letters.get(c));
    const E = W.embed__weight, SL = W.slot, width = E.shape[1];
    const T = ids.length * slots;
    let x = []; // frames of Float32Array
    for (const id of ids) for (let s = 0; s < slots; s++) {
      const v = new Float32Array(width);
      for (let c = 0; c < width; c++) v[c] = E.data[id * width + c] + SL.data[s * width + c];
      x.push(v);
    }
    if (S.convs) throw new Error('conv blocks not supported');
    for (let layer = 0; layer < S.layers; layer++) {
      const both = [];
      for (const [suf, rev] of [['', false], ['_reverse', true]]) {
        both.push(this.gru(x, W[`gru__weight_ih_l${layer}${suf}`], W[`gru__weight_hh_l${layer}${suf}`], W[`gru__bias_ih_l${layer}${suf}`], W[`gru__bias_hh_l${layer}${suf}`], rev));
      }
      x = x.map((_, t) => { const a = both[0][t], b = both[1][t], v = new Float32Array(a.length + b.length); v.set(a); v.set(b, a.length); return v; });
    }
    const O = W.out__weight, OB = W.out__bias, nOut = O.shape[0], nIn = O.shape[1];
    const labels = [];
    for (let t = 0; t < T; t++) {
      let best = -Infinity, arg = 0;
      for (let o = 0; o < nOut; o++) {
        let s = OB.data[o];
        for (let c = 0; c < nIn; c++) s += x[t][c] * O.data[o * nIn + c];
        s = Math.fround(s);
        if (s > best) { best = s; arg = o; }
      }
      labels.push(arg);
    }
    return labels;
  }
  gru(x, wih, whh, bih, bhh, reverse) {
    const size = whh.shape[1], nIn = wih.shape[1], T = x.length, G3 = 3 * size;
    const inputs = x.map(v => {
      const r = new Float32Array(G3);
      for (let o = 0; o < G3; o++) { let s = bih.data[o]; for (let c = 0; c < nIn; c++) s += v[c] * wih.data[o * nIn + c]; r[o] = s; }
      return r;
    });
    let state = new Float32Array(size);
    const out = new Array(T);
    const sig = z => 1 / (1 + Math.exp(-z));
    for (let k = 0; k < T; k++) {
      const t = reverse ? T - 1 - k : k;
      const rec = new Float32Array(G3);
      for (let o = 0; o < G3; o++) { let s = bhh.data[o]; for (let c = 0; c < size; c++) s += whh.data[o * size + c] * state[c]; rec[o] = s; }
      const inp = inputs[t], ns = new Float32Array(size);
      for (let c = 0; c < size; c++) {
        const r = sig(inp[c] + rec[c]), z = sig(inp[size + c] + rec[size + c]);
        const n = Math.tanh(inp[2 * size + c] + r * rec[2 * size + c]);
        ns[c] = (1 - z) * n + z * state[c];
      }
      state = ns; out[t] = ns;
    }
    return out;
  }
  predict(word) {
    word = this.spellable(word);
    if (!word) return [];
    const out = []; let prev = 0;
    for (const label of this.logits(word)) { if (label !== prev && label !== 0) out.push(this.symbols[label - 1]); prev = label; }
    return out;
  }
}
D.G2P = G2P;

// ---------------- morphology ----------------
const SHORT_STEM = /(?:^|[^aeiou])[aeiou](?:[bcdfgklmnprstvz]|th)$/;
const M_SIBILANT = new Set(['s', 'z', 'ʃ', 'ʒ', 'tʃ', 'dʒ']);
const VOICELESS = new Set(['p', 't', 'k', 'f', 'θ', 'ʔ']);
const M_SPLIT = { 'ɑːɹ': 'ɑː', 'ɔːɹ': 'ɔː', 'oːɹ': 'oː', 'ɪɹ': 'ɪ', 'ɛɹ': 'ɛ' };
const M_RHOTIC = new Set(['ɚ', 'ɜː', 'aɪɚ', 'ʊɹ']);
const CONSONANT_LETTERS = 'bcdfghjklmnpqrstvwxz';
const P = (...phones) => phones.map(p => [p, 0]);
const ENDINGS = [
  ['fully', P('f', 'əl', 'i')], ['lessly', P('l', 'ə', 's', 'l', 'i')], ['ness', P('n', 'ə', 's')],
  ['less', P('l', 'ə', 's')], ['ments', P('m', 'ə', 'n', 't', 's')], ['ment', P('m', 'ə', 'n', 't')],
  ['ful', P('f', 'əl')], ['ship', [['ʃ', 0], ['ɪ', 2], ['p', 0]]], ['hood', [['h', 0], ['ʊ', 2], ['d', 0]]],
  ['like', [['l', 0], ['aɪ', 2], ['k', 0]]], ['dom', P('d', 'ə', 'm')], ['ish', P('ɪ', 'ʃ')],
  ['able', P('ə', 'b', 'əl')], ['ism', P('ɪ', 'z', 'ə', 'm')], ['ist', P('ɪ', 's', 't')],
  ['wards', P('w', 'ɚ', 'd', 'z')], ['ward', P('w', 'ɚ', 'd')], ['age', P('ɪ', 'dʒ')],
  ['ers', P('ɚ', 'z')], ['er', P('ɚ')], ['est', P('ɪ', 's', 't')], ['y', P('i')],
];
const twice = a => [a, a];
const M_PREFIXES = [
  ['under', twice([['ʌ', 2], ['n', 0], ['d', 0], ['ɚ', 0]])], ['over', twice([['oʊ', 2], ['v', 0], ['ɚ', 0]])],
  ['anti', twice([['æ', 2], ['n', 0], ['t', 0], ['i', 0]])], ['semi', twice([['s', 0], ['ɛ', 2], ['m', 0], ['i', 0]])],
  ['non', twice([['n', 0], ['ɑː', 2], ['n', 0]])], ['out', twice([['aʊ', 2], ['t', 0]])],
  ['dis', [P('d', 'ɪ', 's'), [['d', 0], ['ɪ', 2], ['s', 0]]]], ['mis', [P('m', 'ɪ', 's'), [['m', 0], ['ɪ', 2], ['s', 0]]]],
  ['un', [P('ʌ', 'n'), [['ʌ', 2], ['n', 0]]]], ['in', [P('ɪ', 'n'), [['ɪ', 2], ['n', 0]]]],
  ['re', [P('ɹ', 'ᵻ'), [['ɹ', 0], ['iː', 2]]]], ['pre', twice([['p', 0], ['ɹ', 0], ['iː', 2]])],
];
const BRITISH = [['isation', 'ization'], ['ising', 'izing'], ['ised', 'ized'], ['ises', 'izes'], ['ise', 'ize'], ['yse', 'yze'],
  ['our', 'or'], ['ourable', 'orable'], ['ours', 'ors'], ['oured', 'ored'], ['ouring', 'oring'],
  ['tre', 'ter'], ['tres', 'ters'], ['bre', 'ber'], ['ence', 'ense'], ['ogue', 'og'], ['mme', 'm'],
  ['lled', 'led'], ['lling', 'ling'], ['ller', 'ler'], ['oul', 'ol'], ['ae', 'e'], ['enqui', 'inqui']];

function join(stem, ending) {
  stem = stem.map(x => x.slice());
  if (!stem.length || !ending.length) return stem.concat(ending.map(x => x.slice()));
  const [last, stress] = stem[stem.length - 1], [first, firstStress] = ending[0];
  if (VOWEL_SET.has(first)) {
    if (last in M_SPLIT) stem.splice(stem.length - 1, 1, [M_SPLIT[last], stress], ['ɹ', 0]);
    else if (M_RHOTIC.has(last)) stem.push(['ɹ', 0]);
    else if (last === 't' && stem.length > 1 && (VOWEL_SET.has(stem[stem.length - 2][0]) || stem[stem.length - 2][0] === 'ɹ') && !firstStress
        && !(first === 'ə' && ending.length > 1 && ending[1][0] === 'n')) stem[stem.length - 1] = ['ɾ', 0];
    else if (last === 'i') stem[stem.length - 1] = first !== 'ɪ' ? ['ɪ', stress] : ['i', stress];
  } else if (last === 'i' && ['n', 'l', 'f', 'm'].includes(first)) stem[stem.length - 1] = ['ɪ', stress];
  else if (last === 'n' && (first === 'k' || first === 'ɡ')) stem[stem.length - 1] = ['ŋ', 0];
  return stem.concat(ending.map(x => x.slice()));
}
function plural(stem) { const last = stem[stem.length - 1][0]; return join(stem, M_SIBILANT.has(last) ? P('ᵻ', 'z') : VOICELESS.has(last) ? P('s') : P('z')); }
function past(stem) {
  const last = stem[stem.length - 1][0];
  if (['t', 'd', 'ɾ'].includes(last)) return join(stem, P('ᵻ', 'd'));
  return join(stem, VOICELESS.has(last) || ['s', 'ʃ', 'tʃ'].includes(last) ? P('t') : P('d'));
}
function adverb(stem) { const last = stem[stem.length - 1][0]; return join(stem, last === 'əl' || last === 'l' ? P('i') : P('l', 'i')); }
function stems(body) {
  const out = [body];
  if (body.length > 2 && body[body.length - 1] === body[body.length - 2] && CONSONANT_LETTERS.includes(body[body.length - 1])) out.push(body.slice(0, -1));
  if (body && (CONSONANT_LETTERS + 'u').includes(body[body.length - 1])) {
    const single = SHORT_STEM.test(body);
    if (single) out.unshift(body + 'e'); else out.push(body + 'e');
  }
  if (body.endsWith('i') && body.length > 2) out.push(body.slice(0, -1) + 'y');
  return out;
}
const secondary = phones => phones.map(([p, s]) => [p, s === 1 ? 2 : s]);
function derive(word, lookup, part = null, depth = 0) {
  part = part || lookup;
  const stem = sp => sp.length < 2 ? null : (lookup(sp) || (depth < 2 ? derive(sp, lookup, part, depth + 1) : null));
  const first = (cands, build) => { for (const sp of cands) { const f = stem(sp); if (f) return build(f); } return null; };
  let found;
  if (word.endsWith("'s")) return first([word.slice(0, -2)], plural);
  if (word.endsWith("s'")) return first([word.slice(0, -1)], f => f);
  if (word.endsWith('ies') && word.length > 4 && (found = first([word.slice(0, -3) + 'y'], plural))) return found;
  if (word.endsWith('ves') && word.length > 4 && (found = first([word.slice(0, -3) + 'f', word.slice(0, -3) + 'fe'], f => f[f.length - 1][0] === 'f' ? join(f.slice(0, -1).concat([['v', 0]]), P('z')) : null))) return found;
  if (word.endsWith('es') && word.length > 3 && (found = first('sxzh'.includes(word[word.length - 3]) ? [word.slice(0, -2)] : [], plural))) return found;
  if (word.endsWith('s') && !endsWithAny(word, ['ss', 'us', 'is']) && word.length > 3 && (found = first([word.slice(0, -1)], plural))) return found;
  if (word.endsWith('ied') && word.length > 4 && (found = first([word.slice(0, -3) + 'y'], past))) return found;
  if (word.endsWith('ed') && word.length > 3 && (found = first(stems(word.slice(0, -2)), past))) return found;
  if (word.endsWith('ing') && word.length > 4 && (found = first(stems(word.slice(0, -3)), f => join(f, P('ɪ', 'ŋ'))))) return found;
  if (word.endsWith('ily') && word.length > 4 && (found = first([word.slice(0, -3) + 'y'], adverb))) return found;
  if (word.endsWith('ly') && word.length > 3 && (found = first(word.endsWith('bly') || word.endsWith('ply')
      ? [word.slice(0, -2), word.slice(0, -2) + 'le', word.slice(0, -1) + 'e'] : [word.slice(0, -2)], adverb))) return found;
  for (const [spelling, phones] of ENDINGS) {
    if (word.endsWith(spelling) && word.length - spelling.length > 2) {
      const body = word.slice(0, -spelling.length);
      if (spelling === 'y' && !CONSONANT_LETTERS.includes(body[body.length - 1])) continue;
      const vowelFirst = VOWEL_SET.has(phones[0][0]);
      found = first(vowelFirst ? stems(body) : body.endsWith('i') ? [body.slice(0, -1) + 'y', body] : [body], f => join(f, phones));
      if (found) return found;
    }
  }
  for (const [spelling, [plain, stressed]] of M_PREFIXES) {
    if (word.startsWith(spelling) && word.length - spelling.length > 2) {
      found = stem(word.slice(spelling.length));
      if (found) {
        const vowels = found.filter(([p]) => VOWEL_SET.has(p)).map(([, s]) => s);
        return join(vowels.length && vowels[0] === 1 ? plain : stressed, found);
      }
    }
  }
  for (const [o, n] of BRITISH) {
    if (word.includes(o)) { found = stem(word.replace(o, n)); if (found) return found; }
  }
  if (depth === 0) {
    let best = null;
    for (let cut = 4; cut < word.length - 3; cut++) {
      const left = part(word.slice(0, cut)), right = part(word.slice(cut));
      if (left && right) { const score = Math.min(cut, word.length - cut); if (!best || score > best[0]) best = [score, left, right]; }
    }
    if (best) return join(best[1], secondary(best[2]));
  }
  return null;
}
D.morph = { join, plural, past, adverb, derive };

// ---------------- sentence ----------------
const S_SPLIT = { 'ɑːɹ': 'ɑː', 'ɔːɹ': 'ɔː', 'oːɹ': 'oː', 'ɪɹ': 'ɪ', 'ɛɹ': 'ɛ', 'ʊɹ': 'ʊ' };
const S_RHOTIC = new Set(['ɚ', 'ɜː', 'aɪɚ']);
const NO_LINK_BEFORE = new Set(['and', 'or', 'if']);
const FLAP_BEFORE_VOWEL = new Set(['it', 'at']);
class Unit {
  constructor(word, phones, kind = 'c', final = null, attach = false, source = '') { Object.assign(this, { word, phones, kind, final, attach, source }); }
  get lastWord() { const p = this.word.split(' '); return p[p.length - 1]; }
  get firstWord() { return this.word.split(' ')[0]; }
}
const unstress = phones => phones.map(([p]) => [p, 0]);
function promote(phones) {
  const marks = phones.map(([, s]) => s);
  if (marks.includes(1)) return phones.slice();
  let target;
  if (marks.includes(2)) target = marks.lastIndexOf(2);
  else { target = phones.findIndex(([p]) => VOWEL_SET.has(p)); if (target < 0) target = null; }
  return phones.map(([p, s], i) => [p, i === target ? 1 : s]);
}
function stressClause(units) {
  let primaryFollows = false;
  for (let index = units.length - 1; index >= 0; index--) {
    const u = units[index];
    const promoted = () => u.final !== null ? u.final : promote(u.phones);
    let phones;
    const last = index === units.length - 1;
    switch (u.kind) {
      case 'u': phones = unstress(u.phones); break;
      case 'uf': phones = last ? promoted() : unstress(u.phones); break;
      case 'ur': phones = primaryFollows ? unstress(u.phones) : promoted(); break;
      case 's': phones = primaryFollows ? u.phones : promoted(); break;
      case 'si': phones = !primaryFollows ? promoted() : index === 0 ? u.phones : unstress(u.phones); break;
      case 'pf': phones = last ? promoted() : u.phones; break;
      default: phones = u.phones;
    }
    u.phones = phones.map(x => x.slice());
    primaryFollows = primaryFollows || u.phones.some(([, s]) => s === 1);
  }
  if (units.length && !units.some(u => u.phones.some(([, s]) => s))) {
    for (let k = units.length - 1; k >= 0; k--) {
      if (units[k].phones.some(([p]) => VOWEL_SET.has(p))) { units[k].phones = promote(units[k].phones); break; }
    }
  }
}
function joinClause(units) {
  for (let k = 0; k < units.length - 1; k++) {
    const u = units[k], f = units[k + 1];
    if (!u.phones.length || !f.phones.length || !VOWEL_SET.has(f.phones[0][0])) continue;
    const [last, stress] = u.phones[u.phones.length - 1];
    const head = u.phones.slice(0, -1);
    if (u.lastWord === 'the' && last === 'ə') u.phones = head.concat([['ɪ', stress]]);
    else if (u.lastWord === 'to' && last === 'ə') u.phones = head.concat([['ʊ', stress]]);
    else if (NO_LINK_BEFORE.has(f.firstWord)) continue;
    else if (last in S_SPLIT) u.phones = head.concat([[S_SPLIT[last], stress], ['ɹ', 0]]);
    else if (S_RHOTIC.has(last)) u.phones = u.phones.concat([['ɹ', 0]]);
    else if (last === 't' && FLAP_BEFORE_VOWEL.has(u.word) && u.phones.length > 1 && VOWEL_SET.has(u.phones[u.phones.length - 2][0])) u.phones = head.concat([['ɾ', 0]]);
  }
}
function groups(units) {
  const out = [];
  for (const u of units) { if (u.attach && out.length) out[out.length - 1] = out[out.length - 1].concat(u.phones); else out.push(u.phones.slice()); }
  return out.filter(g => g.length);
}
D.sentence = { Unit, promote, stressClause, joinClause, groups };

// ---------------- homographs ----------------
const CLASSES = [
  ['TO', 'to'],
  ['DET', 'the a an this that these those every each no some any another such what which whose'],
  ['POSS', 'my your his her its our their'],
  ['SUBJ', 'i you he she it we they who'],
  ['OBJ', 'me him us them'],
  ['MODAL', "will would shall should can could may might must 'll 'd won't can't cannot couldn't shouldn't wouldn't let's please"],
  ['DO', "do does did don't doesn't didn't"],
  ['BE', "am is are was were be been being isn't aren't wasn't weren't i'm you're we're they're he's she's it's that's there's"],
  ['HAVE', "have has had having haven't hasn't hadn't i've you've we've they've"],
  ['NEG', 'not never'],
  ['PREP', 'of in on at by for from with into onto over under about after before between through during without within against among around across behind beside near upon toward towards as than like'],
  ['CONJ', 'and or but nor so yet if because although though while when where unless until since whether'],
  ['ADV', 'very too quite rather more most less least also just only even still always often sometimes usually again now then here there soon already almost'],
];
const TAG = new Map(); for (const [name, words] of CLASSES) for (const w of words.split(' ')) TAG.set(w, name);
const SENTENCE_END = new Set(['.', '?', '!']);
const WINDOW = 6;
const firstIsAlpha = t => /^\p{L}/u.test(t);
function tag(token) {
  if (token === '<s>' || token === '</s>') return token;
  if (!firstIsAlpha(token)) return /^\p{Nd}/u.test(token) ? 'NUM' : 'PUNCT';
  const lower = token.toLowerCase();
  if (TAG.has(lower)) return TAG.get(lower);
  for (const [e, n] of [["'s", 'POS'], ['ly', 'LY'], ['ing', 'ING'], ['ed', 'ED']]) if (lower.endsWith(e) && lower.length > e.length + 1) return n;
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) return 'S';
  return isUpper(token[0]) ? 'CAP' : 'W';
}
function features(tokens, index) {
  const at = off => { const p = index + off; return p >= 0 && p < tokens.length ? tokens[p] : (off < 0 ? '<s>' : '</s>'); };
  const p2 = at(-2), p1 = at(-1), n1 = at(1), n2 = at(2);
  const tp2 = tag(p2), tp1 = tag(p1), tn1 = tag(n1), tn2 = tag(n2);
  const out = ['tp1=' + tp1, 'tp2=' + tp2, 'tn1=' + tn1, 'tn2=' + tn2, 'tp2p1=' + tp2 + '+' + tp1, 'tp1n1=' + tp1 + '+' + tn1, 'tn1n2=' + tn1 + '+' + tn2];
  if (index === 0) out.push('first'); else if (isUpper(tokens[index][0])) out.push('cap');
  out.push('p1=' + p1.toLowerCase(), 'p2=' + p2.toLowerCase(), 'n1=' + n1.toLowerCase(), 'n2=' + n2.toLowerCase());
  const target = tokens[index].toLowerCase();
  const nearby = new Set(tokens.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).filter(firstIsAlpha).map(t => t.toLowerCase()));
  nearby.delete(target);
  for (const w of [...nearby].sort()) out.push('w=' + w);
  return out;
}
const shared = names => names.filter(n => n[0] === 't' || n === 'first' || n === 'cap');
function sentenceOf(tokens, index) {
  let start = index; while (start > 0 && !SENTENCE_END.has(tokens[start - 1])) start--;
  let end = index; while (end < tokens.length && !SENTENCE_END.has(tokens[end])) end++;
  return [tokens.slice(start, end + 1), index - start];
}
const SKIP_BEFORE = new Set(['ADV', 'NEG', 'LY']);
const SKIP_AUX = new Set([...SKIP_BEFORE, 'SUBJ', 'OBJ', 'DET', 'POSS']);
function left(tokens, index, skip) {
  for (let p = index - 1; p > Math.max(index - 6, -1); p--) {
    const t = tokens[p];
    if (skip.has(tag(t))) continue;
    const lower = t.toLowerCase();
    return lower.endsWith("'ll") ? 'will' : lower.endsWith("'ve") ? 'have' : lower;
  }
  return '<s>';
}
function readRules(text) {
  const rules = new Map();
  for (const [, c] of rows(text)) {
    const conditions = c[2].split(';').map(part => {
      part = part.trim(); const k = part.indexOf(':');
      const name = k < 0 ? part : part.slice(0, k), words = k < 0 ? '' : part.slice(k + 1);
      return [name, new Set(words.split(/\s+/).filter(Boolean))];
    });
    if (!rules.has(c[0])) rules.set(c[0], []);
    rules.get(c[0]).push([c[1], conditions]);
  }
  return rules;
}
function holds(cond, words, tokens, index) {
  if (cond === 'first') return index === 0;
  if (cond === 'aux') return words.has(left(tokens, index, SKIP_AUX));
  if (cond === 'before') return words.has(left(tokens, index, SKIP_BEFORE));
  if (cond === 'next') return words.has(index + 1 < tokens.length ? tokens[index + 1].toLowerCase() : '</s>');
  return tokens.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).some(t => words.has(t.toLowerCase()));
}
class Homographs {
  constructor(data, rulesText) {
    this.words = data.words; this.pooled = data.pooled;
    this.pluralBases = new Set(data.plural_bases || []);
    this.rules = readRules(rulesText);
  }
  covers(word) { return Object.prototype.hasOwnProperty.call(this.words, word) || (word.endsWith('s') && this.pluralBases.has(word.slice(0, -1))); }
  pronounce(word, tokens, index) {
    if (Object.prototype.hasOwnProperty.call(this.words, word)) return [this.choose(word, tokens, index).phones, false];
    const entry = this.words[word.slice(0, -1)];
    const adj = entry.senses.find(s => s.role === 'n');
    if (adj && adj.id === 'adj') return [entry.senses.find(s => s.role === 'v').phones, true];
    return [this.choose(word.slice(0, -1), tokens, index).phones, true];
  }
  scores(word, tokens, index) {
    const entry = this.words[word];
    const names = features(...sentenceOf(tokens, index));
    const model = entry.model;
    const sumw = (ws, ns) => ns.reduce((a, n) => a + (ws[n] || 0), 0);
    if (model.kind === 'noun-verb') {
      let verb = this.pooled.bias + sumw(this.pooled.weights, shared(names));
      verb += model.bias + sumw(model.weights, names);
      return entry.senses.map(s => s.role === 'v' ? verb : -verb);
    }
    return model.bias.map((b, k) => b + sumw(model.weights[k], names));
  }
  choose(word, tokens, index) {
    const entry = this.words[word];
    const [sent, pos] = sentenceOf(tokens, index);
    for (const [sense, conds] of this.rules.get(word) || []) {
      if (conds.every(([n, ws]) => holds(n, ws, sent, pos))) return entry.senses.find(s => s.id === sense);
    }
    const sc = this.scores(word, tokens, index);
    let best = 0; for (let k = 1; k < sc.length; k++) if (sc[k] > sc[best]) best = k;
    return entry.senses[best];
  }
}
D.Homographs = Homographs;
})(typeof self !== 'undefined' ? self : globalThis);
