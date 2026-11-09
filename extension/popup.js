// Cycle Planner Site Scanner - popup: finds relevant pages and starts the scan.

const CATEGORIES = [
  { key: "terms", label: "Bonus terms", words: /bonus[\s_-]*(terms|rules|conditions|policy)|bonusbedingungen|bonus[\s_-]*regeln|t&c|terms[\s_-]*(and|&)[\s_-]*conditions|general[\s_-]*terms|\bagb\b|términos|termini|conditions[\s_-]*générales|bonusvoorwaarden/i },
  { key: "promotions", label: "Promotions", words: /promo|promotion|bonus|offers?\b|angebot|aktion|promociones|ofertas|promozioni|offres|aanbieding|kampanj|kampanya/i },
  { key: "tournaments", label: "Tournaments", words: /tourn|turnier|torneo|tournoi|leaderboard|rangliste|race|drops?[\s_&-]*(and|&)?[\s_-]*wins|prize[\s_-]*drop|challenge|wettbewerb/i },
  { key: "vip", label: "VIP / loyalty", words: /\bvip\b|loyal|club|reward|treue|fidelidad|fedelt|fidélité|level|shop|missions?/i },
  { key: "register", label: "Sign-up", words: /register|registr|sign[\s_-]*up|signup|join|create[\s_-]*account|konto[\s_-]*erstellen|inscri|crea[\s_-]*account/i },
  { key: "deposit", label: "Deposit / cashier", words: /deposit|cashier|einzahl|kasse|depósito|deposito|dépôt|wallet|payment/i },
  { key: "app", label: "App", words: /\bapp\b|download|mobile/i },
  { key: "rg", label: "Responsible gambling", words: /responsible|verantwort|juego[\s_-]*responsable|gioco[\s_-]*responsabile|jeu[\s_-]*responsable|safer[\s_-]*gambling/i }
];
const PER_CATEGORY = 2;

const main = document.getElementById("main");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let target = null, found = [];

// Runs inside the operator's page.
function collectLinks() {
  const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
    text: (a.innerText || a.getAttribute("aria-label") || a.title || "").trim().replace(/\s+/g, " ").slice(0, 80),
    href: a.href
  })).filter((l) => /^https?:/i.test(l.href));
  return { url: location.href, title: document.title, host: location.hostname, origin: location.origin, links };
}

function baseDomain(host) { const p = host.replace(/^www\./, "").split("."); return p.slice(-2).join("."); }

function pickPages(info) {
  const base = baseDomain(info.host), seen = new Set(), byCat = {};
  const clean = (u) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch (e) { return ""; } };
  const home = clean(info.origin + "/");
  const out = [{ url: clean(info.url), label: "This page", cat: "current", checked: true }];
  seen.add(out[0].url);
  if (!seen.has(home)) { out.push({ url: home, label: "Homepage", cat: "homepage", checked: true }); seen.add(home); }
  for (const l of info.links) {
    const u = clean(l.href); if (!u || seen.has(u)) continue;
    let host; try { host = new URL(u).hostname; } catch (e) { continue; }
    if (baseDomain(host) !== base) continue;
    const hay = (l.text + " " + decodeURIComponent(new URL(u).pathname)).toLowerCase();
    const cat = CATEGORIES.find((c) => c.words.test(hay));
    if (!cat) continue;
    byCat[cat.key] = byCat[cat.key] || [];
    if (byCat[cat.key].length >= PER_CATEGORY) continue;
    byCat[cat.key].push(u); seen.add(u);
    out.push({ url: u, label: l.text || cat.label, cat: cat.key, catLabel: cat.label, checked: byCat[cat.key].length === 1 });
  }
  return out;
}

function render() {
  const items = found.map((p, i) => '<label class="item"><input type="checkbox" data-i="' + i + '"' + (p.checked ? " checked" : "") + '><span><span class="cat">' + esc(p.catLabel || (p.cat === "current" ? "Current page" : "Homepage")) + "</span><br><b>" + esc(p.label) + "</b><small>" + esc(p.url) + "</small></span></label>").join("");
  main.innerHTML =
    "<h2>Pages to scan</h2>" +
    (found.length > 2 ? "" : '<p class="note">I didn\'t find links to promotions or other relevant pages here. Add them below, or open the site\'s menu first and try again.</p>') +
    '<div class="list" id="list">' + items + "</div>" +
    '<div class="row"><input type="url" id="extra" placeholder="Add another page (paste a link)"><button id="add">Add</button></div>' +
    '<p class="note">Sign-up and deposit forms that open as a pop-up can\'t be scanned. Add a screenshot of those in the planner.</p>' +
    "<h2>This run is</h2>" +
    '<div class="seg"><label><input type="radio" name="run" value="logged-out" checked><span>Logged out</span></label><label><input type="radio" name="run" value="logged-in"><span>Logged in</span></label></div>' +
    '<div class="row"><h2 style="flex:1">Screenshots per page</h2><select id="per"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></div>' +
    '<button class="primary" id="go">Scan ' + found.filter((p) => p.checked).length + " pages</button>" +
    '<p class="note">The scan uses this tab and takes about 10 seconds per page. Don\'t switch tabs until it finishes; the planner opens by itself when it\'s done.</p>';
}

function count() { const n = found.filter((p) => p.checked).length; const b = document.getElementById("go"); if (b) { b.textContent = "Scan " + n + (n === 1 ? " page" : " pages"); b.disabled = !n; } }

main.addEventListener("change", (e) => { const i = e.target.getAttribute("data-i"); if (i !== null) { found[+i].checked = e.target.checked; count(); } });
main.addEventListener("click", async (e) => {
  if (e.target.id === "add") {
    const v = document.getElementById("extra").value.trim();
    try { const u = new URL(v); found.push({ url: u.toString(), label: u.pathname, cat: "custom", catLabel: "Added by you", checked: true }); render(); } catch (err) { document.getElementById("extra").focus(); }
  }
  if (e.target.id === "go") {
    const pages = found.filter((p) => p.checked).map((p) => ({ url: p.url, label: p.label, cat: p.cat }));
    const run = document.querySelector('input[name="run"]:checked').value;
    const perPage = +document.getElementById("per").value;
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
    if (st.state === "running") p.textContent = "Page " + Math.min(st.total, (st.done || 0) + 1) + " of " + st.total + (st.current ? ": " + st.current : "");
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
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectLinks });
    target = { id: tab.id, info: res.result };
    document.getElementById("site").textContent = res.result.host;
    found = pickPages(res.result);
    render();
  } catch (err) {
    main.innerHTML = '<p class="warn">Couldn\'t read this page: ' + esc(err.message) + "</p>";
  }
})();
