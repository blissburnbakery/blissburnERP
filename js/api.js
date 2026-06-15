/* ==========================================================================
   BLISSBURN ERP - FRONTEND TO BACKEND API ADAPTER (api.js)
   ========================================================================== */

const API_BASE_URL = window.location.origin.startsWith('file://')
    ? 'http://localhost:5050/api'
    : `${window.location.origin}/api`;

// Backend availability flag — prevents module files from overwriting API handlers
window.BACKEND_AVAILABLE = false;

// Attach the session bearer token to every API request, regardless of which
// module issued it. Token is set by auth.js after a successful server login.
const _nativeFetch = window.fetch.bind(window);
window.fetch = function(resource, options = {}) {
    const url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
    if (url.includes('/api/')) {
        const token = sessionStorage.getItem('blissburn_token');
        if (token) {
            options.headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
        }
    }
    return _nativeFetch(resource, options);
};

// Global connection flag. When true, new changes (sales, baking, payments)
// are blocked so on-device data can never silently diverge from the database.
window.IS_OFFLINE = false;
let _reconnectTimer = null;

// Show/clear a clear "trying to reconnect" bar and drive auto-retry.
window._setOfflineBanner = function(show) {
    window.IS_OFFLINE = !!show;
    let banner = document.getElementById('offlineModeBanner');

    if (show) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offlineModeBanner';
            banner.className = 'fixed top-0 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-b-xl shadow-lg';
            banner.innerHTML = `
                <span class="material-symbols-outlined text-sm animate-pulse">cloud_off</span>
                <span>Can't reach the server — trying to reconnect…</span>
                <button id="offlineRetryNow" class="ml-1 underline underline-offset-2 hover:opacity-80">Retry now</button>`;
            document.body.appendChild(banner);
            const retryBtn = banner.querySelector('#offlineRetryNow');
            if (retryBtn) retryBtn.onclick = () => window.syncWithBackend().then(ok => { if (ok) _onReconnected(); });
        }
        // Auto-retry every 8s until the server answers
        if (!_reconnectTimer) {
            _reconnectTimer = setInterval(async () => {
                const ok = await window.syncWithBackend();
                if (ok) _onReconnected();
            }, 8000);
        }
    } else if (!show) {
        if (banner) banner.remove();
        if (_reconnectTimer) { clearInterval(_reconnectTimer); _reconnectTimer = null; }
    }
};

// Called once when a retry succeeds: stop polling, refresh the view, notify.
function _onReconnected() {
    if (_reconnectTimer) { clearInterval(_reconnectTimer); _reconnectTimer = null; }
    if (typeof triggerActiveModuleRender === 'function') triggerActiveModuleRender();
    if (typeof showToast === 'function') showToast('success', 'Back Online', 'Connection restored. You can sell again.');
}

// Guard for actions that change data — blocks them while offline so the
// device and database never disagree. Returns true if the action may proceed.
window.requireOnline = function(actionLabel) {
    if (window.IS_OFFLINE) {
        if (typeof showToast === 'function') {
            showToast('warning', 'You are offline', `Can't ${actionLabel || 'save changes'} right now — waiting to reconnect. Your data is safe; just try again in a moment.`);
        }
        return false;
    }
    return true;
};

