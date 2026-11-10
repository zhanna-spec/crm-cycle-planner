// Cycle Planner Site Scanner - popup: finds the site's sections and starts the scan.

// One entry per section. "words" match the link or button text and address.
const SECTIONS = [
  { key: "promotions", label: "Promotions", words: /promo|promotion|bonus(es)?\b|offers?\b|angebot|aktion|promociones|ofertas|promozioni|offres|aanbieding|kampanj|kampanya/i },
  { key: "tournaments", label: "Tournaments / leaderboard", words: /tourn|turnier|torneo|tournoi|leaderboard|rangliste|\brace\b|races\b|drops?[\s_&-]*(and|&)?[\s_-]*wins|prize[\s_-]*drop|challenge|wettbewerb/i },
  { key: "vip", label: "VIP / loyalty", words: /\bvip\b|loyal|club\b|reward|treue|fidelidad|fedelt|fidélité|rakeback/i },
  { key: "terms", label: "Bonus terms", words: /bonus[\s_-]*(terms|rules|conditions|policy|requirement)|promotion[\s_-]*(terms|requirement)|bonusbedingungen|bonus[\s_-]*regeln|bonusvoorwaarden|terms[\s_-]*(and|&)[\s_-]*conditions/i },
  { key: "register", label: "Sign-up", words: /^(register|registrieren|sign[\s_-]*up|signup|join( now)?|create[\s_-]*account|konto[\s_-]*erstellen|registrati|inscri.*|regístrate|registrarse)$/i, action: true, linkWords: /register|registr|sign[\s_-]*up|signup|join|create[\s_-]*account/i },
  { key: "deposit", label: "Deposit / cashier", words: /^(deposit|deposit now|wallet|cashier|einzahlen|einzahlung|kasse|depositar|depósito|deposita|dépôt|déposer)$/i, action: true, linkWords: /deposit|cashier|einzahl|kasse|depósito|deposito|dépôt|wallet/i },
  { key: "app", label: "App", words: /\bapp\b|download[\s_-]*(the[\s_-]*)?app|mobile[\s_-]*app/i },
  { key: "rg", label: "Responsible gambling", words: /responsible|verantwort|juego[\s_-]*responsable|gioco[\s_-]*responsabile|jeu[\s_-]*responsable|safer[\s_-]*gambling/i }
];
// Help centres, articles and blogs explain things; they aren't the section itself.
const HELP_PAGE = /(^|\.)(help|support|faq|blog|news|docs|community)\.|\/(help|support|faq|articles?|blog|news|knowledge|guides?|how-to)\b|how-to-/i;

const main = document.getElementById("main");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let target = null, picked = [], extra = [];

// Runs inside the operator's page: opens a collapsed menu, then lists links, buttons and the menu.
async function collectSite() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ");
  // open a hamburger / sidebar menu if one is closed
  const toggles = Array.from(document.querySelectorAll("button, [role=button], a")).filter((b) => {
    if (!vis(b)) return false;
    const label = (b.getAttribute("aria-label") || b.title || b.innerText || "").toLowerCase();
    const cls = String(b.className || "").toLowerCase();
    return /^(menu|open menu|toggle menu|toggle sidebar|open sidebar|sidebar|navigation|main menu|☰)$/.test(label.trim()) || /hamburger|burger|menu-toggle|sidebar-toggle|nav-toggle/.test(cls) || (b.getAttribute("aria-expanded") === "false" && /menu|nav|sidebar/.test(label + " " + cls + " " + (b.getAttribute("aria-controls") || "")));
  });
  let opened = false;
  for (const t of toggles.slice(0, 1)) { try { t.click(); opened = true; } catch (e) { /* ignore */ } }
  if (opened) await sleep(700);
  const inMenu = (el) => !!el.closest("nav, aside, header, [role=navigation], [class*=sidebar], [class*=Sidebar], [class*=menu], [class*=Menu]");
  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) => /^https?:/i.test(a.href)).map((a) => ({ text: textOf(a).slice(0, 80), href: a.href, inMenu: inMenu(a) }));
  const buttons = Array.from(document.querySelectorAll("button, [role=button], a:not([href]), a[href='#'], a[href^='javascript']")).filter(vis).map((b) => textOf(b)).filter((t) => t && t.length <= 30);
  // the menu itself: entries in nav / sidebars / header
  const seen = new Set(), menu = [];
  document.querySelectorAll("nav a, aside a, header a, [role=navigation] a, [class*=sidebar] a, [class*=Sidebar] a, nav button, aside button, [class*=sidebar] button").forEach((el) => {
    const t = textOf(el).slice(0, 40); if (!t || seen.has(t.toLowerCase()) || !vis(el)) return;
    seen.add(t.toLowerCase()); menu.push({ text: t, href: el.href || "" });
  });
  return { url: location.href, title: document.title, host: location.hostname, origin: location.origin, path: location.pathname, links, buttons: Array.from(new Set(buttons)), menu: menu.slice(0, 80), menuOpened: opened };
}

