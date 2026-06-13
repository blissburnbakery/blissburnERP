/* ==========================================================================
   BLISSBURN ERP - MASTER COORDINATOR & STATE ENGINE (app.js)
   ========================================================================== */

// Global State object containing all operational database tables
window.BlissburnState = {
    products: [],
    ingredients: [],
    fifoQueue: [],
    productionLogs: [],
    partners: [],
    invoices: [],
    financialLog: [],
    notifications: [],
    simulatedDate: "",
    currentRole: "admin"
};

// The database is the single source of truth. The app no longer ships with
// fake demo data — all real data arrives from the server via syncWithBackend().
// State starts empty and is populated only after a successful login + sync.
function emptyState() {
    return {
        products: [],
        ingredients: [],
        fifoQueue: [],
        productionLogs: [],
        partners: [],
        invoices: [],
        financialLog: [],
        notifications: [],
        staff: [],
        simulatedDate: new Date().toISOString().split('T')[0],
        currentRole: sessionStorage.getItem("blissburn_role") || "admin"
    };
}

// Initialize State Engine
document.addEventListener("DOMContentLoaded", () => {
    loadState();
    setupRouting();
    setupSystemClock();
    setupRoleSwitcher();
    setupNotifications();
    setupMobileSidebar();
    setupThemeToggle();
    
    // Proactively trigger active module render
    triggerActiveModuleRender();
});

// Start empty every time. Real data is pulled from the database by
// syncWithBackend() right after login. We also purge any state cached by older
// versions of the app so stale/demo numbers can never reappear.
function loadState() {
    localStorage.removeItem("blissburn_erp_state");
    window.BlissburnState = emptyState();
}

// Reset in-memory state to empty (used on errors and on local sign-out/clear)
function reinitializeState() {
    window.BlissburnState = emptyState();
}

// Recalculate derived fields on the in-memory state. Business data is NOT
// written to localStorage — the database is the only place it lives.
function saveState() {
    // Overdue auto-detection relative to the working date
    if (window.BlissburnState && window.BlissburnState.invoices) {
        window.BlissburnState.invoices.forEach(inv => {
            if (inv.status === "Unpaid" && inv.dueDate && window.BlissburnState.simulatedDate) {
                if (inv.dueDate < window.BlissburnState.simulatedDate) {
                    inv.status = "Overdue";
                }
            }
        });
    }
}

// Coordinate SPA Routing & tab switching
function setupRouting() {
    const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");
    const sections = document.querySelectorAll(".viewport-content .viewport-section");
    
    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const targetView = link.getAttribute("data-view");
            
            // Check authentication session
            const savedSession = sessionStorage.getItem("blissburn_session");
            if (!savedSession) {
                const overlay = document.getElementById("systemLoginOverlay");
                if (overlay) {
                    overlay.style.display = "flex";
                    overlay.classList.remove("hidden");
                }
                return;
            }
            
            // Validate view permissions based on staff role permissions
            if (window.checkViewPermission && !window.checkViewPermission(targetView)) {
                showToast("danger", "Access Denied", "Your active staff role does not have authorization to view this section.");
                return;
            }
            
            // Toggle sidebar active highlights
            navLinks.forEach(n => n.classList.remove("active"));
            link.classList.add("active");
            
            // Toggle view panels
            sections.forEach(sec => sec.classList.remove("active"));
            const targetSec = document.getElementById(`view-${targetView}`);
            if (targetSec) {
                targetSec.classList.add("active");
            }
            
            // Update app header titles Semantically
            updateHeaderTitles(targetView);
            
            // Render specific components on view entering
            renderView(targetView);

            // Close sidebar on mobile upon navigation
            const sidebar = document.getElementById("appSidebar");
            if (sidebar.classList.contains("active")) {
                sidebar.classList.remove("active");
            }
        });
    });
}

// Helper to update headers dynamically
function updateHeaderTitles(view) {
    const titles = {
        dashboard: { main: "Dashboard", sub: "Today's sales, stock, and what needs attention" },
        pos: { main: "Sell at Counter", sub: "Ring up walk-in customers and print receipts" },
        production: { main: "Baking", sub: "Record what you bake — ingredients are deducted automatically" },
        inventory: { main: "Stock & Ingredients", sub: "Raw materials, fresh-stock deliveries, and recipes" },
        b2b: { main: "Business Orders", sub: "Shops and businesses that buy wholesale on account" },
        accounts: { main: "Money & Payments", sub: "Money owed to you, payments received, and the money log" },
        reports: { main: "Reports", sub: "Sales, profit, and demand forecasts for any date range" },
        settings: { main: "Settings", sub: "Bakery details, default rates, staff, and data tools" }
    };
    
    const titleBlock = titles[view] || { main: "Blissburn Management System", sub: "Baking Happiness Daily" };
    document.getElementById("currentViewTitle").innerText = titleBlock.main;
    document.getElementById("currentViewSubtitle").innerText = titleBlock.sub;
}

