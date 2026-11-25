(function () {
  const inputEl = document.getElementById('poc-input');
  const outEl = document.getElementById('poc-output');
  const kpiProcessed = document.getElementById('kpi-processed');
  const kpiFlagged = document.getElementById('kpi-flagged');
  const runBtn = document.getElementById('btn-run');
  const resetBtn = document.getElementById('btn-reset');
  const defaultSample = inputEl ? inputEl.value : '{}';

  function evaluatePayload(raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.events)) {
      const alerts = parsed.events.filter(function (e) {
        return (Number(e.attempts || 0) >= 10) || String(e.cmd || '').toLowerCase().indexOf('-enc') !== -1;
      }).map(function (e) {
        return {
          host: e.host || 'unknown',
          user: e.user || 'unknown',
          severity: String(e.cmd || '').indexOf('-enc') !== -1 ? 'HIGH' : 'MEDIUM',
          action: 'Isolate session & rotate credentials'
        };
      });
      return { total: parsed.events.length, highlighted: alerts.length, result: { triggered_alerts: alerts.length, alerts: alerts } };
    }
    if (Array.isArray(parsed.records)) {
      const totalMrr = parsed.records.reduce(function (acc, r) { return acc + Number(r.mrr_usd || 0); }, 0);
      const active = parsed.records.filter(function (r) { return r.status === 'Active'; }).length;
      return { total: parsed.records.length, highlighted: active, result: { total_accounts: parsed.records.length, active_accounts: active, total_mrr_usd: totalMrr } };
    }
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const routed = items.map(function (it) {
      const txt = String(it.text || '').toLowerCase();
      const val = Number(it.value_usd || 0);
      const priority = txt.indexOf('unsubscribe') !== -1 ? 'LOW' : (val >= 3000 || txt.indexOf('urgent') !== -1 ? 'HIGH' : 'MEDIUM');
      return { id: it.id, priority: priority, estimated_value_usd: val };
    });
    const actionable = routed.filter(function (r) { return r.priority !== 'LOW'; }).length;
    return { total: items.length, highlighted: actionable, result: { ingested: items.length, actionable_count: actionable, routed_items: routed } };
  }

  function runNow() {
    if (!inputEl || !outEl) return;
    try {
      const res = evaluatePayload(inputEl.value);
      if (kpiProcessed) kpiProcessed.textContent = String(res.total);
      if (kpiFlagged) kpiFlagged.textContent = String(res.highlighted);
      outEl.textContent = JSON.stringify(res.result, null, 2);
    } catch (err) {
      outEl.textContent = 'Invalid JSON payload: ' + err.message;
    }
  }

  if (runBtn) runBtn.addEventListener('click', runNow);
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (inputEl) inputEl.value = defaultSample;
      runNow();
    });
  }
  runNow();
})();
