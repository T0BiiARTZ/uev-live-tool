// /pages/api/uv-list.js
// Scraper-only Variante: FUT.GG (Trending + Player) und FUTBIN (Popular + Player)
// Keine externen Abhängigkeiten. Nur fetch + Regex.
// Plattformen: ps | xbox | pc
// Test-Endpoint: /api/uv-list?mode=status

const UA =
  process.env.FUT_SCRAPER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (s) => {
  const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const roundTo = (v, step) => Math.round(v / step) * step;

// kleine Drosselung + UA
async function gentleFetch(url) {
  await sleep(80 + Math.floor(Math.random() * 120));
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.text();
}

/* ------------------------------------------------
   1) Kandidaten-Quellen
--------------------------------------------------*/

// FUT.GG Trending -> [{id, name}]
async function getFutggTrending(limit = 80) {
  const html = await gentleFetch("https://www.fut.gg/players/trending/");
  const out = [];
  // Links wie /players/12345-... + Name im Inneren
  const re = /<a[^>]+href="\/players\/(\d+)-[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const id = parseInt(m[1], 10);
    let name =
      (m[2].match(/title="([^"]+)"/) || [])[1] ||
      (m[2].match(/alt="([^"]+)"/) || [])[1] ||
      m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (id && name) out.push({ id, name, src: "FUT.GG" });
  }
  return out;
}

// FUTBIN Popular -> [{id, name}]
async function getFutbinPopular(limit = 80) {
  const html = await gentleFetch("https://www.futbin.com/popular");
  const out = [];
  // FUTBIN Links sind oft /26/player/230566/... -> nimm die /player/{id}
  const re = /href="\/(?:\d+\/)?player\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const id = parseInt(m[1], 10);
    let name = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (id && name) out.push({ id, name, src: "FUTBIN" });
  }
  return out;
}

/* ------------------------------------------------
   2) Detailseiten -> Lowest BIN
--------------------------------------------------*/

// FUT.GG Playerseite: versucht mehrere Varianten (lowestBin-JSON, einfacher Wert, Text)
function parseFutggLowestBin(html, platform = "ps") {
  // 1) JSON-Objekt: "lowestBin": { ps: N, xbox: N, pc: N }
  const m1 = html.match(/"lowestBin"\s*:\s*\{([^}]+)\}/i);
  if (m1) {
    try {
      const norm = "{" + m1[1].replace(/([a-zA-Z]+)\s*:/g, '"$1":') + "}";
      const o = JSON.parse(norm);
      const keyMap = { ps: ["ps", "playstation"], xbox: ["xbox", "xb"], pc: ["pc", "computer"] };
      for (const k of keyMap[platform] || [platform]) {
        if (o[k] != null) {
          const num = fmtInt(o[k]);
          if (num) return num;
        }
      }
      // sonst irgendein Wert
      for (const k of Object.keys(o)) {
        const num = fmtInt(o[k]);
        if (num) return num;
      }
    } catch {}
  }
  // 2) Einfach: "lowestBin": 6100
  const m2 = html.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (n > 0) return n;
  }
  // 3) Text: "LOWEST BIN" in Nähe der Zahl
  const m3 = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (m3) {
    const n = fmtInt(m3[1]);
    if (n) return n;
  }
  return null;
}

async function getFutggPlayerBin(id, platform = "ps") {
  const html = await gentleFetch(`https://www.fut.gg/players/${id}/`);
  return parseFutggLowestBin(html, platform);
}

// FUTBIN Playerseite: heuristisch nach „LC Price“ / „Lowest BIN“ / JSON
function parseFutbinLowestBin(html, platform = "ps") {
  // 1) Diverse "LC Price" / "LOWEST BIN" Texte
  //    Wir nehmen die zuerst vorkommende Zahl in den nächsten ~300 Zeichen
  const platMap = { ps: "PlayStation", xbox: "Xbox", pc: "PC" };
  const pName = platMap[platform] || "PlayStation";

  // platform-spezifische Boxen enthalten häufig den Namen der Plattform drumherum
  const near = new RegExp(
    `${pName}[\\s\\S]{0,400}?(?:LC\\s*Price|LOWEST\\s*BIN|Lowest\\s*BIN|BIN|Price)[^0-9]{0,40}([0-9][\\d\\., ]+)`,
    "i"
  );
  const mNear = html.match(near);
  if (mNear) {
    const n = fmtInt(mNear[1]);
    if (n) return n;
  }

  // 2) Generisch: „LC Price“ irgendwo
  const mLC = html.match(/LC\s*Price[^0-9]{0,40}([0-9][\d\., ]+)/i);
  if (mLC) {
    const n = fmtInt(mLC[1]);
    if (n) return n;
  }

  // 3) Seltener: inline JSON-Schnipsel mit „lowest“ / „LCPrice“
  const mJSON = html.match(/"LCPrice"\s*:\s*([0-9]+)/i) || html.match(/"lowest"\s*:\s*([0-9]+)/i);
  if (mJSON) {
    const n = parseInt(mJSON[1], 10);
    if (n > 0) return n;
  }

  return null;
}

