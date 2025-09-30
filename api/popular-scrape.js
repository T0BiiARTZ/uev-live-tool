// api/popular-scrape.js — Beliebte/oft genutzte Spieler von FUT.GG scrapen
// /api/popular-scrape?limit=60  ->  { items: [{ name, ovr? }] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url){
  try{
    const r = await fetch(url,{ headers:{ 'User-Agent':UA, 'Accept':'text/html' }});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.text();
  }catch{ return null; }
}

function parse(html){
  const items = [];
  if(!html) return items;

  // 1) data-player-name + data-rating
  let re = /data-player-name="([^"]+)"[^>]*?data-rating="(\d{2})"/gi;
  let m;
  while((m = re.exec(html))){
    items.push({ name: m[1].trim(), ovr: parseInt(m[2],10) });
    if(items.length > 300) break;
  }
  if(items.length) return items;

  // 2) Kartenblock: Name im Link + rating in Nähe
  re = /href="\/players\/\d+[^"]*"[^>]*>(?:[\s\S]{0,200}?class="rating"[^>]*>(\d{2}))?[\s\S]{0,200}?alt="([^"]+)"/gi;
  while((m = re.exec(html))){
    const ovr = m[1] ? parseInt(m[1],10) : undefined;
    const name = m[2] ? m[2].trim() : '';
    if (name) items.push({ name, ovr });
    if(items.length > 300) break;
  }

  // 3) Ggf. simpler Fallback: Name & ovr im Listing
  if(!items.length){
    re = /class="player-name"[^>]*>([^<]+)<[\s\S]{0,120}?class="ovr"[^>]*>(\d{2})/gi;
    while((m = re.exec(html))){
      items.push({ name:m[1].trim(), ovr:parseInt(m[2],10) });
      if(items.length>300) break;
    }
  }
  return items;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const limit = Math.max(5, Math.min(200, parseInt(req.query?.limit||'60',10)));

  const url = `https://www.fut.gg/players/?popular`;
  const html = await fetchText(url);
  let items = parse(html);

  // deduplizieren, auf Limit schneiden
  const seen = new Set();
  const out = [];
  for (const it of items){
    const key = (it.name||'').toLowerCase();
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: it.name, ovr: it.ovr });
    if(out.length >= limit) break;
  }

  res.status(200).json({ items: out });
};
