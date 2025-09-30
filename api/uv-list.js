// api/uv-list.js  — SCRAPER-ONLY (FUT.GG)
// - Holt die Popular-Liste (IDs + Namen) von FUT.GG
// - Lädt pro Spieler die Detail-Seite
// - Parst Lowest BIN (plattform-spezifisch, wenn verfügbar)
// - Rechnet Buy/Sell/Profit und gibt eine Deal-Liste zurück

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const fmtInt = s => parseInt(String(s).replace(/[^\d]/g,''),10);
const roundTo = (v, step)=>Math.round(v/step)*step;

// kleine Drosselung, um nicht sofort blockiert zu werden
async function gentleFetch(url) {
  await sleep(80 + Math.floor(Math.random()*120));
  const res = await fetch(url, { headers: { 'User-Agent': UA }});
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.text();
}

/** Popular-Liste: /players/?sort=popular
 * gibt [{id, name}] zurück
 */
async function getPopularList(limit=60) {
  const html = await gentleFetch('https://www.fut.gg/players/?sort=popular');
  const out = [];

  // IDs & Namen aus Link-HREFs ziehen: /players/12345-...
  const re = /<a[^>]+href="\/players\/(\d+)-[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const id = parseInt(m[1], 10);
    let name = '';
    // Versuch: title/alt/name im Inneren
    name =
      m[2].match(/title="([^"]+)"/)?.[1] ||
      m[2].match(/alt="([^"]+)"/)?.[1] ||
      m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if (id && name) out.push({ id, name });
  }

  // Fallback: eingebettete JSON-Blöcke (__NUXT__/__NEXT_DATA__), falls vorhanden
  if (out.length < 10) {
    const nuxt = html.match(/__NUXT__\s*=\s*(\{[\s\S]+?\});/) || html.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\});/);
    if (nuxt) {
      try {
        const data = JSON.parse(nuxt[1]);
        const s = JSON.stringify(data);
        const r2 = /"id"\s*:\s*(\d+)[\s\S]{0,80}?"name"\s*:\s*"([^"]+)"/g;
        let n; while ((n = r2.exec(s)) && out.length < limit) {
          const id = parseInt(n[1], 10);
          const name = n[2];
          if (id && name && !out.find(x=>x.id===id)) out.push({ id, name });
        }
      } catch {}
    }
  }
  return out;
}

/** Einzelspieler-Detailseite -> Lowest BIN
 * Wir versuchen mehrere Varianten:
 * 1) Objekt lowestBin { ps: N, xbox: N, pc: N }
 * 2) einfacher lowestBin: N
 * 3) "LOWEST BIN" Textumfeld
 */
function parseLowestBin(html, platform='ps') {
  // 1) Objekt lowestBin {...}
  const objMatch = html.match(/"lowestBin"\s*:\s*\{([^}]+)\}/i);
  if (objMatch) {
    const obj = '{' + objMatch[1] + '}';
    try {
      // Keys können "ps", "xbox", "pc" oder ähnlich heißen
      const norm = obj.replace(/([a-zA-Z]+)\s*:/g, '"$1":');
      const o = JSON.parse(norm);
      // Key-Mapping:
      const map = { ps: ['ps','playstation'], xbox: ['xbox','xb'], pc: ['pc','computer'] };
      const keys = map[platform] || [platform];
      for (const k of keys) {
        if (o[k] != null) {
          const num = fmtInt(o[k]);
          if (Number.isFinite(num) && num > 0) return num;
        }
      }
      // notfalls irgendein Wert aus dem Objekt
      for (const k of Object.keys(o)) {
        const num = fmtInt(o[k]);
        if (Number.isFinite(num) && num > 0) return num;
      }
    } catch {}
  }

  // 2) einfacher "lowestBin": 6100
  const simple = html.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (simple) {
    const num = parseInt(simple[1], 10);
    if (Number.isFinite(num) && num>0) return num;
  }

  // 3) Text "LOWEST BIN" im Umfeld
  const text = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (text) {
    const num = fmtInt(text[1]);
    if (Number.isFinite(num) && num>0) return num;
  }

  return null;
}

/** Detail für einen Spieler (id) laden */
async function getPlayerBin(id, platform='ps') {
  const html = await gentleFetch(`https://www.fut.gg/players/${id}/`);
  return parseLowestBin(html, platform);
}

/** Chemstyle-Empfehlung */
function chemFor(pos){
  const p=(pos||'').toUpperCase();
  const atk=/ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p), def=/CB|LB|RB|LWB|RWB|CDM/.test(p);
  if(atk) return 'Hunter / Engine / Finisher';
  if(def) return (p==='CB'||p==='CDM') ? 'Shadow / Anchor' : 'Shadow';
  return p==='GK' ? 'Basic' : 'Basic / Engine';
}

/** OVR aus Name (falls FUT.GG ihn im Titel trägt) */
function tryExtractOVR(name){
  // z. B. "Heung Min Son 88" oder "88 Son"
  const m = String(name).match(/(?:^|\s)(\d{2})(?:\s|$)/);
  return m ? parseInt(m[1],10) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const platform = (q.platform||'ps').toString().toLowerCase(); // ps|xbox|pc
  const size = Math.max(1, Math.min(120, parseInt(q.size||'50',10)));
  const ovrMin = parseInt(q.ovrMin||'0',10);
  const ovrMax = parseInt(q.ovrMax||'99',10);
  const binMin = parseInt(q.binMin||'0',10);
  const binMax = parseInt(q.binMax||'9999999',10);
  const discount = parseFloat(q.discount||'3');

  try{
    // 1) Kandidaten (Popular)
    const popular = await getPopularList(size*2); // mehr holen, weil Filter
    if (!popular.length) {
      return res.status(200).json({ ok:false, error:'FUT.GG Popular leer (Scraper blockiert?)', items:[] });
    }

    const items = [];
    let priceHits = 0;

    for (const cand of popular) {
      if (items.length >= size) break;

      // 2) Preis je Spieler
      let bin = null;
      try { bin = await getPlayerBin(cand.id, platform); } catch {}

      if (!bin || !Number.isFinite(bin) || bin <= 0) continue;
      priceHits++;

      if (bin < binMin || bin > binMax) continue;

      // (OVR kennen wir von FUT.GG hier nicht sicher – wir versuchen es aus dem Namen)
      const ovr = tryExtractOVR(cand.name);
      if (ovr && (ovr < ovrMin || ovr > ovrMax)) continue;

      const buy = roundTo(bin*(1 - discount/100), 100);
      const sell = roundTo((buy + 1000) / 0.95, 100);
      const profit = Math.floor(sell*0.95 - buy);
      if (profit < 500) continue; // Minimalprofit 500 als Basis

      items.push({
        name: cand.name,
        pos: '', // FUT.GG liefert hier nicht zuverlässig, kann leer bleiben
        ovr: ovr || '',
        bin,
        src: 'FUT.GG',
        chem: chemFor(''),
        buy, sell, profit
      });
    }

    // absteigend nach Profit
    items.sort((a,b)=>b.profit-a.profit);

    return res.status(200).json({
      ok:true,
      platform, size,
      priceHits,
      items
    });

  }catch(e){
    return res.status(200).json({ ok:false, error: e.message.slice(0,250), items:[] });
  }
};
