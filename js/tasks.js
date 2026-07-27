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
// Sub-step ticks and locally-added sub-steps, same overlay rationale as
// above: a tap can't reach the repo, so it lives here and is merged on load.
const SUBSTEP_STATE_KEY = 'jarvis:tasks:substeps';
const SUBSTEP_ADDED_KEY = 'jarvis:tasks:substepsAdded';
// Sub-tasks (bubbles) the user typed in the browser, keyed by task id.
// The decompose skill is one way to get bubbles; this is the other, so a
// task added on the phone isn't a dead end until you reach a terminal.
const BUBBLE_ADDED_KEY = 'jarvis:tasks:bubblesAdded';
// Which bubbles are expanded. Kept in memory only -- an expanded panel is a
// transient view state, not something worth persisting across sessions.
const expandedBubbles = new Set();

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

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (e) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* non-fatal */
  }
}

// Sub-steps the user added in the browser, keyed by bubble id, merged onto
// whatever the shared file already has for that bubble.
function loadAddedSubsteps() { return loadJson(SUBSTEP_ADDED_KEY, {}); }
function loadSubstepState() { return loadJson(SUBSTEP_STATE_KEY, {}); }
function loadAddedBubbles() { return loadJson(BUBBLE_ADDED_KEY, {}); }

function mergeSubsteps(bubble) {
  const added = loadAddedSubsteps()[bubble.id] || [];
  const state = loadSubstepState();
  const fromServer = bubble.subSteps || [];

  // Server list first, then anything added locally that isn't already there.
  const serverLabels = new Set(fromServer.map(s => (s.label || '').toLowerCase()));
  const localOnly = added.filter(s => !serverLabels.has((s.label || '').toLowerCase()));

  return [...fromServer, ...localOnly].map(s => ({
    ...s,
    done: Object.prototype.hasOwnProperty.call(state, s.id) ? state[s.id] : !!s.done,
  }));
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

  const addedBubbles = loadAddedBubbles();

  // Skill-generated bubbles first, then any the user typed here that aren't
  // already present. Matching on label means a later decomposition that
  // happens to name the same sub-task absorbs the local one rather than
  // showing it twice.
  const withLocalBubbles = (task, serverBubbles) => {
    const mine = addedBubbles[task.id] || [];
    const seen = new Set(serverBubbles.map(b => (b.label || '').toLowerCase()));
    const extra = mine.filter(b => !seen.has((b.label || '').toLowerCase()));
    return [...serverBubbles, ...extra].map(b => ({
      ...b,
      done: Object.prototype.hasOwnProperty.call(overlay, b.id) ? overlay[b.id] : !!b.done,
    }));
  };

  const merged = server.map(task => {
    const bubbles = withLocalBubbles(task, task.bubbles || []);
    return {
      ...task,
      bubbles,
      done_count: bubbles.filter(b => b.done).length,
      total_count: bubbles.length,
      is_local: false,
    };
  });

  stillLocal.forEach(t => {
    const bubbles = withLocalBubbles(t, []);
    merged.push({
      id: t.id,
      title: t.title,
      bubbles,
      done_count: bubbles.filter(b => b.done).length,
      total_count: bubbles.length,
      decomposed: bubbles.length > 0,
      is_local: true,
    });
  });

  return merged;
}

// A bubble is two independent controls sharing one pill:
//   - the checkbox toggles the bubble's own done state
//   - the label expands its numbered sub-step panel
// They're separate <button>s rather than one element with click-target
// maths, so keyboard and screen-reader users get the same two actions.
function renderBubble(taskId, bubble) {
  const pressed = bubble.done ? 'true' : 'false';
  const steps = mergeSubsteps(bubble);
  const hasSteps = steps.length > 0;
  const expanded = expandedBubbles.has(bubble.id);
  const doneCount = steps.filter(s => s.done).length;
  const panelId = `substeps-${bubble.id}`;

  // The expand affordance only exists once there's something to expand,
  // or while the add-panel is open.
  const caret = hasSteps
    ? `<span class="bubble-caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
       <span class="bubble-substep-count mono">${doneCount}/${steps.length}</span>`
    : '';

  return `
    <span class="bubble-wrap">
      <span class="bubble ${bubble.done ? 'is-done' : ''}">
        <button type="button" class="bubble-toggle" role="checkbox" aria-checked="${pressed}"
                aria-pressed="${pressed}"
                aria-label="Mark ${escapeHtml(bubble.label)} ${bubble.done ? 'not done' : 'done'}"
                data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">
          <span class="bubble-check" aria-hidden="true">${bubble.done ? '✅' : '○'}</span>
        </button>
        <button type="button" class="bubble-label" aria-expanded="${expanded}"
                aria-controls="${panelId}"
                data-task="${escapeHtml(taskId)}" data-expand="${escapeHtml(bubble.id)}">
          <span>${escapeHtml(bubble.label)}</span>
          ${caret}
        </button>
      </span>
      ${expanded ? renderSubstepPanel(taskId, bubble, steps, panelId) : ''}
    </span>`;
}

