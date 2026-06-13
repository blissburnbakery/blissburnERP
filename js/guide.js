/* ==========================================================================
   BLISSBURN ERP - IN-APP GUIDANCE (guide.js)
   - "How BlissBurn works" panel (Buy → Bake → Sell → Get paid)
   - First-run welcome (shown once per browser via localStorage)
   - Header "?" help button re-opens it
   - Per-screen quick tips keyed to the current view
   ========================================================================== */
(function () {
    'use strict';

    const SEEN_KEY = 'blissburn_seen_guide';

    // Plain-language tip for each screen
    const VIEW_TIPS = {
        dashboard: { icon: 'dashboard', title: 'Dashboard', text: "Your daily snapshot: money in, money owed to you, what's low on stock, and what's expiring soon. Start your morning here." },
        pos: { icon: 'point_of_sale', title: 'Sell at Counter', text: "Tap a product (or use + / −) to build the sale. Pick Cash, Card, or On Account, enter cash given to see the change, then Complete Checkout to print the receipt." },
        production: { icon: 'cookie', title: 'Baking', text: "Record what you baked. The system shows the ingredients it will use, warns if you're short, and tells you the most you can make right now." },
        inventory: { icon: 'inventory_2', title: 'Stock & Ingredients', text: "Three tabs: ingredient stock levels, your recipes, and fresh-stock deliveries. Add a delivery whenever new ingredients arrive." },
        b2b: { icon: 'local_shipping', title: 'Business Orders', text: "Shops and businesses that buy in bulk and pay later. Each has a credit limit so they can't owe more than you allow." },
        accounts: { icon: 'account_balance', title: 'Money & Payments', text: "See who owes you money and how long it's been outstanding, record payments when they come in, and review every money movement." },
        settings: { icon: 'settings', title: 'Settings', text: "Your bakery details, default tax rate, auto-print, and staff accounts. Admin only." }
    };

    const STEPS = [
        { icon: 'inventory_2', color: '#8a6d00', title: '1. Buy ingredients', text: 'Record stock deliveries under Stock & Ingredients. Fresh items get an expiry date automatically.' },
        { icon: 'cookie', color: '#b07d00', title: '2. Bake', text: 'Log what you bake. Ingredients are deducted for you, using the oldest stock first so nothing spoils.' },
        { icon: 'point_of_sale', color: '#c98a00', title: '3. Sell', text: 'Ring up customers at the counter. Only fresh, in-date stock can be sold. Receipts print automatically if you like.' },
        { icon: 'payments', color: '#3c7a3c', title: '4. Get paid', text: 'Cash sales are done instantly. Businesses can buy on account — track what they owe under Money & Payments.' }
    ];

    function buildModal() {
        let dialog = document.getElementById('howItWorksDialog');
        if (dialog) return dialog;

        dialog = document.createElement('dialog');
        dialog.id = 'howItWorksDialog';
        dialog.className = 'rounded-3xl p-0 backdrop:bg-black/50';
        document.body.appendChild(dialog);
        return dialog;
    }

    function stepCard(s) {
        return `
            <div class="flex items-start gap-3 p-3 rounded-2xl bg-surface-container/50">
                <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background:${s.color}1a;color:${s.color}">
                    <span class="material-symbols-outlined">${s.icon}</span>
                </div>
                <div>
                    <p class="font-semibold text-on-surface text-sm">${s.title}</p>
                    <p class="text-xs text-on-surface-variant mt-0.5 leading-relaxed">${s.text}</p>
                </div>
            </div>`;
    }

    window.showHowItWorks = function () {
        const dialog = buildModal();

        // Tip for whatever screen the user is currently on
        const activeLink = document.querySelector('.sidebar-nav .nav-link.active');
        const view = activeLink ? activeLink.getAttribute('data-view') : 'dashboard';
        const tip = VIEW_TIPS[view] || VIEW_TIPS.dashboard;

        dialog.innerHTML = `
            <div class="bg-surface-container-lowest w-[min(94vw,560px)] max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-5">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h2 class="font-display text-xl font-bold text-on-surface">How BlissBurn works</h2>
                        <p class="text-xs text-on-surface-variant mt-1">The whole system follows one simple loop:</p>
                    </div>
                    <button id="howItWorksClose" class="p-1.5 rounded-full hover:bg-surface-container transition-colors flex-shrink-0">
                        <span class="material-symbols-outlined text-on-surface-variant">close</span>
                    </button>
                </div>

                <div class="flex flex-col gap-2.5">
                    ${STEPS.map(stepCard).join('')}
                </div>

                <div class="rounded-2xl border border-primary-container/50 bg-primary-container/10 p-4">
                    <p class="text-[11px] uppercase tracking-wider font-semibold text-primary mb-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">${tip.icon}</span> On this screen — ${tip.title}
                    </p>
                    <p class="text-sm text-on-surface leading-relaxed">${tip.text}</p>
                </div>

                <button id="howItWorksDone" class="w-full px-4 py-3 bg-primary text-on-primary rounded-full font-display font-bold text-sm hover:bg-primary/90 transition-colors">
                    Got it
                </button>
                <p class="text-[11px] text-on-surface-variant text-center -mt-2">Tap the <span class="material-symbols-outlined text-xs align-middle">help</span> button up top to see this again anytime.</p>
            </div>`;

        const close = () => { try { dialog.close(); } catch (e) {} };
        dialog.querySelector('#howItWorksClose').onclick = close;
        dialog.querySelector('#howItWorksDone').onclick = close;
        dialog.oncancel = (e) => { e.preventDefault(); close(); };

        try { dialog.showModal(); } catch (e) { /* dialog already open */ }
        localStorage.setItem(SEEN_KEY, '1');
    };

    // First-run: show once, automatically, after the user is signed in
    window.maybeShowFirstRunGuide = function () {
        if (localStorage.getItem(SEEN_KEY)) return;
        setTimeout(() => window.showHowItWorks(), 600);
    };

    document.addEventListener('DOMContentLoaded', () => {
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) helpBtn.onclick = () => window.showHowItWorks();

        // If a session already exists (returning, mid-session reload), offer the
        // first-run guide once. Fresh logins trigger it from auth.js.
        if (sessionStorage.getItem('blissburn_session')) {
            window.maybeShowFirstRunGuide();
        }
    });
})();
