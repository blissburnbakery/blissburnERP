/* ==========================================================================
   BLISSBURN ERP - SECURITY & ROLE-BASED ACCESS CONTROL ENGINE (auth.js)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initAuthEngine();
});

function initAuthEngine() {
    const overlay = document.getElementById("systemLoginOverlay");
    const form = document.getElementById("systemLoginForm");
    const passInput = document.getElementById("loginPass");
    const roleSelect = document.getElementById("loginRole");
    const logoutBtn = document.getElementById("logoutBtn");
    
    // Role definitions and their permitted views
    const ROLE_PERMISSIONS = {
        admin: ["dashboard", "pos", "production", "inventory", "b2b", "accounts", "settings"],
        production: ["production", "inventory", "settings"],
        sales: ["pos", "b2b", "settings"],
        delivery: ["b2b"],
        accountant: ["dashboard", "accounts", "settings"]
    };

    // Check existing session
    const savedSession = sessionStorage.getItem("blissburn_session");
    const savedRole = sessionStorage.getItem("blissburn_role");
    const savedName = sessionStorage.getItem("blissburn_name");
    
    if (savedSession && savedRole) {
        // Authenticated session exists
        if (overlay) overlay.style.display = "none";
        window.BlissburnState.currentRole = savedRole;
        applyRoleRestrictions(savedRole);
        updateSidebarRoleProfile(savedRole, savedName);
    } else {
        // Unauthenticated - enforce overlay lock
        if (overlay) {
            overlay.style.display = "flex";
            overlay.classList.remove("hidden");
        }
        // Force routing to be blocked
        blockSystemRoutes();
    }

    // Authenticate submission
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById("loginUsername");
            const username = usernameInput ? usernameInput.value.trim().toLowerCase() : "";
            const passkey = passInput.value.trim();
            
            if (!username || !passkey) return;

            let authenticatedUser = null;

            // Login is server-only. There are no offline/built-in passwords —
            // the database verifies every login and issues the session token.
            try {
                const res = await fetch(`${window.location.origin}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, passkey })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    authenticatedUser = data.user;
                    if (data.token) {
                        sessionStorage.setItem('blissburn_token', data.token);
                    }
                } else {
                    // Wrong username/password (401) or other server-reported error
                    showToast("danger", "Sign-in Failed", data.error || "Incorrect username or password.");
                    passInput.value = "";
                    passInput.focus();
                    return;
                }
            } catch (err) {
                console.warn("Cannot reach the server for login", err);
                showToast("danger", "Can't Reach Server", "Could not connect to the bakery server. Check your connection and try again.");
                return;
            }

            if (authenticatedUser) {
                const selectedRole = authenticatedUser.role;
                
                sessionStorage.setItem("blissburn_session", "active-" + Date.now());
                sessionStorage.setItem("blissburn_role", selectedRole);
                sessionStorage.setItem("blissburn_name", authenticatedUser.name);
                sessionStorage.setItem("blissburn_username", authenticatedUser.username);
                
                window.BlissburnState.currentRole = selectedRole;
                
                // Hide boot lock overlay
                if (overlay) {
                    overlay.style.opacity = "0";
                    setTimeout(() => {
                        overlay.style.display = "none";
                    }, 500);
                }
                
                // Set default display details in sidebar
                updateSidebarRoleProfile(selectedRole, authenticatedUser.name);
                
                // Enforce permissions
                applyRoleRestrictions(selectedRole);

                // Pull fresh authorized data now that we hold a session token
                if (window.syncWithBackend) {
                    await window.syncWithBackend();
                }

                // Re-route to the first permitted view for this role
                const permittedViews = ROLE_PERMISSIONS[selectedRole] || [];
                if (permittedViews.length > 0) {
                    navigateToView(permittedViews[0]);
                }

                showToast("success", "Access Granted", `Welcome back, ${authenticatedUser.name}!`);

                // First-time users get the "How it works" walkthrough once
                if (window.maybeShowFirstRunGuide) window.maybeShowFirstRunGuide();
            } else {
                showToast("danger", "Authentication Failed", "Incorrect username or access key.");
                passInput.value = "";
                passInput.focus();
            }
        };
    }

    // Sign out button
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            const ok = await window.showConfirm({
                title: "Sign Out",
                message: "End your Blissburn portal session on this device?",
                confirmText: "Sign Out"
            });
            if (ok) {
                sessionStorage.clear();
                window.location.reload();
            }
        };
    }

    // Function to apply access list restrictions
    function applyRoleRestrictions(role) {
        const permittedViews = ROLE_PERMISSIONS[role] || [];
        const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");

        // Update user profile metadata in sidebar
        updateSidebarRoleProfile(role);

        // The simulated-date control changes due dates and expiry audits
        // system-wide — owner/admin only
        const dateSimInput = document.getElementById("systemDateSim");
        const dateSimWidget = document.getElementById("dateSimWidget");
        if (dateSimInput && dateSimWidget) {
            if (role === "admin") {
                dateSimWidget.style.display = "";
                dateSimInput.disabled = false;
            } else {
                dateSimInput.disabled = true;
                dateSimWidget.style.display = "none";
            }
        }
        
        // Synch top role selector with active session role
        const systemRoleSelector = document.getElementById("roleSelect");
        if (systemRoleSelector) {
            systemRoleSelector.value = role;
            // Disable selecting another role from header unless admin is active
            systemRoleSelector.disabled = (role !== "admin");
        }

        // Restrict sidebar items visually and functionally
        navLinks.forEach(link => {
            const view = link.getAttribute("data-view");
            if (permittedViews.includes(view)) {
                link.classList.remove("opacity-40", "pointer-events-none");
                link.style.display = "flex";
            } else {
                link.classList.add("opacity-40", "pointer-events-none");
                // Optional: hide highly sensitive tabs entirely if not admin/accountant
                if (role !== "admin" && (view === "accounts" || view === "settings")) {
                    link.style.display = "none";
                }
            }
        });
    }

    // Block all routes if not logged in
    function blockSystemRoutes() {
        const sections = document.querySelectorAll(".viewport-content .viewport-section");
        sections.forEach(sec => sec.classList.remove("active"));
        
        const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");
        navLinks.forEach(link => {
            link.classList.add("opacity-40", "pointer-events-none");
        });
    }

    // Helper to switch view programmatically
    function navigateToView(view) {
        const navLink = document.querySelector(`.sidebar-nav .nav-link[data-view="${view}"]`);
        if (navLink) {
            navLink.click();
        }
    }

    // Get role display name
    function getFriendlyRoleName(role) {
        const names = {
            admin: "Owner / Admin",
            production: "Production Manager",
            sales: "Sales Counter Staff",
            delivery: "Delivery Team",
            accountant: "Accountant / Auditor"
        };
        return names[role] || role;
    }

    // Update user profile section in sidebar footer
    function updateSidebarRoleProfile(role, name) {
        const displayUsername = document.getElementById("displayUsername");
        const displayRole = document.getElementById("displayRole");
        
        const staffNames = {
            admin: "Anura Perera",
            production: "Sunil Gamage",
            sales: "Nisha Fernando",
            delivery: "Kamal Silva",
            accountant: "Pradeep Silva"
        };

        if (displayUsername) displayUsername.innerText = name || staffNames[role] || "Portal Guest";
        if (displayRole) displayRole.innerText = getFriendlyRoleName(role);
    }
}

// Global hook to restrict route access when users manually trigger hash changes or routing triggers
window.checkViewPermission = function(view) {
    const savedRole = sessionStorage.getItem("blissburn_role") || "admin";
    
    const ROLE_PERMISSIONS = {
        admin: ["dashboard", "pos", "production", "inventory", "b2b", "accounts", "settings"],
        production: ["production", "inventory", "settings"],
        sales: ["pos", "b2b", "settings"],
        delivery: ["b2b"],
        accountant: ["dashboard", "accounts", "settings"]
    };

    const permitted = ROLE_PERMISSIONS[savedRole] || [];
    return permitted.includes(view);
};
