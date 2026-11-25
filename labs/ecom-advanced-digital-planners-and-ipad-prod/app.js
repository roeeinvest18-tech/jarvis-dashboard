(function () {
  const SLUG = "ecom-advanced-digital-planners-and-ipad-prod";
  const textIn = document.getElementById('custom-text');
  const styleIn = document.getElementById('custom-style');
  const outText = document.getElementById('preview-text');
  const outStyle = document.getElementById('preview-style');
  const form = document.getElementById('preorder-form');
  const statusEl = document.getElementById('preorder-status');

  function syncPreview() {
    if (outText && textIn) outText.textContent = textIn.value.trim() || 'Your Custom Inscription';
    if (outStyle && styleIn) outStyle.textContent = 'Edition: ' + styleIn.value;
  }

  if (textIn) textIn.addEventListener('input', syncPreview);
  if (styleIn) styleIn.addEventListener('change', syncPreview);

  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const emailEl = document.getElementById('preorder-email');
      const email = emailEl ? emailEl.value.trim() : '';
      if (!email || email.indexOf('@') === -1) return;
      const saved = JSON.parse(localStorage.getItem('labs:waitlist:' + SLUG) || '[]');
      saved.push({ email: email, inscription: textIn ? textIn.value : '', style: styleIn ? styleIn.value : '', ts: new Date().toISOString() });
      localStorage.setItem('labs:waitlist:' + SLUG, JSON.stringify(saved));
      if (statusEl) statusEl.textContent = 'Saved launch notification request (sandbox preview only — no charge).';
      const syncBase = localStorage.getItem('jarvis:daily:syncUrl') || '';
      if (syncBase) {
        fetch(syncBase.replace(/\/+$/, '') + '/labs/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: SLUG, email: email, note: styleIn ? styleIn.value : '' })
        }).catch(function () {});
      }
      form.reset();
      syncPreview();
    });
  }
  syncPreview();
})();
