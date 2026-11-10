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
  "You read screenshots of online casino and sportsbook promotion pages and their bonus terms, and extract the offer the user asks for (for example the welcome offer, a 2nd deposit offer, a reload or a cashback) into the given JSON schema. If the material shows several offers, extract only the requested one and mention the others briefly in other_conditions.",
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
  const kind = typeof body.offer_kind === "string" && body.offer_kind.trim() ? body.offer_kind.trim().slice(0, 60) : "welcome offer";
  parts.push(`Extract the ${kind} from ${images.length ? images.length + " screenshot(s)" : "the material above"}${images.length && terms ? " and the terms text" : ""}.`);
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

// ---------- pages and journeys (registration, deposit, homepage...) ----------

const PAGE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "summary", "steps", "key_facts", "strengths", "friction", "ideas", "uncertain", "rating", "rating_reason", "comparison"],
  properties: {
    title: { type: "string" },
    rating: { type: "integer", enum: [1, 2, 3, 4, 5] },
    rating_reason: { type: "string" },
    comparison: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: { type: "string" }, value: { type: "string" } } } },
    summary: { type: "string" },
    steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "detail"], properties: { name: { type: "string" }, detail: { type: "string" } } } },
    key_facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    strengths: { type: "array", items: { type: "string" } },
    friction: { type: "array", items: { type: "string" } },
    ideas: { type: "array", items: { type: "string" } },
    uncertain: { type: "array", items: { type: "string" } },
  },
};
const PAGE_SYSTEM = [
  "You review screenshots and text from an online casino or sportsbook website for a CRM and conversion team. The user says which part of the site it is, for example the registration process, the deposit page, the homepage, the promotions page or the loyalty programme.",
  "Describe what a new player experiences there and what matters for conversion. Use only what is shown; never guess.",
  "title: a short name for what is shown. summary: 2 to 4 plain sentences.",
  "steps: the steps a player goes through, in order, when it is a flow; otherwise an empty list.",
  "key_facts: short label and value pairs with concrete details. For registration, for example: number of steps, fields asked, verification, whether a bonus is shown, how soon a deposit is asked for. For a deposit page: payment methods, minimum deposit, how the bonus is opted into.",
  "strengths: what works well for conversion. friction: what could make players drop off. ideas: concrete things a competitor could learn from or test. uncertain: anything you couldn't see clearly.",
  "If you also get an earlier review of the same page, keep what still holds and update it with the new material.",
  "rating: how conversion-friendly this part of the site is for a new player, from 1 (poor) to 5 (excellent). rating_reason: one short sentence explaining it.",
  "When the material is a tournament: title is the tournament's name, summary describes the format and prizes, steps are how a player joins and takes part, key_facts hold the main numbers, and rating is how appealing it is to an ordinary player rather than to high rollers.",
  "Keep the review short: summary at most 2 sentences, at most 6 key_facts with the most important first, and at most 3 items each in strengths, friction and ideas, each one short sentence. rating_reason is one short sentence.",
  "comparison: answer every comparison field the user lists, in that order, using exactly the given field names. Keep each value short (a few words or a number). Write \"Not shown\" when the material doesn't show it.",
].join("\n");

function analysePage(apiKey: string, body: Record<string, unknown>) {
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im: { media_type?: string; data?: string }) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, 10) as { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[];
  const text = typeof body.page_text === "string" ? body.page_text.trim().slice(0, 40000) : "";
  const known = body.known && typeof body.known === "object" ? JSON.stringify(body.known).slice(0, 8000) : "";
  if (!images.length && !text) throw new UserFacingError("bad_request", "Add at least one screenshot or some text.");
  const section = String(body.section ?? "page").slice(0, 60);
  const operator = String(body.operator ?? "").slice(0, 80);
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  const parts: string[] = [];
  if (known) parts.push("Earlier review of this page (JSON):\n" + known);
  if (text) parts.push("Text and notes about the page:\n<page>\n" + text + "\n</page>");
  const fields = (Array.isArray(body.compare_fields) ? body.compare_fields : []).map((f) => String(f).slice(0, 60)).filter(Boolean).slice(0, 12);
  if (fields.length) parts.push("Comparison fields:\n" + fields.map((f) => "- " + f).join("\n"));
  parts.push(`Review the ${section}${operator ? " of " + operator : ""}.`);
  content.push({ type: "text", text: parts.join("\n\n") });
  return askClaude(apiKey, PAGE_SYSTEM, content, PAGE_SCHEMA);
}

// ---------- sorting scanned pages ----------

