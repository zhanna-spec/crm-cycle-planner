// Cycle Planner Site Scanner - does the scanning so it keeps going if the popup closes.

const PLANNER_URL = "https://zhanna-spec.github.io/crm-cycle-planner/#scan";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SCROLL_SHOTS = 5;

// Stopping: "keep" sends what's done so far to the planner, "discard" throws the scan away.
let scanning = false, stopMode = null;
class Stopped extends Error {}
function checkStop() { if (stopMode) throw new Stopped("stopped"); }

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "stop") {
    if (scanning) stopMode = msg.mode === "discard" ? "discard" : "keep";
    else chrome.storage.local.set({ scanStatus: { state: "stopped" } }); // nothing is running (an old status)
    reply({ ok: true });
  }
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
  checkStop();
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

// Runs inside the scanned page: scrolls to y and says where it ended up.
// Scrolls whatever holds the content in the middle of the screen (many sites scroll an inner panel),
// jumps instead of gliding, and waits a moment so content that loads on scroll can appear.
async function scrollToY(y) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // how many game tiles are on screen: a screen full of them is a game lobby, not content we need
  const games = () => {
    const seen = new Set();
    document.querySelectorAll("img, [style*=background-image]").forEach((im) => {
      const r = im.getBoundingClientRect();
      if (r.width < 70 || r.width > 420 || r.height < 50 || r.bottom < 0 || r.top > window.innerHeight) return;
      const ratio = r.width / r.height; if (ratio < 0.5 || ratio > 1.9) return;
      const tile = im.closest("a, [class*=game], [class*=Game], [class*=tile], [class*=Tile], [class*=thumb], [class*=card]") || im;
      const hint = (tile.getAttribute("href") || "") + " " + String(tile.getAttribute("class") || "") + " " + (tile.getAttribute("data-testid") || "");
      if (!/game|slot|play|casino|live|provider|tile|thumb/i.test(hint)) return;
      seen.add(Math.round(r.left / 20) + ":" + Math.round((r.top + window.scrollY) / 20));
    });
    return seen.size;
  };
  const root = document.scrollingElement || document.documentElement;
  const scrolls = (el) => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > window.innerHeight * 0.4 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
  let box = null;
  for (let e = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.6); e && e !== document.body && e !== document.documentElement; e = e.parentElement) if (scrolls(e)) { box = e; break; }
  const winExtra = root.scrollHeight - window.innerHeight;
  // a smaller scrolling box (a table, a game list) doesn't count when the page itself scrolls
  if (box && winExtra > 200 && box.clientHeight < window.innerHeight * 0.8) box = null;
  if (!box && winExtra < 50) {
    // nothing under the middle scrolls and the window doesn't either: take the biggest scrolling area
    let bestH = 50;
    document.querySelectorAll("main, div, section").forEach((el) => { const extra = el.scrollHeight - el.clientHeight; if (extra > bestH && scrolls(el)) { box = el; bestH = extra; } });
  }
  if (box) {
    box.scrollTo({ top: y, behavior: "instant" });
    await sleep(400);
    return { pos: Math.round(box.scrollTop), max: box.scrollHeight - box.clientHeight, view: box.clientHeight, games: games() };
  }
  window.scrollTo({ top: y, behavior: "instant" });
  await sleep(400);
  return { pos: Math.round(window.scrollY), max: root.scrollHeight - window.innerHeight, view: window.innerHeight, games: games() };
}

// Runs inside the scanned page: finds things worth opening for details (See how rewards work,
// Claim history, Rules, Learn more, a level card, collapsed sections). Never anything that acts.
function findDetails() {
  const ALLOW = /see how|how (it|this|rewards?|points?|levels?|vip) works?|how to (earn|level)|learn more|more info|details|read more|\brules\b|terms|view all|show more|see all|levels?\b|ranks?\b|tiers?\b|benefits|perks|history|explained|faq|info\b|rookie|bronze|silver|gold|platinum|diamond|\bxp\b|\bvip\b/i;
  const DENY = /claim(?!\s*history)|deposit(?!\s*history)|withdraw(?!al\s*history|\s*history)|wallet|\bbet\b|place bet|play|buy|purchase|spin now|log ?out|sign ?out|delete|remove|cancel|send|submit|chat|support|contact|accept|decline|join|register|sign ?up|log ?in|redeem|activate|opt[- ]?in|subscribe|switch to|enable|disable|copy|share|unlock|get started|start now|grab|get (the |your )?bonus|collect|upgrade/i;
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
    .filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 200 && r.height > 150 && cs.visibility !== "hidden" && cs.display !== "none"; })
    .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
  return ((d || document.body).innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 15000);
}
// Runs inside the scanned page: scrolls the open pop-up down; false when it can't scroll further.
function scrollDialog() {
  const d = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 200 && r.height > 150 && cs.visibility !== "hidden" && cs.display !== "none"; })
    .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
  if (!d) return false;
  // the part with the most to scroll (a terms panel next to a picture, say)
  const box = [d].concat(Array.from(d.querySelectorAll("*"))).filter((el) => el.scrollHeight > el.clientHeight + 40 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY))
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
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
  const DENY = /claim(?!\s*history)|deposit(?!\s*history)|withdraw(?!al\s*history|\s*history)|wallet|^bet( now)?$|place bet|buy|purchase|spin now|log ?out|sign ?out|delete|remove|cancel|send|submit|accept|decline|redeem|activate|opt[- ]?in|subscribe/i;
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
      if (opts.linkOnly && (!href || /regist|sign-?up|login|deposit|cashier|wallet|account/i.test(href))) return;
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

