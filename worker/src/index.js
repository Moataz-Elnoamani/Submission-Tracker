/**
 * MN Submission Portal — API worker (Cloudflare Workers)
 *
 * The portal is a static site on GitHub Pages, so it cannot hold secrets.
 * This worker holds them and is the only thing that talks to Opus, Google
 * Sheets and Gmail. Every secret comes from `wrangler secret put …`.
 *
 * Public routes (participants)
 *   GET    /api/health
 *   GET    /api/meta                    latest weekly tab, topic titles, team status
 *   POST   /api/files/presign           Opus upload URL for one file
 *   POST   /api/submit                  start an Opus case → "Log Submission To Tracker"
 *   GET    /api/cases/:caseId           case status (+ mapped results when completed)
 *
 * Manager routes (Authorization: Bearer <token from /api/manager/login>)
 *   POST   /api/manager/login           { passcode } → { token, expiresAt }
 *   GET    /api/manager/tabs            all dated weekly tabs
 *   GET    /api/manager/tracker?tab=    full tracker grid for a tab, with links
 *   GET    /api/manager/runs            portal submission log (newest first)
 *   DELETE /api/manager/runs/:runId     delete one log record
 *   DELETE /api/manager/runs?confirm=DELETE-ALL   purge the log
 *   POST   /api/manager/clear           { tab, participant, topic: "topic 1"|"topic 2"|"both" }
 *   POST   /api/manager/clear-week      { tab, confirm: <tab title> }
 *   POST   /api/manager/notify          { participant | to, subject, message, includeSummary, tab }
 *   POST   /api/manager/trigger         run the workflow with no name (weekly report / reminder check)
 */

// ===== SHEET LAYOUT (mirrors the Code Nodes in the workflow) =====
const PARTICIPANT_ROW_START = 5; // 1-indexed, inclusive
const PARTICIPANT_ROW_END = 9; // 1-indexed, inclusive
const NAME_COL = 0; // A
const TOPICS = {
  "topic 1": { label: "Topic 1", titleCol: 1, start: 2, end: 6 }, // B title, C:G block
  "topic 2": { label: "Topic 2", titleCol: 7, start: 8, end: 12 }, // H title, I:M block
};

// ===== OPUS WORKFLOW INPUT IDS (from the Input node) =====
const INPUT_IDS = {
  participantName: "workflow_input_a3x9ovt9x",
  topic: "workflow_input_rlcwgx5g0",
  builderUrl: "workflow_input_vw0ueu1n9",
  files: "workflow_input_vbdiikkh1",
  subWorkflows: "workflow_input_j2cneh7id",
  notes: "workflow_input_fzwjlypey",
};

const BUILDER_URL_MARKER = "https://app.opus.com/app/builder/workflow";
const MAX_SUB_WORKFLOWS = 3; // input is object{0,1,2}
const MAX_FILES = 10;
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const RUNS_LIST_LIMIT = 200;

// ======================================================================
// Entry
// ======================================================================
// Shared entry: used by Cloudflare (default export) and by Vercel (api/[...path].js).
export async function handle(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const res = await route(request, env);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  } catch (err) {
    const status = err.status || 500;
    return json({ error: err.message || String(err) }, status, cors);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const m = request.method;

  if (path === "/api/health") return json({ ok: true, time: new Date().toISOString() });
  if (path === "/api/meta" && m === "GET") return json(await getMeta(env));
  if (path === "/api/files/presign" && m === "POST") return json(await presign(env, await body(request)));
  if (path === "/api/submit" && m === "POST") return json(await submit(env, await body(request)), 201);

  const caseMatch = path.match(/^\/api\/cases\/([\w-]+)$/);
  if (caseMatch && m === "GET") return json(await caseStatus(env, caseMatch[1], url.searchParams.get("runId")));

  if (path === "/api/manager/login" && m === "POST") return json(await login(env, await body(request)));

  if (path.startsWith("/api/manager/")) {
    await requireManager(request, env);
    if (path === "/api/manager/tabs" && m === "GET") return json(await listTabs(env));
    if (path === "/api/manager/tracker" && m === "GET") return json(await getTracker(env, url.searchParams.get("tab")));
    if (path === "/api/manager/runs" && m === "GET") return json(await listRuns(env));
    if (path === "/api/manager/runs" && m === "DELETE") return json(await purgeRuns(env, url.searchParams.get("confirm")));
    const runMatch = path.match(/^\/api\/manager\/runs\/([\w-]+)$/);
    if (runMatch && m === "DELETE") return json(await deleteRun(env, runMatch[1]));
    if (path === "/api/manager/clear" && m === "POST") return json(await clearEntry(env, await body(request)));
    if (path === "/api/manager/clear-week" && m === "POST") return json(await clearWeek(env, await body(request)));
    if (path === "/api/manager/notify" && m === "POST") return json(await notify(env, await body(request)));
    if (path === "/api/manager/trigger" && m === "POST") return json(await triggerScheduled(env), 201);
  }
  throw httpError(404, "Not found: " + m + " " + path);
}

