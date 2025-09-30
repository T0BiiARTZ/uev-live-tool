const BASES = [
  'https://api.futdatabase.com/api',
  'https://api.futdatabase.com'
];
const TOKEN = '7a75b1d4-c076-831b-9566-a69a7e72c8c9';

async function req(u){
  try{
    const r = await fetch(u, { headers: { 'Accept':'application/json', 'X-AUTH-TOKEN': TOKEN }});
    const t = await r.text(); let j=null; try{ j=JSON.parse(t);}catch{}
    return { ok:r.ok, status:r.status, j, t };
  }catch(e){ return { ok:false, status:0, t:String(e) }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const { type, playerId, platform='ps' } = req.query || {};

  if(type==='test'){
    for(const b of BASES){
      const r = await req(`${b}/players?limit=1&page=1`);
      if(r.ok && r.j && (r.j.items||r.j.data)) return res.status(200).json({ ok:true, base:b });
      if([401,403].includes(r.status)) return res.status(200).json({ ok:false, base:b, status:r.status, hint:'Key/Plan erlaubt diesen Endpoint nicht' });
    }
    return res.status(200).json({ ok:false, status:520, hint:'Basis nicht erreichbar' });
  }

  if(type==='players'){
    for(const b of BASES){
      const r = await req(`${b}/players?limit=200&page=1`);
      if(r.ok && r.j && (r.j.items||r.j.data)) return res.status(200).json(r.j);
    }
    return res.status(502).json({ error:'players failed' });
  }

  if(type==='price' && playerId){
    for(const b of BASES){
      const paths = [
        `${b}/players/${playerId}/price?platform=${platform}`,
        `${b}/price/${playerId}?platform=${platform}`,
        `${b}/prices/${playerId}?platform=${platform}`
      ];
      for(const u of paths){
        const r = await req(u);
        if(r.ok && r.j && (r.j.lowestBin||r.j.bin||r.j.price)) return res.status(200).json(r.j);
        if([401,403].includes(r.status)) return res.status(200).json({ lowestBin:null, note:'price endpoint not available for this plan' });
      }
    }
    return res.status(200).json({ lowestBin:null });
  }

  return res.status(400).json({ error:'bad request' });
};
