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

// Robust: versuche mehrere HTML/JSON-Varianten von FUT.GG
function parseLowestBin(html) {
  if (!html) return null;

  // 1) Expliziter Text "Lowest BIN"
  let m = html.match(/Lowest\s*BIN[^0-9]{0,40}(\d{1,3}(?:[.,]\d{3})+)/i);
  if (m) return toCoins(m[1]);

  // 2) JSON-Snippets, die oft im HTML eingebettet sind
  m = html.match(/"lowest(?:Price|_bin)"\s*:\s*(\d+)/i);
  if (m) return toCoins(m[1]);

  m = html.match(/"lowestBin"\s*:\s*(\d+)/i);
  if (m) return toCoins(m[1]);

  // 3) „BIN … 5,700“ in diversen Boxen
  m = html.match(/BIN[^0-9]{0,40}(\d{1,3}(?:[.,]\d{3})+)/i);
  if (m) return toCoins(m[1]);

  // 4) „Buy Now … 5,700“
  m = html.match(/Buy\s*Now[^0-9]{0,40}(\d{1,3}(?:[.,]\d{3})+)/i);
  if (m) return toCoins(m[1]);

  // 5) Datensätze mit data-Attributen
  m = html.match(/data-(?:lowest|bin|price)=\"?(\d{3,7})\"?/i);
  if (m) return toCoins(m[1]);

  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const name = (req.query?.name || '').trim();
  const platform = (req.query?.platform || 'ps').toLowerCase();
  if (!name) return res.status(200).json({ bin: null, note: 'missing name' });

  // 1) Spielersuche
  const q = encodeURIComponent(name);
  const searchUrl = `https://www.fut.gg/players/?name=${q}`;
  const searchHtml = await fetchText(searchUrl);
  if (!searchHtml) return res.status(200).json({ bin: null, note: 'search failed' });

  // Erster Treffer-Link: /players/<id>-...
  const m = searchHtml.match(/href="\/players\/(\d+)[^"]*"/i);
  if (!m) return res.status(200).json({ bin: null, note: 'no result' });

  // 2) Spieler-Seite laden
  const playerUrl = `https://www.fut.gg/players/${m[1]}/`;
  const pageHtml = await fetchText(playerUrl);
  if (!pageHtml) return res.status(200).json({ bin: null, note: 'player page failed' });

  // 3) BIN parsen
  const bin = parseLowestBin(pageHtml);

  // Optional: falls FUT.GG künftig plattformspezifische BINs anzeigt,
  // könntest du hier je nach "platform" differenzieren. Aktuell wird
  // meist ein generischer Lowest BIN angezeigt.
  return res.status(200).json({ bin: bin ?? null });
};
