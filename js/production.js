/* ==========================================================================
   BLISSBURN ERP - PRODUCTION & BOM DEPLETION ENGINE (production.js)
   ========================================================================== */

// Initialize Production view hook
window.renderProduction = function() {
    loadProductionProductSelect();
    renderBOMRequirementPreview();
    renderProductionBatches();
    setupProductionEventListeners();
};

// Populate the production product dropdown
function loadProductionProductSelect() {
    const select = document.getElementById("prodProductSelect");
    const state = window.BlissburnState;
    
    const currentSel = select.value;
    select.innerHTML = "";
    
    state.products.forEach(prod => {
        const option = document.createElement("option");
        option.value = prod.id;
        option.innerText = prod.name;
        select.appendChild(option);
    });
    
    if (currentSel) {
        select.value = currentSel;
    }
}

// Usable stock excludes expired perishable batch remainders — they sit in
// central stock until discarded but must never be baked with
function getUsableIngredientStock(ing) {
    const state = window.BlissburnState;
    if (!ing.isPerishable) return ing.stock;
    const expiredQty = state.fifoQueue
        .filter(b => b.ingredientCode === ing.code && b.remainingQty > 0 && b.expiryDate < state.simulatedDate)
        .reduce((sum, b) => sum + b.remainingQty, 0);
    return Math.max(ing.stock - expiredQty, 0);
}

// Calculate and render BOM requirements live in production logging form
function renderBOMRequirementPreview() {
    const select = document.getElementById("prodProductSelect");
    const qtyInput = document.getElementById("prodQuantity");
    const previewList = document.getElementById("prodBOMPreviewList");
    const alertBox = document.getElementById("bomSufficiencyAlert");
    const submitBtn = document.getElementById("submitProductionOrder");

    if (!select.value || !qtyInput.value) return;

    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === select.value);
    const qty = Number(qtyInput.value);

    previewList.innerHTML = "";

    let isSufficient = true;
    let insufficientItemsList = [];
    let maxProducible = Infinity;

    // Map recipe BOM requirements
    const recipeBOM = prod.bom; // e.g. { "i1": 50, "i2": 10 }

    for (let code in recipeBOM) {
        const ing = state.ingredients.find(i => i.code === code);
        if (!ing) continue;

        const unitRatio = recipeBOM[code]; // g per unit
        const totalNeeded = unitRatio * qty;
        const availableStock = getUsableIngredientStock(ing);

        // Track the binding constraint across all ingredients
        maxProducible = Math.min(maxProducible, Math.floor(availableStock / unitRatio));

        const isIngSufficient = availableStock >= totalNeeded;
        if (!isIngSufficient) {
            isSufficient = false;
            insufficientItemsList.push(ing.name);
        }
        
        const card = document.createElement("div");
        card.className = `bg-surface-container rounded-xl p-3 ${isIngSufficient ? '' : 'border-2 border-red-300 bg-red-50'}`;
        card.innerHTML = `
            <p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-medium">${ing.name}</p>
            <p class="text-sm font-bold text-on-surface mt-1">${window.fmtQty(totalNeeded, ing.unit, 2)}</p>
            <p class="text-xs text-on-surface-variant mt-0.5">Stock: ${window.fmtQty(availableStock, ing.unit)}</p>
            <span class="text-[11px] font-bold mt-1 flex items-center gap-0.5 ${isIngSufficient ? 'text-green-700' : 'text-red-700'}">
                <span class="material-symbols-outlined text-xs">${isIngSufficient ? 'check_circle' : 'cancel'}</span> ${isIngSufficient ? 'OK' : 'Short'}
            </span>
        `;
        previewList.appendChild(card);
    }
    
    // Update alert status box and lock submit button. Always show the maximum
    // producible quantity so the manager never has to guess-and-error.
    const maxLabel = Number.isFinite(maxProducible) ? maxProducible : 0;
    if (isSufficient) {
        alertBox.className = "mt-3 flex items-center gap-2 text-xs font-medium text-green-700 bg-green-50 px-3 py-2.5 rounded-xl border border-green-200";
        alertBox.innerHTML = `<span class="material-symbols-outlined text-sm">check_circle</span> Raw materials sufficient. <strong>Max producible with current usable stock: ${maxLabel} units.</strong>`;
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
    } else {
        alertBox.className = "mt-3 flex items-center gap-2 text-xs font-medium text-red-700 bg-red-50 px-3 py-2.5 rounded-xl border border-red-200";
        alertBox.innerHTML = `<span class="material-symbols-outlined text-sm">warning</span> Insufficient usable stock of: ${insufficientItemsList.join(', ')}. <strong>Max producible: ${maxLabel} units.</strong>`;
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.4";
    }

    // Demand-forecast hint: suggest how many to bake today based on recent sales
    let hint = document.getElementById("prodForecastHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "prodForecastHint";
        alertBox.insertAdjacentElement("afterend", hint);
    }
    if (window.suggestedBakeToday) {
        const f = window.suggestedBakeToday(prod.name);
        if (f && !f.limited) {
            hint.className = "mt-2 flex items-center gap-2 text-xs font-medium text-primary bg-primary-container/15 px-3 py-2.5 rounded-xl border border-primary-container/40";
            hint.innerHTML = `<span class="material-symbols-outlined text-sm">insights</span> Suggested today: <strong>${f.suggestToday} pcs</strong> <span class="text-on-surface-variant">(sells ~${f.avgDaily.toFixed(0)}/day, ${f.stock} fresh in stock)</span>`;
        } else {
            hint.className = "mt-2 flex items-center gap-2 text-[11px] text-on-surface-variant px-1";
            hint.innerHTML = `<span class="material-symbols-outlined text-xs">info</span> Not enough sales history yet for a demand suggestion.`;
        }
    }
}

