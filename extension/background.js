// Cycle Planner Site Scanner - does the scanning so it keeps going if the popup closes.

const PLANNER_URL = "https://zhanna-spec.github.io/crm-cycle-planner/#scan";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SCROLL_SHOTS = 6;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "scan") {
    runScan(msg).catch((err) => chrome.storage.local.set({ scanStatus: { state: "error", message: String(err && err.message || err) } }));
    reply({ ok: true });
  }
  return false;
});

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs);
  });
}

async function navigate(tabId, url) {
  const loaded = waitForLoad(tabId, 25000);
  await chrome.tabs.update(tabId, { url, active: true });
  await loaded;
}

async function run(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return res ? res.result : undefined;
}

// Runs inside the scanned page: clicks cookie banners and age checks out of the way.
function dismissOverlays() {
  const words = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|ok|okay|alle akzeptieren|akzeptieren|zustimmen|aceptar( todo)?|accetta( tutto)?|accepter|tout accepter|aceitar|yes,? i('| a)m (over )?18|i('| a)m (over )?18|i am of legal age|18\+|yes)$/i;
  let clicked = 0;
  const els = Array.from(document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]"));
  for (const el of els) {
    if (clicked >= 3) break;
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > 40 || !words.test(text)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    try { el.click(); clicked++; } catch (e) { /* ignore */ }
  }
  return clicked;
}

