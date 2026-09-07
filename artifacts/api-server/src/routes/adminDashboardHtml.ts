/**
 * Operator dashboard HTML for the outward-account purge history (#391).
 *
 * Kept as a single hand-rolled string instead of a React/Vite artifact
 * because (a) the page has exactly one job, (b) it's only used by ops
 * staff, and (c) shipping it from the api-server avoids spinning up a
 * whole new web artifact and build pipeline for ~150 lines of UI.
 *
 * The page itself is gated by the operator credential (Basic auth via
 * requireOperator), so by the time this HTML reaches the browser the
 * session already has credentials cached. Subsequent fetches against
 * the JSON endpoints get the same Authorization header replayed
 * automatically — no key copy/paste required.
 */
export function renderPurgeDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Purge runs · Operator dashboard</title>
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
    --danger: #ff6b6b;
    --ok: #4ade80;
    --warn: #fbbf24;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7fb;
      --panel: #ffffff;
      --panel-2: #f0f2f7;
      --border: #d8dde6;
      --text: #1a1f2b;
      --muted: #5b6573;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .sub { color: var(--muted); margin-bottom: 20px; font-size: 13px; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 4px; }
  input[type="number"] {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font: inherit;
    min-width: 80px;
  }
  button {
    background: var(--accent);
    color: var(--accent-fg);
    border: 0;
    border-radius: 6px;
    padding: 7px 14px;
    font: inherit;
    cursor: pointer;
  }
  button.secondary {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  button[disabled] { opacity: 0.55; cursor: progress; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  th {
    cursor: pointer;
    user-select: none;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  th[aria-sort="ascending"]::after { content: " \\25B2"; }
  th[aria-sort="descending"]::after { content: " \\25BC"; }
  tr.expandable > td:first-child { cursor: pointer; }
  tr.expandable > td:first-child::before {
    content: "\\25B6";
    display: inline-block;
    width: 14px;
    color: var(--muted);
    transition: transform 0.1s ease;
  }
  tr.expandable.open > td:first-child::before { transform: rotate(90deg); }
  tr.detail td { background: var(--panel-2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; }
  .badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .badge.scheduled { color: var(--accent); }
  .badge.startup   { color: var(--warn); }
  .badge.script    { color: var(--ok); }
  .badge.api       { color: #c084fc; }
  .status { font-size: 12px; color: var(--muted); margin-left: 6px; }
  .status.err { color: var(--danger); }
  .status.ok  { color: var(--ok); }
  .empty { color: var(--muted); padding: 24px; text-align: center; }
  /* #403: at-a-glance health banner for the purge sweep. Green when a
     fresh run is on record, amber for the "still loading" state, red
     when the sweep is overdue (or has never run). The colour comes
     from a left border + tinted background so it reads as a status
     even before the operator parses the text. */
  .health {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    border-left: 4px solid var(--border);
    background: var(--panel-2);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .health.ok      { border-left-color: var(--ok);     background: color-mix(in srgb, var(--ok) 12%, var(--panel-2)); }
  .health.overdue { border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, var(--panel-2)); }
  .health.warn    { border-left-color: var(--warn);   background: color-mix(in srgb, var(--warn) 14%, var(--panel-2)); }
  .health-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--muted); margin-top: 5px; flex: 0 0 auto;
  }
  .health.ok      .health-dot { background: var(--ok); }
  .health.overdue .health-dot { background: var(--danger); }
  .health.warn    .health-dot { background: var(--warn); }
  .health-body { flex: 1; min-width: 0; }
  .health-title { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .health-meta  { color: var(--muted); font-size: 12px; }
  .health-meta b { color: var(--text); font-weight: 600; }
</style>
</head>
<body>
  <h1>Outward-account purge runs</h1>
  <div class="sub">Operator-only audit of the soft-delete sweep (#344). \u00B7 <a href="game-room/dashboard" style="color: var(--accent);">Open Game Room \u2192</a></div>

  <div class="panel" id="health-panel">
    <div id="health" class="health warn" role="status" aria-live="polite">
      <span class="health-dot" aria-hidden="true"></span>
      <div class="health-body">
        <div class="health-title" id="health-title">Checking purge sweep health\u2026</div>
        <div class="health-meta" id="health-meta">Fetching latest run from the audit table.</div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="row">
      <div>
        <label for="limit">Limit</label>
        <input id="limit" type="number" min="1" max="500" value="50" />
      </div>
      <div style="align-self: flex-end;">
        <button id="load" type="button">Reload</button>
        <button id="run" type="button" class="secondary">Run now</button>
        <span id="status" class="status"></span>
      </div>
    </div>
  </div>

  <div class="panel">
    <table id="tbl">
      <thead>
        <tr>
          <th data-key="ranAt" aria-sort="descending">Ran at</th>
          <th data-key="source">Source</th>
          <th data-key="accountsRemoved">Accounts</th>
          <th data-key="connectionsRemoved">Connections</th>
          <th data-key="runsTrimmed" title="Old purge audit rows the run cleaned up (#401)">Trimmed</th>
          <th data-key="durationMs">Duration</th>
          <th>Run id</th>
        </tr>
      </thead>
      <tbody id="rows">
        <tr><td colspan="7" class="empty">Loading\u2026</td></tr>
      </tbody>
    </table>
  </div>

<script>
(function () {
  var limitInput = document.getElementById("limit");
  var loadBtn = document.getElementById("load");
  var runBtn = document.getElementById("run");
  var statusEl = document.getElementById("status");
  var rowsEl = document.getElementById("rows");
  var headers = document.querySelectorAll("th[data-key]");
  var healthEl = document.getElementById("health");
  var healthTitle = document.getElementById("health-title");
  var healthMeta = document.getElementById("health-meta");

  var runs = [];
  var sortKey = "ranAt";
  var sortDir = "desc";

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString();
  }

  function fmtDuration(ms) {
    if (ms == null) return "";
    if (ms < 1000) return ms + " ms";
    return (ms / 1000).toFixed(2) + " s";
  }

  // #403: human-friendly age. The health endpoint reports raw ms so we
  // promote it into the largest sensible unit here for the banner.
  function fmtAge(ms) {
    if (ms == null) return "unknown";
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h " + (m % 60) + "m";
    var d = Math.floor(h / 24);
    return d + "d " + (h % 24) + "h";
  }

  function setHealthClass(kind) {
    healthEl.className = "health " + kind;
  }

  function renderHealth(h) {
    if (!h) {
      setHealthClass("warn");
      healthTitle.textContent = "Purge sweep health unavailable";
      healthMeta.textContent = "Could not read the health endpoint.";
      return;
    }
    var thresholdMin = Math.round(h.thresholdMs / 60000);
    var intervalMin = Math.round(h.intervalMs / 60000);
    if (h.lastRanAt == null) {
      setHealthClass("overdue");
      healthTitle.textContent = "Purge sweep has never run";
      healthMeta.innerHTML =
        "Expected every <b>" + escapeHtml(intervalMin + "m") +
        "</b> (overdue after <b>" + escapeHtml(thresholdMin + "m") + "</b>).";
      return;
    }
    var lastStr = fmtDate(h.lastRanAt);
    var ageStr = fmtAge(h.ageMs);
    if (h.overdue) {
      setHealthClass("overdue");
      var overBy = (h.ageMs != null ? h.ageMs : 0) - h.thresholdMs;
      healthTitle.textContent = "Purge sweep is overdue";
      healthMeta.innerHTML =
        "Last run <b>" + escapeHtml(lastStr) + "</b> \u00B7 " +
        "<b>" + escapeHtml(ageStr) + "</b> ago \u00B7 " +
        "overdue by <b>" + escapeHtml(fmtAge(overBy)) + "</b> " +
        "(threshold " + escapeHtml(thresholdMin + "m") + ", cadence " +
        escapeHtml(intervalMin + "m") + ").";
    } else {
      setHealthClass("ok");
      healthTitle.textContent = "Purge sweep is healthy";
      healthMeta.innerHTML =
        "Last run <b>" + escapeHtml(lastStr) + "</b> \u00B7 " +
        "<b>" + escapeHtml(ageStr) + "</b> ago " +
        "(cadence " + escapeHtml(intervalMin + "m") + ").";
    }
  }

  // #401: render the per-run trimmed-rows count. Empty/zero values
  // render as a dim em-dash so a quiet sweep doesn't shout "0" at the
  // operator; non-zero counts render as a plain integer.
  function fmtTrimmed(n) {
    if (n == null || (n | 0) === 0) {
      return '<span style="color: var(--muted);">\u2014</span>';
    }
    return String(n | 0);
  }

  function compare(a, b) {
    var av = a[sortKey];
    var bv = b[sortKey];
    if (sortKey === "ranAt") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }

  function render() {
    headers.forEach(function (th) {
      if (th.dataset.key === sortKey) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });
    if (!runs.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">No runs found.</td></tr>';
      return;
    }
    var sorted = runs.slice().sort(compare);
    var html = "";
    sorted.forEach(function (r, i) {
      var hasIds =
        (r.accountIds && r.accountIds.length) ||
        (r.connectionIds && r.connectionIds.length);
      html +=
        '<tr class="expandable' + (hasIds ? "" : " no-detail") + '" data-i="' + i + '">' +
        '<td>' + escapeHtml(fmtDate(r.ranAt)) + '</td>' +
        '<td><span class="badge ' + escapeHtml(r.source || "") + '">' + escapeHtml(r.source || "") + '</span></td>' +
        '<td>' + (r.accountsRemoved | 0) + '</td>' +
        '<td>' + (r.connectionsRemoved | 0) + '</td>' +
        '<td>' + fmtTrimmed(r.runsTrimmed) + '</td>' +
        '<td>' + escapeHtml(fmtDuration(r.durationMs)) + '</td>' +
        '<td>#' + (r.id | 0) + '</td>' +
        '</tr>';
      if (hasIds) {
        var detail =
          "accountIds:    " + JSON.stringify(r.accountIds || []) + "\\n" +
          "connectionIds: " + JSON.stringify(r.connectionIds || []);
        html +=
          '<tr class="detail" data-detail-for="' + i + '" hidden>' +
          '<td colspan="7">' + escapeHtml(detail) + '</td>' +
          '</tr>';
      }
    });
    rowsEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  rowsEl.addEventListener("click", function (e) {
    var tr = e.target.closest("tr.expandable");
    if (!tr || tr.classList.contains("no-detail")) return;
    var i = tr.dataset.i;
    var detail = rowsEl.querySelector('tr[data-detail-for="' + i + '"]');
    if (!detail) return;
    var open = !detail.hasAttribute("hidden");
    if (open) {
      detail.setAttribute("hidden", "");
      tr.classList.remove("open");
    } else {
      detail.removeAttribute("hidden");
      tr.classList.add("open");
    }
  });

  headers.forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.dataset.key;
      if (sortKey === k) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = k;
        sortDir = k === "ranAt" ? "desc" : "asc";
      }
      render();
    });
  });

  function basePath() {
    // Page is served at /api/admin/dashboard, so dropping the trailing
    // /dashboard gives us /api/admin/ as the base for sibling endpoints.
    return location.pathname.replace(/\\/dashboard$/, "");
  }

  // Browser-cached Basic auth from the page load is replayed automatically
  // on same-origin fetches, so no Authorization header needs to be set
  // manually here.
  function fetchJson(path, init) {
    var opts = Object.assign({ cache: "no-store", credentials: "same-origin" }, init || {});
    return fetch(basePath() + path, opts).then(function (res) {
      if (res.status === 401) throw new Error("Operator credentials rejected. Reload the page to re-authenticate.");
      if (res.status === 503) throw new Error("Operator API is not configured.");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // #403: surface the sweep's overdue/fresh state alongside the run
  // table. Fails soft — an unreachable health endpoint shouldn't block
  // the run history from rendering, so the banner just flips to a
  // neutral "unavailable" state and we log to the console.
  function loadHealth() {
    return fetchJson("/outward-account-purge-health")
      .then(function (body) {
        renderHealth(body);
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("health fetch failed", err);
        renderHealth(null);
      });
  }

  function loadRuns() {
    var lim = Math.max(1, Math.min(500, parseInt(limitInput.value, 10) || 50));
    setStatus("Loading\u2026");
    loadBtn.disabled = true;
    return fetchJson("/outward-account-purge-runs?limit=" + lim)
      .then(function (body) {
        runs = (body && body.runs) || [];
        render();
        setStatus("Loaded " + runs.length + " run" + (runs.length === 1 ? "" : "s") + ".", "ok");
      })
      .catch(function (err) {
        setStatus(err.message || String(err), "err");
      })
      .then(function () {
        loadBtn.disabled = false;
      });
  }

  function runNow() {
    if (!confirm("Trigger an on-demand purge sweep now?")) return;
    setStatus("Running sweep\u2026");
    runBtn.disabled = true;
    fetchJson("/outward-account-purge-runs", { method: "POST" })
      .then(function (body) {
        setStatus(
          "Swept run #" + (body.runId | 0) + ": " + (body.accounts | 0) +
          " accounts, " + (body.connections | 0) + " connections.",
          "ok",
        );
        return Promise.all([loadRuns(), loadHealth()]);
      })
      .catch(function (err) {
        setStatus(err.message || String(err), "err");
      })
      .then(function () {
        runBtn.disabled = false;
      });
  }

  loadBtn.addEventListener("click", function () {
    loadRuns();
    loadHealth();
  });
  runBtn.addEventListener("click", runNow);

  loadRuns();
  loadHealth();
})();
</script>
</body>
</html>`;
}