// Trigger render operations for target view tab
function renderView(view) {
    if (view === "dashboard" && window.renderDashboard) window.renderDashboard();
    if (view === "pos" && window.renderPOS) window.renderPOS();
    if (view === "production" && window.renderProduction) window.renderProduction();
    if (view === "inventory" && window.renderInventory) window.renderInventory();
    if (view === "b2b" && window.renderB2B) window.renderB2B();
    if (view === "accounts" && window.renderAccounts) window.renderAccounts();
    if (view === "reports" && window.renderReports) window.renderReports();
    if (view === "settings" && window.renderSettings) window.renderSettings();
}

function triggerActiveModuleRender() {
    const activeLink = document.querySelector(".sidebar-nav .nav-link.active");
    if (activeLink) {
        renderView(activeLink.getAttribute("data-view"));
    }
}

// Setup simulated date widget in top header bar
function setupSystemClock() {
    const dateInput = document.getElementById("systemDateSim");
    dateInput.value = window.BlissburnState.simulatedDate;
    
    // Changing date recalculates age analyses, notifications, and alerts instantly
    dateInput.addEventListener("change", (e) => {
        window.BlissburnState.simulatedDate = e.target.value;
        saveState();
        
        // Audit system for expired batches and overdue outstandings
        auditFIFOAndInvoices();
        
        // Update header calendar-ops day widget
        updateOpsWeekWidget(e.target.value);
        
        // Push notification of simulated clock update
        addNotification("info", "Simulated Clock Adjusted", `System date simulation modified to ${e.target.value}.`);
        
        // Re-render active view
        triggerActiveModuleRender();
    });
    
    // Run initial operational day review
    updateOpsWeekWidget(window.BlissburnState.simulatedDate);
    auditFIFOAndInvoices();
}

// Visual indicator for 4-day operational week (Sri Lanka context: Mon-Thu)
function updateOpsWeekWidget(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDay(); // 0 Sunday, 1 Monday, ..., 6 Saturday
    const opsText = document.getElementById("opsStatusText");
    const opsLabel = document.querySelector(".calendar-widget-icon");
    
    // Operational Days are Monday (1), Tuesday (2), Wednesday (3), Thursday (4)
    if (day >= 1 && day <= 4) {
        opsText.innerText = "Active Ops Day";
        opsText.className = "text-xs font-semibold text-green-700";
        if (opsLabel) { opsLabel.innerText = "event_available"; opsLabel.className = "material-symbols-outlined text-lg text-green-600 calendar-widget-icon"; }
    } else {
        opsText.innerText = "Non-Ops Weekend";
        opsText.className = "text-xs font-semibold text-red-700";
        if (opsLabel) { opsLabel.innerText = "event_busy"; opsLabel.className = "material-symbols-outlined text-lg text-red-600 calendar-widget-icon"; }
    }
}

// Role-based Visual Access Control
function setupRoleSwitcher() {
    const selector = document.getElementById("roleSelect");
    const nameDisplay = document.getElementById("displayUsername");
    const roleDisplay = document.getElementById("displayRole");
    
    selector.value = window.BlissburnState.currentRole;
    updateUserAvatar(window.BlissburnState.currentRole, nameDisplay, roleDisplay);
    
    selector.addEventListener("change", (e) => {
        const val = e.target.value;
        window.BlissburnState.currentRole = val;
        saveState();
        
        updateUserAvatar(val, nameDisplay, roleDisplay);
        
        // Apply visual modifications based on role limitations
        applyRoleRestrictions(val);
        
        // Add log entry
        addNotification("info", "User Role Assumed", `Switched acting role to ${selector.options[selector.selectedIndex].text}.`);
        
        // Refresh active panel view
        triggerActiveModuleRender();
    });
    
    applyRoleRestrictions(window.BlissburnState.currentRole);
}

function updateUserAvatar(role, nameDisp, roleDisp) {
    const names = {
        admin: { name: "Anura Perera", role: "Owner / Admin" },
        production: { name: "Sunil Silva", role: "Production Manager" },
        sales: { name: "Dilini Cooray", role: "Sales Checkout" },
        delivery: { name: "Chathura Kumara", role: "Delivery Driver" },
        accountant: { name: "Nimal Fernando", role: "Chief Accountant" }
    };
    
    const profile = names[role] || { name: "Guest User", role: "Viewer" };
    nameDisp.innerText = profile.name;
    roleDisp.innerText = profile.role;
}

