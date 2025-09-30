// api/price-scrape.js — serverseitiges Scraping von FUT.GG
// Nutzung: /api/price-scrape?name=<Spielername>&platform=ps|xbox|pc
// Antwort: { bin: <Number> } oder { bin: null, note: '...' }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function toCoins(s) {
  if (!s) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html',
      },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    return null;
  }
}

/** Sehr gezielt den aktuellen "LOWEST BIN" aus dem Info-Panel ziehen */
function parseLowestBin(html) {
  if (!html) return null;

  // 1) Block um "LOWEST BIN" suchen und dort die ERSTE Zahl nehmen (das ist der aktuelle Wert)
  let block = html.match(/LOWEST\s*BIN[\s\S]{0,240}/i);
  if (block) {
    const m = block[0].match(/(\d{1,3}(?:[.,]\d{3})+)/);
    if (m) return toCoins(m[1]); // z.B. "6,100" -> 6100
  }

  // 2) JSON-Varianten, falls vorhanden
  let m = html.match(/"lowest(?:Price|_bin|Bin)"\s*:\s*(\d+)/i);
  if (m) return toCoins(m[1]);

  // 3) Weitere Fallbacks (vorsichtig, um keine Historienzahlen zu erwischen)
  m = html.match(/Buy\s*Now[^0-9]{0,40}(\d{1,3}(?:[.,]\d{3})+)/i);
  if (m) return toCoins(m[1]);

  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const name = (req.query?.name || '').trim();
  if (!name) return res.status(200).json({ bin: null, note: 'missing name' });

  // 1) Suche auf FUT.GG
  const q = encodeURIComponent(name);
  const searchUrl = `https://www.fut.gg/players/?name=${q}`;
  const searchHtml = await fetchText(searchUrl);
  if (!searchHtml) return res.status(200).json({ bin: null, note: 'search failed' });

  // Ersten Spieler-Link holen
  const m = searchHtml.match(/href="\/players\/(\d+)[^"]*"/i);
  if (!m) return res.status(200).json({ bin: null, note: 'no result' });

  // 2) Detailseite laden und aktuellen LOWEST BIN parsen
  const playerUrl = `https://www.fut.gg/players/${m[1]}/`;
  const pageHtml = await fetchText(playerUrl);
  const bin = parseLowestBin(pageHtml);

  return res.status(200).json({ bin: bin ?? null });
};
