(function () {
  const copyPostBtn = document.getElementById('btn-copy-post');
  const copyCommentBtn = document.getElementById('btn-copy-comment');
  const dlPngBtn = document.getElementById('btn-dl-png');
  const postBox = document.getElementById('post-body');
  const commentBox = document.getElementById('comment-body');
  const statusEl = document.getElementById('pack-status');

  function copyEl(el, msg) {
    if (!el || !navigator.clipboard) return;
    navigator.clipboard.writeText(el.textContent).then(function () {
      if (statusEl) statusEl.textContent = msg;
    });
  }

  if (copyPostBtn) copyPostBtn.addEventListener('click', function () { copyEl(postBox, 'Copied Hebrew post to clipboard. Paste manually on LinkedIn.'); });
  if (copyCommentBtn) copyCommentBtn.addEventListener('click', function () { copyEl(commentBox, 'Copied first-comment source link to clipboard.'); });

  if (dlPngBtn) {
    dlPngBtn.addEventListener('click', function () {
      const img = document.getElementById('card-preview');
      if (!img) return;
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 1080, 1080);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'linkedin-insight-card.png';
      a.click();
      if (statusEl) statusEl.textContent = 'Downloaded 1080x1080 PNG card.';
    });
  }
})();
