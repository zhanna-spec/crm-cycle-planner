// Cycle Planner Site Scanner - does the scanning so it keeps going if the popup closes.

const PLANNER_URL = "https://zhanna-spec.github.io/crm-cycle-planner/#scan";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return {
    title: document.title,
    text: (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").slice(0, 15000),
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    innerHeight: window.innerHeight
  };
}

function scrollToY(y) { window.scrollTo(0, y); return window.scrollY; }

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

async function runScan({ tabId, pages, run: runLabel, perPage, site }) {
  const tab = await chrome.tabs.get(tabId);
  const startUrl = tab.url;
  const total = pages.length;
  await chrome.storage.local.set({ scanStatus: { state: "running", done: 0, total, current: "" } });
  const results = [];
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    await chrome.storage.local.set({ scanStatus: { state: "running", done: i, total, current: pg.label } });
    try {
      await navigate(tabId, pg.url);
      await sleep(2500);
      await run(tabId, dismissOverlays).catch(() => 0);
      await sleep(900);
      const info = await run(tabId, pageInfo);
      const step = Math.max(200, Math.floor(info.innerHeight * 0.9));
      const shots = [], labels = [];
      for (let k = 0; k < perPage; k++) {
        await run(tabId, scrollToY, [k * step]);
        await sleep(600);
        shots.push(await capture(tab.windowId)); labels.push(k ? "scrolled down " + k : "top of page");
        if ((k + 1) * step >= info.scrollHeight - 50) break;
      }
      // Photograph each tab (Weekly / Monthly…) too, with its text.
      let text = info.text;
      await run(tabId, scrollToY, [0]).catch(() => 0); await sleep(300);
      const tabs = await run(tabId, findTabs).catch(() => []) || [];
      for (const t of tabs) {
        const before = (await chrome.tabs.get(tabId)).url;
        const after = await run(tabId, clickTab, [t.i]).catch(() => null);
        if (!after) continue;
        await sleep(1500);
        if (after.split("#")[0] !== before.split("#")[0] || (await chrome.tabs.get(tabId)).url.split("#")[0] !== before.split("#")[0]) {
          await navigate(tabId, pg.url); await sleep(1500); break; // it was really a link: go back, stop clicking
        }
        shots.push(await capture(tab.windowId)); labels.push("tab: " + t.text);
        const tinfo = await run(tabId, pageInfo).catch(() => null);
        if (tinfo) text += "\n\n--- Tab: " + t.text + " ---\n" + tinfo.text.slice(0, 6000);
      }
      await run(tabId, scrollToY, [0]).catch(() => 0);
      results.push({ url: pg.url, label: pg.label, hint: pg.cat || "", title: info.title, text: text.slice(0, 30000), shots, shotLabels: labels });
    } catch (err) {
      results.push({ url: pg.url, label: pg.label, hint: pg.cat || "", error: String(err && err.message || err), shots: [] });
    }
  }
  try { await navigate(tabId, startUrl); } catch (e) { /* ignore */ }
  const scan = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), site, run: runLabel, at: new Date().toISOString(), pages: results };
  await chrome.storage.local.set({ pendingScan: scan, scanStatus: { state: "done", done: total, total } });
  const { plannerUrl } = await chrome.storage.local.get("plannerUrl");
  await chrome.tabs.create({ url: plannerUrl || PLANNER_URL });
}