// Runs inside the scanned page: what we keep besides screenshots.
function pageInfo() {
  // Many sites scroll an inner panel instead of the whole window: use whichever scrolls most.
  const win = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  let best = null, bestH = win - window.innerHeight;
  document.querySelectorAll("main, div, section").forEach((el) => {
    const extra = el.scrollHeight - el.clientHeight;
    if (extra > bestH + 50 && el.clientHeight > window.innerHeight * 0.5 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { best = el; bestH = extra; }
  });
  return {
    title: document.title,
    text: (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").slice(0, 15000),
    scrollHeight: best ? best.scrollHeight : win,
    innerHeight: best ? best.clientHeight : window.innerHeight
  };
}

function scrollToY(y) {
  const win = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  let best = null, bestH = win - window.innerHeight;
  document.querySelectorAll("main, div, section").forEach((el) => {
    const extra = el.scrollHeight - el.clientHeight;
    if (extra > bestH + 50 && el.clientHeight > window.innerHeight * 0.5 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { best = el; bestH = extra; }
  });
  if (best) { best.scrollTop = y; return best.scrollTop; }
  window.scrollTo(0, y); return window.scrollY;
}

// Runs inside the scanned page: finds things worth opening for details (See how rewards work,
// Claim history, Rules, Learn more, a level card, collapsed sections). Never anything that acts.
function findDetails() {
  const ALLOW = /see how|how (it|this|rewards?|points?|levels?|vip) works?|how to (earn|level)|learn more|more info|details|read more|\brules\b|terms|view all|show more|see all|levels?\b|ranks?\b|tiers?\b|benefits|perks|history|explained|faq|info\b|rookie|bronze|silver|gold|platinum|diamond|\bxp\b|\bvip\b/i;
  const DENY = /claim(?!\s*history)|deposit(?!\s*history)|withdraw(?!al\s*history|\s*history)|wallet|\bbet\b|place bet|play|buy|purchase|spin now|log ?out|sign ?out|delete|remove|cancel|send|submit|chat|support|contact|accept|decline|join|register|sign ?up|log ?in|redeem|activate|opt[- ]?in|subscribe|switch to|enable|disable|copy|share/i;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ");
  const out = [], seen = new Set();
  const els = Array.from(document.querySelectorAll("a, button, [role=button], summary, [aria-expanded=false]"));
  for (const el of els) {
    if (out.length >= 5) break;
    if (!vis(el) || el.closest("header, footer, nav, [role=navigation], [role=switch]") || el.matches("[role=switch], input, select, textarea") || el.querySelector("input, [role=switch]")) continue;
    if (el.tagName === "A" && el.href && new URL(el.href, location.href).hostname.replace(/^www\./, "") !== location.hostname.replace(/^www\./, "")) continue;
    const t = textOf(el); if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
    const ok = el.tagName === "SUMMARY" || el.getAttribute("aria-expanded") === "false" || ALLOW.test(t);
    if (!ok || DENY.test(t)) continue;
    seen.add(t.toLowerCase()); out.push(t);
  }
  return out;
}

// Runs inside the scanned page: clicks the detail element with this text.
function clickDetail(text) {
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ");
  const el = Array.from(document.querySelectorAll("a, button, [role=button], summary, [aria-expanded]")).find((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && textOf(e) === text; });
  if (!el) return null;
  el.scrollIntoView({ block: "center" }); el.click();
  return location.href;
}

// Runs inside the scanned page: is a pop-up open?
function hasDialog() {
  return Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .some((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 200 && r.height > 150 && cs.visibility !== "hidden" && cs.display !== "none"; });
}

// Runs inside the scanned page: finds tab switches (Weekly / Monthly, Casino / Sports filters…)
// and marks the ones that aren't selected, so each can be clicked and photographed.
function findTabs() {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.bottom + window.scrollY > 0 && r.top + window.scrollY < window.innerHeight * 4; };
  const short = (el) => { const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " "); return t && t.length <= 24 ? t : ""; };
  const inChrome = (el) => !!el.closest("header, footer, [role=banner], [role=navigation] [role=navigation]");
  const isLink = (b) => b.tagName === "A" && b.getAttribute("href") && !/^(#|javascript:)/i.test(b.getAttribute("href")) && b.href.split("#")[0] !== location.href.split("#")[0];
  const selected = (b) => b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-pressed") === "true" || b.getAttribute("data-state") === "active" ||
    /(^|[\s_-])(active|selected|current|is-active|checked)([\s_-]|$)/i.test(String(b.className || "") + " " + String((b.parentElement && b.parentElement.className) || ""));
  const groups = [];
  const roleTabs = Array.from(document.querySelectorAll("[role=tab]")).filter((b) => vis(b) && short(b) && !inChrome(b) && !isLink(b));
  if (roleTabs.length >= 2) groups.push(roleTabs);
  document.querySelectorAll("div, ul, nav, section, fieldset").forEach((p) => {
    const kids = Array.from(p.children);
    if (kids.length < 2 || kids.length > 6) return;
    const btns = kids.map((c) => (c.matches("button, a, [role=button], [role=tab]") ? c : c.querySelector("button, a, [role=button], [role=tab]")));
    if (btns.some((b) => !b) || !btns.every((b) => short(b) && vis(b) && !inChrome(b) && !isLink(b))) return;
    if (btns.filter(selected).length !== 1) return;
    if (groups.some((g) => g.includes(btns[0]))) return;
    groups.push(btns);
  });
  const out = [];
  groups.slice(0, 2).forEach((g) => g.forEach((b) => {
    if (out.length >= 4 || selected(b)) return;
    const i = out.length; b.setAttribute("data-ccp-tab", String(i)); out.push({ i, text: short(b) });
  }));
  return out;
}

// Runs inside the scanned page: the text of the open pop-up (or the page if there isn't one).
// Each function sent into a page must be self-contained, so the pop-up finder is repeated.
function dialogText() {
  const d = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 200 && r.height > 150 && cs.visibility !== "hidden" && cs.display !== "none"; }).pop();
  return ((d || document.body).innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 15000);
}
// Runs inside the scanned page: scrolls the open pop-up down; false when it can't scroll further.
function scrollDialog() {
  const d = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 200 && r.height > 150 && cs.visibility !== "hidden" && cs.display !== "none"; }).pop();
  if (!d) return false;
  const box = [d].concat(Array.from(d.querySelectorAll("*"))).find((el) => el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
  if (!box) return false;
  const before = box.scrollTop; box.scrollTop += box.clientHeight * 0.85; return box.scrollTop !== before;
}

