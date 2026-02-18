import { AuditIssue, AuditResult, CraftInfo, PluginInfo } from '../types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function renderCraftInfo(craft?: CraftInfo): string {
  if (!craft) return '';
  const rows = [
    ['Version', craft.version],
    ['Edition', craft.edition],
    ['PHP', craft.phpVersion],
    ['DB Driver', craft.dbDriver],
    ['Update Available', craft.updateAvailable ?? 'none'],
  ];
  return `
    <section class="card">
      <h2>Craft</h2>
      <table class="kv">
        <tbody>
          ${rows
            .map(
              ([label, value]) =>
                `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

function renderPlugins(plugins?: PluginInfo[]): string {
  if (!plugins || plugins.length === 0) return '';
  const rows = plugins
    .map(
      (plugin) => `
      <tr>
        <td>${escapeHtml(plugin.name)}</td>
        <td>${escapeHtml(plugin.handle)}</td>
        <td>${escapeHtml(plugin.version)}</td>
        <td>${plugin.enabled ? 'yes' : 'no'}</td>
        <td>${plugin.installed ? 'yes' : 'no'}</td>
        <td>${escapeHtml(plugin.updateAvailable ?? 'none')}</td>
        <td>${plugin.craft5Compatible === undefined ? 'unknown' : plugin.craft5Compatible ? 'yes' : 'no'}</td>
      </tr>
    `
    )
    .join('');

  return `
    <section class="card">
      <h2>Plugins</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Handle</th>
              <th>Version</th>
              <th>Enabled</th>
              <th>Installed</th>
              <th>Update</th>
              <th>Craft 5</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function buildReportPayload(result: AuditResult): {
  projectPath: string;
  timestamp: string;
  summary: AuditResult['summary'];
  craft?: CraftInfo;
  plugins?: PluginInfo[];
  issues: AuditIssue[];
} {
  return {
    projectPath: result.projectPath,
    timestamp: result.timestamp,
    summary: result.summary,
    craft: result.craft,
    plugins: result.plugins,
    issues: result.issues,
  };
}

export class HtmlReporter {
  toHtml(result: AuditResult): string {
    const payload = buildReportPayload(result);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Craft Audit Report</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f0eb;
        --bg-alt: #fdfdfc;
        --panel: #ffffff;
        --text: #111827;
        --muted: #5b6472;
        --border: #e4e2dc;
        --high: #b91c1c;
        --medium: #b45309;
        --low: #1e3a8a;
        --info: #4b5563;
        --accent: #2563eb;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif;
        background: linear-gradient(135deg, #f3f0eb 0%, #f8f9fb 60%, #eef2ff 100%);
        color: var(--text);
      }
      header {
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        padding: 24px 32px;
        position: sticky;
        top: 0;
        z-index: 3;
      }
      header h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.02em; }
      header p { margin: 4px 0; color: var(--muted); }
      main { padding: 24px 32px 48px; display: grid; gap: 24px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
      }
      .stat { font-size: 22px; font-weight: 600; }
      .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .filters {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(240px, 1fr) repeat(auto-fit, minmax(140px, 1fr));
        align-items: end;
      }
      .filters input[type="search"],
      .filters select {
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--bg-alt);
        font-size: 13px;
      }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .chip {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--bg-alt);
        font-size: 12px;
      }
      .chip input { margin: 0; }
      .meta { color: var(--muted); font-size: 12px; }
      .btn {
        appearance: none;
        border: 1px solid var(--border);
        background: var(--panel);
        padding: 8px 12px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 12px;
      }
      .btn:hover { border-color: var(--accent); color: var(--accent); }
      .group { margin-bottom: 12px; }
      details {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel);
        overflow: hidden;
      }
      summary {
        padding: 12px 14px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        background: #f8fafc;
        font-weight: 600;
      }
      summary span { color: var(--muted); font-weight: 500; }
      .issue-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .issue-table th, .issue-table td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }
      .issue-table th { color: var(--muted); font-weight: 600; background: #f8fafc; }
      .issue-table tr:last-child td { border-bottom: none; }
      .severity-high { color: var(--high); font-weight: 600; }
      .severity-medium { color: var(--medium); font-weight: 600; }
      .severity-low { color: var(--low); font-weight: 600; }
      .severity-info { color: var(--info); font-weight: 600; }
      .empty { text-align: center; color: var(--muted); padding: 20px; }
      .table-scroll { overflow-x: auto; }
      .kv th { width: 180px; }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      @media (max-width: 720px) {
        header { padding: 20px; }
        main { padding: 20px; }
        summary { flex-direction: column; align-items: flex-start; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Craft Audit Report</h1>
      <p>Project: ${escapeHtml(result.projectPath)}</p>
      <p>Generated: ${escapeHtml(result.timestamp)}</p>
    </header>
    <main>
      <section class="grid">
        <div class="card"><div class="stat">${result.summary.total}</div><div class="label">Total</div></div>
        <div class="card"><div class="stat" style="color: var(--high)">${result.summary.high}</div><div class="label">High</div></div>
        <div class="card"><div class="stat" style="color: var(--medium)">${result.summary.medium}</div><div class="label">Medium</div></div>
        <div class="card"><div class="stat" style="color: var(--low)">${result.summary.low}</div><div class="label">Low</div></div>
        <div class="card"><div class="stat" style="color: var(--info)">${result.summary.info}</div><div class="label">Info</div></div>
      </section>
      ${renderCraftInfo(result.craft)}
      ${renderPlugins(result.plugins)}
      <section class="card">
        <h2>Findings</h2>
        <div class="filters">
          <label>
            <div class="label">Search</div>
            <input type="search" id="filter-search" placeholder="Search files, rules, messages" />
          </label>
          <label>
            <div class="label">Category</div>
            <select id="filter-category"></select>
          </label>
          <div>
            <div class="label">Severity</div>
            <div class="chips" id="filter-severity"></div>
          </div>
          <div>
            <div class="label">Actions</div>
            <button class="btn" id="filter-reset" type="button">Reset filters</button>
          </div>
        </div>
        <p class="meta" id="results-meta"></p>
        <div id="issue-groups"></div>
        <noscript>
          <p class="meta">Enable JavaScript to use filtering and grouping.</p>
        </noscript>
      </section>
    </main>
    <script type="application/json" id="craft-audit-data">${safeJson(payload)}</script>
    <script>
      (() => {
        const dataEl = document.getElementById('craft-audit-data');
        if (!dataEl) return;
        const data = JSON.parse(dataEl.textContent || '{}');
        const issues = Array.isArray(data.issues) ? data.issues : [];
        const categorySelect = document.getElementById('filter-category');
        const searchInput = document.getElementById('filter-search');
        const severityContainer = document.getElementById('filter-severity');
        const resetButton = document.getElementById('filter-reset');
        const groupsEl = document.getElementById('issue-groups');
        const metaEl = document.getElementById('results-meta');

        const severities = ['high', 'medium', 'low', 'info'];
        const state = {
          search: '',
          category: 'all',
          severity: new Set(severities),
        };

        const categories = Array.from(
          new Set(issues.map((issue) => issue.category).filter(Boolean))
        ).sort();

        function renderCategoryOptions() {
          if (!categorySelect) return;
          categorySelect.innerHTML = '';
          const allOption = document.createElement('option');
          allOption.value = 'all';
          allOption.textContent = 'All (' + issues.length + ')';
          categorySelect.appendChild(allOption);

          for (const category of categories) {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            categorySelect.appendChild(option);
          }
        }

        function renderSeverityFilters() {
          if (!severityContainer) return;
          severityContainer.innerHTML = '';
          for (const level of severities) {
            const count = issues.filter((issue) => issue.severity === level).length;
            const label = document.createElement('label');
            label.className = 'chip';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = level;
            input.checked = true;
            input.addEventListener('change', () => {
              if (input.checked) state.severity.add(level);
              else state.severity.delete(level);
              renderIssues();
            });
            const text = document.createElement('span');
            text.textContent = level + ' (' + count + ')';
            label.appendChild(input);
            label.appendChild(text);
            severityContainer.appendChild(label);
          }
        }

        function matchesFilter(issue) {
          if (!state.severity.has(issue.severity)) return false;
          if (state.category !== 'all' && issue.category !== state.category) return false;
          if (!state.search) return true;
          const haystack = [issue.file, issue.ruleId, issue.message, issue.suggestion]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(state.search);
        }

        function groupIssues(filtered) {
          const groups = new Map();
          for (const issue of filtered) {
            const key = issue.file || 'no-file';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(issue);
          }
          return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderIssues() {
          if (!groupsEl || !metaEl) return;
          const filtered = issues.filter(matchesFilter);
          metaEl.textContent = 'Showing ' + filtered.length + ' of ' + issues.length + ' findings';

          if (filtered.length === 0) {
            groupsEl.innerHTML = '<p class="empty">No findings match these filters.</p>';
            return;
          }

          const fragment = document.createDocumentFragment();
          const groups = groupIssues(filtered);

          for (const [file, groupIssuesList] of groups) {
            const details = document.createElement('details');
            details.className = 'group';
            details.open = groupIssuesList.length <= 4;
            const summary = document.createElement('summary');
            summary.innerHTML = escapeHtml(file) + '<span>' + groupIssuesList.length + ' finding(s)</span>';
            details.appendChild(summary);

            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'table-scroll';
            tableWrapper.innerHTML =
              '<table class="issue-table">' +
              '<thead>' +
              '<tr>' +
              '<th>Severity</th>' +
              '<th>Rule</th>' +
              '<th>Location</th>' +
              '<th>Message</th>' +
              '<th>Suggestion</th>' +
              '<th>Evidence</th>' +
              '</tr>' +
              '</thead>' +
              '<tbody>' +
              groupIssuesList
                .map((issue) => {
                  const location = issue.file && issue.line ? issue.file + ':' + issue.line : issue.file || '';
                  const evidence =
                    issue.evidence && (issue.evidence.details || issue.evidence.snippet)
                      ? String(issue.evidence.details || issue.evidence.snippet)
                      : '';
                  const docs = issue.docsUrl
                    ? ' <a href="' + escapeHtml(issue.docsUrl) + '">Docs</a>'
                    : '';
                  return (
                    '<tr>' +
                    '<td class="severity-' +
                    escapeHtml(issue.severity) +
                    '">' +
                    escapeHtml(issue.severity) +
                    '</td>' +
                    '<td>' +
                    escapeHtml(issue.ruleId || '') +
                    '</td>' +
                    '<td>' +
                    escapeHtml(location) +
                    '</td>' +
                    '<td>' +
                    escapeHtml(issue.message || '') +
                    '</td>' +
                    '<td>' +
                    escapeHtml(issue.suggestion || '') +
                    '</td>' +
                    '<td>' +
                    escapeHtml(evidence) +
                    docs +
                    '</td>' +
                    '</tr>'
                  );
                })
                .join('') +
              '</tbody>' +
              '</table>';
            details.appendChild(tableWrapper);
            fragment.appendChild(details);
          }

          groupsEl.innerHTML = '';
          groupsEl.appendChild(fragment);
        }

        renderCategoryOptions();
        renderSeverityFilters();
        renderIssues();

        if (searchInput) {
          searchInput.addEventListener('input', (event) => {
            state.search = (event.target.value || '').toLowerCase().trim();
            renderIssues();
          });
        }

        if (categorySelect) {
          categorySelect.addEventListener('change', (event) => {
            state.category = event.target.value;
            renderIssues();
          });
        }

        if (resetButton) {
          resetButton.addEventListener('click', () => {
            state.search = '';
            state.category = 'all';
            state.severity = new Set(severities);
            if (searchInput) searchInput.value = '';
            if (categorySelect) categorySelect.value = 'all';
            renderSeverityFilters();
            renderIssues();
          });
        }
      })();
    </script>
  </body>
</html>`;
  }
}