// ======================================================================
// Public handlers
// ======================================================================
async function getMeta(env) {
  const g = await google(env);
  const tabs = await datedTabs(g);
  if (!tabs.length) throw httpError(404, "No dated weekly tabs found in the tracker sheet.");
  const tab = tabs[0];
  const grid = await readGrid(g, tab.title);
  const rows = participantRows(grid);
  return {
    tab: { title: tab.title, date: tab.date },
    topics: topicTitles(grid),
    participants: rows.map((r) => r.name),
    // Public view shows statuses only, never links or notes.
    status: rows.map((r) => ({ name: r.name, topic1: r.topic1.status, topic2: r.topic2.status })),
  };
}

async function presign(env, b) {
  const name = str(b.fileName);
  if (!name) throw httpError(400, "fileName is required.");
  const ext = (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (!ext) throw httpError(400, "The file needs an extension (e.g. .pdf).");
  const r = await opus(env, "POST", "/api/v1/file/upload/presigned", {
    fileExtension: ext,
    originalName: name,
    workflowId: env.WORKFLOW_ID,
  });
  if (!r.presignedUrl || !r.fileUrl) throw httpError(502, "Opus did not return an upload URL.");
  return { presignedUrl: r.presignedUrl, fileUrl: r.fileUrl };
}

async function submit(env, b) {
  const participantName = str(b.participantName);
  const topic = str(b.topic);
  const builderUrl = str(b.builderUrl);
  const notes = str(b.notes);
  const subWorkflows = (Array.isArray(b.subWorkflows) ? b.subWorkflows : []).map(str).filter(Boolean);
  const fileUrls = (Array.isArray(b.fileUrls) ? b.fileUrls : []).map(str).filter(Boolean);
  const fileNames = Array.isArray(b.fileNames) ? b.fileNames.map(str) : [];

  // ---- validation (same rules the Log node enforces, caught earlier) ----
  if (!participantName) throw httpError(400, "Participant name is required.");
  if (!topic) throw httpError(400, "Topic is required.");
  if (!builderUrl && !notes && !subWorkflows.length && !fileUrls.length)
    throw httpError(400, "Add a workflow link, a file, or a note — nothing to log.");
  if (builderUrl && !builderUrl.includes(BUILDER_URL_MARKER))
    throw httpError(400, "The main workflow link must be an Opus Builder link (" + BUILDER_URL_MARKER + "…).");
  if (subWorkflows.length > MAX_SUB_WORKFLOWS)
    throw httpError(400, "At most " + MAX_SUB_WORKFLOWS + " sub-workflow links are accepted.");
  for (const u of subWorkflows)
    if (!u.includes(BUILDER_URL_MARKER)) throw httpError(400, "Sub-workflow link is not an Opus Builder link: " + u);
  if (fileUrls.length > MAX_FILES) throw httpError(400, "At most " + MAX_FILES + " files are accepted.");

  const roster = participants(env);
  if (roster.length && !roster.some((p) => p.name.toLowerCase() === participantName.toLowerCase()))
    throw httpError(400, "'" + participantName + "' is not on the participant list.");

  // ---- Execute Case payload, keyed by the Input node's variable IDs ----
  const payload = {
    [INPUT_IDS.participantName]: { value: participantName, type: "str" },
    [INPUT_IDS.topic]: { value: topic, type: "str" },
  };
  if (builderUrl) payload[INPUT_IDS.builderUrl] = { value: builderUrl, type: "str" };
  if (notes) payload[INPUT_IDS.notes] = { value: notes, type: "str" };
  if (subWorkflows.length) {
    const obj = {};
    subWorkflows.forEach((u, i) => (obj[String(i)] = u));
    payload[INPUT_IDS.subWorkflows] = { value: obj, type: "object" };
  }
  if (fileUrls.length) {
    payload[INPUT_IDS.files] = {
      value: fileUrls,
      type: "array",
      displayName: "Input Files (Optional)",
      typeDefinition: { id: "file", variable_name: "file", allowed_types: [{ type: "file" }] },
    };
  }

  const init = await opus(env, "POST", "/api/v1/case", {
    workflowId: env.WORKFLOW_ID,
    title: "Portal submission — " + participantName + " — " + topic,
    description: "Submitted from the MN Submission Portal",
  });
  const caseId = String(init.caseId || "");
  if (!caseId) throw httpError(502, "Opus did not return a caseId.");
  await opus(env, "POST", "/api/v1/case/" + caseId + "/execute", { payload });

  const run = {
    runId: newRunId(),
    caseId,
    submittedAt: new Date().toISOString(),
    participantName,
    topic,
    builderUrl,
    subWorkflows,
    files: fileUrls.map((u, i) => ({ url: u, name: fileNames[i] || "File (" + (i + 1) + ")" })),
    notes,
    status: "PENDING",
    results: null,
  };
  await saveRun(env, run);
  return { runId: run.runId, caseId, status: run.status };
}

async function caseStatus(env, caseId, runId) {
  const s = await opus(env, "GET", "/api/v1/case/" + caseId + "/status");
  const status = String(s.status || s.caseStatus || "UNKNOWN").toUpperCase();
  let results = null;
  if (status === "COMPLETED") results = await caseResults(env, caseId);
  if (runId) await patchRun(env, runId, { status, results });
  return { caseId, status, terminal: TERMINAL.includes(status), results };
}

async function caseResults(env, caseId) {
  try {
    const r = await opus(env, "GET", "/api/v1/case/" + caseId + "/results");
    const raw = r.results || {};
    const map = jsonEnv(env.OUTPUT_MAP, {}); // { log_status: "workflow_output_xxx", ... }
    const mapped = {};
    for (const [friendly, id] of Object.entries(map)) {
      let v = raw[id] && raw[id].value !== undefined ? raw[id].value : raw[id];
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) {} }
      if (v !== undefined) mapped[friendly] = v;
    }
    return { mapped, raw };
  } catch (e) {
    return { mapped: {}, raw: {}, error: e.message };
  }
}