// Runs inside the scanned page: opens a collapsed side menu or hamburger menu.
function openMenu() {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const t = Array.from(document.querySelectorAll("button, [role=button], a")).find((b) => {
    if (!vis(b)) return false;
    const label = (b.getAttribute("aria-label") || b.title || b.innerText || "").toLowerCase().trim();
    const cls = String(b.className || "").toLowerCase();
    return /^(menu|open menu|toggle menu|toggle sidebar|open sidebar|sidebar|navigation|main menu|☰)$/.test(label) || /hamburger|burger|menu-toggle|sidebar-toggle|nav-toggle/.test(cls) || (b.getAttribute("aria-expanded") === "false" && /menu|nav|sidebar/.test(label + " " + cls + " " + (b.getAttribute("aria-controls") || "")));
  });
  if (!t) return false;
  t.click(); return true;
}

// Runs inside the scanned page: looks for one section by clicking around. First what's on the page,
// then the side / hamburger menu, then collapsed menu groups, then the account menu.
// Marks the best match with data-ccp-find and says where it was found.
async function findSection(src, opts) {
  const re = new RegExp(src, "i"), no = opts.not ? new RegExp(opts.not, "i") : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HELP = /(^|\.)(help|support|faq|blog|news|docs|community)\.|\/(help|support|faq|articles?|blog|news|knowledge|guides?|how-to)\b|how-to-/i;
  const DENY = /claim(?!\s*history)|deposit(?!\s*history)|withdraw(?!al\s*history|\s*history)|wallet|\bbet\b|place bet|buy|purchase|spin now|log ?out|sign ?out|delete|remove|cancel|send|submit|accept|decline|redeem|activate|opt[- ]?in|subscribe/i;
  const host = location.hostname.replace(/^www\./, ""), base = host.split(".").slice(-2).join(".");
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ");
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const inMenu = (el) => !!el.closest("nav, aside, header, [role=navigation], [role=menu], [class*=sidebar], [class*=Sidebar], [class*=menu], [class*=Menu], [class*=drawer], [class*=Drawer]");
  const realHref = (el) => {
    if (el.tagName !== "A" || !el.getAttribute("href") || /^(#|javascript:)/i.test(el.getAttribute("href"))) return "";
    try { const u = new URL(el.href, location.href); return /^https?:$/.test(u.protocol) ? u.toString() : ""; } catch (e) { return ""; }
  };
  function search() {
    let best = null;
    document.querySelectorAll("a, button, [role=button], [role=menuitem], [role=link], [role=tab], summary").forEach((el) => {
      if (!shown(el) || el.matches("[role=switch], input, select, textarea") || el.querySelectorAll("a, button").length > 1) return;
      const t = textOf(el).slice(0, 80), href = realHref(el);
      let path = "";
      if (href) {
        const u = new URL(href);
        if (u.hostname.replace(/^www\./, "").split(".").slice(-2).join(".") !== base) return;
        path = decodeURIComponent(u.pathname);
      }
      const byText = t && t.length <= 40 && re.test(t), byPath = path && re.test(path);
      if (!byText && !byPath) return;
      if (no && no.test(t + " " + path)) return;
      if (!opts.popup && t && DENY.test(t)) return;
      let score = 0;
      if (byText) score += 3;
      if (byPath) score += 1;
      if (t.length <= 25) score += 1;
      if (inMenu(el)) score += 2;
      if (el.closest("footer")) score -= 1;
      if (href && HELP.test(new URL(href).hostname + new URL(href).pathname) && !opts.help) score -= 6;
      if (!opts.help && /terms|conditions|requirement|policy|rules/i.test(t + " " + path)) score -= 3;
      if (opts.popup && !href) score += 3;
      if (opts.popup && href && /help|faq|how|article/i.test(href)) score -= 6;
      if (!best || score > best.score) best = { el, score, text: t, href };
    });
    return best && best.score > -2 ? best : null;
  }
  // a strong match (clear text, in a menu) ends the search; weaker ones are kept while we look further
  let top = null;
  const consider = (where) => { const h = search(); if (h && (!top || h.score > top.score)) top = Object.assign(h, { where }); return top && top.score >= 6; };
  const done = () => { if (!top) return null; top.el.setAttribute("data-ccp-find", "1"); return { text: top.text, href: top.href, where: top.where }; };
  if (consider("on the page")) return done();
  // the hamburger / side menu
  const toggle = Array.from(document.querySelectorAll("button, [role=button], a")).find((b) => {
    if (!shown(b) || b.getAttribute("aria-expanded") === "true") return false;
    const label = (b.getAttribute("aria-label") || b.title || b.innerText || "").toLowerCase().trim();
    const cls = String(b.className || "").toLowerCase();
    return /^(menu|open menu|toggle menu|toggle sidebar|open sidebar|sidebar|navigation|main menu|☰)$/.test(label) || /hamburger|burger|menu-toggle|sidebar-toggle|nav-toggle/.test(cls) || (b.getAttribute("aria-expanded") === "false" && /menu|nav|sidebar/.test(label + " " + cls + " " + (b.getAttribute("aria-controls") || "")));
  });
  if (toggle) { toggle.click(); await sleep(800); if (consider("in the side menu")) return done(); }
  // collapsed groups inside menus ("More", "Promotions ▸"…)
  const groups = Array.from(document.querySelectorAll("nav [aria-expanded=false], aside [aria-expanded=false], header [aria-expanded=false], [class*=sidebar] [aria-expanded=false], [class*=menu] [aria-expanded=false], nav summary, aside summary"))
    .filter((el) => shown(el) && !DENY.test(textOf(el))).slice(0, 8);
  for (const g of groups) {
    g.click(); await sleep(500);
    if (consider("under “" + textOf(g).slice(0, 30) + "” in the menu")) return done();
  }
  // "More" buttons in menus without aria attributes
  const more = Array.from(document.querySelectorAll("nav button, nav a, aside button, header button, [class*=sidebar] button, [class*=menu] button")).filter((el) => shown(el) && /^(more|show more|mehr|más|plus|altro)\b/i.test(textOf(el))).slice(0, 2);
  for (const m of more) { m.click(); await sleep(500); if (consider("under “More”")) return done(); }
  // the account / profile menu (logged in)
  const acct = Array.from(document.querySelectorAll("header button, header [role=button], header a, [class*=header] button, [class*=Header] button")).find((b) => {
    if (!shown(b)) return false;
    const label = (b.getAttribute("aria-label") || b.title || "") + " " + String(b.className || "") + " " + (b.innerText || "").slice(0, 30);
    return /account|profile|avatar|user[-_ ]?menu|my[-_ ]?account|\buser\b/i.test(label) && !/log ?out|sign ?out|deposit|wallet|cashier/i.test(b.innerText || "");
  });
  if (acct) { acct.click(); await sleep(900); if (consider("in the account menu")) return done(); }
  return done();
}

// Runs inside the scanned page: clicks what findSection marked.
function clickFound() {
  const el = document.querySelector("[data-ccp-find]");
  if (!el) return false;
  el.scrollIntoView({ block: "center" }); el.click();
  return true;
}

// Runs inside the scanned page: clicks one marked tab and brings it into view.
function clickTab(i) {
  const b = document.querySelector('[data-ccp-tab="' + i + '"]');
  if (!b) return null;
  b.scrollIntoView({ block: "start" }); window.scrollBy(0, -120);
  b.click();
  return location.href;
}

async function capture(windowId) {
  // Chrome allows about two captures per second.
  await sleep(650);
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 72 });
}


