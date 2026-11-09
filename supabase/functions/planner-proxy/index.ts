// Conversion Cycle Planner - the website's server.
//
// The signed-in planner calls this function for everything that needs a
// secret. It checks that the caller is signed in and belongs to the
// workspace, then either:
//   - calls Claude (all AI features), with the Anthropic key from the secrets, or
//   - forwards to the Google script that reads the research Gmail inbox.
// No key, URL or token ever reaches anyone's browser.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY  turns on the AI features
//   SCRIPT_URL         the Google script's web app URL (ends in /exec)
//   SCRIPT_TOKEN       the token printed by setup() in the script
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const MODEL = "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown): Response {
  // Always 200: the planner reads the `error` field instead of HTTP status.
  return new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });
}

class UserFacingError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// ---------- Google script (research inbox) ----------

async function callScript(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { redirect: "follow", ...init });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "script_bad_answer", message: "The Google script didn't answer as expected. Check SCRIPT_URL and that the script is deployed with access set to Anyone." };
  }
}

// ---------- Claude ----------

const NUM = { anyOf: [{ type: "number" }, { type: "null" }] };
const STR = { anyOf: [{ type: "string" }, { type: "null" }] };

const OFFER_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    competitor: { type: "string", description: "Brand name of the casino or sportsbook" },
    offer_title: { type: "string", description: "Headline of the welcome offer as written" },
    offer_type: { type: "string", enum: ["match", "free_spins", "free_bet", "cashback", "no_deposit", "other"] },
    match_pct: NUM, max_bonus: NUM, currency: STR, free_spins: NUM, free_bet_value: NUM,
    wagering_x: NUM, wagering_on: STR, min_deposit: NUM, max_bet: NUM, expiry_days: NUM, max_cashout: NUM,
    eligible_games: STR,
    other_conditions: { type: "array", items: { type: "string" } },
    uncertain_fields: { type: "array", items: { type: "string" } },
  },
  required: ["competitor", "offer_title", "offer_type", "match_pct", "max_bonus", "currency", "free_spins", "free_bet_value", "wagering_x", "wagering_on", "min_deposit", "max_bet", "expiry_days", "max_cashout", "eligible_games", "other_conditions", "uncertain_fields"],
};
const OFFER_SYSTEM = [
  "You read screenshots of online casino and sportsbook promotion pages and their bonus terms, and extract the main welcome offer into the given JSON schema.",
  "You may also receive the terms and conditions as pasted text, and the values found earlier for the same offer. Combine all sources. The terms text is usually the most precise source for conditions. Keep earlier values unless the new material corrects or completes them.",
  "Use only what is shown in the screenshots and text. When a value is not shown, return null for it and add the field name to uncertain_fields. Also add a field to uncertain_fields when the text is blurry, cut off or ambiguous.",
  "Write amounts as plain numbers without currency symbols and put the ISO currency code in currency. If the welcome offer is split across several deposits, use the first deposit for match_pct and max_bonus, and describe the rest in other_conditions.",
  'wagering_on says what the wagering applies to, for example "bonus" or "deposit + bonus". expiry_days is how long the player has to meet the wagering. other_conditions lists any other rules a player would care about, each as one short plain sentence.',
].join("\n");

const PURPOSES = ["welcome", "deposit_nudge", "offer", "reminder", "reactivation", "newsletter", "transactional", "other"];
const EMAIL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["overview", "patterns", "emails"],
  properties: {
    overview: { type: "string" },
    patterns: { type: "array", items: { type: "string" } },
    emails: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["email_id", "purpose", "offer_type", "offer_summary", "match_pct", "max_bonus", "free_spins", "free_bet_value", "cashback_pct", "wagering_x", "deadline", "cta"],
        properties: {
          email_id: { type: "string" },
          purpose: { type: "string", enum: PURPOSES },
          offer_type: { type: "string", enum: ["match", "free_spins", "free_bet", "cashback", "no_deposit", "none", "other"] },
          offer_summary: STR, match_pct: NUM, max_bonus: NUM, free_spins: NUM, free_bet_value: NUM, cashback_pct: NUM, wagering_x: NUM, deadline: STR, cta: STR,
        },
      },
    },
  },
};
const EMAIL_SYSTEM = [
  "You analyse the marketing emails that one online casino or sportsbook sent to a newly registered player, to help a CRM team understand that competitor's conversion cycle.",
  'For each email, return its email_id unchanged, classify its purpose, and extract any offer exactly as written. Use null for anything the email doesn\'t state; never guess numbers. offer_summary is a short label such as "100% up to €200, 35x" or null when there is no offer.',
  'overview: 3 to 5 plain sentences describing the sequence: how often they email, when offers appear, how offers change over time, and what happens near the end. Refer to timing as "day N" using the day numbers given.',
  "patterns: up to 5 short, concrete observations a CRM manager could act on.",
].join("\n");