// Runs inside the scanned page: moves the first banner carousel on by one slide.
// Returns the text of the slide now showing, or null when there's no carousel.
async function carouselNext() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cls = (el) => String(el.getAttribute("class") || "");
  const roots = Array.from(document.querySelectorAll("[class*=swiper], [class*=carousel], [class*=Carousel], [class*=slider], [class*=Slider], [class*=slick], [class*=splide], [class*=glide], [class*=hero], [class*=Hero], [class*=banner], [class*=Banner], [aria-roledescription=carousel]"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 300 && r.height > 100 && r.top + window.scrollY < window.innerHeight * 2; });
  const showing = (root) => Array.from(root.querySelectorAll("[class*=slide], [class*=Slide], li, [role=group]")).filter((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 100 && r.left > -20 && r.left < window.innerWidth * 0.6 && cs.visibility !== "hidden" && +cs.opacity > 0.2;
  }).map((el) => (el.innerText || "").trim()).join(" ").slice(0, 300);
  for (const root of roots) {
    const next = Array.from(root.querySelectorAll("button, [role=button], a, div, span")).find((b) => {
      const r = b.getBoundingClientRect(); if (r.width < 8 || r.height < 8 || r.width > 120) return false;
      const l = (b.getAttribute("aria-label") || "") + " " + cls(b) + " " + (b.title || "");
      return /next|right|forward|arrow-?r/i.test(l) && !/prev|left|back/i.test(l);
    });
    const dots = Array.from(root.querySelectorAll("[class*=bullet], [class*=dot], [class*=Dot], .slick-dots button, [class*=pagination] button, [class*=indicator] button, [class*=indicator] li, [role=tab]"))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 3 && r.height > 3 && r.width < 60; });
    if (!next && dots.length < 2) continue;
    const from = showing(root);
    window.scrollTo(0, Math.max(0, root.getBoundingClientRect().top + window.scrollY - 80));
    if (next) next.click();
    else {
      const cur = dots.findIndex((d) => /active|selected|current/i.test(cls(d)) || d.getAttribute("aria-selected") === "true" || d.getAttribute("aria-current") === "true");
      dots[(cur + 1) % dots.length].click();
    }
    await sleep(900);
    return { from, to: showing(root) || "slide" };
  }
  return null;
}

