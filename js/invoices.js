/* ==========================================================================
   BLISSBURN ERP - INVOICES VIEW (invoices.js)
   Unified list of every receipt/invoice with creator + edit audit, the
   sales "request an edit" flow, and the admin review + in-place edit flow.
   ========================================================================== */
(function () {
    'use strict';

    const apiBase = () => `${window.location.origin}/api`;
    const S = () => window.BlissburnState;
    const isAdmin = () => sessionStorage.getItem('blissburn_role') === 'admin';
    const money = (n) => 'LKR ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

    window._invoicesPage = window._invoicesPage || 1;
    let _controlsBound = false;

    // ----- Public entry point (called by app.js renderView) -----
    window.renderInvoices = function () {
        renderEditRequestsPanel();
        renderInvoiceTable(getSearch());
        bindControlsOnce();
    };

    function getSearch() {
        const el = document.getElementById('invoicesSearch');
        return el ? el.value.trim().toLowerCase() : '';
    }

    function bindControlsOnce() {
        if (_controlsBound) return;
        _controlsBound = true;

        const search = document.getElementById('invoicesSearch');
        if (search) search.addEventListener('input', () => { window._invoicesPage = 1; renderInvoiceTable(getSearch()); });

        const exportBtn = document.getElementById('exportInvoicesCSVBtn');
        if (exportBtn) exportBtn.onclick = exportInvoicesCSV;

        // Request-edit dialog
        wireClose('closeEditRequestDialog', 'editRequestDialog');
        const submitReq = document.getElementById('submitEditRequestBtn');
        if (submitReq) submitReq.onclick = submitEditRequest;

        // Admin edit dialog
        wireClose('closeEditInvoiceDialog', 'editInvoiceDialog');
        const saveEdit = document.getElementById('saveInvoiceEditBtn');
        if (saveEdit) saveEdit.onclick = saveInvoiceEdit;
    }

    function wireClose(btnId, dialogId) {
        const btn = document.getElementById(btnId);
        if (btn) btn.onclick = () => { const d = document.getElementById(dialogId); if (d) d.close(); };
    }

    // ----- Invoice list -----
    function statusBadge(status) {
        const map = {
            Paid: 'bg-green-100 text-green-800',
            Unpaid: 'bg-amber-100 text-amber-800',
            'Partially Paid': 'bg-blue-100 text-blue-800',
            Overdue: 'bg-red-100 text-red-800',
            Refunded: 'bg-gray-200 text-gray-700',
            Voided: 'bg-gray-200 text-gray-700'
        };
        const cls = map[status] || 'bg-gray-100 text-gray-700';
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}">${status || '—'}</span>`;
    }

    function renderInvoiceTable(filter) {
        const body = document.getElementById('invoicesTableBody');
        if (!body) return;
        const state = S();
        let invoices = [...(state.invoices || [])].sort((a, b) => {
            const d = new Date(b.date) - new Date(a.date);
            return d !== 0 ? d : String(b.invoiceNo).localeCompare(String(a.invoiceNo));
        });

        if (filter) {
            invoices = invoices.filter(i =>
                String(i.invoiceNo || '').toLowerCase().includes(filter) ||
                String(i.customerName || '').toLowerCase().includes(filter) ||
                String(i.createdByName || '').toLowerCase().includes(filter) ||
                String(i.customerType || '').toLowerCase().includes(filter)
            );
        }

        if (invoices.length === 0) {
            window.renderEmptyState('invoicesTableBody', 8, 'No invoices found.', 'receipt_long');
            const pc = document.getElementById('invoicesPaginationContainer');
            if (pc) pc.innerHTML = '';
            return;
        }

        const paged = window.paginateArray(invoices, window._invoicesPage, 8);
        if (window._invoicesPage > paged.totalPages) window._invoicesPage = paged.totalPages;

        body.innerHTML = '';
        paged.data.forEach(inv => {
            const edited = (inv.editCount || 0) > 0;
            const editedBadge = edited
                ? `<span class="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 text-purple-800" title="Edited by ${inv.lastEditedByName || 'admin'}${inv.lastEditedAt ? ' on ' + new Date(inv.lastEditedAt).toLocaleString() : ''}"><span class="material-symbols-outlined text-[10px]">edit</span> Edited</span>`
                : '';

            let actions = `<button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-primary bg-primary-container/20 rounded-lg hover:bg-primary-container/50 transition-colors" onclick="window.viewInvoiceFromList('${inv.id}')"><span class="material-symbols-outlined text-sm">visibility</span></button>`;
            const editable = inv.status !== 'Refunded' && inv.status !== 'Voided';
            if (editable) {
                if (isAdmin()) {
                    actions += ` <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors" onclick="window.openEditInvoice('${inv.id}')"><span class="material-symbols-outlined text-sm">edit</span> Edit</button>`;
                } else {
                    actions += ` <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-on-surface bg-surface-container rounded-lg hover:bg-surface-container-high transition-colors" onclick="window.openEditRequest('${inv.id}')"><span class="material-symbols-outlined text-sm">edit_note</span> Request Edit</button>`;
                }
            }

            const row = document.createElement('tr');
            row.className = 'hover:bg-surface-container/50 transition-colors';
            row.innerHTML = `
                <td class="px-3 py-2 border-t border-outline-variant/30"><code class="text-[11px] bg-surface-container px-1.5 py-0.5 rounded">${inv.invoiceNo || inv.id}</code>${editedBadge}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${inv.date}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30">${inv.customerName || '—'}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30"><span class="text-[10px] font-medium px-1.5 py-0.5 rounded ${inv.customerType === 'B2B' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}">${inv.customerType}</span></td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-right font-semibold">${money(inv.grandTotal)}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30">${statusBadge(inv.status)}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${inv.createdByName || '—'}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-right whitespace-nowrap">${actions}</td>`;
            body.appendChild(row);
        });

        window.renderPaginationControls('invoicesPaginationContainer', paged.currentPage, paged.totalPages, p => {
            window._invoicesPage = p;
            renderInvoiceTable(getSearch());
        });
    }

    // View / print: reuse existing B2C receipt + B2B invoice renderers
    window.viewInvoiceFromList = function (invoiceId) {
        const inv = (S().invoices || []).find(i => i.id === invoiceId);
        if (!inv) return;
        if (inv.customerType === 'B2B' && typeof window.viewInvoiceDocument === 'function') {
            window.viewInvoiceDocument(invoiceId);
        } else if (typeof window.launchReceiptDialog === 'function') {
            const items = (inv.items || []).map(it => ({
                name: it.productName, qty: it.quantity,
                retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice
            }));
            window.launchReceiptDialog(inv, items);
        }
    };

    function exportInvoicesCSV() {
        const headers = ['Invoice No', 'Date', 'Customer', 'Type', 'Grand Total', 'Status', 'Created By', 'Edited By', 'Edited At'];
        const rows = (S().invoices || []).map(i => [
            i.invoiceNo || i.id, i.date, i.customerName, i.customerType,
            Number(i.grandTotal || 0).toFixed(2), i.status, i.createdByName || '',
            i.lastEditedByName || '', i.lastEditedAt || ''
        ]);
        window.exportToCSV(headers, rows, 'all_invoices.csv');
    }

    // ----- Sales: request an edit -----
    window.openEditRequest = function (invoiceId) {
        const inv = (S().invoices || []).find(i => i.id === invoiceId);
        if (!inv) return;
        document.getElementById('editReqInvoiceId').value = inv.id;
        document.getElementById('editReqInvoiceNo').innerText = inv.invoiceNo || inv.id;
        document.getElementById('editReqReason').value = '';
        document.getElementById('editRequestDialog').showModal();
    };

    async function submitEditRequest() {
        if (window.requireOnline && !window.requireOnline('request an invoice edit')) return;
        const id = document.getElementById('editReqInvoiceId').value;
        const reason = document.getElementById('editReqReason').value.trim();
        if (!reason) { showToast('warning', 'Add a note', 'Briefly describe what needs to be corrected.'); return; }
        try {
            const res = await fetch(`${apiBase()}/invoices/${id}/edit-request`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');
            document.getElementById('editRequestDialog').close();
            await window.syncWithBackend();
            renderInvoices();
            showToast('success', 'Request Sent', 'An admin will review your edit request.');
        } catch (e) {
            showToast('danger', 'Request Failed', e.message);
        }
    }

    // ----- Admin: edit requests panel -----
    function renderEditRequestsPanel() {
        const panel = document.getElementById('invoiceEditRequestsPanel');
        const body = document.getElementById('invoiceEditRequestsBody');
        if (!panel || !body) return;

        if (!isAdmin()) { panel.classList.add('hidden'); return; }

        const pending = (S().invoiceEditRequests || []).filter(r => r.status === 'pending');
        document.getElementById('invoiceEditRequestsCount').innerText = pending.length;

        if (pending.length === 0) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');

        body.innerHTML = '';
        pending.forEach(r => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-surface-container/50 transition-colors';
            row.innerHTML = `
                <td class="px-3 py-2 border-t border-outline-variant/30"><code class="text-[11px] bg-surface-container px-1.5 py-0.5 rounded">${r.invoiceNo}</code></td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${r.requestedByName}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-xs">${r.reason}</td>
                <td class="px-3 py-2 border-t border-outline-variant/30 text-right whitespace-nowrap">
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-on-primary bg-primary rounded-lg hover:bg-primary/90 transition-colors" onclick="window.reviewEditRequest('${r.id}')"><span class="material-symbols-outlined text-sm">edit</span> Review & Edit</button>
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onclick="window.rejectEditRequest('${r.id}')"><span class="material-symbols-outlined text-sm">close</span></button>
                </td>`;
            body.appendChild(row);
        });
    }

    window.reviewEditRequest = function (requestId) {
        const req = (S().invoiceEditRequests || []).find(r => r.id === requestId);
        if (!req) return;
        const inv = (S().invoices || []).find(i => i.id === req.invoiceId || i.invoiceNo === req.invoiceNo);
        if (!inv) { showToast('warning', 'Invoice unavailable', 'That invoice is not in the current list.'); return; }
        openEditInvoiceInternal(inv, req);
    };

    window.rejectEditRequest = async function (requestId) {
        const ok = await window.showConfirm({ title: 'Reject Request', message: 'Reject this edit request without changing the invoice?', confirmText: 'Reject', danger: true });
        if (!ok) return;
        try {
            const res = await fetch(`${apiBase()}/invoice-edit-requests/${requestId}/resolve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            await window.syncWithBackend();
            renderInvoices();
            showToast('info', 'Request Rejected', 'The edit request was rejected.');
        } catch (e) { showToast('danger', 'Failed', e.message); }
    };

    // ----- Admin: edit invoice -----
    window.openEditInvoice = function (invoiceId) {
        const inv = (S().invoices || []).find(i => i.id === invoiceId);
        if (inv) openEditInvoiceInternal(inv, null);
    };

    function openEditInvoiceInternal(inv, request) {
        document.getElementById('editInvId').value = inv.id;
        document.getElementById('editInvNo').innerText = inv.invoiceNo || inv.id;
        document.getElementById('editInvRequestId').value = request ? request.id : '';
        document.getElementById('editInvCustomerName').value = inv.customerName || '';
        document.getElementById('editInvCustomerPhone').value = inv.customerPhone || '';
        document.getElementById('editInvOldTotal').innerText = money(inv.grandTotal);

        const ctx = document.getElementById('editInvRequestContext');
        if (request) {
            ctx.classList.remove('hidden');
            ctx.innerHTML = `<strong>${request.requestedByName}</strong> requested: "${request.reason}"`;
        } else {
            ctx.classList.add('hidden');
            ctx.innerHTML = '';
        }

        const isB2B = inv.customerType === 'B2B';
        const body = document.getElementById('editInvItemsBody');
        body.innerHTML = '';
        (inv.items || []).forEach((it, idx) => {
            const unitPrice = isB2B ? it.wholesalePrice : it.retailPrice;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-2 py-2 border-t border-outline-variant/30">${it.productName}</td>
                <td class="px-2 py-2 border-t border-outline-variant/30 text-right" data-unit="${unitPrice}">${money(unitPrice)}</td>
                <td class="px-2 py-2 border-t border-outline-variant/30 text-center">
                    <input type="number" min="0" step="1" value="${it.quantity}" data-name="${encodeURIComponent(it.productName)}" data-unit="${unitPrice}"
                        class="edit-inv-qty w-20 bg-surface-container border border-outline-variant/50 rounded-lg px-2 py-1 text-sm text-center text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container">
                </td>
                <td class="px-2 py-2 border-t border-outline-variant/30 text-right edit-inv-line">${money(unitPrice * it.quantity)}</td>`;
            body.appendChild(row);
        });

        // Live recompute (preview only; server is authoritative)
        body.querySelectorAll('.edit-inv-qty').forEach(inp => {
            inp.addEventListener('input', () => recomputeEditTotal(inv));
        });
        recomputeEditTotal(inv);

        document.getElementById('editInvoiceDialog').showModal();
    }

    function recomputeEditTotal(inv) {
        const body = document.getElementById('editInvItemsBody');
        let net = 0;
        body.querySelectorAll('tr').forEach(tr => {
            const inp = tr.querySelector('.edit-inv-qty');
            if (!inp) return;
            const qty = Math.max(0, Math.trunc(Number(inp.value) || 0));
            const unit = Number(inp.getAttribute('data-unit')) || 0;
            const line = unit * qty;
            net += line;
            const cell = tr.querySelector('.edit-inv-line');
            if (cell) cell.innerText = money(line);
        });
        const taxRate = Number(inv.taxRate || 0);
        const grand = net + net * (taxRate / 100);
        document.getElementById('editInvNewTotal').innerText = money(grand);
    }

    async function saveInvoiceEdit() {
        if (window.requireOnline && !window.requireOnline('edit this invoice')) return;
        const id = document.getElementById('editInvId').value;
        const requestId = document.getElementById('editInvRequestId').value || undefined;
        const customerName = document.getElementById('editInvCustomerName').value.trim();
        const customerPhone = document.getElementById('editInvCustomerPhone').value.trim();

        const items = [];
        document.querySelectorAll('#editInvItemsBody .edit-inv-qty').forEach(inp => {
            const qty = Math.max(0, Math.trunc(Number(inp.value) || 0));
            if (qty > 0) items.push({ name: decodeURIComponent(inp.getAttribute('data-name')), qty });
        });
        if (items.length === 0) { showToast('warning', 'No items', 'Keep at least one item with a quantity above zero.'); return; }

        const ok = await window.showConfirm({
            title: 'Save Invoice Edit',
            message: 'This updates the invoice and reconciles stock, the money log, and B2B credit. Continue?',
            confirmText: 'Save Changes'
        });
        if (!ok) return;

        try {
            const res = await fetch(`${apiBase()}/invoices/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, customerName, customerPhone, editRequestId: requestId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Edit failed');
            document.getElementById('editInvoiceDialog').close();
            await window.syncWithBackend();
            renderInvoices();
            showToast('success', 'Invoice Updated', 'The invoice was edited and all records reconciled.');
        } catch (e) {
            showToast('danger', 'Edit Failed', e.message);
        }
    }
})();
