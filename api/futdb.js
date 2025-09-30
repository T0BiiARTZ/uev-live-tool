// api/futdb.js — Proxy für FUTDATABASE (api.futdatabase.com)
const BASES = [
  'https://api.futdatabase.com/api',
  'https://api.futdatabase.com'
];
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9';

async function safeFetch(u) {
  try {
    const r = await fetch(u, { headers: { 'Accept':'application/json', 'X-AUTH-TOKEN': TOKEN } });
    const text = await r.text(); let json=null; try{ json=JSON.parse(text);}catch{}
    return { ok:r.ok, status:r.status, json, text };
  } catch (e) {
    return { ok:false, status:0, json:null, text:String(e) };
  }
}
module.exports = async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { type, playerId, platform='ps' } = req.query || {};

    if (type === 'test') {
      for (const b of BASES) {
        const r = await safeFetch(`${b}/players?limit=1&page=1`);
        if (r.ok && r.json && (r.json.items||r.json.data)) return res.status(200).json({ ok:true, base:b });
        if (r.status===401||r.status===403) return res.status(200).json({ ok:false, base:b, status:r.status, hint:'Key/Plan erlaubt diesen Endpoint nicht' });
        if (r.status) return res.status(200).json({ ok:false, base:b, status:r.status, hint:r.text?.slice(0,200) });
      }
      return res.status(200).json({ ok:false, status:520, hint:'Basis nicht erreichbar' });
    }

    if (type === 'players') {
      for (const b of BASES) {
        const r = await safeFetch(`${b}/players?limit=200&page=1`);
        if (r.ok && r.json && (r.json.items||r.json.data)) return res.status(200).json(r.json);
      }
      return res.status(200).json({ error:'players failed' });
    }

    if (type === 'price' && playerId) {
      for (const b of BASES) {
        const paths = [
          `${b}/players/${playerId}/price?platform=${platform}`,
          `${b}/price/${playerId}?platform=${platform}`,
          `${b}/prices/${playerId}?platform=${platform}`
        ];
        for (const u of paths) {
          const r = await safeFetch(u);
          if (r.ok && r.json && (r.json.lowestBin||r.json.bin||r.json.price)) return res.status(200).json(r.json);
          if (r.status===401||r.status===403) return res.status(200).json({ lowestBin:null, note:'price endpoint not available for this plan' });
        }
      }
      return res.status(200).json({ lowestBin:null });
    }

    return res.status(200).json({ error:'bad request' });
  } catch (e) {
    return res.status(200).json({ ok:false, fatal:String(e) });
  }
};
