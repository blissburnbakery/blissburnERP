/* ==========================================================================
   BLISSBURN ERP - B2B DISTRIBUTION & INVOICING MODULE (b2b.js)
   ========================================================================== */

// Initialize B2B view hook
window.renderB2B = function() {
    renderB2BPartners();
    renderB2BInvoiceLedger();
    setupB2BEventListeners();
    
    // Bind search field for live B2B wholesale invoices filtering
    const searchInput = document.getElementById("b2bInvoiceSearch");
    if (searchInput) {
        searchInput.oninput = () => {
            window._currentB2BInvoicePage = 1;
            renderB2BInvoiceLedger();
        };
    }
    
    // Bind B2B wholesale invoices CSV export
    const exportBtn = document.getElementById("exportB2BInvoicesCSVBtn");
    if (exportBtn) {
        exportBtn.onclick = () => {
            const state = window.BlissburnState;
            const b2bInvoices = state.invoices.filter(i => i.customerType === "B2B");
            const headers = ["Invoice No", "Customer Name", "Billing Date", "Due Date", "Total Invoiced (LKR)", "Outstanding (LKR)", "Status"];
            const rows = b2bInvoices.map(i => [
                i.id,
                i.customerName,
                i.date,
                i.dueDate,
                i.grandTotal,
                i.outstanding,
                i.status
            ]);
            window.exportToCSV(headers, rows, "wholesale_invoices_ledger.csv");
        };
    }
};