const SORT_KINDS: Record<string, string> = {
  welcome: "welcome offer (first deposit bonus)", second: "2nd deposit offer", third: "3rd deposit offer", reload: "reload offer",
  cashback: "cashback", freespins: "free spins offer", vip: "loyalty or VIP reward", sports: "sportsbook offer", other_offer: "other bonus offer",
  registration: "registration process or sign-up form", deposit: "deposit or cashier page", homepage: "homepage", promotions: "promotions overview page",
  tournament: "one tournament, race or prize drop", loyalty: "loyalty or VIP programme page", missions: "missions, quests, challenges or achievements", shop: "bonus shop or rewards store where points or coins are spent",
  wheel: "wheel of fortune, daily spin, mystery box or other mini-game", gamification: "other gamification (badges, streaks…) that isn't missions, a shop or a mini-game",
  referral: "refer-a-friend programme", inbox: "player inbox or on-site messages", account: "player account area (my bonuses, profile, communication preferences)",
  withdrawal: "withdrawal page or form", app: "mobile app page", rg: "responsible gambling page", other_page: "other page worth reviewing", irrelevant: "nothing relevant (game lobby, unrelated legal text, error page)",
};
const SORT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["kind", "title", "main", "screens"],
        properties: {
          kind: { type: "string", enum: Object.keys(SORT_KINDS) },
          title: { type: "string" },
          main: { type: "boolean" },
          screens: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
};
const SORT_SYSTEM = [
  "You sort screenshots and text from a page of an online casino or sportsbook website for competitor research.",
  "List what the page contains, using these kinds:",
  ...Object.entries(SORT_KINDS).map(([k, v]) => `- ${k}: ${v}`),
  "A page can contain several things: a promotions page usually counts as promotions plus one item for each concrete offer or tournament on it. List each separately, at most 6 items, most important first.",
  "A rewards or loyalty page often holds several parts (levels, missions, a bonus shop, a wheel): list each part as its own item with its own kind and the screenshots that show it, instead of putting them together.",
  "When the link text starts with \"Offer:\" or \"Tournament:\", the material is one offer or tournament opened from a list (its pop-up or its own page): list only that item, never promotions or homepage.",
  "A bonus terms page counts as the offer it describes. The homepage counts as homepage, plus the welcome offer if it is shown with its numbers.",
  "title is a short name, such as the offer headline or the tournament name.",
  "main is true when this page is mainly about the item (its own page, or a full section or card describing it). main is false when the item is only mentioned in passing, for example in the site header, a sidebar, a small teaser or a banner that links elsewhere.",
  "screens lists the numbers of the screenshots that actually show the item (screenshots are numbered from 1 in the order given). Leave out screenshots where the item isn't visible. Use an empty list when the item only appears in the page text.",
  "If nothing on the page is relevant, return a single item with kind irrelevant.",
].join("\n");

function sortPage(apiKey: string, body: Record<string, unknown>) {
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im: { media_type?: string; data?: string }) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, 14) as { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[];
  const labels = Array.isArray(body.image_labels) ? body.image_labels.map((l) => String(l).slice(0, 60)) : [];
  const text = typeof body.page_text === "string" ? body.page_text.trim().slice(0, 16000) : "";
  if (!images.length && !text) throw new UserFacingError("bad_request", "The scanned page was empty.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.forEach((im, i) => {
    content.push({ type: "text", text: `Screenshot ${i + 1}${labels[i] ? " (" + labels[i] + ")" : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  });
  content.push({ type: "text", text: `Page address: ${String(body.url ?? "").slice(0, 300)}\nLink text that led here: ${String(body.link_text ?? "").slice(0, 100)}\n\nPage text:\n<page>\n${text}\n</page>\n\nList what this page contains.` });
  return askClaude(apiKey, SORT_SYSTEM, content, SORT_SCHEMA);
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

    if (action === "read_offer" || action === "summarise_emails" || action === "analyse_page" || action === "sort_page") {
      if (!anthropicKey) return reply({ error: "no_ai_key", message: "AI isn't set up yet. Add the ANTHROPIC_API_KEY secret in Supabase." });
      const result = action === "read_offer" ? await readOffer(anthropicKey, body)
        : action === "analyse_page" ? await analysePage(anthropicKey, body)
        : action === "sort_page" ? await sortPage(anthropicKey, body)
        : await summariseEmails(anthropicKey, body);
      return reply({ result });
    }

    return reply({ error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    if (err instanceof UserFacingError) return reply({ error: err.code, message: err.message });
    return reply({ error: "server_error", message: String((err as Error)?.message ?? err) });
  }
});
