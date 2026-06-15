/* ==========================================================================
   BLISSBURN ERP - POINT OF SALE (POS) BILLING MODULE (pos.js)
   ========================================================================== */

// Map FontAwesome icon classes to Material Symbols names
function mapFAToMaterial(faIcon) {
    const map = {
        'fa-cookie-bite': 'cookie', 'fa-bread-slice': 'bakery_dining', 'fa-square': 'square',
        'fa-cookie': 'cookie', 'fa-wheat-awn': 'grain'
    };
    return map[faIcon] || 'category';
}

// POS specific local state
let posCart = [];
let selectedCustomerType = "B2C"; // B2C or B2B
let selectedPartnerId = null;
let posGrandTotalValue = 0; // last computed grand total, used by the change calculator

// Sellable stock = active production batches that have NOT expired.
// Expired fresh goods must never be offered for sale.
function getSellableStock(productName) {
    const state = window.BlissburnState;
    return state.productionLogs
        .filter(b => b.product === productName && b.active && b.expiryDate >= state.simulatedDate)
        .reduce((sum, b) => sum + b.qty, 0);
}

// Initialize POS view hook
window.renderPOS = function() {
    loadB2BCustomerSelectOptions();
    setupCustomerSearch();
    renderProductCatalog();
    renderCart();
    setupPOSEventListeners();
};

// Searchable customer picker layered over the (hidden) #posCustomerSelect, which
// stays the source of truth for checkout, pricing, and credit logic.
function setupCustomerSearch() {
    const select = document.getElementById("posCustomerSelect");
    const input = document.getElementById("posCustomerSearchInput");
    const results = document.getElementById("posCustomerResults");
    const clearBtn = document.getElementById("posCustomerClear");
    if (!select || !input || !results) return;

    // Build the option model from the select so it always mirrors current partners
    const options = [...select.options].map(o => ({
        id: o.value,
        type: o.getAttribute("data-type"),
        label: o.value === "walkin" ? "Walk-in Customer" : o.innerText.replace(/\s*\(business\)\s*$/i, "")
    }));
    const labelFor = (id) => (options.find(o => o.id === id) || {}).label || "";

    // Reflect the active selection in the input
    input.value = labelFor(select.value || "walkin");

    const hide = () => results.classList.add("hidden");

    function pick(id) {
        select.value = id;
        select.dispatchEvent(new Event("change")); // reuse existing onchange (badge/credit/pricing)
        input.value = labelFor(id);
        hide();
    }

    function render(list) {
        if (!list.length) {
            results.innerHTML = `<div class="px-3 py-2 text-xs text-on-surface-variant">No matching customer</div>`;
            return;
        }
        results.innerHTML = list.map(o => `
            <button type="button" data-id="${o.id}" class="w-full text-left px-3 py-2 text-sm hover:bg-surface-container transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm text-on-surface-variant">${o.type === 'B2B' ? 'store' : 'person'}</span>
                <span class="flex-1 truncate">${o.label}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded ${o.type === 'B2B' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}">${o.type === 'B2B' ? 'Business' : 'Walk-in'}</span>
            </button>`).join("");
        results.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => pick(b.getAttribute("data-id")));
    }

    function show(filter) {
        const f = (filter || "").toLowerCase().trim();
        render(options.filter(o => o.label.toLowerCase().includes(f)));
        results.classList.remove("hidden");
    }

    input.oninput = () => show(input.value);
    input.onfocus = () => show("");          // focusing lists everyone
    if (clearBtn) clearBtn.onclick = () => { pick("walkin"); input.focus(); };

    // Hide the dropdown when clicking elsewhere (bind once)
    if (!setupCustomerSearch._outsideBound) {
        document.addEventListener("click", (e) => {
            const combo = document.getElementById("posCustomerCombo");
            const res = document.getElementById("posCustomerResults");
            if (combo && res && !combo.contains(e.target)) res.classList.add("hidden");
        });
        setupCustomerSearch._outsideBound = true;
    }
}