// Runs inside the scanned page: finds the banner or card that talks about an offer (words in src),
// scrolls it into view and marks it. Hidden carousel slides don't count until they're showing.
// Also names a "more info" / terms button inside it, if there is one.
function findOfferBlock(src, not) {
  const re = new RegExp(src, "i"), no = not ? new RegExp(not, "i") : null;
  const MORE = /more|details|info|terms|t&c|rules|learn|read|conditions|see offer|view/i;
  const DENY = /claim|deposit|register|sign ?up|join|log ?in|play|bet now|opt[- ]?in|activate|redeem/i;
  const vw = window.innerWidth;
  const showing = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 60 || r.width > vw * 1.05 || r.left < -10 || r.right > vw + 10) return false;
    for (let e = el, i = 0; e && i < 6; e = e.parentElement, i++) { const cs = getComputedStyle(e); if (cs.visibility === "hidden" || +cs.opacity < 0.2 || cs.display === "none" || e.getAttribute("aria-hidden") === "true") return false; }
    return true;
  };
  // Start from the words themselves: only text that is actually showing counts (not a hidden slide).
  let best = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!re.test(n.nodeValue || "")) continue;
    const leaf = n.parentElement;
    if (!leaf || leaf.closest("header, nav, footer, aside, script, style, [role=dialog]")) continue;
    const lr = leaf.getBoundingClientRect();
    if (lr.width < 2 || lr.left < 0 || lr.right > vw + 2) continue;
    // climb to the banner or card around it
    let box = leaf;
    while (box && box !== document.body) {
      const r = box.getBoundingClientRect();
      if (r.width >= 150 && r.height >= 60) break;
      box = box.parentElement;
    }
    if (!box || box === document.body || !showing(box)) continue;
    const t = (box.innerText || "").trim();
    if (t.length > 1500 || (no && no.test(t.slice(0, 120)))) continue;
    const r = box.getBoundingClientRect(), area = r.width * r.height;
    if (r.height > window.innerHeight * 1.2) continue;
    if (!best || area < best.area) best = { el: box, area };
  }
  if (!best) return null;
  document.querySelectorAll("[data-ccp-block]").forEach((e) => e.removeAttribute("data-ccp-block"));
  best.el.setAttribute("data-ccp-block", "1");
  const r = best.el.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, r.top + window.scrollY - Math.max(60, (window.innerHeight - r.height) / 2)));
  const ownLink = [best.el.closest("a[href]")].concat(Array.from(best.el.querySelectorAll("a[href]"))).filter(Boolean).find((a) => {
    const raw = a.getAttribute("href") || "", t = (a.innerText || "").trim();
    if (/^(#|javascript:)/i.test(raw) || DENY.test(t)) return false;
    try { const u = new URL(a.href); return u.origin === location.origin && u.href.split("#")[0] !== location.href.split("#")[0] && !/regist|sign-?up|login|deposit|cashier|wallet/i.test(u.pathname + u.search); } catch (e) { return false; }
  });
  const btn = Array.from(best.el.querySelectorAll("a, button, [role=button]"))
    .find((b) => { const t = (b.innerText || b.getAttribute("aria-label") || "").trim(); return t && t.length <= 30 && MORE.test(t) && !DENY.test(t); });
  return { text: (best.el.innerText || "").trim().slice(0, 3000), href: ownLink ? ownLink.href : "", more: btn ? (btn.innerText || btn.getAttribute("aria-label")).trim() : "" };
}

// Runs inside the scanned page: clicks the "more info" button inside the marked offer block.
function clickInBlock(text) {
  const box = document.querySelector("[data-ccp-block]"); if (!box) return false;
  const b = Array.from(box.querySelectorAll("a, button, [role=button]")).find((x) => (x.innerText || x.getAttribute("aria-label") || "").trim() === text);
  if (!b) return false;
  b.click(); return true;
}

// Runs inside the scanned page: a short fingerprint of the text on the page (and in an open pop-up),
// to tell whether a click changed anything.
function textPrint() {
  const t = (document.body ? document.body.innerText : "").replace(/\s+/g, " ");
  let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return t.length + ":" + h;
}

// Runs inside the scanned page: finds the offer (or tournament) cards on a page: repeated blocks with
// a title and something to open. Marks each with data-ccp-card and says how to open it:
// its own link, a "More info" button, or the card itself.
function findOfferCards() {
  const ACT = /claim|deposit|register|sign ?up|join|log ?in|play|bet\b|opt[- ]?in|activate|redeem|get (the |your )?bonus|spin|unlock|grab|collect|start now|get started|jetzt|spielen|einzahl|anmelden|reclam|jugar|depositar|regístr|réclam|jouer|dépos|inscri|richied|gioca|deposita|registr|speel|claimen/i;
  const MORE = /more|details?|read|learn|terms|t&cs?|t ?& ?c|rules|conditions|info|view|see offer|find out|mehr|details|bedingungen|más|mas info|detalles|términos|plus d|savoir|détails|conditions|dettagli|scopri|termini|lees|meer|voorwaarden|^\+$|›|»|→/i;
  const vw = window.innerWidth;
  const textOf = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const host = location.hostname.replace(/^www\./, "");
  let cards = [];
  document.querySelectorAll("a, button, [role=button], h2, h3, h4, h5").forEach((seed) => {
    if (!shown(seed) || seed.closest("header, nav, footer, aside, [role=dialog], [data-ccp-skip]")) return;
    let c = seed;
    while (c && c !== document.body) { const r = c.getBoundingClientRect(); if (r.width >= 160 && r.height >= 130) break; c = c.parentElement; }
    if (!c || c === document.body) return;
    // a block without a picture is usually the text half of a banner: take the banner around it
    const pic = (el) => !!el.querySelector("img, picture, [style*=background-image], video") || /url\(/.test(getComputedStyle(el).backgroundImage);
    for (let k = 0; k < 2 && !pic(c) && c.parentElement && c.parentElement !== document.body; k++) {
      const pr = c.parentElement.getBoundingClientRect();
      if (pr.height > window.innerHeight * 1.1 || !pic(c.parentElement)) break;
      c = c.parentElement;
    }
    const r = c.getBoundingClientRect();
    if (r.height > window.innerHeight * 1.1) return; // a whole section, not a card
    // a wide block only counts as a promo banner or row when it has a picture
    if (r.width > vw * 0.75 && !c.querySelector("img, picture, [style*=background-image], video")) return;
    const t = textOf(c); if (t.length < 6 || t.length > 900) return;
    if (cards.some((x) => x === c || x.contains(c) || c.contains(x))) return;
    cards.push(c);
  });
  // cards come in sets of similar size
  cards = cards.filter((c) => { const w = c.getBoundingClientRect().width; return cards.some((o) => o !== c && Math.abs(o.getBoundingClientRect().width - w) < w * 0.15); });
  cards.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); });
  document.querySelectorAll("[data-ccp-card]").forEach((e) => e.removeAttribute("data-ccp-card"));
  return cards.slice(0, 12).map((c, i) => {
    c.setAttribute("data-ccp-card", String(i));
    const head = c.querySelector("h1, h2, h3, h4, h5, [class*=title], [class*=Title], strong, b");
    const title = ((head && textOf(head)) || textOf(c)).split(/\n| {2}/)[0].slice(0, 60);
    const links = [c.closest("a[href]")].concat(Array.from(c.querySelectorAll("a[href]"))).filter(Boolean).filter((a) => {
      const raw = a.getAttribute("href") || "";
      if (/^(#|javascript:)/i.test(raw)) return false;
      try { const u = new URL(a.href); return u.hostname.replace(/^www\./, "") === host && u.href.split("#")[0] !== location.href.split("#")[0] && !/regist|sign-?up|login|deposit|cashier|wallet/i.test(u.pathname + u.search); } catch (e) { return false; }
    });
    const link = links.find((a) => !ACT.test(textOf(a)));
    const more = Array.from(c.querySelectorAll("a, button, [role=button]")).find((b) => { const t = textOf(b); return t && t.length <= 30 && MORE.test(t) && !ACT.test(t); });
    // a small "i" / info / question-mark icon (often with no text at all)
    const info = Array.from(c.querySelectorAll("button, [role=button], a, span, div, i, svg, img")).find((b) => {
      const r = b.getBoundingClientRect(); if (r.width < 10 || r.width > 64 || r.height < 10 || r.height > 64) return false;
      const t = (b.textContent || "").trim(), l = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + String(b.getAttribute("class") || "") + " " + (b.getAttribute("alt") || "") + " " + (b.getAttribute("data-testid") || "");
      return /^(i|ⓘ|ℹ️?|\?|\+|›|»|→)$/i.test(t) || (!t || t.length <= 2) && /info|detail|more|terms|tooltip|question|help|chevron|arrow|expand|plus|open|toggle|caret/i.test(l);
    });
    if (info) info.setAttribute("data-ccp-info", String(i));
    return { i, title, href: link ? link.href : "", more: more ? textOf(more) : "", info: !!info };
  });
}

// Runs inside the scanned page: opens card i one way: its "More info" button, its info icon, or its title / picture.
function openCard(i, way, moreText) {
  const c = document.querySelector('[data-ccp-card="' + i + '"]'); if (!c) return false;
  const ACT = /claim|deposit|register|sign ?up|join|log ?in|play|bet\b|opt[- ]?in|activate|redeem|bonus$|spin|unlock|grab|collect|jetzt|spielen|reclam|jugar|réclam|jouer|gioca/i;
  const press = (el) => { ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); };
  c.scrollIntoView({ block: "center" });
  if (way === "more") {
    const b = Array.from(c.querySelectorAll("a, button, [role=button]")).find((x) => (x.innerText || x.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ") === moreText);
    if (!b) return false; press(b); return true;
  }
  if (way === "info") { const b = c.querySelector('[data-ccp-info="' + i + '"]'); if (!b) return false; press(b); return true; }
  if (way === "self") { press(c); return true; }
  const target = c.querySelector("h1, h2, h3, h4, h5, [class*=title], [class*=Title], img, picture, [style*=background-image]");
  if (!target) return false;
  const btn = target.closest("button, [role=button]");
  if (btn && ACT.test(btn.innerText || "")) return false;
  press(target); return true;
}

// Runs inside the scanned page: is a log-in or sign-up form showing (a password or e-mail field)?
function authForm() {
  return Array.from(document.querySelectorAll("input[type=password], input[type=email], input[autocomplete=username], input[name*=email i], input[name*=password i]"))
    .some((el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 8 && getComputedStyle(el).visibility !== "hidden"; });
}

// Runs inside the scanned page: closes the open pop-up with its close button (×, Close) or Escape.
function closeDialog() {
  const d = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 150; })
    .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
  const scope = d || document;
  const btn = Array.from(scope.querySelectorAll("button, [role=button], a, span, div, svg")).find((b) => {
    const r = b.getBoundingClientRect(); if (r.width < 8 || r.width > 80 || r.height < 8 || r.height > 80) return false;
    const t = (b.textContent || "").trim(), l = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + String(b.getAttribute("class") || "");
    return /^(×|✕|✖|x|close|schließen|cerrar|fermer|chiudi|sluiten)$/i.test(t) || (!t || t.length <= 1) && /close|dismiss|schlie|cerrar|fermer|chiudi/i.test(l);
  });
  if (btn) ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) => btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  return !!btn;
}

