// api/futdb.js — Proxy für FUTDATABASE (api.futdatabase.com)
const BASES = [
  'https://api.futdatabase.com/api', // Hauptbasis
  'https://api.futdatabase.com'      // Fallback
];
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9'; // dein Key

async function req(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-AUTH-TOKEN': TOKEN
      }
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
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

  // ---- 1) API-Test ---------------------------------------------------------
  if (type === 'test') {
    for (const b of BASES) {
      const r = await req(`${b}/players?limit=1&page=1`);
      if (r.ok && r.json && (r.json.items || r.json.data)) {
        return res.status(200).json({ ok:true, base:b });
      }
      // wenn 401/403 -> Key/Plan reicht nicht, aber Basis stimmt
      if ([401,403].includes(r.status)) {
        return res.status(200).json({ ok:false, base:b, status:r.status, hint:'Key/Plan erlaubt diesen Endpoint nicht' });
      }
    }
    return res.status(200).json({ ok:false, status:520, hint:'Basis nicht erreichbar' });
  }

  // ---- 2) Spielerliste ------------------------------------------------------
  if (type === 'players') {
    for (const b of BASES) {
      const urls = [
        `${b}/players?limit=200&page=1`,
        `${b}/api/players?limit=200&page=1` // extra Fallback
      ];
      for (const u of urls) {
        const r = await req(u);
        if (r.ok && r.json && (r.json.items || r.json.data)) {
          return res.status(200).json(r.json);
        }
      }
    }
    return res.status(502).json({ error:'players failed' });
  }

  // ---- 3) Preise (nur wenn dein Plan das darf) -----------------------------
  if (type === 'price' && playerId) {
    for (const b of BASES) {
      const urls = [
        `${b}/players/${playerId}/price?platform=${platform}`,
        `${b}/price/${playerId}?platform=${platform}`,
        `${b}/prices/${playerId}?platform=${platform}`
      ];
      for (const u of urls) {
        const r = await req(u);
        if (r.ok && r.json && (r.json.lowestBin || r.json.bin || r.json.price)) {
          return res.status(200).json(r.json);
        }
        if ([401,403].includes(r.status)) {
          // Kein Preiszugriff im aktuellen Plan: gib leeres Preisfeld zurück
          return res.status(200).json({ lowestBin: null, note: 'price endpoint not available for this plan' });
        }
      }
    }
    return res.status(200).json({ lowestBin: null });
  }

  return res.status(400).json({ error:'bad request' });
};