// Populate the customer selector in the cart header
function loadB2BCustomerSelectOptions() {
    const select = document.getElementById("posCustomerSelect");
    const state = window.BlissburnState;
    
    // Save current selection value to preserve it if rendering repeatedly
    const currentSel = select.value;
    
    // Clear dynamic options (keep walkin)
    select.innerHTML = '<option value="walkin" data-type="B2C">Walk-in Customer (normal price)</option>';
    
    state.partners.forEach(partner => {
        const option = document.createElement("option");
        option.value = partner.id;
        option.setAttribute("data-type", "B2B");
        option.innerText = `${partner.name} (business)`;
        select.appendChild(option);
    });
    
    if (currentSel) {
        select.value = currentSel;
    }
}

// Render the bakery product cards catalog
function renderProductCatalog(filterCat = "all", searchQuery = "") {
    const grid = document.getElementById("posProductsGrid");
    const state = window.BlissburnState;
    
    grid.innerHTML = "";
    
    // Determine active pricing tier based on selected customer
    const select = document.getElementById("posCustomerSelect");
    const selectedOption = select.options[select.selectedIndex];
    const isB2B = selectedOption.getAttribute("data-type") === "B2B";
    
    const filteredProducts = state.products.filter(prod => {
        const matchesCategory = filterCat === "all" || prod.category === filterCat;
        const matchesSearch = prod.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });
    
    if (filteredProducts.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center py-10">
                <span class="material-symbols-outlined text-4xl text-outline/30 mb-2">cookie</span>
                <p class="text-sm text-on-surface-variant">No products match your criteria.</p>
            </div>
        `;
        return;
    }
    
    filteredProducts.forEach(prod => {
        // Sellable stock excludes expired production batches
        const totalStock = getSellableStock(prod.name);

        const card = document.createElement("div");
        // Show indicator if product is in cart
        const cartItem = posCart.find(item => item.id === prod.id);
        card.className = `bg-surface-container-lowest rounded-2xl border border-outline-variant/50 p-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${cartItem ? 'ring-2 ring-primary-container' : ''}`;
        card.onclick = () => addToCart(prod.id);

        const indicator = cartItem ? `<div class="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center">${cartItem.qty}</div>` : '';

        // Determine active pricing tier
        const isB2B = select.options[select.selectedIndex].getAttribute("data-type") === "B2B";
        const activePrice = isB2B ? prod.wholesalePrice : prod.retailPrice;

        let priceLayout = `<p class="text-sm font-bold text-primary mt-2">LKR ${activePrice.toFixed(2)}</p>`;
        if (isB2B) {
            priceLayout += `<span class="text-[10px] text-tertiary font-medium">B2B Price</span>`;
        }

        const materialIcon = mapFAToMaterial(prod.icon);

        // Quick-quantity stepper so multi-unit sales don't need repeated card taps
        const inCartQty = cartItem ? cartItem.qty : 0;
        const stepper = `
            <div class="flex items-center justify-between gap-1 mt-2.5 bg-surface-container rounded-full p-1" data-stepper>
                <button class="w-7 h-7 flex items-center justify-center rounded-full bg-surface-container-lowest hover:bg-surface-container-high transition-colors disabled:opacity-30" data-step="-1" ${inCartQty === 0 ? 'disabled' : ''} aria-label="Remove one ${prod.name}">
                    <span class="material-symbols-outlined text-sm">remove</span>
                </button>
                <span class="text-sm font-bold min-w-6 text-center">${inCartQty}</span>
                <button class="w-7 h-7 flex items-center justify-center rounded-full bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-30" data-step="1" ${totalStock === 0 || inCartQty >= totalStock ? 'disabled' : ''} aria-label="Add one ${prod.name}">
                    <span class="material-symbols-outlined text-sm">add</span>
                </button>
            </div>
        `;

        card.innerHTML = `
            <div class="relative">
                ${indicator}
                <div class="w-full h-20 rounded-xl bg-surface-container flex items-center justify-center mb-3">
                    <span class="material-symbols-outlined text-3xl text-primary/60">${materialIcon}</span>
                </div>
                <p class="text-sm font-semibold text-on-surface truncate">${prod.name}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">Fresh Stock: <strong class="${totalStock === 0 ? 'text-red-700' : 'text-green-700'}">${totalStock} pcs</strong></p>
                ${priceLayout}
                ${stepper}
            </div>
        `;

        // Steppers act independently of the card's add-on-tap behavior
        const stepperWrap = card.querySelector('[data-stepper]');
        stepperWrap.onclick = (e) => e.stopPropagation();
        stepperWrap.querySelector('[data-step="1"]').onclick = (e) => { e.stopPropagation(); addToCart(prod.id); };
        stepperWrap.querySelector('[data-step="-1"]').onclick = (e) => { e.stopPropagation(); adjustCartQty(prod.id, -1); };

        grid.appendChild(card);
    });
}

// Add item to shopping cart
function addToCart(productId) {
    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === productId);
    if (!prod) return;

    // Check fresh (non-expired) production batch stock for this sale
    const totalStock = getSellableStock(prod.name);

    const cartItem = posCart.find(item => item.id === productId);
    const currentCartQty = cartItem ? cartItem.qty : 0;

    if (currentCartQty >= totalStock) {
        showToast("warning", "Insufficient Fresh Stock", `Only ${totalStock} units of ${prod.name} are available as fresh, non-expired stock.`);
        return;
    }
    
    if (cartItem) {
        cartItem.qty++;
    } else {
        posCart.push({
            id: prod.id,
            name: prod.name,
            retailPrice: prod.retailPrice,
            wholesalePrice: prod.wholesalePrice,
            qty: 1
        });
    }
    
    renderCart();
    renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
}

// Increment / Decrement quantities in cart
function adjustCartQty(productId, amount) {
    const item = posCart.find(i => i.id === productId);
    if (!item) return;
    
    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === productId);
    
    if (amount > 0) {
        // Stock check against fresh (non-expired) batches
        const totalStock = getSellableStock(prod.name);
        if (item.qty >= totalStock) {
            showToast("warning", "Stock Limit Reached", `Maximum ${totalStock} fresh units of ${prod.name} available.`);
            return;
        }
        item.qty++;
    } else {
        item.qty--;
        if (item.qty <= 0) {
            posCart = posCart.filter(i => i.id !== productId);
        }
    }
    
    renderCart();
    renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
}

// Set an absolute cart quantity (used by the typed quantity field). Clamps to
// fresh stock; 0 or blank removes the line.
window.setCartQty = function(productId, raw) {
    const item = posCart.find(i => i.id === productId);
    if (!item) return;
    const state = window.BlissburnState;
    const prod = state.products.find(p => p.id === productId);

    let q = parseInt(raw, 10);
    if (isNaN(q) || q < 0) q = item.qty; // ignore garbage, keep current

    if (q <= 0) {
        posCart = posCart.filter(i => i.id !== productId);
    } else {
        const totalStock = getSellableStock(prod.name);
        if (q > totalStock) {
            showToast("warning", "Stock Limit Reached", `Only ${totalStock} fresh units of ${prod.name} available.`);
            q = totalStock;
        }
        item.qty = q;
    }

    renderCart();
    renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
};

// Clear cart
function clearCart() {
    posCart = [];
    renderCart();
    renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
}

// Helper to find which category tab is active
function getActiveCategory() {
    const activeTab = document.querySelector("#posCategoryTabs .tab-btn.active");
    return activeTab ? activeTab.getAttribute("data-category") : "all";
}

// Render cart side drawer list and recalculate financial summaries
function renderCart() {
    const list = document.getElementById("posCartItemsList");
    const select = document.getElementById("posCustomerSelect");
    const isB2B = select.options[select.selectedIndex].getAttribute("data-type") === "B2B";
    
    list.innerHTML = "";
    
    if (posCart.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-center">
                <span class="material-symbols-outlined text-4xl text-outline/40 mb-2">shopping_basket</span>
                <p class="text-sm font-medium text-on-surface-variant">Cart is currently empty</p>
                <span class="text-xs text-outline">Tap catalog cards to add baked goods</span>
            </div>
        `;
        document.getElementById("posSubtotal").innerText = "LKR 0.00";
        document.getElementById("posDiscount").innerText = "- LKR 0.00";
        document.getElementById("posTaxAmount").innerText = "LKR 0.00";
        document.getElementById("posGrandTotal").innerText = "LKR 0.00";
        document.getElementById("posCheckoutBtn").disabled = true;
        posGrandTotalValue = 0;
        updateChangeDue();
        return;
    }
    
    let subtotal = 0;
    let grandTotal = 0;
    
    posCart.forEach(item => {
        const itemUnitPrice = isB2B ? item.wholesalePrice : item.retailPrice;
        const itemLineTotal = itemUnitPrice * item.qty;
        
        subtotal += item.retailPrice * item.qty;
        grandTotal += itemLineTotal;
        
        const line = document.createElement("div");
        line.className = "flex items-center gap-3 py-3 border-b border-outline-variant/20 last:border-none";
        line.innerHTML = `
            <div class="flex-1 min-w-0">
                <span class="text-sm font-medium text-on-surface block truncate">${item.name}</span>
                <span class="text-xs text-on-surface-variant">@ LKR ${itemUnitPrice.toFixed(2)}</span>
            </div>
            <div class="flex items-center gap-1.5">
                <button class="w-7 h-7 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors" onclick="adjustCartQty('${item.id}', -1)"><span class="material-symbols-outlined text-sm">remove</span></button>
                <input type="number" min="1" value="${item.qty}" onchange="setCartQty('${item.id}', this.value)" aria-label="Quantity for ${item.name}"
                    class="w-12 text-center text-sm font-semibold bg-surface-container border border-outline-variant/40 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-primary-container">
                <button class="w-7 h-7 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors" onclick="adjustCartQty('${item.id}', 1)"><span class="material-symbols-outlined text-sm">add</span></button>
            </div>
            <span class="text-sm font-semibold text-on-surface ml-auto whitespace-nowrap">LKR ${itemLineTotal.toFixed(2)}</span>
        `;
        list.appendChild(line);
    });
    
    const discount = subtotal - grandTotal;
    const netSubtotal = grandTotal;
    
    // Tax VAT calculation
    const defaultVAT = (window.BlissburnState.globalConfig && window.BlissburnState.globalConfig.defaultVAT) !== undefined ? window.BlissburnState.globalConfig.defaultVAT : 8;
    const taxSelect = document.getElementById("posTaxRate");
    if (taxSelect && !taxSelect.dataset.initialized) {
        taxSelect.value = defaultVAT;
        taxSelect.dataset.initialized = "true";
    }
    const taxRatePercent = Number(taxSelect ? taxSelect.value : defaultVAT);
    const taxAmount = netSubtotal * (taxRatePercent / 100);
    grandTotal = netSubtotal + taxAmount;
    
    document.getElementById("posSubtotal").innerText = `LKR ${subtotal.toFixed(2)}`;
    document.getElementById("posDiscount").innerText = `- LKR ${discount.toFixed(2)}`;
    document.getElementById("posTaxAmount").innerText = `LKR ${taxAmount.toFixed(2)} (${taxRatePercent}%)`;
    document.getElementById("posGrandTotal").innerText = `LKR ${grandTotal.toFixed(2)}`;

    // Enable checkout button
    document.getElementById("posCheckoutBtn").disabled = false;

    posGrandTotalValue = grandTotal;
    updateChangeDue();

    // Verify credit limits for B2B accounts
    evaluateB2BCreditAvailability(grandTotal);
}