async function askClaude(apiKey: string, system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>): Promise<unknown> {
  const client = new Anthropic({ apiKey });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new UserFacingError("ai_key_rejected", "The Anthropic key in Supabase was rejected. Check the ANTHROPIC_API_KEY secret.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new UserFacingError("ai_denied", "The Anthropic key doesn't have permission for this request.");
    if (err instanceof Anthropic.RateLimitError) throw new UserFacingError("ai_busy", "Too many AI requests, or the key's spend limit was reached. Wait a minute and try again.");
    if (err instanceof Anthropic.BadRequestError) throw new UserFacingError("ai_bad_request", "Claude couldn't accept this request: " + err.message);
    if (err instanceof Anthropic.APIConnectionError) throw new UserFacingError("ai_unreachable", "Couldn't reach Anthropic. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new UserFacingError("ai_error", "Anthropic returned an error (" + (err.status ?? "unknown") + "). Try again.");
    throw err;
  }
  if (res.stop_reason === "refusal") throw new UserFacingError("ai_refused", "Claude declined this request.");
  if (res.stop_reason === "max_tokens") throw new UserFacingError("ai_cut_off", "The answer was cut off. Try with fewer screenshots or emails.");
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new UserFacingError("ai_bad_answer", "Claude's answer wasn't in the expected format. Try again.");
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function readOffer(apiKey: string, body: Record<string, unknown>) {
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im: { media_type?: string; data?: string }) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, 10) as { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[];
  const terms = typeof body.terms_text === "string" ? body.terms_text.trim().slice(0, 40000) : "";
  const known = body.known && typeof body.known === "object" ? JSON.stringify(body.known).slice(0, 8000) : "";
  if (!images.length && !terms) throw new UserFacingError("bad_request", "Add at least one screenshot or some terms text.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  const parts: string[] = [];
  if (known) parts.push("Values found earlier for this offer (JSON):\n" + known);
  if (terms) parts.push("Terms and conditions, pasted as text:\n<terms>\n" + terms + "\n</terms>");
  parts.push(`Extract the main welcome offer from ${images.length ? images.length + " screenshot(s)" : "the material above"}${images.length && terms ? " and the terms text" : ""}.`);
  content.push({ type: "text", text: parts.join("\n\n") });
  return askClaude(apiKey, OFFER_SYSTEM, content, OFFER_SCHEMA);
}

function summariseEmails(apiKey: string, body: Record<string, unknown>) {
  const emails = (Array.isArray(body.emails) ? body.emails : []).slice(0, 80) as Record<string, unknown>[];
  if (!emails.length) throw new UserFacingError("bad_request", "No emails were received.");
  const input = `Competitor: ${String(body.competitor ?? "unknown").slice(0, 100)}\nRegistered on: ${String(body.registered || "unknown").slice(0, 20)}\n\n` +
    emails.map((em) =>
      `=== email_id: ${String(em.id).slice(0, 64)} | day ${parseInt(String(em.day), 10) || 0} | ${String(em.date ?? "").slice(0, 40)}\n` +
      `From: ${String(em.from ?? "").slice(0, 200)}\nSubject: ${String(em.subject ?? "").slice(0, 300)}\n\n${String(em.text ?? "").slice(0, 3000)}`
    ).join("\n\n");
  return askClaude(apiKey, EMAIL_SYSTEM, [{ type: "text", text: input }], EMAIL_SCHEMA);
}

// ---------- request handling ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return reply({ error: "server_setup", message: "The function can't reach the database. Add a SERVICE_ROLE_KEY secret." });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Who is calling, and are they in this workspace?
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return reply({ error: "unauthorized", message: "Your sign-in has expired. Sign in again." });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workspaceId = String(body.workspace_id ?? "");
    const action = String(body.action ?? "");
    const { data: member } = await admin.from("members").select("role")
      .eq("workspace_id", workspaceId).eq("user_id", who.user.id).maybeSingle();
    if (!member) return reply({ error: "forbidden", message: "You're not a member of this workspace." });

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const scriptUrl = Deno.env.get("SCRIPT_URL") ?? "";
    const scriptToken = Deno.env.get("SCRIPT_TOKEN") ?? "";
    const sep = scriptUrl.includes("?") ? "&" : "?";
    const tokenParam = "token=" + encodeURIComponent(scriptToken);

    if (action === "status") {
      const out: Record<string, unknown> = { ai: !!anthropicKey, connected: false, canSync: member.role === "owner" };
      if (scriptUrl && scriptToken) {
        const s = await callScript(`${scriptUrl}${sep}${tokenParam}&status=1`);
        if (s.error) out.message = s.message;
        else { out.connected = true; out.account = s.account ?? ""; }
      }
      return reply(out);
    }

    if (action === "emails") {
      if (member.role !== "owner") return reply({ error: "forbidden", message: "Only workspace owners can sync emails." });
      if (!scriptUrl || !scriptToken) return reply({ error: "not_connected", message: "The Google script isn't connected yet. Add SCRIPT_URL and SCRIPT_TOKEN in Supabase." });
      const days = Math.min(365, Math.max(1, parseInt(String(body.days ?? 60), 10) || 60));
      return reply(await callScript(`${scriptUrl}${sep}${tokenParam}&days=${days}`));
    }

    if (action === "read_offer" || action === "summarise_emails") {
      if (!anthropicKey) return reply({ error: "no_ai_key", message: "AI isn't set up yet. Add the ANTHROPIC_API_KEY secret in Supabase." });
      const result = action === "read_offer" ? await readOffer(anthropicKey, body) : await summariseEmails(anthropicKey, body);
      return reply({ result });
    }

    return reply({ error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    if (err instanceof UserFacingError) return reply({ error: err.code, message: err.message });
    return reply({ error: "server_error", message: String((err as Error)?.message ?? err) });
  }
});