// Sync local BlissburnState variables with PostgreSQL backend server
window.syncWithBackend = async function() {
    try {
        // Synchronizing with backend...
        
        // Fetch core datasets concurrently
        const savedRole = sessionStorage.getItem("blissburn_role");
        const fetchPromises = [
            fetch(`${API_BASE_URL}/products`),
            fetch(`${API_BASE_URL}/ingredients`),
            fetch(`${API_BASE_URL}/fifo`),
            fetch(`${API_BASE_URL}/production`),
            fetch(`${API_BASE_URL}/partners`),
            fetch(`${API_BASE_URL}/invoices?simulatedDate=${window.BlissburnState.simulatedDate}`),
            fetch(`${API_BASE_URL}/notifications`),
            fetch(`${API_BASE_URL}/financial-log`),
            fetch(`${API_BASE_URL}/config`),
            fetch(`${API_BASE_URL}/invoice-edit-requests`)
        ];

        if (savedRole === 'admin') {
            fetchPromises.push(fetch(`${API_BASE_URL}/staff`));
        }

        const results = await Promise.all(fetchPromises);

        // 401 means the backend is up but we hold no valid token. Before login
        // that's simply "not signed in"; after an offline-fallback login it
        // means the user is working on local data — show the banner then.
        if (results.some(r => r.status === 401)) {
            window.BACKEND_AVAILABLE = false;
            const offlineSession = !!sessionStorage.getItem('blissburn_session') && !sessionStorage.getItem('blissburn_token');
            window._setOfflineBanner(offlineSession);
            return false;
        }

        // Verify all fetch requests succeeded
        for (const res of results) {
            if (!res.ok) {
                throw new Error("One or more network datasets failed to synchronize.");
            }
        }

        const products = await results[0].json();
        const ingredients = await results[1].json();
        const fifoQueue = await results[2].json();
        const productionLogs = await results[3].json();
        const partners = await results[4].json();
        const invoices = await results[5].json();
        const notifications = await results[6].json();
        const financialLog = await results[7].json();
        const config = await results[8].json();
        const editRequests = await results[9].json();
        window.BlissburnState.invoiceEditRequests = Array.isArray(editRequests) ? editRequests : [];

        if (savedRole === 'admin' && results[10]) {
            const staff = await results[10].json();
            window.BlissburnState.staff = staff;
        }
        
        window.BlissburnState.products = products.map(p => {
            const bom = {};
            if (p.recipes) {
                p.recipes.forEach(r => {
                    if (r.ingredient) {
                        bom[r.ingredient.code] = r.quantityGrams;
                    }
                });
            }
            return {
                id: p.id,
                name: p.name,
                category: p.category,
                retailPrice: p.retailPrice,
                wholesalePrice: p.wholesalePrice,
                shelfLife: p.shelfLife,
                icon: p.icon,
                dailyTarget: p.dailyTarget,
                bom: bom
            };
        });
        window.BlissburnState.ingredients = ingredients;
        
        window.BlissburnState.fifoQueue = fifoQueue.map(b => ({
            id: b.batchCode,
            ingredientCode: b.ingredient.code,
            dateReceived: b.dateReceived,
            originalQty: b.originalQty,
            remainingQty: b.remainingQty,
            expiryDate: b.expiryDate
        }));
        
        window.BlissburnState.productionLogs = productionLogs.map(l => ({
            id: l.batchCode,
            product: l.product.name,
            qty: l.quantity,
            dateProduced: l.dateProduced,
            expiryDate: l.expiryDate,
            active: l.active
        }));
        
        window.BlissburnState.partners = partners;
        window.BlissburnState.invoices = invoices;

        // Full cashbook ledger straight from the FinancialLog table — includes
        // payment captures, refund reversals, and wastage write-offs
        window.BlissburnState.financialLog = financialLog.map(txn => ({
            id: txn.txnCode,
            date: txn.date,
            description: txn.description,
            method: txn.method,
            amount: txn.amount
        }));

        window.BlissburnState.notifications = notifications;

        // Global configuration (VAT, credit cap, auto-print, business profile)
        window.BlissburnState.globalConfig = {
            defaultVAT: config.defaultVAT,
            defaultCreditLimit: config.defaultCreditLimit,
            autoPrintReceipt: config.autoPrintReceipt,
            smsEnabled: config.smsEnabled,
            smsProvider: config.smsProvider,
            smsSenderId: config.smsSenderId,
            smsUserId: config.smsUserId,
            smsApiTokenSet: config.smsApiTokenSet
        };
        window.BlissburnState.bakeryConfig = {
            name: config.bakeryName,
            address: config.bakeryAddress,
            phone: config.bakeryPhone
        };

        // Backend sync complete
        window.BACKEND_AVAILABLE = true;
        window._setOfflineBanner(false);
        return true;
    } catch (e) {
        console.warn("Backend offline. Falling back to client-side localStorage mode.", e);
        window.BACKEND_AVAILABLE = false;
        window._setOfflineBanner(true);
        return false;
    }
};

