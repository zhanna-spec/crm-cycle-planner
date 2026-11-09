// Runs on the Conversion Cycle Planner page and hands it the latest scan.
(async function () {
  const { pendingScan } = await chrome.storage.local.get("pendingScan");
  if (!pendingScan) return;
  const origin = window.location.origin === "null" ? "*" : window.location.origin;
  const send = () => window.postMessage({ type: "ccp-scan", scan: pendingScan }, origin);
  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === "ccp-scan-ready") send();
    if (e.data.type === "ccp-scan-received" && e.data.id === pendingScan.id) await chrome.storage.local.remove("pendingScan");
  });
  send();
})();
