// api/futdb.js — Proxy für FUTDB (futdb.app)
const API_BASE = 'https://futdb.app/api';
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9'; // dein Key

async function call(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        // beide Header senden, weil manche Dokus/Pläne unterschiedliche Namen nutzen
        'X-AUTH-TOKEN': TOKEN,
        'X-AUTH-KEY':   TOKEN,
      }
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok:false, status:0, text:String(e) };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, playerId, platform='ps' } = req.query || {};

  // TEST: zeigt uns Status & ggf. Fehltext
  if (type === 'test') {
    const r = await call(`${API_BASE}/players?page=1&limit=1`);
    return res.status(200).json({ ok: !!(r.ok && r.json && r.json.items), status: r.status, base: API_BASE, hint: r.text?.slice(0,120) });
  }

  if (type === 'players') {
    const r = await call(`${API_BASE}/players?page=1&limit=200`);
    if (r.ok && r.json && r.json.items) return res.status(200).json(r.json);
    return res.status(502).json({ error: 'players failed', status: r.status, hint: r.text?.slice(0,200) });
  }

  if (type === 'price' && playerId) {
    const paths = [
      `${API_BASE}/players/${playerId}/price?platform=${platform}`,
      `${API_BASE}/price/${playerId}?platform=${platform}`,
      `${API_BASE}/prices/${playerId}?platform=${platform}`,
    ];
    for (const u of paths) {
      const r = await call(u);
      if (r.ok && r.json && (r.json.lowestBin || r.json.bin || r.json.price)) {
        return res.status(200).json(r.json);
      }
    }
    return res.status(200).json({ lowestBin: null });
  }

  return res.status(400).json({ error: 'bad request' });
};