function baseDomain(host) { const p = host.replace(/^www\./, "").split("."); return p.slice(-2).join("."); }
function clean(u) { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch (e) { return ""; } }
function shortText(t) { t = (t || "").replace(/\$?[\d.,]{4,}/g, "").replace(/\s+/g, " ").trim(); return t.length > 40 ? t.slice(0, 40) + "…" : t; }

function pickPages(info) {
  const base = baseDomain(info.host), home = clean(info.origin + "/"), here = clean(info.url);
  const onHome = info.path === "/" || info.path === "" || here === home;
  const out = [{ type: "page", url: home, cat: "homepage", label: "Homepage", sub: "", checked: true }];
  if (!onHome) out.push({ type: "page", url: here, cat: "current", label: "This page", sub: shortText(info.title), checked: true });
  if (info.menu.length >= 3) out.push({ type: "menu", url: home, cat: "menu", label: "Site menu", sub: info.menu.length + " entries" + (info.menuOpened ? " (side menu opened)" : ""), menu: info.menu, checked: true });
  const used = new Set(out.map((p) => p.url)), others = [];
  for (const sec of SECTIONS) {
    // buttons that open a pop-up (Wallet, Deposit, Register…)
    if (sec.action) {
      const btn = info.buttons.find((b) => sec.words.test(b.trim()));
      if (btn) { out.push({ type: "action", url: here, cat: sec.key, label: sec.label, sub: "Clicks “" + btn + "” and photographs the pop-up", button: btn, checked: true }); continue; }
    }
    const words = sec.linkWords || sec.words;
    const cands = [];
    for (const l of info.links) {
      const u = clean(l.href); if (!u || used.has(u)) continue;
      let url; try { url = new URL(u); } catch (e) { continue; }
      if (baseDomain(url.hostname) !== base) continue;
      const hay = l.text + " " + decodeURIComponent(url.pathname);
      if (!words.test(hay)) continue;
      let score = 0;
      if (url.hostname === info.host) score += 3;
      if (l.inMenu) score += 2;
      if (url.pathname.split("/").filter(Boolean).length <= 1) score += 1;
      if (l.text && l.text.length <= 25) score += 1;
      if (HELP_PAGE.test(url.hostname + url.pathname) && sec.key !== "terms") score -= 6;
      if (url.search.length > 20) score -= 1;
      cands.push({ u, l, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const seenU = new Set();
    cands.forEach((c, i) => {
      if (seenU.has(c.u)) return; seenU.add(c.u);
      const item = { type: "page", url: c.u, cat: sec.key, label: sec.label, sub: shortText(c.l.text), checked: i === 0 && c.score > -3 };
      if (item.checked) { out.push(item); used.add(c.u); } else others.push(item);
    });
  }
  return { picked: out, others: others.filter((o) => !used.has(o.url)).slice(0, 15) };
}

function row(p, i, list) {
  return '<label class="item"><input type="checkbox" data-list="' + list + '" data-i="' + i + '"' + (p.checked ? " checked" : "") + "><span><b>" + esc(p.label) + "</b>" +
    (p.sub ? ' <span class="cat">' + esc(p.sub) + "</span>" : "") + "<small>" + esc(p.type === "action" ? "On " + p.url : p.type === "menu" ? "Opens the menu on the homepage" : p.url) + "</small></span></label>";
}
function render() {
  main.innerHTML =
    "<h2>Sections to scan</h2>" +
    (picked.length > 2 ? "" : '<p class="note">I found few sections here. Open the site\'s menu, or go to the homepage, and click the extension again.</p>') +
    '<div class="list">' + picked.map((p, i) => row(p, i, "p")).join("") + "</div>" +
    (extra.length ? '<details><summary class="note" style="cursor:pointer">Other links found (' + extra.length + ")</summary><div class=\"list\" style=\"margin-top:6px\">" + extra.map((p, i) => row(p, i, "x")).join("") + "</div></details>" : "") +
    '<div class="row"><input type="url" id="extra" placeholder="Add another page (paste a link)"><button id="add">Add</button></div>' +
    "<h2>This run is</h2>" +
    '<div class="seg"><label><input type="radio" name="run" value="logged-out" checked><span>Logged out</span></label><label><input type="radio" name="run" value="logged-in"><span>Logged in</span></label></div>' +

    '<button class="primary" id="go"></button>' +
    '<p class="note">Each page is photographed top to bottom, and on VIP, promotions and tournament pages it also opens details like rules and levels. The scan uses this tab, about 10 to 30 seconds per section. Don\'t switch tabs until it finishes; the planner opens by itself when it\'s done.</p>';
  count();
}
function all() { return picked.concat(extra); }
function count() { const n = all().filter((p) => p.checked).length; const b = document.getElementById("go"); if (b) { b.textContent = "Scan " + n + (n === 1 ? " section" : " sections"); b.disabled = !n; } }

main.addEventListener("change", (e) => { const i = e.target.getAttribute("data-i"); if (i !== null) { (e.target.getAttribute("data-list") === "x" ? extra : picked)[+i].checked = e.target.checked; count(); } });
main.addEventListener("click", async (e) => {
  if (e.target.id === "add") {
    const v = document.getElementById("extra").value.trim();
    try { const u = new URL(v); picked.push({ type: "page", url: u.toString(), cat: "custom", label: "Added by you", sub: u.pathname, checked: true }); render(); } catch (err) { document.getElementById("extra").focus(); }
  }
  if (e.target.id === "go") {
    const pages = all().filter((p) => p.checked).map((p) => ({ type: p.type, url: p.url, label: p.label + (p.sub && p.type === "page" ? " (" + p.sub + ")" : ""), cat: p.cat, button: p.button || "", menu: p.menu || null }));
    const run = document.querySelector('input[name="run"]:checked').value;
    const perPage = 6;
    await chrome.runtime.sendMessage({ type: "scan", tabId: target.id, pages, run, perPage, site: { host: target.info.host, title: target.info.title, url: target.info.url } });
    showProgress();
  }
});

function showProgress() {
  main.innerHTML = '<h2>Scanning</h2><div class="bar"><i id="bar"></i></div><p class="note" id="prog">Starting…</p>';
  const update = (st) => {
    if (!st) return;
    const pct = st.total ? Math.round(100 * (st.done || 0) / st.total) : 0;
    const bar = document.getElementById("bar"); if (bar) bar.style.width = pct + "%";
    const p = document.getElementById("prog"); if (!p) return;
    if (st.state === "running") p.textContent = "Section " + Math.min(st.total, (st.done || 0) + 1) + " of " + st.total + (st.current ? ": " + st.current : "");
    if (st.state === "done") main.innerHTML = '<p class="ok">Done. The planner has opened in a new tab with the scan.</p>';
    if (st.state === "error") main.innerHTML = '<p class="warn">The scan stopped: ' + esc(st.message) + "</p>";
  };
  chrome.storage.local.get("scanStatus").then((r) => update(r.scanStatus));
  chrome.storage.onChanged.addListener((ch) => { if (ch.scanStatus) update(ch.scanStatus.newValue); });
}

(async function start() {
  const { scanStatus } = await chrome.storage.local.get("scanStatus");
  if (scanStatus && scanStatus.state === "running") { document.getElementById("site").textContent = "A scan is running"; showProgress(); return; }
  // ?tab=<id> lets the popup be opened as a normal page for testing.
  const q = new URLSearchParams(location.search).get("tab");
  const tab = q ? await chrome.tabs.get(+q) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https?:/i.test(tab.url || "")) {
    document.getElementById("site").textContent = "Open a website first";
    main.innerHTML = '<p class="note">Go to the operator\'s website in this tab (turn on your VPN first if you need one), then click the extension again.</p>';
    return;
  }
  try {
    main.innerHTML = '<p class="note">Opening the menu and looking for sections…</p>';
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectSite });
    target = { id: tab.id, info: res.result };
    document.getElementById("site").textContent = res.result.host;
    const r = pickPages(res.result); picked = r.picked; extra = r.others;
    render();
  } catch (err) {
    main.innerHTML = '<p class="warn">Couldn\'t read this page: ' + esc(err.message) + "</p>";
  }
})();
