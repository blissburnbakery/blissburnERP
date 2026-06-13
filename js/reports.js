/* ==========================================================================
   BLISSBURN ERP - REPORTS & ANALYTICS (reports.js)
   Date-range filtered reporting computed client-side from BlissburnState.
   ========================================================================== */

// Currency formatter (whole LKR)
function rptMoney(n) {
    return `LKR ${Math.round(n || 0).toLocaleString('en-US')}`;
}

// Estimated cost to make one unit of a product, from its recipe ingredient
// prices. Mirrors dashboard.js so reports don't depend on its load order.
// unitCost is per-kg for ingredients measured in grams, per-piece otherwise.
function rptUnitCost(product) {
    const state = window.BlissburnState;
    if (!product || !product.bom) return 0;
    let cost = 0;
    for (const code in product.bom) {
        const ing = state.ingredients.find(i => i.code === code);
        if (!ing || !ing.unitCost) continue;
        const qty = product.bom[code];
        cost += ing.unit === 'g' ? qty * (ing.unitCost / 1000) : qty * ing.unitCost;
    }
    return cost;
}

/* ---------- Date helpers (work in YYYY-MM-DD strings) ---------- */
function rptToday() {
    return window.BlissburnState.simulatedDate || new Date().toISOString().split('T')[0];
}
function rptParse(s) { return new Date(s + 'T00:00:00'); }
function rptFmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function rptAddDays(s, n) { const d = rptParse(s); d.setDate(d.getDate() + n); return rptFmt(d); }
function rptDaysBetween(a, b) { return Math.round((rptParse(b) - rptParse(a)) / 86400000); }

// Current report range (default: this month) and active preset
window._reportRange = null;

// Compute start/end strings for a named preset, anchored on the simulated date.
function rptPresetRange(preset) {
    const today = rptToday();
    const d = rptParse(today);
    switch (preset) {
        case 'today':
            return { start: today, end: today };
        case 'yesterday': {
            const y = rptAddDays(today, -1);
            return { start: y, end: y };
        }
        case 'week': {
            // Week starts Monday
            const dow = (d.getDay() + 6) % 7; // 0 = Monday
            return { start: rptAddDays(today, -dow), end: today };
        }
        case 'month':
            return { start: rptFmt(new Date(d.getFullYear(), d.getMonth(), 1)), end: today };
        case 'lastmonth': {
            const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            const last = new Date(d.getFullYear(), d.getMonth(), 0);
            return { start: rptFmt(first), end: rptFmt(last) };
        }
        case 'year':
            return { start: rptFmt(new Date(d.getFullYear(), 0, 1)), end: today };
        default:
            return { start: rptFmt(new Date(d.getFullYear(), d.getMonth(), 1)), end: today };
    }
}

// Sellable invoices (excludes voided/refunded), optionally within [start,end].
function rptInvoicesInRange(start, end) {
    return window.BlissburnState.invoices.filter(inv => {
        if (inv.status === 'Voided' || inv.status === 'Refunded') return false;
        if (start && inv.date < start) return false;
        if (end && inv.date > end) return false;
        return true;
    });
}

