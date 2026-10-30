/*
 * API client. Talks to the worker (worker/src/index.js) when
 * PORTAL_CONFIG.API_BASE is set; otherwise serves in-memory demo data so the
 * portal can be previewed straight from GitHub Pages before the worker exists.
 */
(function () {
  const CFG = window.PORTAL_CONFIG;
  const DEMO = !CFG.API_BASE;
  const TOKEN_KEY = "mn_portal_manager_token";

  // ------------------------------------------------------------------ real
  async function call(method, path, body, auth) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const t = session.token();
      if (t) headers.Authorization = "Bearer " + t;
    }
    const res = await fetch(CFG.API_BASE.replace(/\/+$/, "") + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && auth) session.clear();
    if (!res.ok) {
      const err = new Error(data.error || "Request failed (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function uploadFile(file) {
    const { presignedUrl, fileUrl } = await call("POST", "/api/files/presign", { fileName: file.name });
    const put = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error("Upload failed for " + file.name + " (" + put.status + ")");
    return fileUrl;
  }

  const session = {
    token() {
      try {
        const s = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
        if (s && new Date(s.expiresAt) > new Date()) return s.token;
      } catch (_) {}
      return null;
    },
    set(s) { try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch (_) {} },
    clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {} },
  };

  const real = {
    meta: () => call("GET", "/api/meta"),
    uploadFile,
    submit: (p) => call("POST", "/api/submit", p),
    caseStatus: (caseId, runId) => call("GET", "/api/cases/" + encodeURIComponent(caseId) + "?runId=" + encodeURIComponent(runId || "")),
    login: async (passcode) => { const s = await call("POST", "/api/manager/login", { passcode }); session.set(s); return s; },
    tabs: () => call("GET", "/api/manager/tabs", undefined, true),
    tracker: (tab) => call("GET", "/api/manager/tracker?tab=" + encodeURIComponent(tab || ""), undefined, true),
    runs: () => call("GET", "/api/manager/runs", undefined, true),
    deleteRun: (id) => call("DELETE", "/api/manager/runs/" + encodeURIComponent(id), undefined, true),
    purgeRuns: () => call("DELETE", "/api/manager/runs?confirm=DELETE-ALL", undefined, true),
    clearEntry: (p) => call("POST", "/api/manager/clear", p, true),
    clearWeek: (p) => call("POST", "/api/manager/clear-week", p, true),
    notify: (p) => call("POST", "/api/manager/notify", p, true),
    trigger: () => call("POST", "/api/manager/trigger", {}, true),
  };

  // ------------------------------------------------------------------ demo
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const B = CFG.BUILDER_URL_MARKER + "/";
  const L = (t, id) => ({ text: t, url: B + id });

  const demoDb = {
    tabs: [
      { title: "Mon 26 Oct", date: "2026-10-26", sheetId: 3 },
      { title: "Mon 19 Oct", date: "2026-10-19", sheetId: 2 },
      { title: "Mon 12 Oct", date: "2026-10-12", sheetId: 1 },
    ],
    topics: {
      "Mon 26 Oct": { topic1: "Invoice Exception Triage", topic2: "Vendor Onboarding KYC" },
      "Mon 19 Oct": { topic1: "Leave Request Approval", topic2: "Contract Clause Extraction" },
      "Mon 12 Oct": { topic1: "Email Ticket Routing", topic2: "Expense Policy Check" },
    },
    participants: [
      { name: "Minu", email: "minu.bobasn@aaico.com" },
      { name: "Asem", email: "asem.elsebasey@aaico.com" },
      { name: "Soufiane", email: "soufiane.dosuhaib@aaico.com" },
      { name: "Mahmoud", email: "mahmoud.asbdelrahman@aaico.com" },
      { name: "Moataz", email: "moataz.elnoamani@aaico.com" },
    ],
    grid: {
      "Mon 26 Oct": {
        Minu: [{ links: [L("Main Workflow", "a1"), L("Sub-Workflow 1", "a2")] }, { links: [] }],
        Asem: [{ links: [L("Main Workflow", "b1")] }, { links: [L("Main Workflow", "b2"), { text: "File (1)", url: "#" }] }],
        Soufiane: [{ links: [], note: "Annual leave until Thu" }, { links: [], note: "Annual leave until Thu" }],
        Mahmoud: [{ links: [] }, { links: [] }],
        Moataz: [{ links: [L("Main Workflow", "c1")] }, { links: [] }],
      },
      "Mon 19 Oct": {
        Minu: [{ links: [L("Main Workflow", "d1")] }, { links: [L("Main Workflow", "d2")] }],
        Asem: [{ links: [L("Main Workflow", "e1")] }, { links: [L("Main Workflow", "e2")] }],
        Soufiane: [{ links: [L("Main Workflow", "f1")] }, { links: [], note: "Blocked on sample data" }],
        Mahmoud: [{ links: [L("Main Workflow", "g1")] }, { links: [] }],
        Moataz: [{ links: [L("Main Workflow", "h1"), L("Sub-Workflow 1", "h2")] }, { links: [L("Main Workflow", "h3")] }],
      },
      "Mon 12 Oct": {
        Minu: [{ links: [L("Main Workflow", "i1")] }, { links: [L("Main Workflow", "i2")] }],
        Asem: [{ links: [L("Main Workflow", "j1")] }, { links: [] }],
        Soufiane: [{ links: [L("Main Workflow", "k1")] }, { links: [L("Main Workflow", "k2")] }],
        Mahmoud: [{ links: [] }, { links: [], note: "Sick leave" }],
        Moataz: [{ links: [L("Main Workflow", "l1")] }, { links: [L("Main Workflow", "l2")] }],
      },
    },
    runs: [],
    caseSeq: 140,
  };
  (function seedRuns() {
    const mk = (mins, name, topic, status, extra) => ({
      runId: String(9999999999999 - (Date.now() - mins * 60000)) + "-demo" + mins,
      caseId: String(demoDb.caseSeq--),
      submittedAt: new Date(Date.now() - mins * 60000).toISOString(),
      participantName: name, topic, builderUrl: B + "x" + mins, subWorkflows: [], files: [], notes: "", status,
      results: status === "COMPLETED" ? { mapped: { log_status: "written", target_tab: "Mon 26 Oct", target_cell_main: topic === "Topic 1" ? "C5" : "I5" } } : null,
      ...extra,
    });
    demoDb.runs = [
      mk(35, "Moataz", "Topic 1", "COMPLETED"),
      mk(180, "Asem", "Topic 2", "COMPLETED", { files: [{ name: "sample_invoice.pdf", url: "#" }] }),
      mk(240, "Minu", "Topic 1", "COMPLETED", { subWorkflows: [B + "sub1"] }),
      mk(1500, "Asem", "Topic 1", "COMPLETED"),
      mk(1620, "Mahmoud", "Topic 1", "FAILED", { results: { mapped: { log_status: "failed", error_output: "Participant 'Mahmud' was not found in rows 5-9." } }, participantName: "Mahmoud" }),
      mk(2900, "Soufiane", "Topic 1", "COMPLETED", { builderUrl: "", notes: "Annual leave until Thu" }),
    ];
    demoDb.caseSeq = 141;
  })();

  function demoRow(tab, p) {
    const g = (demoDb.grid[tab] || {})[p.name] || [{ links: [] }, { links: [] }];
    const t = (x) => ({ status: x.links.length ? "submitted" : x.note ? "excused" : "missing", links: x.links, note: x.note || "" });
    return { name: p.name, email: p.email, sheetRow: 5 + demoDb.participants.indexOf(p), topic1: t(g[0]), topic2: t(g[1]) };
  }
  const demoCases = {};

  const demo = {
    async meta() {
      await wait(350);
      const tab = demoDb.tabs[0];
      return {
        tab: { title: tab.title, date: tab.date },
        topics: demoDb.topics[tab.title],
        participants: demoDb.participants.map((p) => p.name),
        status: demoDb.participants.map((p) => { const r = demoRow(tab.title, p); return { name: r.name, topic1: r.topic1.status, topic2: r.topic2.status }; }),
      };
    },
    async uploadFile(file) { await wait(500 + Math.random() * 500); return "demo://files/" + encodeURIComponent(file.name); },
    async submit(p) {
      await wait(600);
      const caseId = String(demoDb.caseSeq++);
      const run = {
        runId: String(9999999999999 - Date.now()) + "-demo", caseId, submittedAt: new Date().toISOString(),
        participantName: p.participantName, topic: p.topic, builderUrl: p.builderUrl, subWorkflows: p.subWorkflows,
        files: p.fileUrls.map((u, i) => ({ url: u, name: p.fileNames[i] })), notes: p.notes, status: "PENDING", results: null,
      };
      demoDb.runs.unshift(run);
      demoCases[caseId] = { started: Date.now(), run, payload: p };
      return { runId: run.runId, caseId, status: "PENDING" };
    },
    async caseStatus(caseId) {
      await wait(200);
      const c = demoCases[caseId];
      if (!c) return { caseId, status: "COMPLETED", terminal: true, results: null };
      const el = Date.now() - c.started;
      const status = el < 2500 ? "PENDING" : el < 6500 ? "IN_PROGRESS" : "COMPLETED";
      let results = null;
      if (status === "COMPLETED") {
        const p = c.payload;
        const key = p.topic === "Topic 1" ? 0 : 1;
        const tab = demoDb.tabs[0].title;
        const segs = [];
        if (p.builderUrl) segs.push({ text: "Main Workflow", url: p.builderUrl });
        p.subWorkflows.forEach((u, i) => segs.push({ text: "Sub-Workflow " + (i + 1), url: u }));
        p.fileUrls.forEach((u, i) => segs.push({ text: "File (" + (i + 1) + ")", url: u }));
        const row = demoDb.grid[tab][p.participantName];
        row[key] = { links: segs, note: p.notes };
        const r = 5 + demoDb.participants.findIndex((x) => x.name === p.participantName);
        results = { mapped: { log_status: "written", target_tab: tab, target_cell_main: (key ? "I" : "C") + r } };
      }
      c.run.status = status;
      c.run.results = results;
      return { caseId, status, terminal: status === "COMPLETED", results };
    },
    async login(passcode) {
      await wait(400);
      if (passcode !== "demo") { const e = new Error("Incorrect passcode. (Demo passcode: demo)"); e.status = 401; throw e; }
      const s = { token: "demo", expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() };
      session.set(s);
      return s;
    },
    async tabs() { await wait(200); return { tabs: demoDb.tabs }; },
    async tracker(tab) {
      await wait(300);
      const t = tab || demoDb.tabs[0].title;
      return { tab: demoDb.tabs.find((x) => x.title === t), topics: demoDb.topics[t], rows: demoDb.participants.map((p) => demoRow(t, p)) };
    },
    async runs() { await wait(300); return { runs: demoDb.runs.slice() }; },
    async deleteRun(id) { await wait(200); demoDb.runs = demoDb.runs.filter((r) => r.runId !== id); return { deleted: id }; },
    async purgeRuns() { await wait(300); const n = demoDb.runs.length; demoDb.runs = []; return { deleted: n }; },
    async clearEntry({ tab, participant, topic }) {
      await wait(300);
      const row = demoDb.grid[tab][participant];
      if (topic === "both" || topic === "topic 1") row[0] = { links: [] };
      if (topic === "both" || topic === "topic 2") row[1] = { links: [] };
      return { cleared: true };
    },
    async clearWeek({ tab, confirm }) {
      await wait(400);
      if (confirm !== tab) throw new Error("Type the tab title exactly to confirm clearing it.");
      Object.keys(demoDb.grid[tab]).forEach((n) => (demoDb.grid[tab][n] = [{ links: [] }, { links: [] }]));
      return { cleared: true };
    },
    async notify(p) { await wait(600); return { sent: true, to: p.to || (demoDb.participants.find((x) => x.name === p.participant) || {}).email }; },
    async trigger() { await wait(500); return { caseId: String(demoDb.caseSeq++) }; },
  };

  window.PortalAPI = Object.assign({ demo: DEMO, session }, DEMO ? demo : real);
})();
