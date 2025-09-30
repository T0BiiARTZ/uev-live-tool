// api/popular-scrape.js — Beliebte/oft genutzte Spieler von FUT.GG scrapen
// IMMER brauchbare Antwort zurückgeben (mit Fallback), damit Frontend nicht leer läuft.
// GET /api/popular-scrape?limit=60
//
// Antwort: { items: [{ name, ovr? }], note?: string }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url){
  try{
    const r = await fetch(url,{ headers:{ 'User-Agent':UA, 'Accept':'text/html,text/*;q=0.9' }});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.text();
  }catch{ return null; }
}

// möglichst viele Muster probieren
function parse(html){
  const out = [];
  if(!html) return out;

  // Cloudflare/Block erkennen -> sofort leer lassen (wir nutzen danach Fallback)
  if (/Just a moment|cf-browser-verification|Attention Required/i.test(html)) {
    return out;
  }

  // Muster 1: data-player-name + data-rating
  let re = /data-player-name="([^"]+)"[^>]*?data-rating="(\d{2})"/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push({ name: m[1].trim(), ovr: parseInt(m[2], 10) });
    if (out.length > 300) break;
  }
  if (out.length) return out;

  // Muster 2: Kartenblock (rating + img alt="Name")
  re = /class="rating"[^>]*>(\d{2})[\s\S]{0,200}?alt="([^"]+)"/gi;
  while ((m = re.exec(html))) {
    const ovr = parseInt(m[1], 10);
    const name = m[2].trim();
    if (name) out.push({ name, ovr });
    if (out.length > 300) break;
  }
  if (out.length) return out;

  // Muster 3: einfacher Name + OVR im Listing
  re = /class="player-name"[^>]*>([^<]+)<[\s\S]{0,120}?class="ovr"[^>]*>(\d{2})/gi;
  while ((m = re.exec(html))) {
    out.push({ name: m[1].trim(), ovr: parseInt(m[2], 10) });
    if (out.length > 300) break;
  }

  return out;
}

// robuste, gepflegte Fallback-Liste (Meta/oft gehandelt)
const FALLBACK = [
  'Kylian Mbappe','Erling Haaland','Vinicius Junior','Mohamed Salah','Jude Bellingham',
  'Heung Min Son','Cristiano Ronaldo','Lionel Messi','Robert Lewandowski','Jamal Musiala',
  'Ousmane Dembele','Marcus Rashford','Bukayo Saka','Federico Chiesa','Neymar Jr',
  'Antoine Griezmann','Rafael Leao','Lautaro Martinez','Darwin Nunez','Rodrygo',
  'Pedri','Gavi','Martin Odegaard','Bruno Fernandes','Kai Havertz',
  'Theo Hernandez','Ferland Mendy','Kyle Walker','Achraf Hakimi','Trent Alexander-Arnold',
  'Antonio Rudiger','Eder Militao','Virgil van Dijk','Raphael Varane','Marquinhos',
  'Mike Maignan','Marc-Andre ter Stegen','Thibaut Courtois','Ederson','Manuel Neuer',
  'Joao Cancelo','Kieran Trippier','Reece James','Pau Torres','Matthijs de Ligt'
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const limit = Math.max(5, Math.min(200, parseInt(req.query?.limit||'60',10)));
  const url = 'https://www.fut.gg/players/?popular';

  let note = '';
  let items = [];

  const html = await fetchText(url);
  if (!html) {
    note = 'fetch failed (blocked or network)';
  } else {
    items = parse(html);
    if (!items.length) note = 'parse yielded 0 (layout or blocked)';
  }

  // Fallback IMMER, wenn leer
  if (!items.length) {
    items = FALLBACK.map(name => ({ name }));
    note = note ? `${note}; fallback used` : 'fallback used';
  }

  // deduplizieren & limitieren
  const seen = new Set(); const out = [];
  for (const it of items) {
    const key = (it.name||'').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: it.name, ovr: it.ovr });
    if (out.length >= limit) break;
  }

  res.status(200).json({ items: out, note });
};
