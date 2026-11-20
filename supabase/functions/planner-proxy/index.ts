// CRM Studio - the website's server.
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

async function askClaude(apiKey: string, system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, effort: "low" | "medium" | "high" = "medium", maxTokens = 16000): Promise<unknown> {
  const client = new Anthropic({ apiKey });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema } },
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

// ---------- one promotion: what it does, how it works, its terms ----------

const PROMO_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "kind", "summary", "how_it_works", "who_can_join", "reward", "terms", "other_conditions", "uncertain"],
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["welcome", "second", "third", "reload", "cashback", "freespins", "vip", "sports", "tournament", "other_offer"] },
    summary: { type: "string" },
    how_it_works: { type: "array", items: { type: "string" } },
    who_can_join: { type: "string" },
    reward: { type: "string" },
    terms: {
      type: "object", additionalProperties: false,
      required: ["min_deposit", "wagering", "max_bet", "validity", "eligible_games", "max_win", "bonus_code", "opt_in"],
      properties: { min_deposit: STR, wagering: STR, max_bet: STR, validity: STR, eligible_games: STR, max_win: STR, bonus_code: STR, opt_in: STR },
    },
    other_conditions: { type: "array", items: { type: "string" } },
    uncertain: { type: "array", items: { type: "string" } },
  },
};
const PROMO_SYSTEM = [
  "You read one promotion of an online casino or sportsbook, from screenshots of its card, pop-up or page and the text of its terms and conditions, and write it up for a CRM team's list of promotions.",
  "title: the promotion's name as the site writes it, in full (cards often cut it off; use the full name from the pop-up, page or terms).",
  "kind: welcome (first deposit / new players), second / third (2nd / 3rd deposit), reload, cashback, freespins (a free-spins offer), vip (loyalty reward), sports (sportsbook offer), tournament (race, leaderboard, prize drop), other_offer.",
  "summary: what the promotion does, in one plain sentence (e.g. 'A 100% match on the first deposit up to €500 plus 100 free spins').",
  "how_it_works: the steps a player takes, short, in order (e.g. 'Opt in on the promotion card', 'Deposit at least €20 with code WELCOME', 'Bonus and spins are credited instantly').",
  "who_can_join: who it's for (new players, players with a first deposit, VIP level 3+, every player…). reward: what the player gets.",
  "terms: the values as written, with their units ('35x bonus', '€20', '€5 per spin', '7 days', 'Book of Dead', '€100', 'WELCOME100', 'opt in on the card'). Use null when the terms don't say.",
  "other_conditions: every other rule that matters to a player (excluded payment methods, game weighting, countries, one per household, cancellation…), short, one per line.",
  "uncertain: the field names you couldn't read for sure. Use only what the screenshots and text show.",
].join("\n");

function readPromotion(apiKey: string, body: Record<string, unknown>) {
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im: { media_type?: string; data?: string }) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, 8) as { media_type: "image/jpeg"; data: string }[];
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 30000) : "";
  if (!images.length && !text) throw new UserFacingError("bad_request", "No screenshots or text for this promotion.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  content.push({ type: "text", text: `Casino: ${String(body.casino ?? "").slice(0, 80)}\nPromotion as found by the scanner: ${String(body.label ?? "").slice(0, 160)}` + (text ? `\n\nText from the promotion, its pop-up or page and its terms:\n<text>\n${text}\n</text>` : "") + "\n\nWrite up this promotion." });
  return askClaude(apiKey, PROMO_SYSTEM, content, PROMO_SCHEMA, "low", 6000);
}

// ---------- one feature of a casino (loyalty, missions, deposit, tournaments, store, or something unique) ----------