// Initialize production page state
window._currentProductionPage = 1;

// Render production completed batches table list
function renderProductionBatches() {
    const body = document.getElementById("productionBatchesBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    if (state.productionLogs.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-on-surface-variant">No production batches logged.</td></tr>`;
        const paginationCtr = document.getElementById("productionPaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // Sort batches by newest produced first
    const sortedLogs = [...state.productionLogs].reverse();
    
    // Paginate (5 batches per page)
    const paginated = window.paginateArray(sortedLogs, window._currentProductionPage, 5);
    
    if (window._currentProductionPage > paginated.totalPages) {
        window._currentProductionPage = paginated.totalPages;
    }
    
    paginated.data.forEach(batch => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        let statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active Fresh</span>`;
        if (!batch.active) {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Sold / Depleted</span>`;
        }
        
        // Expiration check based on simulated date
        const simDate = new Date(state.simulatedDate);
        const expDate = new Date(batch.expiryDate);
        if (batch.active && simDate > expDate) {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Expired Asset</span>`;
        }
        
        row.innerHTML = `
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${batch.id}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${batch.product}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${batch.qty} pcs</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${batch.dateProduced}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${batch.expiryDate}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${statusBadge}</td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("productionPaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentProductionPage = newPage;
        renderProductionBatches();
    });
}

// Set up UI Event listeners for production logs
function setupProductionEventListeners() {
    const select = document.getElementById("prodProductSelect");
    const qtyInput = document.getElementById("prodQuantity");
    const form = document.getElementById("productionLogForm");
    const clearBtn = document.getElementById("clearBatchesBtn");
    const exportBtn = document.getElementById("exportProductionCSVBtn");
    
    if (select) select.onchange = () => renderBOMRequirementPreview();
    if (qtyInput) qtyInput.oninput = () => renderBOMRequirementPreview();
    
    // Submit logging order
    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            executeProductionLogging();
        };
    }
    
    if (clearBtn) {
        clearBtn.onclick = async () => {
            const ok = await window.showConfirm({
                title: "Clear Production History",
                message: "This permanently removes ALL completed production batch records. This action cannot be undone.",
                confirmText: "Clear All",
                danger: true
            });
            if (!ok) return;
            window.BlissburnState.productionLogs = [];
            saveState();
            window._currentProductionPage = 1;
            renderProductionBatches();
            addNotification("info", "Production History Cleared", "Completed production batches database reset.");
        };
    }
    
    if (exportBtn) {
        exportBtn.onclick = () => {
            const state = window.BlissburnState;
            const headers = ["Batch ID", "Product", "Quantity", "Date Produced", "Expiry Date", "FIFO Status"];
            const rows = state.productionLogs.map(batch => {
                let status = "Active Fresh";
                if (!batch.active) status = "Sold / Depleted";
                const simDate = new Date(state.simulatedDate);
                const expDate = new Date(batch.expiryDate);
                if (batch.active && simDate > expDate) status = "Expired Asset";
                
                return [
                    batch.id,
                    batch.product,
                    `${batch.qty} pcs`,
                    batch.dateProduced,
                    batch.expiryDate,
                    status
                ];
            });
            window.exportToCSV(headers, rows, "completed_production_batches.csv");
        };
    }
}

// Perform ingredient depletion and batch record writing
function executeProductionLogging() {
    const state = window.BlissburnState;
    const select = document.getElementById("prodProductSelect");
    const qtyInput = document.getElementById("prodQuantity");
    
    const prod = state.products.find(p => p.id === select.value);
    const qty = Number(qtyInput.value);
    const prodDateStr = state.simulatedDate;
    
    // Calculate Expiry date
    const exp = new Date(prodDateStr);
    exp.setDate(exp.getDate() + Number(prod.shelfLife));
    const expiryDateStr = exp.toISOString().split('T')[0];
    
    // Generate Batch ID
    const batchId = `BCH-${1000 + state.productionLogs.length + 1}`;
    
    // 1. Perform Recipe BOM depletion on Central Stock & Perishable FIFO batches
    const recipeBOM = prod.bom;
    
    for (let code in recipeBOM) {
        const ing = state.ingredients.find(i => i.code === code);
        const totalNeeded = recipeBOM[code] * qty;
        
        // A. Deplete Central Stock
        ing.stock -= totalNeeded;
        
        // B. Apply Strict FIFO Depletion on Perishable batches queue (FR3)
        if (ing.isPerishable) {
            let qtyToDeplete = totalNeeded;
            
            // Find active non-expired FIFO batches, sorted by oldest received date (FIFO)
            const ingredientBatches = state.fifoQueue
                .filter(b => b.ingredientCode === code && b.remainingQty > 0 && b.expiryDate >= state.simulatedDate)
                .sort((a, b) => new Date(a.dateReceived) - new Date(b.dateReceived));
                
            for (let batch of ingredientBatches) {
                if (qtyToDeplete <= 0) break;
                
                if (batch.remainingQty >= qtyToDeplete) {
                    batch.remainingQty -= qtyToDeplete;
                    qtyToDeplete = 0;
                } else {
                    qtyToDeplete -= batch.remainingQty;
                    batch.remainingQty = 0;
                }
            }
            
            // If the FIFO queue is depleted but we still need more, it was met by buffer stock (Central Stock holds it)
        }
    }
    
    // 2. Append completed Production Batch log
    state.productionLogs.push({
        id: batchId,
        product: prod.name,
        qty: qty,
        dateProduced: prodDateStr,
        expiryDate: expiryDateStr,
        active: true
    });
    
    saveState();
    
    // Clear and reload
    qtyInput.value = 100;
    window._currentProductionPage = 1;
    renderBOMRequirementPreview();
    renderProductionBatches();
    
    addNotification("success", "Production Logged", `Batch ${batchId} for ${qty} pcs of ${prod.name} logged. BOM materials depleted.`);
}
