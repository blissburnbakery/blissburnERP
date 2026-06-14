/* ==========================================================================
   BLISSBURN ERP - INVENTORY & FIFO TRACKING MODULE (inventory.js)
   ========================================================================== */

// Map FontAwesome icon classes to Material Symbols names
function mapFAToMaterialInv(faIcon) {
    const map = {
        'fa-cookie-bite': 'cookie', 'fa-bread-slice': 'bakery_dining', 'fa-square': 'square',
        'fa-cookie': 'cookie', 'fa-wheat-awn': 'grain'
    };
    return map[faIcon] || 'category';
}

// Initialize Inventory view hook
window.renderInventory = function() {
    renderCentralStockLedger();
    renderRecipeBOMConfiguration();
    renderFIFOQueueTable();
    setupInventorySubTabs();
    setupInventoryReplenishForm();
    setupBOMSuiteForms();
    
    // Bind search field for live raw materials stock filtering
    const searchInput = document.getElementById("inventoryStockSearch");
    if (searchInput) {
        searchInput.oninput = () => {
            window._currentStockPage = 1;
            renderCentralStockLedger();
        };
    }
    
    // Bind dynamic CSV stock ledger export
    const exportBtn = document.getElementById("exportStockCSVBtn");
    if (exportBtn) {
        exportBtn.onclick = () => {
            const state = window.BlissburnState;
            const headers = ["Ingredient Code", "Ingredient Name", "Stock Level (g)", "Threshold Limit (g)", "Unit", "Is Perishable"];
            const rows = state.ingredients.map(i => [
                i.code.toUpperCase(),
                i.name,
                i.stock,
                i.threshold,
                i.unit,
                i.isPerishable ? "Yes" : "No"
            ]);
            window.exportToCSV(headers, rows, "raw_materials_ledger.csv");
        };
    }
    
    // Bind search field for live FIFO batches filtering
    const fifoSearch = document.getElementById("inventoryFifoSearch");
    if (fifoSearch) {
        fifoSearch.oninput = () => {
            window._currentFifoPage = 1;
            renderFIFOQueueTable();
        };
    }
    
    // Bind dynamic CSV FIFO batches export
    const exportFifoBtn = document.getElementById("exportFifoCSVBtn");
    if (exportFifoBtn) {
        exportFifoBtn.onclick = () => {
            const state = window.BlissburnState;
            const headers = ["Ingredient Code", "Batch Ref", "Received Date", "Expiry Date", "Original Qty (g)", "Remaining Qty (g)"];
            const rows = state.fifoQueue.map(b => [
                b.ingredientCode.toUpperCase(),
                b.id,
                b.dateReceived,
                b.expiryDate,
                b.originalQty,
                b.remainingQty
            ]);
            window.exportToCSV(headers, rows, "perishable_batches_fifo.csv");
        };
    }
};

// Initialize stock page and sort state variables
window._currentStockPage = 1;
window._stockSortKey = "code";
window._stockSortOrder = "asc";

window.toggleStockSort = function(key) {
    if (window._stockSortKey === key) {
        window._stockSortOrder = window._stockSortOrder === "asc" ? "desc" : "asc";
    } else {
        window._stockSortKey = key;
        window._stockSortOrder = "asc";
    }
    window._currentStockPage = 1;
    renderCentralStockLedger();
};

function updateStockSortIcons() {
    const keys = ["code", "name", "stock", "threshold"];
    keys.forEach(k => {
        const el = document.getElementById(`sort-icon-stock-${k}`);
        if (!el) return;
        if (window._stockSortKey === k) {
            el.innerHTML = window._stockSortOrder === "asc" 
                ? `<span class="material-symbols-outlined text-[10px] select-none font-bold align-middle">arrow_drop_up</span>` 
                : `<span class="material-symbols-outlined text-[10px] select-none font-bold align-middle">arrow_drop_down</span>`;
        } else {
            el.innerHTML = "";
        }
    });
}