// ======================================================================
// Manager handlers
// ======================================================================
async function login(env, b) {
  const passcode = str(b.passcode);
  if (!env.MANAGER_PASSCODE) throw httpError(500, "MANAGER_PASSCODE is not configured on the server.");
  if (!passcode || !(await safeEqual(passcode, env.MANAGER_PASSCODE))) {
    await sleep(600); // slow down guessing
    throw httpError(401, "Incorrect passcode.");
  }
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = b64url(new TextEncoder().encode(String(exp)));
  const sig = await hmac(env.TOKEN_SECRET || env.MANAGER_PASSCODE, payload);
  return { token: payload + "." + sig, expiresAt: new Date(exp * 1000).toISOString() };
}

async function requireManager(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "");
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw httpError(401, "Manager sign-in required.");
  const expected = await hmac(env.TOKEN_SECRET || env.MANAGER_PASSCODE, payload);
  if (!(await safeEqual(sig, expected))) throw httpError(401, "Invalid session.");
  const exp = Number(new TextDecoder().decode(fromB64url(payload)));
  if (!exp || exp < Date.now() / 1000) throw httpError(401, "Session expired — sign in again.");
}

async function listTabs(env) {
  const g = await google(env);
  return { tabs: (await datedTabs(g)).map(({ title, date, sheetId }) => ({ title, date, sheetId })) };
}

