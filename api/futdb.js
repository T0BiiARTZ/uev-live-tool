// api/futdb.js
// Stabiler Proxy zu FUTDATABASE mit Fallbacks auf verschiedene Routen.
// Nutzt den Key aus ENV FUTDB_API_KEY.
// Unterstützt:
//  - /api/futdb?type=test
//  - /api/futdb?type=players&page=1&limit=200
//  - /api/futdb?type=price&playerId=<ID>&platform=ps|xbox|pc
//  - /api/futdb?type=find&name=<Suchbegriff>&limit=20   (Diagnose/Hilfe)
//  - /api/futdb?type=price-demo&name=<Spieler>&platform=ps  (Diagnose)

const BASES = [
  'https://api.futdatabase.com/api',
  'https://api.futdatabase.com/api/fc',
];

function headersFor(key, useBearer) {
  return useBearer
    ? { 'Accept': 'application/json', 'Authorization': `Bearer ${key}` }
    : { 'Accept': 'application/json', 'X-AUTH-TOKEN': key };
}

async function tryFetchJson(url, key) {
  // erst X-AUTH, dann Bearer probieren
  let r = await fetch(url, { headers: headersFor(key, false) });
  if (r.status === 401 || r.status === 403) {
    r = await fetch(url, { headers: headersFor(key, true) });
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function fdbTry(paths, key) {
  // paths = [ '/players?...', '/fc/players?...' ] – hier bereits mit Querystring
  for (const base of BASES) {
    for (const p of paths) {
      const url = base + p;
      try {
        const j = await tryFetchJson(url, key);
        return { ok: true, base, path: p, json: j };
      } catch {}
    }
  }
  return { ok: false };
}

function normalizePlayersPayload(j) {
  // viele Varianten: items | data | players | result
  const arr =
    j?.items || j?.data || j?.players || j?.result || [];
  return Array.isArray(arr) ? arr : [];
}

function extractPrice(j) {
  // häufig: lowestBin | bin | price | data.lowestBin | data.bin | data.price
  return (
    j?.lowestBin ??
    j?.bin ??
    j?.price ??
    j?.data?.lowestBin ??
    j?.data?.bin ??
    j?.data?.price ??
    null
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.FUTDB_API_KEY || '';
  const type = (req.query.type || '').toString();

  if (!type) return res.status(400).json({ ok:false, error:'missing type' });

  // einfache Testantwort
  if (type === 'test') {
    return res.status(200).json({ ok: !!key, base: BASES[0] });
  }
  if (!key) {
    return res.status(200).json({ ok:false, error:'FUTDB_API_KEY missing in env' });
  }

  try {
    if (type === 'players') {
      const page = parseInt(req.query.page || '1', 10);
      const limit = parseInt(req.query.limit || '200', 10);

      const attempt = await fdbTry([
        `/players?page=${page}&limit=${limit}`,
        `/fc/players?page=${page}&limit=${limit}`,
      ], key);

      if (!attempt.ok) return res.status(200).json({ ok:false, items:[] });

      const items = normalizePlayersPayload(attempt.json);
      return res.status(200).json({ ok:true, baseTried: attempt.base, items });
    }

    if (type === 'find') { // Diagnose: Spieler per Name suchen
      const name = (req.query.name || '').toString();
      const limit = parseInt(req.query.limit || '20', 10);
      if (!name) return res.status(400).json({ ok:false, error:'missing name' });

      const q = encodeURIComponent(name);
      const attempt = await fdbTry([
        `/players?search=${q}&limit=${limit}`,
        `/fc/players?search=${q}&limit=${limit}`,
        `/search/players?name=${q}&limit=${limit}`,
        `/fc/search/players?name=${q}&limit=${limit}`,
      ], key);

      if (!attempt.ok) return res.status(200).json({ ok:false, items:[] });

      const items = normalizePlayersPayload(attempt.json);
      return res.status(200).json({ ok:true, baseTried: attempt.base, items });
    }

    if (type === 'price') {
      const id = req.query.playerId;
      const platform = (req.query.platform || 'ps').toString().toLowerCase();
      if (!id) return res.status(400).json({ ok:false, error:'missing playerId' });

      // alle bekannten Preis-Routen probieren
      const attempt = await fdbTry([
        `/players/${id}/price?platform=${platform}`,
        `/players/${id}/prices?platform=${platform}`,
        `/prices/${platform}/${id}`,
        `/fc/players/${id}/price?platform=${platform}`,
        `/fc/players/${id}/prices?platform=${platform}`,
        `/fc/prices/${platform}/${id}`,
      ], key);

      if (!attempt.ok) return res.status(200).json({ ok:true, lowestBin:null, tried:true });

      const price = extractPrice(attempt.json);
      return res.status(200).json({
        ok:true,
        lowestBin: price ?? null,
        used: { base: attempt.base, path: attempt.path }
      });
    }

    if (type === 'price-demo') { // Diagnose: Name -> ID -> Preis
      const name = (req.query.name || '').toString();
      const platform = (req.query.platform || 'ps').toString().toLowerCase();
      if (!name) return res.status(400).json({ ok:false, error:'missing name' });

      const q = encodeURIComponent(name);
      const find = await fdbTry([
        `/players?search=${q}&limit=10`,
        `/fc/players?search=${q}&limit=10`,
        `/search/players?name=${q}&limit=10`,
        `/fc/search/players?name=${q}&limit=10`,
      ], key);

      if (!find.ok) return res.status(200).json({ ok:false, step:'find', items:[] });

      const items = normalizePlayersPayload(find.json);
      if (!items.length) return res.status(200).json({ ok:false, step:'find', items:[] });

      const id = items[0]?.id || items[0]?.playerId || items[0]?._id;
      if (!id) return res.status(200).json({ ok:false, step:'id-missing', items });

      const attempt = await fdbTry([
        `/players/${id}/price?platform=${platform}`,
        `/players/${id}/prices?platform=${platform}`,
        `/prices/${platform}/${id}`,
        `/fc/players/${id}/price?platform=${platform}`,
        `/fc/players/${id}/prices?platform=${platform}`,
        `/fc/prices/${platform}/${id}`,
      ], key);

      const price = attempt.ok ? extractPrice(attempt.json) : null;

      return res.status(200).json({
        ok: !!price,
        name,
        id,
        platform,
        price: price ?? null,
        routesOk: attempt.ok,
        used: attempt.ok ? { base: attempt.base, path: attempt.path } : null,
        foundOn: find.base,
      });
    }

    return res.status(400).json({ ok:false, error:'unknown type' });
  } catch (e) {
    return res.status(200).json({ ok:false, error: e.message.slice(0,200) });
  }
};