// Cash change calculator: shows the tendered-amount field for cash sales and
// renders CHANGE DUE in large type so the cashier never does mental math
function updateChangeDue() {
    const block = document.getElementById("cashTenderBlock");
    const tenderedInput = document.getElementById("posTendered");
    const changeDisplay = document.getElementById("posChangeDue");
    if (!block || !tenderedInput || !changeDisplay) return;

    const activePay = document.querySelector(".payment-options-grid .pay-opt.active");
    const isCash = activePay && activePay.getAttribute("data-method") === "cash";

    if (!isCash || posCart.length === 0) {
        block.classList.add("hidden");
        return;
    }

    block.classList.remove("hidden");
    const tendered = Number(tenderedInput.value);

    if (!tenderedInput.value || tendered <= 0) {
        changeDisplay.classList.add("hidden");
        return;
    }

    changeDisplay.classList.remove("hidden");
    const change = tendered - posGrandTotalValue;
    if (change >= 0) {
        changeDisplay.className = "mt-2 text-center rounded-xl px-3 py-2.5 bg-green-100 border border-green-300";
        changeDisplay.innerHTML = `<span class="block text-[10px] uppercase tracking-wider font-semibold text-green-800">Change Due</span><span class="block text-2xl font-display font-bold text-green-800">LKR ${change.toFixed(2)}</span>`;
    } else {
        changeDisplay.className = "mt-2 text-center rounded-xl px-3 py-2.5 bg-red-100 border border-red-300";
        changeDisplay.innerHTML = `<span class="block text-[10px] uppercase tracking-wider font-semibold text-red-800">Insufficient — Short By</span><span class="block text-2xl font-display font-bold text-red-800">LKR ${Math.abs(change).toFixed(2)}</span>`;
    }
}