function renderSubstepPanel(taskId, bubble, steps, panelId) {
  const list = steps.length
    ? `<ol class="substep-list">
        ${steps.map(s => `
          <li class="substep ${s.done ? 'is-done' : ''}">
            <button type="button" class="substep-toggle" role="checkbox"
                    aria-checked="${s.done ? 'true' : 'false'}"
                    data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}"
                    data-substep="${escapeHtml(s.id)}">
              <span class="substep-check" aria-hidden="true">${s.done ? '✅' : '○'}</span>
              <span class="substep-label">${escapeHtml(s.label)}</span>
            </button>
          </li>`).join('')}
      </ol>`
    : `<p class="substep-empty">No sub-steps yet.</p>`;

  return `
    <div class="substep-panel" id="${panelId}" data-panel-for="${escapeHtml(bubble.id)}">
      ${list}
      <form class="substep-add" data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">
        <input type="text" placeholder="Add a step…" aria-label="Add a sub-step to ${escapeHtml(bubble.label)}">
        <button type="submit" aria-label="Add sub-step">+</button>
      </form>
    </div>`;
}

function renderTaskCard(task) {
  const hasBubbles = task.total_count > 0;
  const body = hasBubbles
    ? `<div class="bubble-row">${task.bubbles.map(b => renderBubble(task.id, b)).join('')}</div>`
    : `<div class="task-needs-decompose">No sub-tasks yet — add one below, or run the
         task-decompose skill to generate them.</div>`;

  // Always available, whether or not bubbles exist. Without this a task added
  // on the phone was a dead end until you reached a terminal, which defeats
  // the point of frictionless capture.
  const addBubble = `
    <form class="bubble-add" data-task="${escapeHtml(task.id)}">
      <input type="text" placeholder="Add a sub-task…"
             aria-label="Add a sub-task to ${escapeHtml(task.title)}">
      <button type="submit" aria-label="Add sub-task">+</button>
    </form>`;

  return `
    <div class="task-card" data-task-card="${escapeHtml(task.id)}">
      <div class="task-card-head">
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${hasBubbles ? `<span class="task-progress mono">${task.done_count}/${task.total_count}</span>` : ''}
      </div>
      ${body}
      ${addBubble}
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

  if (DASHBOARD.locked.has('tasks')) {
    section.hidden = false;
    if (badgeMount) badgeMount.innerHTML = '';
    mount.innerHTML = renderLockedZone('Your tasks');
    return;
  }

  // Withheld (public build) is not the same as empty. Vanishing made the
  // page look truncated, so the zone stays and says which it is. No
  // quick-add on the public build -- captures there could never sync.
  if (!payload && loadCaptured().length === 0) {
    section.hidden = false;
    if (badgeMount) badgeMount.innerHTML = '';
    mount.innerHTML = DASHBOARD.isWithheld('tasks')
      ? renderWithheldZone('Your tasks')
      : renderEmptyZone('No tasks yet. Run task_manager.py to add one.');
    return;
  }

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
  // Checkbox: toggles the bubble only. Never touches its sub-steps.
  document.querySelectorAll('.bubble-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlay = loadOverlay();
      overlay[btn.dataset.bubble] = !(btn.getAttribute('aria-pressed') === 'true');
      saveOverlay(overlay);
      renderTaskZone(payload);
    });
  });

  // Label: expands/collapses the numbered panel. Never changes done state.
  document.querySelectorAll('.bubble-label').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.expand;
      if (expandedBubbles.has(id)) expandedBubbles.delete(id);
      else expandedBubbles.add(id);
      renderTaskZone(payload);
    });
  });

  // Sub-step checkbox: independent of the parent bubble in both directions.
  document.querySelectorAll('.substep-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = loadSubstepState();
      const id = btn.dataset.substep;
      state[id] = !(btn.getAttribute('aria-checked') === 'true');
      saveJson(SUBSTEP_STATE_KEY, state);
      renderTaskZone(payload);
    });
  });

  // Add a sub-task (bubble) to a main task inline.
  document.querySelectorAll('.bubble-add').forEach(form => {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const input = form.querySelector('input');
      const label = (input.value || '').trim();
      if (!label) return;

      const taskId = form.dataset.task;
      const added = loadAddedBubbles();
      const list = added[taskId] || [];

      // Don't create a duplicate of a bubble that's already on the card.
      const card = form.closest('.task-card');
      const existing = new Set(
        [...card.querySelectorAll('.bubble-label > span:first-child')]
          .map(e => e.textContent.trim().toLowerCase())
      );
      if (existing.has(label.toLowerCase())) { input.value = ''; return; }

      list.push({
        id: `localb-${taskId}-${Date.now().toString(36)}`,
        label,
        done: false,
        added_at: new Date().toISOString(),
      });
      added[taskId] = list;
      saveJson(BUBBLE_ADDED_KEY, added);

      input.value = '';
      renderTaskZone(payload);
      // Refocus so several sub-tasks can be typed in a row.
      const reopened = document.querySelector(
        `.bubble-add[data-task="${CSS.escape(taskId)}"] input`);
      if (reopened) reopened.focus();
    });
  });

  // Add a sub-step inline.
  document.querySelectorAll('.substep-add').forEach(form => {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const input = form.querySelector('input');
      const label = (input.value || '').trim();
      if (!label) return;

      const bubbleId = form.dataset.bubble;
      const added = loadAddedSubsteps();
      const list = added[bubbleId] || [];
      // Local ids are prefixed so they're distinguishable from skill-generated
      // ones when the two lists are merged.
      list.push({
        id: `local-${bubbleId}-${Date.now().toString(36)}`,
        label,
        done: false,
        added_at: new Date().toISOString(),
      });
      added[bubbleId] = list;
      saveJson(SUBSTEP_ADDED_KEY, added);

      input.value = '';
      expandedBubbles.add(bubbleId);   // keep the panel open after adding
      renderTaskZone(payload);
      // Return focus so several steps can be added in a row.
      const reopened = document.querySelector(
        `.substep-add[data-bubble="${CSS.escape(bubbleId)}"] input`);
      if (reopened) reopened.focus();
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
