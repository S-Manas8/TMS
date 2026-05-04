// ============================================================
// FreightBid — Shared API Utility
// All fetch() calls live here. Import this in every HTML page.
// ============================================================

const BASE = "";  // same origin — no need for absolute URL

// ---------- Auth helpers (localStorage) ----------

function saveAuth(data) {
    localStorage.setItem("fb_token", data.token);
    localStorage.setItem("fb_role", data.role);
    localStorage.setItem("fb_name", data.name);
    localStorage.setItem("fb_id", data.id);
}

function getToken() { return localStorage.getItem("fb_token"); }
function getRole() { return localStorage.getItem("fb_role"); }
function getName() { return localStorage.getItem("fb_name"); }
function getUserId() { return localStorage.getItem("fb_id"); }
function isLoggedIn() { return !!getToken(); }

function logout() {
    ["fb_token", "fb_role", "fb_name", "fb_id"].forEach(k => localStorage.removeItem(k));
    window.location.href = "/";
}

// ---------- Core fetch wrapper ----------

async function apiFetch(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(getToken() ? { "Authorization": `Bearer ${getToken()}` } : {}),
        ...(options.headers || {})
    };

    const res = await fetch(BASE + path, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.detail || "Something went wrong");
    }

    return data;
}

// ---------- Auth ----------

async function register(name, email, password, role, phone = "") {
    const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: { name, email, password, role, phone }
    });
    saveAuth(data);
    return data;
}

async function login(email, password) {
    const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: { email, password }
    });
    saveAuth(data);
    return data;
}

// ---------- Shipments ----------

async function postShipment(payload) {
    return apiFetch("/api/shipments/", { method: "POST", body: payload });
}

async function getOpenShipments() {
    return apiFetch("/api/shipments/open");
}

async function getMyShipments() {
    return apiFetch("/api/shipments/my");
}

async function getShipment(id) {
    return apiFetch(`/api/shipments/${id}`);
}

async function updateShipmentStatus(id, status) {
    return apiFetch(`/api/shipments/${id}/status`, {
        method: "PATCH",
        body: { status }
    });
}

// ---------- Bids ----------

async function placeBid(shipmentId, amount) {
    return apiFetch(`/api/${shipmentId}/bid`, {
        method: "POST",
        body: { amount }
    });
}

async function getBids(shipmentId) {
    return apiFetch(`/api/${shipmentId}/bids`);
}

async function awardShipment(shipmentId, bidId = null) {
    return apiFetch(`/api/${shipmentId}/award`, {
        method: "POST",
        body: bidId ? { bid_id: bidId } : {}
    });
}

// ---------- Tracking ----------

async function sendLocation(shipmentId, lat, lng) {
    return apiFetch(`/api/track/${shipmentId}/location`, {
        method: "POST",
        body: { lat, lng }
    });
}

async function getLocation(shipmentId) {
    return apiFetch(`/api/track/${shipmentId}/location`);
}

// ---------- UI helpers ----------

function fmt(amount) {
    return "₹" + Number(amount).toLocaleString("en-IN");
}

function timeAgo(isoString) {
    const diff = (Date.now() - new Date(isoString)) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
}

function calculateTimeTaken(startIso, endIso) {
    if (!startIso || !endIso) return "N/A";
    const start = new Date(startIso);
    const end = new Date(endIso);
    const diffMs = end - start;
    if (diffMs <= 0) return "0m";
    
    const totalMins = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function statusBadge(status) {
    const map = {
        open: ["🟡", "#f59e0b"],
        assigned: ["🔵", "#3b82f6"],
        in_transit: ["🟠", "#fb923c"],
        delivered: ["🟢", "#22c55e"],
    };
    const [icon, color] = map[status] || ["⚪", "#6b7280"];
    return `<span style="color:${color};font-size:0.8rem;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.06em">${icon} ${status.replace("_", " ")}</span>`;
}