// Runs inside the scanned page: opens the terms inside an open pop-up ("Terms", "T&Cs", "Show more").
function openDialogTerms() {
  const d = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], [class*=modal], [class*=Modal], [class*=drawer], [class*=Drawer]"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 150; })
    .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
  if (!d) return false;
  const b = Array.from(d.querySelectorAll("button, [role=button], summary, a, [aria-expanded=false]")).find((x) => {
    const t = (x.innerText || "").trim();
    return t && t.length <= 40 && /terms|t&cs?|conditions|rules|show more|read more|full details/i.test(t) && !/claim|deposit|accept|agree|join|play/i.test(t) && !(x.tagName === "A" && x.getAttribute("href") && !/^#/.test(x.getAttribute("href")));
  });
  if (!b) return false;
  b.click(); return true;
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
  checkStop();
  // Chrome allows about two captures per second.
  await sleep(650);
  checkStop();
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 72 });
}

// A small grey version of a screenshot, to tell near-identical screenshots apart.
async function printOf(dataUrl) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = new OffscreenCanvas(160, 100), x = c.getContext("2d");
  x.drawImage(bmp, 0, 0, 160, 100);
  const d = x.getImageData(0, 0, 160, 100).data, g = new Uint8Array(16000);
  for (let i = 0; i < 16000; i++) g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return g;
}
// The same picture when hardly any spot differs (JPEG noise aside).
// The right edge (the scrollbar moves when scrolling) is left out.
function samePrint(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (i % 160 < 155 && Math.abs(a[i] - b[i]) > 16 && ++n > 12) return false; return true; }
// Drops screenshots that look the same as one already kept (a scroll that didn't move the content,
// a click that changed nothing, a slide shown twice).
async function dedupe(r) {
  const shots = [], labels = [], prints = [];
  for (let i = 0; i < r.shots.length; i++) {
    let pr = null;
    try { pr = await printOf(r.shots[i]); } catch (e) { /* keep it if it can't be compared */ }
    if (pr && prints.some((q) => q && samePrint(pr, q))) continue;
    prints.push(pr); shots.push(r.shots[i]); labels.push((r.shotLabels || [])[i] || "");
  }
  return Object.assign(r, { shots, shotLabels: labels });
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
  const shots = [], labels = [];
  // top to bottom; the end is checked again at each step because pages often grow while scrolling
  const first = await run(tabId, scrollToY, [0]).catch(() => null) || { pos: 0, max: 0, view: info.innerHeight };
  const step = Math.max(200, Math.floor(first.view * 0.85));
  // The aim is the page's content and structure, not everything in it: one screen of a game lobby
  // is enough, and content that keeps loading while scrolling isn't followed.
  let lastPos = -1, gameScreens = 0;
  for (let k = 0; k < MAX_SCROLL_SHOTS; k++) {
    const at = k ? await run(tabId, scrollToY, [k * step]).catch(() => null) : first;
    if (!at || (k > 0 && at.pos <= lastPos + 5)) break; // didn't move: we're at the bottom
    if (at.games >= 8 && ++gameScreens > 1) break; // a second screen of game tiles
    if (k > 1 && at.max > first.max * 1.4 + first.view) break; // the page keeps growing (endless loading)
    lastPos = at.pos;
    await sleep(300);
    shots.push(await capture(windowId)); labels.push(k ? "scrolled down " + k : "top of page");
    if (at.pos >= at.max - 5) break;
  }
  // text again after scrolling: content that loads on scroll is there now
  const later = await run(tabId, pageInfo).catch(() => null);
  let text = later && later.text.length > info.text.length ? later.text : info.text;
  // banner carousels: photograph each slide (up to 5)
  if (opts.banners) {
    const seen = new Set();
    for (let k = 0; k < 5; k++) {
      const mv = await run(tabId, carouselNext).catch(() => null);
      if (!mv) break;
      seen.add(mv.from);
      const slide = mv.to;
      if (seen.has(slide)) break;
      seen.add(slide);
      shots.push(await capture(windowId)); labels.push("banner slide " + (k + 2));
      text += "\n\n--- Banner slide " + (k + 2) + " ---\n" + slide;
    }
  }
  const back = async () => { if (opts.stay) return false; await freshPage(tabId, url); return true; };
  await run(tabId, scrollToY, [0]).catch(() => 0); await sleep(300);
  const tabs = await run(tabId, findTabs).catch(() => []) || [];
  for (const t of tabs) {
    const before = bare(await currentUrl(tabId)), tp = await run(tabId, textPrint).catch(() => "");
    const after = await run(tabId, clickTab, [t.i]).catch(() => null);
    if (!after) continue;
    await sleep(1500);
    if (bare(after) !== before || bare(await currentUrl(tabId)) !== before) { await back(); break; } // it was really a link
    if (tp && tp === await run(tabId, textPrint).catch(() => "")) continue; // the tab changed nothing
    shots.push(await capture(windowId)); labels.push("tab: " + t.text);
    const tinfo = await run(tabId, pageInfo).catch(() => null);
    if (tinfo) text += "\n\n--- Tab: " + t.text + " ---\n" + tinfo.text.slice(0, 6000);
  }
  if (opts.details) {
    await run(tabId, scrollToY, [0]).catch(() => 0); await sleep(300);
    const details = await run(tabId, findDetails).catch(() => []) || [];
    for (const d of details) {
      const before = bare(await currentUrl(tabId)), tp = await run(tabId, textPrint).catch(() => "");
      const clicked = await run(tabId, clickDetail, [d]).catch(() => null);
      if (!clicked) continue;
      await sleep(1800);
      if (bare(await currentUrl(tabId)) === before && tp && tp === await run(tabId, textPrint).catch(() => "")) continue; // nothing opened
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
        const ei = await run(tabId, pageInfo).catch(() => null); // what opened (terms, rules) is in the text now
        if (ei) text += "\n\n--- Opened: " + d + " ---\n" + ei.text.slice(0, 6000);
      }
    }
  }
  await run(tabId, scrollToY, [0]).catch(() => 0);
  return dedupe({ title: info.title, text: text.slice(0, 40000), shots, shotLabels: labels });
}