/* ==========================================================================
   INTERCEPT MUTATIONS AND SWAP WITH REAL API POSTS
   ========================================================================== */

// 1. Intercept POS Checkout transaction
if (typeof window.executeCheckout === 'function') {
    const originalExecuteCheckout = window.executeCheckout;
    
    window.executeCheckout = async function() {
        // Block selling while offline so a sale is never saved only on this
        // device (which would never reach the database).
        if (!window.requireOnline('complete this sale')) return;

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
        const invoiceDate = window.BlissburnState.simulatedDate;
        
        const customerName = isB2B ? window.BlissburnState.partners.find(p => p.id === select.value).name : "Walk-in Customer";
        
        const taxRatePercent = Number(document.getElementById("posTaxRate")?.value || 8);
        const taxAmount = grandTotal * (taxRatePercent / 100);
        const postData = {
            customerType: isB2B ? "B2B" : "B2C",
            partnerId: isB2B ? select.value : null,
            customerName: customerName,
            total: subtotal,
            discount: discount,
            tax: taxAmount,
            taxRate: taxRatePercent,
            grandTotal: grandTotal + taxAmount,
            paymentMethod: paymentMethod,
            items: posCart.map(i => ({ name: i.name, qty: i.qty, retailPrice: i.retailPrice, wholesalePrice: i.wholesalePrice })),
            simulatedDate: invoiceDate
        };
        
        try {
            // Submitting checkout to server
            const res = await fetch(`${API_BASE_URL}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Checkout API failed");
            
            // Sync database state from server
            await window.syncWithBackend();
            
            // Re-fetch custom invoice record from database
            const dbInvoice = window.BlissburnState.invoices.find(i => i.invoiceNo === data.result.invoiceNo);
            
            // Snapshot cart items BEFORE clearing for receipt display
            const cartSnapshot = posCart.map(i => ({...i}));
            
            // Clear and reset local POS cart
            posCart = [];
            renderCart();
            renderProductCatalog(getActiveCategory(), document.getElementById("posSearch").value);
            
            // Launch receipt with cart snapshot (must happen after sync but cart items preserved)
            launchReceiptDialog(dbInvoice, cartSnapshot);
            
            addNotification("success", "Sale Complete", `Sale ${data.result.invoiceNo} saved.`);
        } catch (e) {
            console.error("Checkout failed:", e);
            // A network failure (not a server-sent error) means we lost the
            // connection mid-sale — flip to offline and DON'T save locally.
            if (e instanceof TypeError) {
                window._setOfflineBanner(true);
                showToast("warning", "Sale Not Saved", "Lost connection before the sale could be saved. Nothing was charged — please try again once reconnected.");
            } else {
                showToast("danger", "Checkout Failed", e.message);
            }
        }
    };
}

// 2. Intercept Daily Production Logging & BOM depletion
if (typeof window.executeProductionLogging === 'function') {
    const originalExecuteProd = window.executeProductionLogging;
    
    window.executeProductionLogging = async function() {
        // Block while offline so baking records never diverge from the database
        if (!window.requireOnline('save this baking record')) return;

        const select = document.getElementById("prodProductSelect");
        const qtyInput = document.getElementById("prodQuantity");
        
        const prod = window.BlissburnState.products.find(p => p.id === select.value);
        const qty = Number(qtyInput.value);
        const prodDateStr = window.BlissburnState.simulatedDate;
        
        const postData = {
            productId: select.value,
            quantity: qty,
            simulatedDate: prodDateStr
        };
        
        try {
            // Posting production log to server
            const res = await fetch(`${API_BASE_URL}/production`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Production log API failed");
            
            // Sync updated database state
            await window.syncWithBackend();
            
            // Reset quantity inputs and re-render
            qtyInput.value = 100;
            renderBOMRequirementPreview();
            renderProductionBatches();
            
            addNotification("success", "Production Logged", `Batch ${data.productionLog.batchCode} of ${qty} units recorded in database.`);
        } catch (e) {
            console.error("API Production Logging failed:", e);
            showToast("danger", "Production Logging Failed", e.message);
        }
    };
}

// 3. Intercept Stock Intake Replenishment (capture phase — can't be overwritten by module files)
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("replenishForm");
    if (form) {
        form.addEventListener('submit', async (e) => {
            if (window.IS_OFFLINE) { e.preventDefault(); e.stopImmediatePropagation(); window.requireOnline('record this stock delivery'); return; }
            e.preventDefault();
            e.stopImmediatePropagation();

            const ingCode = document.getElementById("repIngredientSelect").value;
            const qty = Number(document.getElementById("repQuantity").value);
            const recDateStr = document.getElementById("repDate").value;
            
            const postData = {
                ingredientCode: ingCode,
                quantity: qty,
                receivingDate: recDateStr
            };
            
            try {
                // Submitting replenishment to server
                const res = await fetch(`${API_BASE_URL}/replenish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postData)
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Replenishment API failed");
                
                // Sync updated database state
                await window.syncWithBackend();
                
                // Reset form and close dialog
                form.reset();
                document.getElementById("replenishStockDialog").close();
                
                // Refresh views
                renderCentralStockLedger();
                renderFIFOQueueTable();
            } catch (e) {
                console.error("API Replenishment failed:", e);
                showToast("danger", "Stock Replenish Failed", e.message);
            }
        }, true); // capture phase
    }
});

