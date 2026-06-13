/* ==========================================================================
   BLISSBURN ERP - ACCOUNTS RECEIVABLE & PAYMENTS LEDGER (accounts.js)
   ========================================================================== */

// Initialize Accounts Ledger view hook
window.renderAccounts = function() {
    renderAccountsReceivableLedger();
    calculateCreditAgingBrackets();
    renderFinancialTransactionsTable();
    setupAccountsEventListeners();
    
    // Bind Search Input for Receivables Ledger
    const recSearch = document.getElementById("accountsReceivableSearch");
    if (recSearch) {
        recSearch.oninput = () => {
            window._currentReceivablesPage = 1;
            renderAccountsReceivableLedger();
        };
    }
    
    // Bind CSV Export for Receivables Ledger
    const exportRecBtn = document.getElementById("exportReceivablesCSVBtn");
    if (exportRecBtn) {
        exportRecBtn.onclick = () => {
            const state = window.BlissburnState;
            const headers = ["Client Partner", "Total Invoiced (LKR)", "Total Outstanding Balance (LKR)", "Credit Terms Allowed", "Credit Status"];
            const rows = state.partners.map(partner => {
                const totalInvoiced = state.invoices
                    .filter(i => i.customerName === partner.name)
                    .reduce((sum, i) => sum + i.grandTotal, 0);
                const hasOverdue = state.invoices.some(i => i.customerName === partner.name && i.status === "Overdue");
                const status = (partner.balance >= partner.limit || hasOverdue) ? "Credit Hold" : (partner.balance > 0 ? "Active Credit" : "Excellent");
                return [partner.name, totalInvoiced, partner.balance, `${partner.terms} Days`, status];
            });
            window.exportToCSV(headers, rows, "accounts_receivable_ledger.csv");
        };
    }
    
    // Bind "Remind All Overdue" bulk SMS — only shown/usable when SMS is on
    const remindAllBtn = document.getElementById("remindAllOverdueBtn");
    if (remindAllBtn) {
        const smsOn = window.BlissburnState.globalConfig && window.BlissburnState.globalConfig.smsEnabled;
        remindAllBtn.style.display = smsOn ? "inline-flex" : "none";
        remindAllBtn.onclick = async () => {
            if (window.requireOnline && !window.requireOnline("send reminders")) return;
            const ok = await window.showConfirm({
                title: "Text All Overdue Customers",
                message: "Send an SMS payment reminder to every business customer with an overdue, unpaid invoice. Each message costs money. Continue?",
                confirmText: "Send Reminders"
            });
            if (!ok) return;
            try {
                const res = await fetch(`${window.location.origin}/api/sms/reminders/run`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ simulatedDate: window.BlissburnState.simulatedDate })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send reminders");
                showToast("success", "Reminders Sent",
                    `Sent ${data.sent}, failed ${data.failed}, skipped ${data.skipped} (no phone) of ${data.total} overdue.`);
            } catch (e) {
                showToast("danger", "Reminders Failed", e.message);
            }
        };
    }

    // Bind CSV Export for Financial Transactions
    const exportTxnsBtn = document.getElementById("exportTxnsCSVBtn");
    if (exportTxnsBtn) {
        exportTxnsBtn.onclick = () => {
            const state = window.BlissburnState;
            const headers = ["Txn ID", "Date", "Description", "Payment Method", "Revenue (LKR)"];
            const rows = state.financialLog.map(txn => [
                txn.id,
                txn.date,
                txn.description,
                txn.method,
                txn.amount
            ]);
            window.exportToCSV(headers, rows, "financial_transactions_log.csv");
        };
    }
};

// Render corporate credit clients list
// Initialize page state variables
window._currentReceivablesPage = 1;

