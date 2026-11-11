// nutrition.js - Jarvis OS Nutrition & Macro Hub
// Lean bulk target: 165g protein / 3,050 kcal with custom and verified food tracking.

(function () {
  'use strict';

  const DEFAULT_TARGETS = {
    protein_target: 165,
    calorie_target: 3050,
  };

  const NUTRITION_PRESETS = [
    { id: 'egg_m', label: 'Egg (Medium - M)', protein: 6.3, calories: 68, unit: 'unit' },
    { id: 'egg_l', label: 'Egg (Large - L)', protein: 7.2, calories: 76, unit: 'unit' },
    { id: 'egg_xl', label: 'Egg (XL)', protein: 8.1, calories: 86, unit: 'unit' },
    { id: 'egg_whites', label: 'Egg whites (100g)', protein: 11.0, calories: 52, unit: '100g' },
    { id: 'chicken_100', label: 'Chicken breast cooked (100g)', protein: 31.0, calories: 165, unit: '100g' },
    { id: 'chicken_200', label: 'Chicken breast cooked (200g)', protein: 62.0, calories: 330, unit: '200g' },
    { id: 'tuna_can', label: 'Canned tuna in water (112g)', protein: 28.0, calories: 120, unit: 'can' },
    { id: 'cottage_100', label: 'Cottage cheese 5% (100g)', protein: 11.0, calories: 95, unit: '100g' },
    { id: 'cottage_tub', label: 'Cottage cheese 5% (250g tub)', protein: 27.5, calories: 237, unit: 'tub' },
    { id: 'whey_scoop', label: 'Whey protein scoop (30g)', protein: 24.0, calories: 120, unit: 'scoop' },
    { id: 'pro_yogurt', label: 'Pro yogurt cup (20g pro)', protein: 20.0, calories: 125, unit: 'cup' },
    { id: 'greek_0', label: 'Greek yogurt 0% (200g)', protein: 20.0, calories: 114, unit: '200g' },
    { id: 'beef_100', label: 'Lean beef mince 5% (100g)', protein: 26.0, calories: 137, unit: '100g' },
    { id: 'salmon_150', label: 'Salmon fillet (150g)', protein: 34.0, calories: 310, unit: 'fillet' },
    { id: 'rice_150', label: 'White rice cooked (150g)', protein: 4.0, calories: 195, unit: '150g' },
    { id: 'oats_50', label: 'Rolled oats (50g)', protein: 6.5, calories: 190, unit: '50g' },
    { id: 'peanut_butter', label: 'Peanut butter (30g / 2 tbsp)', protein: 8.0, calories: 190, unit: '30g' },
  ];

  function getStorageKey(date) {
    return 'jarvis:nutrition:' + date;
  }

  function getNutritionState(date) {
    try {
      const raw = localStorage.getItem(getStorageKey(date));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.meals) return parsed;
      }
    } catch (e) {
      // ignore
    }
    return {
      date: date,
      target_protein: DEFAULT_TARGETS.protein_target,
      target_calories: DEFAULT_TARGETS.calorie_target,
      meals: {
        breakfast: [],
        lunch: [],
        dinner: [],
        snacks: [],
      },
    };
  }

  function saveNutritionState(state) {
    try {
      localStorage.setItem(getStorageKey(state.date), JSON.stringify(state));
    } catch (e) {
      // ignore
    }

    // Sync with Daily OS records if available
    try {
      if (typeof DAILY !== 'undefined' && typeof DAILY.getDay === 'function') {
        const record = DAILY.getDay(state.date);
        const totals = calculateTotals(state);
        let changed = false;

        if (state.meals.breakfast && state.meals.breakfast.length > 0 && !record.breakfast) {
          record.breakfast = true;
          changed = true;
        }
        if (state.meals.dinner && state.meals.dinner.length > 0 && !record.dinner) {
          record.dinner = true;
          changed = true;
        }
        if (totals.total_protein >= state.target_protein && !record.protein_target_met) {
          record.protein_target_met = true;
          changed = true;
        }

        if (changed && typeof DAILY.saveDay === 'function') {
          DAILY.saveDay(record);
          if (typeof renderDailyToday === 'function') {
            renderDailyToday();
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function calculateTotals(state) {
    let total_protein = 0;
    let total_calories = 0;

    const meals = state.meals || {};
    for (const mealKey of ['breakfast', 'lunch', 'dinner', 'snacks']) {
      const items = meals[mealKey] || [];
      for (const item of items) {
        total_protein += Number(item.protein) || 0;
        total_calories += Number(item.calories) || 0;
      }
    }

    total_protein = Math.round(total_protein * 10) / 10;
    total_calories = Math.round(total_calories);

    const target_p = state.target_protein || DEFAULT_TARGETS.protein_target;
    const target_c = state.target_calories || DEFAULT_TARGETS.calorie_target;

    const remaining_protein = Math.max(0, Math.round((target_p - total_protein) * 10) / 10);
    const remaining_calories = Math.max(0, target_c - total_calories);

    const pct_protein = Math.min(100, Math.round((total_protein / target_p) * 100));
    const pct_calories = Math.min(100, Math.round((total_calories / target_c) * 100));

    return {
      total_protein,
      total_calories,
      remaining_protein,
      remaining_calories,
      pct_protein,
      pct_calories,
      target_protein: target_p,
      target_calories: target_c,
    };
  }

  let activeModalDate = null;

  function openNutritionModal(date) {
    activeModalDate = date || (typeof dailyCurrentDate === 'function' ? dailyCurrentDate() : new Date().toISOString().slice(0, 10));
    renderNutritionSheet();
  }

  function closeNutritionModal() {
    activeModalDate = null;
    const overlay = document.getElementById('daily-nutrition-overlay');
    if (overlay) overlay.remove();
  }

  function renderNutritionSheet() {
    if (!activeModalDate) return;
    let overlay = document.getElementById('daily-nutrition-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'daily-nutrition-overlay';
      overlay.className = 'sheet-overlay';
      document.body.appendChild(overlay);
    }

    const state = getNutritionState(activeModalDate);
    const totals = calculateTotals(state);

    overlay.innerHTML = `
      <div class="sheet nutrition-sheet" role="dialog" aria-modal="true" aria-label="Nutrition and Macros">
        <div class="sheet-head">
          <div>
            <span class="sheet-kicker">Nutrition &amp; Macros</span>
            <span class="nutrition-goal-tag">Lean bulk target: ${totals.target_protein}g · ${totals.target_calories} kcal</span>
          </div>
          <button type="button" class="sheet-x" id="nutrition-close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="sheet-body nutrition-body">
          <div class="nutrition-summary-card">
            <div class="macro-metric">
              <div class="macro-metric-head">
                <span class="macro-name">Protein</span>
                <span class="macro-val mono">${totals.total_protein} / ${totals.target_protein}g</span>
              </div>
              <div class="macro-bar-track">
                <div class="macro-bar-fill is-protein" style="width: ${totals.pct_protein}%"></div>
              </div>
              <span class="macro-sub mono">${totals.remaining_protein > 0 ? totals.remaining_protein + 'g remaining' : 'Target reached'}</span>
            </div>

            <div class="macro-metric">
              <div class="macro-metric-head">
                <span class="macro-name">Calories</span>
                <span class="macro-val mono">${totals.total_calories} / ${totals.target_calories} kcal</span>
              </div>
              <div class="macro-bar-track">
                <div class="macro-bar-fill is-calories" style="width: ${totals.pct_calories}%"></div>
              </div>
              <span class="macro-sub mono">${totals.remaining_calories > 0 ? totals.remaining_calories + ' kcal remaining' : 'Calorie target met'}</span>
            </div>
          </div>

          <div class="nutrition-meals-list">
            ${['breakfast', 'lunch', 'dinner', 'snacks'].map((mealKey) => renderMealSection(mealKey, state)).join('')}
          </div>
        </div>
      </div>
    `;

    wireNutritionSheetEvents(overlay, state);
  }

  function renderMealSection(mealKey, state) {
    const mealNames = {
      breakfast: 'Breakfast',
      lunch: 'Lunch',
      dinner: 'Dinner',
      snacks: 'Snacks & Shakes',
    };
    const items = (state.meals && state.meals[mealKey]) || [];
    let mealPro = 0;
    let mealCal = 0;
    items.forEach((it) => {
      mealPro += Number(it.protein) || 0;
      mealCal += Number(it.calories) || 0;
    });
    mealPro = Math.round(mealPro * 10) / 10;
    mealCal = Math.round(mealCal);

    return `
      <section class="meal-block" data-meal="${mealKey}">
        <div class="meal-head">
          <div class="meal-title-wrap">
            <span class="meal-name">${mealNames[mealKey]}</span>
            <span class="meal-meta mono">${mealPro}g pro · ${mealCal} kcal</span>
          </div>
          <button type="button" class="meal-add-btn" data-action="toggle-add" data-meal="${mealKey}">+ Add food</button>
        </div>

        <div class="meal-add-panel is-hidden" id="add-panel-${mealKey}">
          <div class="add-preset-row">
            <label class="field-label" for="preset-select-${mealKey}">Verified preset</label>
            <div class="preset-controls">
              <select class="food-select" id="preset-select-${mealKey}">
                <option value="">Select food or egg size...</option>
                ${NUTRITION_PRESETS.map((p) => `<option value="${p.id}">${p.label} (${p.protein}g pro · ${p.calories} kcal)</option>`).join('')}
              </select>
              <input type="number" class="food-qty-input mono" id="preset-qty-${mealKey}" value="1" min="1" max="20" placeholder="Qty">
              <button type="button" class="btn-sub-action" data-action="add-preset" data-meal="${mealKey}">Add</button>
            </div>
          </div>

          <div class="add-custom-row">
            <span class="field-label">Custom food</span>
            <div class="custom-inputs">
              <input type="text" class="custom-name" id="custom-name-${mealKey}" placeholder="Food name (e.g. Protein bar)">
              <input type="number" class="custom-num mono" id="custom-pro-${mealKey}" placeholder="Protein (g)" step="0.5" min="0">
              <input type="number" class="custom-num mono" id="custom-cal-${mealKey}" placeholder="Calories" min="0">
              <button type="button" class="btn-sub-action" data-action="add-custom" data-meal="${mealKey}">Save</button>
            </div>
          </div>
        </div>

        <div class="meal-items-list">
          ${items.length === 0 ? `<p class="meal-empty">No items logged yet</p>` : ''}
          ${items
            .map(
              (item, idx) => `
            <div class="logged-food-row">
              <span class="food-desc">${escapeHtml(item.name)}${item.qty && item.qty > 1 ? ` &times; ${item.qty}` : ''}</span>
              <span class="food-macros mono">${item.protein}g · ${item.calories} kcal</span>
              <button type="button" class="food-del-btn" data-action="del-item" data-meal="${mealKey}" data-index="${idx}" aria-label="Remove item">&times;</button>
            </div>
          `
            )
            .join('')}
        </div>
      </section>
    `;
  }

  function wireNutritionSheetEvents(overlay, state) {
    const closeBtn = document.getElementById('nutrition-close-btn');
    if (closeBtn) closeBtn.onclick = closeNutritionModal;

    overlay.onclick = function (e) {
      if (e.target === overlay) closeNutritionModal();
    };

    overlay.querySelectorAll('[data-action="toggle-add"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const panel = document.getElementById('add-panel-' + mealKey);
        if (panel) {
          const isHidden = panel.classList.contains('is-hidden');
          panel.classList.toggle('is-hidden', !isHidden);
          btn.textContent = isHidden ? 'Cancel' : '+ Add food';
        }
      };
    });

    overlay.querySelectorAll('[data-action="add-preset"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const select = document.getElementById('preset-select-' + mealKey);
        const qtyInput = document.getElementById('preset-qty-' + mealKey);
        const presetId = select ? select.value : '';
        const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;

        if (!presetId) return;
        const preset = NUTRITION_PRESETS.find((p) => p.id === presetId);
        if (!preset) return;

        state.meals[mealKey] = state.meals[mealKey] || [];
        state.meals[mealKey].push({
          id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: preset.label,
          qty: qty,
          protein: Math.round(preset.protein * qty * 10) / 10,
          calories: Math.round(preset.calories * qty),
        });

        saveNutritionState(state);
        renderNutritionSheet();
      };
    });

    overlay.querySelectorAll('[data-action="add-custom"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const nameInput = document.getElementById('custom-name-' + mealKey);
        const proInput = document.getElementById('custom-pro-' + mealKey);
        const calInput = document.getElementById('custom-cal-' + mealKey);

        const name = nameInput ? nameInput.value.trim() : '';
        const pro = proInput ? parseFloat(proInput.value) || 0 : 0;
        const cal = calInput ? parseFloat(calInput.value) || 0 : 0;

        if (!name) return;

        state.meals[mealKey] = state.meals[mealKey] || [];
        state.meals[mealKey].push({
          id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: name,
          qty: 1,
          protein: Math.round(pro * 10) / 10,
          calories: Math.round(cal),
        });

        saveNutritionState(state);
        renderNutritionSheet();
      };
    });

    overlay.querySelectorAll('[data-action="del-item"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const idx = parseInt(btn.dataset.index, 10);
        if (state.meals && state.meals[mealKey]) {
          state.meals[mealKey].splice(idx, 1);
          saveNutritionState(state);
          renderNutritionSheet();
        }
      };
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Export module to global scope
  window.NUTRITION = {
    getNutritionState,
    saveNutritionState,
    calculateTotals,
    openNutritionModal,
    closeNutritionModal,
    DEFAULT_TARGETS,
    NUTRITION_PRESETS,
  };
})();