// Restrict components based on user role
function applyRoleRestrictions(role) {
    const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");
    
    navLinks.forEach(link => {
        const view = link.getAttribute("data-view");
        
        // Role permissions logic
        let permitted = false;
        if (role === "admin") permitted = true;
        else if (role === "production" && ["dashboard", "production", "inventory"].includes(view)) permitted = true;
        else if (role === "sales" && ["dashboard", "pos"].includes(view)) permitted = true;
        else if (role === "delivery" && ["dashboard", "b2b"].includes(view)) permitted = true;
        else if (role === "accountant" && ["dashboard", "b2b", "accounts", "reports"].includes(view)) permitted = true;
        
        if (permitted) {
            link.style.display = "flex";
        } else {
            link.style.display = "none";
            // If currently viewing a locked tab, force back to dashboard
            if (link.classList.contains("active")) {
                const dashLink = document.querySelector('[data-view="dashboard"]');
                if (dashLink) dashLink.click();
            }
        }
    });
}

// Audit FIFO queues for expiration and B2B invoices for overdue debt relative to simulated date
function auditFIFOAndInvoices() {
    const simDateStr = window.BlissburnState.simulatedDate;
    const simDate = new Date(simDateStr);
    
    // Clear dynamic old audits to prevent duplicates
    window.BlissburnState.notifications = window.BlissburnState.notifications.filter(n => !n.isAudit);
    
    // 1. Audit FIFO Queue Expirations
    window.BlissburnState.fifoQueue.forEach(batch => {
        if (batch.remainingQty > 0) {
            const expDate = new Date(batch.expiryDate);
            const diffTime = expDate - simDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            const ing = window.BlissburnState.ingredients.find(i => i.code === batch.ingredientCode);
            const ingName = ing ? ing.name : batch.ingredientCode;
            
            if (diffDays < 0) {
                window.BlissburnState.notifications.unshift({
                    id: `audit-exp-${batch.id}`,
                    type: "danger",
                    title: "Perishable Batch Expired",
                    desc: `${ingName} batch (${batch.id}) expired on ${batch.expiryDate}. Must be discarded.`,
                    time: "Audit Check",
                    isAudit: true
                });
            } else if (diffDays <= 2) {
                window.BlissburnState.notifications.unshift({
                    id: `audit-exp-${batch.id}`,
                    type: "warning",
                    title: "Batch Expiry Warning",
                    desc: `${ingName} batch (${batch.id}) expires in ${diffDays} days (${batch.expiryDate}). Consume immediately!`,
                    time: "Audit Check",
                    isAudit: true
                });
            }
        }
    });

    // 2. Audit Low Stock levels
    window.BlissburnState.ingredients.forEach(ing => {
        if (ing.stock <= ing.threshold) {
            window.BlissburnState.notifications.unshift({
                id: `audit-stock-${ing.code}`,
                type: "warning",
                title: "Low Ingredient Stock",
                desc: `${ing.name} stock level (${(ing.stock/1000).toFixed(1)}kg) is below safe threshold limit.`,
                time: "Audit Check",
                isAudit: true
            });
        }
    });
    
    // 3. Audit B2B Invoices outstanding age
    window.BlissburnState.invoices.forEach(inv => {
        if (inv.customerType === "B2B" && inv.outstanding > 0) {
            const dueDate = new Date(inv.dueDate);
            if (simDate > dueDate) {
                const diffTime = simDate - dueDate;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                
                // Set invoice status as Overdue in schema
                inv.status = "Overdue";
                
                window.BlissburnState.notifications.unshift({
                    id: `audit-inv-${inv.id}`,
                    type: "danger",
                    title: "B2B Invoice Overdue",
                    desc: `${inv.customerName} invoice ${inv.id} is overdue by ${diffDays} days (Due: ${inv.dueDate}).`,
                    time: "Audit Check",
                    isAudit: true
                });
            } else {
                inv.status = "Unpaid";
            }
        }
    });
    
    setupNotifications();
}