// Aggregate everything we need for a given range in one pass.
function rptAggregate(start, end) {
    const state = window.BlissburnState;
    const invoices = rptInvoicesInRange(start, end);

    let netSales = 0, cogs = 0, tax = 0, grand = 0, units = 0;
    let b2cSales = 0, b2bSales = 0, b2cOrders = 0, b2bOrders = 0;
    const byMethod = { cash: 0, card: 0, credit: 0 };
    const perProduct = {};   // name -> { units, revenue, cost }
    const perDay = {};       // date -> { b2c, b2b }
    const perCustomer = {};  // name -> { revenue, orders, outstanding }

    invoices.forEach(inv => {
        const isB2B = inv.customerType === 'B2B';
        if (isB2B) b2bOrders++; else b2cOrders++;
        tax += inv.tax || 0;
        grand += inv.grandTotal || 0;
        byMethod[inv.method] = (byMethod[inv.method] || 0) + (inv.grandTotal || 0);

        if (!perDay[inv.date]) perDay[inv.date] = { b2c: 0, b2b: 0 };

        const cust = inv.customerName || (isB2B ? 'Business' : 'Walk-in Customer');
        if (!perCustomer[cust]) perCustomer[cust] = { revenue: 0, orders: 0, outstanding: 0, isB2B };
        perCustomer[cust].orders++;
        perCustomer[cust].outstanding += inv.outstanding || 0;

        (inv.items || []).forEach(it => {
            const unitPrice = isB2B ? (it.wholesalePrice ?? it.retailPrice) : it.retailPrice;
            const lineRev = unitPrice * it.quantity;
            const prod = state.products.find(p => p.name === it.productName);
            const lineCost = (prod ? rptUnitCost(prod) : 0) * it.quantity;

            netSales += lineRev;
            cogs += lineCost;
            units += it.quantity;
            if (isB2B) b2bSales += lineRev; else b2cSales += lineRev;
            perDay[inv.date].b2c += isB2B ? 0 : lineRev;
            perDay[inv.date].b2b += isB2B ? lineRev : 0;
            perCustomer[cust].revenue += lineRev;

            if (!perProduct[it.productName]) perProduct[it.productName] = { units: 0, revenue: 0, cost: 0 };
            perProduct[it.productName].units += it.quantity;
            perProduct[it.productName].revenue += lineRev;
            perProduct[it.productName].cost += lineCost;
        });
    });

    const productRows = Object.keys(perProduct).map(name => {
        const p = perProduct[name];
        return { name, units: p.units, revenue: p.revenue, cost: p.cost, profit: p.revenue - p.cost };
    }).sort((a, b) => b.revenue - a.revenue);

    const customerRows = Object.keys(perCustomer).map(name => ({
        name, ...perCustomer[name]
    })).sort((a, b) => b.revenue - a.revenue);

    return {
        orders: invoices.length, units, netSales, cogs, tax, grand,
        grossProfit: netSales - cogs,
        b2cSales, b2bSales, b2cOrders, b2bOrders,
        byMethod, productRows, customerRows, perDay
    };
}

/* ---------- Rendering ---------- */

window.renderReports = function () {
    // Default range on first entry
    if (!window._reportRange) window._reportRange = rptPresetRange('month');
    const r = window._reportRange;

    // Sync the date inputs
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    if (startInput) startInput.value = r.start;
    if (endInput) endInput.value = r.end;

    bindReportControls();
    renderReportAll();
};

function bindReportControls() {
    document.querySelectorAll('#reportPresetBar [data-range]').forEach(btn => {
        btn.onclick = () => {
            window._reportRange = rptPresetRange(btn.getAttribute('data-range'));
            highlightPreset(btn.getAttribute('data-range'));
            window.renderReports();
        };
    });
    const applyBtn = document.getElementById('reportApplyBtn');
    if (applyBtn) {
        applyBtn.onclick = () => {
            const s = document.getElementById('reportStartDate').value;
            const e = document.getElementById('reportEndDate').value;
            if (!s || !e || s > e) {
                showToast('warning', 'Check the dates', 'Pick a start date that is on or before the end date.');
                return;
            }
            window._reportRange = { start: s, end: e };
            highlightPreset('custom');
            renderReportAll();
        };
    }
}

function highlightPreset(active) {
    document.querySelectorAll('#reportPresetBar [data-range]').forEach(btn => {
        const on = btn.getAttribute('data-range') === active;
        btn.classList.toggle('bg-primary', on);
        btn.classList.toggle('text-on-primary', on);
        btn.classList.toggle('bg-surface-container', !on);
        btn.classList.toggle('text-on-surface-variant', !on);
    });
}

function renderReportAll() {
    const r = window._reportRange;
    const cur = rptAggregate(r.start, r.end);

    // Previous period of equal length, immediately before start
    const len = rptDaysBetween(r.start, r.end) + 1;
    const prevEnd = rptAddDays(r.start, -1);
    const prevStart = rptAddDays(prevEnd, -(len - 1));
    const prev = rptAggregate(prevStart, prevEnd);

    const label = document.getElementById('reportRangeLabel');
    if (label) label.textContent = `${r.start}  →  ${r.end}  (${len} day${len > 1 ? 's' : ''})`;

    renderReportSummary(cur, prev);
    renderReportTrend(cur);
    renderReportByProduct(cur);
    renderReportBreakdown(cur);
    renderReportProduction(r);

    if (window.renderDemandForecast) window.renderDemandForecast('reportForecastBody');
}

