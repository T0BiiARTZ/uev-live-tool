// api/popular-scrape.js — Beliebte/oft genutzte Spieler von FUT.GG scrapen
// /api/popular-scrape?limit=40
// Antwort: { items: [{ name, pos, ovr }] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url){
  try{
    const r = await fetch(url,{ headers:{ 'User-Agent':UA, 'Accept':'text/html' }});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.text();
  }catch{ return null; }
}

function tryParse(html){
  const items = [];
  if(!html) return items;

  // Muster 1: data-player-name / data-position / data-rating
  const re1 = /data-player-name="([^"]+)"[\s\S]*?data-position="([^"]+)"[\s\S]*?data-rating="(\d{2})"/gi;
  let m;
  while((m = re1.exec(html))){
    items.push({ name:m[1], pos:m[2], ovr:parseInt(m[3],10) });
    if(items.length>200) break;
  }
  if(items.length) return items;

  // Muster 2: Fallback – Name & OVR im Listing
  const re2 = /class="player-name"[^>]*>([^<]+)<[\s\S]{0,120}?class="ovr"[^>]*>(\d{2})/gi;
  while((m = re2.exec(html))){
    items.push({ name:m[1].trim(), pos:'', ovr:parseInt(m[2],10) });
    if(items.length>200) break;
  }

  return items;
}

const FALLBACK = [
  // solide, oft genutzte Meta-Spieler (als Absicherung)
  { name:'Kylian Mbappe', pos:'ST', ovr:91 },
  { name:'Erling Haaland', pos:'ST', ovr:91 },
  { name:'Vinicius Junior', pos:'LW', ovr:89 },
  { name:'Mohamed Salah', pos:'RW', ovr:89 },
  { name:'Jude Bellingham', pos:'CM', ovr:87 },
  { name:'Jamal Musiala', pos:'CAM', ovr:86 },
  { name:'Ousmane Dembele', pos:'RW', ovr:86 },
  { name:'Heung Min Son', pos:'LW', ovr:88 },
  { name:'Marcus Rashford', pos:'LW', ovr:85 },
  { name:'Raphael Varane', pos:'CB', ovr:85 },
  { name:'Theo Hernandez', pos:'LB', ovr:85 },
  { name:'Kyle Walker', pos:'RB', ovr:84 },
  { name:'Ferland Mendy', pos:'LB', ovr:83 },
  { name:'Mike Maignan', pos:'GK', ovr:87 }
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const limit = Math.max(5, Math.min(200, parseInt(req.query?.limit||'40',10)));

  const url = `https://www.fut.gg/players/?popular`;
  const html = await fetchText(url);
  let items = tryParse(html);

  if(!items.length) items = FALLBACK.slice();

  res.status(200).json({ items: items.slice(0, limit) });
};
