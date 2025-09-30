// api/uv-list.js
//
// Kombinierte Server-Route für deine ÜV-Liste.
// - Kandidaten: FUTDATABASE (Players) oder FUT.GG Popular -> per FUTDB-Search gemappt
// - Preise: zuerst FUTDATABASE, Fallback FUT.GG Scraper
// - Ergebnis: JSON mit Spielername, OVR, Position, BIN, Kaufpreis, VK, Profit, Quelle
//
// Voraussetzung: In Vercel ist FUTDB_API_KEY gesetzt (PROJECT > Settings > Environment Variables)

const BASES = [
  'https://api.futdatabase.com/api',
  'https://api.futdatabase.com/api/fc',
];

function hdr(key, bearer=false){
  return bearer
    ? { 'Accept':'application/json', 'Authorization':`Bearer ${key}` }
    : { 'Accept':'application/json', 'X-AUTH-TOKEN': key };
}

async function fetchJsonAuth(url, key){
  // erst X-AUTH, dann Bearer probieren
  let r = await fetch(url, { headers: hdr(key,false) });
  if (r.status === 401 || r.status === 403) {
    r = await fetch(url, { headers: hdr(key,true) });
  }
  if(!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return await r.json();
}

async function futdbTry(paths, key){
  for(const base of BASES){
    for(const p of paths){
      const u = base + p;
      try{
        const j = await fetchJsonAuth(u, key);
        return { ok:true, base, path:p, json:j };
      }catch{}
    }
  }
  return { ok:false };
}

function arrFromPayload(j){
  return j?.items || j?.data || j?.players || j?.result || [];
}

function takePrice(j){
  return (
    j?.lowestBin ??
    j?.bin ??
    j?.price ??
    j?.data?.lowestBin ??
    j?.data?.bin ??
    j?.data?.price ??
    null
  );
}

const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

/** ---------- FUT.GG SCRAPER ---------- **/
async function getFutggPopular(limit=40){
  // Holt die Popular-Liste (erste Seite) und extrahiert Spielernamen
  // (HTML kann variieren; wir fangen die üblichsten Varianten ab).
  const url = 'https://www.fut.gg/players/?sort=popular';
  const html = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} }).then(r=>r.text());
  const names = new Set();

  // Versuch 1: __NUXT__ / eingebettetes JSON
  const nuxtMatch = html.match(/__NUXT__\s*=\s*(\{[\s\S]+?\});/);
  if (nuxtMatch) {
    try {
      const nuxt = JSON.parse(nuxtMatch[1]);
      const list = JSON.stringify(nuxt);
      // sehr simple Extraktion der "name" Felder
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while((m=re.exec(list)) && names.size<limit){ names.add(m[1]); }
    } catch {}
  }

  // Versuch 2: data-player-name oder data-name-ähnliche Marker
  if (names.size < 10) {
    const re2 = /data-player-name="([^"]+)"/g;
    let m; while((m=re2.exec(html)) && names.size<limit){ names.add(m[1]); }
  }

  // Versuch 3: Linktitel
  if (names.size < 10) {
    const re3 = /<a[^>]+class="[^"]*player-card[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m; while((m=re3.exec(html)) && names.size<limit){
      const inner = m[1];
      const nm = inner.match(/title="([^"]+)"/)?.[1] || inner.match(/alt="([^"]+)"/)?.[1];
      if (nm) names.add(nm);
    }
  }

  return Array.from(names).slice(0, limit);
}

function norm(s){ return (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim(); }

/** ---------- PREIS VON FUT.GG (Fallback) ---------- **/
async function getFutggBin(name, platform='ps'){
  // Suche Seite und versuche "Lowest BIN" im Umfeld zu parsen
  // (Not-Perfect, aber reicht als Fallback).
  // Plattform wird bei FUT.GG nicht immer im HTML unterschieden;
  // wir lassen sie hier nur formal durchlaufen.
  const q = encodeURIComponent(name);
  const url = `https://www.fut.gg/players/?name=${q}`;
  const html = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} }).then(r=>r.text());

  // Suche "LOWEST BIN" -> Zahl im nahen Umfeld
  const lb = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (lb) {
    const raw = lb[1].replace(/[^\d.,]/g,'').replace(/\s+/g,'');
    // 6,100 oder 6.100 → nach Zahl wandeln
    const num = parseInt(raw.replace(/[^\d]/g,''), 10);
    if (Number.isFinite(num) && num>0) return num;
  }

  // Alternative: nach "Lowest BIN" in Karten
  const lb2 = html.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (lb2) {
    const num = parseInt(lb2[1], 10);
    if (Number.isFinite(num) && num>0) return num;
  }

  return null;
}

/** ---------- FUTDB-SUCHEN/MAPPEN ---------- **/
async function futdbSearchByName(name, key){
  const q = encodeURIComponent(name);
  const attempt = await futdbTry([
    `/players?search=${q}&limit=5`,
    `/fc/players?search=${q}&limit=5`,
    `/search/players?name=${q}&limit=5`,
    `/fc/search/players?name=${q}&limit=5`,
  ], key);
  if (!attempt.ok) return null;
  const items = arrFromPayload(attempt.json);
  if (!items.length) return null;
  return items[0]; // best match
}

