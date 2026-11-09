// Conversion Cycle Planner - server-side bridge to the Google script.
//
// The planner calls this function instead of the Google script, so the
// script's URL and token never reach anyone's browser. It checks that the
// caller is signed in and belongs to the workspace, then forwards the
// request to the script with the token added.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   SCRIPT_URL    the Google script's web app URL (ends in /exec)
//   SCRIPT_TOKEN  the token printed by setup() in the script
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown): Response {
  // Always 200: the planner reads the `error` field instead of HTTP status.
  return new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });
}

async function callScript(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { redirect: "follow", ...init });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "script_bad_answer", message: "The Google script didn't answer as expected. Check SCRIPT_URL and that the latest version is deployed with access set to Anyone." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return reply({ error: "server_setup", message: "The function can't reach the database. Add a SERVICE_ROLE_KEY secret." });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Who is calling?
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return reply({ error: "unauthorized", message: "Your sign-in has expired. Sign in again." });

    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id ?? "");
    const action = String(body.action ?? "");

    // Are they in this workspace?
    const { data: member } = await admin.from("members").select("role")
      .eq("workspace_id", workspaceId).eq("user_id", who.user.id).maybeSingle();
    if (!member) return reply({ error: "forbidden", message: "You're not a member of this workspace." });

    const scriptUrl = Deno.env.get("SCRIPT_URL") ?? "";
    const scriptToken = Deno.env.get("SCRIPT_TOKEN") ?? "";
    if (!scriptUrl || !scriptToken) {
      if (action === "status") return reply({ connected: false });
      return reply({ error: "not_connected", message: "The Google script isn't connected yet. Add SCRIPT_URL and SCRIPT_TOKEN in Supabase." });
    }
    const sep = scriptUrl.includes("?") ? "&" : "?";
    const tokenParam = "token=" + encodeURIComponent(scriptToken);

    if (action === "status") {
      const s = await callScript(`${scriptUrl}${sep}${tokenParam}&status=1`);
      if (s.error) return reply({ connected: false, error: s.error, message: s.message });
      return reply({ connected: true, account: s.account ?? "", ai: s.ai === true, canSync: member.role === "owner" });
    }

    if (action === "emails") {
      // Only owners can pull the research inbox into a workspace.
      if (member.role !== "owner") return reply({ error: "forbidden", message: "Only workspace owners can sync emails." });
      const days = Math.min(365, Math.max(1, parseInt(String(body.days ?? 60), 10) || 60));
      return reply(await callScript(`${scriptUrl}${sep}${tokenParam}&days=${days}`));
    }

    if (action === "read_offer" || action === "summarise_emails") {
      const payload = { ...body, token: scriptToken, action };
      delete (payload as Record<string, unknown>).workspace_id;
      return reply(await callScript(scriptUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) }));
    }

    return reply({ error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    return reply({ error: "proxy_failed", message: String((err as Error)?.message ?? err) });
  }
});