// Render corporate wholesale clients directory
function renderB2BPartners() {
    const grid = document.getElementById("b2bPartnersList");
    const state = window.BlissburnState;
    
    grid.innerHTML = "";
    
    state.partners.forEach(partner => {
        const card = document.createElement("div");
        card.className = "bg-surface-container rounded-xl p-4 border border-outline-variant/30";
        
        // Compute credit usage percentage
        const usagePct = (partner.balance / partner.limit) * 100;
        
        // Progress bar styling based on credit health
        let barColor = "bg-green-500";
        if (usagePct >= 80) barColor = "bg-red-500";
        else if (usagePct >= 50) barColor = "bg-amber-500";
        
        card.innerHTML = `
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center">
                    <span class="text-sm font-bold text-on-secondary-container">${partner.name.substring(0,2).toUpperCase()}</span>
                </div>
                <div>
                    <h4 class="font-display font-bold text-on-surface text-sm">${partner.name}</h4>
                    <p class="text-[11px] text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-xs">location_on</span> ${partner.address}</p>
                </div>
            </div>
            
            <div class="flex justify-between text-xs py-1.5">
                <span class="text-on-surface-variant">Credit Balance</span>
                <span class="font-semibold text-on-surface">LKR ${partner.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
            </div>
            
            <div class="flex justify-between text-xs py-1.5">
                <span class="text-on-surface-variant">Credit Ceiling</span>
                <span class="font-semibold text-on-surface">LKR ${partner.limit.toLocaleString('en-US')}</span>
            </div>
            
            <div class="flex justify-between text-xs py-1.5">
                <span class="text-on-surface-variant">Payment Terms</span>
                <span class="font-semibold text-on-surface">${partner.terms}d credit</span>
            </div>
            
            <!-- Credit utilization progress bar -->
            <div class="mt-2">
                <div class="flex justify-between text-[10px] text-on-surface-variant mb-1">
                    <span>Credit Utilization</span>
                    <span>${usagePct.toFixed(0)}%</span>
                </div>
                <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div class="h-full ${barColor} rounded-full transition-all duration-500" style="width:${usagePct}%"></div>
                </div>
            </div>
            
            <div class="mt-3 flex gap-2 border-t border-outline-variant/20 pt-3">
                <button class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary-container/30 rounded-lg hover:bg-primary-container/60 transition-colors" onclick="editPartner('${partner.id}')">
                    <span class="material-symbols-outlined text-sm">edit</span> Edit
                </button>
                <button class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onclick="deletePartner('${partner.id}')">
                    <span class="material-symbols-outlined text-sm">delete</span> Delete
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Initialize B2B page state variables
window._currentB2BInvoicePage = 1;

// Render outstanding wholesale billing invoice table
function renderB2BInvoiceLedger() {
    const body = document.getElementById("b2bInvoiceTableBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    // Filter invoices to only show wholesale B2B shipments
    let b2bInvoices = state.invoices
        .filter(i => i.customerType === "B2B")
        .sort((a, b) => new Date(b.date) - new Date(a.date));
        
    const searchInput = document.getElementById("b2bInvoiceSearch");
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    if (filterText) {
        b2bInvoices = b2bInvoices.filter(i => 
            i.id.toLowerCase().includes(filterText) ||
            i.customerName.toLowerCase().includes(filterText) ||
            i.status.toLowerCase().includes(filterText)
        );
    }
        
    if (b2bInvoices.length === 0) {
        window.renderEmptyState("b2bInvoiceTableBody", 8, "No B2B invoices matching query.", "receipt");
        const paginationCtr = document.getElementById("b2bInvoicePaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // Paginate (5 invoices per page)
    const paginated = window.paginateArray(b2bInvoices, window._currentB2BInvoicePage, 5);
    
    if (window._currentB2BInvoicePage > paginated.totalPages) {
        window._currentB2BInvoicePage = paginated.totalPages;
    }
    
    paginated.data.forEach(inv => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        let pillClasses = "bg-blue-100 text-blue-800";
        if (inv.status === "Paid") pillClasses = "bg-green-100 text-green-800";
        if (inv.status === "Unpaid") pillClasses = "bg-amber-100 text-amber-800";
        if (inv.status === "Overdue") pillClasses = "bg-red-100 text-red-800";
        
        row.innerHTML = `
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${inv.id}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${inv.customerName}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${inv.date}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${inv.dueDate}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 font-medium">LKR ${inv.grandTotal.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 ${inv.outstanding > 0 ? 'font-semibold text-red-700' : 'text-green-700'}">LKR ${inv.outstanding.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30"><span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${pillClasses}">${inv.status}</span></td>
            <td class="px-4 py-3 border-t border-outline-variant/30"><button class="text-xs font-medium text-primary hover:underline flex items-center gap-1" onclick="viewInvoiceDocument('${inv.id}')"><span class="material-symbols-outlined text-sm">visibility</span> View</button></td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("b2bInvoicePaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentB2BInvoicePage = newPage;
        renderB2BInvoiceLedger();
    });
}

// Set up corporate client and dialog operations
function setupB2BEventListeners() {
    const openAddBtn = document.getElementById("addNewB2BPartnerBtn");
    const closeAddBtn = document.getElementById("closeAddB2BDialog");
    const addDialog = document.getElementById("addB2BPartnerDialog");
    const form = document.getElementById("addB2BPartnerForm");
    
    if (openAddBtn) {
        openAddBtn.onclick = () => {
            window._editingPartnerId = null;
            addDialog.querySelector("h3").innerText = "Add Business Customer";
            addDialog.querySelector("button[type='submit']").innerText = "Add Customer & Set Credit Limit";
            form.reset();
            addDialog.showModal();
        };
    }
    if (closeAddBtn) {
        closeAddBtn.onclick = () => addDialog.close();
    }
    
    // Process Partner Form
    form.onsubmit = (e) => {
        e.preventDefault();
        
        const name = document.getElementById("b2bName").value;
        const address = document.getElementById("b2bAddress").value;
        const terms = Number(document.getElementById("b2bTerms").value);
        const limit = Number(document.getElementById("b2bCreditLimit").value);
        
        const state = window.BlissburnState;
        
        if (window._editingPartnerId) {
            const partner = state.partners.find(p => p.id === window._editingPartnerId);
            if (partner) {
                partner.name = name;
                partner.address = address;
                partner.terms = terms;
                partner.limit = limit;
                addNotification("info", "Partner Updated", `Profile for ${name} has been updated.`);
            }
            window._editingPartnerId = null;
        } else {
            const newPartnerId = `b2b-${String(state.partners.length + 1).padStart(2, '0')}`;
            state.partners.push({
                id: newPartnerId,
                name: name,
                address: address,
                terms: terms,
                limit: limit,
                balance: 0
            });
            addNotification("success", "Business Customer Added", `${name} added with a LKR ${limit.toLocaleString()} credit limit.`);
        }
        
        saveState();
        
        // Reset form, close modal, and reload cards
        form.reset();
        addDialog.close();
        renderB2BPartners();
        
        // Force update options in POS customer selects
        if (window.renderPOS) {
            loadB2BCustomerSelectOptions();
        }
    };
}

// Render B2B invoice PDF layout template on click
window.viewInvoiceDocument = function(invoiceId) {
    const dialog = document.getElementById("invoiceDialog");
    const state = window.BlissburnState;
    const inv = state.invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    
    // Populate client card metadata
    const partner = state.partners.find(p => p.name === inv.customerName);
    const clientAddress = partner ? partner.address : "Industrial Sector, Sri Lanka";
    const clientTerms = partner ? `${partner.terms} Days credit` : "Cash On Delivery";
    
    document.getElementById("invRefNum").innerText = inv.id;
    document.getElementById("invClientName").innerText = inv.customerName;
    document.getElementById("invClientAddress").innerText = clientAddress;
    document.getElementById("invClientTerms").innerText = clientTerms;
    
    document.getElementById("invDateIssued").innerText = inv.date;
    document.getElementById("invDateDue").innerText = inv.dueDate;
    
    const badge = document.getElementById("invLedgerStatus");
    badge.innerText = inv.status;
    badge.className = inv.status.toLowerCase() === 'paid'
        ? 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800'
        : 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800';
    
    // Populate Invoice Line Items table
    const itemsBody = document.getElementById("invoiceItemsListBody");
    itemsBody.innerHTML = "";
    
    // Use stored items if they exist, or fall back to high-fidelity mock invoice items
    const itemsList = inv.items || [
        { name: "Creamy Bun", qty: 400, retailPrice: 120, wholesalePrice: 90 },
        { name: "Sandwich Bread", qty: 100, retailPrice: 280, wholesalePrice: 210 }
    ];
    
    itemsList.forEach(item => {
        const lineTotal = item.wholesalePrice * item.qty;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="px-3 py-2 border-t border-outline-variant/20"><strong>${item.name}</strong></td>
            <td class="px-3 py-2 border-t border-outline-variant/20 text-center">${item.qty} units</td>
            <td class="px-3 py-2 border-t border-outline-variant/20 text-right">LKR ${item.retailPrice.toFixed(0)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/20 text-right">LKR ${item.wholesalePrice.toFixed(0)}</td>
            <td class="px-3 py-2 border-t border-outline-variant/20 text-right">LKR ${lineTotal.toLocaleString('en-US')}</td>
        `;
        itemsBody.appendChild(row);
    });
    
    // Bottom billing aggregations
    const taxVal = inv.tax !== undefined ? inv.tax : 0.0;
    const taxRatePercent = inv.taxRate !== undefined ? inv.taxRate : 0;
    document.getElementById("invRetailVal").innerText = `LKR ${inv.total.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById("invWholesaleDisc").innerText = `- LKR ${inv.discount.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById("invTaxVal").innerText = `LKR ${taxVal.toLocaleString('en-US', {minimumFractionDigits:2})} (${taxRatePercent}% VAT)`;
    document.getElementById("invTotalDue").innerText = `LKR ${inv.grandTotal.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    
    // Show/hide Refund and Void buttons depending on status
    const refundBtn = document.getElementById("refundInvoiceBtn");
    const voidBtn = document.getElementById("voidInvoiceBtn");
    
    if (refundBtn && voidBtn) {
        refundBtn.classList.add("hidden");
        voidBtn.classList.add("hidden");
        
        if (inv.status.toLowerCase() === "paid") {
            refundBtn.classList.remove("hidden");
            refundBtn.onclick = () => window.refundInvoice(inv.id);
        } else if (inv.status.toLowerCase() === "unpaid" || inv.status.toLowerCase() === "overdue") {
            voidBtn.classList.remove("hidden");
            voidBtn.onclick = () => window.voidInvoice(inv.id);
        }
    }
    
    // Open Dialog
    dialog.showModal();
    
    document.getElementById("closeInvoiceDialog").onclick = () => {
        dialog.close();
    };
};

// Delete a B2B partner
window.deletePartner = async function(partnerId) {
    const state = window.BlissburnState;
    const partner = state.partners.find(p => p.id === partnerId);
    if (!partner) return;
    
    if (partner.balance > 0) {
        showToast("warning", "Cannot Delete Partner", `${partner.name} has an outstanding balance of LKR ${partner.balance.toLocaleString()}.`);
        return;
    }

    const ok = await window.showConfirm({
        title: "Delete B2B Partner",
        message: `Permanently remove "${partner.name}" from the wholesale directory? This cannot be undone.`,
        confirmText: "Delete Partner",
        danger: true
    });
    if (!ok) return;
    
    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/partners/${partnerId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Delete Failed", e.message);
            return;
        }
    } else {
        state.partners = state.partners.filter(p => p.id !== partnerId);
        saveState();
    }
    
    renderB2BPartners();
    addNotification('info', 'Customer Removed', `${partner.name} removed from business customers.`);
};

// Edit a B2B partner (pre-fills the add dialog)
window.editPartner = function(partnerId) {
    const state = window.BlissburnState;
    const partner = state.partners.find(p => p.id === partnerId);
    if (!partner) return;
    
    document.getElementById('b2bName').value = partner.name;
    document.getElementById('b2bAddress').value = partner.address;
    document.getElementById('b2bTerms').value = partner.terms;
    document.getElementById('b2bCreditLimit').value = partner.limit;
    
    window._editingPartnerId = partnerId;
    
    const dialog = document.getElementById('addB2BPartnerDialog');
    dialog.showModal();
};

/* ==========================================================================
   B2B INVOICE RETURNS, REFUNDS & VOIDS HANDLERS
   ========================================================================== */

// Refund a paid B2C or B2B invoice
window.refundInvoice = async function(invoiceId) {
    const state = window.BlissburnState;
    const inv = state.invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    
    // Step 1: confirm the refund itself
    const proceed = await window.showConfirm({
        title: "Refund Invoice",
        message: `Process a full refund for invoice ${inv.invoiceNo || inv.id} (LKR ${inv.grandTotal.toLocaleString()})?`,
        confirmText: "Process Refund",
        danger: true
    });
    if (!proceed) return;

    // Step 2: decide what happens to the returned stock
    const isSpoiled = await window.showConfirm({
        title: "Returned Stock Condition",
        message: "Spoiled/damaged stock is written off. Usable stock is restored back into Central raw materials.",
        confirmText: "Spoiled — Write Off",
        cancelText: "Usable — Restore Stock",
        danger: true
    });
    
    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/invoices/${invoiceId}/refund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spoiled: isSpoiled })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Refund failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Refund Failed", e.message);
            return;
        }
    } else {
        // Local Fallback Offline Mode
        inv.status = "Refunded";
        
        // 1. Revert B2B outstanding if needed
        if (inv.customerType === "B2B" && inv.method === "credit") {
            const partner = state.partners.find(p => p.name === inv.customerName);
            if (partner) {
                partner.balance -= inv.outstanding;
                inv.outstanding = 0;
            }
        }
        
        // 2. Restore ingredients stock if usable (NOT spoiled)
        if (!isSpoiled) {
            const itemsList = inv.items || [];
            itemsList.forEach(item => {
                const prod = state.products.find(p => p.name === item.productName || p.name === item.name);
                if (prod && prod.bom) {
                    for (let code in prod.bom) {
                        const ing = state.ingredients.find(i => i.code === code);
                        if (ing) {
                            const totalQtyToRestore = prod.bom[code] * item.qty;
                            ing.stock += totalQtyToRestore;
                        }
                    }
                }
            });
        }
        
        // 3. Post dual cashbook ledger reverse log
        state.financialLog.push({
            id: `TXN-${state.financialLog.length + 5001}`,
            date: state.simulatedDate,
            description: `Invoice Refund reversed: ${inv.invoiceNo || inv.id} (${isSpoiled ? 'Spoiled/Wastage' : 'Returned Stock Restored'})`,
            method: inv.method,
            amount: -inv.grandTotal
        });
        
        saveState();
    }
    
    document.getElementById("invoiceDialog").close();
    renderB2B();
    if (window.renderAccounts) window.renderAccounts();
    if (window.renderInventory) window.renderInventory();
    
    showToast("success", "Invoice Refunded", `Invoice ${inv.invoiceNo || inv.id} status set to Refunded.`);
};

// Void an unpaid B2B Credit invoice to release credit lines
window.voidInvoice = async function(invoiceId) {
    const state = window.BlissburnState;
    const inv = state.invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    
    if (inv.status.toLowerCase() !== "unpaid" && inv.status.toLowerCase() !== "overdue") {
        showToast("warning", "Cannot Void Invoice", "Only unpaid or overdue B2B credit invoices can be voided.");
        return;
    }

    const ok = await window.showConfirm({
        title: "Void Credit Invoice",
        message: `Void invoice ${inv.invoiceNo || inv.id}? This releases LKR ${inv.grandTotal.toLocaleString()} of held credit on the B2B client's profile.`,
        confirmText: "Void Invoice",
        danger: true
    });
    if (!ok) return;
    
    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/invoices/${invoiceId}/void`, {
                method: 'POST'
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Void failed');
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Void Failed", e.message);
            return;
        }
    } else {
        // Local Fallback Offline Mode
        inv.status = "Voided";
        
        // Release credit hold on partner
        if (inv.customerType === "B2B") {
            const partner = state.partners.find(p => p.name === inv.customerName);
            if (partner) {
                partner.balance -= inv.grandTotal;
                if (partner.balance < 0) partner.balance = 0;
            }
        }
        
        inv.outstanding = 0;
        
        // Post dual cashbook ledger reverse log
        state.financialLog.push({
            id: `TXN-${state.financialLog.length + 5001}`,
            date: state.simulatedDate,
            description: `Invoice Voided: ${inv.invoiceNo || inv.id} (Credit released)`,
            method: inv.method,
            amount: -inv.grandTotal
        });
        
        saveState();
    }
    
    document.getElementById("invoiceDialog").close();
    renderB2B();
    if (window.renderAccounts) window.renderAccounts();
    
    showToast("info", "Invoice Voided", `Credit invoice ${inv.invoiceNo || inv.id} successfully cancelled & voided.`);
};

