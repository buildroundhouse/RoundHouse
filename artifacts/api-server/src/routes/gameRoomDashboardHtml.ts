/**
 * Operator dashboard HTML for the Roundhouse Game Room (#479).
 *
 * Single-file hand-rolled UI to keep parity with the existing purge
 * dashboard — see `adminDashboardHtml.ts` for the rationale. All five
 * panels (Score Controls, Live Scoreboard, User Drill-Down, Game
 * Stats, Prize Management) are rendered as collapsible sections that
 * fetch from /api/admin/game-room/* sibling endpoints. Auth is the
 * same browser-cached Basic credential as the rest of /api/admin.
 */
export function renderGameRoomDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Game Room \u00B7 Operator dashboard</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #161a22;
    --panel-2: #1d2230;
    --border: #2a3142;
    --text: #e7ecf3;
    --muted: #9aa4b2;
    --accent: #4f8cff;
    --accent-fg: #fff;
    --ok: #4ade80;
    --warn: #fbbf24;
    --danger: #ff6b6b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7fb; --panel: #ffffff; --panel-2: #f0f2f7;
      --border: #d8dde6; --text: #1a1f2b; --muted: #5b6573;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); padding: 24px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin: 0 0 12px; font-size: 16px; }
  .sub { color: var(--muted); margin-bottom: 20px; font-size: 13px; }
  .panel {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 18px; margin-bottom: 16px;
  }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .stat { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .stat .value { font-size: 22px; font-weight: 600; margin-top: 2px; }
  .stat .sub-value { font-size: 12px; color: var(--muted); margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  input[type="number"], input[type="text"], select, textarea {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; font: inherit;
  }
  button {
    background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 6px;
    padding: 7px 14px; font: inherit; cursor: pointer;
  }
  button.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  button[disabled] { opacity: 0.55; cursor: progress; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .status { font-size: 12px; color: var(--muted); margin-left: 6px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--danger); }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
           font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
           background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
  .badge.bronze { color: #c98c4d; }
  .badge.silver { color: #c0c8d4; }
  .badge.gold { color: #ecc94b; }
  .badge.platinum { color: #a3e3ff; }
  .badge.eligible { color: var(--muted); }
  .badge.selected { color: var(--accent); }
  .badge.shipped { color: var(--ok); }
  .empty { color: var(--muted); padding: 24px; text-align: center; }
  .nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .nav a { color: var(--accent); text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
  .small { font-size: 12px; color: var(--muted); }
  textarea { width: 100%; min-height: 56px; resize: vertical; }
</style>
</head>
<body>
  <h1>Roundhouse Game Room</h1>
  <div class="sub">Score controls, live scoreboard, user drill-down, game stats, prize management.</div>
  <div class="nav">
    <a href="#score">Score Controls</a> \u00B7
    <a href="#scoreboard">Scoreboard</a> \u00B7
    <a href="#drill">User Drill-Down</a> \u00B7
    <a href="#stats">Game Stats</a> \u00B7
    <a href="#prizes">Prize Management</a> \u00B7
    <a href="dashboard">Purge Dashboard</a>
  </div>

  <section id="stats" class="panel">
    <h2>Game Stats</h2>
    <div class="row" style="margin-bottom: 12px;">
      <button id="reload-stats" type="button" class="secondary">Reload</button>
      <span id="stats-status" class="status"></span>
    </div>
    <div id="stats-headline" class="grid"></div>
    <h2 style="margin-top:18px;">Event breakdown</h2>
    <table>
      <thead><tr><th>Event</th><th>Count</th><th>Total points</th></tr></thead>
      <tbody id="stats-breakdown"><tr><td colspan="3" class="empty">Loading\u2026</td></tr></tbody>
    </table>
  </section>

  <section id="score" class="panel">
    <h2>Score Controls</h2>
    <div class="sub">Tune point values per event. Saves take effect within 30s on every host.</div>
    <table>
      <thead><tr><th>Event</th><th>Default</th><th>Points</th></tr></thead>
      <tbody id="score-rows"><tr><td colspan="3" class="empty">Loading\u2026</td></tr></tbody>
    </table>
    <div class="row" style="margin-top: 12px;">
      <button id="save-score" type="button">Save changes</button>
      <button id="reload-score" type="button" class="secondary">Reload</button>
      <span id="score-status" class="status"></span>
    </div>
  </section>

  <section id="scoreboard" class="panel">
    <h2>Live Scoreboard</h2>
    <div class="row" style="margin-bottom: 12px;">
      <label>Limit <input id="sb-limit" type="number" min="1" max="500" value="100" /></label>
      <button id="reload-sb" type="button" class="secondary">Reload</button>
      <span id="sb-status" class="status"></span>
    </div>
    <table>
      <thead><tr><th>#</th><th>User</th><th>Tier</th><th>Points</th><th>Events</th><th>Drill-down</th></tr></thead>
      <tbody id="sb-rows"><tr><td colspan="6" class="empty">Loading\u2026</td></tr></tbody>
    </table>
  </section>

  <section id="drill" class="panel">
    <h2>User Drill-Down</h2>
    <div class="row" style="margin-bottom: 12px;">
      <label>Clerk ID <input id="drill-id" type="text" placeholder="firebase uid" style="min-width: 280px;" /></label>
      <button id="drill-go" type="button">Load</button>
      <span id="drill-status" class="status"></span>
    </div>
    <div id="drill-summary"></div>
    <table style="margin-top: 12px;">
      <thead><tr><th>When</th><th>Event</th><th>Points</th><th>Source</th></tr></thead>
      <tbody id="drill-rows"><tr><td colspan="4" class="empty">Enter a clerk id above.</td></tr></tbody>
    </table>
  </section>

  <section id="prizes" class="panel">
    <h2>Prize Management</h2>
    <div class="row" style="margin-bottom: 12px;">
      <label>Min points <input id="prize-min" type="number" min="0" value="100" /></label>
      <button id="reload-prizes" type="button" class="secondary">Reload</button>
      <span id="prizes-status" class="status"></span>
    </div>
    <table>
      <thead><tr><th>User</th><th>Points</th><th>Address</th><th>Status</th><th>Notes</th><th></th></tr></thead>
      <tbody id="prize-rows"><tr><td colspan="6" class="empty">Loading\u2026</td></tr></tbody>
    </table>
  </section>

<script>
(function () {
  function basePath() {
    // /api/admin/game-room/dashboard -> /api/admin/game-room
    return location.pathname.replace(/\\/dashboard$/, "");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s); if (isNaN(d.getTime())) return s;
    return d.toLocaleString();
  }
  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }
  function fetchJson(path, init) {
    var opts = Object.assign({ cache: "no-store", credentials: "same-origin" }, init || {});
    if (init && init.body && !opts.headers) opts.headers = { "Content-Type": "application/json" };
    return fetch(basePath() + path, opts).then(function (res) {
      if (res.status === 401) throw new Error("Operator credentials rejected. Reload the page to re-authenticate.");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // -- Score Controls --
  var scoreRows = document.getElementById("score-rows");
  var scoreStatus = document.getElementById("score-status");
  var scoreEvents = [];
  function renderScore() {
    if (!scoreEvents.length) {
      scoreRows.innerHTML = '<tr><td colspan="3" class="empty">No events.</td></tr>';
      return;
    }
    var html = "";
    scoreEvents.forEach(function (e, i) {
      html += '<tr>' +
        '<td><div>' + escapeHtml(e.label) + '</div>' +
        '<div class="small">' + escapeHtml(e.eventType) + ' \u00B7 ' + escapeHtml(e.description) + '</div></td>' +
        '<td class="small">' + (e.defaultPoints | 0) + '</td>' +
        '<td><input type="number" min="0" data-i="' + i + '" value="' + (e.points | 0) + '" style="width: 90px;" /></td>' +
        '</tr>';
    });
    scoreRows.innerHTML = html;
  }
  function loadScore() {
    setStatus(scoreStatus, "Loading\u2026");
    return fetchJson("/score-controls").then(function (b) {
      scoreEvents = b.events || []; renderScore();
      setStatus(scoreStatus, "Loaded " + scoreEvents.length + " events.", "ok");
    }).catch(function (err) { setStatus(scoreStatus, err.message, "err"); });
  }
  document.getElementById("save-score").addEventListener("click", function () {
    var inputs = scoreRows.querySelectorAll("input[type=number]");
    var payload = [];
    inputs.forEach(function (inp) {
      var i = parseInt(inp.dataset.i, 10);
      var ev = scoreEvents[i]; if (!ev) return;
      payload.push({ eventType: ev.eventType, points: parseInt(inp.value, 10) || 0 });
    });
    setStatus(scoreStatus, "Saving\u2026");
    fetchJson("/score-controls", { method: "PUT", body: JSON.stringify({ events: payload }) })
      .then(function (b) {
        scoreEvents = b.events || []; renderScore();
        setStatus(scoreStatus, "Saved.", "ok");
      })
      .catch(function (err) { setStatus(scoreStatus, err.message, "err"); });
  });
  document.getElementById("reload-score").addEventListener("click", loadScore);

  // -- Scoreboard --
  var sbRows = document.getElementById("sb-rows");
  var sbStatus = document.getElementById("sb-status");
  function loadScoreboard() {
    var lim = Math.max(1, Math.min(500, parseInt(document.getElementById("sb-limit").value, 10) || 100));
    setStatus(sbStatus, "Loading\u2026");
    fetchJson("/scoreboard?limit=" + lim).then(function (b) {
      var entries = b.entries || [];
      if (!entries.length) { sbRows.innerHTML = '<tr><td colspan="6" class="empty">No entries.</td></tr>'; return; }
      var html = "";
      entries.forEach(function (e) {
        html += '<tr>' +
          '<td>' + (e.rank | 0) + '</td>' +
          '<td><div>' + escapeHtml(e.name || "") + (e.username ? ' <span class="small">@' + escapeHtml(e.username) + '</span>' : '') + '</div>' +
          '<div class="small">' + escapeHtml(e.userClerkId) + '</div></td>' +
          '<td><span class="badge ' + escapeHtml(e.tier && e.tier.key) + '">' + escapeHtml(e.tier && e.tier.label) + '</span></td>' +
          '<td>' + (e.points | 0) + '</td>' +
          '<td>' + (e.events | 0) + '</td>' +
          '<td><button type="button" class="secondary" data-clerk="' + escapeHtml(e.userClerkId) + '">View</button></td>' +
          '</tr>';
      });
      sbRows.innerHTML = html;
      setStatus(sbStatus, "Loaded " + entries.length + " users.", "ok");
    }).catch(function (err) { setStatus(sbStatus, err.message, "err"); });
  }
  sbRows.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-clerk]"); if (!btn) return;
    document.getElementById("drill-id").value = btn.dataset.clerk;
    loadDrill();
    document.getElementById("drill").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("reload-sb").addEventListener("click", loadScoreboard);

  // -- Drill-down --
  var drillRows = document.getElementById("drill-rows");
  var drillSummary = document.getElementById("drill-summary");
  var drillStatus = document.getElementById("drill-status");
  function loadDrill() {
    var id = document.getElementById("drill-id").value.trim();
    if (!id) { setStatus(drillStatus, "Enter a clerk id.", "err"); return; }
    setStatus(drillStatus, "Loading\u2026");
    fetchJson("/users/" + encodeURIComponent(id)).then(function (b) {
      var u = b.user || {};
      drillSummary.innerHTML =
        '<div class="grid">' +
          '<div class="stat"><div class="label">Name</div><div class="value">' + escapeHtml(u.name || "") + '</div><div class="sub-value">' + escapeHtml(u.email || "") + '</div></div>' +
          '<div class="stat"><div class="label">Points</div><div class="value">' + (b.points | 0) + '</div></div>' +
          '<div class="stat"><div class="label">Tier</div><div class="value"><span class="badge ' + escapeHtml(b.tier && b.tier.key) + '">' + escapeHtml(b.tier && b.tier.label) + '</span></div></div>' +
          '<div class="stat"><div class="label">Address</div><div class="sub-value">' +
            escapeHtml([u.addressStreet, u.addressCity, u.addressState, u.addressZip].filter(Boolean).join(", ") || "(none)") +
          '</div></div>' +
        '</div>';
      var hist = b.history || [];
      if (!hist.length) { drillRows.innerHTML = '<tr><td colspan="4" class="empty">No history.</td></tr>'; }
      else {
        var html = "";
        hist.forEach(function (h) {
          html += '<tr><td>' + escapeHtml(fmtDate(h.createdAt)) + '</td>' +
            '<td><div>' + escapeHtml(h.label) + '</div><div class="small">' + escapeHtml(h.eventType) + '</div></td>' +
            '<td>' + (h.points | 0) + '</td>' +
            '<td class="small">' + escapeHtml(h.sourceRef || "") + '</td></tr>';
        });
        drillRows.innerHTML = html;
      }
      setStatus(drillStatus, "Loaded.", "ok");
    }).catch(function (err) { setStatus(drillStatus, err.message, "err"); });
  }
  document.getElementById("drill-go").addEventListener("click", loadDrill);
  document.getElementById("drill-id").addEventListener("keydown", function (e) {
    if (e.key === "Enter") loadDrill();
  });

  // -- Stats --
  var headlineEl = document.getElementById("stats-headline");
  var breakdownEl = document.getElementById("stats-breakdown");
  var statsStatus = document.getElementById("stats-status");
  function statCard(label, h) {
    return '<div class="stat"><div class="label">' + escapeHtml(label) + '</div>' +
      '<div class="value">' + (h.count | 0) + '</div>' +
      '<div class="sub-value">' + (h.points | 0) + ' pts awarded</div></div>';
  }
  function loadStats() {
    setStatus(statsStatus, "Loading\u2026");
    fetchJson("/stats").then(function (b) {
      var t = b.totals || {}; var h = b.headline || {};
      var html = '';
      html += '<div class="stat"><div class="label">Total points</div><div class="value">' + (t.totalPoints | 0) + '</div></div>';
      html += '<div class="stat"><div class="label">Total events</div><div class="value">' + (t.totalEvents | 0) + '</div></div>';
      html += '<div class="stat"><div class="label">Distinct users</div><div class="value">' + (t.totalUsers | 0) + '</div></div>';
      html += statCard("Daily logins", h.totalLogins || {});
      html += statCard("Estimates sent", h.totalEstimates || {});
      html += statCard("Invoices sent", h.totalInvoices || {});
      html += statCard("Questions answered", h.totalQuestionsAnswered || {});
      html += statCard("Answers accepted", h.totalAnswersAccepted || {});
      html += statCard("Roundhouse shares", h.totalShares || {});
      html += statCard("Logs", h.totalLogs || {});
      headlineEl.innerHTML = html;
      var rows = b.breakdown || [];
      if (!rows.length) { breakdownEl.innerHTML = '<tr><td colspan="3" class="empty">No events yet.</td></tr>'; }
      else {
        var bh = '';
        rows.forEach(function (r) {
          bh += '<tr><td><div>' + escapeHtml(r.label) + '</div><div class="small">' + escapeHtml(r.eventType) + '</div></td>' +
            '<td>' + (r.count | 0) + '</td><td>' + (r.points | 0) + '</td></tr>';
        });
        breakdownEl.innerHTML = bh;
      }
      setStatus(statsStatus, "Loaded.", "ok");
    }).catch(function (err) { setStatus(statsStatus, err.message, "err"); });
  }
  document.getElementById("reload-stats").addEventListener("click", loadStats);

  // -- Prizes --
  var prizeRows = document.getElementById("prize-rows");
  var prizeStatus = document.getElementById("prizes-status");
  function loadPrizes() {
    var min = parseInt(document.getElementById("prize-min").value, 10) || 100;
    setStatus(prizeStatus, "Loading\u2026");
    fetchJson("/prizes?minPoints=" + min).then(function (b) {
      var entries = b.entries || [];
      if (!entries.length) { prizeRows.innerHTML = '<tr><td colspan="6" class="empty">No eligible users.</td></tr>'; return; }
      var html = "";
      entries.forEach(function (e) {
        var addr = [e.address.street, e.address.city, e.address.state, e.address.zip].filter(Boolean).join(", ");
        if (!addr && e.address.legacy) addr = e.address.legacy;
        var status = (e.prize && e.prize.status) || "eligible";
        html += '<tr data-clerk="' + escapeHtml(e.userClerkId) + '">' +
          '<td><div>' + escapeHtml(e.name || "") + '</div><div class="small">' + escapeHtml(e.email || "") + '</div></td>' +
          '<td>' + (e.points | 0) + '</td>' +
          '<td class="small">' + escapeHtml(addr || "(no address)") + '<br/>' + escapeHtml(e.phone || "") + '</td>' +
          '<td><span class="badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span></td>' +
          '<td><textarea data-notes>' + escapeHtml((e.prize && e.prize.notes) || "") + '</textarea></td>' +
          '<td>' +
            '<select data-status>' +
              '<option value="eligible"' + (status === "eligible" ? " selected" : "") + '>Eligible</option>' +
              '<option value="selected"' + (status === "selected" ? " selected" : "") + '>Selected</option>' +
              '<option value="shipped"' + (status === "shipped" ? " selected" : "") + '>Shipped</option>' +
            '</select>' +
            ' <button type="button" data-save>Save</button>' +
          '</td>' +
          '</tr>';
      });
      prizeRows.innerHTML = html;
      setStatus(prizeStatus, "Loaded " + entries.length + " users.", "ok");
    }).catch(function (err) { setStatus(prizeStatus, err.message, "err"); });
  }
  prizeRows.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-save]"); if (!btn) return;
    var tr = btn.closest("tr"); var clerk = tr.dataset.clerk;
    var status = tr.querySelector("select[data-status]").value;
    var notes = tr.querySelector("textarea[data-notes]").value;
    setStatus(prizeStatus, "Saving\u2026");
    fetchJson("/prizes/" + encodeURIComponent(clerk), {
      method: "PATCH",
      body: JSON.stringify({ status: status, notes: notes }),
    }).then(function () { setStatus(prizeStatus, "Saved.", "ok"); loadPrizes(); })
      .catch(function (err) { setStatus(prizeStatus, err.message, "err"); });
  });
  document.getElementById("reload-prizes").addEventListener("click", loadPrizes);

  // boot
  loadStats();
  loadScore();
  loadScoreboard();
  loadPrizes();
})();
</script>
</body>
</html>`;
}