// Delta chip vs previous period
function rptDelta(curVal, prevVal) {
    if (!prevVal) return `<span class="text-[11px] text-on-surface-variant">no prior data</span>`;
    const pct = ((curVal - prevVal) / Math.abs(prevVal)) * 100;
    const up = pct >= 0;
    const color = up ? 'text-green-700' : 'text-red-700';
    const icon = up ? 'trending_up' : 'trending_down';
    return `<span class="text-[11px] font-medium ${color} flex items-center gap-0.5">
        <span class="material-symbols-outlined text-xs">${icon}</span>${up ? '+' : ''}${pct.toFixed(0)}% vs prev</span>`;
}

function renderReportSummary(cur, prev) {
    const el = document.getElementById('reportSummary');
    if (!el) return;
    const avgOrder = cur.orders ? cur.netSales / cur.orders : 0;
    const prevAvg = prev.orders ? prev.netSales / prev.orders : 0;
    const margin = cur.netSales ? (cur.grossProfit / cur.netSales) * 100 : 0;

    const card = (label, value, icon, delta) => `
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-4">
            <div class="flex items-center justify-between">
                <p class="text-xs text-on-surface-variant">${label}</p>
                <span class="material-symbols-outlined text-primary text-lg">${icon}</span>
            </div>
            <p class="font-display text-lg font-bold text-on-surface mt-1">${value}</p>
            <div class="mt-1">${delta || ''}</div>
        </div>`;

    el.innerHTML =
        card('Net Sales', rptMoney(cur.netSales), 'payments', rptDelta(cur.netSales, prev.netSales)) +
        card('Orders', String(cur.orders), 'receipt_long', rptDelta(cur.orders, prev.orders)) +
        card('Items Sold', `${cur.units} pcs`, 'shopping_basket', rptDelta(cur.units, prev.units)) +
        card('Avg Order', rptMoney(avgOrder), 'sell', rptDelta(avgOrder, prevAvg)) +
        card('Est. Gross Profit', rptMoney(cur.grossProfit), 'savings', rptDelta(cur.grossProfit, prev.grossProfit)) +
        card('Profit Margin', `${margin.toFixed(0)}%`, 'percent', '') +
        card('VAT Collected', rptMoney(cur.tax), 'account_balance', '') +
        card('Total Billed', rptMoney(cur.grand), 'request_quote', rptDelta(cur.grand, prev.grand));
}

