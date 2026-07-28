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

// Edit and delete are overlays too, same reasoning: a title/label edit or a
// delete can't reach the repo (or task_manager.py's own captured-locally
// list), so both are recorded here and applied on top of whatever the
// server or a local capture already has, keyed by id so a later re-export
// doesn't clobber them. Deleting is a client-side tombstone, not a real
// delete -- task_manager.py still has to be run to remove it from the
// shared file, same as ticks already work.
const TASK_TITLE_EDITS_KEY = 'jarvis:tasks:titleEdits';
const BUBBLE_LABEL_EDITS_KEY = 'jarvis:tasks:bubbleLabelEdits';
const DELETED_TASKS_KEY = 'jarvis:tasks:deletedTasks';
const DELETED_BUBBLES_KEY = 'jarvis:tasks:deletedBubbles';

// Which bubbles are expanded. Kept in memory only -- an expanded panel is a
// transient view state, not something worth persisting across sessions.
const expandedBubbles = new Set();
// Which single task/bubble is mid-edit or mid-delete-confirm. Only one of
// each at a time -- in-memory, transient view state, same as expandedBubbles.
let editingTaskId = null;
let editingBubbleId = null;
let confirmingDeleteTaskId = null;
let confirmingDeleteBubbleId = null;

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

// Merge server tasks with locally captured ones, then apply the tick,
// edit, and delete overlays.
function mergeTasks(serverPayload) {
  const overlay = loadOverlay();
  const captured = loadCaptured();
  const deletedTasks = new Set(loadJson(DELETED_TASKS_KEY, []));
  const deletedBubbles = new Set(loadJson(DELETED_BUBBLES_KEY, []));
  const titleEdits = loadJson(TASK_TITLE_EDITS_KEY, {});
  const bubbleLabelEdits = loadJson(BUBBLE_LABEL_EDITS_KEY, {});

  // A deleted task is a client-side tombstone -- task_manager.py doesn't
  // know about it yet, so it's filtered out here rather than actually
  // removed from tasks.json. Deleting a task takes all its bubbles with it
  // automatically, since the whole task object just stops rendering.
  const server = ((serverPayload && serverPayload.active) || [])
    .filter(t => !deletedTasks.has(t.id));

  // A locally captured task disappears from the local list once the same
  // title shows up from the server -- that means task_manager.py picked it up.
  const serverTitles = new Set(server.map(t => (t.title || '').toLowerCase()));
  const stillLocal = captured
    .filter(t => !deletedTasks.has(t.id))
    .filter(t => !serverTitles.has((t.title || '').toLowerCase()));
  if (stillLocal.length !== captured.length) saveCaptured(stillLocal);

  const addedBubbles = loadAddedBubbles();
  const titleFor = (task) => Object.prototype.hasOwnProperty.call(titleEdits, task.id)
    ? titleEdits[task.id] : task.title;

  // Skill-generated bubbles first, then any the user typed here that aren't
  // already present. Matching on label means a later decomposition that
  // happens to name the same sub-task absorbs the local one rather than
  // showing it twice.
  const withLocalBubbles = (task, serverBubbles) => {
    const mine = addedBubbles[task.id] || [];
    const seen = new Set(serverBubbles.map(b => (b.label || '').toLowerCase()));
    const extra = mine.filter(b => !seen.has((b.label || '').toLowerCase()));
    return [...serverBubbles, ...extra]
      .filter(b => !deletedBubbles.has(b.id))
      .map(b => ({
        ...b,
        label: Object.prototype.hasOwnProperty.call(bubbleLabelEdits, b.id) ? bubbleLabelEdits[b.id] : b.label,
        done: Object.prototype.hasOwnProperty.call(overlay, b.id) ? overlay[b.id] : !!b.done,
      }));
  };

  const merged = server.map(task => {
    const bubbles = withLocalBubbles(task, task.bubbles || []);
    return {
      ...task,
      title: titleFor(task),
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
      title: titleFor(t),
      bubbles,
      done_count: bubbles.filter(b => b.done).length,
      total_count: bubbles.length,
      decomposed: bubbles.length > 0,
      is_local: true,
    });
  });

  return merged;
}

