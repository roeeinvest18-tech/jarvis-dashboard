// Task zone: quick-add capture, tappable sub-task bubbles, done archive.
//
// Persistence model, and why it's split:
//   - dashboard_data/tasks.json is written by task_manager.py and carries the
//     skill-generated bubbles. It's the shared, durable copy.
//   - The PWA is a static viewer with no backend and no credentials, so a tap
//     cannot write back to the repo. Taps and quick-adds are therefore stored
//     in localStorage and OVERLAID on the fetched JSON at render time.
//
// The overlay is keyed by bubble id, so when task_manager.py later re-exports
// tasks.json the local ticks survive. Locally-captured tasks stay marked as
// pending until a real decomposition arrives for them.

const TASKS_LOCAL_KEY = 'jarvis:tasks:overlay';
const TASKS_DRAFT_KEY = 'jarvis:tasks:captured';

function loadOverlay() {
  try {
    return JSON.parse(localStorage.getItem(TASKS_LOCAL_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveOverlay(overlay) {
  try {
    localStorage.setItem(TASKS_LOCAL_KEY, JSON.stringify(overlay));
  } catch (e) {
    /* storage full or blocked — ticks just won't persist across reloads */
  }
}

function loadCaptured() {
  try {
    return JSON.parse(localStorage.getItem(TASKS_DRAFT_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveCaptured(list) {
  try {
    localStorage.setItem(TASKS_DRAFT_KEY, JSON.stringify(list));
  } catch (e) {
    /* non-fatal */
  }
}

// Merge server tasks with locally captured ones, then apply tick overlay.
function mergeTasks(serverPayload) {
  const overlay = loadOverlay();
  const captured = loadCaptured();
  const server = (serverPayload && serverPayload.active) || [];

  // A locally captured task disappears from the local list once the same
  // title shows up from the server -- that means task_manager.py picked it up.
  const serverTitles = new Set(server.map(t => (t.title || '').toLowerCase()));
  const stillLocal = captured.filter(t => !serverTitles.has((t.title || '').toLowerCase()));
  if (stillLocal.length !== captured.length) saveCaptured(stillLocal);

  const merged = server.map(task => {
    const bubbles = (task.bubbles || []).map(b => ({
      ...b,
      done: Object.prototype.hasOwnProperty.call(overlay, b.id) ? overlay[b.id] : !!b.done,
    }));
    return {
      ...task,
      bubbles,
      done_count: bubbles.filter(b => b.done).length,
      total_count: bubbles.length,
      is_local: false,
    };
  });

  stillLocal.forEach(t => {
    merged.push({
      id: t.id,
      title: t.title,
      bubbles: [],
      done_count: 0,
      total_count: 0,
      decomposed: false,
      is_local: true,
    });
  });

  return merged;
}

function renderBubble(taskId, bubble) {
  const pressed = bubble.done ? 'true' : 'false';
  return `
    <button type="button" class="bubble" role="checkbox" aria-checked="${pressed}"
            aria-pressed="${pressed}"
            data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">
      <span class="bubble-check" aria-hidden="true">${bubble.done ? '✅' : '○'}</span>
      <span>${escapeHtml(bubble.label)}</span>
    </button>`;
}

function renderTaskCard(task) {
  const hasBubbles = task.total_count > 0;
  const body = hasBubbles
    ? `<div class="bubble-row">${task.bubbles.map(b => renderBubble(task.id, b)).join('')}</div>`
    : `<div class="task-needs-decompose">${task.is_local
        ? 'Captured on this device — run the task-decompose skill to break it down.'
        : 'Not broken down yet — run the task-decompose skill.'}</div>`;

  return `
    <div class="task-card" data-task-card="${escapeHtml(task.id)}">
      <div class="task-card-head">
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${hasBubbles ? `<span class="task-progress mono">${task.done_count}/${task.total_count}</span>` : ''}
      </div>
      ${body}
    </div>`;
}

function renderArchivePanel(payload) {
  const items = (payload && payload.archive) || [];
  if (items.length === 0) {
    return `<div class="archive-panel"><div class="empty-state">Nothing completed in the last 7 days.</div></div>`;
  }
  return `<div class="archive-panel">
    ${items.map(t => `
      <div class="archive-item">
        <span class="archive-date">${escapeHtml((t.completed_at || '').slice(0, 10))}</span>
        <span class="archive-title">${escapeHtml(t.title)}</span>
      </div>`).join('')}
  </div>`;
}

function renderTaskZone(payload) {
  const section = document.getElementById('zone-tasks');
  const mount = document.getElementById('tasks-list');
  const badgeMount = document.getElementById('done-badge-mount');
  if (!section || !mount) return;

  // tasks.json is withheld from the public build, so on the hosted page the
  // zone hides rather than offering a quick-add box whose captures could
  // never sync anywhere. Locally-captured tasks still keep it open, so a
  // first capture before any export doesn't make the zone vanish.
  if (!payload && loadCaptured().length === 0) { section.hidden = true; return; }

  section.hidden = false;
  const tasks = mergeTasks(payload);
  const doneThisWeek = (payload && payload.done_this_week) || 0;

  // Only the count appears on the landing page; the list opens on tap.
  if (badgeMount) {
    badgeMount.innerHTML = `
      <button type="button" class="done-badge" id="done-badge" aria-expanded="false"
              aria-controls="archive-mount">
        ✅ ${doneThisWeek} done this week
      </button>`;
  }

  mount.innerHTML = `
    <form class="task-quickadd" id="task-quickadd" autocomplete="off">
      <input type="text" id="task-quickadd-input" name="task"
             placeholder="Add anything — call dentist, check insurance renewal…"
             aria-label="Add a task">
      <button type="submit">Add</button>
    </form>
    ${tasks.length
      ? tasks.map(renderTaskCard).join('')
      : `<div class="empty-state">No active tasks. Capture one above.</div>`}
    <div id="archive-mount" hidden></div>
    <p class="local-note">Ticks and captures are saved in this browser. Run
      <code>task_manager.py</code> to sync them into the shared task file.</p>
  `;

  wireQuickAdd(payload);
  wireBubbles(payload);
  wireArchiveToggle(payload);
}

function wireQuickAdd(payload) {
  const form = document.getElementById('task-quickadd');
  if (!form) return;
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const input = document.getElementById('task-quickadd-input');
    const title = (input.value || '').trim();
    if (!title) return;

    const captured = loadCaptured();
    captured.push({
      id: `local-${Date.now().toString(36)}`,
      title,
      captured_at: new Date().toISOString(),
    });
    saveCaptured(captured);
    input.value = '';
    renderTaskZone(payload);          // re-render so it appears immediately
    document.getElementById('task-quickadd-input').focus();
  });
}

function wireBubbles(payload) {
  document.querySelectorAll('.bubble').forEach(btn => {
    btn.addEventListener('click', () => {
      const bubbleId = btn.dataset.bubble;
      const overlay = loadOverlay();
      const nowDone = !(btn.getAttribute('aria-pressed') === 'true');
      overlay[bubbleId] = nowDone;
      saveOverlay(overlay);
      renderTaskZone(payload);
    });
  });
}

function wireArchiveToggle(payload) {
  const badge = document.getElementById('done-badge');
  const mount = document.getElementById('archive-mount');
  if (!badge || !mount) return;
  badge.addEventListener('click', () => {
    const open = badge.getAttribute('aria-expanded') === 'true';
    badge.setAttribute('aria-expanded', String(!open));
    mount.hidden = open;
    mount.innerHTML = open ? '' : renderArchivePanel(payload);
  });
}
