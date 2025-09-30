// api/uv-list.js
// Kombinierte Route: holt Kandidaten (Popular/Fodder), Preise zuerst via FUTDB,
// Scraper (FUT.GG) nur als Fallback. Gibt fertige Deals als JSON zurück.
// ENV: FUTDB_API_KEY muss gesetzt sein.

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
const norm = s => (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();

/* ---------- FUT.GG (Fallback) ---------- */
async function getFutggPopular(limit=40){
  const url = 'https://www.fut.gg/players/?sort=popular';
  const html = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} }).then(r=>r.text());
  const names = new Set();

  const nuxt = html.match(/__NUXT__\s*=\s*(\{[\s\S]+?\});/);
  if (nuxt) {
    try {
      const data = JSON.parse(nuxt[1]);
      const str = JSON.stringify(data);
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while((m=re.exec(str)) && names.size<limit) names.add(m[1]);
    } catch {}
  }
  if (names.size < 10) {
    const re2 = /data-player-name="([^"]+)"/g;
    let m; while((m=re2.exec(html)) && names.size<limit) names.add(m[1]);
  }
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

async function getFutggBin(name){
  const q = encodeURIComponent(name);
  const url = `https://www.fut.gg/players/?name=${q}`;
  const html = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} }).then(r=>r.text());
  const lb = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (lb) {
    const raw = lb[1].replace(/[^\d]/g,'');
    const num = parseInt(raw, 10);
    if (Number.isFinite(num) && num>0) return num;
  }
  const lb2 = html.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (lb2) {
    const num = parseInt(lb2[1], 10);
    if (Number.isFinite(num) && num>0) return num;
  }
  return null;
}

/* ---------- FUTDB Suchen/Preise ---------- */
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
  return items[0] || null;
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

/* ---------- Helfer ---------- */
function chemFor(pos){
  const p=(pos||'').toUpperCase();
  const atk=/ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p), def=/CB|LB|RB|LWB|RWB|CDM/.test(p);
  if(atk) return 'Hunter / Engine / Finisher';
  if(def) return (p==='CB'||p==='CDM') ? 'Shadow / Anchor' : 'Shadow';
  return p==='GK' ? 'Basic' : 'Basic / Engine';
}
const roundTo = (v,step)=>Math.round(v/step)*step;

/* ---------- Handler ---------- */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const key = process.env.FUTDB_API_KEY || '';
  const q = req.query || {};

  const mode = (q.mode || 'popular').toString(); // popular | played | fodder
  const platform = (q.platform || 'ps').toString().toLowerCase(); // ps|xbox|pc
  const size = Math.max(1, Math.min(200, parseInt(q.size||'50',10)));
  const ovrMin = parseInt(q.ovrMin||'0',10);
  const ovrMax = parseInt(q.ovrMax||'99',10);
  const binMin = parseInt(q.binMin||'0',10);
  const binMax = parseInt(q.binMax||'9999999',10);
  const discount = parseFloat(q.discount||'3');     // Prozent
  const prefer = (q.prefer||'auto').toString();     // auto | futdb | scraper

  const minProfitSteps = [800,700,600,500];         // „abwärts“ zulassen

  try{
    if (!key) return res.status(200).json({ ok:false, error:'FUTDB_API_KEY missing', items:[] });

    let candidates = [];

    if (mode==='popular' || mode==='played'){
      const names = await getFutggPopular(size*3);
      for (const nm of names){
        const m = await futdbSearchByName(nm, key);
        candidates.push(
          m || { name:nm, rating:null, position:'', id:null }
        );
        if (candidates.length >= size*3) break;
        await sleep(60);
      }
    } else {
      const pool = await futdbPlayersByPages(10, 200, key);
      candidates = pool.filter(p=>{
        const o=+(p.rating||0); const pos=(p.position||'').toUpperCase();
        const fod = /GK|CB|LB|RB|LWB|RWB|CDM|CM/.test(pos);
        return o>=Math.max(82,ovrMin) && o<=Math.max(ovrMin,ovrMax) && fod;
      });
      if (!candidates.length) candidates = pool.slice();
    }

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

        let bin = null, src='FUTDB', route=null;

        // 1) FUTDB-Preis (sofern erlaubt)
        if (prefer!=='scraper' && id){
          try{
            const fp = await futdbPriceById(id, platform, key);
            bin = fp.bin; route = fp.route;
          }catch{}
        }

        // 2) Fallback Scraper (oder erzwungen)
        if ((bin==null || !Number.isFinite(bin) || bin<=0) && prefer!=='futdb'){
          const sbin = await getFutggBin(name);
          if (sbin) { bin = sbin; src = 'SCRAPER'; }
        }

        if (bin==null || !Number.isFinite(bin) || bin<=0) continue;
        priceHits++;

        if (bin < binMin || bin > binMax) continue;

        const buy = roundTo(bin*(1 - discount/100), 100);
        const sell = roundTo((buy + 1000) / 0.95, 100);
        const profit = Math.floor(sell*0.95 - buy);
        if (profit < minProfit) continue;

        out.push({ name, pos, ovr, bin, src, futdbPriceRoute: route||null, chem: chemFor(pos), buy, sell, profit });
      }

      if (out.length >= Math.min(size,5)) break;
    }

    out.sort((a,b)=>b.profit-a.profit);

    return res.status(200).json({ ok:true, mode, platform, size, priceHits, items: out });
  }catch(e){
    return res.status(200).json({ ok:false, error: e.message.slice(0,250), items:[] });
  }
};