async function capture(windowId) {
  // Chrome allows about two captures per second.
  await sleep(650);
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 72 });
}
const bare = (u) => String(u || "").split("#")[0];
const currentUrl = async (tabId) => (await chrome.tabs.get(tabId)).url;

async function freshPage(tabId, url) {
  await navigate(tabId, url);
  await sleep(2500);
  await run(tabId, dismissOverlays).catch(() => 0);
  await sleep(900);
}

// Photographs a page top to bottom, each tab (Weekly / Monthly…), and optionally opens details.
// With stay = true it photographs what's on screen now instead of opening the address.
async function scanPage(tabId, windowId, url, opts) {
  if (!opts.stay) await freshPage(tabId, url);
  const info = await run(tabId, pageInfo);
  const step = Math.max(200, Math.floor(info.innerHeight * 0.9));
  const shots = [], labels = [];
  let lastPos = -1;
  for (let k = 0; k < MAX_SCROLL_SHOTS; k++) {
    const pos = await run(tabId, scrollToY, [k * step]);
    if (k > 0 && pos === lastPos) break; // didn't move: we're at the bottom
    lastPos = pos;
    await sleep(600);
    shots.push(await capture(windowId)); labels.push(k ? "scrolled down " + k : "top of page");
    if ((k + 1) * step >= info.scrollHeight - 50) break;
  }
  let text = info.text;
  const back = async () => { if (opts.stay) return false; await freshPage(tabId, url); return true; };
  await run(tabId, scrollToY, [0]).catch(() => 0); await sleep(300);
  const tabs = await run(tabId, findTabs).catch(() => []) || [];
  for (const t of tabs) {
    const before = bare(await currentUrl(tabId));
    const after = await run(tabId, clickTab, [t.i]).catch(() => null);
    if (!after) continue;
    await sleep(1500);
    if (bare(after) !== before || bare(await currentUrl(tabId)) !== before) { await back(); break; } // it was really a link
    shots.push(await capture(windowId)); labels.push("tab: " + t.text);
    const tinfo = await run(tabId, pageInfo).catch(() => null);
    if (tinfo) text += "\n\n--- Tab: " + t.text + " ---\n" + tinfo.text.slice(0, 6000);
  }
  if (opts.details) {
    await run(tabId, scrollToY, [0]).catch(() => 0); await sleep(300);
    const details = await run(tabId, findDetails).catch(() => []) || [];
    for (const d of details) {
      const before = bare(await currentUrl(tabId));
      const clicked = await run(tabId, clickDetail, [d]).catch(() => null);
      if (!clicked) continue;
      await sleep(1800);
      if (bare(await currentUrl(tabId)) !== before) {
        await waitForLoad(tabId, 8000); await sleep(1200);
        shots.push(await capture(windowId)); labels.push("opened: " + d);
        const di = await run(tabId, pageInfo).catch(() => null);
        if (di) text += "\n\n--- Opened: " + d + " ---\n" + di.text.slice(0, 5000);
        if (!(await back())) break;
      } else if (await run(tabId, hasDialog).catch(() => false)) {
        shots.push(await capture(windowId)); labels.push("opened: " + d);
        text += "\n\n--- Opened: " + d + " ---\n" + String(await run(tabId, dialogText).catch(() => "")).slice(0, 5000);
        if (!(await back())) break;
      } else {
        shots.push(await capture(windowId)); labels.push("expanded: " + d);
      }
    }
  }
  await run(tabId, scrollToY, [0]).catch(() => 0);
  return { title: info.title, text: text.slice(0, 40000), shots, shotLabels: labels };
}