// B2B credit validation logic (prevent outstanding limit breaches)
function evaluateB2BCreditAvailability(grandTotal) {
    const select = document.getElementById("posCustomerSelect");
    const activeOption = select.options[select.selectedIndex];
    const isB2B = activeOption.getAttribute("data-type") === "B2B";
    const creditBtn = document.querySelector('[data-method="credit"]');
    const creditLabel = document.getElementById("b2bCreditInfo");
    
    if (!isB2B) {
        creditBtn.classList.add("disabled");
        creditBtn.disabled = true;
        creditLabel.classList.add("hidden");
        // Swap active pay method back to cash if credit was selected
        const currentActive = document.querySelector(".payment-options-grid .pay-opt.active");
        if (currentActive && currentActive.getAttribute("data-method") === "credit") {
            document.querySelector('[data-method="cash"]').click();
        }
        return;
    }
    
    // Enable B2B credit option button
    creditBtn.classList.remove("disabled");
    creditBtn.disabled = false;
    creditLabel.classList.remove("hidden");
    
    const state = window.BlissburnState;
    const partner = state.partners.find(p => p.id === select.value);
    
    if (partner) {
        const availableCredit = partner.limit - partner.balance;
        if (grandTotal > availableCredit) {
            // Over credit limit! Block checkout via credit
            creditBtn.classList.add("disabled");
            creditBtn.disabled = true;
            creditLabel.innerHTML = `<span class="text-red-700 flex items-center gap-1"><span class="material-symbols-outlined text-xs">cancel</span> Exceeds Credit limit! (Avail: LKR ${(availableCredit).toFixed(0)})</span>`;
            
            // If credit pay mode is currently toggled active, force back to Cash
            const activePay = document.querySelector(".payment-options-grid .pay-opt.active");
            if (activePay && activePay.getAttribute("data-method") === "credit") {
                document.querySelector('[data-method="cash"]').click();
            }
        } else {
            creditLabel.innerHTML = `<span class="text-green-700 flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> Credit line approved. (Avail: LKR ${(availableCredit/1000).toFixed(0)}k)</span>`;
        }
    }
}

