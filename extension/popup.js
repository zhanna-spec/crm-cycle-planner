// Cycle Planner Site Scanner - popup: a checklist of sections the scanner looks for by clicking around the site.

// The standard checklist. "words" match the text (or address) of a link, button or menu entry.
// popup: the section usually opens as a pop-up from a button. details: open rules, levels, cards on that page.
const DEFAULT_SECTIONS = [
  // Getting players in
  { key: "register", label: "Sign-up", words: "^(register|registrieren|sign[\\s_-]*up|signup|join( now)?|open account|create[\\s_-]*(an[\\s_-]*)?account|konto[\\s_-]*erstellen|registrati|inscri.*|regístrate|registrarse)$", popup: true, loggedOut: true },
  { key: "welcome", label: "Welcome offer", words: "welcome|new[\\s_-]*player|first[\\s_-]*deposit|1st[\\s_-]*deposit|willkommen|bienvenid|benvenut|bienvenue", not: "terms|conditions|rules|requirement", details: true },
  { key: "promotions", label: "Promotions", words: "promo|promotion|bonus(es)?\\b|offers?\\b|campaigns?\\b|angebot|aktion|promociones|ofertas|promozioni|offres|aanbieding|kampanj|kampanya", not: "^my\\b|terms|conditions|rules|requirement|shop|welcome", details: true },
  { key: "terms", label: "Bonus terms", words: "bonus[\\s_-]*(t&cs?|terms|rules|conditions|policy|requirement)|promotion[\\s_-]*(terms|rules|requirement)|wagering[\\s_-]*requirement|bonusbedingungen|bonus[\\s_-]*regeln|bonusvoorwaarden|terms[\\s_-]*(and|&)[\\s_-]*conditions", details: true, help: true },
  // Keeping players
  { key: "tournaments", label: "Tournaments / races", words: "tourn|turnier|torneo|tournoi|leaderboard|rangliste|\\brace\\b|races\\b|drops?[\\s_&-]*(and|&)?[\\s_-]*wins|prize[\\s_-]*drop|wettbewerb", details: true },
  { key: "vip", label: "VIP / loyalty", words: "\\bvip\\b|loyal|club\\b|rewards?\\b|levels?\\b|rakeback|cashback|treue|fidelidad|fedelt|fidélité", not: "shop|store", details: true },
  { key: "missions", label: "Missions / achievements", words: "mission|quest|achievement|badges?\\b|challenges?\\b", details: true },
  { key: "shop", label: "Bonus shop", words: "\\bshop\\b|\\bstore\\b|bonus[\\s_-]*shop|rewards?[\\s_-]*shop|exchange|marketplace|prämien|tienda", not: "app[\\s_-]*store|play[\\s_-]*store|google[\\s_-]*play", details: true },
  { key: "wheel", label: "Wheel / mini-games", words: "wheel|lucky[\\s_-]*spin|daily[\\s_-]*(spin|reward|bonus|drop)|mystery[\\s_-]*(box|chest|bonus)|scratch|mini[\\s_-]*games?|treasure|\\bchests?\\b", details: true },
  { key: "referral", label: "Refer a friend", words: "refer|referral|invite[\\s_-]*(a[\\s_-]*)?friends?|bring[\\s_-]*a[\\s_-]*friend|freunde[\\s_-]*werben|invita", details: true },
  { key: "jackpots", label: "Jackpots", words: "jackpot", details: true },
  { key: "sports", label: "Sports promos", words: "free[\\s_-]*bets?|acca|odds[\\s_-]*boost|price[\\s_-]*boost|bet[\\s_-]*insurance|bet[\\s_-]*builder|sports?[\\s_-]*(promo|promotions|bonus|offers?)", details: true, off: true },
  // Logged in only
  { key: "deposit", label: "Deposit / cashier", words: "^(deposit|deposit now|wallet|cashier|einzahlen|einzahlung|kasse|depositar|depósito|deposita|dépôt|déposer)$", popup: true, loggedIn: true },
  { key: "bonuses", label: "My bonuses", words: "my[\\s_-]*(bonus(es)?|rewards|offers|free[\\s_-]*spins)|bonus[\\s_-]*(wallet|balance|history)|active[\\s_-]*bonus|free[\\s_-]*spins\\b|freespins", details: true, loggedIn: true },
  { key: "inbox", label: "Inbox / messages", words: "inbox|messages?\\b|notifications?\\b|mailbox|postfach|nachrichten", loggedIn: true },
  { key: "account", label: "Account / profile", words: "my[\\s_-]*account|my[\\s_-]*profile|^profile$|account[\\s_-]*settings|communication|marketing[\\s_-]*preferences|preferences|mein[\\s_-]*konto|mi[\\s_-]*cuenta", loggedIn: true },
  { key: "withdrawal", label: "Withdrawal", words: "^(withdraw|withdrawal|withdraw funds|auszahlen|auszahlung|retirar|retiro|prelevare|prelievo|retrait)$", popup: true, loggedIn: true },
  // Compliance and extras
  { key: "rg", label: "Responsible gambling", words: "responsible|safer[\\s_-]*gambling|player[\\s_-]*protection|verantwort|juego[\\s_-]*responsable|gioco[\\s_-]*responsabile|jeu[\\s_-]*responsable", help: true },
  { key: "app", label: "App", words: "\\bapp\\b|download[\\s_-]*(the[\\s_-]*)?app|mobile[\\s_-]*app" },
  { key: "help", label: "Help / FAQ", words: "^(help|help cent(er|re)|support|faq|faqs)$", help: true, off: true }
];
const GROUPS = { register: "Getting players in", tournaments: "Keeping players", deposit: "Your account", rg: "Compliance and extras" };
// Which sections belong to which run: logged-in only ones are hidden on a logged-out run and the other way round.
const fits = (s) => !(runMode === "logged-out" && s.loggedIn) && !(runMode === "logged-in" && s.loggedOut);
// Menu entries that are game categories or account basics; not worth suggesting.
const NOT_SUGGESTED = /^(home|casino|live( casino| dealer)?|sports?( ?book| ?betting)?|withdraw(al)?|help( cent(er|re))?|support|faqs?|slots?|table games|new( games)?|popular|top( games)?|all games|games|jackpots? games|roulette|blackjack|baccarat|poker|crash( games)?|instant( games)?|megaways|providers?|search|favou?rites|recent(ly played)?|log ?in|sign ?in|log ?out|register|sign ?up|join( now)?|deposit|wallet|cashier|menu|close|back|english|deutsch|español|language|light|dark|en|de|es|fr|it)$/i;