// Stacked SVG bar chart of net sales over the range (auto-bucketed)
function renderReportTrend(cur) {
    const svg = document.getElementById('reportTrendChart');
    if (!svg) return;

    const r = window._reportRange;
    const totalDays = rptDaysBetween(r.start, r.end) + 1;

    // Bucket size: daily / weekly / monthly depending on span
    let buckets = [];
    if (totalDays <= 31) {
        for (let i = 0; i < totalDays; i++) {
            const day = rptAddDays(r.start, i);
            const v = cur.perDay[day] || { b2c: 0, b2b: 0 };
            const dObj = rptParse(day);
            buckets.push({ label: dObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), b2c: v.b2c, b2b: v.b2b });
        }
    } else if (totalDays <= 93) {
        // weekly buckets
        for (let i = 0; i < totalDays; i += 7) {
            const wStart = rptAddDays(r.start, i);
            let b2c = 0, b2b = 0;
            for (let j = 0; j < 7 && (i + j) < totalDays; j++) {
                const day = rptAddDays(r.start, i + j);
                const v = cur.perDay[day]; if (v) { b2c += v.b2c; b2b += v.b2b; }
            }
            buckets.push({ label: rptParse(wStart).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), b2c, b2b });
        }
    } else {
        // monthly buckets
        const map = {};
        Object.keys(cur.perDay).forEach(day => {
            const key = day.slice(0, 7);
            if (!map[key]) map[key] = { b2c: 0, b2b: 0 };
            map[key].b2c += cur.perDay[day].b2c;
            map[key].b2b += cur.perDay[day].b2b;
        });
        Object.keys(map).sort().forEach(key => {
            buckets.push({ label: rptParse(key + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), b2c: map[key].b2c, b2b: map[key].b2b });
        });
    }

    if (buckets.length === 0 || buckets.every(b => b.b2c + b.b2b === 0)) {
        svg.innerHTML = `<text x="300" y="120" text-anchor="middle" fill="#94a3b8" font-size="14">No sales in this period</text>`;
        return;
    }

    const W = 600, H = 240, padX = 50, padY = 30;
    const chartW = W - padX * 2, chartH = H - padY * 2;
    let maxVal = 0;
    buckets.forEach(b => { maxVal = Math.max(maxVal, b.b2c + b.b2b); });
    maxVal = Math.ceil((maxVal || 1) / 1000) * 1000;

    let grid = '';
    for (let i = 0; i <= 4; i++) {
        const gv = (maxVal / 4) * i;
        const y = H - padY - (chartH / 4) * i;
        grid += `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${padX - 8}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${(gv / 1000).toFixed(0)}k</text>`;
    }

    const n = buckets.length;
    const slot = chartW / n;
    const barW = Math.min(36, slot * 0.6);
    let bars = '';
    buckets.forEach((b, idx) => {
        const x = padX + slot * idx + (slot - barW) / 2;
        const total = b.b2c + b.b2b;
        const hC = (b.b2c / maxVal) * chartH;
        const hB = (b.b2b / maxVal) * chartH;
        const yC = H - padY - hC;
        const yB = yC - hB;
        bars += `
            <rect x="${x}" y="${yC}" width="${barW}" height="${hC}" fill="var(--primary-container)" rx="2"><title>Walk-in: ${rptMoney(b.b2c)}</title></rect>
            <rect x="${x}" y="${yB}" width="${barW}" height="${hB}" fill="var(--tertiary)" rx="2"><title>Business: ${rptMoney(b.b2b)}</title></rect>`;
        // x label (skip some if crowded)
        if (n <= 16 || idx % Math.ceil(n / 16) === 0) {
            bars += `<text x="${x + barW / 2}" y="${H - padY + 14}" text-anchor="middle" fill="#94a3b8" font-size="9">${b.label}</text>`;
        }
    });

    svg.innerHTML = `<title>Sales over the selected period</title>${grid}${bars}`;
}

function renderReportByProduct(cur) {
    const body = document.getElementById('reportByProductBody');
    if (!body) return;
    if (cur.productRows.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-on-surface-variant">No product sales in this period.</td></tr>`;
        return;
    }
    body.innerHTML = cur.productRows.map(p => {
        const margin = p.revenue ? (p.profit / p.revenue) * 100 : 0;
        return `<tr class="hover:bg-surface-container/40 transition-colors">
            <td class="px-3 py-2 border-t border-outline-variant/30 font-medium text-on-surface">${p.name}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${p.units}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${rptMoney(p.revenue)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right text-on-surface-variant">${rptMoney(p.cost)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right font-semibold ${p.profit >= 0 ? 'text-green-700' : 'text-red-700'}">${rptMoney(p.profit)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right text-on-surface-variant">${margin.toFixed(0)}%</td>
        </tr>`;
    }).join('');

    const exp = document.getElementById('reportExportProductBtn');
    if (exp) exp.onclick = () => {
        const headers = ['Product', 'Units Sold', 'Revenue (LKR)', 'Est. Cost (LKR)', 'Est. Profit (LKR)', 'Margin %'];
        const rows = cur.productRows.map(p => [p.name, p.units, p.revenue.toFixed(0), p.cost.toFixed(0), p.profit.toFixed(0), (p.revenue ? (p.profit / p.revenue) * 100 : 0).toFixed(1)]);
        window.exportToCSV(headers, rows, `sales_by_product_${window._reportRange.start}_to_${window._reportRange.end}.csv`);
    };
}

