// pages/api/uv-list.js
// HTML-only FUT.GG Scraper (+ Fallback auf thecoinprinter trading-list)
// Endung: .js

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (s) => parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10) || 0;
const roundTo = (v, step) => Math.round(v / step) * step;

async function gentleFetch(url, extraHeaders = {}) {
  await sleep(120 + Math.floor(Math.random() * 160));
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...extraHeaders,
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.text();
}

/* ---------- FUT.GG (HTML-only) ---------- */

async function getPopularFutgg(limit = 60) {
  const out = [];
  let page = 1;
  while (out.length < limit && page <= 3) {
    const html = await gentleFetch(
      `https://www.fut.gg/players/?sort=popular&page=${page}`
    );

    // Spieler-Links /players/12345-... , Name aus title/alt/innerText
    const re = /<a[^>]+href="\/players\/(\d+)-[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      const id = parseInt(m[1], 10);
      let name =
        m[2].match(/title="([^"]+)"/)?.[1] ||
        m[2].match(/alt="([^"]+)"/)?.[1] ||
        m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (id && name) out.push({ id, name });
    }

    // Fallback: eingebettetes JSON (falls vorhanden)
    if (out.length < 10) {
      const nuxt =
        html.match(/__NUXT__\s*=\s*(\{[\s\S]+?\});/) ||
        html.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\});/);
      if (nuxt) {
        try {
          const data = JSON.parse(nuxt[1]);
          const s = JSON.stringify(data);
          const r2 =
            /"id"\s*:\s*(\d+)[\s\S]{0,120}?"name"\s*:\s*"([^"]+)"/g;
          let n;
          while ((n = r2.exec(s)) && out.length < limit) {
            const id = parseInt(n[1], 10);
            const name = n[2];
            if (id && name && !out.find((x) => x.id === id))
              out.push({ id, name });
          }
        } catch {}
      }
    }

    page++;
  }
  return out.slice(0, limit);
}

async function getFutggBin(id, platform = "ps") {
  const html = await gentleFetch(`https://www.fut.gg/players/${id}/`);

  // 1) Objekt lowestBin: {"ps":12345,"xbox":...}
  const objMatch = html.match(/"lowestBin"\s*:\s*\{([^}]+)\}/i);
  if (objMatch) {
    try {
      const normalized = ("{" + objMatch[1] + "}").replace(
        /([a-zA-Z]+)\s*:/g,
        '"$1":'
      );
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
      // irgendein Wert
      for (const k of Object.keys(o)) {
        const num = fmtInt(o[k]);
        if (num > 0) return num;
      }
    } catch {}
  }

  // 2) "lowestBin": 6100
  const simple = html.match(/"lowestBin"\s*:\s*([0-9]+)/i);
  if (simple) {
    const num = parseInt(simple[1], 10);
    if (num > 0) return num;
  }

  // 3) Text "LOWEST BIN ... 12,500"
  const text = html.match(/LOWEST\s*BIN[\s\S]{0,300}?([0-9][\d\., ]+)/i);
  if (text) {
    const num = fmtInt(text[1]);
    if (num > 0) return num;
  }
  return null;
}

/* ---------- thecoinprinter Fallback ---------- */

async function getFromCoinPrinter(platform = "ps", maxItems = 60) {
  // deren öffentlich sichtbare API; kann rate-limit sein
  const url = "https://futp-api-vhnwl.ondigitalocean.app/api/v1/players/trading-list";
  const txt = await gentleFetch(url, {
    Accept: "application/json, text/plain, */*",
  });

  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    return [];
  }

  // Versuche generisch zu mappen
  const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const out = [];

  for (const it of arr) {
    const name =
      it.name ||
      it.player_name ||
      it.fullName ||
      it.card_name ||
      it.title ||
      "";
    if (!name) continue;

    // Preisfelder erraten
    const priceCandidates = [
      it.bin,
      it.lowestBin,
      it.price,
      it.prices?.[platform],
      it.prices?.ps,
      it.ps,
      it.playstation,
      it.xbox,
      it.pc,
    ];
    let bin = 0;
    for (const p of priceCandidates) {
      const v = fmtInt(p);
      if (v > 0) {
        bin = v;
        break;
      }
    }
    if (bin <= 0) continue;

    out.push({
      name,
      pos: it.pos || it.position || "",
      ovr: it.ovr || it.overall || "",
      bin,
      src: "COINPRINTER",
      chem: "",
    });

    if (out.length >= maxItems) break;
  }

  return out;
}