const FEATURE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "summary", "where", "how_it_works", "key_facts", "stands_out", "uncertain"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    where: { type: "string" },
    how_it_works: { type: "array", items: { type: "string" } },
    key_facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    stands_out: { type: "array", items: { type: "string" } },
    uncertain: { type: "array", items: { type: "string" } },
  },
};
const FEATURE_FACTS: Record<string, string> = {
  vip: "levels or tiers and their names, how a player progresses (points, deposits, wagering), how points are earned, rewards per level, how to join (automatic / invitation / fast-track), progress shown to the player",
  missions: "types of missions (daily, weekly, special), what they ask, rewards, time limits, how progress is shown, tabs (available / locked / completed), what mission rewards lead to (points, store)",
  deposit: "how the cashier opens (pop-up, page), steps, payment methods, minimum and maximum, quick amounts, how a bonus is offered or entered (code field, pre-selected, choice), confirmation or summary, other tabs (withdraw, history)",
  tournaments: "each tournament or race by name: type, prize, duration or schedule, how points are scored, eligible games, minimum bet, how to join, leaderboard and the player's position",
  shop: "currency (points, coins), how it's earned, item categories, example items and prices, filters or sorting, purchase history, where the store lives (own page, tab in a hub)",
  custom: "what it is, how a player takes part, how often, what it costs or needs, what can be won, where it lives on the site",
};
const FEATURE_SYSTEM = [
  "You write up one feature of an online casino for a CRM team, from screenshots of it and the text found on its pages.",
  "title: a short name for this feature at this casino, e.g. 'Instant VIP' or 'Missions hub'. summary: what it is, in one or two plain sentences.",
  "where: where it lives on the site and how a player gets there (menu entry, header, dropdown, tab in a hub).",
  "how_it_works: the steps or rules from the player's point of view, short, in order.",
  "key_facts: the details that matter, as short label / value pairs, values as written on the site with their units.",
  "stands_out: up to four short observations about how it's set up or presented (structure, not judgements; no 'best' or 'poor').",
  "uncertain: what you couldn't read for sure. Use only what the screenshots and text show; quote the site's own labels in single quotes.",
].join("\n");