const main = document.getElementById("main");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let runMode = "logged-out", guessed = false;
let target = null, prefs = { off: [], on: [], custom: [] }, sections = [], suggestions = [], pages = [], base = [];

// Search words typed by the person ("daily wheel, lucky spin") become a pattern.
function wordsFrom(name, extra) {
  const parts = [name].concat(String(extra || "").split(",")).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => reEsc(p.toLowerCase()).replace(/\s+/g, "[\\s_-]*")).join("|");
}

// Runs inside the operator's page: opens a collapsed menu, then lists links, buttons and the menu.
async function collectSite() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ");
  const toggles = Array.from(document.querySelectorAll("button, [role=button], a")).filter((b) => {
    if (!vis(b) || b.getAttribute("aria-expanded") === "true") return false;
    const label = (b.getAttribute("aria-label") || b.title || b.innerText || "").toLowerCase();
    const cls = String(b.className || "").toLowerCase();
    return /^(menu|open menu|toggle menu|toggle sidebar|open sidebar|sidebar|navigation|main menu|☰)$/.test(label.trim()) || /hamburger|burger|menu-toggle|sidebar-toggle|nav-toggle/.test(cls) || (b.getAttribute("aria-expanded") === "false" && /menu|nav|sidebar/.test(label + " " + cls + " " + (b.getAttribute("aria-controls") || "")));
  });
  let opened = false;
  for (const t of toggles.slice(0, 1)) { try { t.click(); opened = true; } catch (e) { /* ignore */ } }
  if (opened) await sleep(700);
  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) => /^https?:/i.test(a.href)).map((a) => ({ text: textOf(a).slice(0, 80), href: a.href }));
  const buttons = Array.from(document.querySelectorAll("button, [role=button], a:not([href]), a[href='#'], a[href^='javascript']")).filter(vis).map((b) => textOf(b)).filter((t) => t && t.length <= 30);
  const seen = new Set(), menu = [];
  document.querySelectorAll("nav a, aside a, header a, [role=navigation] a, [class*=sidebar] a, [class*=Sidebar] a, nav button, aside button, [class*=sidebar] button, [role=menuitem]").forEach((el) => {
    const t = textOf(el).slice(0, 40); if (!t || seen.has(t.toLowerCase()) || !vis(el)) return;
    seen.add(t.toLowerCase()); menu.push({ text: t, href: el.href || "" });
  });
  // Signs of being logged in or out. Hidden menu entries count too (a "Log out" link in a closed menu).
  const login = { inScore: 0, outScore: 0, inWhy: [], outWhy: [] };
  const all = Array.from(document.querySelectorAll("a, button, [role=button], [role=menuitem]"));
  const shownText = all.filter(vis).map(textOf).map((t) => t.trim());
  const anyText = all.map((el) => (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "));
  const sign = (side, pts, why) => { login[side + "Score"] += pts; login[side + "Why"].push(why); };
  if (anyText.some((t) => /^(log ?out|sign ?out|logout|abmelden|ausloggen|cerrar sesión|salir|déconnexion|esci|uitloggen)$/i.test(t))) sign("in", 3, "a Log out option");
  if (shownText.some((t) => /^(log ?in|sign ?in|login|anmelden|einloggen|iniciar sesión|entrar|connexion|se connecter|accedi|inloggen)$/i.test(t))) sign("out", 3, "a Log in button");
  if (shownText.some((t) => /^(register|sign ?up|join( now)?|create account|open account|registrieren|regístrate|registrati|s'inscrire)$/i.test(t))) sign("out", 1, "a Register button");
  if (Array.from(document.querySelectorAll("input[type=password]")).some(vis)) sign("out", 1, "a password field");
  if (shownText.some((t) => /^(deposit|deposit now|wallet|cashier|einzahlen|depositar)$/i.test(t))) sign("in", 1, "a Deposit button");
  // a balance near the top of the page, like "€12.50" or "0.00 USDT"
  const money = /^([€$£₺₹¥₽]|EUR|USD|GBP|CAD|AUD|NZD|BTC|ETH|USDT)?\s?\d{1,7}([.,]\d{2,8})\s?([€$£₺₹¥₽]|EUR|USD|GBP|CAD|AUD|NZD|BTC|ETH|USDT|mBTC)?$/i;
  const balance = Array.from(document.querySelectorAll("header *, [class*=header] *, [class*=Header] *, [class*=balance] *, [class*=Balance], [class*=balance]")).some((el) => {
    if (!vis(el) || el.children.length > 2) return false;
    const r = el.getBoundingClientRect(), t = (el.innerText || "").trim();
    return r.top < 160 && t.length <= 20 && money.test(t) && /[€$£₺₹¥₽]|[A-Z]{3}/i.test(t);
  });
  if (balance) sign("in", 2, "a balance in the header");
  const avatar = Array.from(document.querySelectorAll("header button, header a, header [role=button], [class*=header] button, [class*=Header] button")).some((b) => vis(b) &&
    /avatar|profile|account|user[-_ ]?menu|\buser\b/i.test((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + String(b.className || "")) && !/log ?in|sign ?in|register/i.test(b.innerText || ""));
  if (avatar) sign("in", 1, "an account button");
  return { login, url: location.href, title: document.title, host: location.hostname, origin: location.origin, path: location.pathname, links, buttons: Array.from(new Set(buttons)), menu: menu.slice(0, 80), menuOpened: opened };
}

function clean(u) { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch (e) { return ""; } }
function shortText(t) { t = (t || "").replace(/\$?[\d.,]{4,}/g, "").replace(/\s+/g, " ").trim(); return t.length > 40 ? t.slice(0, 40) + "…" : t; }

// A quick look at what's visible now, to show next to each section. The real search happens during the scan.
function seenOnPage(sec, info) {
  const re = new RegExp(sec.words, "i"), no = sec.not ? new RegExp(sec.not, "i") : null;
  const ok = (t) => t && t.length <= 40 && re.test(t) && !(no && no.test(t));
  const b = info.buttons.find(ok);
  if (b) return b;
  const l = info.links.find((x) => ok(x.text));
  return l ? l.text : "";
}

function build(info) {
  const home = clean(info.origin + "/"), here = clean(info.url);
  const onHome = info.path === "/" || info.path === "" || here === home;
  base = [{ type: "page", url: home, cat: "homepage", label: "Homepage", sub: "", checked: true }];
  if (!onHome) base.push({ type: "page", url: here, cat: "current", label: "This page", sub: shortText(info.title), checked: true });
  if (info.menu.length >= 3) base.push({ type: "menu", url: home, cat: "menu", label: "Site menu", sub: info.menu.length + " entries", menu: info.menu, checked: true });
  let grp = "";
  sections = DEFAULT_SECTIONS.concat(prefs.custom.map((c) => Object.assign({ details: true, custom: true }, c))).map((s) => Object.assign({}, s, { group: s.custom ? "Your own" : (grp = GROUPS[s.key] || grp), checked: s.off ? prefs.on.indexOf(s.key) >= 0 : prefs.off.indexOf(s.key) < 0, seen: seenOnPage(s, info) }));
  // menu entries no section covers become suggestions
  const res = sections.map((s) => new RegExp(s.words, "i"));
  const taken = new Set();
  suggestions = info.menu.filter((m) => {
    const t = m.text.trim(), k = t.toLowerCase();
    if (t.length < 3 || t.length > 30 || /\d{3,}/.test(t) || NOT_SUGGESTED.test(t) || taken.has(k) || res.some((r) => r.test(t))) return false;
    taken.add(k); return true;
  }).slice(0, 12).map((m) => ({ key: "s_" + m.text.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: m.text, words: "^" + reEsc(m.text) + "$", details: true, checked: false, seen: m.text }));
  pages = [];
}

async function savePrefs() { await chrome.storage.sync.set({ sectionPrefs: prefs }); }

function row(item, list, i, extra) {
  const sub = item.type === "page" || item.type === "menu" ? (item.sub ? '<span class="cat">' + esc(item.sub) + "</span>" : "") : "";
  const small = list === "b" ? (item.type === "menu" ? "Opens the menu on the homepage" : item.url)
    : list === "x" ? "Seen in the menu"
    : list === "p" ? item.url
    : item.seen ? "Seen on this page: “" + shortText(item.seen) + "”" : item.popup ? "Will look for the button" : "Will search the page and menus";
  return '<div class="item"><label><input type="checkbox" data-list="' + list + '" data-i="' + i + '"' + (item.checked ? " checked" : "") + "><span><b>" + esc(item.label) + "</b> " + sub + "<small>" + esc(small) + "</small></span></label>" + (extra || "") + "</div>";
}

function render() {
  let lastGroup = "";
  main.innerHTML =
    "<h2>This run is</h2>" +
    '<div class="seg"><label><input type="radio" name="run" value="logged-out"' + (runMode === "logged-out" ? " checked" : "") + '><span>Logged out</span></label><label><input type="radio" name="run" value="logged-in"' + (runMode === "logged-in" ? " checked" : "") + "><span>Logged in</span></label></div>" +
    (guessed ? '<p class="note">' + esc(guessed) + "</p>" : "") +
    "<h2>Always</h2>" +
    '<div class="list">' + base.map((p, i) => row(p, "b", i)).join("") + "</div>" +
    "<h2>Sections to find</h2>" +
    '<div class="list">' + sections.map((s, i) => { if (!fits(s)) return ""; const g = s.group !== lastGroup ? '<div class="grp">' + esc(s.group) + "</div>" : ""; lastGroup = s.group; return g + row(s, "s", i, s.custom ? '<button class="x" data-rm="' + i + '" title="Remove from my list" aria-label="Remove ' + esc(s.label) + '">✕</button>' : ""); }).join("") + pages.map((p, i) => row(p, "p", i)).join("") + "</div>" +
    '<details id="addbox"><summary>+ Add a section to my list</summary>' +
    '<div class="col"><input type="text" id="newName" placeholder="Name, e.g. Daily wheel" maxlength="40"><input type="text" id="newWords" placeholder="Other words it may be called (optional, comma separated)" maxlength="200"><button id="addSec">Add to my list</button></div>' +
    '<div class="row"><input type="url" id="extra" placeholder="Or paste a page link for this scan"><button id="add">Add</button></div></details>' +
    (suggestions.length ? "<h2>Also on this site</h2><p class=\"note\">Menu entries none of your sections cover. Tick any you want scanned too.</p>" +
      '<div class="list">' + suggestions.map((s, i) => row(s, "x", i, '<button class="x keep" data-keep="' + i + '" title="Add to my list for every site">Keep</button>')).join("") + "</div>" : "") +
    '<button class="primary" id="go"></button>' +
    '<p class="note">For each section it clicks around the site: the page, the side menu, sub-menus and (logged in) the account menu. Then it photographs what opens and, on VIP, promotions and similar pages, opens the details. Sections it can\'t find are listed in the planner. About 15 to 40 seconds per section; don\'t switch tabs until the planner opens.</p>';
  count();
}
function chosen() { return base.concat(sections.filter(fits), pages, suggestions).filter((p) => p.checked); }
function count() { const n = chosen().length; const b = document.getElementById("go"); if (b) { b.textContent = "Scan " + n + (n === 1 ? " section" : " sections"); b.disabled = !n; } }
function listOf(l) { return l === "b" ? base : l === "s" ? sections : l === "p" ? pages : suggestions; }

main.addEventListener("change", async (e) => {
  if (e.target.name === "run") { runMode = e.target.value; guessed = false; render(); return; }
  const i = e.target.getAttribute("data-i"); if (i === null) return;
  const l = e.target.getAttribute("data-list"), item = listOf(l)[+i];
  item.checked = e.target.checked;
  if (l === "s") {
    prefs.off = prefs.off.filter((k) => k !== item.key); prefs.on = prefs.on.filter((k) => k !== item.key);
    if (item.off && item.checked) prefs.on.push(item.key);
    if (!item.off && !item.checked) prefs.off.push(item.key);
    await savePrefs();
  }
  count();
});
main.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "addSec") {
    const name = document.getElementById("newName").value.trim();
    if (!name) { document.getElementById("newName").focus(); return; }
    const c = { key: "c_" + Date.now().toString(36), label: name, words: wordsFrom(name, document.getElementById("newWords").value) };
    prefs.custom.push(c); await savePrefs();
    sections.push(Object.assign({ details: true, custom: true, group: "Your own", checked: true, seen: seenOnPage(c, target.info) }, c));
    render();
  }
  if (t.hasAttribute("data-rm")) {
    const s = sections[+t.getAttribute("data-rm")];
    prefs.custom = prefs.custom.filter((c) => c.key !== s.key); prefs.off = prefs.off.filter((k) => k !== s.key); await savePrefs();
    sections.splice(+t.getAttribute("data-rm"), 1); render();
  }
  if (t.hasAttribute("data-keep")) {
    const s = suggestions.splice(+t.getAttribute("data-keep"), 1)[0];
    const c = { key: "c_" + Date.now().toString(36), label: s.label, words: wordsFrom(s.label, "") };
    prefs.custom.push(c); await savePrefs();
    sections.push(Object.assign({ details: true, custom: true, group: "Your own", checked: true, seen: s.seen }, c)); render();
  }
  if (t.id === "add") {
    const v = document.getElementById("extra").value.trim();
    try { const u = new URL(v); pages.push({ type: "page", url: u.toString(), cat: "custom", label: "Added by you", sub: u.pathname, checked: true }); render(); } catch (err) { document.getElementById("extra").focus(); }
  }
  if (t.id === "go") {
    const home = base[0].url;
    const list = chosen().map((p) => p.type ? { type: p.type, url: p.url, label: p.label + (p.sub && p.type === "page" ? " (" + p.sub + ")" : ""), cat: p.cat, menu: p.menu || null, details: p.cat === "current" || p.cat === "custom" }
      : { type: "find", url: home, label: p.label, cat: p.key, words: p.words, not: p.not || "", popup: !!p.popup, details: !!p.details, help: !!p.help });
    const run = document.querySelector('input[name="run"]:checked').value;
    await chrome.runtime.sendMessage({ type: "scan", tabId: target.id, pages: list, run, site: { host: target.info.host, title: target.info.title, url: target.info.url } });
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
  const stored = (await chrome.storage.sync.get("sectionPrefs")).sectionPrefs;
  if (stored) prefs = { off: stored.off || [], on: stored.on || [], custom: stored.custom || [] };
  // ?tab=<id> lets the popup be opened as a normal page for testing.
  const q = new URLSearchParams(location.search).get("tab");
  const tab = q ? await chrome.tabs.get(+q) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https?:/i.test(tab.url || "")) {
    document.getElementById("site").textContent = "Open a website first";
    main.innerHTML = '<p class="note">Go to the operator\'s website in this tab (turn on your VPN first if you need one), then click the extension again.</p>';
    return;
  }
  try {
    main.innerHTML = '<p class="note">Looking at the page…</p>';
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectSite });
    target = { id: tab.id, info: res.result };
    document.getElementById("site").textContent = res.result.host;
    build(res.result);
    const lg = res.result.login;
    if (lg.inScore - lg.outScore >= 2) { runMode = "logged-in"; guessed = "You seem to be logged in (" + lg.inWhy.slice(0, 2).join(", ") + "). Change it if that's wrong."; }
    else if (lg.outScore - lg.inScore >= 2) { runMode = "logged-out"; guessed = "You seem to be logged out (" + lg.outWhy.slice(0, 2).join(", ") + "). Change it if that's wrong."; }
    else guessed = "Couldn't tell if you're logged in. Check the switch.";
    render();
  } catch (err) {
    main.innerHTML = '<p class="warn">Couldn\'t read this page: ' + esc(err.message) + "</p>";
  }
})();
