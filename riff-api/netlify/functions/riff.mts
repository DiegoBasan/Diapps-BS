/* API de Riff: busca de verdad en YouTube, Cifra Club y Songsterr (la app en GitHub Pages no puede por CORS).
   Rutas:
     /api/yt?q=texto                      → videos reales de la búsqueda de YouTube (+ si dejan incrustarse)
     /api/cifra?artist=..&title=..        → acordes, tonalidad, cejilla, afinación, secciones, tabs y letra con acordes
     /api/cifra?url=https://www.cifraclub.com/artista/cancion/
     /api/tabs?q=texto                    → tablaturas en Songsterr
   Solo consulta esos sitios fijos (no es un proxy abierto) y solo responde a los orígenes de Diapps. */

const ORIGINS = ["https://diegobasan.github.io", "http://diapps.test", "http://localhost:8000"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const cors: Record<string, string> = ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
  const u = new URL(req.url), route = u.pathname.replace(/^\/api\//, "").replace(/\/$/, ""), dbg: string[] = [];
  const json = (data: unknown, status = 200, cache = 86400) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600", "Netlify-CDN-Cache-Control": `public, s-maxage=${cache}, stale-while-revalidate=604800` } });
  try {
    if (route === "yt") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 200);
      if (!q) return json({ error: "falta q" }, 400, 0);
      const videos = await youtubeSearch(q, dbg);
      return json({ q, videos, debug: dbg }, 200, videos.length ? 86400 : 0);
    }
    if (route === "cifra") {
      const res = await cifra(u.searchParams.get("url") || "", u.searchParams.get("artist") || "", u.searchParams.get("title") || "", dbg);
      return json(res ? { ...res, debug: dbg } : { error: "no encontrada", debug: dbg }, res ? 200 : 404, res ? 86400 : 0);
    }
    if (route === "tabs") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 200);
      return json({ q, tabs: await songsterr(q, dbg), debug: dbg });
    }
    return json({ ok: true, routes: ["/api/yt?q=", "/api/cifra?artist=&title=", "/api/cifra?url=", "/api/tabs?q="] });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e), debug: dbg }, 500, 0);
  }
};

export const config = { path: "/api/*" };

/* ---------------- utilidades ---------------- */
function get(url: string, extra: Record<string, string> = {}, ms = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9,en;q=0.8", Cookie: "CONSENT=YES+1; SOCS=CAI", ...extra }, redirect: "follow", signal: ctl.signal })
    .finally(() => clearTimeout(t));
}
function decode(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
}
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, ""));
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "e").replace(/['’.]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ---------------- YouTube ---------------- */
type Video = { id: string; title: string; channel: string; length: string; views: string; embeddable?: boolean | null };
async function youtubeSearch(q: string, dbg: string[]): Promise<Video[]> {
  const r = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=es&gl=MX`);
  dbg.push(`yt ${r.status} ${r.url.slice(0, 60)}`);
  const html = await r.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) || html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  if (!m) { dbg.push("yt: sin ytInitialData"); return []; }
  const data = JSON.parse(m[1]), out: Video[] = [], seen = new Set<string>();
  const walk = (o: any) => {
    if (!o || typeof o !== "object" || out.length >= 12) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const v = o.videoRenderer;
    if (v && v.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({ id: v.videoId, title: (v.title?.runs || []).map((x: any) => x.text).join("") || v.title?.simpleText || "",
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "", length: v.lengthText?.simpleText || "",
        views: v.viewCountText?.simpleText || "" });
    }
    const l = o.lockupViewModel;
    if (l && l.contentId && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !seen.has(l.contentId)) {
      seen.add(l.contentId);
      const md = l.metadata?.lockupMetadataViewModel;
      const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
      out.push({ id: l.contentId, title: md?.title?.content || "", channel: rows[0]?.metadataParts?.[0]?.text?.content || "", length: "", views: "" });
    }
    for (const k in o) if (k !== "videoRenderer" && k !== "lockupViewModel") walk(o[k]);
  };
  walk(data);
  dbg.push(`yt: ${out.length} videos`);
  // ¿deja incrustarse? (oEmbed responde 401 si el dueño lo prohíbe)
  await Promise.all(out.slice(0, 6).map(async v => {
    try { const r2 = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + v.id)}`, {}, 4000);
      v.embeddable = r2.ok ? true : r2.status === 401 || r2.status === 403 ? false : null; } catch { v.embeddable = null; }
  }));
  return out;
}