function readFeature(apiKey: string, body: Record<string, unknown>) {
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im: { media_type?: string; data?: string }) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, 14) as { media_type: "image/jpeg"; data: string }[];
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 40000) : "";
  if (!images.length && !text) throw new UserFacingError("bad_request", "No screenshots or text for this feature.");
  const key = String(body.part ?? "custom").slice(0, 20), label = String(body.label ?? "").slice(0, 80);
  const labels = (Array.isArray(body.image_labels) ? body.image_labels : []).map((l) => String(l).slice(0, 80));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.forEach((im, i) => {
    content.push({ type: "text", text: `Screenshot ${i + 1}${labels[i] ? " (" + labels[i] + ")" : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  });
  content.push({ type: "text", text: `Casino: ${String(body.casino ?? "").slice(0, 80)}\nFeature: ${label}\nKey facts to look for: ${FEATURE_FACTS[key] || FEATURE_FACTS.custom}` + (text ? `\n\nText found on its pages:\n<text>\n${text}\n</text>` : "") + "\n\nWrite up this feature." });
  return askClaude(apiKey, FEATURE_SYSTEM, content, FEATURE_SCHEMA, "low", 8000);
}

// ---------- which casino sent which emails ----------

const SENDERS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["senders"],
  properties: {
    senders: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["key", "is_casino", "casino", "known"],
        properties: {
          key: { type: "string" },
          is_casino: { type: "boolean" },
          casino: { type: "string" },
          known: { type: "string" },
        },
      },
    },
  },
};
const SENDERS_SYSTEM = [
  "You sort emails in a research inbox by the online casino or sportsbook that sent them.",
  "You get groups of senders (display names, domains, a few subjects and a short snippet) and the casinos already followed.",
  "For each group: is_casino is true when a gambling brand (casino, sportsbook, lottery, bingo, poker) sent it, false for anything else (Google, banks, newsletters of other businesses, spam).",
  "casino is the brand's usual name, written the way the brand writes it (for example \"VegasNova\", \"Housebets\"). Use the brand in the email content when the sender is a mailing service.",
  "known is the exact name from the followed list when it's the same brand (even if written differently), otherwise an empty string. Two groups can be the same brand.",
  "Return one entry for every key, in the same order. Use an empty casino when is_casino is false.",
].join("\n");

function sortSenders(apiKey: string, body: Record<string, unknown>) {
  const groups = (Array.isArray(body.groups) ? body.groups : []).slice(0, 40) as Record<string, unknown>[];
  if (!groups.length) throw new UserFacingError("bad_request", "No senders were received.");
  const known = (Array.isArray(body.known) ? body.known : []).map((k) => String(k).slice(0, 80)).slice(0, 100);
  const list = (x: unknown, n: number, len: number) => (Array.isArray(x) ? x : []).slice(0, n).map((v) => String(v).slice(0, len));
  const input = `Casinos already followed: ${known.length ? known.join(", ") : "none"}\n\n` + groups.map((g) =>
    `=== key: ${String(g.key).slice(0, 80)}\nSender names: ${list(g.names, 5, 80).join(" | ")}\nDomains: ${list(g.domains, 5, 80).join(", ")}\n` +
    `Subjects: ${list(g.subjects, 4, 160).join(" | ")}\nSnippet: ${String(g.snippet ?? "").slice(0, 400)}`).join("\n\n");
  return askClaude(apiKey, SENDERS_SYSTEM, [{ type: "text", text: input }], SENDERS_SCHEMA);
}

// ---------- competitor review (the reviewer's method, see report/HANDOFF.md) ----------

// The reviewer's writing guide (report/WRITING_GUIDE.md), word for word.
const WRITING_GUIDE = "# Writing Guide \u2014 how the points and content are written\n\nThis guide explains how every piece of text in the competitor review is written. It's based on the reviewer's own corrections in the original session. **Before \u2192 After** examples show real changes the reviewer asked for. Read it together with `HANDOFF.md`, part 2.\n\n---\n\n## 1. The overall voice\n\n- **Observe; don't judge.** Describe what a page does and how it is set up, and what that could mean for a player. Don't declare winners or losers.\n- **Soft, measured language.** The reviewer writes things like \"can feel overwhelming\", \"could be confusing\", \"makes it unclear whether\u2026\", \"might not immediately realise\u2026\". Follow that tone. Avoid absolute statements like \"poor\", \"bad\", \"fails\", \"best\" or \"must\".\n- **About structure and setup.** Talk about layout, navigation, flows, where features live and how they're presented. Never about offer amounts, prize sizes, how many items there are, or which promotion types a casino runs. Screenshots never capture everything, so counts aren't reliable.\n- **Short.** Card bullets are phrases, not sentences. Comparison text is one or two sentences.\n- **Plain words.** Use the player's point of view (\"players\", \"the player\"). Quote the site's own labels in single quotes: 'Rewards', 'Bonus Store', 'Take it'.\n- **Casino names as branded:** VegasNova, Golden Panda, HertzBetz, Housebets, Oliver Casino (or Oliver), Sir Betalot, SlotMonster, Slotorado.\n\n---\n\n## 2. The three cards\n\n### Works (green)\nShort positive phrases about what the subject casino does well, written as facts.\n\n**Pattern:** a noun phrase, sometimes followed by its benefit.\n- \"Clear overall layout\"\n- \"Strong banner that uses the space well\"\n- \"Points balance visible\"\n- \"Own page keeps missions clearly separate from the store\"\n- \"Tapping Deposit opens the payment methods straight away\"\n\n**Rules**\n- If the reviewer sees something as a valid choice, it belongs here, not under Potential gaps. For example:\n  - \"Simple filter that matches the current promotion types\"\n  - \"Points feed straight into the Rewards Store\"\n- If the section doesn't exist at all, leave the card empty and the page shows \"Not offered\".\n\n### Potential gaps (red)\nShort, factual phrases about structure that could cause friction. The card title is always **\"Potential gaps\"**, never \"Gaps\".\n\n**Pattern:** state what is there, or missing, without blame.\n- \"'Rewards' appears twice in the side menu\"\n- \"Missions & Store hidden in a Rewards dropdown\"\n- \"'Bonus Store' duplicates Store (old widget)\"\n- \"No bonus shown or offered, even for new players\"\n- \"Hard to find inside the Rewards dropdown\"\n\n**Rules**\n- **One root cause, one line.** Don't add lines that only follow from it.\n  - Before: \"No tournaments or races\" \u00b7 \"No leaderboards\" \u00b7 \"Nothing in the menu\"\n  - After: \"No tournaments or races\" \u00b7 \"No leaderboards\"\n- **Soften points that depend on the future.**\n  - Before: \"Only one filter ('Casino Bonuses')\"\n  - After: \"Single filter won't scale if more promotion types are added\"\n- **Not gaps.** The reviewer removed every one of these:\n  - mission rewards that differ in size (they're proportional to wagering)\n  - \"Value of points not shown\" (the store shows what points buy)\n  - \"Same artwork on every item\"\n  - \"Off-brand background image\"\n  - \"No 'next reward' nudge\"\n  - \"No Rewards entry in the bottom bar\"\n  - missions and store being on separate pages (a valid design choice)\n- **Not yet confirmed?** Don't list it. Raise it with the reviewer, or show it as \"to check\" in a comparison. Only list it once confirmed. Example: the cashier bonus was \"to check\" until the reviewer tested with a new account.\n\n### Ideas to consider (purple, numbered)\nSuggestions, not instructions. The card title is always **\"Ideas to consider\"**, never \"Do next\" or \"Recommendations\".\n\n**Pattern:** start with the subject of the change, then use \"could\", \"Consider\u2026\", \"\u2026 is worth testing\" or \"\u2026 is another option\".\n- \"Consider removing 'Bonus Store'\"\n- \"Missions and Store could become their own menu items\"\n- \"'Rewards' could appear only once in the menu\"\n- \"The welcome bonus could be shown in the cashier\"\n- \"A clear 'bonus / no bonus' choice could be offered\"\n- \"Achievements / badges could add another layer alongside the store\"\n\n**Rules**\n- **Each idea should answer a listed potential gap, or build on something that works.**\n- **Keep ideas general. Don't design the feature.**\n  - Before: \"Launch a free weekly slot race\" \u00b7 \"Add a daily free-spins race\"\n  - After: \"Tournaments could be added\"\n- **Never suggest what the casino already does.**\n  - Removed: \"Keep missions in their own, easy-to-find section\", because VegasNova already does this.\n- **Drop the idea when its gap is dropped.**\n  - Removed together with their gaps: \"Show what each reward is worth\", \"Starter and streak missions are worth considering\", \"Real game artwork could make items more appealing\", and \"A Rewards entry in the bottom bar could put missions and store one tap away\".\n\n**Before \u2192 After wording**\n| Before | After |\n|---|---|\n| \"Remove 'Bonus Store'\" | \"Consider removing 'Bonus Store'\" |\n| \"Show 'Rewards' only once\" | \"'Rewards' could appear only once in the menu\" |\n| \"Merge Store + Bonus Store\" | \"Store and Bonus Store could be merged into one\" |\n| \"Add levels for every player\" | \"Consider levels that every player can progress through\" |\n\n---\n\n## 3. Comparison points (\"How it compares\")\n\n### Title\n2\u20136 words naming the topic, not the verdict.\n- Good: \"Filters\" \u00b7 \"Full promotion titles\" \u00b7 \"Cashier layout\" \u00b7 \"How the store is presented\" \u00b7 \"What missions lead to\" \u00b7 \"What happens when tapping Deposit\"\n- Avoid verdict titles such as \"VegasNova's weak filters\" or \"Best leaderboard\".\n\n### Text (1\u20132 sentences)\n**Pattern:** what the subject casino does, then what some competitors do.\n- \"VegasNova has a single filter, 'Casino Bonuses'. That may simply be because it only runs one type of promotion right now. Sir Betalot shows how filters can grow once there are more types.\"\n- \"VegasNova opens the payment methods straight away. On SlotMonster, tapping Deposit first shows a pop-up asking the player to verify their ID before the cashier opens.\"\n\n**Rules**\n- **\"Some competitors\", never \"the best competitors\".**\n  - Before: \"The best competitors show a live leaderboard and where the player stands.\"\n  - After: \"Some competitors show a live leaderboard and where the player stands.\"\n- **No rankings or superlatives, even mild ones.**\n  - Before: \"Sir Betalot is one of the clearest layouts\u2026\"\n  - After: \"Sir Betalot has a clean layout, with the banner visible straight away and every menu section listed.\"\n- **Present different approaches as alternatives when both are valid.** Use \"takes a different approach\" or \"Both approaches work\".\n  - Before: \"VegasNova splits Missions, Store and Bonus Store into separate pages. Competitors bring everything together in one place.\"\n  - After: \"VegasNova keeps Missions and Store on their own pages, which keeps the purpose of each clear. They are just hard to find inside the Rewards dropdown. SlotMonster and Golden Panda take a different approach and show missions together with races, the store and more in one rewards hub.\"\n- **Give the subject credit where it already does something.**\n  - Before: \"Golden Panda gives missions a purpose beyond points: badges to collect and a mini-game to play.\"\n  - After: \"Both give missions a long-term purpose. VegasNova's mission points are collected and spent in the Rewards Store. Golden Panda takes a different approach, with badges to collect and a mini-game to play.\"\n- **Respect the reviewer's taste on visual points.**\n  - Before: \"VegasNova's banner fills most of the screen\" (gap)\n  - After: \"VegasNova's banner is large but well used: offer, CTA and mascots fill the space.\" Contrast it with \"Oliver's banner is just as big but has a lot of empty space.\"\n- **Mention uncertainty plainly:** \"worth checking\", \"so check what a new player sees\".\n- **A feature that sends players elsewhere** (promo cards for missions or the rewards hub) gets a balanced sentence: \"It can help discovery, but it blurs the line between promotions and missions.\"\n\n### Box labels (the numbered highlights)\n3\u20138 words describing what is inside the box. Write facts, not opinions.\n- \"Missions as its own menu item\" \u00b7 \"Code pre-filled\" \u00b7 \"Bonus already selected, swipe for others\" \u00b7 \"Prize per rank\" \u00b7 \"Titles cut off mid-sentence\" \u00b7 \"One filter, matching one promotion type\"\n\n### Tags on each screenshot\n- **Subject:**\n  - \"works\" for something good\n  - \"potential gap\" for a confirmed issue\n  - \"to check\" for something not confirmed\n  - \"mixed\" for something partly good\n- **Competitors:**\n  - \"Example\" for a good example\n  - \"Mixed\" for something with pros and cons\n  - \"Avoid\" only for something clearly bad\n  - \"For reference\" for a neutral fact with no judgement\n\n---\n\n## 4. Screenshot titles\nShort and descriptive: what page or state the screenshot shows. Leave out amounts and counts.\n- \"Lobby with welcome-offer banner\" \u00b7 \"Side menu open\" \u00b7 \"Cashier: bonus selected, amount\" \u00b7 \"Tapping Deposit: ID verification first\" \u00b7 \"Missions tab in rewards hub\"\n- Before: \"Weekly leaderboard, $50,000 USDT pool\" \u2192 After: \"Weekly leaderboard\"\n- Before: \"Achievements tab: 0/17 collected\" \u2192 After: \"Achievements tab\"\n\n---\n\n## 5. Applying the reviewer's notes\n\n- **Apply notes literally and keep the reviewer's meaning.** If they say \"I wouldn't call it the clearest, just clean\", change the wording everywhere it appears: comparisons, casino descriptions, and anything else.\n- **When the reviewer removes a point, also remove what depended on it:**\n  - the matching idea\n  - highlight boxes on screenshots that make the same point\n  - lines elsewhere that repeat it\n- **Carry corrections forward.** A rule given for one section or version applies to the others too. For example, \"no counts\" applies to all sections, and desktop corrections apply to mobile.\n- **Check each claim against the version you're writing.** Points can differ between desktop and mobile. For example, VegasNova's promotion titles are cut off on desktop but shown in full on mobile.\n- **If a note changes a section's overall picture, say so in your reply,** and ask before changing anything the reviewer didn't mention.\n";

const REVIEW_RULES = [
  "THE METHOD",
  "- The review compares STRUCTURE AND SETUP, not offers: how pages are laid out, how navigation works, how flows are built, how features are presented and where they live.",
  "- Never compare numbers or types of things: number of missions, promotions or store items, prize sizes, bonus amounts, which promotion types a casino runs. Screenshots never capture everything. Offer figures on a screenshot are not a point of comparison.",
  "TONE",
  "- No scores, ranks or averages. No superlatives about competitors (no best, clearest, strongest, best-in-class). Write 'some competitors' or name the casinos (e.g. 'Sir Betalot has a clean layout').",
  "- Competitor features are examples, not recommendations. When two approaches both work, say so (e.g. 'VegasNova and Sir Betalot give the store its own page; SlotMonster and Oliver show it as a tab inside their rewards hub. Both approaches work.').",
  "- Ideas are suggestions worded as options: could, consider, is worth testing, is another option.",
  "- Keep text minimal: card bullets are short phrases; each comparison is a short title plus one or two plain sentences.",
  "NOT A GAP (never list these as potential gaps)",
  "- Valid design choices (e.g. missions and store on separate pages keeps each purpose clear; show a combined hub only as an alternative example).",
  "- One filter when there is only one promotion type (at most: 'Single filter won't scale if more promotion types are added').",
  "- Mission rewards that differ in size; not showing what a reward is worth; missing starter/streak missions; repeated store artwork; no 'next reward you can afford' hint.",
  "- A second gap that is only a consequence of the first (no tournaments -> don't also list 'nothing in the menu').",
  "- Personal preferences: a large banner that uses its space well is a strength; only a banner with a lot of empty space is a fair negative.",
  "FACTS THAT NEED CHECKING",
  "- Anything not yet confirmed, or that might depend on the account or the day (e.g. the cashier shows no bonus: had the account already deposited? a button didn't work), is NOT listed under potential gaps. Show it in a comparison with the subject's screenshot tagged 'check' and add a question for the reviewer. Ask before treating an unusual screenshot (a form or pop-up that may have been taken by mistake) as a finding.",
  "SCREENSHOTS IN COMPARISONS",
  "- Each comparison point covers one idea, with 2 to 4 screenshots; the subject casino's screenshot comes first whenever it's relevant.",
  "- Use only screenshots of this section's actual page or feature (promotions = the promotions page, not homepage banners or cashier bonus cards; tournaments = tournament/race/leaderboard pages; missions = missions pages).",
  "- Put 1 to 3 numbered highlight boxes on the exact elements discussed, each with a short label.",
  "- kind for the subject casino: works, gap (potential gap), check (to check), mixed. For competitors: good (Example), mixed, avoid, note (For reference, a neutral fact).",
  "- Promo cards that send players to other features (missions, rewards hub) are 'mixed': they help discovery but blur promotions and other features; missions belong in their own visible section.",
  "CARDS",
  "- Three cards about the subject casino: works, gaps (shown as 'Potential gaps'), ideas (shown as 'Ideas to consider', numbered). Leave a card empty when nothing fits (it shows 'Not offered').",
].join("\n");

const REVIEW_SHOT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["shots"],
  properties: {
    shots: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["id", "sections", "title", "personal", "unusual"],
        properties: {
          id: { type: "string" },
          sections: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          personal: { type: "array", items: { type: "object", additionalProperties: false, required: ["x", "y", "w", "h"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } } },
          unusual: { type: "string" },
        },
      },
    },
  },
};
const REVIEW_SHOT_SYSTEM = [
  "You sort screenshots of an online casino website for a competitor review.",
  "For each screenshot: sections = the ids of the sections whose actual page or feature it shows (usually one; two only if it genuinely shows both pages; none if it shows none of them, e.g. a game lobby or a help article).",
  "A homepage banner about a promotion is homepage, not promotions; a bonus card in the cashier is deposit; a promo card about a race is promotions, not tournaments.",
  "title = short and descriptive: what page or state the screenshot shows, e.g. 'Lobby with welcome-offer banner', 'Side menu open', 'Cashier: bonus selected, amount', 'Tapping Deposit: ID verification first', 'Missions tab in rewards hub'. No casino name. Leave out amounts and counts: 'Weekly leaderboard', not 'Weekly leaderboard, $50,000 USDT pool'; 'Achievements tab', not 'Achievements tab: 0/17 collected'. Quote the site's own labels in single quotes.",
  "personal = boxes around personal data to blur: player names, usernames, email addresses, cardholder names, phone numbers. Coordinates in thousandths of the image width and height (0 to 1000). Not balances or offer amounts.",
  "unusual = a short note when the screenshot may have been taken by mistake (an unrelated form, an error page, a personal-details form) so the reviewer can confirm; otherwise an empty string.",
].join("\n");

const REVIEW_SECTION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["works", "gaps", "ideas", "points", "questions"],
  properties: {
    works: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    ideas: { type: "array", items: { type: "string" } },
    points: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["title", "text", "shots"],
        properties: {
          title: { type: "string" },
          text: { type: "string" },
          shots: {
            type: "array", items: {
              type: "object", additionalProperties: false, required: ["id", "kind", "boxes"],
              properties: {
                id: { type: "string" },
                kind: { type: "string", enum: ["works", "gap", "check", "mixed", "good", "avoid", "note"] },
                boxes: { type: "array", items: { type: "object", additionalProperties: false, required: ["x", "y", "w", "h", "label"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, label: { type: "string" } } } },
              },
            },
          },
        },
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
};

type ReviewImage = { id?: string; casino?: string; title?: string; media_type?: string; data?: string; elements?: unknown[] };
function reviewImages(body: Record<string, unknown>, max: number) {
  return (Array.isArray(body.images) ? body.images : [])
    .filter((im: ReviewImage) => im && IMAGE_TYPES.includes(im.media_type ?? "") && typeof im.data === "string" && im.data.length > 0)
    .slice(0, max) as ReviewImage[];
}

function sortReviewShots(apiKey: string, body: Record<string, unknown>) {
  const images = reviewImages(body, 12);
  if (!images.length) throw new UserFacingError("bad_request", "No screenshots were received.");
  const sections = (Array.isArray(body.sections) ? body.sections : []).map((x: { id?: string; name?: string }) => `${String(x.id).slice(0, 40)} (${String(x.name).slice(0, 60)})`).join(", ");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: `Casino: ${String(body.casino ?? "").slice(0, 80)}\nSections: ${sections}` }];
  images.forEach((im) => {
    content.push({ type: "text", text: `Screenshot id: ${String(im.id).slice(0, 64)}${im.title ? " | the scanner took it as: " + String(im.title).slice(0, 160) : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type as "image/jpeg", data: im.data as string } });
  });
  content.push({ type: "text", text: "Sort every screenshot." });
  return askClaude(apiKey, REVIEW_SHOT_SYSTEM, content, REVIEW_SHOT_SCHEMA, "low", 8000);
}