/* ---------- Helpers ---------- */

function guessOVR(name) {
  const m = String(name).match(/(?:^|\s)(\d{2})(?:\s|$)/);
  return m ? parseInt(m[1], 10) : null;
}

function guessChem(pos) {
  const p = String(pos || "").toUpperCase();
  const atk = /ST|CF|LW|RW|LM|RM|CAM|CM|RF|LF/.test(p);
  const def = /CB|LB|RB|LWB|RWB|CDM/.test(p);
  if (atk) return "Hunter / Engine / Finisher";
  if (def) return p === "CB" || p === "CDM" ? "Shadow / Anchor" : "Shadow";
  return p === "GK" ? "Basic" : "Basic / Engine";
}

function computeDeal(bin, discountPct) {
  const buy = roundTo(bin * (1 - discountPct / 100), 100);
  const sell = roundTo((buy + 1000) / 0.95, 100);
  const profit = Math.floor(sell * 0.95 - buy);
  return { buy, sell, profit };
}

/* ---------- API Handler ---------- */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = req.query || {};
    const platform = (q.platform || "ps").toLowerCase(); // ps|xbox|pc
    const size = Math.max(1, Math.min(120, parseInt(q.size || "50", 10)));
    const ovrMin = parseInt(q.ovrMin || "78", 10);
    const ovrMax = parseInt(q.ovrMax || "88", 10);
    const binMin = parseInt(q.binMin || "1500", 10);
    const binMax = parseInt(q.binMax || "60000", 10);
    const discount = parseFloat(q.discount || "3");

    let items = [];
    let source = "FUT.GG";

    /* 1) FUT.GG direkt */
    try {
      const candidates = await getPopularFutgg(size * 3);
      for (const c of candidates) {
        if (items.length >= size) break;
        let bin = null;
        try {
          bin = await getFutggBin(c.id, platform);
        } catch {}
        if (!bin || bin < binMin || bin > binMax) continue;

        const ovr = guessOVR(c.name);
        if (ovr && (ovr < ovrMin || ovr > ovrMax)) continue;

        const { buy, sell, profit } = computeDeal(bin, discount);
        if (profit < 500) continue;

        items.push({
          name: c.name,
          pos: "",
          ovr: ovr || "",
          bin,
          src: "FUT.GG",
          chem: guessChem(""),
          buy,
          sell,
          profit,
        });
      }
    } catch (e) {
      // still try fallback
    }

    /* 2) Fallback thecoinprinter */
    if (items.length === 0) {
      const cp = await getFromCoinPrinter(platform, size * 2);
      const collected = [];
      for (const it of cp) {
        if (it.bin < binMin || it.bin > binMax) continue;

        const ovr =
          it.ovr || it.overall || guessOVR(it.name) || "";
        if (ovr && (parseInt(ovr, 10) < ovrMin || parseInt(ovr, 10) > ovrMax))
          continue;

        const { buy, sell, profit } = computeDeal(it.bin, discount);
        if (profit < 500) continue;

        collected.push({
          name: it.name,
          pos: it.pos || "",
          ovr,
          bin: it.bin,
          src: "COINPRINTER",
          chem: guessChem(it.pos),
          buy,
          sell,
          profit,
        });

        if (collected.length >= size) break;
      }
      items = collected;
      source = "COINPRINTER";
    }

    items.sort((a, b) => b.profit - a.profit);

    return res.status(200).json({
      ok: true,
      source,
      platform,
      size,
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