// 4. Intercept B2B wholesale client profile additions (capture phase)
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("addB2BPartnerForm");
    if (form) {
        form.addEventListener('submit', async (e) => {
            if (window.IS_OFFLINE) { e.preventDefault(); e.stopImmediatePropagation(); window.requireOnline('save this customer'); return; }
            e.preventDefault();
            e.stopImmediatePropagation();

            const name = document.getElementById("b2bName").value;
            const address = document.getElementById("b2bAddress").value;
            const phoneEl = document.getElementById("b2bPhone");
            const phone = phoneEl ? phoneEl.value.trim() : "";
            const terms = Number(document.getElementById("b2bTerms").value);
            const limit = Number(document.getElementById("b2bCreditLimit").value);

            const postData = { name, address, phone, terms, limit };
            
            try {
                // Submitting partner registration or update to server
                const method = window._editingPartnerId ? 'PUT' : 'POST';
                const url = window._editingPartnerId 
                    ? `${API_BASE_URL}/partners/${window._editingPartnerId}`
                    : `${API_BASE_URL}/partners`;
                
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postData)
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "B2B Registry Save failed");
                
                // Clear editing state
                window._editingPartnerId = null;
                
                // Sync updated database state
                await window.syncWithBackend();
                
                // Reset form and close dialog
                form.reset();
                document.getElementById("addB2BPartnerDialog").close();
                
                // Refresh
                renderB2BPartners();
                if (window.renderPOS) {
                    loadB2BCustomerSelectOptions();
                }
            } catch (e) {
                console.error("API partner save failed:", e);
                showToast("danger", "B2B Registry Failed", e.message);
            }
        }, true); // capture phase
    }
});