function draftReviewSection(apiKey: string, body: Record<string, unknown>) {
  const images = reviewImages(body, 40);
  if (!images.length) throw new UserFacingError("bad_request", "This section has no screenshots yet.");
  const subject = String(body.subject ?? "").slice(0, 80), section = String(body.section ?? "").slice(0, 80);
  const casinos = (Array.isArray(body.casinos) ? body.casinos : []).map((c) => String(c).slice(0, 80)).join(", ");
  const rules = (Array.isArray(body.corrections) ? body.corrections : []).map((c) => "- " + String(c).slice(0, 500)).slice(0, 60).join("\n");
  const draft = body.draft && typeof body.draft === "object" ? JSON.stringify(body.draft).slice(0, 30000) : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 6000) : "";
  const system = "You prepare one section of a competitor review of online casinos for a reviewer. The subject casino is reviewed; the others are competitors shown as examples.\n\n" + REVIEW_RULES +
    "\n\nWRITING GUIDE (follow it for every word you write; its Before -> After examples show the reviewer's own corrections)\n" + WRITING_GUIDE +
    "\n\nOUTPUT\n- works, gaps, ideas: short phrases about the subject casino.\n- points: the 'How it compares' points, each with title, text (one or two sentences: what the subject does and what competitors do) and 2 to 4 shots chosen by id from the screenshots given.\n" +
    "- boxes: coordinates in thousandths of that screenshot's width and height (0 to 1000), tight around the element. When a screenshot lists page elements with positions, align the box to the matching element.\n" +
    "- questions: short questions for the reviewer about anything marked to check or any screenshot that may be a mistake. Empty when there are none.";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text:
    `Subject casino: ${subject}\nCompetitors: ${casinos}\nSection: ${section}` +
    (rules ? `\n\nCorrections the reviewer gave earlier (apply them here too):\n${rules}` : "") +
    (draft ? `\n\nCurrent draft of this section (JSON):\n${draft}` : "") +
    (notes ? `\n\nThe reviewer's notes on this section. Apply them exactly; keep everything else unless a note changes it:\n<notes>\n${notes}\n</notes>` : "") }];
  images.forEach((im) => {
    const els = Array.isArray(im.elements) && im.elements.length ? "\nPage elements (text, x, y, w, h in thousandths): " + JSON.stringify(im.elements).slice(0, 4000) : "";
    content.push({ type: "text", text: `Screenshot id: ${String(im.id).slice(0, 64)} | ${String(im.casino ?? "").slice(0, 80)} | ${String(im.title ?? "").slice(0, 120)}${els}` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type as "image/jpeg", data: im.data as string } });
  });
  content.push({ type: "text", text: draft || notes ? "Return the revised section." : "Write this section." });
  return askClaude(apiKey, system, content, REVIEW_SECTION_SCHEMA, "medium", 16000);
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

    if (action === "read_offer" || action === "summarise_emails" || action === "analyse_page" || action === "sort_page" || action === "sort_senders" || action === "sort_review_shots" || action === "draft_review_section" || action === "read_promotion" || action === "read_feature") {
      if (!anthropicKey) return reply({ error: "no_ai_key", message: "AI isn't set up yet. Add the ANTHROPIC_API_KEY secret in Supabase." });
      const result = action === "read_offer" ? await readOffer(anthropicKey, body)
        : action === "analyse_page" ? await analysePage(anthropicKey, body)
        : action === "sort_page" ? await sortPage(anthropicKey, body)
        : action === "sort_senders" ? await sortSenders(anthropicKey, body)
        : action === "sort_review_shots" ? await sortReviewShots(anthropicKey, body)
        : action === "draft_review_section" ? await draftReviewSection(anthropicKey, body)
        : action === "read_promotion" ? await readPromotion(anthropicKey, body)
        : action === "read_feature" ? await readFeature(anthropicKey, body)
        : await summariseEmails(anthropicKey, body);
      return reply({ result });
    }

    return reply({ error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    if (err instanceof UserFacingError) return reply({ error: err.code, message: err.message });
    return reply({ error: "server_error", message: String((err as Error)?.message ?? err) });
  }
});