// Set up DOM interaction listeners for catalog, search, billing types
function setupPOSEventListeners() {
    const search = document.getElementById("posSearch");
    const select = document.getElementById("posCustomerSelect");
    const catBtns = document.querySelectorAll("#posCategoryTabs .tab-btn");
    const payBtns = document.querySelectorAll(".payment-options-grid .pay-opt");
    const checkoutBtn = document.getElementById("posCheckoutBtn");
    
    // Category Tabs toggle
    catBtns.forEach(btn => {
        btn.onclick = () => {
            catBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderProductCatalog(btn.getAttribute("data-category"), search.value);
        };
    });
    
    // Search typing listener
    search.oninput = () => {
        renderProductCatalog(getActiveCategory(), search.value);
    };
    
    // Customer profile changed
    select.onchange = () => {
        const opt = select.options[select.selectedIndex];
        const type = opt.getAttribute("data-type");
        const wholesaleBadge = document.getElementById("posWholesaleBadge");
        
        if (type === "B2B") {
            wholesaleBadge.classList.remove("hidden");
            // Auto click Credit as preferred method for B2B wholesale
            document.querySelector('[data-method="credit"]').click();
        } else {
            wholesaleBadge.classList.add("hidden");
            document.querySelector('[data-method="cash"]').click();
        }
        
        renderCart();
        renderProductCatalog(getActiveCategory(), search.value);
    };
    
    // Payment method buttons selection
    payBtns.forEach(btn => {
        btn.onclick = () => {
            if (btn.classList.contains("disabled")) return;
            payBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            updateChangeDue();
        };
    });

    // Cash tendered input — live change calculation
    const tenderedInput = document.getElementById("posTendered");
    if (tenderedInput) {
        tenderedInput.oninput = () => updateChangeDue();
    }
    
    // Tax VAT rate change listener
    const taxSelect = document.getElementById("posTaxRate");
    if (taxSelect) {
        taxSelect.onchange = () => renderCart();
    }
    
    // Complete Checkout Action
    checkoutBtn.onclick = () => executeCheckout();
    
    // Clear Cart button
    const clearCartBtn = document.getElementById("posClearCart");
    if (clearCartBtn) {
        clearCartBtn.onclick = () => clearCart();
    }
}