// Opens every offer (or tournament) card on a page one by one and photographs what each shows,
// with its terms. Each becomes its own entry, so it's read with its own conditions.
async function scanCards(tabId, windowId, url, pg) {
  const out = [], seen = new Set();
  let cards = await run(tabId, findOfferCards).catch(() => []) || [];
  const kindWord = pg.cardLabel || "Offer";
  for (let n = 0; n < Math.min(cards.length, 12); n++) {
    const c = cards[n], label = kindWord + ": " + (c.title || "card " + (n + 1));
    await chrome.storage.local.set({ scanStatus: Object.assign((await chrome.storage.local.get("scanStatus")).scanStatus || {}, { current: "opening " + label }) });
    try {
      if (c.href) {
        if (seen.has(bare(c.href)) || bare(c.href) === bare(url)) continue;
        seen.add(bare(c.href));
        const r = await scanPage(tabId, windowId, c.href, { details: true });
        out.push(Object.assign({ url: c.href, label, hint: pg.cat, type: "page" }, r));
        await freshPage(tabId, url); cards = await run(tabId, findOfferCards).catch(() => cards) || cards;
        continue;
      }
      const ways = (c.more ? ["more"] : []).concat(c.info ? ["info"] : [], ["card", "self"]);
      let opened = null;
      for (const way of ways) {
        const before = bare(await currentUrl(tabId)), tp = await run(tabId, textPrint).catch(() => ""), authBefore = await run(tabId, authForm).catch(() => false);
        if (!(await run(tabId, openCard, [c.i, way, c.more]).catch(() => false))) continue;
        await sleep(1800);
        const now = await currentUrl(tabId);
        // a log-in / sign-up form or the cashier isn't the offer: back out and try the next way
        const wrong = /regist|sign-?up|signup|login|log-in|deposit|cashier|wallet|auth/i.test(new URL(now).pathname + new URL(now).search + new URL(now).hash) || (!authBefore && await run(tabId, authForm).catch(() => false));
        if (wrong) { await freshPage(tabId, url); cards = await run(tabId, findOfferCards).catch(() => cards) || cards; continue; }
        if (bare(now) !== before) { opened = { kind: "page", now }; break; }
        if (await run(tabId, hasDialog).catch(() => false)) { opened = { kind: "dialog", now, how: way === "more" ? c.more : way === "info" ? "the info icon" : c.title }; break; }
        if (tp && tp !== await run(tabId, textPrint).catch(() => "")) { opened = { kind: "inline", now }; break; }
      }
      if (!opened) continue; // nothing opened this card
      const now = opened.now;
      if (opened.kind === "page") {
        await waitForLoad(tabId, 8000); await sleep(1200);
        if (!seen.has(bare(now))) { seen.add(bare(now)); out.push(Object.assign({ url: now, label, hint: pg.cat, type: "page" }, await scanPage(tabId, windowId, now, { details: true, stay: true }))); }
      } else if (opened.kind === "dialog") {
        if (await run(tabId, openDialogTerms).catch(() => false)) await sleep(1200);
        out.push(Object.assign({ url: now, label, hint: pg.cat, type: "popup" }, await scanDialog(tabId, windowId, opened.how)));
        // close it before the next offer; reload the page only if it won't close
        await run(tabId, closeDialog).catch(() => false); await sleep(700);
        if (!(await run(tabId, hasDialog).catch(() => true)) && bare(await currentUrl(tabId)) === bare(url)) continue;
      } else {
        out.push(Object.assign({ url: now, label, hint: pg.cat, type: "inline" }, await dedupe({ title: "", text: (await run(tabId, pageInfo).catch(() => ({ text: "" }))).text, shots: [await capture(windowId)], shotLabels: ["opened " + label] })));
      }
      await freshPage(tabId, url); cards = await run(tabId, findOfferCards).catch(() => cards) || cards;
    } catch (e) {
      try { await freshPage(tabId, url); cards = await run(tabId, findOfferCards).catch(() => cards) || cards; } catch (e2) { break; }
    }
  }
  return out;
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
  return dedupe({ title: "", text: await run(tabId, dialogText).catch(() => ""), shots, shotLabels: labels });
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
// An offer that may not have its own page (a welcome offer): look for it in the homepage banners
// and as a card on the promotions page, and open the card's "more info" or terms.
async function scanOffer(tabId, windowId, pg, results) {
  const shots = [], labels = [], where = [];
  let text = "";
  // 1. homepage banners, clicking through the carousel
  await freshPage(tabId, pg.url);
  const seen = new Set();
  for (let k = 0; k < 8; k++) {
    const b = await run(tabId, findOfferBlock, [pg.words, pg.not || ""]).catch(() => null);
    if (b) {
      await sleep(500);
      shots.push(await capture(windowId)); labels.push(pg.label + " on the homepage");
      text += "--- On the homepage ---\n" + b.text + "\n\n"; where.push("homepage banner");
      break;
    }
    const mv = await run(tabId, carouselNext).catch(() => null);
    if (!mv) break;
    seen.add(mv.from);
    if (seen.has(mv.to) && k > 0) break;
    seen.add(mv.to);
  }
  // 2. the promotions page
  let promo = results.find((r) => !r.error && /(^|,)promotions(,|$)/.test(r.hint || ""));
  let promoUrl = promo && promo.url;
  if (!promoUrl && pg.promo) {
    await freshPage(tabId, pg.url);
    const hit = await run(tabId, findSection, [pg.promo.words, { not: pg.promo.not, linkOnly: true }]).catch(() => null);
    promoUrl = hit && hit.href;
  }
  if (promoUrl) {
    await freshPage(tabId, promoUrl);
    const b = await run(tabId, findOfferBlock, [pg.words, pg.not || ""]).catch(() => null);
    if (b) {
      await sleep(500);
      shots.push(await capture(windowId)); labels.push(pg.label + " card on the promotions page");
      text += "--- On the promotions page ---\n" + b.text + "\n\n"; where.push("promotions page");
      if (b.href) {
        const r = await scanPage(tabId, windowId, b.href, { details: true });
        r.shots.forEach((sh, i) => { shots.push(sh); labels.push("opened the offer: " + r.shotLabels[i]); });
        text += "--- The offer's own page ---\n" + r.text.slice(0, 15000);
      } else if (b.more) {
        const before = bare(await currentUrl(tabId));
        if (await run(tabId, clickInBlock, [b.more]).catch(() => false)) {
          await sleep(1800);
          if (bare(await currentUrl(tabId)) !== before) {
            await waitForLoad(tabId, 8000); await sleep(1200);
            const r = await scanPage(tabId, windowId, "", { stay: true });
            r.shots.forEach((sh, i) => { shots.push(sh); labels.push("opened “" + b.more + "”: " + r.shotLabels[i]); });
            text += "--- Opened “" + b.more + "” ---\n" + r.text.slice(0, 12000);
          } else {
            if (await run(tabId, hasDialog).catch(() => false) && await run(tabId, openDialogTerms).catch(() => false)) await sleep(1200);
            shots.push(await capture(windowId)); labels.push("opened “" + b.more + "”");
            const more = (await run(tabId, hasDialog).catch(() => false)) ? await run(tabId, dialogText).catch(() => "") : (await run(tabId, pageInfo).catch(() => ({ text: "" }))).text;
            text += "--- Opened “" + b.more + "” ---\n" + String(more).slice(0, 8000);
            for (let k = 1; k < 4 && (await run(tabId, scrollDialog).catch(() => false)); k++) { await sleep(600); shots.push(await capture(windowId)); labels.push("opened “" + b.more + "”, scrolled " + k); }
          }
        }
      }
    }
  }
  if (!shots.length) return { error: "Couldn't find it on the homepage or promotions page" };
  return dedupe({ url: promoUrl || pg.url, found: "found on the " + where.join(" and "), title: "", text, shots, shotLabels: labels, noIndex: true });
}

async function scanFind(tabId, windowId, pg, results, scanned) {
  await freshPage(tabId, pg.url);
  const hit = await run(tabId, findSection, [pg.words, { popup: pg.popup, help: pg.help, not: pg.not, linkOnly: pg.content }]).catch(() => null);
  // offers without their own page are looked for in banners and on the promotions page
  if (pg.content && (!hit || scanned.has(bare(hit.href)))) return scanOffer(tabId, windowId, pg, results);
  if (!hit) return { error: "Couldn't find it on the site" };
  const found = "found “" + hit.text.slice(0, 30) + "” " + hit.where;
  const sameAs = (u) => { const r = scanned.get(bare(u)); if (r) { r.label += " + " + pg.label; r.hint += "," + pg.cat; } return r; };
  if (hit.href) {
    if (sameAs(hit.href)) return { merged: true };
    const r = Object.assign({ url: hit.href, found }, await scanPage(tabId, windowId, hit.href, { details: pg.details && !pg.cards }));
    if (pg.cards) { await freshPage(tabId, hit.href); r.extra = await scanCards(tabId, windowId, hit.href, pg); }
    return r;
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

async function runScan({ tabId, pages, run: runLabel, site, skip }) {
  const tab = await chrome.tabs.get(tabId);
  const startUrl = tab.url;
  const total = pages.length;
  scanning = true; stopMode = null;
  await chrome.storage.local.set({ scanStatus: { state: "running", done: 0, total, current: "" } });
  const results = [], scanned = new Map();
  try {
  for (let i = 0; i < pages.length; i++) {
    if (stopMode) break;
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
        if (!r.error && !r.noIndex) scanned.set(bare(out.url), out);
        delete out.noIndex;
        const extra = out.extra || []; delete out.extra;
        if (r.error) out.shots = [];
        results.push(out);
        // offers opened in a pop-up or in place share the page's address but are their own entries
        extra.forEach((x) => { const own = x.type === "page"; if (!own || !scanned.has(bare(x.url))) { results.push(Object.assign(x, { type: own ? "page" : "popup" })); if (own) scanned.set(bare(x.url), x); } });
        continue;
      }
      const r = await scanPage(tabId, tab.windowId, pg.url, { details: pg.details, banners: pg.cat === "homepage" });
      const out = Object.assign(base, r);
      scanned.set(bare(pg.url), out);
      results.push(out);
    } catch (err) {
      if (stopMode) break; // stopped in the middle of this section: leave it out
      results.push(Object.assign(base, { error: String(err && err.message || err), shots: [] }));
    }
  }
  } finally { scanning = false; }
  const mode = stopMode; stopMode = null;
  try { await navigate(tabId, startUrl); } catch (e) { /* ignore */ }
  const done = results.filter((r) => r.shots && r.shots.length);
  if (mode === "discard" || (mode && !done.length)) {
    await chrome.storage.local.set({ scanStatus: { state: "stopped", message: mode === "discard" ? "" : "Nothing was finished yet, so there's nothing to import." } });
    return;
  }
  const scan = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), site, run: runLabel, at: new Date().toISOString(), pages: results, skip: skip || [] };
  await chrome.storage.local.set({ pendingScan: scan, scanStatus: { state: "done", done: total, total, partial: !!mode, kept: done.length } });
  const { plannerUrl } = await chrome.storage.local.get("plannerUrl");
  await chrome.tabs.create({ url: plannerUrl || PLANNER_URL });
}
