/* ==========================================================================
   BLISSBURN ERP - REPORTING DASHBOARD ANALYTICS (dashboard.js)
   ========================================================================== */

// Initialize Dashboard view hook
window.renderDashboard = function() {
    renderDashboardKPICards();
    renderInteractiveSVGRevenueChart();
    renderDailyProductionQuotaGrid();
    renderDashboardStockHealthAlerts();
    renderOperationalTimeline();
    renderSalesReport();
    setupDashboardEventListeners();
};

// Estimated cost to make one unit of a product, from its recipe ingredient prices.
// unitCost is per-kg for ingredients measured in grams, per-piece otherwise.
function estimatedUnitCost(product) {
    const state = window.BlissburnState;
    if (!product.bom) return 0;
    let cost = 0;
    for (const code in product.bom) {
        const ing = state.ingredients.find(i => i.code === code);
        if (!ing || !ing.unitCost) continue;
        const qty = product.bom[code];
        cost += ing.unit === 'g' ? qty * (ing.unitCost / 1000) : qty * ing.unitCost;
    }
    return cost;
}

// Sales report: today's totals + units/revenue/profit per product (all-time)
function computeSalesReport() {
    const state = window.BlissburnState;
    const today = state.simulatedDate;

    const perProduct = {}; // name -> { units, revenue }
    let todayUnits = 0, todayRevenue = 0, todayOrders = 0;

    state.invoices.forEach(inv => {
        if (inv.status === 'Voided' || inv.status === 'Refunded') return;
        const isB2B = inv.customerType === 'B2B';
        const items = inv.items || [];
        if (inv.date === today) todayOrders++;
        items.forEach(it => {
            const unitPrice = isB2B ? (it.wholesalePrice ?? it.retailPrice) : it.retailPrice;
            const lineRev = unitPrice * it.quantity;
            if (!perProduct[it.productName]) perProduct[it.productName] = { units: 0, revenue: 0 };
            perProduct[it.productName].units += it.quantity;
            perProduct[it.productName].revenue += lineRev;
            if (inv.date === today) { todayUnits += it.quantity; todayRevenue += lineRev; }
        });
    });

    const rows = Object.keys(perProduct).map(name => {
        const prod = state.products.find(p => p.name === name);
        const unitCost = prod ? estimatedUnitCost(prod) : 0;
        const cost = unitCost * perProduct[name].units;
        return {
            name,
            units: perProduct[name].units,
            revenue: perProduct[name].revenue,
            cost,
            profit: perProduct[name].revenue - cost
        };
    }).sort((a, b) => b.units - a.units);

    return { rows, todayUnits, todayRevenue, todayOrders };
}