// 5. Intercept Accounts Receivable payment capture (capture phase)
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("capturePaymentForm");
    if (form) {
        form.addEventListener('submit', async (e) => {
            if (window.IS_OFFLINE) { e.preventDefault(); e.stopImmediatePropagation(); window.requireOnline('record this payment'); return; }
            e.preventDefault();
            e.stopImmediatePropagation();

            const partnerId = document.getElementById("payCustomerSelect").value;
            const invoiceId = document.getElementById("payInvoiceSelect").value;
            const payAmount = Number(document.getElementById("payAmount").value);
            const postDate = window.BlissburnState.simulatedDate;
            
            const postData = { partnerId, invoiceId, payAmount, simulatedDate: postDate };
            
            try {
                // Posting payment to server
                const res = await fetch(`${API_BASE_URL}/payments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postData)
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Payment Posting failed");
                
                // Sync updated database state
                await window.syncWithBackend();
                
                // Reset form and close dialog
                form.reset();
                document.getElementById("capturePaymentDialog").close();
                
                // Refresh
                renderAccounts();
                if (window.renderB2B) {
                    renderB2BInvoiceLedger();
                    renderB2BPartners();
                }
            } catch (e) {
                console.error("API Payment Capture failed:", e);
                showToast("danger", "Credit Payment Failed", e.message);
            }
        }, true); // capture phase
    }
});

// 6. Augment clock system Date Simulations to audit FIFO on backend
document.addEventListener("DOMContentLoaded", () => {
    const dateInput = document.getElementById("systemDateSim");
    if (dateInput) {
        dateInput.addEventListener("change", async () => {
            // Trigger a re-sync which will recalculate everything based on the new simulated date
            await window.syncWithBackend();
            triggerActiveModuleRender();
        });
    }
});

// Load backend initial state on entry
document.addEventListener("DOMContentLoaded", async () => {
    const hasSyncSucceeded = await window.syncWithBackend();
    if (hasSyncSucceeded) {
        // Successfully connected to backend server. Force re-render active module.
        // API Adapter active
        triggerActiveModuleRender();
    }
});

// 7. Dynamic product creation & recipe modification APIs
window.apiCreateProduct = async function(productData) {
    try {
        // Submitting new product to backend
        const res = await fetch(`${API_BASE_URL}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create product");
        
        await window.syncWithBackend();
        return { success: true, product: data.product };
    } catch (e) {
        console.error("API Create Product failed:", e);
        throw e;
    }
};

window.apiUpdateProduct = async function(productId, productData) {
    try {
        // Submitting product update to backend
        const res = await fetch(`${API_BASE_URL}/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update product");
        
        await window.syncWithBackend();
        return { success: true, product: data.product };
    } catch (e) {
        console.error("API Update Product failed:", e);
        throw e;
    }
};

// 8. Intercept Staff creation and updates (capture phase)
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("addStaffForm");
    if (form) {
        form.addEventListener('submit', async (e) => {
            if (window.IS_OFFLINE) { e.preventDefault(); e.stopImmediatePropagation(); window.requireOnline('save this staff account'); return; }
            e.preventDefault();
            e.stopImmediatePropagation();

            const editId = document.getElementById("editStaffId").value;
            const name = document.getElementById("staffName").value.trim();
            const username = document.getElementById("staffUsername").value.trim().toLowerCase();
            const role = document.getElementById("staffRole").value;
            const passkey = document.getElementById("staffPasskey").value.trim();
            
            const postData = { username, name, role, passkey };
            
            try {
                const method = editId ? 'PUT' : 'POST';
                const url = editId 
                    ? `${API_BASE_URL}/staff/${editId}`
                    : `${API_BASE_URL}/staff`;
                
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postData)
                });
                
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Staff save failed");
                
                // Reset edit ID
                document.getElementById("editStaffId").value = "";
                
                // Re-sync
                await window.syncWithBackend();
                
                // Close dialog and reset form
                form.reset();
                document.getElementById("addStaffDialog").close();
                
                // Re-render Staff Manager
                if (window.renderStaffManager) window.renderStaffManager();
                
                addNotification("success", editId ? "Staff Account Updated" : "Staff Account Registered", `Account for ${name} has been processed.`);
            } catch (err) {
                console.error("API Staff save failed:", err);
                showToast("danger", "Staff Registry Error", err.message);
            }
        }, true); // capture phase
    }
});
