// api/futdb.js — Serverless-Proxy für FUTDB (futdb.app)
const API_BASE = 'https://futdb.app/api';
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9'; // funktioniert sofort; später gern als Env-Var

async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { 'X-AUTH-TOKEN': TOKEN } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, playerId, platform = 'ps' } = req.query || {};

  // 1) einfacher Reachability-Check
  if (type === 'test') {
    const j = await getJson(`${API_BASE}/players?page=1&limit=1`);
    return res.status(200).json({ ok: !!(j && j.items), base: API_BASE });
  }

  // 2) Spielerlist (liefert items[])
  if (type === 'players') {
    // Hole viele Spieler (mehrere Seiten falls nötig)
    const j = await getJson(`${API_BASE}/players?page=1&limit=200`);
    if (j && j.items) return res.status(200).json(j);
    return res.status(502).json({ error: 'players endpoint failed' });
  }

  // 3) Preise (FUTDB hat je nach Plan/Version unterschiedliche Pfade; wir probieren Varianten)
  if (type === 'price' && playerId) {
    const tryPaths = [
      `${API_BASE}/players/${playerId}/price?platform=${platform}`,
      `${API_BASE}/price/${playerId}?platform=${platform}`,
      `${API_BASE}/prices/${playerId}?platform=${platform}`
    ];
    for (const u of tryPaths) {
      const j = await getJson(u);
      if (j && (j.lowestBin || j.bin || j.price)) return res.status(200).json(j);
    }
    // Kein Preis gefunden -> leere, aber gültige Antwort zurückgeben
    return res.status(200).json({ lowestBin: null });
  }

  return res.status(400).json({ error: 'bad request' });
};