function renderSalesReport() {
    const summary = document.getElementById("salesReportSummary");
    const body = document.getElementById("salesReportBody");
    if (!summary || !body) return;

    const { rows, todayUnits, todayRevenue, todayOrders } = computeSalesReport();
    const bestSeller = rows.length ? rows[0].name : "—";
    const money = (n) => `LKR ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    const stat = (label, value, icon) => `
        <div class="bg-surface-container/50 rounded-2xl p-3 flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">${icon}</span>
            <div class="min-w-0">
                <p class="text-[11px] text-on-surface-variant">${label}</p>
                <p class="font-display font-bold text-on-surface text-sm truncate">${value}</p>
            </div>
        </div>`;

    summary.innerHTML =
        stat("Sales today", money(todayRevenue), "payments") +
        stat("Items sold today", todayUnits + " pcs", "shopping_basket") +
        stat("Orders today", String(todayOrders), "receipt_long") +
        stat("Best-seller", bestSeller, "emoji_events");

    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="px-3 py-6 text-center text-sm text-on-surface-variant">No sales recorded yet.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(r => `
        <tr class="hover:bg-surface-container/40 transition-colors">
            <td class="px-3 py-2 border-t border-outline-variant/30 font-medium text-on-surface">${r.name}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${r.units}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right">${money(r.revenue)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right text-on-surface-variant">${money(r.cost)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-right font-semibold ${r.profit >= 0 ? 'text-green-700' : 'text-red-700'}">${money(r.profit)}</td>
        </tr>`).join('');
}

// Render the 4 high-fidelity KPI Metrics Cards
function renderDashboardKPICards() {
    const grid = document.getElementById("dashboardKpiGrid");
    const state = window.BlissburnState;
    
    // 1. Total Revenue (Sum of all invoices)
    const totalSales = state.invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
    
    // 2. Accounts Receivable Outstanding Debt
    const totalReceivables = state.invoices
        .filter(inv => inv.customerType === "B2B")
        .reduce((sum, inv) => sum + inv.outstanding, 0);
        
    // 3. Low Stock Warning count
    const lowStockCount = state.ingredients.filter(ing => ing.stock <= ing.threshold).length;
    
    // 4. Daily Production Output completed matching simulated date
    const dailyProduction = state.productionLogs
        .filter(log => log.dateProduced === state.simulatedDate)
        .reduce((sum, log) => sum + log.qty, 0);
        
    grid.innerHTML = `
        <!-- Card A: Total Sales -->
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5 hover-lift transition-transform kpi-accent-green">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-xs text-on-surface-variant">Total Revenue</p>
                    <p class="font-display text-xl font-bold text-on-surface mt-1">LKR ${(totalSales/1000).toFixed(1)}k</p>
                    <span class="text-[11px] font-medium text-green-700 flex items-center gap-0.5 mt-1"><span class="material-symbols-outlined text-xs">trending_up</span> +12.4% <span class="text-on-surface-variant">MoM</span></span>
                </div>
                <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-green-100"><span class="material-symbols-outlined text-xl text-green-700">payments</span></div>
            </div>
        </div>

        <!-- Card B: Accounts Receivable -->
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5 hover-lift transition-transform kpi-accent-red">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-xs text-on-surface-variant">Money Owed to You</p>
                    <p class="font-display text-xl font-bold text-on-surface mt-1">LKR ${(totalReceivables/1000).toFixed(1)}k</p>
                    <span class="text-[11px] font-medium ${totalReceivables > 150000 ? 'text-red-700' : 'text-green-700'} flex items-center gap-0.5 mt-1">
                        <span class="material-symbols-outlined text-xs">${totalReceivables > 150000 ? 'warning' : 'check_circle'}</span>
                        ${totalReceivables > 150000 ? 'A lot is unpaid' : 'Mostly paid up'}
                    </span>
                </div>
                <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-red-100"><span class="material-symbols-outlined text-xl text-red-700">account_balance</span></div>
            </div>
        </div>

        <!-- Card C: Low Stock Warning -->
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5 hover-lift transition-transform kpi-accent-amber">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-xs text-on-surface-variant">Low Stock Alert</p>
                    <p class="font-display text-xl font-bold text-on-surface mt-1">${lowStockCount} <span class="text-sm text-on-surface-variant">Items</span></p>
                    <span class="text-[11px] font-medium ${lowStockCount > 0 ? 'text-red-700' : 'text-green-700'} flex items-center gap-0.5 mt-1">
                        <span class="material-symbols-outlined text-xs">${lowStockCount > 0 ? 'error' : 'check_circle'}</span>
                        ${lowStockCount > 0 ? 'Replenish Required' : 'Ingredients healthy'}
                    </span>
                </div>
                <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100"><span class="material-symbols-outlined text-xl text-amber-700">inventory_2</span></div>
            </div>
        </div>

        <!-- Card D: Daily Production -->
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-5 hover-lift transition-transform kpi-accent-blue">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-xs text-on-surface-variant">Daily Production</p>
                    <p class="font-display text-xl font-bold text-on-surface mt-1">${dailyProduction} <span class="text-sm text-on-surface-variant">pcs</span></p>
                    <span class="text-[11px] font-medium text-on-surface-variant flex items-center gap-0.5 mt-1"><span class="material-symbols-outlined text-xs">cookie</span> Active fresh stock</span>
                </div>
                <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-100"><span class="material-symbols-outlined text-xl text-blue-700">grain</span></div>
            </div>
        </div>
    `;
}

// Render dynamic custom SVG Line Chart comparing B2C cash vs B2B wholesale credit
function renderInteractiveSVGRevenueChart() {
    const svg = document.getElementById("dashboardRevenueChart");
    const state = window.BlissburnState;
    
    svg.innerHTML = "";
    
    // Group invoices by dates
    const salesByDate = {};
    
    state.invoices.forEach(inv => {
        const d = inv.date;
        if (!salesByDate[d]) {
            salesByDate[d] = { b2c: 0, b2b: 0 };
        }
        if (inv.customerType === "B2B") {
            salesByDate[d].b2b += inv.grandTotal;
        } else {
            salesByDate[d].b2c += inv.grandTotal;
        }
    });
    
    // Extract sorted unique dates list
    const dates = Object.keys(salesByDate).sort((a,b) => new Date(a) - new Date(b));
    
    if (dates.length === 0) {
        svg.innerHTML = `<text x="300" y="120" text-anchor="middle" fill="#64748b" font-size="14">No transaction history to chart</text>`;
        return;
    }
    
    // Chart Layout parameters
    const paddingX = 60;
    const paddingY = 40;
    const width = 600;
    const height = 240;
    const chartW = width - paddingX * 2;
    const chartH = height - paddingY * 2;
    
    // Find maximum single-day sales value to compute Y height ratio
    let maxVal = 50000;
    dates.forEach(d => {
        const val = Math.max(salesByDate[d].b2c, salesByDate[d].b2b);
        if (val > maxVal) maxVal = val;
    });
    maxVal = Math.ceil(maxVal / 20000) * 20000; // Round up to clean step
    
    // Draw SVG Gridlines and Y Axis values
    let gridLinesHTML = "";
    const yGridSteps = 4;
    for (let i = 0; i <= yGridSteps; i++) {
        const gridVal = (maxVal / yGridSteps) * i;
        const yCoord = height - paddingY - (chartH / yGridSteps) * i;
        
        // Grid dash line
        gridLinesHTML += `
            <line x1="${paddingX}" y1="${yCoord}" x2="${width - paddingX}" y2="${yCoord}" class="chart-grid" />
            <text x="${paddingX - 10}" y="${yCoord + 4}" text-anchor="end" fill="#94a3b8" font-size="10" font-weight="600">LKR ${(gridVal/1000).toFixed(0)}k</text>
        `;
    }
    
    // Plot lines points paths mapping
    let retailPoints = [];
    let wholesalePoints = [];
    let xAxisLabelsHTML = "";
    
    const xStep = dates.length > 1 ? chartW / (dates.length - 1) : chartW;
    
    dates.forEach((d, index) => {
        const xCoord = paddingX + xStep * index;
        
        // Retail Y
        const retailVal = salesByDate[d].b2c;
        const retailY = height - paddingY - (retailVal / maxVal) * chartH;
        retailPoints.push(`${xCoord},${retailY}`);
        
        // Wholesale Y
        const wholesaleVal = salesByDate[d].b2b;
        const wholesaleY = height - paddingY - (wholesaleVal / maxVal) * chartH;
        wholesalePoints.push(`${xCoord},${wholesaleY}`);
        
        // Format date short label (e.g., "May 12")
        const dateObj = new Date(d);
        const dateLabel = dateObj.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
        
        xAxisLabelsHTML += `
            <text x="${xCoord}" y="${height - paddingY + 20}" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="600">${dateLabel}</text>
        `;
    });
    
    // Construct Path curves strings
    const retailPath = `M ${retailPoints.join(' L ')}`;
    const wholesalePath = `M ${wholesalePoints.join(' L ')}`;
    
    // Create dots over plot coordinates
    let dotsHTML = "";
    dates.forEach((d, index) => {
        const x = paddingX + xStep * index;
        const retailY = height - paddingY - (salesByDate[d].b2c / maxVal) * chartH;
        const wholesaleY = height - paddingY - (salesByDate[d].b2b / maxVal) * chartH;
        
        dotsHTML += `
            <circle cx="${x}" cy="${retailY}" r="5" class="chart-dots-retail"><title>Retail: LKR ${salesByDate[d].b2c.toLocaleString()}</title></circle>
            <circle cx="${x}" cy="${wholesaleY}" r="5" class="chart-dots-wholesale"><title>Wholesale: LKR ${salesByDate[d].b2b.toLocaleString()}</title></circle>
        `;
    });
    
    // Append SVG elements to DOM
    svg.innerHTML = `
        <title>Revenue Progression Chart</title>
        <desc>Line chart comparing B2C Cash Sales vs B2B Wholesale Credit Sales over time. X-axis shows dates, Y-axis shows revenue in LKR.</desc>
        ${gridLinesHTML}
        <path d="${retailPath}" class="chart-path-retail" />
        <path d="${wholesalePath}" class="chart-path-wholesale" />
        ${dotsHTML}
        ${xAxisLabelsHTML}
    `;
}

// Render Daily bakery Quotas progression list
function renderDailyProductionQuotaGrid() {
    const list = document.getElementById("dashProductionList");
    const state = window.BlissburnState;
    
    list.innerHTML = "";
    
    // Legacy fallback targets for mock data without a configured dailyTarget
    const dailyTargets = {
        "Creamy Bun": 300,
        "Coconut Bun": 200,
        "Sandwich Bread": 150
    };

    state.products.forEach(prod => {
        const target = prod.dailyTarget || dailyTargets[prod.name] || 100;
        
        // Sum total quantities logged today matching simulated date
        const todayLogged = state.productionLogs
            .filter(log => log.product === prod.name && log.dateProduced === state.simulatedDate)
            .reduce((sum, log) => sum + log.qty, 0);
            
        const progressPct = Math.min((todayLogged / target) * 100, 100);
        
        const row = document.createElement("div");
        row.className = "flex flex-col gap-1.5";
        
        row.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-on-surface">${prod.name}</span>
                <span class="text-xs text-on-surface-variant">${todayLogged} / ${target} units (${progressPct.toFixed(0)}%)</span>
            </div>
            <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div class="h-full ${progressPct === 100 ? 'bg-green-500' : 'bg-primary-container'} rounded-full transition-all duration-500" style="width: ${progressPct}%"></div>
            </div>
        `;
        list.appendChild(row);
    });
}

