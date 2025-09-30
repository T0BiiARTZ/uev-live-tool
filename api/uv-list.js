// pages/api/uv-list.js
// FUT.GG Scraper (Popular + Lowest BIN) — robuste buildId-Erkennung

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (s) => parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10) || 0;
const roundTo = (v, step) => Math.round(v / step) * step;

async function gentleFetch(url) {
  await sleep(100 + Math.floor(Math.random() * 150));
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept":
        "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// ---- BuildID: mehrere Fallbacks ----
async function getBuildId() {
  // 1) Startseite
  const home = await gentleFetch("https://www.fut.gg/");
  let s = typeof home === "string" ? home : JSON.stringify(home);

  // a) klassisch "buildId":"XXXXXXXX"
  let m = s.match(/"buildId"\s*:\s*"([^"]+)"/);
  if (m) return m[1];

  // b) __NEXT_DATA__
  const nextData = s.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\})<\/script>/);
  if (nextData) {
    try {
      const json = JSON.parse(nextData[1]);
      if (json?.buildId) return json.buildId;
    } catch {}
  }

  // c) script src="/_next/static/<BUILDID>/_buildManifest.js"
  let m2 = s.match(/\/_next\/static\/([^"'/]+)\/_buildManifest\.js/);
  if (m2) return m2[1];

  // 2) Players-Listing als Fallback
  const playersHtml = await gentleFetch(
    "https://www.fut.gg/players/?sort=popular"
  );
  const p = typeof playersHtml === "string"
    ? playersHtml
    : JSON.stringify(playersHtml);

  m = p.match(/"buildId"\s*:\s*"([^"]+)"/);
  if (m) return m[1];

  const nextData2 = p.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\})<\/script>/);
  if (nextData2) {
    try {
      const json = JSON.parse(nextData2[1]);
      if (json?.buildId) return json.buildId;
    } catch {}
  }
  m2 = p.match(/\/_next\/static\/([^"'/]+)\/_buildManifest\.js/);
  if (m2) return m2[1];

  throw new Error("FUT.GG buildId not found");
}

// ---- Popular-Liste ----
async function getPopularRaw(buildId, page = 1) {
  const j = await gentleFetch(
    `https://www.fut.gg/_next/data/${buildId}/players.json?sort=popular&page=${page}`
  );
  return JSON.stringify(j);
}

function parsePopularPlayers(s, limit = 120) {
  const out = [];
  // weich, damit wir verschiedene JSON-Formen erwischen
  const re =
    /"id"\s*:\s*(\d+)[\s\S]{0,200}?"name"\s*:\s*"([^"]+)"[\s\S]{0,200}?(?:"overall"\s*:\s*(\d+))?[\s\S]{0,200}?(?:"position"\s*:\s*"([^"]+)")?/g;
  let m;
  while ((m = re.exec(s)) && out.length < limit) {
    const id = parseInt(m[1], 10);
    const name = m[2];
    const ovr = m[3] ? parseInt(m[3], 10) : undefined;
    const pos = m[4] || "";
    if (id && name) out.push({ id, name, ovr, pos });
  }
  return out;
}

// ---- Lowest BIN ----
async function getLowestBinFromJSON(buildId, id, platform = "ps") {
  const j = await gentleFetch(
    `https://www.fut.gg/_next/data/${buildId}/players/${id}.json`
  );
  const s = JSON.stringify(j);

  const objMatch = s.match(/"lowestBin"\s*:\s*\{([^}]+)\}/i);
  if (objMatch) {
    try {
      const raw = "{" + objMatch[1] + "}";
      const normalized = raw.replace(/([a-zA-Z]+)\s*:/g, '"$1":');
      const o = JSON.parse(normalized);
      const map = {
        ps: ["ps", "playstation"],
        xbox: ["xbox", "xb"],
        pc: ["pc", "computer"],
      };
      for (const k of map[platform] || [platform]) {
        if (o[k] != null) {
          const num = fmtInt(o[k]);
          if (num > 0) return num;
        }
      }
      for (const k of Object.keys(o)) {
        const num = fmtInt(o[k]);
        if (num > 0) return num;
      }
    } catch {}
  }

  const simple = s.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (simple) {
    const num = parseInt(simple[1], 10);
    if (num > 0) return num;
  }
  return null;
}

async function getLowestBin(buildId, id, platform = "ps") {
  const jsonBin = await getLowestBinFromJSON(buildId, id, platform);
  if (jsonBin && jsonBin > 0) return jsonBin;

  // Fallback: HTML
  const html = await gentleFetch(`https://www.fut.gg/players/${id}/`);
  const txt = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (txt) {
    const num = fmtInt(txt[1]);
    if (num > 0) return num;
  }
  return null;
}

// ---- Helpers ----
function computeDeal(bin, discountPct) {
  const buy = roundTo(bin * (1 - discountPct / 100), 100);
  const sell = roundTo((buy + 1000) / 0.95, 100);
  const profit = Math.floor(sell * 0.95 - buy);
  return { buy, sell, profit };
}

function guessChem(pos) {
  const p = String(pos || "").toUpperCase();
  const atk = /ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p);
  const def = /CB|LB|RB|LWB|RWB|CDM/.test(p);
  if (atk) return "Hunter / Engine / Finisher";
  if (def) return p === "CB" || p === "CDM" ? "Shadow / Anchor" : "Shadow";
  return p === "GK" ? "Basic" : "Basic / Engine";
}

// ---- Next.js API Route ----
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = req.query || {};
    const platform = (q.platform || "ps").toLowerCase(); // ps|xbox|pc
    const size = Math.max(1, Math.min(120, parseInt(q.size || "50", 10)));
    const ovrMin = parseInt(q.ovrMin || "75", 10);
    const ovrMax = parseInt(q.ovrMax || "90", 10);
    const binMin = parseInt(q.binMin || "1000", 10);
    const binMax = parseInt(q.binMax || "90000", 10);
    const discount = parseFloat(q.discount || "2");

    const buildId = await getBuildId();

    // Popular zwei Seiten laden
    let popularRaw = await getPopularRaw(buildId, 1);
    try {
      popularRaw += await getPopularRaw(buildId, 2);
    } catch {}
    const candidates = parsePopularPlayers(popularRaw, size * 3);
    if (!candidates.length) {
      return res.status(200).json({
        ok: false,
        error: "FUT.GG Popular leer (Scraper blockiert?)",
        items: [],
      });
    }

    const items = [];
    let priceHits = 0;

    for (const cand of candidates) {
      if (items.length >= size) break;
      let bin = null;
      try {
        bin = await getLowestBin(buildId, cand.id, platform);
      } catch {
        bin = null;
      }
      if (!bin || bin <= 0) continue;
      priceHits++;

      if (bin < binMin || bin > binMax) continue;
      if (
        cand.ovr &&
        (cand.ovr < ovrMin || cand.ovr > ovrMax)
      )
        continue;

      const { buy, sell, profit } = computeDeal(bin, discount);
      if (profit < 500) continue;

      items.push({
        name: cand.name,
        pos: cand.pos || "",
        ovr: cand.ovr ?? "",
        bin,
        src: "FUT.GG",
        chem: cand.pos ? guessChem(cand.pos) : "Basic / Engine / Shadow",
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
    return res.status(200).json({
      ok: false,
      error: String(e?.message || e).slice(0, 300),
      items: [],
    });
  }
}