async function getTracker(env, tabTitle) {
  const g = await google(env);
  const tab = await resolveTab(g, tabTitle);
  const grid = await readGridRich(g, tab.title);
  const roster = participants(env);
  const rows = participantRows(grid, true).map((r) => {
    const p = roster.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
    return { ...r, email: p ? p.email : "" };
  });
  return { tab: { title: tab.title, date: tab.date }, topics: topicTitles(grid), rows };
}

async function listRuns(env) {
  kvRequired(env);
  const list = await runsStore(env).list({ prefix: "run:", limit: RUNS_LIST_LIMIT });
  const runs = (await Promise.all(list.keys.map((k) => runsStore(env).get(k.name, "json")))).filter(Boolean);

  // Refresh a few runs that never reached a terminal status (user closed the tab mid-run).
  const stale = runs.filter((r) => !TERMINAL.includes(r.status)).slice(0, 5);
  await Promise.all(
    stale.map(async (r) => {
      try {
        const s = await caseStatus(env, r.caseId, r.runId);
        r.status = s.status;
        r.results = s.results;
      } catch (_) {}
    })
  );
  return { runs };
}

async function deleteRun(env, runId) {
  kvRequired(env);
  await runsStore(env).delete("run:" + runId);
  return { deleted: runId };
}

async function purgeRuns(env, confirm) {
  kvRequired(env);
  if (confirm !== "DELETE-ALL") throw httpError(400, "Pass ?confirm=DELETE-ALL to purge the log.");
  let cursor, count = 0;
  do {
    const page = await runsStore(env).list({ prefix: "run:", cursor });
    await Promise.all(page.keys.map((k) => runsStore(env).delete(k.name)));
    count += page.keys.length;
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { deleted: count };
}

async function clearEntry(env, b) {
  const g = await google(env);
  const tab = await resolveTab(g, str(b.tab));
  const grid = await readGrid(g, tab.title);
  const rowIndex = findParticipantRow(grid, str(b.participant));
  if (rowIndex < 0) throw httpError(404, "Participant '" + b.participant + "' not found in '" + tab.title + "'.");
  const which = str(b.topic).toLowerCase();
  const keys = which === "both" ? ["topic 1", "topic 2"] : [which];
  if (!keys.every((k) => TOPICS[k])) throw httpError(400, "topic must be 'topic 1', 'topic 2' or 'both'.");
  await sheetsBatch(g, keys.map((k) => clearRequest(tab.sheetId, rowIndex, rowIndex + 1, TOPICS[k])));
  return { cleared: { tab: tab.title, participant: b.participant, topics: keys } };
}

async function clearWeek(env, b) {
  const g = await google(env);
  const tab = await resolveTab(g, str(b.tab));
  if (str(b.confirm) !== tab.title) throw httpError(400, "Type the tab title exactly to confirm clearing it.");
  const reqs = Object.values(TOPICS).map((t) =>
    clearRequest(tab.sheetId, PARTICIPANT_ROW_START - 1, PARTICIPANT_ROW_END, t)
  );
  await sheetsBatch(g, reqs);
  return { cleared: { tab: tab.title, rows: PARTICIPANT_ROW_START + "-" + PARTICIPANT_ROW_END } };
}

async function notify(env, b) {
  const roster = participants(env);
  let to = str(b.to);
  let name = str(b.participant);
  if (!to && name) {
    const p = roster.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) throw httpError(404, "No email on file for '" + name + "'.");
    to = p.email;
  }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw httpError(400, "A valid recipient is required.");
  const subject = str(b.subject) || "Note on your weekly submission";
  const message = str(b.message);
  if (!message) throw httpError(400, "Message is empty.");

  let summaryHtml = "";
  if (b.includeSummary && name) {
    const tracker = await getTracker(env, str(b.tab));
    const row = tracker.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (row) summaryHtml = summaryTable(tracker, row);
  }

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#181818;max-width:640px">' +
    "<p>Hi " + esc(name || "there") + ",</p>" +
    "<p>" + esc(message).replace(/\n/g, "<br>") + "</p>" +
    summaryHtml +
    '<p style="color:#959595;font-size:12px;margin-top:24px">Sent from the MN Submission Portal</p></div>';

  const g = await google(env);
  const r = await gfetch(g, "POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    raw: rawEmail(to, subject, html, env.MANAGER_EMAIL),
  });
  return { sent: true, to, messageId: r.id || "" };
}

