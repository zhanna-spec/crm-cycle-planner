/**
 * Conversion Cycle Planner - Google script
 *
 * 1. Shares a research Gmail account's recent emails with the planner.
 * 2. Runs the planner's AI features (reading offer screenshots, summarising
 *    competitor emails) with an Anthropic API key that stays in this script.
 *
 * Setup steps are in inbox-collector/README.md.
 *
 * Only use this with a mailbox that holds nothing but competitor emails:
 * anyone with the web app URL and the token can read them and use the two
 * AI features (never the key itself). Set a spend limit on the key.
 */

var LOOKBACK_DAYS = 60;     // how far back to read emails
var MAX_THREADS = 150;      // Gmail threads per request
var MAX_BODY_CHARS = 6000;  // text kept per email
var MODEL = 'claude-opus-5-5';
var ANTHROPIC_VERSION = '2026-10-21';

/** Run this once from the editor. It creates the secret token and prints it in the log. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  // Touch Gmail and the network so the authorisation prompt asks for both.
  GmailApp.getInboxUnreadCount();
  try { UrlFetchApp.fetch('https://api.anthropic.com', { muteHttpExceptions: true }); } catch (err) {}
  Logger.log('Your token (paste it into the planner): ' + token);
  Logger.log(props.getProperty('ANTHROPIC_API_KEY') ? 'Anthropic key found. AI features are on.' : 'No Anthropic key yet. Add ANTHROPIC_API_KEY under Project Settings > Script properties to turn on AI features.');
}

/** Run this if the token ever leaks. Paste the new token into the planner afterwards. */
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

// ---------- emails (GET) ----------

function doGet(e) {
  var params = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('TOKEN');
  if (!expected) return json_({ error: 'not_set_up', message: 'Run setup() in the Apps Script editor first.' });
  if (params.token !== expected) return json_({ error: 'unauthorized', message: 'The token does not match.' });

  var account = Session.getEffectiveUser().getEmail();
  var ai = !!props.getProperty('ANTHROPIC_API_KEY');
  if (params.status) return json_({ ok: true, account: account, ai: ai, version: 2 });

  var days = Math.min(365, Math.max(1, parseInt(params.days, 10) || LOOKBACK_DAYS));
  var query = 'newer_than:' + days + 'd -in:chats -in:sent -in:drafts';
  var threads = GmailApp.search(query, 0, MAX_THREADS);
  var emails = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      var text = '';
      try { text = m.getPlainBody() || ''; } catch (err) { text = ''; }
      text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      emails.push({
        id: m.getId(),
        date: m.getDate().toISOString(),
        from: m.getFrom(),
        to: m.getTo(),
        subject: m.getSubject(),
        text: text.slice(0, MAX_BODY_CHARS)
      });
    });
  });

  emails.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return json_({ account: account, ai: ai, version: 2, fetchedAt: new Date().toISOString(), days: days, emails: emails });
}

// ---------- AI features (POST) ----------

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ error: 'bad_request', message: 'The request was not valid JSON.' }); }

  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('TOKEN');
  if (!expected) return json_({ error: 'not_set_up', message: 'Run setup() in the Apps Script editor first.' });
  if (body.token !== expected) return json_({ error: 'unauthorized', message: 'The token does not match.' });

  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) return json_({ error: 'no_ai_key', message: 'The script has no Anthropic key yet. Add ANTHROPIC_API_KEY under Project Settings > Script properties.' });

  try {
    if (body.action === 'read_offer') return json_({ result: readOffer_(key, body) });
    if (body.action === 'summarise_emails') return json_({ result: summariseEmails_(key, body) });
    return json_({ error: 'unknown_action', message: 'Unknown action.' });
  } catch (err) {
    return json_({ error: 'ai_failed', message: String((err && err.message) || err) });
  }
}

var NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] };
var STR = { anyOf: [{ type: 'string' }, { type: 'null' }] };

var OFFER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    competitor: { type: 'string', description: 'Brand name of the casino or sportsbook' },
    offer_title: { type: 'string', description: 'Headline of the welcome offer as written' },
    offer_type: { type: 'string', enum: ['match', 'free_spins', 'free_bet', 'cashback', 'no_deposit', 'other'] },
    match_pct: NUM, max_bonus: NUM, currency: STR, free_spins: NUM, free_bet_value: NUM,
    wagering_x: NUM, wagering_on: STR, min_deposit: NUM, max_bet: NUM, expiry_days: NUM, max_cashout: NUM,
    eligible_games: STR,
    other_conditions: { type: 'array', items: { type: 'string' } },
    uncertain_fields: { type: 'array', items: { type: 'string' } }
  },
  required: ['competitor', 'offer_title', 'offer_type', 'match_pct', 'max_bonus', 'currency', 'free_spins', 'free_bet_value', 'wagering_x', 'wagering_on', 'min_deposit', 'max_bet', 'expiry_days', 'max_cashout', 'eligible_games', 'other_conditions', 'uncertain_fields']
};
var OFFER_SYSTEM = 'You read screenshots of online casino and sportsbook promotion pages and their bonus terms, and extract the main welcome offer into the given JSON schema.\n' +
  'Use only what is visible in the screenshots. When a value is not shown, return null for it and add the field name to uncertain_fields. Also add a field to uncertain_fields when the text is blurry, cut off or ambiguous.\n' +
  'Write amounts as plain numbers without currency symbols and put the ISO currency code in currency. If the welcome offer is split across several deposits, use the first deposit for match_pct and max_bonus, and describe the rest in other_conditions.\n' +
  'wagering_on says what the wagering applies to, for example "bonus" or "deposit + bonus". expiry_days is how long the player has to meet the wagering. other_conditions lists any other rules a player would care about, each as one short plain sentence.';

