/* ==========================================================================
   BLISSBURN ERP - DEMAND FORECASTING (forecast.js)
   Simple, explainable per-product forecast from recent sales history:
   moving average  ×  day-of-week pattern  ×  recent trend.
   No ML libraries — every factor is inspectable.
   ========================================================================== */

function fcToday() {
    return window.BlissburnState.simulatedDate || new Date().toISOString().split('T')[0];
}
function fcParse(s) { return new Date(s + 'T00:00:00'); }
function fcFmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function fcAddDays(s, n) { const d = fcParse(s); d.setDate(d.getDate() + n); return fcFmt(d); }
function fcMean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// Fresh sellable stock on hand for a product (active, not expired).
function fcFreshStock(productName) {
    const state = window.BlissburnState;
    const today = fcToday();
    return state.productionLogs
        .filter(l => l.product === productName && l.active && l.qty > 0 && l.expiryDate >= today)
        .reduce((sum, l) => sum + l.qty, 0);
}

// Build a daily units-sold series for a product over the lookback window.
// Returns a map { 'YYYY-MM-DD': units } for each day in the window.
function fcDailySeries(productName, lookbackDays) {
    const state = window.BlissburnState;
    const today = fcToday();
    const start = fcAddDays(today, -(lookbackDays - 1));
    const series = {};
    for (let i = 0; i < lookbackDays; i++) series[fcAddDays(start, i)] = 0;

    state.invoices.forEach(inv => {
        if (inv.status === 'Voided' || inv.status === 'Refunded') return;
        if (inv.date < start || inv.date > today) return;
        (inv.items || []).forEach(it => {
            if (it.productName !== productName) return;
            if (series[inv.date] === undefined) series[inv.date] = 0;
            series[inv.date] += it.quantity;
        });
    });
    return series;
}

// Core forecast for one product.
window.computeForecast = function (productName, opts = {}) {
    const lookback = opts.lookback || 56;
    const today = fcToday();
    const series = fcDailySeries(productName, lookback);
    const dates = Object.keys(series).sort();
    const values = dates.map(d => series[d]);

    // How many days of *real* history do we have (first non-zero onwards)?
    const firstSaleIdx = values.findIndex(v => v > 0);
    const dataDays = firstSaleIdx === -1 ? 0 : values.length - firstSaleIdx;

    // Base level = mean of last 28 days (or whatever we have)
    const last28 = values.slice(-28);
    const baseMA = fcMean(last28);

    let limited = dataDays < 14;
    let dowFactor = {}; // 0..6 (Sun..Sat) -> multiplier
    let trendFactor = 1;

    if (!limited) {
        // Day-of-week pattern over the window
        const overallMean = fcMean(values.filter((_, i) => i >= firstSaleIdx)) || baseMA || 1;
        const dowBuckets = {};
        dates.forEach((d, i) => {
            if (i < firstSaleIdx) return;
            const wd = fcParse(d).getDay();
            (dowBuckets[wd] = dowBuckets[wd] || []).push(values[i]);
        });
        for (let wd = 0; wd < 7; wd++) {
            const m = fcMean(dowBuckets[wd] || []);
            dowFactor[wd] = overallMean > 0 ? (m / overallMean) : 1;
            if (!isFinite(dowFactor[wd]) || dowFactor[wd] === 0) dowFactor[wd] = 1;
        }
        // Recent trend: last 14 days vs the 14 before that
        const recent = fcMean(values.slice(-14));
        const prior = fcMean(values.slice(-28, -14));
        if (prior > 0) {
            trendFactor = Math.max(0.5, Math.min(2, recent / prior));
        }
    }

    const forecastFor = (dateStr) => {
        if (limited) return Math.round(baseMA);
        const wd = fcParse(dateStr).getDay();
        return Math.max(0, Math.round(baseMA * (dowFactor[wd] || 1) * trendFactor));
    };

    const tomorrowDate = fcAddDays(today, 1);
    const tomorrow = forecastFor(tomorrowDate);
    let next7 = 0;
    for (let i = 1; i <= 7; i++) next7 += forecastFor(fcAddDays(today, i));

    const stock = fcFreshStock(productName);

    return {
        productName,
        avgDaily: baseMA,
        tomorrow,
        next7,
        suggestToday: Math.max(0, forecastFor(today) - stock),
        suggestTomorrow: Math.max(0, tomorrow - stock),
        stock,
        dataDays,
        limited,
        trendFactor
    };
};

// Convenience for the Production screen hint.
window.suggestedBakeToday = function (productName) {
    try { return window.computeForecast(productName); }
    catch (e) { return null; }
};

// Render the demand-forecast table into a tbody container.
window.renderDemandForecast = function (bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const state = window.BlissburnState;

    if (!state.products || state.products.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-on-surface-variant">No products yet.</td></tr>`;
        return;
    }
    if (!state.invoices || state.invoices.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-on-surface-variant">No sales history yet — forecasts appear once you start recording sales.</td></tr>`;
        return;
    }

    const isAdmin = (sessionStorage.getItem('blissburn_role') === 'admin');

    body.innerHTML = state.products.map(p => {
        const f = window.computeForecast(p.name);
        const limitedTag = f.limited
            ? `<span class="ml-1 text-[10px] text-amber-700" title="Less than 14 days of history — using a simple average">limited data</span>`
            : '';
        const targetCell = (p.dailyTarget || 0);
        const setBtn = isAdmin
            ? `<button class="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-medium text-primary bg-primary-container/20 rounded-lg hover:bg-primary-container/50 transition-colors" onclick="window.applyForecastTarget('${p.id}', ${f.tomorrow})" title="Set this product's daily target to the forecast">
                <span class="material-symbols-outlined text-sm">flag</span> Set target</button>`
            : '';
        return `<tr class="hover:bg-surface-container/40 transition-colors">
            <td class="px-3 py-2 border-t border-outline-variant/30 font-medium text-on-surface">${p.name}${limitedTag}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${f.avgDaily.toFixed(0)} /day</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right font-semibold text-on-surface">${f.tomorrow} pcs</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${f.next7} pcs</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right text-on-surface-variant">on hand: ${f.stock} · target: ${targetCell}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${setBtn}</td>
        </tr>`;
    }).join('');
};

// Admin action: adopt the forecast as the product's daily target.
window.applyForecastTarget = async function (productId, value) {
    if (window.requireOnline && !window.requireOnline('update the target')) return;
    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === productId);
    if (!prod) return;
    const ok = await window.showConfirm({
        title: 'Update daily target',
        message: `Set "${prod.name}" daily baking target to ${value} pcs (based on the forecast)?`,
        confirmText: 'Set target'
    });
    if (!ok) return;
    try {
        await window.apiUpdateProduct(productId, {
            name: prod.name,
            category: prod.category,
            retailPrice: prod.retailPrice,
            wholesalePrice: prod.wholesalePrice,
            shelfLife: prod.shelfLife,
            icon: prod.icon,
            dailyTarget: value,
            bom: prod.bom || {}
        });
        showToast('success', 'Target Updated', `${prod.name} daily target set to ${value} pcs.`);
        if (window.renderDemandForecast) window.renderDemandForecast('reportForecastBody');
    } catch (e) {
        showToast('danger', 'Update Failed', e.message);
    }
};