function renderReportBreakdown(cur) {
    const el = document.getElementById('reportBreakdown');
    if (!el) return;

    const totalSales = cur.b2cSales + cur.b2bSales || 1;
    const b2cPct = (cur.b2cSales / totalSales) * 100;
    const b2bPct = (cur.b2bSales / totalSales) * 100;
    const methodTotal = (cur.byMethod.cash || 0) + (cur.byMethod.card || 0) + (cur.byMethod.credit || 0) || 1;

    const topCustomers = cur.customerRows.filter(c => c.isB2B).slice(0, 5);

    const methodRow = (label, val, icon) => `
        <div class="flex items-center justify-between text-sm py-1.5">
            <span class="flex items-center gap-2 text-on-surface-variant"><span class="material-symbols-outlined text-base">${icon}</span>${label}</span>
            <span class="font-semibold text-on-surface">${rptMoney(val)} <span class="text-[11px] text-on-surface-variant">(${((val / methodTotal) * 100).toFixed(0)}%)</span></span>
        </div>`;

    el.innerHTML = `
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5">
            <h3 class="font-display font-bold text-on-surface mb-3">Where Sales Came From</h3>
            <div class="flex h-3 rounded-full overflow-hidden mb-2">
                <div class="bg-primary-container" style="width:${b2cPct}%" title="Walk-in"></div>
                <div class="bg-tertiary" style="width:${b2bPct}%" title="Business"></div>
            </div>
            <div class="flex justify-between text-xs text-on-surface-variant mb-4">
                <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-primary-container"></span>Walk-in ${rptMoney(cur.b2cSales)} (${b2cPct.toFixed(0)}%)</span>
                <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-tertiary"></span>Business ${rptMoney(cur.b2bSales)} (${b2bPct.toFixed(0)}%)</span>
            </div>
            <h4 class="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1 mt-4">How Customers Paid</h4>
            ${methodRow('Cash', cur.byMethod.cash || 0, 'payments')}
            ${methodRow('Card', cur.byMethod.card || 0, 'credit_card')}
            ${methodRow('On Account (credit)', cur.byMethod.credit || 0, 'handshake')}
        </div>
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5">
            <h3 class="font-display font-bold text-on-surface mb-3">Top Business Customers</h3>
            ${topCustomers.length === 0
                ? `<p class="text-sm text-on-surface-variant py-4 text-center">No business orders in this period.</p>`
                : topCustomers.map(c => `
                    <div class="flex items-center justify-between py-2 border-b border-outline-variant/20 last:border-none">
                        <div class="min-w-0">
                            <p class="text-sm font-medium text-on-surface truncate">${c.name}</p>
                            <p class="text-[11px] text-on-surface-variant">${c.orders} order${c.orders > 1 ? 's' : ''}${c.outstanding > 0 ? ` · ${rptMoney(c.outstanding)} unpaid` : ''}</p>
                        </div>
                        <span class="font-semibold text-on-surface text-sm">${rptMoney(c.revenue)}</span>
                    </div>`).join('')}
        </div>`;
}

function renderReportProduction(r) {
    const body = document.getElementById('reportProductionBody');
    if (!body) return;
    const state = window.BlissburnState;

    const logs = state.productionLogs.filter(l => l.dateProduced >= r.start && l.dateProduced <= r.end);
    const days = rptDaysBetween(r.start, r.end) + 1;

    const perProduct = {};
    logs.forEach(l => {
        if (!perProduct[l.product]) perProduct[l.product] = 0;
        perProduct[l.product] += l.qty;
    });

    const rows = state.products.map(p => {
        const made = perProduct[p.name] || 0;
        const target = (p.dailyTarget || 0) * days;
        const cost = rptUnitCost(p) * made;
        return { name: p.name, made, target, cost };
    }).filter(row => row.made > 0 || row.target > 0);

    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="px-3 py-6 text-center text-sm text-on-surface-variant">No baking recorded in this period.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(row => {
        const pct = row.target ? Math.min((row.made / row.target) * 100, 999) : 0;
        return `<tr class="hover:bg-surface-container/40 transition-colors">
            <td class="px-3 py-2 border-t border-outline-variant/30 font-medium text-on-surface">${row.name}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${row.made} pcs</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right text-on-surface-variant">${row.target ? row.target + ' pcs' : '—'}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right ${pct >= 100 ? 'text-green-700' : 'text-amber-700'} font-semibold">${row.target ? pct.toFixed(0) + '%' : '—'}</td>
        </tr>`;
    }).join('');
}
