// pages/api/uv-list.js
// FUT.GG Scraper-Only (Popular Players + Lowest BIN)
// Vollständig in JavaScript für Next.js (Pages Router)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (s) =>
  parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10) || 0;
const roundTo = (v, step) => Math.round(v / step) * step;

async function gentleFetch(url) {
  await sleep(80 + Math.floor(Math.random() * 120));
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,text/html,*/*" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// buildId aus Startseite FUT.GG
async function getBuildId() {
  const html = await gentleFetch("https://www.fut.gg/");
  const s = typeof html === "string" ? html : JSON.stringify(html);

  // alte Methode
  let m = s.match(/"buildId"\s*:\s*"([^"]+)"/);
  if (m) return m[1];

  // neue Next.js Struktur: __NEXT_DATA__
  const nextData = s.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\})<\/script>/);
  if (nextData) {
    try {
      const json = JSON.parse(nextData[1]);
      if (json?.buildId) return json.buildId;
    } catch {}
  }

  throw new Error("FUT.GG buildId not found");
}

// Popular-Players JSON
async function getPopularRaw(buildId, page = 1) {
  const j = await gentleFetch(
    `https://www.fut.gg/_next/data/${buildId}/players.json?sort=popular&page=${page}`
  );
  return JSON.stringify(j);
}

function parsePopularPlayers(s, limit = 120) {
  const out = [];
  const re =
    /"id"\s*:\s*(\d+)[\s\S]{0,140}?"name"\s*:\s*"([^"]+)"[\s\S]{0,140}?"overall"\s*:\s*(\d+)?[\s\S]{0,140}?"position"\s*:\s*"([^"]+)?"/g;
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

async function getLowestBinFromJSON(buildId, id, platform = "ps") {
  const j = await gentleFetch(
    `https://www.fut.gg/_next/data/${buildId}/players/${id}.json`
  );
  const s = JSON.stringify(j);

  // Objekt lowestBin:{ps:...,xbox:...,pc:...}
  const objMatch = s.match(/"lowestBin"\s*:\s*\{([^}]+)\}/i);
  if (objMatch) {
    const raw = "{" + objMatch[1] + "}";
    try {
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
  let bin = await getLowestBinFromJSON(buildId, id, platform);
  if (bin && bin > 0) return bin;

  const html = await gentleFetch(`https://www.fut.gg/players/${id}/`);
  const text = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (text) {
    const num = fmtInt(text[1]);
    if (num > 0) return num;
  }
  return null;
}

function computeDeal(bin, discountPct) {
  const buy = roundTo(bin * (1 - discountPct / 100), 100);
  const sell = roundTo((buy + 1000) / 0.95, 100);
  const profit = Math.floor(sell * 0.95 - buy);
  return { buy, sell, profit };
}

// Next.js API Route
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  try {
    const q = req.query || {};
    const platform = (q.platform || "ps").toLowerCase();
    const size = Math.max(1, Math.min(120, parseInt(q.size || "50", 10)));
    const ovrMin = parseInt(q.ovrMin || "75", 10);
    const ovrMax = parseInt(q.ovrMax || "90", 10);
    const binMin = parseInt(q.binMin || "1000", 10);
    const binMax = parseInt(q.binMax || "90000", 10);
    const discount = parseFloat(q.discount || "2");

    const buildId = await getBuildId();

    let popularRaw = await getPopularRaw(buildId, 1);
    try {
      popularRaw += await getPopularRaw(buildId, 2);
    } catch {}

    const candidates = parsePopularPlayers(popularRaw, size * 2);
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
      const ovrOk =
        !cand.ovr || (cand.ovr >= ovrMin && cand.ovr <= ovrMax);
      if (!ovrOk) continue;

      const { buy, sell, profit } = computeDeal(bin, discount);
      if (profit < 500) continue;

      items.push({
        name: cand.name,
        pos: cand.pos || "",
        ovr: cand.ovr ?? "",
        bin,
        src: "FUT.GG",
        chem: cand.pos
          ? guessChem(cand.pos)
          : "Basic / Engine / Shadow",
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

function guessChem(pos) {
  const p = pos.toUpperCase();
  const atk = /ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p);
  const def = /CB|LB|RB|LWB|RWB|CDM/.test(p);
  if (atk) return "Hunter / Engine / Finisher";
  if (def) return p === "CB" || p === "CDM" ? "Shadow / Anchor" : "Shadow";
  return p === "GK" ? "Basic" : "Basic / Engine";
}
