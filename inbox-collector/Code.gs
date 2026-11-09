/**
 * Conversion Cycle Planner - inbox collector
 *
 * Runs inside a dedicated research Gmail account and shares its recent
 * emails with the planner as JSON. Setup steps are in inbox-collector/README.md.
 *
 * Only use this with a mailbox that holds nothing but competitor emails:
 * anyone with the web app URL and the token can read them.
 */

var LOOKBACK_DAYS = 60;     // how far back to read
var MAX_THREADS = 150;      // Gmail threads per request
var MAX_BODY_CHARS = 6000;  // text kept per email

/** Run this once from the editor. It creates the secret token and prints it in the log. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  // Touch Gmail so the authorisation prompt asks for it.
  GmailApp.getInboxUnreadCount();
  Logger.log('Your token (paste it into the planner): ' + token);
}

/** Run this if the token ever leaks. Paste the new token into the planner afterwards. */
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) return json_({ error: 'not_set_up', message: 'Run setup() in the Apps Script editor first.' });
  if (params.token !== expected) return json_({ error: 'unauthorized', message: 'The token does not match.' });

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
  return json_({ account: Session.getEffectiveUser().getEmail(), fetchedAt: new Date().toISOString(), days: days, emails: emails });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
