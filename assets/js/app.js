/* MN Submission Portal — UI logic (vanilla JS, no build step). */
(function () {
  "use strict";
  const CFG = window.PORTAL_CONFIG;
  const API = window.PortalAPI;

  // ------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const isBuilder = (u) => !!u && u.indexOf(CFG.BUILDER_URL_MARKER) !== -1;
  const initials = (n) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const fmtSize = (b) => (b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB");
  const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    branch: '<svg viewBox="0 0 24 24"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="M20 20H8l-5-5 10-10 8 8-6 6"/><path d="M7 11l6 6"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>',
  };

  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3500);
  }

  // ------------------------------------------------------------ modal
  function openModal(html, opts = {}) {
    const root = $("#modalRoot");
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = '<div class="modal' + (opts.wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    root.appendChild(bd);
    const close = () => { bd.remove(); document.removeEventListener("keydown", onKey); opts.onClose && opts.onClose(); };
    const onKey = (e) => { if (e.key === "Escape" && !opts.locked) close(); };
    document.addEventListener("keydown", onKey);
    bd.addEventListener("mousedown", (e) => { if (e.target === bd && !opts.locked) close(); });
    $$("[data-close]", bd).forEach((b) => b.addEventListener("click", close));
    const first = $("input, textarea, select, button.btn-primary, button.btn-accent, button.btn-danger", bd);
    first && setTimeout(() => first.focus(), 30);
    return { el: $(".modal", bd), close, lock(v) { opts.locked = v; } };
  }

  function confirmModal({ title, body, confirmLabel = "Confirm", danger = false, typeToConfirm = "" }) {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal(
        "<h2>" + esc(title) + '</h2><p class="sub">' + body + "</p>" +
        (typeToConfirm ? '<div class="field"><label for="cfType">Type <b>' + esc(typeToConfirm) + '</b> to confirm</label><input id="cfType" type="text"></div>' : "") +
        '<div class="foot"><button class="btn btn-ghost" data-close>Cancel</button>' +
        '<button class="btn ' + (danger ? "btn-danger" : "btn-accent") + '" id="cfOk"' + (typeToConfirm ? " disabled" : "") + ">" + esc(confirmLabel) + "</button></div>",
        { onClose: () => !done && resolve(null) }
      );
      const typed = $("#cfType", m.el);
      if (typed) typed.addEventListener("input", () => ($("#cfOk", m.el).disabled = typed.value.trim() !== typeToConfirm));
      $("#cfOk", m.el).addEventListener("click", () => { done = true; m.close(); resolve(typed ? typed.value.trim() : true); });
    });
  }

  // ------------------------------------------------------------ theme
  function initTheme() {
    const t = $("#themeToggle");
    t.checked = document.documentElement.getAttribute("data-theme") === "dark";
    t.addEventListener("change", () => {
      const v = t.checked ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", v);
      try { localStorage.setItem("mn_portal_theme", v); } catch (_) {}
    });
  }

  // ================================================================
  // Participant view
  // ================================================================
  const state = { meta: null, items: [] };

  async function loadMeta() {
    try {
      const meta = await API.meta();
      state.meta = meta;
      renderMeta();
    } catch (e) {
      $("#weekChipText").textContent = "Tracker unavailable";
      $("#teamList").innerHTML = '<li class="muted small">' + esc(e.message) + "</li>";
      toast("Could not load this week's tracker: " + e.message, true);
    }
  }

  function renderMeta() {
    const m = state.meta;
    // names
    const sel = $("#fName");
    const last = store.get("mn_portal_name", "");
    sel.innerHTML = '<option value="">Select your name…</option>' +
      m.participants.map((n) => '<option' + (n === last ? " selected" : "") + ">" + esc(n) + "</option>").join("");
    // topics
    $("#topic1Title").textContent = m.topics.topic1 || "Title not set in the sheet";
    $("#topic2Title").textContent = m.topics.topic2 || "Title not set in the sheet";
    $("#sideTopic1").textContent = m.topics.topic1 || "—";
    $("#sideTopic2").textContent = m.topics.topic2 || "—";
    // week + deadline
    const start = parseDate(m.tab.date);
    const end = new Date(start); end.setDate(end.getDate() + CFG.WEEK_LENGTH_DAYS);
    const now = new Date();
    const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    const leftMs = end - now;
    const leftD = Math.floor(leftMs / 86400000), leftH = Math.floor((leftMs % 86400000) / 3600000);
    $("#weekChipText").textContent = "Week of " + m.tab.title;
    $("#weekRange").textContent = fmtDay(start) + " – " + fmtDay(new Date(end - 86400000));
    $("#deadlineLeft").textContent = leftMs <= 0 ? "Closed" : leftD > 0 ? leftD + "d " + leftH + "h left" : leftH + "h left";
    $("#deadlineDate").textContent = "Next tab " + fmtDay(end);
    requestAnimationFrame(() => ($("#deadlineBar").style.width = pct + "%"));
    // team
    const total = m.status.length * 2 || 1;
    const c = { submitted: 0, excused: 0, missing: 0 };
    m.status.forEach((r) => { c[r.topic1]++; c[r.topic2]++; });
    $("#teamPct").textContent = Math.round(((c.submitted + c.excused) / total) * 100) + "% accounted for";
    $("#teamBar").innerHTML = ["submitted", "excused", "missing"].map((k) => '<span class="s-' + k + '" style="width:' + (c[k] / total) * 100 + '%"></span>').join("");
    $("#teamList").innerHTML = m.status.map((r) =>
      '<li><span class="who"><span class="avatar">' + esc(initials(r.name)) + "</span>" + esc(r.name) + '</span>' +
      '<span class="dots"><i class="s-' + r.topic1 + '" title="Topic 1: ' + r.topic1 + '"></i><i class="s-' + r.topic2 + '" title="Topic 2: ' + r.topic2 + '"></i></span></li>'
    ).join("");
    updatePreview();
  }

  // ---- additional items ----
  function subCount() { return state.items.filter((i) => i.kind === "sub").length; }
  function fileCount() { return state.items.filter((i) => i.kind === "file").length; }

  function toggleMenu(show) {
    const menu = $("#addMenu");
    const open = show == null ? menu.hidden : show;
    menu.hidden = !open;
    $("#addBtn").setAttribute("aria-expanded", String(open));
    const left = CFG.MAX_SUB_WORKFLOWS - subCount();
    $("#subLeft").textContent = left > 0 ? left + " of " + CFG.MAX_SUB_WORKFLOWS + " remaining" : "Limit reached";
    $('[data-add="sub"]').disabled = left <= 0;
    $('[data-add="file"]').disabled = fileCount() >= CFG.MAX_FILES;
  }

  function addSub() {
    if (subCount() >= CFG.MAX_SUB_WORKFLOWS) return toast("Up to " + CFG.MAX_SUB_WORKFLOWS + " sub-workflow links.", true);
    const item = { kind: "sub", id: uid(), url: "" };
    state.items.push(item);
    renderItems();
    const inp = $('[data-item="' + item.id + '"] input');
    inp && inp.focus();
  }

  function addFiles(files) {
    for (const f of files) {
      if (fileCount() >= CFG.MAX_FILES) { toast("Up to " + CFG.MAX_FILES + " files.", true); break; }
      if (f.size > CFG.MAX_FILE_MB * 1048576) { toast(f.name + " is over " + CFG.MAX_FILE_MB + " MB.", true); continue; }
      if (!/\.[^.]+$/.test(f.name)) { toast(f.name + " needs a file extension.", true); continue; }
      state.items.push({ kind: "file", id: uid(), file: f });
    }
    renderItems();
  }

  function renderItems() {
    let subN = 0, fileN = 0;
    $("#itemList").innerHTML = state.items.map((it) => {
      if (it.kind === "sub") {
        subN++;
        return '<li class="item" data-item="' + it.id + '"><span class="badge-ic">' + ICON.branch + "</span>" +
          '<input type="url" placeholder="Sub-workflow ' + subN + " — " + esc(CFG.BUILDER_URL_MARKER) + '/…" value="' + esc(it.url) + '" aria-label="Sub-workflow ' + subN + ' link">' +
          '<button type="button" class="icon-btn danger" data-remove="' + it.id + '" aria-label="Remove">' + ICON.x + "</button></li>";
      }
      fileN++;
      return '<li class="item" data-item="' + it.id + '"><span class="badge-ic">' + ICON.file + "</span>" +
        '<span class="meta"><b>' + esc(it.file.name) + '<span class="tag">File (' + fileN + ")</span></b><small>" + fmtSize(it.file.size) + "</small>" +
        '<span class="progress" hidden><span></span></span></span>' +
        '<button type="button" class="icon-btn danger" data-remove="' + it.id + '" aria-label="Remove">' + ICON.x + "</button></li>";
    }).join("");
    $("#dropzone").hidden = state.items.length > 0;
    updatePreview();
  }

  function updatePreview() {
    const main = $("#fMain").value.trim();
    const notes = $("#fNotes").value.trim();
    const segs = [];
    const lk = (t) => '<span class="lk">' + esc(t) + "</span>";
    if (main) segs.push(isBuilder(main) ? lk("Main Workflow") : esc(main));
    let s = 0, f = 0;
    state.items.forEach((it) => {
      if (it.kind === "sub" && it.url.trim()) { s++; segs.push(isBuilder(it.url) ? lk("Sub-Workflow " + s) : esc("Sub-Workflow " + s + ": " + it.url)); }
      if (it.kind === "file") { f++; segs.push(lk("File (" + f + ")")); }
    });
    if (notes) segs.push(esc(notes));
    const topic = ($('input[name="topic"]:checked') || {}).value;
    const cell = topic === "Topic 2" ? "I" : topic === "Topic 1" ? "C" : "";
    $("#sheetPreviewValue").innerHTML = segs.length ? segs.join(" - ") : '<span class="muted">Fill in the form to see what lands in ' + (cell ? "column " + cell : "the sheet") + "</span>";
    $("#notesCount").textContent = $("#fNotes").value.length + " / 500";
  }

  function validate() {
    const errs = [];
    const name = $("#fName").value;
    const topic = ($('input[name="topic"]:checked') || {}).value;
    const main = $("#fMain").value.trim();
    const notes = $("#fNotes").value.trim();
    const subs = state.items.filter((i) => i.kind === "sub");
    $("#fName").closest(".field").classList.toggle("invalid", !name);
    if (!name) errs.push("Select your name.");
    if (!topic) errs.push("Choose a topic.");
    const mainBad = main && !isBuilder(main);
    $("#fMain").classList.toggle("invalid", !!mainBad);
    $("#fMainHint").classList.toggle("err", !!mainBad);
    $("#fMainHint").textContent = mainBad
      ? "This isn't an Opus Builder link — it must start with " + CFG.BUILDER_URL_MARKER
      : "Opus Builder link. Optional only when you leave a note instead (e.g. an excuse).";
    if (mainBad) errs.push("Fix the main workflow link.");
    let subBad = false;
    subs.forEach((s) => {
      const bad = s.url.trim() && !isBuilder(s.url.trim());
      const inp = $('[data-item="' + s.id + '"] input');
      inp && inp.classList.toggle("invalid", !!bad);
      if (bad) subBad = true;
    });
    if (subBad) errs.push("Sub-workflow links must be Opus Builder links.");
    const hasContent = main || notes || subs.some((s) => s.url.trim()) || fileCount();
    if (!hasContent) errs.push("Add the main workflow link — or a note if you're excused this week.");
    $("#formError").textContent = errs[0] || "";
    return errs.length === 0;
  }

  function initForm() {
    const form = $("#submitForm");
    $("#addBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".add-wrap")) toggleMenu(false); });
    $('[data-add="sub"]').addEventListener("click", () => { toggleMenu(false); addSub(); });
    $('[data-add="file"]').addEventListener("click", () => { toggleMenu(false); $("#fileInput").click(); });
    $("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

    $("#itemList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (!b) return;
      state.items = state.items.filter((i) => i.id !== b.dataset.remove);
      renderItems();
    });
    $("#itemList").addEventListener("input", (e) => {
      const li = e.target.closest("[data-item]");
      const it = li && state.items.find((i) => i.id === li.dataset.item);
      if (it && it.kind === "sub") { it.url = e.target.value; updatePreview(); }
    });

    const dz = form;
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); $("#dropzone").classList.add("over"); } }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => $("#dropzone").classList.remove("over")));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

    ["input", "change"].forEach((ev) => form.addEventListener(ev, () => { updatePreview(); if ($("#formError").textContent) validate(); }));
    $("#fName").addEventListener("change", () => store.set("mn_portal_name", $("#fName").value));
    form.addEventListener("submit", (e) => { e.preventDefault(); if (validate()) runSubmission(); });
  }

  // ---- submission flow ----
  async function runSubmission() {
    const name = $("#fName").value;
    const topic = $('input[name="topic"]:checked').value;
    const main = $("#fMain").value.trim();
    const notes = $("#fNotes").value.trim();
    const subs = state.items.filter((i) => i.kind === "sub" && i.url.trim()).map((i) => i.url.trim());
    const files = state.items.filter((i) => i.kind === "file");
    const topicTitle = state.meta ? state.meta.topics[topic === "Topic 1" ? "topic1" : "topic2"] : "";

    const steps = [
      { k: "upload", t: "Upload files", s: files.length ? files.length + " file(s)" : "No files — skipped" },
      { k: "start", t: "Start Opus case", s: "Classify Trigger Scenario → Manual Submission" },
      { k: "run", t: "Log Submission To Tracker", s: "Writing to " + (state.meta ? state.meta.tab.title : "this week's tab") },
      { k: "done", t: "Logged", s: "Your row is updated" },
    ];
    const m = openModal(
      '<img class="modal-cube theme-light" src="assets/img/opus-cube-blue.png" alt=""><img class="modal-cube theme-dark" src="assets/img/opus-cube-white.png" alt="">' +
      "<h2>Submitting</h2><p class=\"sub\">" + esc(name) + " · " + esc(topic) + (topicTitle ? " — " + esc(topicTitle) : "") + "</p>" +
      '<div class="steps">' + steps.map((s) => '<div class="step" data-step="' + s.k + '"><span class="ic"></span><span><b>' + esc(s.t) + "</b><small>" + esc(s.s) + "</small></span></div>").join("") + "</div>" +
      '<div id="resultArea"></div><div class="foot"><button class="btn btn-ghost" data-close id="closeRun" disabled>Close</button></div>',
      { locked: true }
    );
    const setStep = (k, cls, sub) => {
      const el = $('[data-step="' + k + '"]', m.el);
      el.className = "step " + cls;
      $(".ic", el).innerHTML = cls === "done" ? ICON.check : cls === "fail" ? ICON.x : "";
      if (sub) $("small", el).textContent = sub;
    };
    const finish = (ok, html) => {
      $("#resultArea", m.el).innerHTML = html || "";
      $("h2", m.el).textContent = ok ? "Submission logged" : "Submission not logged";
      m.lock(false);
      $("#closeRun", m.el).disabled = false;
      $("#closeRun", m.el).focus();
    };
    $("#submitBtn").disabled = true;
    let current = "upload";
    try {
      // 1. upload
      setStep("upload", "active");
      const fileUrls = [];
      for (let i = 0; i < files.length; i++) {
        const li = $('[data-item="' + files[i].id + '"]');
        const bar = li && $(".progress", li);
        if (bar) { bar.hidden = false; $("span", bar).style.width = "40%"; }
        setStep("upload", "active", "Uploading " + (i + 1) + " of " + files.length + " — " + files[i].file.name);
        fileUrls.push(await API.uploadFile(files[i].file));
        if (bar) $("span", bar).style.width = "100%";
      }
      setStep("upload", "done");

      // 2. start case
      current = "start";
      setStep("start", "active");
      const res = await API.submit({
        participantName: name, topic, builderUrl: main, subWorkflows: subs, fileUrls,
        fileNames: files.map((f) => f.file.name), notes,
      });
      setStep("start", "done", "Case #" + res.caseId + " started");
      pushRecent({ at: new Date().toISOString(), topic, caseId: res.caseId, status: "PENDING" });

      // 3. poll
      current = "run";
      setStep("run", "active");
      const t0 = Date.now();
      let st;
      for (;;) {
        await new Promise((r) => setTimeout(r, CFG.POLL_INTERVAL_MS));
        st = await API.caseStatus(res.caseId, res.runId);
        if (st.terminal) break;
        setStep("run", "active", "Opus status: " + st.status.replace("_", " ").toLowerCase());
        if (Date.now() - t0 > CFG.POLL_TIMEOUT_MS) throw new Error("Still running after " + Math.round(CFG.POLL_TIMEOUT_MS / 60000) + " min — check back later (case #" + res.caseId + ").");
      }
      const mapped = (st.results && st.results.mapped) || {};
      const failed = st.status !== "COMPLETED" || mapped.log_status === "failed";
      updateRecent(res.caseId, failed ? "FAILED" : "COMPLETED");
      if (failed) {
        setStep("run", "fail", "Opus status: " + st.status);
        finish(false, '<div class="result-box"><b>What went wrong</b><p class="muted small" style="margin-top:6px">' +
          esc(mapped.error_output || "The workflow ended with status " + st.status + ". Ask your manager to check case #" + res.caseId + ".") + "</p></div>");
        return;
      }
      setStep("run", "done", "Completed in Opus");
      setStep("done", "done", mapped.target_cell_main ? "Written to " + mapped.target_tab + " · " + mapped.target_cell_main : "Your row is updated");
      finish(true,
        '<div class="result-box"><dl><dt>Week</dt><dd>' + esc(mapped.target_tab || (state.meta && state.meta.tab.title) || "—") + "</dd>" +
        "<dt>Topic</dt><dd>" + esc(topic) + (topicTitle ? " — " + esc(topicTitle) : "") + "</dd>" +
        (mapped.target_cell_main ? "<dt>Cell</dt><dd>" + esc(mapped.target_cell_main) + "</dd>" : "") +
        "<dt>Case</dt><dd>#" + esc(res.caseId) + "</dd>" +
        (mapped.error_output ? "<dt>Warnings</dt><dd>" + esc(mapped.error_output) + "</dd>" : "") + "</dl></div>");
      resetForm();
      loadMeta();
    } catch (e) {
      setStep(current, "fail", e.message);
      finish(false, "");
      toast(e.message, true);
    } finally {
      $("#submitBtn").disabled = false;
    }
  }

  function resetForm() {
    $("#fMain").value = "";
    $("#fNotes").value = "";
    $$('input[name="topic"]').forEach((r) => (r.checked = false));
    state.items = [];
    renderItems();
  }

  function pushRecent(r) {
    const list = store.get("mn_portal_recent", []);
    list.unshift(r);
    store.set("mn_portal_recent", list.slice(0, 5));
    renderRecent();
  }
  function updateRecent(caseId, status) {
    const list = store.get("mn_portal_recent", []);
    const r = list.find((x) => x.caseId === caseId);
    if (r) r.status = status;
    store.set("mn_portal_recent", list);
    renderRecent();
  }
  function renderRecent() {
    const list = store.get("mn_portal_recent", []);
    $("#recentList").innerHTML = list.length
      ? list.map((r) => "<li><span>" + esc(r.topic) + ' <span class="muted small">· ' + relTime(r.at) + "</span></span>" + statusPill(r.status) + "</li>").join("")
      : '<li class="empty muted small">Nothing from this browser yet.</li>';
  }

  function statusPill(s) {
    const S = String(s || "").toUpperCase();
    const map = {
      COMPLETED: ["completed", "Logged"], FAILED: ["failed", "Failed"], CANCELLED: ["failed", "Cancelled"], TIMED_OUT: ["failed", "Timed out"],
      PENDING: ["running", "Queued"], IN_PROGRESS: ["running", "Running"], WAITING: ["running", "Waiting"],
      SUBMITTED: ["submitted", "Submitted"], EXCUSED: ["excused", "Excused"], MISSING: ["missing", "Missing"],
    };
    const [cls, label] = map[S] || ["missing", s || "—"];
    return '<span class="pill ' + cls + '">' + esc(label) + "</span>";
  }

  // ================================================================
  // Manager view
  // ================================================================
  const mgr = { tabs: [], tab: "", tracker: null, runs: [], active: "overview", trendCache: {}, runFilter: { q: "", status: "" } };

  function initManager() {
    $("#managerBtn").addEventListener("click", () => {
      if (!$("#managerView").hidden) return exitManager();
      if (API.session.token()) return enterManager();
      loginModal();
    });
    $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
    $("#weekSelect").addEventListener("change", async (e) => { mgr.tab = e.target.value; await loadTracker(); });
    $("#refreshBtn").addEventListener("click", () => refreshManager(true));
  }

  function loginModal() {
    const m = openModal(
      '<img class="modal-cube theme-light" src="assets/img/opus-cube-blue.png" alt=""><img class="modal-cube theme-dark" src="assets/img/opus-cube-white.png" alt="">' +
      '<h2>Manager access</h2><p class="sub">Enter the manager passcode to see all runs and manage entries.' + (API.demo ? " Demo passcode: <b>demo</b>" : "") + "</p>" +
      '<form id="loginForm"><div class="field"><label for="pc">Passcode</label><input id="pc" type="password" autocomplete="current-password" required></div>' +
      '<p class="form-error" id="loginErr"></p><div class="foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-accent" id="loginBtn">Sign in</button></div></form>'
    );
    $("#loginForm", m.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#loginBtn", m.el);
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        await API.login($("#pc", m.el).value);
        m.close();
        enterManager();
      } catch (err) {
        $("#loginErr", m.el).textContent = err.message;
        btn.disabled = false; btn.textContent = "Sign in";
      }
    });
  }

  async function enterManager() {
    $("#participantView").hidden = true;
    $("#managerView").hidden = false;
    $("#managerBtnLabel").textContent = "Exit manager view";
    await refreshManager(false);
  }
  function exitManager() {
    $("#managerView").hidden = true;
    $("#participantView").hidden = false;
    $("#managerBtnLabel").textContent = "Manager access";
    loadMeta();
  }
  function handleAuth(e) {
    if (e.status === 401) { toast("Session ended — sign in again.", true); exitManager(); loginModal(); return true; }
    return false;
  }

  async function refreshManager(keepTab) {
    try {
      const { tabs } = await API.tabs();
      mgr.tabs = tabs;
      if (!keepTab || !tabs.some((t) => t.title === mgr.tab)) mgr.tab = tabs.length ? tabs[0].title : "";
      $("#weekSelect").innerHTML = tabs.map((t) => '<option value="' + esc(t.title) + '"' + (t.title === mgr.tab ? " selected" : "") + ">Week of " + esc(t.title) + "</option>").join("");
      mgr.trendCache = {};
      await Promise.all([loadTracker(), loadRuns()]);
    } catch (e) { if (!handleAuth(e)) toast(e.message, true); }
  }

  async function loadTracker() {
    $("#panelTracker").innerHTML = $("#panelOverview").innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
    try {
      mgr.tracker = await API.tracker(mgr.tab);
      mgr.trendCache[mgr.tab] = mgr.tracker;
      renderOverview();
      renderTracker();
      loadTrend();
    } catch (e) { if (!handleAuth(e)) { $("#panelTracker").innerHTML = $("#panelOverview").innerHTML = '<div class="empty-state">' + esc(e.message) + "</div>"; } }
  }

  async function loadRuns() {
    try {
      const { runs } = await API.runs();
      mgr.runs = runs;
      $("#runsCount").textContent = runs.length;
      renderRuns();
      if (mgr.tracker) renderOverview();
    } catch (e) { if (!handleAuth(e)) $("#panelRuns").innerHTML = '<div class="empty-state">' + esc(e.message) + "</div>"; }
  }

  function showTab(name) {
    mgr.active = name;
    $$(".tab").forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("active", on); t.setAttribute("aria-selected", String(on)); });
    $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  function counts(tr) {
    const c = { submitted: 0, excused: 0, missing: 0, t1: { submitted: 0, excused: 0, missing: 0 }, t2: { submitted: 0, excused: 0, missing: 0 } };
    tr.rows.forEach((r) => { c[r.topic1.status]++; c[r.topic2.status]++; c.t1[r.topic1.status]++; c.t2[r.topic2.status]++; });
    c.total = tr.rows.length * 2;
    c.people = tr.rows.length;
    return c;
  }

  // ---- overview ----
  function renderOverview() {
    const tr = mgr.tracker;
    if (!tr) return;
    const c = counts(tr);
    const pct = c.total ? Math.round((c.submitted / c.total) * 100) : 0;
    const tabStart = tr.tab ? parseDate(tr.tab.date) : null;
    const tabEnd = tabStart ? new Date(tabStart.getTime() + CFG.WEEK_LENGTH_DAYS * 86400000) : null;
    const weekRuns = mgr.runs.filter((r) => tabStart && new Date(r.submittedAt) >= tabStart && new Date(r.submittedAt) < tabEnd);
    const failedRuns = weekRuns.filter((r) => ["FAILED", "CANCELLED", "TIMED_OUT"].includes(r.status) || (r.results && r.results.mapped && r.results.mapped.log_status === "failed"));
    const bar = (o, n) => '<div class="stack-bar">' + ["submitted", "excused", "missing"].map((k) => '<span class="s-' + k + '" style="width:' + (n ? (o[k] / n) * 100 : 0) + '%"></span>').join("") + "</div>";

    $("#panelOverview").innerHTML =
      '<div class="kpis">' +
      kpi("Completion", pct + "%", c.submitted + " of " + c.total + " entries", true) +
      kpi("Submitted", c.submitted, "with a workflow link") +
      kpi("Excused", c.excused, "note, no link") +
      kpi("Missing", c.missing, c.missing ? "reminders go to these" : "everyone accounted for") +
      "</div>" +
      '<div class="ov-grid">' +
      '<div class="card"><div class="card-head row"><h3>By topic</h3><span class="muted small">' + esc(tr.tab.title) + "</span></div>" +
      '<div class="topic-bars">' +
      '<div class="topic-bar"><div class="tb-head"><span>Topic 1 · ' + esc(tr.topics.topic1 || "—") + '</span><span class="muted">' + c.t1.submitted + "/" + c.people + "</span></div>" + bar(c.t1, c.people) + "</div>" +
      '<div class="topic-bar"><div class="tb-head"><span>Topic 2 · ' + esc(tr.topics.topic2 || "—") + '</span><span class="muted">' + c.t2.submitted + "/" + c.people + "</span></div>" + bar(c.t2, c.people) + "</div>" +
      "</div>" +
      '<div class="card-head row" style="margin-top:22px"><h3>Completion by week</h3></div><div class="trend" id="trend"><div class="muted small">Loading…</div></div>' +
      "</div>" +
      '<div class="card"><div class="card-head row"><h3>Actions</h3><span class="muted small">' + weekRuns.length + " portal runs · " + failedRuns.length + " failed</span></div>" +
      '<div class="actions-list">' +
      actionRow("Run scheduled check now", "Runs the workflow with no name — sends the weekly report or reminders, depending on the day.", "trigger", "btn-ghost", ICON.play) +
      actionRow("Clear this week's entries", "Empties Topic 1 and Topic 2 for every participant in " + esc(tr.tab.title) + ".", "clearWeek", "btn-ghost", ICON.eraser) +
      actionRow("Purge run log", "Deletes every portal run record. The sheet is not touched.", "purge", "btn-ghost", ICON.trash) +
      "</div></div></div>";

    $("#panelOverview").querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => overviewAction(b.dataset.action)));
    renderTrend();
  }
  const kpi = (k, v, s, accent) => '<div class="card kpi' + (accent ? " accent" : "") + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>";
  const actionRow = (t, s, a, cls, ic) => '<div class="action-row"><span><b>' + t + "</b><small>" + s + '</small></span><button class="btn btn-sm ' + cls + '" data-action="' + a + '">' + ic + "</button></div>";

  async function loadTrend() {
    const tabs = mgr.tabs.slice(0, 6);
    await Promise.all(tabs.map(async (t) => {
      if (mgr.trendCache[t.title]) return;
      try { mgr.trendCache[t.title] = await API.tracker(t.title); } catch (_) {}
    }));
    renderTrend();
  }
  function renderTrend() {
    const el = $("#trend");
    if (!el) return;
    const tabs = mgr.tabs.slice(0, 6).filter((t) => mgr.trendCache[t.title]);
    if (!tabs.length) return;
    el.innerHTML = tabs.map((t) => {
      const c = counts(mgr.trendCache[t.title]);
      const p = c.total ? Math.round((c.submitted / c.total) * 100) : 0;
      return '<div class="trend-row"><span class="' + (t.title === mgr.tab ? "" : "muted") + '">' + esc(t.title) + '</span><div class="bar"><span style="width:' + p + '%"></span></div><span class="v">' + p + "%</span></div>";
    }).join("");
  }

  async function overviewAction(a) {
    try {
      if (a === "trigger") {
        if (!(await confirmModal({ title: "Run scheduled check?", body: "This starts the workflow without a participant name. Depending on how old the latest tab is it sends the weekly report or reminder emails.", confirmLabel: "Run now" }))) return;
        const r = await API.trigger();
        toast("Started case #" + r.caseId);
      } else if (a === "clearWeek") {
        const typed = await confirmModal({ title: "Clear " + mgr.tab + "?", body: "Every Topic 1 and Topic 2 entry in this tab is emptied. Names, titles and formatting stay. This cannot be undone from the portal.", confirmLabel: "Clear week", danger: true, typeToConfirm: mgr.tab });
        if (!typed) return;
        await API.clearWeek({ tab: mgr.tab, confirm: typed });
        toast("Cleared " + mgr.tab);
        await loadTracker();
      } else if (a === "purge") {
        const typed = await confirmModal({ title: "Purge the run log?", body: "All " + mgr.runs.length + " run records are deleted permanently. The sheet is not changed.", confirmLabel: "Purge", danger: true, typeToConfirm: "DELETE" });
        if (!typed) return;
        const r = await API.purgeRuns();
        toast("Deleted " + r.deleted + " records");
        await loadRuns();
      }
    } catch (e) { if (!handleAuth(e)) toast(e.message, true); }
  }

  // ---- tracker ----
  function topicCell(t) {
    let h = statusPill(t.status);
    if (t.links && t.links.length) h += '<div class="cell-links">' + t.links.map((l) => '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.text) + "</a>").join("") + "</div>";
    if (t.note) h += '<div class="cell-note">' + esc(t.note) + "</div>";
    return h;
  }
  function renderTracker() {
    const tr = mgr.tracker;
    if (!tr) return;
    $("#panelTracker").innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Team member</th><th>Topic 1 · ' + esc(tr.topics.topic1 || "—") + "</th><th>Topic 2 · " + esc(tr.topics.topic2 || "—") + '</th><th class="actions"></th></tr></thead><tbody>' +
      (tr.rows.length ? tr.rows.map((r) =>
        '<tr><td><div class="who-cell"><b>' + esc(r.name) + "</b><small>" + esc(r.email || "no email on file") + " · row " + r.sheetRow + "</small></div></td>" +
        "<td>" + topicCell(r.topic1) + "</td><td>" + topicCell(r.topic2) + "</td>" +
        '<td class="actions"><button class="icon-btn" title="Send note" data-note="' + esc(r.name) + '">' + ICON.mail + "</button>" +
        '<button class="icon-btn danger" title="Clear entry" data-clear="' + esc(r.name) + '">' + ICON.eraser + "</button></td></tr>"
      ).join("") : '<tr><td colspan="4" class="empty-state">No participants in rows 5–9 of this tab.</td></tr>') +
      "</tbody></table></div>";
    $$("[data-note]", $("#panelTracker")).forEach((b) => b.addEventListener("click", () => notifyModal({ participant: b.dataset.note })));
    $$("[data-clear]", $("#panelTracker")).forEach((b) => b.addEventListener("click", () => clearModal(b.dataset.clear)));
  }

  function clearModal(name) {
    const tr = mgr.tracker;
    const m = openModal(
      "<h2>Clear entry</h2><p class=\"sub\">Remove " + esc(name) + "'s submission from <b>" + esc(tr.tab.title) + "</b>. They will show as missing again.</p>" +
      '<div class="segmented" style="grid-template-columns:1fr 1fr 1fr">' +
      ["topic 1", "topic 2", "both"].map((v, i) => '<label class="seg"><input type="radio" name="clr" value="' + v + '"' + (i === 0 ? " checked" : "") + "><span><b>" + (v === "both" ? "Both" : v.replace("t", "T")) + "</b></span></label>").join("") +
      '</div><div class="foot"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="clrOk">Clear</button></div>'
    );
    $("#clrOk", m.el).addEventListener("click", async () => {
      const topic = $('input[name="clr"]:checked', m.el).value;
      $("#clrOk", m.el).disabled = true;
      try {
        await API.clearEntry({ tab: tr.tab.title, participant: name, topic });
        m.close();
        toast("Cleared " + name + " · " + topic);
        await loadTracker();
      } catch (e) { $("#clrOk", m.el).disabled = false; if (!handleAuth(e)) toast(e.message, true); }
    });
  }

  function notifyModal({ participant, run }) {
    const tr = mgr.tracker;
    const row = tr && tr.rows.find((r) => r.name === participant);
    const email = (row && row.email) || "";
    const subj = run ? "About your " + run.topic + " submission" : "Note on your " + (tr ? tr.tab.title : "weekly") + " submission";
    const m = openModal(
      "<h2>Send a note</h2><p class=\"sub\">Emailed from the tracker's Gmail account.</p>" +
      '<form id="nf"><div class="field"><label for="nTo">To</label><input id="nTo" type="email" value="' + esc(email) + '" required></div>' +
      '<div class="field"><label for="nSub">Subject</label><input id="nSub" type="text" value="' + esc(subj) + '"></div>' +
      '<div class="field"><label for="nMsg">Message</label><textarea id="nMsg" rows="5" required placeholder="Write your feedback or a reminder…"></textarea></div>' +
      '<label class="check"><input type="checkbox" id="nSum" checked> Include their submission status for ' + esc(tr ? tr.tab.title : "this week") + "</label>" +
      '<div class="foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-accent" id="nOk">' + ICON.mail + "Send</button></div></form>",
      { wide: true }
    );
    $("#nMsg", m.el).focus();
    $("#nf", m.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#nOk", m.el);
      btn.disabled = true;
      try {
        const r = await API.notify({
          participant, to: $("#nTo", m.el).value.trim(), subject: $("#nSub", m.el).value.trim(),
          message: $("#nMsg", m.el).value.trim(), includeSummary: $("#nSum", m.el).checked, tab: tr ? tr.tab.title : "",
        });
        m.close();
        toast("Sent to " + r.to);
      } catch (err) { btn.disabled = false; if (!handleAuth(err)) toast(err.message, true); }
    });
  }

  // ---- runs ----
  function runContent(r) {
    const parts = [];
    if (r.builderUrl) parts.push("Main");
    if (r.subWorkflows && r.subWorkflows.length) parts.push(r.subWorkflows.length + " sub");
    if (r.files && r.files.length) parts.push(r.files.length + " file" + (r.files.length > 1 ? "s" : ""));
    if (r.notes) parts.push("note");
    return parts.join(" · ") || "—";
  }
  function runStatus(r) {
    const mp = (r.results && r.results.mapped) || {};
    return mp.log_status === "failed" ? "FAILED" : r.status;
  }
  function renderRuns() {
    const f = mgr.runFilter;
    const q = f.q.toLowerCase();
    const list = mgr.runs.filter((r) => {
      if (q && !(r.participantName + " " + r.topic + " " + r.caseId + " " + (r.notes || "")).toLowerCase().includes(q)) return false;
      const s = runStatus(r);
      if (f.status === "ok" && s !== "COMPLETED") return false;
      if (f.status === "failed" && !["FAILED", "CANCELLED", "TIMED_OUT"].includes(s)) return false;
      if (f.status === "running" && !["PENDING", "IN_PROGRESS", "WAITING"].includes(s)) return false;
      return true;
    });
    $("#panelRuns").innerHTML =
      '<div class="toolbar"><div class="left"><input type="text" id="rq" placeholder="Search name, topic, case…" value="' + esc(f.q) + '">' +
      '<select id="rs"><option value="">All statuses</option><option value="ok"' + (f.status === "ok" ? " selected" : "") + '>Logged</option><option value="running"' + (f.status === "running" ? " selected" : "") + '>Running</option><option value="failed"' + (f.status === "failed" ? " selected" : "") + ">Failed</option></select></div>" +
      '<span class="muted small">' + list.length + " of " + mgr.runs.length + " runs</span></div>" +
      '<div class="table-wrap"><table><thead><tr><th>Submitted</th><th>Participant</th><th>Topic</th><th>Content</th><th>Status</th><th>Logged to</th><th class="actions"></th></tr></thead><tbody>' +
      (list.length ? list.map((r) => {
        const mp = (r.results && r.results.mapped) || {};
        return "<tr><td><div class=\"who-cell\"><b>" + relTime(r.submittedAt) + "</b><small>" + new Date(r.submittedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "</small></div></td>" +
          "<td>" + esc(r.participantName) + "</td><td>" + esc(r.topic) + "</td><td>" + esc(runContent(r)) + "</td><td>" + statusPill(runStatus(r)) + "</td>" +
          '<td class="muted">' + esc(mp.target_cell_main ? (mp.target_tab || "") + " · " + mp.target_cell_main : "—") + "</td>" +
          '<td class="actions"><button class="icon-btn" title="Details" data-view="' + esc(r.runId) + '">' + ICON.eye + "</button>" +
          '<button class="icon-btn" title="Send note" data-rnote="' + esc(r.runId) + '">' + ICON.mail + "</button>" +
          '<button class="icon-btn danger" title="Delete record" data-del="' + esc(r.runId) + '">' + ICON.trash + "</button></td></tr>";
      }).join("") : '<tr><td colspan="7" class="empty-state">' + (mgr.runs.length ? "No runs match the filter." : "No portal submissions yet.") + "</td></tr>") +
      "</tbody></table></div>";

    const rq = $("#rq");
    rq.addEventListener("input", () => { f.q = rq.value; const pos = rq.selectionStart; renderRuns(); const n = $("#rq"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#rs").addEventListener("change", (e) => { f.status = e.target.value; renderRuns(); });
    const byId = (id) => mgr.runs.find((r) => r.runId === id);
    $$("[data-view]", $("#panelRuns")).forEach((b) => b.addEventListener("click", () => runModal(byId(b.dataset.view))));
    $$("[data-rnote]", $("#panelRuns")).forEach((b) => b.addEventListener("click", () => { const r = byId(b.dataset.rnote); notifyModal({ participant: r.participantName, run: r }); }));
    $$("[data-del]", $("#panelRuns")).forEach((b) => b.addEventListener("click", () => deleteRun(byId(b.dataset.del))));
  }

  async function deleteRun(r) {
    if (!(await confirmModal({ title: "Delete this run record?", body: esc(r.participantName) + " · " + esc(r.topic) + " · case #" + esc(r.caseId) + "<br>Only the portal's record is removed — use <b>Tracker → Clear</b> to remove the entry from the sheet.", confirmLabel: "Delete", danger: true }))) return;
    try { await API.deleteRun(r.runId); toast("Record deleted"); await loadRuns(); } catch (e) { if (!handleAuth(e)) toast(e.message, true); }
  }

  function runModal(r) {
    const mp = (r.results && r.results.mapped) || {};
    const link = (u, t) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + "</a>";
    const items = [];
    if (r.builderUrl) items.push(link(r.builderUrl, "Main Workflow"));
    (r.subWorkflows || []).forEach((u, i) => items.push(link(u, "Sub-Workflow " + (i + 1))));
    (r.files || []).forEach((f, i) => items.push(link(f.url, f.name || "File (" + (i + 1) + ")")));
    const m = openModal(
      "<h2>" + esc(r.participantName) + " · " + esc(r.topic) + '</h2><p class="sub">Case #' + esc(r.caseId) + " · " + new Date(r.submittedAt).toLocaleString() + "</p>" +
      '<div class="result-box"><dl>' +
      "<dt>Status</dt><dd>" + statusPill(runStatus(r)) + "</dd>" +
      "<dt>Submitted</dt><dd>" + (items.length ? items.join(" · ") : "—") + "</dd>" +
      (r.notes ? "<dt>Notes</dt><dd>" + esc(r.notes) + "</dd>" : "") +
      (mp.target_cell_main ? "<dt>Logged to</dt><dd>" + esc(mp.target_tab) + " · " + esc(mp.target_cell_main) + "</dd>" : "") +
      (mp.error_output ? "<dt>Warnings</dt><dd>" + esc(mp.error_output) + "</dd>" : "") +
      "</dl></div>" +
      (r.results && r.results.raw && Object.keys(r.results.raw).length ? "<details><summary class=\"muted small\">Raw Opus results</summary><pre>" + esc(JSON.stringify(r.results.raw, null, 2)) + "</pre></details>" : "") +
      '<div class="foot"><button class="btn btn-ghost" id="rmDel">' + ICON.trash + 'Delete record</button><button class="btn btn-accent" id="rmNote">' + ICON.mail + "Send note</button></div>",
      { wide: true }
    );
    $("#rmNote", m.el).addEventListener("click", () => { m.close(); notifyModal({ participant: r.participantName, run: r }); });
    $("#rmDel", m.el).addEventListener("click", () => { m.close(); deleteRun(r); });
  }

  // ================================================================
  // Boot
  // ================================================================
  function boot() {
    initTheme();
    $("#portalTitle").textContent = CFG.PORTAL_TITLE;
    $("#programName").textContent = CFG.PROGRAM_NAME;
    document.title = CFG.PORTAL_TITLE + " · Applied AI";
    $("#year").textContent = new Date().getFullYear();
    $("#builderLink").href = CFG.WORKFLOW_BUILDER_URL;
    $("#demoPill").hidden = !API.demo;
    initForm();
    initManager();
    renderItems();
    renderRecent();
    loadMeta();
    if (API.session.token() && location.hash === "#manager") enterManager();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