var PURPOSES = ['welcome', 'deposit_nudge', 'offer', 'reminder', 'reactivation', 'newsletter', 'transactional', 'other'];
var EMAIL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['overview', 'patterns', 'emails'],
  properties: {
    overview: { type: 'string' },
    patterns: { type: 'array', items: { type: 'string' } },
    emails: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['email_id', 'purpose', 'offer_type', 'offer_summary', 'match_pct', 'max_bonus', 'free_spins', 'free_bet_value', 'cashback_pct', 'wagering_x', 'deadline', 'cta'],
      properties: {
        email_id: { type: 'string' },
        purpose: { type: 'string', enum: PURPOSES },
        offer_type: { type: 'string', enum: ['match', 'free_spins', 'free_bet', 'cashback', 'no_deposit', 'none', 'other'] },
        offer_summary: STR, match_pct: NUM, max_bonus: NUM, free_spins: NUM, free_bet_value: NUM, cashback_pct: NUM, wagering_x: NUM, deadline: STR, cta: STR
      } } }
  }
};
var EMAIL_SYSTEM = 'You analyse the marketing emails that one online casino or sportsbook sent to a newly registered player, to help a CRM team understand that competitor\'s conversion cycle.\n' +
  'For each email, return its email_id unchanged, classify its purpose, and extract any offer exactly as written. Use null for anything the email doesn\'t state; never guess numbers. offer_summary is a short label such as "100% up to €200, 35x" or null when there is no offer.\n' +
  'overview: 3 to 5 plain sentences describing the sequence: how often they email, when offers appear, how offers change over time, and what happens near the end. Refer to timing as "day N" using the day numbers given.\n' +
  'patterns: up to 5 short, concrete observations a CRM manager could act on.';

function readOffer_(key, body) {
  var allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  var images = (body.images || []).filter(function (im) {
    return im && allowed.indexOf(im.media_type) >= 0 && typeof im.data === 'string' && im.data.length > 0;
  }).slice(0, 5);
  if (!images.length) throw new Error('No screenshots were received.');
  var content = images.map(function (im) {
    return { type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } };
  });
  content.push({ type: 'text', text: 'Extract the main welcome offer from these ' + images.length + ' screenshot(s).' });
  return callClaude_(key, OFFER_SYSTEM, content, OFFER_SCHEMA);
}

function summariseEmails_(key, body) {
  var emails = (body.emails || []).slice(0, 80);
  if (!emails.length) throw new Error('No emails were received.');
  var input = 'Competitor: ' + String(body.competitor || 'unknown').slice(0, 100) + '\n' +
    'Registered on: ' + String(body.registered || 'unknown').slice(0, 20) + '\n\n' +
    emails.map(function (em) {
      return '=== email_id: ' + String(em.id).slice(0, 64) + ' | day ' + (parseInt(em.day, 10) || 0) + ' | ' + String(em.date || '').slice(0, 40) +
        '\nFrom: ' + String(em.from || '').slice(0, 200) + '\nSubject: ' + String(em.subject || '').slice(0, 300) +
        '\n\n' + String(em.text || '').slice(0, 3000);
    }).join('\n\n');
  return callClaude_(key, EMAIL_SYSTEM, [{ type: 'text', text: input }], EMAIL_SCHEMA);
}

function callClaude_(key, system, content, schema) {
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } },
      system: system,
      messages: [{ role: 'user', content: content }]
    })
  });

  var code = res.getResponseCode();
  var data = {};
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  var detail = (data.error && data.error.message) || '';

  if (code === 401) throw new Error('The Anthropic key in the script was rejected. Check ANTHROPIC_API_KEY in Script properties.');
  if (code === 403) throw new Error('The Anthropic key does not have permission for this. ' + detail);
  if (code === 429) throw new Error('Too many requests, or the key\'s spend limit was reached. Wait a minute and try again.');
  if (code === 529 || code >= 500) throw new Error('Anthropic is busy right now. Try again in a minute.');
  if (code !== 200) throw new Error('Anthropic returned an error (' + code + '). ' + detail);

  if (data.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (data.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try with fewer screenshots or emails.');

  var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  try { return JSON.parse(text); }
  catch (err) { throw new Error('Claude\'s answer was not in the expected format. Try again.'); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