/* ---------------- Cifra Club ---------------- */
const SECT: [RegExp, string][] = [
  [/^intro/i, "Intro"], [/^(primeira|primera) parte/i, "Verso 1"], [/^segunda parte/i, "Verso 2"], [/^(terceira|tercera) parte/i, "Verso 3"],
  [/^(quarta|cuarta) parte/i, "Verso 4"], [/^pr[ée][- ]?(refr[ãa]o|coro|estribillo)/i, "Pre-coro"], [/^(refr[ãa]o|coro|estribillo)/i, "Coro"],
  [/^(ponte|puente)/i, "Puente"], [/^solo/i, "Solo"], [/^(final|outro|fim|fin)/i, "Final"], [/^interl[úu]d/i, "Interludio"],
  [/^dedilhado|^punteo|^arpejo|^arpegio/i, "Arpegio"], [/^riff/i, "Riff"], [/^verso/i, "Verso"],
];
const sectName = (s: string) => { s = s.trim(); for (const [re, n] of SECT) if (re.test(s)) { const num = s.match(/(\d+)\s*$/); return num && !/\d/.test(n) ? `${n} ${num[1]}` : n; } return s.charAt(0).toUpperCase() + s.slice(1); };

/* Cifrado brasileño → americano: 7M=maj7, 4=sus4, A9=add9, 7(9)=9, m7(5-)=m7b5, °=dim, 5+=aug */
function brChord(x: string): string | null {
  const m = x.trim().replace(/\s+/g, "").match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return null;
  const [, root, rawQ, bass] = m, ext = (rawQ.match(/\(([^)]*)\)/g) || []).join("").replace(/[()]/g, "");
  let q = rawQ.replace(/\([^)]*\)/g, ""), minor = false, out = "";
  if (/^m(?!aj)/.test(q)) { minor = true; q = q.slice(1); }
  const has = (s: string) => ext.includes(s);
  if (/^[°º]|^dim/.test(q)) out = /7/.test(q + ext) ? "dim7" : "dim";
  else if (/^(5\+|\+|aug)/.test(q) || has("5+") || has("#5")) out = "aug";
  else if (/^7M|^maj7|^7\+/.test(q)) out = minor ? "maj7" : "maj7";
  else if (minor && (/^7/.test(q)) && (has("5-") || has("b5"))) out = "7b5";
  else if (/^7/.test(q)) out = has("4") || /^74/.test(q) ? "7sus4" : !minor && (has("9") || /^79/.test(q)) ? "9" : "7";
  else if (/^(4|sus4?)$/.test(q)) out = has("7") ? "7sus4" : "sus4";
  else if (/^(2|sus2)$/.test(q)) out = "sus2";
  else if (/^9$|^add9$|^add2$/.test(q)) out = "add9";
  else if (/^6/.test(q)) out = "6";
  else if (/^5$/.test(q)) out = "5";
  else if (/^(11|13)$/.test(q)) out = "7";
  else if (q === "") out = has("9") ? "add9" : has("4") ? "sus4" : "";
  else return null;
  if (minor) out = out === "add9" ? "madd9" : out === "maj7" ? "mmaj7" : "m" + (out === "sus4" || out === "sus2" ? "" : out);
  return root + out + (bass ? "/" + bass : "");
}