// Render corporate credit clients list
function renderAccountsReceivableLedger() {
    const body = document.getElementById("accountsReceivableBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    const searchInput = document.getElementById("accountsReceivableSearch");
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    let filteredPartners = state.partners;
    if (filterText) {
        filteredPartners = state.partners.filter(partner => 
            partner.name.toLowerCase().includes(filterText)
        );
    }
    
    if (filteredPartners.length === 0) {
        window.renderEmptyState("accountsReceivableBody", 5, "No receivable accounts found.", "group");
        const paginationCtr = document.getElementById("accountsReceivablePaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // Paginate (5 partners per page)
    const paginated = window.paginateArray(filteredPartners, window._currentReceivablesPage, 5);
    
    if (window._currentReceivablesPage > paginated.totalPages) {
        window._currentReceivablesPage = paginated.totalPages;
    }
    
    paginated.data.forEach(partner => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        // Sum total historical B2B invoices generated for client
        const totalInvoiced = state.invoices
            .filter(i => i.customerName === partner.name)
            .reduce((sum, i) => sum + i.grandTotal, 0);
            
        // Credit Health status evaluation
        let statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800">Excellent</span>`;
        
        // Check if partner has any overdue invoices
        const hasOverdue = state.invoices.some(i => i.customerName === partner.name && i.status === "Overdue");
        
        if (partner.balance >= partner.limit || hasOverdue) {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800">Hold</span>`;
        } else if (partner.balance > 0) {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">Active</span>`;
        }
        
        row.innerHTML = `
            <td class="px-3 py-2 border-t border-outline-variant/30"><div class="flex items-center gap-1.5"><div class="w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center flex-shrink-0"><span class="text-[10px] font-bold text-on-secondary-container">${partner.name.substring(0,2).toUpperCase()}</span></div><strong class="text-xs font-semibold">${partner.name}</strong></div></td>
            <td class="px-3 py-2 border-t border-outline-variant/30">LKR ${totalInvoiced.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 font-semibold text-red-700">LKR ${partner.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30">${partner.terms}d</td>
            <td class="px-3 py-2 border-t border-outline-variant/30">${statusBadge}</td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("accountsReceivablePaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentReceivablesPage = newPage;
        renderAccountsReceivableLedger();
    });
}

// Compute debt ageing brackets (0-30, 31-60, 60+ days) relative to Simulated System Date (FR4)
function calculateCreditAgingBrackets() {
    const state = window.BlissburnState;
    const simDate = new Date(state.simulatedDate);
    
    let sum0_30 = 0;
    let sum31_60 = 0;
    let sum60_plus = 0;
    let totalOutstanding = 0;
    
    // Scan B2B invoices with unpaid outstandings
    state.invoices.forEach(inv => {
        if (inv.customerType === "B2B" && inv.outstanding > 0) {
            const billDate = new Date(inv.date);
            const diffTime = simDate - billDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            totalOutstanding += inv.outstanding;
            
            if (diffDays <= 30) {
                sum0_30 += inv.outstanding;
            } else if (diffDays <= 60) {
                sum31_60 += inv.outstanding;
            } else {
                sum60_plus += inv.outstanding;
            }
        }
    });
    
    // Update numerical fields
    document.getElementById("ageing0_30").innerText = `LKR ${sum0_30.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById("ageing31_60").innerText = `LKR ${sum31_60.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    document.getElementById("ageing60_plus").innerText = `LKR ${sum60_plus.toLocaleString('en-US', {minimumFractionDigits:2})}`;
    
    // Render custom ageing bar-fills and percentage tags
    const bar0_30 = document.querySelector(".bracket-fill.b-0-30");
    const bar31_60 = document.querySelector(".bracket-fill.b-31-60");
    const bar60_plus = document.querySelector(".bracket-fill.b-60-plus");
    
    if (totalOutstanding === 0) {
        bar0_30.style.width = "0%";
        bar0_30.innerText = "0%";
        bar31_60.style.width = "0%";
        bar31_60.innerText = "0%";
        bar60_plus.style.width = "0%";
        bar60_plus.innerText = "0%";
        return;
    }
    
    const pct0_30 = (sum0_30 / totalOutstanding) * 100;
    const pct31_60 = (sum31_60 / totalOutstanding) * 100;
    const pct60_plus = (sum60_plus / totalOutstanding) * 100;
    
    bar0_30.style.width = `${pct0_30}%`;
    bar0_30.innerText = pct0_30 > 10 ? `${pct0_30.toFixed(0)}%` : '';
    bar0_30.title = `0-30 Days: LKR ${sum0_30.toLocaleString()}`;
    
    bar31_60.style.width = `${pct31_60}%`;
    bar31_60.innerText = pct31_60 > 10 ? `${pct31_60.toFixed(0)}%` : '';
    bar31_60.title = `31-60 Days: LKR ${sum31_60.toLocaleString()}`;
    
    bar60_plus.style.width = `${pct60_plus}%`;
    bar60_plus.innerText = pct60_plus > 10 ? `${pct60_plus.toFixed(0)}%` : '';
    bar60_plus.title = `60+ Days: LKR ${sum60_plus.toLocaleString()}`;
}

// Initialize page state variables
window._currentTransactionsPage = 1;
window._txnSortKey = "date"; // Default sort by date
window._txnSortOrder = "desc"; // Default newest first

window.toggleTxnSort = function(key) {
    if (window._txnSortKey === key) {
        window._txnSortOrder = window._txnSortOrder === "asc" ? "desc" : "asc";
    } else {
        window._txnSortKey = key;
        window._txnSortOrder = "asc";
    }
    window._currentTransactionsPage = 1;
    renderFinancialTransactionsTable(document.getElementById("accountsTxnSearch")?.value || "");
};

function updateTxnSortIcons() {
    const keys = ["id", "date", "description", "method", "amount"];
    keys.forEach(k => {
        const el = document.getElementById(`sort-icon-txn-${k}`);
        if (!el) return;
        if (window._txnSortKey === k) {
            el.innerHTML = window._txnSortOrder === "asc" 
                ? `<span class="material-symbols-outlined text-[10px] select-none font-bold align-middle">arrow_drop_up</span>` 
                : `<span class="material-symbols-outlined text-[10px] select-none font-bold align-middle">arrow_drop_down</span>`;
        } else {
            el.innerHTML = "";
        }
    });
}

// Render cashbook transactions ledger audit trail
function renderFinancialTransactionsTable(searchFilter = "") {
    const body = document.getElementById("financialTxnBody");
    const state = window.BlissburnState;
    
    if (!body) return;
    body.innerHTML = "";
    
    // Sort transactions based on sorting keys
    const sortedTxns = [...state.financialLog];
    sortedTxns.sort((a, b) => {
        let valA = a[window._txnSortKey];
        let valB = b[window._txnSortKey];
        
        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();
        
        if (valA < valB) return window._txnSortOrder === "asc" ? -1 : 1;
        if (valA > valB) return window._txnSortOrder === "asc" ? 1 : -1;
        return 0;
    });
    
    const filterText = searchFilter.toLowerCase().trim();
    const startDateInput = document.getElementById("accountsStartDate");
    const endDateInput = document.getElementById("accountsEndDate");
    const startDate = startDateInput ? startDateInput.value : "";
    const endDate = endDateInput ? endDateInput.value : "";

    const filteredTxns = sortedTxns.filter(txn => {
        // Text Filter
        const matchesText = !filterText || (
            txn.description.toLowerCase().includes(filterText) ||
            txn.id.toLowerCase().includes(filterText) ||
            txn.method.toLowerCase().includes(filterText)
        );
        
        // Date range filter
        const matchesStartDate = !startDate || txn.date >= startDate;
        const matchesEndDate = !endDate || txn.date <= endDate;
        
        return matchesText && matchesStartDate && matchesEndDate;
    });
    
    if (filteredTxns.length === 0) {
        window.renderEmptyState("financialTxnBody", 5, "No matching transactions.", "receipt_long");
        const paginationCtr = document.getElementById("accountsTransactionsPaginationContainer");
        if (paginationCtr) paginationCtr.innerHTML = "";
        return;
    }
    
    // Paginate (5 transactions per page)
    const paginated = window.paginateArray(filteredTxns, window._currentTransactionsPage, 5);
    
    if (window._currentTransactionsPage > paginated.totalPages) {
        window._currentTransactionsPage = paginated.totalPages;
    }
    
    paginated.data.forEach(txn => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        let methodBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">Credit Post</span>`;
        let textAmtClass = "text-on-surface-variant";
        
        if (txn.method === "cash") {
            methodBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800">Cash Deposit</span>`;
            textAmtClass = "text-green-700 font-semibold";
        } else if (txn.method === "card") {
            methodBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">Card Settlement</span>`;
            textAmtClass = "text-green-700 font-semibold";
        } else if (txn.method === "payment-in") {
            methodBadge = `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800"><span class="material-symbols-outlined text-[10px]">task_alt</span> Credit Recv</span>`;
            textAmtClass = "text-green-700 font-semibold";
        }
        
        row.innerHTML = `
            <td class="px-3 py-2 border-t border-outline-variant/30"><code class="text-[10px] bg-surface-container px-1.5 py-0.5 rounded">${txn.id}</code></td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${txn.date}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${txn.description}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30">${methodBadge}</td>
            <td class="px-3 py-2 border-t border-outline-variant/30 ${textAmtClass} text-xs">LKR ${txn.amount.toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
        `;
        body.appendChild(row);
    });
    
    // Render pagination controls
    window.renderPaginationControls("accountsTransactionsPaginationContainer", paginated.currentPage, paginated.totalPages, newPage => {
        window._currentTransactionsPage = newPage;
        renderFinancialTransactionsTable(searchFilter);
    });
    
    // Update sort icons
    updateTxnSortIcons();
}

// Setup B2B cash payment capture form listeners and bindings
function setupAccountsEventListeners() {
    const recordBtn = document.getElementById("recordB2BPaymentBtn");
    const closeBtn = document.getElementById("closeCapturePayDialog");
    const dialog = document.getElementById("capturePaymentDialog");
    const partnerSelect = document.getElementById("payCustomerSelect");
    const invoiceSelect = document.getElementById("payInvoiceSelect");
    const outstandingText = document.getElementById("payInvoiceOutstanding");
    const amountInput = document.getElementById("payAmount");
    const form = document.getElementById("capturePaymentForm");
    
    const txnSearch = document.getElementById("accountsTxnSearch");
    if (txnSearch) {
        txnSearch.oninput = () => {
            renderFinancialTransactionsTable(txnSearch.value);
        };
    }
    
    const startDateInput = document.getElementById("accountsStartDate");
    const endDateInput = document.getElementById("accountsEndDate");
    if (startDateInput) {
        startDateInput.onchange = () => {
            renderFinancialTransactionsTable(txnSearch ? txnSearch.value : "");
        };
    }
    if (endDateInput) {
        endDateInput.onchange = () => {
            renderFinancialTransactionsTable(txnSearch ? txnSearch.value : "");
        };
    }
    
    if (!recordBtn) return;
    recordBtn.onclick = () => {
        loadPartnersInPaymentSelector();
        dialog.showModal();
    };
    
    closeBtn.onclick = () => dialog.close();
    
    // Load partners who have unpaid outstanding balances
    function loadPartnersInPaymentSelector() {
        const state = window.BlissburnState;
        partnerSelect.innerHTML = '<option value="">-- Select B2B Partner --</option>';
        
        state.partners.forEach(partner => {
            if (partner.balance > 0) {
                const opt = document.createElement("option");
                opt.value = partner.id;
                opt.innerText = `${partner.name} (Bal: LKR ${partner.balance.toLocaleString()})`;
                partnerSelect.appendChild(opt);
            }
        });
        
        invoiceSelect.innerHTML = '<option value="">-- Select Invoice --</option>';
        outstandingText.innerText = "LKR 0.00";
        amountInput.value = "";
    }
    
    // When partner changes, load their unpaid invoices
    partnerSelect.onchange = () => {
        const state = window.BlissburnState;
        const selectedPartner = state.partners.find(p => p.id === partnerSelect.value);
        
        invoiceSelect.innerHTML = '<option value="">-- Select Invoice --</option>';
        outstandingText.innerText = "LKR 0.00";
        amountInput.value = "";
        
        if (!selectedPartner) return;
        
        // Find unpaid or overdue invoices of this partner
        const unpaidInvoices = state.invoices.filter(i => i.customerName === selectedPartner.name && i.outstanding > 0);
        
        unpaidInvoices.forEach(inv => {
            const opt = document.createElement("option");
            opt.value = inv.id;
            opt.innerText = `${inv.id} (Outstanding: LKR ${inv.outstanding.toLocaleString()})`;
            invoiceSelect.appendChild(opt);
        });
    };
    
    // When invoice changes, display its specific outstanding amount
    invoiceSelect.onchange = () => {
        const state = window.BlissburnState;
        const inv = state.invoices.find(i => i.id === invoiceSelect.value);
        
        if (inv) {
            outstandingText.innerText = `LKR ${inv.outstanding.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            amountInput.value = inv.outstanding; // Autofill full payment as default
            amountInput.max = inv.outstanding;
        } else {
            outstandingText.innerText = "LKR 0.00";
            amountInput.value = "";
        }
    };
    
    // Post payment capture submission
    form.onsubmit = (e) => {
        e.preventDefault();
        
        const partnerId = partnerSelect.value;
        const invoiceId = invoiceSelect.value;
        const payAmount = Number(amountInput.value);
        const postDate = window.BlissburnState.simulatedDate;
        
        const state = window.BlissburnState;
        const partner = state.partners.find(p => p.id === partnerId);
        const inv = state.invoices.find(i => i.id === invoiceId);
        
        if (!partner || !inv || payAmount <= 0) return;
        
        // 1. Reduce invoice outstanding balance
        inv.outstanding -= payAmount;
        inv.paidAmount += payAmount;
        
        // Update Invoice status badge
        if (inv.outstanding === 0) {
            inv.status = "Paid";
        } else {
            inv.status = "Partially Paid";
        }
        
        // 2. Reduce Partner's total outstanding balance
        partner.balance -= payAmount;
        
        // 3. Post transaction audit ledger line (Capture payment cash-in)
        state.financialLog.push({
            id: `TXN-${state.financialLog.length + 5001}`,
            date: postDate,
            description: `B2B Credit Receipt Capture from ${partner.name} against invoice ${inv.id}`,
            method: "payment-in",
            amount: payAmount
        });
        
        saveState();
        
        // Close and reset
        form.reset();
        dialog.close();
        
        // Re-render
        renderAccounts();
        
        // In case B2B sub-ledger is active, force reload it
        if (window.renderB2B) {
            renderB2BInvoiceLedger();
            renderB2BPartners();
        }
        
        addNotification("success", "Credit Payment Received", `Captured LKR ${payAmount.toLocaleString()} payment from ${partner.name} against ${inv.id}.`);
    };
}