async function triggerScheduled(env) {
  // No participant name → "Classify Trigger Scenario" picks Weekly Passthrough or Reminder Check.
  const init = await opus(env, "POST", "/api/v1/case", {
    workflowId: env.WORKFLOW_ID,
    title: "Manual scheduled check",
    description: "Triggered from the MN Submission Portal (manager)",
  });
  const caseId = String(init.caseId || "");
  await opus(env, "POST", "/api/v1/case/" + caseId + "/execute", { payload: {} });
  return { caseId };
}

// ======================================================================
// Sheet helpers
// ======================================================================
const TAB_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function datedTabs(g) {
  const meta = await gfetch(g, "GET", sheetsUrl(g, "", { fields: "sheets.properties" }));
  const today = new Date();
  const out = [];
  for (const s of meta.sheets || []) {
    const title = s.properties.title;
    const mm = TAB_RE.exec(title.trim());
    if (!mm) continue;
    const day = +mm[2], month = MONTHS.indexOf(mm[3]);
    let d = new Date(Date.UTC(mm[4] ? +mm[4] : today.getUTCFullYear(), month, day));
    if (!mm[4] && d > today) d = new Date(Date.UTC(today.getUTCFullYear() - 1, month, day));
    out.push({ title, date: d.toISOString().slice(0, 10), sheetId: s.properties.sheetId });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function resolveTab(g, title) {
  const tabs = await datedTabs(g);
  if (!tabs.length) throw httpError(404, "No dated weekly tabs found.");
  if (!title) return tabs[0];
  const t = tabs.find((x) => x.title === title);
  if (!t) throw httpError(404, "Tab '" + title + "' not found.");
  return t;
}

function rangeFor(title) {
  return "'" + title.replace(/'/g, "''") + "'!A1:M" + PARTICIPANT_ROW_END;
}

async function readGrid(g, title) {
  const r = await gfetch(g, "GET", sheetsUrl(g, "/values/" + encodeURIComponent(rangeFor(title))));
  // Normalise to rich-cell shape so one parser handles both.
  return (r.values || []).map((row) => ({ values: row.map((v) => ({ formattedValue: String(v) })) }));
}

async function readGridRich(g, title) {
  const r = await gfetch(
    g,
    "GET",
    sheetsUrl(g, "", {
      ranges: rangeFor(title),
      fields: "sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns)",
    })
  );
  return (((r.sheets || [])[0] || {}).data || [{}])[0].rowData || [];
}

function cell(grid, r, c) {
  const row = grid[r];
  if (!row || !row.values) return {};
  return row.values[c] || {};
}
const text = (cellObj) => String(cellObj.formattedValue || "").trim();

function linksIn(c) {
  const fv = c.formattedValue || "";
  if (!fv) return [];
  if (c.hyperlink) return [{ text: fv.trim(), url: c.hyperlink }];
  const runs = c.textFormatRuns || [];
  const out = [];
  runs.forEach((run, i) => {
    const s = run.startIndex || 0;
    const e = i + 1 < runs.length ? runs[i + 1].startIndex || fv.length : fv.length;
    const uri = run.format && run.format.link && run.format.link.uri;
    const seg = fv.slice(s, e).trim();
    if (uri && seg) out.push({ text: seg, url: uri });
  });
  return out;
}

function classifyBlock(grid, r, t, withDetail) {
  const links = [];
  const texts = [];
  for (let c = t.start; c <= t.end; c++) {
    const ce = cell(grid, r, c);
    const l = linksIn(ce);
    if (l.length) links.push(...l);
    else if (text(ce)) texts.push(text(ce));
  }
  const status = links.length ? "submitted" : texts.length ? "excused" : "missing";
  if (!withDetail) return { status };
  return { status, links, note: texts.join(" · "), raw: text(cell(grid, r, t.start)) };
}

function participantRows(grid, withDetail = false) {
  const rows = [];
  for (let n = PARTICIPANT_ROW_START; n <= PARTICIPANT_ROW_END; n++) {
    const r = n - 1;
    const name = text(cell(grid, r, NAME_COL));
    if (!name) continue;
    rows.push({
      name,
      sheetRow: n,
      topic1: classifyBlock(grid, r, TOPICS["topic 1"], withDetail),
      topic2: classifyBlock(grid, r, TOPICS["topic 2"], withDetail),
    });
  }
  return rows;
}

function topicTitles(grid) {
  const first = (col) => {
    for (let n = PARTICIPANT_ROW_START; n <= PARTICIPANT_ROW_END; n++) {
      const v = text(cell(grid, n - 1, col));
      if (v) return v;
    }
    return "";
  };
  return { topic1: first(TOPICS["topic 1"].titleCol), topic2: first(TOPICS["topic 2"].titleCol) };
}

function findParticipantRow(grid, name) {
  const target = name.trim().toLowerCase();
  for (let n = PARTICIPANT_ROW_START; n <= PARTICIPANT_ROW_END; n++)
    if (text(cell(grid, n - 1, NAME_COL)).toLowerCase() === target) return n - 1;
  return -1;
}

function clearRequest(sheetId, startRow, endRow, t) {
  // updateCells with no rows clears the listed fields; merges and formatting stay.
  return {
    updateCells: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: t.start, endColumnIndex: t.end + 1 },
      fields: "userEnteredValue,textFormatRuns",
    },
  };
}

async function sheetsBatch(g, requests) {
  return gfetch(g, "POST", sheetsUrl(g, ":batchUpdate"), { requests });
}

function summaryTable(tracker, row) {
  const cellHtml = (t) => {
    const color = { submitted: "#2e7d32", excused: "#b58900", missing: "#c62828" }[t.status];
    const detail = t.links && t.links.length
      ? t.links.map((l) => '<a href="' + esc(l.url) + '">' + esc(l.text) + "</a>").join(" · ")
      : esc(t.note || "");
    return '<b style="color:' + color + '">' + t.status + "</b>" + (detail ? "<br>" + detail : "");
  };
  const td = 'style="padding:8px 12px;border-bottom:1px solid #EFEFEF;vertical-align:top"';
  return (
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:13px">' +
    "<tr><td " + td + "><b>Week</b></td><td " + td + ">" + esc(tracker.tab.title) + "</td></tr>" +
    "<tr><td " + td + "><b>Topic 1</b> " + esc(tracker.topics.topic1) + "</td><td " + td + ">" + cellHtml(row.topic1) + "</td></tr>" +
    "<tr><td " + td + "><b>Topic 2</b> " + esc(tracker.topics.topic2) + "</td><td " + td + ">" + cellHtml(row.topic2) + "</td></tr>" +
    "</table>"
  );
}

// ======================================================================
// Google + Opus clients
// ======================================================================
async function google(env) {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SPREADSHEET_ID"])
    if (!env[k]) throw httpError(500, k + " is not configured on the server.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw httpError(502, "Google token exchange failed: " + (j.error_description || j.error || r.status));
  return { token: j.access_token, spreadsheetId: env.SPREADSHEET_ID };
}

function sheetsUrl(g, suffix, params) {
  const u = "https://sheets.googleapis.com/v4/spreadsheets/" + g.spreadsheetId + suffix;
  return params ? u + "?" + new URLSearchParams(params) : u;
}

async function gfetch(g, method, url, payload) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + g.token, ...(payload ? { "Content-Type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, "Google API " + r.status + ": " + ((j.error && j.error.message) || "request failed"));
  return j;
}

async function opus(env, method, path, payload) {
  if (!env.OPUS_SERVICE_KEY || !env.WORKFLOW_ID)
    throw httpError(500, "OPUS_SERVICE_KEY and WORKFLOW_ID must be configured on the server.");
  const base = env.OPUS_BASE_URL || "https://operator.opus.com";
  const r = await fetch(base.replace(/\/+$/, "") + path, {
    method,
    headers: { "x-service-key": env.OPUS_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const t = await r.text();
  let j = {};
  try { j = t ? JSON.parse(t) : {}; } catch (_) { j = { raw: t }; }
  if (!r.ok) throw httpError(502, "Opus API " + r.status + " on " + path + ": " + (j.message || j.error || t.slice(0, 200)));
  return j;
}

// ======================================================================
// Run log — Cloudflare KV binding, or Upstash Redis over REST (Vercel)
// ======================================================================
function runsStore(env) {
  if (env.RUNS) return env.RUNS;
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const cmd = async (...args) => {
    const r = await fetch(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw httpError(502, "Run-log store error: " + (j.error || r.status));
    return j.result;
  };
  // Same surface as the Cloudflare KV methods used above.
  return {
    async get(key, type) {
      const v = await cmd("GET", key);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: (key, value) => cmd("SET", key, value),
    delete: (key) => cmd("DEL", key),
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const keys = [];
      let c = cursor || "0";
      do {
        const [next, batch] = await cmd("SCAN", c, "MATCH", prefix + "*", "COUNT", 500);
        keys.push(...batch);
        c = next;
      } while (c !== "0");
      keys.sort(); // reverse-timestamp ids → newest first
      return { keys: keys.slice(0, limit).map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
function kvRequired(env) {
  if (!runsStore(env))
    throw httpError(500, "No run-log store: bind KV 'RUNS' (Cloudflare) or connect Upstash Redis (Vercel) — see README.");
}
function newRunId() {
  // Reverse timestamp so KV's lexical listing returns newest first.
  const rev = String(9999999999999 - Date.now()).padStart(13, "0");
  return rev + "-" + crypto.randomUUID().slice(0, 8);
}
async function saveRun(env, run) {
  if (runsStore(env)) await runsStore(env).put("run:" + run.runId, JSON.stringify(run));
}
async function patchRun(env, runId, patch) {
  if (!runsStore(env)) return;
  const cur = await runsStore(env).get("run:" + runId, "json");
  if (cur) await runsStore(env).put("run:" + runId, JSON.stringify({ ...cur, ...patch, updatedAt: new Date().toISOString() }));
}

// ======================================================================
// Utilities
// ======================================================================
function participants(env) {
  return jsonEnv(env.PARTICIPANTS, [])
    .map((p) => ({ name: str(p.Name || p.name), email: str(p.Email || p.email) }))
    .filter((p) => p.name);
}
function jsonEnv(v, fallback) {
  if (!v) return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (allowed.includes("*") ? "*" : origin) : "null",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });
}
async function body(request) {
  try { return await request.json(); } catch (_) { throw httpError(400, "Body must be JSON."); }
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}
async function safeEqual(a, b) {
  // Compare HMACs of both values so timing does not leak the passcode.
  const k = "cmp";
  return (await hmac(k, a)) === (await hmac(k, b));
}
function rawEmail(to, subject, html, replyTo) {
  const enc = (s) => b64(new TextEncoder().encode(s));
  const headers = [
    "To: " + to,
    "Subject: =?UTF-8?B?" + enc(subject) + "?=",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
  ];
  if (replyTo) headers.push("Reply-To: " + replyTo);
  return b64url(new TextEncoder().encode(headers.join("\r\n") + "\r\n\r\n" + html));
}
