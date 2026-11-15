// Fast Reader natural voice: runs the tiny-voca model (Apache-2.0, Muhammed Nazeem) with ONNX Runtime Web.
// Messages in:  {type:'init'} | {type:'synth', id, words:[...], voice:0|1, speed}
// Messages out: {type:'progress', pct} | {type:'ready'} | {type:'error', message} | {type:'audio', id, audio, times}
'use strict';
const BASE = self.location.href.replace(/[^/]*$/, '');
importScripts(BASE + 'ort.wasm.min.js', BASE + 'dizione-core.js', BASE + 'dizione-text.js');
const SR = 24000, HOP = 256;
let session = null, P = null, ready = null;

// Files are kept in the browser's cache storage after the first download, so later visits start offline and instantly.
const CACHE = 'fast-reader-voice-1';
async function fetchWithProgress(url, onBytes) {
  let store = null;
  try { store = await caches.open(CACHE); const hit = await store.match(url); if (hit) { const b = await hit.arrayBuffer(); if (onBytes) onBytes(b.byteLength); return b; } } catch (e) { store = null; }
  const buf = await fetchNet(url, onBytes);
  if (store) store.put(url, new Response(buf.slice(0))).catch(() => {});
  return buf;
}
async function fetchNet(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url.split('/').pop()} (${r.status})`);
  if (!r.body || !onBytes) return r.arrayBuffer();
  const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(got); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const MODEL_BYTES = 21386372, LEX_BYTES = 3454357;
    let mb = 0, lb = 0;
    const report = () => postMessage({ type: 'progress', pct: Math.min(99, Math.round((mb + lb) / (MODEL_BYTES + LEX_BYTES) * 100)) });
    ort.env.wasm.wasmPaths = self.WASM_BASE || BASE;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const [model, lex, data, g2p] = await Promise.all([
      fetchWithProgress(BASE + 'model.onnx', n => { mb = n; report(); }),
      fetchWithProgress(BASE + 'lexicon.tsv', n => { lb = n; report(); }),
      fetch(BASE + 'dizione-data.json').then(r => r.json()),
      fetchWithProgress(BASE + 'g2p.bin'),
    ]);
    P = new self.Dz.Phonemizer({ lexicon: new TextDecoder().decode(lex), align: data.align, g2pSettings: data.g2p, g2pBuffer: g2p, homographs: data.homographs, tables: data.tables });
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    postMessage({ type: 'ready' });
  })();
  ready.catch(e => { postMessage({ type: 'error', message: String(e && e.message || e) }); ready = null; });
  return ready;
}

// Phonemes for a run of display words, plus where each display word starts in the token sequence.
function prepare(words) {
  const Dz = self.Dz;
  const text = words.join(' ');
  const N = P.normalizer;
  // How many spoken tokens each display word turns into on its own (numbers, money and dates expand).
  const counts = words.map(w => { try { return N.tokens(w).filter(t => !(t instanceof Dz.Punct)).length; } catch (e) { return 1; } });
  const analysed = P.analyse(text);
  // Rebuild the token sequence exactly as tokenize() does, remembering where each spoken group starts.
  const symbols = [Dz.BOS], stress = [0], groupStarts = []; // {sym, tok, n}
  let tok = 0;
  for (const [kind, value] of analysed) {
    if (kind === 'punct') { if (symbols[symbols.length - 1] !== value) { symbols.push(value); stress.push(0); } continue; }
    // groups with the normalised-token index of their first unit
    const gs = [];
    for (const u of value) {
      const n = u.word.split(' ').length;
      if (u.attach && gs.length) { gs[gs.length - 1].phones = gs[gs.length - 1].phones.concat(u.phones); gs[gs.length - 1].n += n; }
      else gs.push({ phones: u.phones.slice(), tok, n });
      tok += n;
    }
    for (const g of gs) {
      if (!g.phones.length) continue;
      const last = symbols[symbols.length - 1];
      if (Dz.PHONE_SET.has(last) || last === Dz.UNK) { symbols.push(Dz.SP); stress.push(0); }
      groupStarts.push({ sym: symbols.length, tok: g.tok, n: g.n });
      for (const [p, s] of g.phones) {
        if (Dz.PHONE_SET.has(p)) { symbols.push(p); stress.push(s); } else { symbols.push(Dz.UNK); stress.push(0); }
      }
    }
  }
  symbols.push(Dz.EOS); stress.push(0);
  const ids = symbols.map(s => Dz.SYMBOL_TO_ID.get(s));
  const total = tok, sum = counts.reduce((a, b) => a + b, 0);
  // display word -> first normalised token
  const firstTok = []; let acc = 0;
  for (let i = 0; i < words.length; i++) { firstTok.push(sum === total ? acc : (sum ? acc / sum * total : i / words.length * total)); acc += counts[i]; }
  return { ids, stress, groupStarts, firstTok, hasSpeech: groupStarts.length > 0 };
}

async function synth(msg) {
  await init();
  const prep = prepare(msg.words);
  if (!prep.hasSpeech || prep.ids.length > 512) {
    const secs = Math.max(0.3, msg.words.length * 0.25 / msg.speed);
    postMessage({ type: 'audio', id: msg.id, audio: new Float32Array(Math.round(secs * SR)), times: msg.words.map((_, i) => i * secs / msg.words.length) });
    return;
  }
  const i64 = a => new ort.Tensor('int64', BigInt64Array.from(a, v => BigInt(v)), [1, a.length]);
  const f32 = v => new ort.Tensor('float32', Float32Array.from([v]), [1]);
  const out = await session.run({ tokens: i64(prep.ids), stress: i64(prep.stress), voice: new ort.Tensor('int64', BigInt64Array.from([BigInt(msg.voice)]), [1]),
    speed: f32(msg.speed), pitch_shift: f32(0), pitch_range: f32(1) });
  const audio = out.audio.data.slice();
  const dur = out.durations.data;
  // start time (s) of every token
  const start = new Float64Array(dur.length + 1);
  for (let k = 0; k < dur.length; k++) start[k + 1] = start[k] + Number(dur[k]) * HOP / SR;
  const G = prep.groupStarts;
  const groupTime = G.map(g => start[g.sym]);
  const totalTime = audio.length / SR;
  const times = prep.firstTok.map(t => {
    // the spoken group holding normalised token t
    let g = 0; while (g + 1 < G.length && G[g + 1].tok <= t) g++;
    if (!G.length) return 0;
    const t0 = groupTime[g], t1 = g + 1 < G.length ? groupTime[g + 1] : totalTime;
    const frac = Math.max(0, Math.min(1, (t - G[g].tok) / Math.max(1, G[g].n)));
    return t0 + frac * (t1 - t0);
  });
  postMessage({ type: 'audio', id: msg.id, audio, times }, [audio.buffer]);
}

let queue = Promise.resolve();
self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'init') { init(); return; }
  if (msg.type === 'synth') queue = queue.then(() => synth(msg)).catch(err => postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) }));
};