async function cifra(url: string, artist: string, title: string, dbg: string[]) {
  const tries: string[] = [];
  const okUrl = (x: string) => /^https:\/\/(www\.|m\.)?cifraclub\.com(\.br)?\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(x);
  if (url) { if (!okUrl(url.split(/[?#]/)[0])) return null; tries.push(url.split(/[?#]/)[0].replace(/\/?$/, "/")); }
  else {
    const as = [slug(artist), slug(artist.replace(/^the\s+/i, ""))].filter((v, i, a) => v && a.indexOf(v) === i);
    const tclean = title.replace(/\s*[\(\[].*?[\)\]]/g, "").replace(/\s+-\s+.*$/, "").replace(/\s+(feat|ft)\.?\s.*$/i, "");
    const ts = [slug(tclean), slug(title)].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const a of as) for (const t of ts) tries.push(`https://www.cifraclub.com/${a}/${t}/`);
  }
  for (const t of tries) {
    const r = await parseCifra(t, dbg);
    if (r) return r;
  }
  if (url || !title) return null;
  // no adivinamos la dirección: se busca en DuckDuckGo / Bing dentro de cifraclub.com
  const found = await webFind(`${artist} ${title} cifra club`, /https?:\/\/(?:www\.)?cifraclub\.com(?:\.br)?\/([a-z0-9-]+)\/([a-z0-9-]+)\/?(?=["&#?])/gi, dbg);
  for (const f of found.slice(0, 3)) { const r = await parseCifra(f, dbg); if (r) return r; }
  return null;
}

async function webFind(q: string, re: RegExp, dbg: string[]): Promise<string[]> {
  const out: string[] = [];
  const engines = [`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es`];
  for (const e of engines) {
    try {
      const r = await get(e, {}, 6000), html = decodeURIComponent((await r.text()).replace(/%(?![0-9a-f]{2})/gi, "%25"));
      dbg.push(`buscador ${new URL(e).host} ${r.status}`);
      for (const m of html.matchAll(re)) {
        if (/^(cifras|letras|tabs|blog|academy|top|estilos|generos|video-aulas|afinador|metronomo|contribuir)$/i.test(m[1])) continue;
        const u2 = `https://www.cifraclub.com/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
        if (!out.includes(u2)) out.push(u2);
      }
      if (out.length) break;
    } catch (err) { dbg.push(`buscador falló ${String(err)}`); }
  }
  dbg.push(`buscador: ${out.length} enlaces`);
  return out;
}

async function parseCifra(url: string, dbg: string[]) {
  let r: Response;
  try { r = await get(url); } catch (e) { dbg.push(`cifra ${url} error`); return null; }
  dbg.push(`cifra ${r.status} ${url}`);
  if (!r.ok) return null;
  const html = await r.text();
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  if (!pre) { dbg.push("cifra: sin <pre>"); return null; }
  const pick = (re: RegExp) => { const m = html.match(re); return m ? strip(m[1]).trim() : ""; };
  const title = pick(/<h1[^>]*class="[^"]*t1[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || pick(/<meta property="og:title" content="([^"]*)"/);
  const artist = pick(/<h2[^>]*class="[^"]*t3[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
  const key = pick(/id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
  const capoTxt = pick(/id="cifra_capo"[^>]*>([\s\S]*?)<\/span>/);
  const tunTxt = pick(/id="cifra_afi"[^>]*>([\s\S]*?)<\/span>/);
  const capo = capoTxt ? parseInt((capoTxt.match(/(\d+)/) || [])[1] || "0") : 0;
  const tune = /meio tom|medio tono|half|\bEb\b|D#/i.test(tunTxt) ? -1 : /um tom|un tono|whole|\bD G C F A D\b/i.test(tunTxt) ? -2 : 0;

  // tablaturas: se separan antes de leer los acordes
  const tabs: { name: string; lines: string[] }[] = [];
  let body = pre[1].replace(/<span class="tablatura">([\s\S]*?)<\/span>\s*<\/span>|<span class="tablatura">([\s\S]*?)<\/span>/g, (_, a, b) => {
    const lines = strip(a || b || "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
    tabs.push({ name: "", lines });
    return `\n@@TAB${tabs.length - 1}@@\n`;
  });
  const sections: { name: string; chords: string[] }[] = [], text: string[] = [];
  let cur = { name: "", chords: [] as string[] };
  for (const raw of body.split("\n")) {
    const tabM = raw.match(/@@TAB(\d+)@@/);
    if (tabM) { tabs[+tabM[1]].name = cur.name || "Tab"; text.push(raw.trim()); continue; }
    const plain = strip(raw);
    const h = plain.match(/^\s*\[([^\]]+)\]/);
    if (h) { if (cur.chords.length) sections.push(cur); cur = { name: sectName(h[1]), chords: [] }; }
    const chords = [...raw.matchAll(/<b>([^<]+)<\/b>/g)].map(m => brChord(decode(m[1]))).filter(Boolean) as string[];
    cur.chords.push(...chords);
    // línea de texto con los acordes marcados como {Am}, conservando la columna
    text.push(decode(raw.replace(/<b>([^<]+)<\/b>/g, (_, c) => { const o = decode(c), n = brChord(o) || o; return `{${n}}` + " ".repeat(Math.max(0, o.length - n.length)); })
      .replace(/<[^>]+>/g, "")).replace(/\s+$/, ""));
  }
  if (cur.chords.length) sections.push(cur);
  if (!sections.length) { dbg.push("cifra: sin acordes"); return null; }
  return { source: "cifraclub", url, title, artist, key: key.replace(/\s+/g, ""), capo, tune, tuning: tunTxt, sections, tabs, text: text.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/* ---------------- Songsterr (tablaturas interactivas) ---------------- */
async function songsterr(q: string, dbg: string[]) {
  if (!q) return [];
  try {
    const r = await get(`https://www.songsterr.com/api/songs?size=5&pattern=${encodeURIComponent(q)}`, { Accept: "application/json" }, 6000);
    dbg.push(`songsterr ${r.status}`);
    if (!r.ok) return [];
    const list = await r.json();
    return (Array.isArray(list) ? list : []).slice(0, 5).map((s: any) => ({ title: s.title, artist: s.artist,
      url: `https://www.songsterr.com/a/wsa/${slug(s.artist)}-${slug(s.title)}-tab-s${s.songId}`,
      tracks: (s.tracks || []).map((t: any) => t.instrument || t.name).filter(Boolean).slice(0, 6) }));
  } catch (e) { dbg.push(`songsterr error ${String(e)}`); return []; }
}