// Setup Notifications Drawer toggle and renders
function setupNotifications() {
    const notifBtn = document.getElementById("notifBtn");
    const drawer = document.getElementById("notifDrawer");
    const notifBadge = document.getElementById("notifBadge");
    const notifList = document.getElementById("notifList");
    const clearBtn = document.getElementById("clearNotifBtn");
    
    const count = window.BlissburnState.notifications.length;
    if (count > 0) {
        notifBadge.innerText = count;
        notifBadge.classList.remove("hidden");
    } else {
        notifBadge.classList.add("hidden");
    }
    
    // Drawer click toggle
    notifBtn.onclick = (e) => {
        e.stopPropagation();
        drawer.classList.toggle("hidden");
    };
    
    document.onclick = (e) => {
        if (!drawer.contains(e.target) && e.target !== notifBtn) {
            drawer.classList.add("hidden");
        }
    };
    
    clearBtn.onclick = async () => {
        const ok = await window.showConfirm({ title: "Clear all notifications?", message: "This removes every entry from the notification drawer.", confirmText: "Clear All" });
        if (!ok) return;
        window.BlissburnState.notifications = [];
        saveState();
        // Also clear on backend if available
        try { await fetch(`${API_BASE_URL || ''}/api/notifications/clear`, { method: 'POST' }); } catch(e) { /* offline fallback */ }
        setupNotifications();
    };
    
    // Render list
    notifList.innerHTML = "";
    if (count === 0) {
        notifList.innerHTML = `
            <div class="flex flex-col items-center justify-center py-6 text-center">
                <span class="material-symbols-outlined text-2xl text-outline/40 block mb-2">notifications_off</span>
                <span class="text-sm text-on-surface-variant">No new notifications</span>
            </div>
        `;
        return;
    }
    
    const typeColorMap = { info: 'bg-blue-100 text-blue-700', success: 'bg-green-100 text-green-700', warning: 'bg-amber-100 text-amber-700', danger: 'bg-red-100 text-red-700' };
    const typeIconMap = { info: 'info', success: 'check_circle', warning: 'warning', danger: 'cancel' };
    
    window.BlissburnState.notifications.forEach(item => {
        const notif = document.createElement("div");
        notif.className = "flex items-start gap-3 px-4 py-3 border-b border-outline-variant/20 last:border-none hover:bg-surface-container/50 transition-colors";
        
        const colorCls = typeColorMap[item.type] || typeColorMap.info;
        const iconName = typeIconMap[item.type] || 'info';
        
        notif.innerHTML = `
            <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorCls}">
                <span class="material-symbols-outlined text-sm">${iconName}</span>
            </div>
            <div class="flex-1 min-w-0">
                <span class="text-xs font-semibold text-on-surface block">${item.title}</span>
                <span class="text-[11px] text-on-surface-variant leading-tight mt-0.5 block">${item.desc}</span>
                <span class="text-[10px] text-outline mt-1 block">${formatNotifTime(item.time)}</span>
            </div>
        `;
        notifList.appendChild(notif);
    });
}

// Push system notifications + show toast popup
function addNotification(type, title, desc) {
    window.BlissburnState.notifications.unshift({
        id: `n-${Date.now()}`,
        type: type,
        title: title,
        desc: desc,
        time: new Date().toISOString()
    });
    saveState();
    setupNotifications();
    
    // Show visual toast popup
    showToast(type, title, desc);
}