// Complete checkout processing and logging
function executeCheckout() {
    const state = window.BlissburnState;
    const select = document.getElementById("posCustomerSelect");
    const activeOption = select.options[select.selectedIndex];
    const isB2B = activeOption.getAttribute("data-type") === "B2B";
    const paymentMethod = document.querySelector(".payment-options-grid .pay-opt.active").getAttribute("data-method");
    
    let subtotal = 0;
    let grandTotal = 0;
    
    posCart.forEach(item => {
        const itemUnitPrice = isB2B ? item.wholesalePrice : item.retailPrice;
        subtotal += item.retailPrice * item.qty;
        grandTotal += itemUnitPrice * item.qty;
    });
    
    const discount = subtotal - grandTotal;
    const invoiceDate = state.simulatedDate;
    
    // Generate Invoice ID
    const nextSeq = state.invoices.length + 1001;
    const invoiceId = isB2B ? `INV-2026-${String(state.invoices.filter(i=>i.customerType==="B2B").length + 1).padStart(4, '0')}` : `B2C-TXN-${nextSeq}`;
    
    let outstanding = 0;
    let invoiceStatus = "Paid";
    let dueDate = invoiceDate;
    
    // Calculate Tax VAT
    const taxRatePercent = Number(document.getElementById("posTaxRate")?.value || 8);
    const taxAmount = grandTotal * (taxRatePercent / 100);
    grandTotal = grandTotal + taxAmount;
    
    // If credit terms are used, establish ledger terms
    if (isB2B && paymentMethod === "credit") {
        const partner = state.partners.find(p => p.id === select.value);
        outstanding = grandTotal;
        invoiceStatus = "Unpaid";
        
        const due = new Date(invoiceDate);
        due.setDate(due.getDate() + Number(partner.terms));
        dueDate = due.toISOString().split('T')[0];
        
        // Accumulate B2B partner's credit outstandings balance
        partner.balance += grandTotal;
    }
    
    // 1. Deduct Product quantity from completed production batches using FIFO priority
    posCart.forEach(cartItem => {
        let qtyToDeplete = cartItem.qty;
        
        // Find completed active non-expired batches, sorted by oldest production date (FIFO)
        const productBatches = state.productionLogs
            .filter(b => b.product === cartItem.name && b.active && b.expiryDate >= state.simulatedDate)
            .sort((a, b) => new Date(a.dateProduced) - new Date(b.dateProduced));
            
        for (let batch of productBatches) {
            if (qtyToDeplete <= 0) break;
            
            if (batch.qty >= qtyToDeplete) {
                batch.qty -= qtyToDeplete;
                qtyToDeplete = 0;
            } else {
                qtyToDeplete -= batch.qty;
                batch.qty = 0;
            }
            
            // Mark batch deactivated if stock is fully sold out
            if (batch.qty === 0) {
                batch.active = false;
            }
        }
    });
    
    // 2. Register Invoice Record in master state
    const customerName = isB2B ? state.partners.find(p => p.id === select.value).name : "Walk-in Customer";
    
    const invoiceRecord = {
        id: invoiceId,
        customerType: isB2B ? "B2B" : "B2C",
        customerName: customerName,
        date: invoiceDate,
        total: subtotal,
        discount: discount,
        tax: taxAmount,
        taxRate: taxRatePercent,
        grandTotal: grandTotal,
        method: paymentMethod,
        outstanding: outstanding,
        dueDate: dueDate,
        paidAmount: paymentMethod === "credit" ? 0 : grandTotal,
        status: invoiceStatus,
        items: posCart.map(item => ({...item}))
    };
    
    state.invoices.push(invoiceRecord);
    
    // 3. Post transaction ledger entry
    state.financialLog.push({
        id: `TXN-${state.financialLog.length + 5001}`,
        date: invoiceDate,
        description: isB2B ? `B2B Invoice Billing ${invoiceId} (Method: ${paymentMethod.toUpperCase()})` : `B2C POS Sale ${invoiceId} (Cash/Card)`,
        method: paymentMethod,
        amount: grandTotal
    });
    
    saveState();
    
    // 4. Launch Thermal Receipt printout dialog preview
    launchReceiptDialog(invoiceRecord);
    
    // Clear and reset POS
    posCart = [];
    renderCart();
    renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
    
    addNotification("success", "POS Checkout Complete", `Sale ${invoiceId} logged successfully. Amount LKR ${grandTotal.toFixed(2)}.`);
}

