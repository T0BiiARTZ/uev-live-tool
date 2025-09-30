// api/price-scrape.js — serverseitiges Scraping von FUT.GG
// Input: ?name=<Spielername>&platform=ps|xbox|pc
// Output: { bin: <Number> } oder { bin: null, note: '...' }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url){
  try{
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return await r.text();
  }catch(e){
    return null;
  }
}

function parseLowestBin(html){
  if(!html) return null;

  // 1) Versuche Pattern mit "Lowest BIN" groß/klein
  let m = html.match(/Lowest\s*BIN[^0-9]{0,20}(\d{1,3}(?:[.,]\d{3})*)/i);
  if(m) return toCoins(m[1]);

  // 2) Suche nach JSON-Snippet mit lowestPrice oder lowest_bin
  m = html.match(/"lowest(?:Price|_bin)"\s*:\s*(\d+)/i);
  if(m) return toCoins(m[1]);

  // 3) Fallback: Zahl in Nähe von "BIN" oder "Buy Now"
  m = html.match(/BIN[^0-9]{0,20}(\d{1,3}(?:[.,]\d{3})*)/i);
  if(m) return toCoins(m[1]);

  m = html.match(/Buy\s*Now[^0-9]{0,20}(\d{1,3}(?:[.,]\d{3})*)/i);
  if(m) return toCoins(m[1]);

  return null;
}

}
function toCoins(s){
  if(!s) return null;
  const n = parseInt(String(s).replace(/[^\d]/g,''),10);
  return Number.isFinite(n) && n>0 ? n : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const name = (req.query?.name||'').trim();
  if(!name) return res.status(200).json({ bin:null, note:'missing name' });

  // 1) Suche den Spieler bei FUT.GG
  const q = encodeURIComponent(name);
  const searchUrl = `https://www.fut.gg/players/?name=${q}`;
  const searchHtml = await fetchText(searchUrl);
  if(!searchHtml) return res.status(200).json({ bin:null, note:'search failed' });

  // Nimm den ersten Ergebnis-Link /players/<id>-.../
  const m = searchHtml.match(/href="\/players\/(\d+)[^"]*"/i);
  if(!m) return res.status(200).json({ bin:null, note:'no result' });
  const playerUrl = `https://www.fut.gg/players/${m[1]}/`;
  const pageHtml = await fetchText(playerUrl);
  const bin = parseLowestBin(pageHtml);

  return res.status(200).json({ bin: bin ?? null });
};