// The pop-up that's open now, scrolled through.
async function scanDialog(tabId, windowId, what) {
  const shots = [await capture(windowId)], labels = ["pop-up after clicking " + what];
  for (let k = 1; k < MAX_SCROLL_SHOTS; k++) {
    const moved = await run(tabId, scrollDialog).catch(() => false);
    if (!moved) break;
    await sleep(600);
    shots.push(await capture(windowId)); labels.push("pop-up scrolled " + k);
  }
  return { title: "", text: await run(tabId, dialogText).catch(() => ""), shots, shotLabels: labels };
}

// The site's menu, opened and photographed, with its entries as text.
async function scanMenu(tabId, windowId, pg) {
  await freshPage(tabId, pg.url);
  await run(tabId, scrollToY, [0]).catch(() => 0);
  await run(tabId, openMenu).catch(() => false);
  await sleep(900);
  return { title: "", text: "Site menu entries:\n" + (pg.menu || []).map((m) => "- " + m.text + (m.href ? " (" + m.href + ")" : "")).join("\n"), shots: [await capture(windowId)], shotLabels: ["menu open"] };
}

// One section from the checklist: start on the homepage, click around until it turns up, then photograph it.
async function scanFind(tabId, windowId, pg, results, scanned) {
  await freshPage(tabId, pg.url);
  const hit = await run(tabId, findSection, [pg.words, { popup: pg.popup, help: pg.help, not: pg.not }]).catch(() => null);
  if (!hit) return { error: "Couldn't find it on the site" };
  const found = "found “" + hit.text.slice(0, 30) + "” " + hit.where;
  const sameAs = (u) => { const r = scanned.get(bare(u)); if (r) { r.label += " + " + pg.label; r.hint += "," + pg.cat; } return r; };
  if (hit.href) {
    if (sameAs(hit.href)) return { merged: true };
    return Object.assign({ url: hit.href, found }, await scanPage(tabId, windowId, hit.href, { details: pg.details }));
  }
  // a button or menu entry without an address: click it and see what happens
  const before = bare(await currentUrl(tabId));
  if (!(await run(tabId, clickFound).catch(() => false))) return { error: "Couldn't click “" + hit.text + "”" };
  await sleep(2200);
  const now = await currentUrl(tabId);
  if (bare(now) !== before) {
    await waitForLoad(tabId, 8000); await sleep(1200);
    if (sameAs(now)) return { merged: true };
    return Object.assign({ url: now, found }, await scanPage(tabId, windowId, now, { details: pg.details, stay: true }));
  }
  if (await run(tabId, hasDialog).catch(() => false)) return Object.assign({ url: now, found, type: "popup" }, await scanDialog(tabId, windowId, hit.text));
  // the page changed without a new address (single-page sites): photograph what's showing
  return Object.assign({ url: now, found }, await scanPage(tabId, windowId, now, { details: pg.details, stay: true }));
}