// Toast notification system
function showToast(type, title, desc) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm';
        document.body.appendChild(container);
    }
    
    const colorMap = {
        info: { bg: 'bg-blue-50 border-blue-200', icon: 'info', iconColor: 'text-blue-600' },
        success: { bg: 'bg-green-50 border-green-200', icon: 'check_circle', iconColor: 'text-green-600' },
        warning: { bg: 'bg-amber-50 border-amber-200', icon: 'warning', iconColor: 'text-amber-600' },
        danger: { bg: 'bg-red-50 border-red-200', icon: 'cancel', iconColor: 'text-red-600' }
    };
    const style = colorMap[type] || colorMap.info;
    
    const toast = document.createElement('div');
    toast.className = `flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg ${style.bg} animate-slide-in-right`;
    toast.innerHTML = `
        <span class="material-symbols-outlined ${style.iconColor} text-lg flex-shrink-0 mt-0.5">${style.icon}</span>
        <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-on-surface">${title}</p>
            <p class="text-xs text-on-surface-variant mt-0.5 line-clamp-2">${desc}</p>
        </div>
        <button class="p-1 rounded-full hover:bg-surface-container/50 flex-shrink-0" onclick="this.parentElement.remove()">
            <span class="material-symbols-outlined text-sm text-outline">close</span>
        </button>
    `;
    container.appendChild(toast);
    
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Promise-based confirmation dialog — replaces native confirm() popups
window.showConfirm = function({ title = "Are you sure?", message = "", confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
    let dialog = document.getElementById("appConfirmDialog");
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "appConfirmDialog";
        dialog.className = "rounded-2xl p-0 backdrop:bg-black/40";
        dialog.innerHTML = `
            <div class="bg-surface-container-lowest p-6 w-[min(90vw,380px)] flex flex-col gap-4">
                <div class="flex items-start gap-3">
                    <div id="confirmDialogIcon" class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined"></span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h3 id="confirmDialogTitle" class="font-display font-bold text-on-surface text-base"></h3>
                        <p id="confirmDialogMessage" class="text-xs text-on-surface-variant mt-1 leading-relaxed"></p>
                    </div>
                </div>
                <div class="flex gap-3">
                    <button id="confirmDialogCancel" class="flex-1 px-4 py-2.5 bg-surface-container text-on-surface rounded-full text-sm font-medium hover:bg-surface-container-high transition-colors">Cancel</button>
                    <button id="confirmDialogOk" class="flex-1 px-4 py-2.5 rounded-full text-sm font-semibold text-white transition-colors"></button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
    }

    dialog.querySelector("#confirmDialogTitle").innerText = title;
    dialog.querySelector("#confirmDialogMessage").innerText = message;
    const okBtn = dialog.querySelector("#confirmDialogOk");
    okBtn.innerText = confirmText;
    okBtn.className = `flex-1 px-4 py-2.5 rounded-full text-sm font-semibold text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90 text-on-primary'}`;
    const iconWrap = dialog.querySelector("#confirmDialogIcon");
    iconWrap.className = `w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${danger ? 'bg-red-100 text-red-700' : 'bg-primary-container/40 text-primary'}`;
    iconWrap.querySelector("span").innerText = danger ? "warning" : "help";

    return new Promise(resolve => {
        const cancelBtn = dialog.querySelector("#confirmDialogCancel");
        cancelBtn.innerText = cancelText;
        const close = (result) => {
            dialog.close();
            resolve(result);
        };
        okBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
        dialog.oncancel = (e) => { e.preventDefault(); close(false); };
        dialog.showModal();
    });
};

// Render a notification timestamp as relative time; legacy non-ISO strings pass through
function formatNotifTime(time) {
    if (!time) return "";
    const d = new Date(time);
    if (isNaN(d.getTime())) return time;
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Setup responsive mobile navigation panels
function setupMobileSidebar() {
    const sidebar = document.getElementById("appSidebar");
    const openBtn = document.getElementById("mobileSidebarOpen");
    const closeBtn = document.getElementById("mobileSidebarClose");
    
    if(openBtn && sidebar) {
        openBtn.onclick = () => sidebar.classList.add("active");
    }
    if(closeBtn && sidebar) {
        closeBtn.onclick = () => sidebar.classList.remove("active");
    }
}

// Theme Toggle Engine (Dark & Light Mode)
function setupThemeToggle() {
    const btn = document.getElementById("themeToggleBtn");
    const icon = document.getElementById("themeToggleIcon");
    if (!btn || !icon) return;
    
    // Check saved theme or default to system preference
    const savedTheme = localStorage.getItem("blissburn_theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    if (savedTheme === "dark" || (!savedTheme && systemDark)) {
        document.documentElement.classList.add("dark");
        icon.innerText = "light_mode";
    } else {
        document.documentElement.classList.remove("dark");
        icon.innerText = "dark_mode";
    }
    
    btn.onclick = () => {
        const isDark = document.documentElement.classList.toggle("dark");
        localStorage.setItem("blissburn_theme", isDark ? "dark" : "light");
        icon.innerText = isDark ? "light_mode" : "dark_mode";
        
        // Show confirmation toast
        showToast("info", "Theme Changed", `Switched to ${isDark ? 'Dark Mode' : 'Light Mode'}.`);
    };
}

/* ==========================================================================
   CORE SYSTEM WIDGETS AND GRID UTILITIES (PAGINATION, CSV, SORTING, EMPTY)
   ========================================================================== */

// 1. Resilient pure-JS client array paginator
window.paginateArray = function(array, page, pageSize) {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return {
        data: array.slice(startIndex, endIndex),
        totalItems: array.length,
        totalPages: Math.ceil(array.length / pageSize) || 1,
        currentPage: page
    };
};

// 2. Premium pagination controls generator
window.renderPaginationControls = function(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }
    
    container.className = "flex items-center justify-between mt-4 px-4 py-3 bg-surface-container/30 border border-outline-variant/30 rounded-xl text-xs";
    container.innerHTML = `
        <button class="px-3 py-1.5 bg-surface-container-lowest text-on-surface hover:bg-surface-container-high border border-outline-variant/30 rounded-full font-medium transition-colors disabled:opacity-40" id="${containerId}-prev" ${currentPage === 1 ? 'disabled' : ''}>
            Previous
        </button>
        <span class="text-on-surface-variant font-semibold">Page ${currentPage} of ${totalPages}</span>
        <button class="px-3 py-1.5 bg-surface-container-lowest text-on-surface hover:bg-surface-container-high border border-outline-variant/30 rounded-full font-medium transition-colors disabled:opacity-40" id="${containerId}-next" ${currentPage === totalPages ? 'disabled' : ''}>
            Next
        </button>
    `;
    
    const prevBtn = document.getElementById(`${containerId}-prev`);
    const nextBtn = document.getElementById(`${containerId}-next`);
    
    if (prevBtn) prevBtn.onclick = () => onPageChange(currentPage - 1);
    if (nextBtn) nextBtn.onclick = () => onPageChange(currentPage + 1);
};

// 3. Robust client-side spreadsheet downloader
window.exportToCSV = function(headers, rows, filename) {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += headers.map(h => `"${h}"`).join(",") + "\n";
    
    rows.forEach(row => {
        csvContent += row.map(cell => {
            const formatted = cell === null || cell === undefined ? "" : cell;
            return `"${String(formatted).replace(/"/g, '""')}"`;
        }).join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("success", "Export Successful", `Downloaded ${filename}.`);
};

// 4. Custom illustration-rich empty state templates
window.renderEmptyState = function(containerId, colSpan, message, iconName = "inventory_2") {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
        <tr>
            <td colspan="${colSpan}" class="px-4 py-8">
                <div class="flex flex-col items-center justify-center p-6 text-center border border-dashed border-outline-variant/50 rounded-2xl bg-surface-container/20">
                    <span class="material-symbols-outlined text-4xl text-outline animate-pulse select-none">${iconName}</span>
                    <p class="mt-3 text-sm font-semibold text-on-surface">${message}</p>
                    <p class="text-xs text-on-surface-variant mt-1.5">Nothing here yet — add an entry, or try a different search.</p>
                </div>
            </td>
        </tr>
    `;
};

/* ==========================================================================
   SETTINGS MODULE CONTROLLER
   ========================================================================== */
window.renderSettings = function() {
    const state = window.BlissburnState;
    
    // Ensure configuration containers exist
    if (!state.bakeryConfig) {
        state.bakeryConfig = {
            name: "Blissburn Products Co.",
            address: "Industrial Estate, Zone B, Colombo, Sri Lanka",
            phone: "+94 11 2345 678"
        };
    }
    if (!state.globalConfig) {
        state.globalConfig = {
            defaultVAT: 8,
            defaultCreditLimit: 100000,
            autoPrintReceipt: false
        };
    }

    // Populate form fields
    document.getElementById("settingsBakeryName").value = state.bakeryConfig.name;
    document.getElementById("settingsBakeryAddress").value = state.bakeryConfig.address;
    document.getElementById("settingsBakeryPhone").value = state.bakeryConfig.phone;

    document.getElementById("settingsDefaultVAT").value = state.globalConfig.defaultVAT;
    document.getElementById("settingsDefaultCreditLimit").value = state.globalConfig.defaultCreditLimit;
    const autoPrintToggle = document.getElementById("settingsAutoPrint");
    if (autoPrintToggle) autoPrintToggle.checked = Boolean(state.globalConfig.autoPrintReceipt);

    // Persist configuration in the database when online, localStorage otherwise
    async function persistGlobalConfig() {
        saveState();
        if (window.BACKEND_AVAILABLE) {
            try {
                const res = await fetch(`${window.location.origin}/api/config`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        defaultVAT: state.globalConfig.defaultVAT,
                        defaultCreditLimit: state.globalConfig.defaultCreditLimit,
                        autoPrintReceipt: state.globalConfig.autoPrintReceipt,
                        bakeryName: state.bakeryConfig.name,
                        bakeryAddress: state.bakeryConfig.address,
                        bakeryPhone: state.bakeryConfig.phone
                    })
                });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Config save failed');
                }
                return true;
            } catch (e) {
                showToast("warning", "Saved Locally Only", `Could not persist settings to the database: ${e.message}`);
                return false;
            }
        }
        return true;
    }

    // Bind Business Config submit
    document.getElementById("settingsBusinessForm").onsubmit = async (e) => {
        e.preventDefault();
        state.bakeryConfig.name = document.getElementById("settingsBakeryName").value.trim();
        state.bakeryConfig.address = document.getElementById("settingsBakeryAddress").value.trim();
        state.bakeryConfig.phone = document.getElementById("settingsBakeryPhone").value.trim();

        await persistGlobalConfig();
        showToast("success", "Profile Updated", "Registered business profile details saved successfully.");
    };

    // Bind Global Defaults apply
    document.getElementById("saveGlobalDefaultsBtn").onclick = async () => {
        state.globalConfig.defaultVAT = Number(document.getElementById("settingsDefaultVAT").value);
        state.globalConfig.defaultCreditLimit = Number(document.getElementById("settingsDefaultCreditLimit").value);
        if (autoPrintToggle) state.globalConfig.autoPrintReceipt = autoPrintToggle.checked;

        await persistGlobalConfig();
        showToast("success", "Settings Saved", "Global default parameters applied successfully.");
    };

    // Bind Database reset
    document.getElementById("systemWipedownBtn").onclick = async () => {
        const ok = await window.showConfirm({
            title: "Factory System Wipedown",
            message: "This formats all invoice logs, production quotas, B2B client accounts, and resets every ledger back to seed values on this device. This action cannot be undone.",
            confirmText: "Wipe Everything",
            danger: true
        });
        if (ok) {
            sessionStorage.clear();
            localStorage.removeItem("blissburn_erp_state");
            showToast("info", "Database Formatted", "System state wiped back to factory default values. Reloading...");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    };

    // Show/hide Staff card based on role
    const staffCard = document.getElementById("settingsStaffCard");
    const activeRole = sessionStorage.getItem("blissburn_role");
    
    if (activeRole === "admin" && staffCard) {
        staffCard.classList.remove("hidden");
        window.renderStaffManager();
    } else if (staffCard) {
        staffCard.classList.add("hidden");
    }

    // SMS Notifications card (admin only)
    const smsCard = document.getElementById("settingsSmsCard");
    if (smsCard) {
        if (activeRole === "admin") {
            smsCard.classList.remove("hidden");
            const cfg = state.globalConfig || {};
            const en = document.getElementById("settingsSmsEnabled");
            const prov = document.getElementById("settingsSmsProvider");
            const sender = document.getElementById("settingsSmsSenderId");
            const userId = document.getElementById("settingsSmsUserId");
            const token = document.getElementById("settingsSmsApiToken");
            if (en) en.checked = Boolean(cfg.smsEnabled);
            if (prov) prov.value = cfg.smsProvider || "textlk";
            if (sender) sender.value = cfg.smsSenderId || "";
            if (userId) userId.value = cfg.smsUserId || "";
            if (token) token.placeholder = cfg.smsApiTokenSet ? "Token saved — leave blank to keep" : "Enter token";

            const saveBtn = document.getElementById("saveSmsSettingsBtn");
            if (saveBtn) saveBtn.onclick = async () => {
                if (window.requireOnline && !window.requireOnline("save SMS settings")) return;
                const payload = {
                    smsEnabled: en.checked,
                    smsProvider: prov.value,
                    smsSenderId: sender.value.trim(),
                    smsUserId: userId.value.trim()
                };
                if (token.value.trim()) payload.smsApiToken = token.value.trim();
                try {
                    const res = await fetch(`${window.location.origin}/api/config`, {
                        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Save failed");
                    token.value = "";
                    await window.syncWithBackend();
                    showToast("success", "SMS Settings Saved", "Text-message settings updated.");
                } catch (e) {
                    showToast("danger", "Save Failed", e.message);
                }
            };

            const testBtn = document.getElementById("sendTestSmsBtn");
            if (testBtn) testBtn.onclick = async () => {
                if (window.requireOnline && !window.requireOnline("send a test SMS")) return;
                const to = document.getElementById("settingsSmsTestTo").value.trim();
                if (!to) { showToast("warning", "Enter a number", "Type a mobile number to send the test to."); return; }
                try {
                    const res = await fetch(`${window.location.origin}/api/sms/test`, {
                        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Test failed");
                    showToast("success", "Test Sent", `A test message was sent to ${to}.`);
                } catch (e) {
                    showToast("danger", "Test Failed", e.message);
                }
            };
        } else {
            smsCard.classList.add("hidden");
        }
    }

    // Bind Add Staff triggers
    const addStaffBtn = document.getElementById("addStaffBtn");
    const closeStaffBtn = document.getElementById("closeAddStaffDialog");
    const staffDialog = document.getElementById("addStaffDialog");
    const staffForm = document.getElementById("addStaffForm");
    
    if (addStaffBtn) {
        addStaffBtn.onclick = () => {
            document.getElementById("staffDialogTitle").innerText = "Register New Staff Account";
            document.getElementById("submitStaffBtn").innerHTML = `<span class="material-symbols-outlined text-base">person_add</span> Register Staff`;
            document.getElementById("editStaffId").value = "";
            document.getElementById("staffUsername").disabled = false;
            if (staffForm) staffForm.reset();
            // New accounts must set a password
            const passField = document.getElementById("staffPasskey");
            passField.required = true;
            passField.placeholder = "Set a login password";
            if (staffDialog) staffDialog.showModal();
        };
    }
    
    if (closeStaffBtn && staffDialog) {
        closeStaffBtn.onclick = () => staffDialog.close();
    }
    
    // Staff create/update is handled by the server in js/api.js (capture phase),
    // which also blocks the action while offline. No local/offline staff path.
};

// Staff Account Access Registry Renderer & Controller
window.renderStaffManager = function() {
    const body = document.getElementById("settingsStaffBody");
    const state = window.BlissburnState;
    if (!body) return;
    body.innerHTML = "";
    
    const staffList = state.staff || [];
    if (staffList.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-sm text-on-surface-variant">No staff accounts loaded. Sign in as an owner/admin to manage staff.</td></tr>`;
        return;
    }

    staffList.forEach(member => {
        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container/50 transition-colors";
        
        let roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-outline-variant/35 text-on-surface">Guest</span>`;
        if (member.role === "admin") {
            roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Owner / Admin</span>`;
        } else if (member.role === "production") {
            roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Production</span>`;
        } else if (member.role === "sales") {
            roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Sales</span>`;
        } else if (member.role === "accountant") {
            roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Accountant</span>`;
        } else if (member.role === "delivery") {
            roleBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Delivery</span>`;
        }
        
        // Passwords are never sent to the browser — always shown hidden
        const obfKey = "••••••";
        
        row.innerHTML = `
            <td class="px-4 py-3 border-t border-outline-variant/30 font-semibold">${member.name}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30"><code class="text-xs bg-surface-container px-1.5 py-0.5 rounded">${member.username}</code></td>
            <td class="px-4 py-3 border-t border-outline-variant/30">${roleBadge}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 text-on-surface-variant font-mono text-xs font-bold">${obfKey}</td>
            <td class="px-4 py-3 border-t border-outline-variant/30 text-right font-medium">
                <div class="flex justify-end gap-1.5">
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-primary bg-primary-container/20 rounded-lg hover:bg-primary-container/50 transition-colors" onclick="window.editStaffMember('${member.id || member.username}')">
                        <span class="material-symbols-outlined text-sm">edit</span> Edit
                    </button>
                    <button class="inline-flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" onclick="window.deleteStaffMember('${member.id || member.username}')" ${member.username === 'anura' ? 'disabled style="opacity: 0.4"' : ''}>
                        <span class="material-symbols-outlined text-sm">delete</span> Terminate
                    </button>
                </div>
            </td>
        `;
        body.appendChild(row);
    });
};

// Wire up Staff actions globally on window
window.editStaffMember = function(id) {
    const state = window.BlissburnState;
    const member = state.staff.find(m => (m.id === id || m.username === id));
    if (!member) return;
    
    document.getElementById("staffDialogTitle").innerText = "Edit Staff Access Credentials";
    document.getElementById("submitStaffBtn").innerHTML = `<span class="material-symbols-outlined text-base">save</span> Update Credentials`;
    
    document.getElementById("editStaffId").value = member.id || member.username;
    document.getElementById("staffName").value = member.name;
    document.getElementById("staffUsername").value = member.username;
    document.getElementById("staffUsername").disabled = true; // disable username changes
    document.getElementById("staffRole").value = member.role;
    // Passwords are never loaded back. Leave blank = keep current; type to change.
    const passField = document.getElementById("staffPasskey");
    passField.value = "";
    passField.required = false;
    passField.placeholder = "Leave blank to keep current password";

    document.getElementById("addStaffDialog").showModal();
};

window.deleteStaffMember = async function(id) {
    const state = window.BlissburnState;
    const member = state.staff.find(m => (m.id === id || m.username === id));
    if (!member) return;
    
    if (member.username === "anura") {
        showToast("danger", "Protected Account", "Primary owner/admin account 'anura' cannot be deleted.");
        return;
    }

    const ok = await window.showConfirm({
        title: "Terminate Staff Access",
        message: `This permanently removes platform access for ${member.name} (${member.username}).`,
        confirmText: "Terminate",
        danger: true
    });
    if (!ok) return;

    if (window.BACKEND_AVAILABLE) {
        try {
            const res = await fetch(`${window.location.origin}/api/staff/${member.id || member.username}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Delete failed");
            await window.syncWithBackend();
        } catch (e) {
            showToast("danger", "Termination Failed", e.message);
            return;
        }
    } else {
        // Offline delete
        state.staff = state.staff.filter(m => (m.id !== id && m.username !== id));
        saveState();
    }
    
    window.renderStaffManager();
    addNotification("warning", "Platform Access Terminated", `Employee account '${member.name}' terminated.`);
};