// A bubble packs several independent controls into one pill:
//   - the checkbox toggles the bubble's own done state
//   - the label text opens inline edit mode (tap/click)
//   - the caret expands its numbered sub-step panel (always present, even
//     with zero steps yet, so a bubble with none can still get its first one)
//   - the trash icon opens an inline delete-confirm, replacing the label
// Edit and delete-confirm are mutually exclusive with expansion -- only one
// of "editing this bubble" / "confirming its delete" / "showing its normal
// controls" is ever true at once.
function renderBubble(taskId, bubble) {
  const pressed = bubble.done ? 'true' : 'false';
  const steps = mergeSubsteps(bubble);
  const hasSteps = steps.length > 0;
  const expanded = expandedBubbles.has(bubble.id);
  const doneCount = steps.filter(s => s.done).length;
  const panelId = `substeps-${bubble.id}`;
  const isEditing = editingBubbleId === bubble.id;
  const isConfirmingDelete = confirmingDeleteBubbleId === bubble.id;

  let middle;
  if (isConfirmingDelete) {
    middle = `
      <span class="bubble-confirm">
        <span class="bubble-confirm-text">Delete?</span>
        <button type="button" class="bubble-confirm-yes"
                data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">Yes</button>
        <button type="button" class="bubble-confirm-no"
                data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">No</button>
      </span>`;
  } else if (isEditing) {
    middle = `
      <input type="text" class="bubble-label-input" value="${escapeHtml(bubble.label)}"
             aria-label="Edit sub-task"
             data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">`;
  } else {
    middle = `
      <button type="button" class="bubble-text"
              data-task="${escapeHtml(taskId)}" data-edit="${escapeHtml(bubble.id)}">
        ${escapeHtml(bubble.label)}
      </button>`;
  }

  const trailingControls = (isEditing || isConfirmingDelete) ? '' : `
      <button type="button" class="bubble-expand" aria-expanded="${expanded}"
              aria-controls="${panelId}" aria-label="${expanded ? 'Collapse' : 'Expand'} sub-steps"
              data-task="${escapeHtml(taskId)}" data-expand="${escapeHtml(bubble.id)}">
        <span class="bubble-caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
        ${hasSteps ? `<span class="bubble-substep-count mono">${doneCount}/${steps.length}</span>` : ''}
      </button>
      <button type="button" class="bubble-delete" aria-label="Delete ${escapeHtml(bubble.label)}"
              data-task="${escapeHtml(taskId)}" data-delete="${escapeHtml(bubble.id)}">
        ${ICONS.trash()}
      </button>`;

  return `
    <span class="bubble-wrap">
      <span class="bubble ${bubble.done ? 'is-done' : ''} ${isEditing ? 'is-editing' : ''}">
        <button type="button" class="bubble-toggle" role="checkbox" aria-checked="${pressed}"
                aria-pressed="${pressed}"
                aria-label="Mark ${escapeHtml(bubble.label)} ${bubble.done ? 'not done' : 'done'}"
                data-task="${escapeHtml(taskId)}" data-bubble="${escapeHtml(bubble.id)}">
          <span class="bubble-check" aria-hidden="true">${bubble.done ? '✅' : '○'}</span>
        </button>
        ${middle}
        ${trailingControls}
      </span>
      ${(expanded && !isEditing && !isConfirmingDelete) ? renderSubstepPanel(taskId, bubble, steps, panelId) : ''}
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
  const isEditing = editingTaskId === task.id;
  const isConfirmingDelete = confirmingDeleteTaskId === task.id;

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

  let head;
  if (isConfirmingDelete) {
    head = `
      <div class="task-card-head">
        <span class="task-confirm-text">Delete "${escapeHtml(task.title)}" and its sub-tasks?</span>
        <button type="button" class="task-confirm-yes" data-task="${escapeHtml(task.id)}">Delete</button>
        <button type="button" class="task-confirm-no" data-task="${escapeHtml(task.id)}">Cancel</button>
      </div>`;
  } else if (isEditing) {
    head = `
      <div class="task-card-head">
        <input type="text" class="task-title-input" value="${escapeHtml(task.title)}"
               aria-label="Edit task title" data-task="${escapeHtml(task.id)}">
      </div>`;
  } else {
    head = `
      <div class="task-card-head">
        <button type="button" class="task-title" data-task-edit="${escapeHtml(task.id)}">
          ${escapeHtml(task.title)}
        </button>
        ${hasBubbles ? `<span class="task-progress mono">${task.done_count}/${task.total_count}</span>` : ''}
        <button type="button" class="task-delete" aria-label="Delete ${escapeHtml(task.title)}"
                data-task-delete="${escapeHtml(task.id)}">${ICONS.trash()}</button>
      </div>`;
  }

  return `
    <div class="task-card" data-task-card="${escapeHtml(task.id)}">
      ${head}
      ${!isConfirmingDelete ? body : ''}
      ${!isConfirmingDelete && !isEditing ? addBubble : ''}
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

  // Caret: expands/collapses the numbered sub-step panel. Never changes
  // done state, and is independent of edit/delete.
  document.querySelectorAll('.bubble-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.expand;
      if (expandedBubbles.has(id)) expandedBubbles.delete(id);
      else expandedBubbles.add(id);
      renderTaskZone(payload);
    });
  });

  // Bubble label text: tap to enter inline edit mode.
  document.querySelectorAll('.bubble-text').forEach(btn => {
    btn.addEventListener('click', () => {
      editingBubbleId = btn.dataset.edit;
      confirmingDeleteBubbleId = null;
      renderTaskZone(payload);
      const input = document.querySelector('.bubble-label-input');
      if (input) { input.focus(); input.select(); }
    });
  });

  // Bubble edit input: save on blur/Enter, cancel (discard, don't save an
  // empty label) on Escape. Escape must still exit edit mode -- only the
  // save step is skipped, not the re-render, or the input is left stuck
  // open with no way out but a page refresh.
  document.querySelectorAll('.bubble-label-input').forEach(input => {
    let cancelled = false;
    const commit = () => {
      if (!cancelled) {
        const value = input.value.trim();
        if (value) {
          const edits = loadJson(BUBBLE_LABEL_EDITS_KEY, {});
          edits[input.dataset.bubble] = value;
          saveJson(BUBBLE_LABEL_EDITS_KEY, edits);
        }
      }
      editingBubbleId = null;
      renderTaskZone(payload);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { cancelled = true; input.blur(); }
    });
  });

  // Bubble delete: trash icon opens an inline "Delete?" confirm, replacing
  // the label -- no browser confirm() popup, matches the design system.
  document.querySelectorAll('.bubble-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteBubbleId = btn.dataset.delete;
      editingBubbleId = null;
      renderTaskZone(payload);
    });
  });
  document.querySelectorAll('.bubble-confirm-yes').forEach(btn => {
    btn.addEventListener('click', () => {
      const deleted = new Set(loadJson(DELETED_BUBBLES_KEY, []));
      deleted.add(btn.dataset.bubble);
      saveJson(DELETED_BUBBLES_KEY, [...deleted]);
      confirmingDeleteBubbleId = null;
      renderTaskZone(payload);
    });
  });
  document.querySelectorAll('.bubble-confirm-no').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteBubbleId = null;
      renderTaskZone(payload);
    });
  });

  // Task title: tap to enter inline edit mode.
  document.querySelectorAll('.task-title').forEach(btn => {
    btn.addEventListener('click', () => {
      editingTaskId = btn.dataset.taskEdit;
      confirmingDeleteTaskId = null;
      renderTaskZone(payload);
      const input = document.querySelector('.task-title-input');
      if (input) { input.focus(); input.select(); }
    });
  });

  document.querySelectorAll('.task-title-input').forEach(input => {
    let cancelled = false;
    const commit = () => {
      if (!cancelled) {
        const value = input.value.trim();
        if (value) {
          const edits = loadJson(TASK_TITLE_EDITS_KEY, {});
          edits[input.dataset.task] = value;
          saveJson(TASK_TITLE_EDITS_KEY, edits);
        }
      }
      editingTaskId = null;
      renderTaskZone(payload);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { cancelled = true; input.blur(); }
    });
  });

  // Task delete: trash icon opens an inline confirm row that replaces the
  // whole card head; confirming removes the task and all its sub-tasks.
  document.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteTaskId = btn.dataset.taskDelete;
      editingTaskId = null;
      renderTaskZone(payload);
    });
  });
  document.querySelectorAll('.task-confirm-yes').forEach(btn => {
    btn.addEventListener('click', () => {
      const deleted = new Set(loadJson(DELETED_TASKS_KEY, []));
      deleted.add(btn.dataset.task);
      saveJson(DELETED_TASKS_KEY, [...deleted]);
      confirmingDeleteTaskId = null;
      renderTaskZone(payload);
    });
  });
  document.querySelectorAll('.task-confirm-no').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteTaskId = null;
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
        [...card.querySelectorAll('.bubble-text')]
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