async function runScan({ tabId, pages, run: runLabel, site }) {
  const tab = await chrome.tabs.get(tabId);
  const startUrl = tab.url;
  const total = pages.length;
  await chrome.storage.local.set({ scanStatus: { state: "running", done: 0, total, current: "" } });
  const results = [], scanned = new Map();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    await chrome.storage.local.set({ scanStatus: { state: "running", done: i, total, current: pg.type === "find" ? "looking for " + pg.label : pg.label } });
    const base = { url: pg.url, label: pg.label, hint: pg.cat || "", type: pg.type };
    try {
      if (pg.type === "menu") { results.push(Object.assign(base, await scanMenu(tabId, tab.windowId, pg))); continue; }
      if (pg.type === "find") {
        const r = await scanFind(tabId, tab.windowId, pg, results, scanned);
        if (r.merged) continue; // same page as a section already scanned
        const out = Object.assign(base, r, { type: r.type || "page" });
        if (r.found) out.label = pg.label + " (" + r.found + ")";
        if (!r.error) scanned.set(bare(out.url), out);
        if (r.error) out.shots = [];
        results.push(out); continue;
      }
      const r = await scanPage(tabId, tab.windowId, pg.url, { details: pg.details });
      const out = Object.assign(base, r);
      scanned.set(bare(pg.url), out);
      results.push(out);
    } catch (err) {
      results.push(Object.assign(base, { error: String(err && err.message || err), shots: [] }));
    }
  }
  try { await navigate(tabId, startUrl); } catch (e) { /* ignore */ }
  const scan = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), site, run: runLabel, at: new Date().toISOString(), pages: results };
  await chrome.storage.local.set({ pendingScan: scan, scanStatus: { state: "done", done: total, total } });
  const { plannerUrl } = await chrome.storage.local.get("plannerUrl");
  await chrome.tabs.create({ url: plannerUrl || PLANNER_URL });
}