// Render thermal receipt paper layout inside dialog
function launchReceiptDialog(invoice, cartItems) {
    const dialog = document.getElementById("receiptDialog");
    
    document.getElementById("rNum").innerText = invoice.invoiceNo || invoice.id;
    document.getElementById("rDate").innerText = invoice.date;

    // Bakery header details from Settings (fall back to defaults already in markup)
    const bcfg = (window.BlissburnState.bakeryConfig) || {};
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.innerText = val; };
    setText("rBizName", bcfg.name);
    setText("rBizAddr", bcfg.address);
    setText("rBizPhone", bcfg.phone);
    
    const state = window.BlissburnState;
    // Show who actually created the sale (stored on the invoice); fall back to active role
    const fallbackOperator = state.currentRole === "admin" ? "Owner / Admin" : (state.currentRole === "sales" ? "POS Register" : "System Operator");
    document.getElementById("rOperator").innerText = invoice.createdByName || fallbackOperator;
    document.getElementById("rCustomer").innerText = invoice.customerName;

    // Edit-audit line — only shown when an admin has corrected this invoice
    const editedRow = document.getElementById("rEditedRow");
    if (editedRow) {
        if ((invoice.editCount || 0) > 0 && invoice.lastEditedByName) {
            const when = invoice.lastEditedAt ? new Date(invoice.lastEditedAt).toLocaleDateString() : "";
            document.getElementById("rEdited").innerText = `${invoice.lastEditedByName}${when ? " on " + when : ""}`;
            editedRow.classList.remove("hidden");
        } else {
            editedRow.classList.add("hidden");
        }
    }

    const itemsBody = document.getElementById("receiptItemsBody");
    itemsBody.innerHTML = "";
    
    const isB2B = invoice.customerType === "B2B";
    
    const receiptItems = cartItems || posCart;
    receiptItems.forEach(item => {
        const itemUnitPrice = isB2B ? item.wholesalePrice : item.retailPrice;
        const lineTotal = itemUnitPrice * item.qty;
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="py-1.5">${item.name}</td>
            <td class="py-1.5 text-center">${item.qty}</td>
            <td class="py-1.5 text-right">${itemUnitPrice.toFixed(0)}</td>
            <td class="py-1.5 text-right">${lineTotal.toFixed(0)}</td>
        `;
        itemsBody.appendChild(row);
    });
    
    const taxAmount = invoice.tax !== undefined ? invoice.tax : 0;
    const taxRatePercent = invoice.taxRate !== undefined ? invoice.taxRate : 0;
    
    document.getElementById("rSub").innerText = `LKR ${invoice.total.toFixed(2)}`;
    document.getElementById("rDisc").innerText = `- LKR ${invoice.discount.toFixed(2)}`;
    document.getElementById("rTax").innerText = `LKR ${taxAmount.toFixed(2)} (${taxRatePercent}% VAT)`;
    document.getElementById("rTotal").innerText = `LKR ${invoice.grandTotal.toFixed(2)}`;
    
    let paymentDesc = "Cash Payment";
    if (invoice.method === "card") paymentDesc = "Card swipe";
    if (invoice.method === "credit") paymentDesc = `B2B Credit (${invoice.status})`;
    document.getElementById("rMode").innerText = paymentDesc;

    // Cash tendered & change lines (only when the cashier entered a tender amount)
    const tenderedInput = document.getElementById("posTendered");
    const tenderedRow = document.getElementById("rTenderedRow");
    const changeRow = document.getElementById("rChangeRow");
    const tendered = tenderedInput ? Number(tenderedInput.value) : 0;
    if (invoice.method === "cash" && tendered >= invoice.grandTotal && tendered > 0) {
        tenderedRow.classList.remove("hidden");
        changeRow.classList.remove("hidden");
        document.getElementById("rTendered").innerText = `LKR ${tendered.toFixed(2)}`;
        document.getElementById("rChange").innerText = `LKR ${(tendered - invoice.grandTotal).toFixed(2)}`;
    } else {
        tenderedRow.classList.add("hidden");
        changeRow.classList.add("hidden");
    }
    if (tenderedInput) tenderedInput.value = "";

    // Optional SMS receipt row — only when SMS is enabled in Settings
    const smsRow = document.getElementById("receiptSmsRow");
    const smsPhone = document.getElementById("receiptSmsPhone");
    const smsBtn = document.getElementById("sendReceiptSmsBtn");
    const smsEnabled = window.BlissburnState.globalConfig && window.BlissburnState.globalConfig.smsEnabled;
    if (smsRow) {
        if (smsEnabled && (invoice.id || invoice.invoiceNo)) {
            smsRow.style.display = "flex";
            if (smsPhone) smsPhone.value = invoice.customerPhone || "";
            if (smsBtn) smsBtn.onclick = async () => {
                if (window.requireOnline && !window.requireOnline("send a receipt SMS")) return;
                const phone = smsPhone.value.trim();
                if (!phone) { showToast("warning", "Enter a number", "Type the customer's mobile number first."); return; }
                try {
                    const res = await fetch(`${window.location.origin}/api/sms/receipt`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ invoiceId: invoice.id, phone })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Send failed");
                    showToast("success", "Receipt Sent", `Text receipt sent to ${phone}.`);
                } catch (e) {
                    showToast("danger", "SMS Failed", e.message);
                }
            };
        } else {
            smsRow.style.display = "none";
        }
    }

    // Show Modal dialog
    dialog.showModal();

    // Auto-print straight after checkout when enabled in Settings
    const autoPrint = window.BlissburnState.globalConfig && window.BlissburnState.globalConfig.autoPrintReceipt;
    if (autoPrint) {
        setTimeout(() => (window.printWithAnimation || window.print)('receipt'), 400);
    }

    document.getElementById("closeReceiptDialog").onclick = () => {
        dialog.close();
    };
}
