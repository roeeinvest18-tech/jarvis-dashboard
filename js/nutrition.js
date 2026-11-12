// nutrition.js - Jarvis OS Nutrition & Macro Hub
// Lean bulk target: 165g protein / 3,050 kcal with custom, verified, searchable food tracking.
// Fully cross-device synchronized via Jarvis Personal OS /daily sync endpoint.

(function () {
  'use strict';

  const DEFAULT_TARGETS = {
    protein_target: 165,
    calorie_target: 3050,
  };

  const NUTRITION_PRESETS = [
    // --- Eggs & Dairy (Breakfast, Dinner, Snacks) ---
    { id: 'egg_m', label: 'Egg (Medium - M)', protein: 6.3, calories: 68, unit: 'unit', meals: ['breakfast', 'dinner'], aliases: ['egg', 'beitza', '\u05d1\u05d9\u05e6\u05d4', 'm'] },
    { id: 'egg_l', label: 'Egg (Large - L)', protein: 7.2, calories: 76, unit: 'unit', meals: ['breakfast', 'dinner'], aliases: ['egg', 'beitza', '\u05d1\u05d9\u05e6\u05d4', 'l'] },
    { id: 'egg_xl', label: 'Egg (XL)', protein: 8.1, calories: 86, unit: 'unit', meals: ['breakfast', 'dinner'], aliases: ['egg', 'beitza', '\u05d1\u05d9\u05e6\u05d4', 'xl'] },
    { id: 'egg_whites', label: 'Egg whites (100g)', protein: 11.0, calories: 52, unit: '100g', meals: ['breakfast', 'dinner'], aliases: ['whites', 'egg', 'helmon', 'helbon', '\u05d7\u05dc\u05d1\u05d5\u05df'] },
    { id: 'cottage_100', label: 'Cottage cheese 5% (100g)', protein: 11.0, calories: 95, unit: '100g', meals: ['breakfast', 'dinner'], aliases: ['cottage', 'cheese', 'gvinah', '\u05e7\u05d5\u05d8\u05d2\''] },
    { id: 'cottage_tub', label: 'Cottage cheese 5% (250g tub)', protein: 27.5, calories: 237, unit: 'tub', meals: ['breakfast', 'dinner'], aliases: ['cottage', 'cheese', 'gvinah', '\u05e7\u05d5\u05d8\u05d2\''] },
    { id: 'pro_yogurt_20', label: 'Pro yogurt cup (20g pro)', protein: 20.0, calories: 125, unit: 'cup', meals: ['breakfast', 'snacks'], aliases: ['pro', 'yogurt', 'yoplait', 'danone', 'madan', '\u05e4\u05e8\u05d5', '\u05de\u05e2\u05d3\u05df'] },
    { id: 'pro_yogurt_25', label: 'Pro yogurt cup (25g pro)', protein: 25.0, calories: 150, unit: 'cup', meals: ['breakfast', 'snacks'], aliases: ['pro', 'yogurt', 'yoplait', 'danone', 'madan', '\u05e4\u05e8\u05d5', '\u05de\u05e2\u05d3\u05df'] },
    { id: 'greek_0', label: 'Greek yogurt 0% (200g)', protein: 20.0, calories: 114, unit: '200g', meals: ['breakfast', 'dinner', 'snacks'], aliases: ['greek', 'yogurt', 'danone', '\u05d9\u05d5\u05d5\u05e0\u05d9'] },
    { id: 'milk_3_glass', label: 'Cow milk 3% (200ml glass)', protein: 6.4, calories: 120, unit: 'glass', meals: ['breakfast', 'snacks'], aliases: ['milk', 'chalav', '\u05d7\u05dc\u05d1'] },
    { id: 'soy_milk_glass', label: 'Soy / Alpro milk (200ml)', protein: 6.0, calories: 80, unit: 'glass', meals: ['breakfast', 'snacks'], aliases: ['soy', 'milk', 'alpro', 'soya', '\u05e1\u05d5\u05d9\u05d4'] },

    // --- Breads & Grains (Breakfast, Lunch, Dinner) ---
    { id: 'white_bread_slice', label: 'White bread (1 slice)', protein: 2.7, calories: 79, unit: 'slice', meals: ['breakfast', 'lunch', 'dinner'], aliases: ['bread', 'white', 'toast', 'lechem', '\u05dc\u05d7\u05dd'] },
    { id: 'wheat_bread_slice', label: 'Whole wheat bread (1 slice)', protein: 3.8, calories: 85, unit: 'slice', meals: ['breakfast', 'lunch', 'dinner'], aliases: ['bread', 'wheat', 'whole', 'lechem', 'male', '\u05dc\u05d7\u05dd \u05de\u05dc\u05d0'] },
    { id: 'pita_bread', label: 'Pita bread (1 standard 80g)', protein: 7.5, calories: 220, unit: 'pita', meals: ['breakfast', 'lunch', 'dinner'], aliases: ['pita', 'bread', 'pitah', '\u05e4\u05d9\u05ea\u05d4'] },
    { id: 'bagel', label: 'Plain bagel (1 bagel ~95g)', protein: 10.0, calories: 260, unit: 'bagel', meals: ['breakfast', 'lunch'], aliases: ['bagel', 'bread', '\u05d1\u05d9\u05d9\u05d2\u05dc'] },
    { id: 'oats_50', label: 'Rolled oats (50g dry)', protein: 6.5, calories: 190, unit: '50g', meals: ['breakfast', 'snacks'], aliases: ['oats', 'porridge', 'kvaker', '\u05e9\u05d5\u05e2\u05dc\u05d9\u05ea', '\u05e7\u05d5\u05d5\u05d0\u05e7\u05e8'] },
    { id: 'oats_80', label: 'Rolled oats (80g dry)', protein: 10.4, calories: 304, unit: '80g', meals: ['breakfast', 'snacks'], aliases: ['oats', 'porridge', 'kvaker', '\u05e9\u05d5\u05e2\u05dc\u05d9\u05ea', '\u05e7\u05d5\u05d5\u05d0\u05e7\u05e8'] },
    { id: 'rice_cooked_150', label: 'White rice cooked (150g)', protein: 4.0, calories: 195, unit: '150g', meals: ['lunch', 'dinner'], aliases: ['rice', 'white', 'orez', '\u05d0\u05d5\u05e8\u05d6'] },
    { id: 'rice_cooked_250', label: 'White rice cooked (250g)', protein: 6.7, calories: 325, unit: '250g', meals: ['lunch', 'dinner'], aliases: ['rice', 'white', 'orez', '\u05d0\u05d5\u05e8\u05d6'] },
    { id: 'pasta_cooked_150', label: 'Pasta cooked (150g)', protein: 8.5, calories: 235, unit: '150g', meals: ['lunch', 'dinner'], aliases: ['pasta', 'spaghetti', 'itriyot', '\u05e4\u05e1\u05d8\u05d4'] },
    { id: 'sweet_potato_150', label: 'Baked sweet potato (150g)', protein: 3.0, calories: 135, unit: '150g', meals: ['lunch', 'dinner'], aliases: ['sweet potato', 'batata', '\u05d1\u05d8\u05d8\u05d4'] },

    // --- Meats & Fish (Lunch, Dinner) ---
    { id: 'chicken_100', label: 'Chicken breast cooked (100g)', protein: 31.0, calories: 165, unit: '100g', meals: ['lunch', 'dinner'], aliases: ['chicken', 'breast', 'of', 'hazeh', '\u05e2\u05d5\u05e3', '\u05d7\u05d6\u05d4 \u05e2\u05d5\u05e3'] },
    { id: 'chicken_150', label: 'Chicken breast cooked (150g)', protein: 46.5, calories: 248, unit: '150g', meals: ['lunch', 'dinner'], aliases: ['chicken', 'breast', 'of', 'hazeh', '\u05e2\u05d5\u05e3', '\u05d7\u05d6\u05d4 \u05e2\u05d5\u05e3'] },
    { id: 'chicken_200', label: 'Chicken breast cooked (200g)', protein: 62.0, calories: 330, unit: '200g', meals: ['lunch', 'dinner'], aliases: ['chicken', 'breast', 'of', 'hazeh', '\u05e2\u05d5\u05e3', '\u05d7\u05d6\u05d4 \u05e2\u05d5\u05e3'] },
    { id: 'beef_100', label: 'Lean beef mince cooked (100g)', protein: 26.0, calories: 137, unit: '100g', meals: ['lunch', 'dinner'], aliases: ['beef', 'meat', 'basar', 'takhun', '\u05d1\u05e9\u05e8'] },
    { id: 'beef_150', label: 'Lean beef mince cooked (150g)', protein: 39.0, calories: 206, unit: '150g', meals: ['lunch', 'dinner'], aliases: ['beef', 'meat', 'basar', '\u05d1\u05e9\u05e8'] },
    { id: 'salmon_150', label: 'Salmon fillet cooked (150g)', protein: 34.0, calories: 310, unit: 'fillet', meals: ['lunch', 'dinner'], aliases: ['salmon', 'fish', 'dag', '\u05e1\u05dc\u05de\u05d5\u05df', '\u05d3\u05d2'] },
    { id: 'tuna_can', label: 'Canned tuna in water (112g)', protein: 28.0, calories: 120, unit: 'can', meals: ['lunch', 'dinner', 'breakfast'], aliases: ['tuna', 'fish', 'tuna can', '\u05d8\u05d5\u05e0\u05d4'] },

    // --- Fruits, Snacks & Extras (Snacks, Breakfast, Lunch, Dinner) ---
    { id: 'banana_med', label: 'Banana (1 medium ~118g)', protein: 1.3, calories: 105, unit: 'unit', meals: ['breakfast', 'snacks'], aliases: ['banana', 'fruit', 'peri', '\u05d1\u05e0\u05e0\u05d4'] },
    { id: 'banana_large', label: 'Banana (1 large ~136g)', protein: 1.6, calories: 121, unit: 'unit', meals: ['breakfast', 'snacks'], aliases: ['banana', 'fruit', 'peri', '\u05d1\u05e0\u05e0\u05d4'] },
    { id: 'apple_med', label: 'Apple (1 medium ~182g)', protein: 0.5, calories: 95, unit: 'unit', meals: ['snacks', 'breakfast'], aliases: ['apple', 'tapuach', 'fruit', '\u05ea\u05e4\u05d5\u05d7'] },
    { id: 'whey_scoop', label: 'Whey protein scoop (30g)', protein: 24.0, calories: 120, unit: 'scoop', meals: ['breakfast', 'snacks'], aliases: ['whey', 'protein', 'shake', 'avka', '\u05d7\u05dc\u05d1\u05d5\u05df', '\u05d0\u05d1\u05e7\u05d4'] },
    { id: 'protein_bar', label: 'Protein bar (standard ~60g)', protein: 20.0, calories: 210, unit: 'bar', meals: ['snacks'], aliases: ['bar', 'protein bar', 'snack', '\u05d7\u05d8\u05d9\u05e3 \u05d7\u05dc\u05d1\u05d5\u05df'] },
    { id: 'peanut_butter', label: 'Peanut butter (30g / 2 tbsp)', protein: 8.0, calories: 190, unit: '30g', meals: ['breakfast', 'snacks'], aliases: ['peanut', 'butter', 'botnim', '\u05d7\u05de\u05d0\u05ea \u05d1\u05d5\u05d8\u05e0\u05d9\u05dd'] },
    { id: 'almonds_30', label: 'Almonds (30g / handful)', protein: 6.0, calories: 170, unit: '30g', meals: ['snacks', 'breakfast'], aliases: ['almonds', 'nuts', 'shkedim', '\u05e9\u05e7\u05d3\u05d9\u05dd'] },
    { id: 'avocado_half', label: 'Avocado (half ~100g)', protein: 2.0, calories: 160, unit: 'half', meals: ['breakfast', 'lunch', 'dinner'], aliases: ['avocado', '\u05d0\u05d1\u05d5\u05e7\u05d3\u05d5'] },
    { id: 'olive_oil_tbsp', label: 'Olive oil (1 tbsp / 14g)', protein: 0.0, calories: 119, unit: 'tbsp', meals: ['lunch', 'dinner'], aliases: ['olive', 'oil', 'shemen', 'zayit', '\u05e9\u05de\u05df \u05d6\u05d9\u05ea'] },
  ];

  function getStorageKey(date) {
    return 'jarvis:nutrition:' + date;
  }

  function getNutritionState(date) {
    // 1. Check DAILY day record first (cloud synced state)
    try {
      if (typeof DAILY !== 'undefined' && typeof DAILY.getDay === 'function') {
        const record = DAILY.getDay(date);
        if (record && record.nutrition && record.nutrition.meals) {
          try {
            localStorage.setItem(getStorageKey(date), JSON.stringify(record.nutrition));
          } catch (e) {}
          return record.nutrition;
        }
      }
    } catch (e) {
      // ignore
    }

    // 2. Check local storage fallback
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
    // 1. Save to local storage for instant offline access
    try {
      localStorage.setItem(getStorageKey(state.date), JSON.stringify(state));
    } catch (e) {
      // ignore
    }

    // 2. Embed into DAILY day record and push through cross-device sync
    try {
      if (typeof DAILY !== 'undefined' && typeof DAILY.getDay === 'function' && typeof DAILY.saveDay === 'function') {
        const record = DAILY.getDay(state.date);
        const totals = calculateTotals(state);

        // Attach full nutrition state
        record.nutrition = state;
        record.updated_at = new Date().toISOString();

        if (state.meals.breakfast && state.meals.breakfast.length > 0) {
          record.breakfast = true;
        }
        if (state.meals.dinner && state.meals.dinner.length > 0) {
          record.dinner = true;
        }
        if (totals.total_protein >= state.target_protein) {
          record.protein_target_met = true;
        }

        DAILY.saveDay(state.date, record);

        if (typeof renderDailyToday === 'function') {
          renderDailyToday();
        }

        // Trigger sync immediately so other devices receive the changes
        if (typeof dailyTriggerSync === 'function') {
          dailyTriggerSync();
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Automatic migration on load: migrate any local nutrition data into DAILY so it syncs immediately
  function syncLocalNutritionWithDaily() {
    try {
      if (typeof DAILY === 'undefined' || typeof DAILY.getDay !== 'function' || typeof DAILY.saveDay !== 'function') return;
      let changed = false;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('jarvis:nutrition:')) {
          const date = key.replace('jarvis:nutrition:', '');
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.meals) {
              const record = DAILY.getDay(date);
              const hasRecordMeals = record.nutrition && record.nutrition.meals &&
                Object.values(record.nutrition.meals).some(m => m && m.length > 0);
              const hasLocalMeals = Object.values(parsed.meals).some(m => m && m.length > 0);

              if (!hasRecordMeals && hasLocalMeals) {
                record.nutrition = parsed;
                record.updated_at = new Date().toISOString();
                DAILY.saveDay(date, record);
                changed = true;
              }
            }
          } catch (err) {}
        }
      }
      if (changed && typeof dailyTriggerSync === 'function') {
        dailyTriggerSync();
      }
    } catch (e) {}
  }

  // Run migration on script load and DOMContentLoaded
  syncLocalNutritionWithDaily();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', syncLocalNutritionWithDaily);
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
  // State for which meal panel is currently showing "all foods" instead of recommended
  const mealFilterScope = {
    breakfast: 'recommended',
    lunch: 'recommended',
    dinner: 'recommended',
    snacks: 'recommended',
  };
  // Search query state per meal
  const mealSearchQuery = {
    breakfast: '',
    lunch: '',
    dinner: '',
    snacks: '',
  };
  // Active edit state: { mealKey, index }
  let activeEditingItem = null;

  function openNutritionModal(date) {
    activeModalDate = date || (typeof dailyCurrentDate === 'function' ? dailyCurrentDate() : new Date().toISOString().slice(0, 10));
    renderNutritionSheet();
  }

  function closeNutritionModal() {
    activeModalDate = null;
    activeEditingItem = null;
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

    const syncCfg = (typeof DAILY !== 'undefined' && typeof DAILY.syncConfig === 'function')
      ? DAILY.syncConfig()
      : { url: '', token: '' };
    const hasSync = Boolean(syncCfg.url && syncCfg.token);

    overlay.innerHTML = `
      <div class="sheet nutrition-sheet" role="dialog" aria-modal="true" aria-label="Nutrition and Macros">
        <div class="sheet-head">
          <div>
            <span class="sheet-kicker">Nutrition &amp; Macros</span>
            <span class="nutrition-goal-tag">Lean bulk target: ${totals.target_protein}g · ${totals.target_calories} kcal</span>
          </div>
          <div class="nutrition-head-actions">
            <button type="button" class="btn-nutrition-sync" id="nutrition-sync-btn" title="Sync nutrition data with cloud">
              Sync
            </button>
            <button type="button" class="sheet-x" id="nutrition-close-btn" aria-label="Close">&times;</button>
          </div>
        </div>

        <div class="sheet-body nutrition-body">
          ${!hasSync ? `
            <div class="nutrition-sync-warning">
              <div class="sync-warning-text">
                Notice: Cloud sync is not configured on this device yet. Configure it below to sync seamlessly with your computer.
              </div>
              <button type="button" class="btn-sub-action btn-inline-sync-toggle" id="btn-toggle-inline-sync" style="margin-top: 6px;">
                Configure Cloud Sync
              </button>
              <div class="inline-sync-box is-hidden" id="inline-sync-box" style="margin-top: 8px;">
                <input type="url" id="inline-sync-url" class="custom-name" placeholder="https://your-app.up.railway.app" style="width: 100%; margin-bottom: 6px; font-size: 13px;">
                <input type="password" id="inline-sync-token" class="custom-name" placeholder="Sync Bearer Token" style="width: 100%; margin-bottom: 6px; font-size: 13px;">
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="btn-sub-action is-save-edit" id="btn-save-inline-sync">Save &amp; Sync Now</button>
                  <button type="button" class="btn-sub-action is-cancel-edit" id="btn-cancel-inline-sync">Cancel</button>
                </div>
              </div>
            </div>
          ` : ''}

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

  function filterPresetsForMeal(mealKey) {
    const scope = mealFilterScope[mealKey] || 'recommended';
    const query = (mealSearchQuery[mealKey] || '').trim().toLowerCase();

    return NUTRITION_PRESETS.filter((p) => {
      // Scope filter (recommended vs all)
      if (scope === 'recommended' && !query) {
        if (!p.meals.includes(mealKey)) return false;
      }

      // Query filter
      if (!query) return true;

      const labelMatch = p.label.toLowerCase().includes(query);
      const aliasMatch = (p.aliases || []).some((a) => a.toLowerCase().includes(query));
      return labelMatch || aliasMatch;
    });
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

    const filteredPresets = filterPresetsForMeal(mealKey);
    const scope = mealFilterScope[mealKey] || 'recommended';
    const currentQuery = mealSearchQuery[mealKey] || '';

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
          <!-- Search & Filter Controls -->
          <div class="food-search-row">
            <input type="search" class="food-search-input" id="search-input-${mealKey}" placeholder="Search food (banana, bread, egg, pro...)" value="${escapeHtml(currentQuery)}">
            <div class="food-scope-pills">
              <button type="button" class="scope-pill ${scope === 'recommended' ? 'is-active' : ''}" data-action="set-scope" data-meal="${mealKey}" data-scope="recommended">
                Recommended for ${mealNames[mealKey].split(' ')[0]}
              </button>
              <button type="button" class="scope-pill ${scope === 'all' ? 'is-active' : ''}" data-action="set-scope" data-meal="${mealKey}" data-scope="all">
                All foods (${NUTRITION_PRESETS.length})
              </button>
            </div>
          </div>

          <!-- Preset selector -->
          <div class="add-preset-row">
            <label class="field-label" for="preset-select-${mealKey}">Verified food item</label>
            <div class="preset-controls">
              <select class="food-select" id="preset-select-${mealKey}">
                <option value="">${filteredPresets.length > 0 ? 'Select a food to autofill & customize...' : 'No matches found - enter custom below'}</option>
                ${filteredPresets.map((p) => `<option value="${p.id}" data-pro="${p.protein}" data-cal="${p.calories}" data-name="${escapeHtml(p.label)}">${p.label} (${p.protein}g pro · ${p.calories} kcal)</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Editable parameters before adding -->
          <div class="add-custom-row">
            <span class="field-label">Custom / Edit details before adding:</span>
            <div class="custom-inputs">
              <input type="text" class="custom-name" id="item-name-${mealKey}" placeholder="Food name (e.g. Pro yogurt / Banana)">
              <div class="custom-num-wrap">
                <label class="input-sub-label">Protein (g)</label>
                <input type="number" class="custom-num mono" id="item-pro-${mealKey}" placeholder="Protein (g)" step="0.5" min="0">
              </div>
              <div class="custom-num-wrap">
                <label class="input-sub-label">Calories</label>
                <input type="number" class="custom-num mono" id="item-cal-${mealKey}" placeholder="Calories" min="0">
              </div>
              <div class="custom-num-wrap">
                <label class="input-sub-label">Qty</label>
                <input type="number" class="custom-num mono qty-box" id="item-qty-${mealKey}" value="1" min="1" max="20">
              </div>
              <button type="button" class="btn-sub-action btn-add-confirm" data-action="confirm-add" data-meal="${mealKey}">+ Add to ${mealNames[mealKey]}</button>
            </div>
          </div>
        </div>

        <div class="meal-items-list">
          ${items.length === 0 ? `<p class="meal-empty">No items logged yet</p>` : ''}
          ${items
            .map((item, idx) => {
              const isEditing = activeEditingItem && activeEditingItem.mealKey === mealKey && activeEditingItem.index === idx;
              if (isEditing) {
                return `
                  <div class="logged-food-edit-box" id="edit-box-${mealKey}-${idx}">
                    <div class="custom-inputs">
                      <input type="text" class="custom-name" id="edit-name-${mealKey}-${idx}" value="${escapeHtml(item.name)}">
                      <div class="custom-num-wrap">
                        <label class="input-sub-label">Pro (g)</label>
                        <input type="number" class="custom-num mono" id="edit-pro-${mealKey}-${idx}" value="${item.protein}" step="0.5">
                      </div>
                      <div class="custom-num-wrap">
                        <label class="input-sub-label">Kcal</label>
                        <input type="number" class="custom-num mono" id="edit-cal-${mealKey}-${idx}" value="${item.calories}">
                      </div>
                      <button type="button" class="btn-sub-action is-save-edit" data-action="save-edit-item" data-meal="${mealKey}" data-index="${idx}">Save</button>
                      <button type="button" class="btn-sub-action is-cancel-edit" data-action="cancel-edit-item">Cancel</button>
                    </div>
                  </div>
                `;
              }
              return `
                <div class="logged-food-row">
                  <span class="food-desc">${escapeHtml(item.name)}${item.qty && item.qty > 1 ? ` &times; ${item.qty}` : ''}</span>
                  <span class="food-macros mono">${item.protein}g · ${item.calories} kcal</span>
                  <div class="food-row-actions">
                    <button type="button" class="food-edit-btn" data-action="edit-item" data-meal="${mealKey}" data-index="${idx}" aria-label="Edit item">Edit</button>
                    <button type="button" class="food-del-btn" data-action="del-item" data-meal="${mealKey}" data-index="${idx}" aria-label="Remove item">&times;</button>
                  </div>
                </div>
              `;
            })
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

    // Inline Sync Configuration
    const toggleSyncBtn = document.getElementById('btn-toggle-inline-sync');
    const syncBox = document.getElementById('inline-sync-box');
    const cancelSyncBtn = document.getElementById('btn-cancel-inline-sync');
    const saveSyncBtn = document.getElementById('btn-save-inline-sync');

    if (toggleSyncBtn && syncBox) {
      toggleSyncBtn.onclick = function () {
        const isHidden = syncBox.classList.contains('is-hidden');
        syncBox.classList.toggle('is-hidden', !isHidden);
        toggleSyncBtn.textContent = isHidden ? 'Hide Sync Settings' : 'Configure Cloud Sync';
        if (isHidden) {
          const cfg = (typeof DAILY !== 'undefined' && typeof DAILY.syncConfig === 'function') ? DAILY.syncConfig() : { url: '', token: '' };
          const uInput = document.getElementById('inline-sync-url');
          const tInput = document.getElementById('inline-sync-token');
          if (uInput && cfg.url) uInput.value = cfg.url;
          if (tInput && cfg.token) tInput.value = cfg.token;
          if (uInput) uInput.focus();
        }
      };
    }

    if (cancelSyncBtn && syncBox && toggleSyncBtn) {
      cancelSyncBtn.onclick = function () {
        syncBox.classList.add('is-hidden');
        toggleSyncBtn.textContent = 'Configure Cloud Sync';
      };
    }

    if (saveSyncBtn) {
      saveSyncBtn.onclick = function () {
        const uInput = document.getElementById('inline-sync-url');
        const tInput = document.getElementById('inline-sync-token');
        const url = uInput ? uInput.value.trim() : '';
        const token = tInput ? tInput.value.trim() : '';
        if (!url || !token) {
          alert('Please enter both the Sync URL and Token.');
          return;
        }
        saveSyncBtn.disabled = true;
        saveSyncBtn.textContent = 'Saving...';
        if (typeof DAILY !== 'undefined' && typeof DAILY.saveSyncConfig === 'function') {
          DAILY.saveSyncConfig(url, token);
          DAILY.syncWithServer().finally(() => {
            renderNutritionSheet();
            if (typeof renderDailyToday === 'function') renderDailyToday();
          });
        }
      };
    }

    // Sync button
    const syncBtn = document.getElementById('nutrition-sync-btn');
    if (syncBtn) {
      syncBtn.onclick = function () {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Syncing...';
        if (typeof DAILY !== 'undefined' && typeof DAILY.syncWithServer === 'function') {
          DAILY.syncWithServer().then((res) => {
            syncBtn.textContent = res ? 'Synced' : 'No connection';
            setTimeout(() => {
              renderNutritionSheet();
              if (typeof renderDailyToday === 'function') renderDailyToday();
            }, 600);
          }).catch(() => {
            syncBtn.disabled = false;
            syncBtn.textContent = 'Retry sync';
          });
        } else {
          syncBtn.textContent = 'Sync unavailable';
        }
      };
    }

    // Toggle add panel
    overlay.querySelectorAll('[data-action="toggle-add"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const panel = document.getElementById('add-panel-' + mealKey);
        if (panel) {
          const isHidden = panel.classList.contains('is-hidden');
          panel.classList.toggle('is-hidden', !isHidden);
          btn.textContent = isHidden ? 'Cancel' : '+ Add food';
          if (isHidden) {
            const searchInput = document.getElementById('search-input-' + mealKey);
            if (searchInput) searchInput.focus();
          }
        }
      };
    });

    // Scope pills: recommended vs all
    overlay.querySelectorAll('[data-action="set-scope"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const scope = btn.dataset.scope;
        mealFilterScope[mealKey] = scope;
        renderNutritionSheet();
        // Re-open panel
        const panel = document.getElementById('add-panel-' + mealKey);
        if (panel) panel.classList.remove('is-hidden');
        const toggleBtn = overlay.querySelector(`[data-action="toggle-add"][data-meal="${mealKey}"]`);
        if (toggleBtn) toggleBtn.textContent = 'Cancel';
      };
    });

    // Search input
    overlay.querySelectorAll('.food-search-input').forEach((input) => {
      const mealKey = input.id.replace('search-input-', '');
      input.oninput = function () {
        mealSearchQuery[mealKey] = input.value;
        const select = document.getElementById('preset-select-' + mealKey);
        if (select) {
          const filtered = filterPresetsForMeal(mealKey);
          select.innerHTML = `
            <option value="">${filtered.length > 0 ? 'Select a food to autofill & customize...' : 'No matches found - enter custom below'}</option>
            ${filtered.map((p) => `<option value="${p.id}" data-pro="${p.protein}" data-cal="${p.calories}" data-name="${escapeHtml(p.label)}">${p.label} (${p.protein}g pro · ${p.calories} kcal)</option>`).join('')}
          `;
        }
      };
    });

    // Preset select autofills editable inputs
    overlay.querySelectorAll('.food-select').forEach((select) => {
      const mealKey = select.id.replace('preset-select-', '');
      select.onchange = function () {
        const opt = select.options[select.selectedIndex];
        if (!opt || !opt.value) return;

        const preset = NUTRITION_PRESETS.find((p) => p.id === opt.value);
        if (!preset) return;

        const nameInput = document.getElementById('item-name-' + mealKey);
        const proInput = document.getElementById('item-pro-' + mealKey);
        const calInput = document.getElementById('item-cal-' + mealKey);
        const qtyInput = document.getElementById('item-qty-' + mealKey);

        if (nameInput) nameInput.value = preset.label;
        if (proInput) proInput.value = preset.protein;
        if (calInput) calInput.value = preset.calories;
        if (qtyInput) qtyInput.value = '1';
      };
    });

    // Confirm add button
    overlay.querySelectorAll('[data-action="confirm-add"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const nameInput = document.getElementById('item-name-' + mealKey);
        const proInput = document.getElementById('item-pro-' + mealKey);
        const calInput = document.getElementById('item-cal-' + mealKey);
        const qtyInput = document.getElementById('item-qty-' + mealKey);

        const name = nameInput ? nameInput.value.trim() : '';
        const basePro = proInput ? parseFloat(proInput.value) || 0 : 0;
        const baseCal = calInput ? parseFloat(calInput.value) || 0 : 0;
        const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;

        if (!name) return;

        state.meals[mealKey] = state.meals[mealKey] || [];
        state.meals[mealKey].push({
          id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: name,
          qty: qty,
          protein: Math.round(basePro * qty * 10) / 10,
          calories: Math.round(baseCal * qty),
        });

        saveNutritionState(state);
        renderNutritionSheet();
      };
    });

    // Edit item action
    overlay.querySelectorAll('[data-action="edit-item"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const idx = parseInt(btn.dataset.index, 10);
        activeEditingItem = { mealKey, index: idx };
        renderNutritionSheet();
      };
    });

    // Cancel edit
    overlay.querySelectorAll('[data-action="cancel-edit-item"]').forEach((btn) => {
      btn.onclick = function () {
        activeEditingItem = null;
        renderNutritionSheet();
      };
    });

    // Save edited item
    overlay.querySelectorAll('[data-action="save-edit-item"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const idx = parseInt(btn.dataset.index, 10);
        const nameInput = document.getElementById(`edit-name-${mealKey}-${idx}`);
        const proInput = document.getElementById(`edit-pro-${mealKey}-${idx}`);
        const calInput = document.getElementById(`edit-cal-${mealKey}-${idx}`);

        if (state.meals && state.meals[mealKey] && state.meals[mealKey][idx]) {
          const item = state.meals[mealKey][idx];
          if (nameInput && nameInput.value.trim()) item.name = nameInput.value.trim();
          if (proInput) item.protein = Math.round((parseFloat(proInput.value) || 0) * 10) / 10;
          if (calInput) item.calories = Math.round(parseFloat(calInput.value) || 0);
          activeEditingItem = null;
          saveNutritionState(state);
          renderNutritionSheet();
        }
      };
    });

    // Delete item
    overlay.querySelectorAll('[data-action="del-item"]').forEach((btn) => {
      btn.onclick = function () {
        const mealKey = btn.dataset.meal;
        const idx = parseInt(btn.dataset.index, 10);
        if (state.meals && state.meals[mealKey]) {
          state.meals[mealKey].splice(idx, 1);
          if (activeEditingItem && activeEditingItem.mealKey === mealKey && activeEditingItem.index === idx) {
            activeEditingItem = null;
          }
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
    syncLocalNutritionWithDaily,
    DEFAULT_TARGETS,
    NUTRITION_PRESETS,
  };
})();
