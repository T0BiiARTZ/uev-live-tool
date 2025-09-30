// api/futdb.js — Serverless-Proxy für FUTDATABASE (Node 18, CommonJS)

const API_BASES = ['https://api.futdatabase.com'];
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9';

async function tryJson(url) {
  try {
    const r = await fetch(url, { headers: { 'X-AUTH-TOKEN': TOKEN } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { playerId, platform = 'ps', type } = req.query || {};

  if (type === 'test') {
    for (const base of API_BASES) {
      const j = await tryJson(base + '/players?limit=1');
      if (j) return res.status(200).json({ ok: true, base });
    }
    return res.status(200).json({ ok: false });
  }

  if (type === 'players') {
    for (const base of API_BASES) {
      const urls = [
        base + '/players?limit=200',
        base + '/api/players?limit=200',
        base + '/fut/players?limit=200',
      ];
      for (const u of urls) {
        const j = await tryJson(u);
        if (j) return res.status(200).json(j);
      }
    }
    return res.status(502).json({ error: 'No players endpoint found' });
  }

  if (type === 'price' && playerId) {
    for (const base of API_BASES) {
      const urls = [
        `${base}/price/${playerId}?platform=${platform}`,
        `${base}/prices/${playerId}?platform=${platform}`,
        `${base}/api/prices?player=${playerId}&platform=${platform}`,
        `${base}/fut/price?player=${playerId}&platform=${platform}`,
      ];
      for (const u of urls) {
        const j = await tryJson(u);
        if (j) return res.status(200).json(j);
      }
    }
    return res.status(502).json({ error: 'No price endpoint found' });
  }

  return res.status(400).json({ error: 'Bad request' });
};