// Render Stock levels warning panel list, led by "use first" expiry cues —
// the bakery's morning routine: what must be used, sold, or discarded today
function renderDashboardStockHealthAlerts() {
    const list = document.getElementById("dashStockAlertsList");
    const state = window.BlissburnState;

    list.innerHTML = "";

    const simDate = new Date(state.simulatedDate);
    const ingName = (code) => {
        const ing = state.ingredients.find(i => i.code === code);
        return ing ? ing.name : code;
    };

    // 1. Expired ingredient batches still in stock → discard
    // 2. Ingredient batches expiring within 2 days → use first
    state.fifoQueue.filter(b => b.remainingQty > 0).forEach(batch => {
        const daysLeft = Math.ceil((new Date(batch.expiryDate) - simDate) / 86400000);
        if (daysLeft > 2) return;

        const item = document.createElement("div");
        item.className = "flex items-start gap-3";
        if (daysLeft < 0) {
            item.innerHTML = `
                <span class="material-symbols-outlined text-red-600 text-lg flex-shrink-0">delete_forever</span>
                <div>
                    <p class="text-sm font-semibold text-red-700">Discard: ${ingName(batch.ingredientCode)} batch ${batch.id}</p>
                    <p class="text-xs text-on-surface-variant mt-0.5">Expired ${batch.expiryDate} — ${(batch.remainingQty/1000).toFixed(1)}kg unusable until written off</p>
                </div>`;
        } else {
            item.innerHTML = `
                <span class="material-symbols-outlined text-amber-600 text-lg flex-shrink-0">schedule</span>
                <div>
                    <p class="text-sm font-semibold text-on-surface">Use first: ${ingName(batch.ingredientCode)} batch ${batch.id}</p>
                    <p class="text-xs text-on-surface-variant mt-0.5">${daysLeft === 0 ? 'Expires TODAY' : `Expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`} (${batch.expiryDate}) — ${(batch.remainingQty/1000).toFixed(1)}kg remaining</p>
                </div>`;
        }
        list.appendChild(item);
    });

    // 3. Finished goods expiring today → sell today
    state.productionLogs.filter(b => b.active && b.qty > 0 && b.expiryDate === state.simulatedDate).forEach(batch => {
        const item = document.createElement("div");
        item.className = "flex items-start gap-3";
        item.innerHTML = `
            <span class="material-symbols-outlined text-amber-600 text-lg flex-shrink-0">storefront</span>
            <div>
                <p class="text-sm font-semibold text-on-surface">Sell today: ${batch.product}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">Batch ${batch.id} (${batch.qty} pcs) reaches expiry today</p>
            </div>`;
        list.appendChild(item);
    });

    // 4. Low central stock levels
    const lowStockIngs = state.ingredients.filter(ing => ing.stock <= ing.threshold);

    if (lowStockIngs.length === 0 && list.children.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-6 text-center">
                <span class="material-symbols-outlined text-3xl text-green-500 mb-2">verified_user</span>
                <p class="text-sm font-medium text-green-700">All stock fresh and healthy — nothing expiring, nothing low!</p>
            </div>
        `;
        return;
    }

    lowStockIngs.forEach(ing => {
        const item = document.createElement("div");
        item.className = "flex items-start gap-3";
        
        // Format using the ingredient's own unit
        const currentQty = window.fmtQty(ing.stock, ing.unit);
        const thresholdQty = window.fmtQty(ing.threshold, ing.unit);

        item.innerHTML = `
            <span class="material-symbols-outlined text-amber-600 text-lg flex-shrink-0">warning</span>
            <div>
                <p class="text-sm font-semibold text-on-surface">${ing.name} is running critically low</p>
                <p class="text-xs text-on-surface-variant mt-0.5">Current stock: ${currentQty} (Safe limit: ${thresholdQty})</p>
            </div>
        `;
        list.appendChild(item);
    });
}

// Compile recent transactional events into vertical timeline
function renderOperationalTimeline() {
    const timeline = document.getElementById("dashboardTimeline");
    const state = window.BlissburnState;
    
    timeline.innerHTML = "";
    
    // Map recent operations: sort financial transaction logs newest first, limit to 6
    const recentTxns = [...state.financialLog]
        .sort((a,b) => new Date(b.date) - new Date(a.date))
        .slice(0, 6);
        
    if (recentTxns.length === 0) {
        timeline.innerHTML = `<div class="flex flex-col items-center justify-center py-8 text-center"><p class="text-sm text-on-surface-variant">No activity logged.</p></div>`;
        return;
    }
    
    recentTxns.forEach(txn => {
        const item = document.createElement("div");
        item.className = "flex gap-3 py-3 border-b border-outline-variant/20 last:border-none";
        
        let dotColor = "bg-primary-container";
        if (txn.method === "cash" || txn.method === "card") dotColor = "bg-green-500";
        if (txn.method === "credit") dotColor = "bg-primary-container";
        if (txn.method === "payment-in") dotColor = "bg-green-500";
        if (txn.method === "purchase" || txn.description.toLowerCase().includes("replenish")) dotColor = "bg-red-500";
        
        // Format simulated date relative display
        const dateObj = new Date(txn.date);
        const dateLabel = dateObj.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
        
        item.innerHTML = `
            <div class="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}"></div>
            <div class="flex-1 min-w-0">
                <p class="text-[11px] text-outline">${dateLabel}</p>
                <p class="text-xs font-semibold text-on-surface mt-0.5">${txn.description}</p>
                <p class="text-[11px] text-on-surface-variant mt-0.5 truncate">${txn.amount !== 0 ? `Posted ledger amount: LKR ${txn.amount.toLocaleString()}` : 'System ledger post'}</p>
            </div>
        `;
        timeline.appendChild(item);
    });
}

// Bind timeline refresh button
function setupDashboardEventListeners() {
    const refreshBtn = document.getElementById("refreshTimeline");
    if(refreshBtn) {
        refreshBtn.onclick = () => {
            renderOperationalTimeline();
            addNotification("success", "Activity Refreshed", "Recent activity reloaded.");
        };
    }

    const exportSalesBtn = document.getElementById("exportSalesReportBtn");
    if (exportSalesBtn) {
        exportSalesBtn.onclick = () => {
            const { rows } = computeSalesReport();
            const headers = ["Product", "Units Sold", "Revenue (LKR)", "Estimated Cost (LKR)", "Estimated Profit (LKR)"];
            const data = rows.map(r => [r.name, r.units, r.revenue.toFixed(2), r.cost.toFixed(2), r.profit.toFixed(2)]);
            window.exportToCSV(headers, data, "sales_report.csv");
        };
    }
}