async function futdbPlayersByPages(pages, limit, key){
  const out = [];
  for (let page=1; page<=pages; page++){
    const got = await futdbTry([
      `/players?page=${page}&limit=${limit}`,
      `/fc/players?page=${page}&limit=${limit}`,
    ], key);
    if (!got.ok) break;
    const arr = arrFromPayload(got.json);
    out.push(...arr);
    if (arr.length < limit) break;
    await sleep(80);
  }
  return out;
}

async function futdbPriceById(id, platform, key){
  const attempt = await futdbTry([
    `/players/${id}/price?platform=${platform}`,
    `/players/${id}/prices?platform=${platform}`,
    `/prices/${platform}/${id}`,
    `/fc/players/${id}/price?platform=${platform}`,
    `/fc/players/${id}/prices?platform=${platform}`,
    `/fc/prices/${platform}/${id}`,
  ], key);
  if (!attempt.ok) return { bin:null, route:null };
  const price = takePrice(attempt.json);
  return { bin: price ?? null, route: attempt.base + attempt.path };
}

/** ---------- HELFER ---------- **/
function chemFor(pos){
  const p=(pos||'').toUpperCase();
  const atk=/ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p), def=/CB|LB|RB|LWB|RWB|CDM/.test(p);
  if(atk) return 'Hunter / Engine / Finisher';
  if(def) return (p==='CB'||p==='CDM') ? 'Shadow / Anchor' : 'Shadow';
  return p==='GK' ? 'Basic' : 'Basic / Engine';
}
const roundTo = (v,step)=>Math.round(v/step)*step;

/** ---------- HANDLER ---------- **/
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const key = process.env.FUTDB_API_KEY || '';
  const q = req.query || {};

  const mode = (q.mode || 'popular').toString(); // "popular" | "played" | "fodder"
  const platform = (q.platform || 'ps').toString().toLowerCase(); // ps|xbox|pc
  const size = Math.max(1, Math.min(200, parseInt(q.size||'50',10)));
  const ovrMin = parseInt(q.ovrMin||'0',10);
  const ovrMax = parseInt(q.ovrMax||'99',10);
  const binMin = parseInt(q.binMin||'0',10);
  const binMax = parseInt(q.binMax||'9999999',10);
  const discount = parseFloat(q.discount||'3');

  const minProfitSteps = [800,700,600,500];

  try{
    if (!key) {
      return res.status(200).json({ ok:false, error:'FUTDB_API_KEY missing in env', items:[] });
    }

    let candidates = [];

    if (mode==='popular' || mode==='played'){
      // 1) FUT.GG Popular Liste → Namen
      const names = await getFutggPopular(size*3);
      // 2) pro Name per FUTDB mappen (für OVR/Position & ID)
      for (const nm of names){
        const m = await futdbSearchByName(nm, key);
        if (m) { candidates.push(m); }
        else   { candidates.push({ name:nm, rating:null, position:'', id:null }); } // stub
        if (candidates.length >= size*3) break;
        await sleep(60);
      }
    } else {
      // FODDER (SBC): FUTDB-Pool & Filter
      const pool = await futdbPlayersByPages(10, 200, key);
      candidates = pool.filter(p=>{
        const o=+(p.rating||0); const pos=(p.position||'').toUpperCase();
        const fod = /GK|CB|LB|RB|LWB|RWB|CDM|CM/.test(pos);
        return o>=Math.max(82,ovrMin) && o<=Math.max(ovrMin,ovrMax) && fod;
      });
      if (!candidates.length) candidates = pool.slice();
    }

    // OVR-Filter nur anwenden, wenn OVR vorhanden (Popular-Stubs behalten)
    candidates = candidates.filter(p=>{
      const o = +(p.rating ?? p.ovr ?? 0);
      if (!o) return true;
      return o>=ovrMin && o<=ovrMax;
    });

    const out = [];
    let priceHits=0;

    for (const minProfit of minProfitSteps){
      out.length = 0; priceHits = 0;

      for (const p of candidates){
        if (out.length >= size) break;

        const name = p.name || p.fullName || p.commonName || '-';
        const pos  = p.position || '';
        const ovr  = +(p.rating||p.ovr||0) || '';
        const id   = p.id || p.playerId || p._id || null;

        // 1) Preis via FUTDATABASE (stabil)
        let bin = null, src='FUTDB', route=null;
        if (id){
          try{
            const fp = await futdbPriceById(id, platform, key);
            bin = fp.bin; route = fp.route;
          }catch{}
        }

        // 2) Fallback: FUT.GG Scraper
        if (bin==null || !Number.isFinite(bin) || bin<=0){
          const sbin = await getFutggBin(name, platform);
          if (sbin) { bin = sbin; src = 'SCRAPER'; }
        }

        if (bin!=null && Number.isFinite(bin) && bin>0) priceHits++;
        else continue;

        if (bin < binMin || bin > binMax) continue;

        const buy = roundTo(bin*(1 - discount/100), 100);
        const sell = roundTo((buy + 1000) / 0.95, 100);
        const profit = Math.floor(sell*0.95 - buy);
        if (profit < minProfit) continue;

        out.push({
          name, pos, ovr,
          bin, src,
          futdbPriceRoute: route || null,
          chem: chemFor(pos),
          buy, sell, profit
        });
      }

      if (out.length >= Math.min(size,5)) break;
    }

    out.sort((a,b)=>b.profit-a.profit);

    return res.status(200).json({
      ok:true,
      mode, platform, size,
      priceHits,
      items: out
    });

  }catch(e){
    return res.status(200).json({ ok:false, error: e.message.slice(0,250), items:[] });
  }
};