async function getFutbinPlayerBin(id, platform = "ps") {
  // FUTBIN v26 Spielzeitraum
  const html = await gentleFetch(`https://www.futbin.com/26/player/${id}`);
  return parseFutbinLowestBin(html, platform);
}

/* ------------------------------------------------
   3) Hilfsfunktionen (Chemstyle, OVR aus Name)
--------------------------------------------------*/

function chemFor(pos) {
  const p = (pos || "").toUpperCase();
  const atk = /ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p);
  const def = /CB|LB|RB|LWB|RWB|CDM/.test(p);
  if (atk) return "Hunter / Engine / Finisher";
  if (def) return p === "CB" || p === "CDM" ? "Shadow / Anchor" : "Shadow";
  return p === "GK" ? "Basic" : "Basic / Engine";
}

// Fallback-OVR aus Namen, falls FUT.GG/FUTBIN es nicht mitliefert
function tryExtractOVR(name) {
  const m = String(name).match(/(?:^|\s)(\d{2})(?:\s|$)/);
  return m ? parseInt(m[1], 10) : null;
}

/* ------------------------------------------------
   4) Haupt-Handler
--------------------------------------------------*/

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query || {};
  const platform = String(q.platform || "ps").toLowerCase(); // ps|xbox|pc
  const size = Math.max(1, Math.min(120, parseInt(q.size || "50", 10)));
  const ovrMin = parseInt(q.ovrMin || "0", 10);
  const ovrMax = parseInt(q.ovrMax || "99", 10);
  const binMin = parseInt(q.binMin || "0", 10);
  const binMax = parseInt(q.binMax || "9999999", 10);
  const discount = parseFloat(q.discount || "3"); // Abschlag %

  // API testen?
  if (q.mode === "status") {
    try {
      const [gg, fb] = await Promise.allSettled([getFutggTrending(10), getFutbinPopular(10)]);
      return res.status(200).json({
        ok: true,
        FUTGG: gg.status === "fulfilled" ? { ok: true, items: gg.value.length } : { ok: false, error: String(gg.reason) },
        FUTBIN: fb.status === "fulfilled" ? { ok: true, items: fb.value.length } : { ok: false, error: String(fb.reason) },
      });
    } catch (e) {
      return res.status(200).json({ ok: false, error: String(e).slice(0, 300) });
    }
  }

  try {
    // 1) Kandidaten holen (ein Mix aus beiden Quellen, doppelte rausfiltern)
    const [gg, fb] = await Promise.allSettled([getFutggTrending(size), getFutbinPopular(size)]);
    const bag = [];
    const add = (it) => {
      for (const x of it) if (x && x.id && !bag.find((y) => y.id === x.id)) bag.push(x);
    };
    if (gg.status === "fulfilled") add(gg.value);
    if (fb.status === "fulfilled") add(fb.value);

    if (!bag.length) {
      return res
        .status(200)
        .json({ ok: false, error: "Trending/Popular leer (Scraper blockiert?)", items: [] });
    }

    const items = [];
    let priceHits = 0;

    // 2) Je Kandidat Preis holen (erst FUTBIN, dann FUT.GG – oft liefert einer von beiden)
    for (const cand of bag) {
      if (items.length >= size) break;

      let bin = null;
      try {
        if (cand.src === "FUTBIN") {
          bin = await getFutbinPlayerBin(cand.id, platform);
          if (!bin) bin = await getFutggPlayerBin(cand.id, platform);
        } else {
          bin = await getFutggPlayerBin(cand.id, platform);
          if (!bin) bin = await getFutbinPlayerBin(cand.id, platform);
        }
      } catch {
        bin = null;
      }

      if (!bin || !Number.isFinite(bin) || bin <= 0) continue;
      priceHits++;

      if (bin < binMin || bin > binMax) continue;

      // OVR nur „best effort“
      const ovr = tryExtractOVR(cand.name);
      if (ovr && (ovr < ovrMin || ovr > ovrMax)) continue;

      const buy = roundTo(bin * (1 - discount / 100), 100);
      const sell = roundTo((buy + 1000) / 0.95, 100);
      const profit = Math.floor(sell * 0.95 - buy);
      if (profit < 500) continue;

      items.push({
        name: cand.name,
        pos: "",
        ovr: ovr || "",
        bin,
        src: cand.src,
        chem: chemFor(""),
        buy,
        sell,
        profit,
      });
    }

    items.sort((a, b) => b.profit - a.profit);

    return res.status(200).json({
      ok: true,
      platform,
      size,
      priceHits,
      items,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e).slice(0, 300), items: [] });
  }
}