// Render Central Stock Ledger Table
function renderCentralStockLedger() {
    const body = document.getElementById("inventoryStockBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    const searchInput = document.getElementById("inventoryStockSearch");
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    // 1. Filter
    let filteredIngs = state.ingredients;
    if (filterText) {
        filteredIngs = state.ingredients.filter(ing => 
            ing.name.toLowerCase().includes(filterText) ||
            ing.code.toLowerCase().includes(filterText)
        );
    }
    
    // 2. Sort
    filteredIngs.sort((a, b) => {
        let valA = a[window._stockSortKey];
        let valB = b[window._stockSortKey];
        
        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();
        
        if (valA < valB) return window._stockSortOrder === "asc" ? -1 : 1;
        if (valA > valB) return window._stockSortOrder === "asc" ? 1 : -1;
        return 0;
    });
    
    // 3. Empty state check
    if (filteredIngs.length === 0) {
        window.renderEmptyState("inventoryStockBody", 8, "No ingredients found in stock registry.", "inventory_2");
        const paginationCtr = document.getElementById("stockPaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // 4. Paginate (5 ingredients per page)
    const paginated = window.paginateArray(filteredIngs, window._currentStockPage, 5);
    
    // Page boundary validation
    if (window._currentStockPage > paginated.totalPages) {
        window._currentStockPage = paginated.totalPages;
    }
    
    paginated.data.forEach(ing => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        const fifoCount = state.fifoQueue.filter(b => b.ingredientCode === ing.code && b.remainingQty > 0).length;
        
        let statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Sufficient</span>`;
        if (ing.stock <= ing.threshold) {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Low Stock</span>`;
        }
        
        const displayStock = window.qtyFromBase(ing.stock, ing.unit).toFixed(1);
        const displayThreshold = window.qtyFromBase(ing.threshold, ing.unit).toFixed(1);
        const displayUnit = window.displayUnit(ing.unit);
        
        row.innerHTML = `
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${ing.code.toUpperCase()}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${ing.name} ${ing.isPerishable ? '<span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full ml-1"><span class="material-symbols-outlined text-xs">schedule</span> Perishable</span>' : ''}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 font-semibold">${displayStock}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${displayThreshold}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${displayUnit}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${ing.isPerishable ? `<span class="text-xs font-medium text-primary bg-primary-container/40 px-2 py-0.5 rounded-full">${fifoCount} active</span>` : '<span class="text-on-surface-variant">-</span>'}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${statusBadge}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 text-right font-medium">
                <div class="flex justify-end gap-1">
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-primary bg-primary-container/20 rounded-lg hover:bg-primary-container/50 transition-colors" onclick="editIngredient('${ing.code}')">
                        <span class="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onclick="deleteIngredient('${ing.code}')">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </div>
            </td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("stockPaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentStockPage = newPage;
        renderCentralStockLedger();
    });
    
    // Update sort icons
    updateStockSortIcons();
}

// Render Recipe BOM Cards
function renderRecipeBOMConfiguration() {
    const grid = document.getElementById("inventoryRecipeGrid");
    const state = window.BlissburnState;
    
    grid.innerHTML = "";
    
    state.products.forEach(prod => {
        const card = document.createElement("div");
        card.className = "bg-surface-container rounded-xl p-4 border border-outline-variant/30";
        
        let ingredientLines = "";
        const recipeBOM = prod.bom;
        
        for (let code in recipeBOM) {
            const ing = state.ingredients.find(i => i.code === code);
            const name = ing ? ing.name : code;
            ingredientLines += `
                <div class="flex justify-between text-xs py-1.5 border-b border-outline-variant/20 last:border-none">
                    <span class="text-on-surface-variant">${name}</span>
                    <span class="font-semibold text-on-surface">${recipeBOM[code]} g / unit</span>
                </div>
            `;
        }
        
        const materialIcon = mapFAToMaterialInv(prod.icon);
        
        card.innerHTML = `
            <div class="flex items-center gap-2 mb-3">
                <span class="material-symbols-outlined text-primary">${materialIcon}</span>
                <h4 class="font-display font-bold text-on-surface text-sm">${prod.name}</h4>
                <span class="text-xs font-medium text-primary bg-primary-container/40 px-2 py-0.5 rounded-full ml-auto">${prod.category}</span>
            </div>
            <div class="flex justify-between text-xs py-1.5">
                <span class="text-on-surface-variant">Retail / B2B</span>
                <span class="font-semibold text-on-surface">LKR ${prod.retailPrice} / ${prod.wholesalePrice}</span>
            </div>
            ${ingredientLines}
            <div class="mt-3 flex gap-2">
                <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-lowest text-on-surface rounded-full text-xs font-medium hover:bg-surface-container-high transition-colors border border-outline-variant/30" onclick="openEditRecipeDialog('${prod.id}')">
                    <span class="material-symbols-outlined text-sm">edit</span> Edit Recipe
                </button>
                <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-full text-xs font-medium hover:bg-red-100 transition-colors border border-red-200/50" onclick="deleteProduct('${prod.id}')">
                    <span class="material-symbols-outlined text-sm">delete</span> Delete
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Initialize FIFO page state variables
window._currentFifoPage = 1;

// Render FIFO Queue Perishable batches table (FR3)
function renderFIFOQueueTable() {
    const body = document.getElementById("fifoQueueTableBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    const simDate = new Date(state.simulatedDate);
    
    // Sort batches by dateReceived oldest first (First-In, First-Out queue check)
    let activeFIFO = state.fifoQueue
        .filter(b => b.remainingQty > 0)
        .sort((a, b) => new Date(a.dateReceived) - new Date(b.dateReceived));
        
    const searchInput = document.getElementById("inventoryFifoSearch");
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    if (filterText) {
        activeFIFO = activeFIFO.filter(b => {
            const ing = state.ingredients.find(i => i.code === b.ingredientCode);
            const name = ing ? ing.name.toLowerCase() : "";
            return b.ingredientCode.toLowerCase().includes(filterText) ||
                   b.id.toLowerCase().includes(filterText) ||
                   name.includes(filterText);
        });
    }
        
    if (activeFIFO.length === 0) {
        window.renderEmptyState("fifoQueueTableBody", 9, "No active perishable ingredient batches in queue.", "schedule");
        const paginationCtr = document.getElementById("fifoPaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // Paginate (5 batches per page)
    const paginated = window.paginateArray(activeFIFO, window._currentFifoPage, 5);
    
    if (window._currentFifoPage > paginated.totalPages) {
        window._currentFifoPage = paginated.totalPages;
    }
    
    paginated.data.forEach(batch => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        const ing = state.ingredients.find(i => i.code === batch.ingredientCode);
        const name = ing ? ing.name : batch.ingredientCode;
        
        // Days until expiration relative to Simulated Date
        const expDate = new Date(batch.expiryDate);
        const diffTime = expDate - simDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let expBadge = "";
        let remainingClass = "font-semibold";
        
        if (diffDays < 0) {
            expBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Expired</span>`;
            remainingClass = "text-red-700 font-semibold line-through";
        } else if (diffDays <= 2) {
            expBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Critical (${diffDays}d)</span>`;
        } else {
            expBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">${diffDays} Days Left</span>`;
        }
        
        // Perishability Alert for weekend shutdown (FR3)
        const simDay = simDate.getDay();
        const expDay = expDate.getDay();
        
        let hazardWarning = "";
        const isHighlyPerishable = ["i3", "i5"].includes(batch.ingredientCode);
        
        if (isHighlyPerishable && diffDays >= 0) {
            const willExpireBeforeMon = diffDays <= (5 - simDay);
            if (willExpireBeforeMon && (expDay === 5 || expDay === 6 || expDay === 0)) {
                hazardWarning = `
                    <div class="flex items-center gap-1 mt-1 text-amber-700 text-[11px] font-bold">
                        <span class="material-symbols-outlined text-xs">warning</span>
                        Non-Ops Hazard: Spoilage risk during weekend!
                    </div>
                `;
            }
        }
        
        row.innerHTML = `
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${batch.ingredientCode.toUpperCase()}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${name}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${batch.id}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${batch.dateReceived}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${window.fmtQty(batch.originalQty, ing ? ing.unit : 'g')}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 ${remainingClass}">${window.fmtQty(batch.remainingQty, ing ? ing.unit : 'g')}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${expBadge}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${hazardWarning || '<span class="text-on-surface-variant">-</span>'}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 font-medium">
                <button class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onclick="discardFIFOBatch('${batch.id}')">
                    <span class="material-symbols-outlined text-sm">delete_forever</span> Discard
                </button>
            </td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("fifoPaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentFifoPage = newPage;
        renderFIFOQueueTable();
    });
}

// Discard/write-off a FIFO perishable batch
window.discardFIFOBatch = async function(batchId) {
    const ok = await window.showConfirm({
        title: "Discard FIFO Batch",
        message: "This permanently removes the remaining quantity from central stock as wastage.",
        confirmText: "Discard Batch",
        danger: true
    });
    if (!ok) return;
    
    const state = window.BlissburnState;
    
    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/fifo/${batchId}/discard`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Discard failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Discard Failed", e.message);
            return;
        }
    } else {
        const batch = state.fifoQueue.find(b => b.id === batchId);
        if (!batch || batch.remainingQty <= 0) return;
        const ing = state.ingredients.find(i => i.code === batch.ingredientCode);
        if (ing) ing.stock -= batch.remainingQty;
        batch.remainingQty = 0;
        saveState();
    }
    
    renderFIFOQueueTable();
    renderCentralStockLedger();
    addNotification('warning', 'FIFO Batch Discarded', `Batch ${batchId} written off from inventory.`);
};

// Sub-Tab Switcher
function setupInventorySubTabs() {
    const tabs = document.querySelectorAll(".section-tabs .sub-tab-btn");
    const subSections = document.querySelectorAll(".inventory-subview-section");
    
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            const targetId = tab.getAttribute("data-inventory-sub");
            subSections.forEach(sec => sec.classList.remove("active"));
            document.getElementById(`inventory-${targetId}`).classList.add("active");
            
            // Re-render subview data
            renderFIFOQueueTable();
            renderCentralStockLedger();
        };
    });
}

// Setup Stock Replenishment Dialog & Intake processing
function setupInventoryReplenishForm() {
    const openBtn = document.getElementById("replenishStockBtn");
    const closeBtn = document.getElementById("closeReplenishDialog");
    const dialog = document.getElementById("replenishStockDialog");
    const select = document.getElementById("repIngredientSelect");
    const unitLabel = document.getElementById("repUnitLabel");
    const warningAlert = document.getElementById("fifoPerishableAlert");
    const dateInput = document.getElementById("repDate");
    const form = document.getElementById("replenishForm");
    
    // Load ingredients in dropdown select
    const state = window.BlissburnState;
    select.innerHTML = "";
    state.ingredients.forEach(ing => {
        const option = document.createElement("option");
        option.value = ing.code;
        option.innerText = ing.name;
        select.appendChild(option);
    });
    
    // Open Dialog
    openBtn.onclick = () => {
        dateInput.value = state.simulatedDate;
        select.onchange(); // trigger label check
        dialog.showModal();
    };
    
    closeBtn.onclick = () => dialog.close();
    
    // Changing selected ingredient changes unit labeling and warnings
    select.onchange = () => {
        const ing = state.ingredients.find(i => i.code === select.value);
        if (ing) {
            unitLabel.innerText = ing.unit === "g" ? "kg" : ing.unit;
            if (ing.isPerishable) {
                warningAlert.style.display = "flex";
            } else {
                warningAlert.style.display = "none";
            }
        }
    };
    
    // Process Replenishment
    form.onsubmit = (e) => {
        e.preventDefault();
        
        const ingCode = select.value;
        const qty = Number(document.getElementById("repQuantity").value);
        const recDateStr = dateInput.value;
        
        const ing = state.ingredients.find(i => i.code === ingCode);
        
        // Convert to grams if unit is grams
        const quantityInGrams = ing.unit === "g" ? qty * 1000 : qty;
        
        // Add to central stock
        ing.stock += quantityInGrams;
        
        // If perishable, push a new batch to the FIFO queue
        if (ing.isPerishable) {
            // Perishable shelf life: Butter = 7 days, Yeast = 7 days
            const shelfLifeDays = 7;
            const exp = new Date(recDateStr);
            exp.setDate(exp.getDate() + shelfLifeDays);
            const expDateStr = exp.toISOString().split('T')[0];
            
            const nextBatchId = `f-${100 + state.fifoQueue.length + 1}`;
            
            state.fifoQueue.push({
                id: nextBatchId,
                ingredientCode: ingCode,
                dateReceived: recDateStr,
                originalQty: quantityInGrams,
                remainingQty: quantityInGrams,
                expiryDate: expDateStr
            });
            
            addNotification("success", "FIFO Batch Received", `Perishable ${ing.name} batch ${nextBatchId} received on ${recDateStr}. Expiry ${expDateStr}.`);
        } else {
            addNotification("success", "Stock Replenished", `Central stock for ${ing.name} increased by ${qty} ${ing.unit === 'g' ? 'kg' : ing.unit}.`);
        }
        
        saveState();
        
        // Reset form and close
        form.reset();
        dialog.close();
        
        // Refresh views
        renderCentralStockLedger();
        renderFIFOQueueTable();
        
        // Post timeline entry
        state.financialLog.push({
            id: `TXN-${state.financialLog.length + 5001}`,
            date: recDateStr,
            description: `Inventory Replenishment of ${ing.name} (+${qty} ${ing.unit === 'g' ? 'kg' : ing.unit})`,
            method: "purchase",
            amount: -(qty * (Number(ing.unitCost) || 0)) // stock purchase = money out at standard unit cost
        });
        saveState();
    };
}

function setupBOMSuiteForms() {
    const addProductBtn = document.getElementById("addProductBtn");
    const addProductDialog = document.getElementById("addProductDialog");
    const closeAddProductDialog = document.getElementById("closeAddProductDialog");
    const addProductForm = document.getElementById("addProductForm");
    const addNewProdIngredientRowBtn = document.getElementById("addNewProdIngredientRowBtn");
    const newProdBOMList = document.getElementById("newProdBOMList");

    const editRecipeDialog = document.getElementById("editRecipeDialog");
    const closeEditRecipeDialog = document.getElementById("closeEditRecipeDialog");
    const editRecipeForm = document.getElementById("editRecipeForm");
    const addEditRecipeIngredientRowBtn = document.getElementById("addEditRecipeIngredientRowBtn");
    const editRecipeBOMList = document.getElementById("editRecipeBOMList");

    const state = window.BlissburnState;

    // Helper: Create a dynamic ingredient row
    function createIngredientRow(container, initialCode = "", initialQty = "") {
        const row = document.createElement("div");
        row.className = "ingredient-row flex gap-2 items-center mb-2";

        const select = document.createElement("select");
        select.className = "ing-select flex-1 bg-surface-container border border-outline-variant/50 rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container";
        select.required = true;

        state.ingredients.forEach(ing => {
            const opt = document.createElement("option");
            opt.value = ing.code;
            opt.innerText = `${ing.name} (${ing.code.toUpperCase()})`;
            if (ing.code === initialCode) opt.selected = true;
            select.appendChild(opt);
        });

        const input = document.createElement("input");
        input.type = "number";
        input.className = "ing-qty w-24 bg-surface-container border border-outline-variant/50 rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container text-right";
        input.min = "1";
        input.value = initialQty || "10";
        input.required = true;

        const label = document.createElement("span");
        label.className = "text-xs text-on-surface-variant";
        label.innerText = "g";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "p-1.5 rounded-full hover:bg-red-100 transition-colors text-red-600";
        deleteBtn.innerHTML = '<span class="material-symbols-outlined text-sm">delete</span>';
        deleteBtn.onclick = () => row.remove();

        row.appendChild(select);
        row.appendChild(input);
        row.appendChild(label);
        row.appendChild(deleteBtn);

        container.appendChild(row);
    }

    // Add Product Modal setup
    if (addProductBtn) {
        addProductBtn.onclick = () => {
            newProdBOMList.innerHTML = "";
            // Default 1 row
            createIngredientRow(newProdBOMList);
            addProductDialog.showModal();
        };
    }
    if (closeAddProductDialog) {
        closeAddProductDialog.onclick = () => addProductDialog.close();
    }
    if (addNewProdIngredientRowBtn) {
        addNewProdIngredientRowBtn.onclick = () => createIngredientRow(newProdBOMList);
    }

    // Edit Recipe Modal closing
    if (closeEditRecipeDialog) {
        closeEditRecipeDialog.onclick = () => editRecipeDialog.close();
    }
    if (addEditRecipeIngredientRowBtn) {
        addEditRecipeIngredientRowBtn.onclick = () => createIngredientRow(editRecipeBOMList);
    }

    // Add Product Form submit
    if (addProductForm) {
        addProductForm.onsubmit = async (e) => {
            e.preventDefault();

            const name = document.getElementById("newProdName").value.trim();
            const category = document.getElementById("newProdCategory").value;
            const retailPrice = Number(document.getElementById("newProdRetail").value);
            const wholesalePrice = Number(document.getElementById("newProdWholesale").value);
            const shelfLife = Number(document.getElementById("newProdShelfLife").value);
            const icon = document.getElementById("newProdIcon").value.trim();

            // Build BOM object
            const bom = {};
            const rows = newProdBOMList.querySelectorAll(".ingredient-row");
            let hasDuplicates = false;

            rows.forEach(row => {
                const code = row.querySelector(".ing-select").value;
                const qty = Number(row.querySelector(".ing-qty").value);

                if (bom[code] !== undefined) {
                    hasDuplicates = true;
                }
                bom[code] = qty;
            });

            if (hasDuplicates) {
                showToast("danger", "Validation Error", "You have selected duplicate ingredients in your recipe.");
                return;
            }

            if (Object.keys(bom).length === 0) {
                showToast("danger", "Validation Error", "A recipe requires at least one ingredient mapping.");
                return;
            }

            const dailyTarget = Number(document.getElementById("newProdDailyTarget")?.value) || 100;
            const productData = { name, category, retailPrice, wholesalePrice, shelfLife, icon, dailyTarget, bom };

            try {
                if (window.BACKEND_AVAILABLE && window.apiCreateProduct) {
                    await window.apiCreateProduct(productData);
                } else {
                    // Fallback local mockup mode
                    const nextId = `p${state.products.length + 1}`;
                    state.products.push({ id: nextId, ...productData });
                    saveState();
                }

                addProductForm.reset();
                addProductDialog.close();
                renderRecipeBOMConfiguration();
                
                // Refresh drop-downs globally
                if (window.renderPOS) window.renderPOS();
                if (window.renderProduction) window.renderProduction();
            } catch (err) {
                showToast("danger", "Product Creation Failed", err.message);
            }
        };
    }

    // Edit Recipe Form submit
    if (editRecipeForm) {
        editRecipeForm.onsubmit = async (e) => {
            e.preventDefault();

            const productId = document.getElementById("editRecipeProductId").value;
            const name = document.getElementById("editRecipeName").value.trim();
            const category = document.getElementById("editRecipeCategory").value;
            const retailPrice = Number(document.getElementById("editRecipeRetail").value);
            const wholesalePrice = Number(document.getElementById("editRecipeWholesale").value);
            const shelfLife = Number(document.getElementById("editRecipeShelfLife").value);
            const icon = document.getElementById("editRecipeIcon").value.trim();

            const bom = {};
            const rows = editRecipeBOMList.querySelectorAll(".ingredient-row");
            let hasDuplicates = false;

            rows.forEach(row => {
                const code = row.querySelector(".ing-select").value;
                const qty = Number(row.querySelector(".ing-qty").value);

                if (bom[code] !== undefined) {
                    hasDuplicates = true;
                }
                bom[code] = qty;
            });

            if (hasDuplicates) {
                showToast("danger", "Validation Error", "You have selected duplicate ingredients in your recipe.");
                return;
            }

            if (Object.keys(bom).length === 0) {
                showToast("danger", "Validation Error", "A recipe requires at least one ingredient mapping.");
                return;
            }

            const dailyTarget = Number(document.getElementById("editRecipeDailyTarget")?.value) || 100;
            const productData = { name, category, retailPrice, wholesalePrice, shelfLife, icon, dailyTarget, bom };

            try {
                if (window.BACKEND_AVAILABLE && window.apiUpdateProduct) {
                    await window.apiUpdateProduct(productId, productData);
                } else {
                    // Fallback local mockup
                    const prod = state.products.find(p => p.id === productId);
                    if (prod) {
                        Object.assign(prod, productData);
                        saveState();
                    }
                }

                editRecipeForm.reset();
                editRecipeDialog.close();
                renderRecipeBOMConfiguration();
                
                if (window.renderPOS) window.renderPOS();
                if (window.renderProduction) window.renderProduction();
            } catch (err) {
                showToast("danger", "BOM Recipe Update Failed", err.message);
            }
        };
    }

    // Register global edit recipe open trigger
    window.openEditRecipeDialog = function(productId) {
        const prod = state.products.find(p => p.id === productId);
        if (!prod) return;

        document.getElementById("editRecipeProductId").value = productId;
        document.getElementById("editRecipeName").value = prod.name;
        document.getElementById("editRecipeCategory").value = prod.category;
        document.getElementById("editRecipeRetail").value = prod.retailPrice;
        document.getElementById("editRecipeWholesale").value = prod.wholesalePrice;
        document.getElementById("editRecipeShelfLife").value = prod.shelfLife;
        document.getElementById("editRecipeIcon").value = prod.icon;
        const editTargetInput = document.getElementById("editRecipeDailyTarget");
        if (editTargetInput) editTargetInput.value = prod.dailyTarget || 100;

        editRecipeBOMList.innerHTML = "";
        
        const bom = prod.bom || {};
        for (let code in bom) {
            createIngredientRow(editRecipeBOMList, code, bom[code]);
        }

        if (Object.keys(bom).length === 0) {
            createIngredientRow(editRecipeBOMList);
        }

        editRecipeDialog.showModal();
    };
}

// Product Deletion
window.deleteProduct = async function(productId) {
    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === productId);
    if (!prod) return;
    
    // Check local production history
    const usedInLogs = state.productionLogs && state.productionLogs.some(log => log.product === prod.name);
    if (usedInLogs) {
        showToast("warning", "Cannot Delete Product", `'${prod.name}' has logged production batches in history. Clear production history first.`);
        return;
    }

    const ok = await window.showConfirm({
        title: "Delete Product",
        message: `Permanently delete "${prod.name}" along with its recipe and metadata?`,
        confirmText: "Delete Product",
        danger: true
    });
    if (!ok) return;

    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/products/${productId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Delete Failed", e.message);
            return;
        }
    } else {
        state.products = state.products.filter(p => p.id !== productId);
        saveState();
    }
    
    renderRecipeBOMConfiguration();
    if (window.renderPOS) window.renderPOS();
    if (window.renderProduction) window.renderProduction();
    
    addNotification('info', 'Product Deleted', `Product "${prod.name}" has been deleted.`);
};

// Ingredient Add / Edit Modal setup
document.addEventListener("DOMContentLoaded", () => {
    // Stock Adjustment Modal setup
    const adjBtn = document.getElementById("adjustStockBtn");
    const closeAdjBtn = document.getElementById("closeAdjustStockDialog");
    const adjDialog = document.getElementById("adjustStockDialog");
    const adjForm = document.getElementById("adjustStockForm");
    
    if (adjBtn) {
        adjBtn.onclick = () => {
            const select = document.getElementById("adjIngredientSelect");
            const state = window.BlissburnState;
            select.innerHTML = "";
            state.ingredients.forEach(i => {
                const opt = document.createElement("option");
                opt.value = i.code;
                opt.innerText = `${i.name} (${i.code.toUpperCase()})`;
                select.appendChild(opt);
            });
            
            triggerAdjUnitLabel();
            select.onchange = () => triggerAdjUnitLabel();
            
            adjForm.reset();
            adjDialog.showModal();
        };
    }
    
    if (closeAdjBtn) {
        closeAdjBtn.onclick = () => adjDialog.close();
    }
    
    function triggerAdjUnitLabel() {
        const select = document.getElementById("adjIngredientSelect");
        const state = window.BlissburnState;
        const ing = state.ingredients.find(i => i.code === select.value);
        const label = document.getElementById("adjUnitLabel");
        if (ing && label) {
            label.innerText = ing.unit === "g" ? "kg" : ing.unit;
        }
    }
    
    if (adjForm) {
        adjForm.onsubmit = async (e) => {
            e.preventDefault();
            
            const ingCode = document.getElementById("adjIngredientSelect").value;
            const adjType = document.getElementById("adjType").value;
            const adjQtyInput = Number(document.getElementById("adjQuantity").value);
            const notes = document.getElementById("adjNotes").value.trim();
            
            const state = window.BlissburnState;
            const ing = state.ingredients.find(i => i.code === ingCode);
            if (!ing) return;
            
            const multiplier = ing.unit === "g" ? 1000 : 1;
            const changeVal = adjQtyInput * multiplier;
            
            if (ing.stock + changeVal < 0) {
                showToast("danger", "Insufficient Stock", `Cannot deduct ${Math.abs(adjQtyInput)} ${ing.unit === 'g' ? 'kg' : ing.unit} from available stock of ${(ing.stock/multiplier).toFixed(2)} ${ing.unit === 'g' ? 'kg' : ing.unit}.`);
                return;
            }
            
            if (window.BACKEND_AVAILABLE) {
                try {
                    const res = await fetch(`${window.location.origin}/api/ingredients/${ingCode}/adjust`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: adjType, quantity: changeVal, notes })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Adjustment failed');
                    await window.syncWithBackend();
                } catch (err) {
                    showToast("danger", "Adjustment Failed", err.message);
                    return;
                }
            } else {
                ing.stock += changeVal;

                if (changeVal < 0) {
                    const lossAmount = Math.abs(adjQtyInput) * (ing.unitCost || 0);
                    state.financialLog.push({
                        id: `TXN-${state.financialLog.length + 5001}`,
                        date: state.simulatedDate,
                        description: `Wastage Write-Off: ${adjType.toUpperCase()} - ${ing.name} (${adjQtyInput.toFixed(1)}${ing.unit === 'g' ? 'kg' : ing.unit}) - Notes: ${notes}`,
                        method: "cash",
                        amount: -lossAmount
                    });
                }
                
                state.notifications.push({
                    id: `n-${Date.now()}`,
                    type: changeVal < 0 ? "warning" : "success",
                    title: "Manual Stock Adjustment",
                    desc: `${ing.name} stock manually adjusted by ${adjQtyInput > 0 ? '+' : ''}${adjQtyInput} ${ing.unit === 'g' ? 'kg' : ing.unit}.`,
                    time: new Date().toISOString()
                });
                
                saveState();
            }
            
            adjDialog.close();
            renderCentralStockLedger();
            if (window.renderProduction) window.renderProduction();
            if (window.renderAccounts) window.renderAccounts();
            
            showToast("info", "Stock Adjusted", `${ing.name} stock has been successfully updated.`);
        };
    }

    const addIngBtn = document.getElementById("addIngredientBtn");
    const closeIngBtn = document.getElementById("closeAddIngredientDialog");
    const ingDialog = document.getElementById("addIngredientDialog");
    const ingForm = document.getElementById("addIngredientForm");
    
    if (addIngBtn) {
        addIngBtn.onclick = () => {
            document.getElementById("ingredientDialogTitle").innerText = "Register New Ingredient";
            document.getElementById("submitIngredientBtn").innerText = "Register Ingredient";
            document.getElementById("editIngredientCode").value = "";
            document.getElementById("ingCode").disabled = false;
            ingForm.reset();
            ingDialog.showModal();
        };
    }
    
    if (closeIngBtn) {
        closeIngBtn.onclick = () => ingDialog.close();
    }
    
    if (ingForm) {
        ingForm.onsubmit = async (e) => {
            e.preventDefault();
            
            const editCode = document.getElementById("editIngredientCode").value;
            const code = document.getElementById("ingCode").value.trim().toLowerCase();
            const name = document.getElementById("ingName").value.trim();
            const unit = document.getElementById("ingUnit").value;
            const threshold = window.qtyToBase(document.getElementById("ingThreshold").value, unit); // kg->g for 'g', as-is otherwise
            const unitCost = Number(document.getElementById("ingUnitCost")?.value) || 0;
            const isPerishable = document.getElementById("ingIsPerishable").checked;

            const state = window.BlissburnState;

            if (window.BACKEND_AVAILABLE) {
                try {
                    let res;
                    if (editCode) {
                        // PUT update
                        res = await fetch(`${window.location.origin}/api/ingredients/${editCode}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name, threshold, unit, unitCost, isPerishable })
                        });
                    } else {
                        // POST register
                        res = await fetch(`${window.location.origin}/api/ingredients`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code, name, stock: 0, unit, threshold, unitCost, isPerishable })
                        });
                    }

                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Operation failed');
                    await window.syncWithBackend();
                } catch (err) {
                    showToast("danger", "Ingredient Operation Failed", err.message);
                    return;
                }
            } else {
                // Offline fallback
                if (editCode) {
                    const ing = state.ingredients.find(i => i.code === editCode);
                    if (ing) {
                        ing.name = name;
                        ing.threshold = threshold;
                        ing.unit = unit;
                        ing.unitCost = unitCost;
                        ing.isPerishable = isPerishable;
                    }
                } else {
                    const existing = state.ingredients.find(i => i.code === code);
                    if (existing) {
                        showToast("danger", "Duplicate Code", `Ingredient with code '${code}' already exists.`);
                        return;
                    }
                    state.ingredients.push({
                        code,
                        name,
                        stock: 0,
                        unit,
                        threshold,
                        unitCost,
                        isPerishable
                    });
                }
                saveState();
            }
            
            ingForm.reset();
            ingDialog.close();
            renderCentralStockLedger();
            if (window.renderProduction) window.renderProduction();
            
            addNotification('success', editCode ? 'Ingredient Updated' : 'Ingredient Registered', `Ingredient "${name}" successfully processed.`);
        };
    }
});

// Edit Ingredient
window.editIngredient = function(code) {
    const state = window.BlissburnState;
    const ing = state.ingredients.find(i => i.code === code);
    if (!ing) return;
    
    document.getElementById("ingredientDialogTitle").innerText = "Edit Ingredient Properties";
    document.getElementById("submitIngredientBtn").innerText = "Update Ingredient";
    document.getElementById("editIngredientCode").value = code;
    
    document.getElementById("ingCode").value = code.toUpperCase();
    document.getElementById("ingCode").disabled = true; // disable editing code
    
    document.getElementById("ingName").value = ing.name;
    document.getElementById("ingThreshold").value = window.qtyFromBase(ing.threshold, ing.unit).toFixed(1); // g->kg for 'g', as-is otherwise
    document.getElementById("ingUnit").value = ing.unit;
    const unitCostInput = document.getElementById("ingUnitCost");
    if (unitCostInput) unitCostInput.value = ing.unitCost || 0;
    document.getElementById("ingIsPerishable").checked = ing.isPerishable;
    
    document.getElementById("addIngredientDialog").showModal();
};

// Delete Ingredient
window.deleteIngredient = async function(code) {
    const state = window.BlissburnState;
    const ing = state.ingredients.find(i => i.code === code);
    if (!ing) return;
    
    // Check if ingredient is used in any product recipe BOMs locally
    const usedInBOM = state.products.some(prod => prod.bom && prod.bom[code] !== undefined);
    if (usedInBOM) {
        showToast("warning", "Cannot Delete Ingredient", `'${ing.name}' is used in one or more product recipes.`);
        return;
    }

    // Check if there are active perishable batches in stock
    const activeBatches = state.fifoQueue && state.fifoQueue.some(b => b.ingredientCode === code && b.remainingQty > 0);
    if (activeBatches) {
        showToast("warning", "Cannot Delete Ingredient", `'${ing.name}' has active perishable batches in inventory.`);
        return;
    }

    const ok = await window.showConfirm({
        title: "Delete Ingredient",
        message: `Permanently remove "${ing.name}" from the raw materials register?`,
        confirmText: "Delete Ingredient",
        danger: true
    });
    if (!ok) return;

    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/ingredients/${code}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Delete Failed", e.message);
            return;
        }
    } else {
        state.ingredients = state.ingredients.filter(i => i.code !== code);
        saveState();
    }
    
    renderCentralStockLedger();
    if (window.renderProduction) window.renderProduction();
    
    addNotification('info', 'Ingredient Deleted', `Ingredient "${ing.name}" deleted from raw materials register.`);
};
