(function () {
  const SLUG = "mvp-subscription-management-and-cancellation";
  const inputEl = document.getElementById('mvp-input');
  const rateEl = document.getElementById('mvp-threshold');
  const outEl = document.getElementById('mvp-output');
  const runBtn = document.getElementById('mvp-run');
  const exportBtn = document.getElementById('mvp-export');
  const form = document.getElementById('waitlist-form');
  const statusEl = document.getElementById('waitlist-status');
  let latestRows = [];

  function analyzeNow() {
    if (!inputEl || !outEl) return;
    const threshold = Math.max(1, Number((rateEl && rateEl.value) || 6));
    const lines = inputEl.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    latestRows = lines.map(function (line, idx) {
      const hoursMatch = line.match(/hours\s*:\s*(\d+(?:\.\d+)?)/i);
      const rateMatch = line.match(/rate\s*:\s*(\d+(?:\.\d+)?)/i);
      const hours = hoursMatch ? Number(hoursMatch[1]) : (idx + 1) * 3;
      const rate = rateMatch ? Number(rateMatch[1]) : 110;
      const flagged = hours >= threshold || /extra|unbilled|urgent|manual|fail/i.test(line);
      return {
        row: idx + 1,
        summary: line.slice(0, 78),
        hours: hours,
        estimated_usd: Math.round(hours * rate),
        status: flagged ? 'ACTION_REQUIRED' : 'ON_TRACK'
      };
    });
    const totalUsd = latestRows.reduce(function (s, r) { return s + r.estimated_usd; }, 0);
    const flaggedCount = latestRows.filter(function (r) { return r.status === 'ACTION_REQUIRED'; }).length;
    const report = {
      analyzed_items: latestRows.length,
      flagged_items: flaggedCount,
      total_value_usd: totalUsd,
      recommendations: latestRows
    };
    outEl.textContent = JSON.stringify(report, null, 2);
  }

  if (runBtn) runBtn.addEventListener('click', analyzeNow);
  if (rateEl) rateEl.addEventListener('change', analyzeNow);
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      if (!latestRows.length) analyzeNow();
      const header = 'row,status,hours,estimated_usd,summary\n';
      const body = latestRows.map(function (r) {
        return [r.row, r.status, r.hours, r.estimated_usd, '"' + r.summary.replace(/"/g, '""') + '"'].join(',');
      }).join('\n');
      const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = SLUG + '-report.csv';
      a.click();
    });
  }

  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const emailInput = document.getElementById('waitlist-email');
      const noteInput = document.getElementById('waitlist-note');
      const email = emailInput ? emailInput.value.trim() : '';
      const note = noteInput ? noteInput.value.trim() : '';
      if (!email || email.indexOf('@') === -1) {
        if (statusEl) statusEl.textContent = 'Enter a valid work email.';
        return;
      }
      const saved = JSON.parse(localStorage.getItem('labs:waitlist:' + SLUG) || '[]');
      saved.push({ email: email, note: note, ts: new Date().toISOString() });
      localStorage.setItem('labs:waitlist:' + SLUG, JSON.stringify(saved));
      if (statusEl) statusEl.textContent = 'Saved to early-access list. We will reach out with pilot access.';
      const syncBase = localStorage.getItem('jarvis:daily:syncUrl') || '';
      if (syncBase) {
        fetch(syncBase.replace(/\/+$/, '') + '/labs/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: SLUG, email: email, note: note })
        }).catch(function () {});
      }
      form.reset();
    });
  }

  analyzeNow();
})();
