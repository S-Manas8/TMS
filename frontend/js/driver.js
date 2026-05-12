// ============================================================
// FreightBid — Driver Dashboard Logic
// ============================================================

if (!isLoggedIn() || getRole() !== 'driver') {
    window.location.href = '/';
}

document.getElementById('nav-name').textContent = getName();

let selectedLoad = null;
let openLoads    = [];
let myBidsMap    = {};   // shipment_id → amount

// ── Open Loads ────────────────────────────────────────────────
async function loadOpenLoads() {
    const container = document.getElementById('open-loads-list');
    try {
        openLoads = await getOpenShipments();
        document.getElementById('stat-open').textContent = openLoads.length;

        if (!openLoads.length) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No open loads right now.</p></div>';
            return;
        }

        container.innerHTML = openLoads.map(s => {
            const dest = s.destinations && s.destinations.length > 0
                ? (s.destinations.length > 1 ? s.destinations.length + ' Stops' : s.destinations[0].address)
                : (s.drop_address || 'N/A');
            return `<div class="load-card card" style="margin-bottom:10px;padding:16px"
                         id="lcard-${s.id}" onclick="selectLoad('${s.id}')">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-weight:700;font-size:0.95rem">${s.pickup_address} → ${dest}</div>
                    ${myBidsMap[s.id] ? `<span class="already-bid-badge">Bid: ${fmt(myBidsMap[s.id])}</span>` : ''}
                </div>
                <div class="meta-row" style="gap:16px">
                    <div class="meta-item"><span class="meta-label">Goods</span><span class="meta-value" style="font-size:0.85rem">${s.goods_desc}</span></div>
                    <div class="meta-item"><span class="meta-label">Weight</span><span class="meta-value">${s.weight_kg} kg</span></div>
                    <div class="meta-item"><span class="meta-label">Vehicle</span><span class="meta-value">${s.vehicle_type}</span></div>
                    ${s.est_time_hours ? `<div class="meta-item"><span class="meta-label">Est. Time</span><span class="meta-value">${s.est_time_hours}h</span></div>` : ''}
                    ${s.bid_count > 0 ? `<div class="meta-item"><span class="meta-label">Bids</span><span class="meta-value accent">${s.bid_count}</span></div>` : ''}
                </div>
                ${s.deadline ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:6px;font-family:var(--font-mono)">Deadline: ${new Date(s.deadline).toLocaleString()}</div>` : ''}
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
}

// ── Select Load → Bid Panel ───────────────────────────────────
async function selectLoad(id) {
    document.querySelectorAll('.load-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`lcard-${id}`)?.classList.add('selected');

    selectedLoad = openLoads.find(x => x.id === id);
    if (!selectedLoad) return;

    document.getElementById('bid-placeholder').style.display = 'none';
    document.getElementById('bid-panel').style.display = 'block';
    document.getElementById('bid-alert').innerHTML = '';
    document.getElementById('bid-panel-title').textContent = selectedLoad.goods_desc;
    document.getElementById('bid-panel-status').innerHTML = statusBadge(selectedLoad.status);

    const destDisplay = selectedLoad.destinations && selectedLoad.destinations.length > 0
        ? selectedLoad.destinations.map(d => `<div style="font-size:0.85rem;margin-left:8px;">📍 ${d.address}</div>`).join('')
        : `<span class="route-to">${selectedLoad.drop_address || 'N/A'}</span>`;

    document.getElementById('bid-panel-route').innerHTML =
        `<div class="route-display" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="route-from">${selectedLoad.pickup_address}</span>
                <span class="route-arrow">→</span>
            </div>
            ${destDisplay}
        </div>`;

    document.getElementById('bid-panel-meta').innerHTML =
        `<div class="meta-item"><span class="meta-label">Weight</span><span class="meta-value">${selectedLoad.weight_kg} kg</span></div>
         <div class="meta-item"><span class="meta-label">Vehicle</span><span class="meta-value">${selectedLoad.vehicle_type}</span></div>
         ${selectedLoad.est_time_hours ? `<div class="meta-item"><span class="meta-label">Est. Time</span><span class="meta-value">${selectedLoad.est_time_hours}h</span></div>` : ''}
         ${selectedLoad.bid_count > 0 ? `<div class="meta-item"><span class="meta-label">Bids So Far</span><span class="meta-value accent">${selectedLoad.bid_count}</span></div>` : ''}
         <div class="meta-item"><span class="meta-label">Posted</span><span class="meta-value" style="font-size:0.85rem">${timeAgo(selectedLoad.created_at)}</span></div>`;

    const myBid = myBidsMap[id];
    if (myBid) {
        document.getElementById('bid-panel-myBid').innerHTML = `<div class="alert alert-success">✓ You bid ${fmt(myBid)} — you can lower it below.</div>`;
        document.getElementById('bid-amount').value = myBid;
        document.getElementById('bid-btn').textContent = 'Update Bid';
    } else {
        document.getElementById('bid-panel-myBid').innerHTML = '';
        document.getElementById('bid-amount').value = '';
        document.getElementById('bid-btn').textContent = 'Place Bid';
    }
}

// ── Bid Placement ─────────────────────────────────────────────
function doPlaceBid() {
    const amount = document.getElementById('bid-amount').value;
    if (!selectedLoad) return;
    if (!amount || Number(amount) <= 0) {
        document.getElementById('bid-alert').innerHTML = '<div class="alert alert-error">Enter a valid bid amount.</div>';
        return;
    }
    if (myBidsMap[selectedLoad.id]) {
        submitBid(Number(amount));
    } else {
        showBidAssurance(selectedLoad, Number(amount));
    }
}

function showBidAssurance(load, amount) {
    const existing = document.getElementById('bid-assurance-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'bid-assurance-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;';
    modal.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:32px;max-width:440px;width:100%;">
            <div style="text-align:center;margin-bottom:20px;">
                <div style="font-size:2.5rem;margin-bottom:8px;">🤝</div>
                <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Delivery Assurance</div>
                <div style="font-size:0.82rem;color:var(--muted);">Read and confirm before placing your bid</div>
            </div>
            <div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:20px;border-left:3px solid var(--accent);">
                <div style="font-size:0.75rem;color:var(--muted);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Your Bid</div>
                <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${fmt(amount)}</div>
                <div style="font-size:0.82rem;color:var(--muted);margin-top:4px;">${load.goods_desc} · ${load.pickup_address}</div>
            </div>
            <div style="font-size:0.85rem;margin-bottom:24px;">
                By placing this bid, I confirm that:
                <ul style="margin:10px 0 0 16px;color:var(--muted);font-size:0.82rem;line-height:1.7;">
                    <li>I will deliver all goods safely and on time if awarded</li>
                    <li>I will follow the route stops in the given order</li>
                    <li>I will keep the shipper updated on my progress</li>
                    <li>I take full responsibility for the goods during transit</li>
                </ul>
            </div>
            <div style="display:flex;gap:12px;">
                <button onclick="document.getElementById('bid-assurance-modal').remove()" class="btn btn-outline" style="flex:1;">✕ Cancel</button>
                <button onclick="document.getElementById('bid-assurance-modal').remove(); submitBid(${amount})" class="btn btn-primary" style="flex:2;font-weight:700;">✅ Agree &amp; Place Bid</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

async function submitBid(amount) {
    const alertEl = document.getElementById('bid-alert');
    const btn     = document.getElementById('bid-btn');
    btn.disabled  = true;
    btn.textContent = 'Submitting...';
    try {
        const result = await placeBid(selectedLoad.id, amount);
        myBidsMap[selectedLoad.id] = amount;
        alertEl.innerHTML = `<div class="alert alert-success">✓ ${result.message}</div>`;
        document.getElementById('bid-btn').textContent = 'Update Bid';
        document.getElementById('bid-panel-myBid').innerHTML = `<div class="alert alert-success">✓ You bid ${fmt(amount)} — you can lower it below.</div>`;
        loadOpenLoads();
        loadMyActiveBids();
    } catch (err) {
        alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    } finally {
        btn.disabled = false;
    }
}

// ── My Active Bids ────────────────────────────────────────────
async function loadMyActiveBids() {
    const container = document.getElementById('my-bids-list');
    if (!container) return;
    try {
        const bids = await getMyBids();

        myBidsMap = {};
        bids.filter(b => b.shipment_status === 'open')
            .forEach(b => { myBidsMap[b.shipment_id] = b.my_amount; });

        document.getElementById('stat-mybids').textContent = bids.length;

        if (!bids.length) {
            container.innerHTML = '<div class="empty-state" style="padding:20px 0;"><div class="icon">🎯</div><p style="font-size:0.85rem;">No bids placed yet.</p></div>';
            return;
        }

        const statusMap = {
            open:       { color: '#f59e0b', label: '⏳ Awaiting Award' },
            assigned:   { color: '#3b82f6', label: null },
            in_transit: { color: '#fb923c', label: null },
            delivered:  { color: '#22c55e', label: null },
        };

        container.innerHTML = bids.map(b => {
            let label, color;
            if (b.shipment_status === 'open') {
                label = '⏳ Awaiting Award'; color = '#f59e0b';
            } else if (b.was_abandoned) {
                label = '⚠️ Abandoned'; color = '#f59e0b';
            } else if (b.is_winner) {
                const lmap = { assigned: '🏆 You Won!', in_transit: '🚚 In Transit', delivered: '✅ Delivered' };
                label = lmap[b.shipment_status] || b.shipment_status; color = '#22c55e';
            } else {
                label = '❌ Not Selected'; color = '#6b7280';
            }

            const border = b.was_abandoned ? '#f59e0b'
                : b.is_winner ? 'var(--green)'
                : b.shipment_status === 'open' && b.is_lowest ? 'var(--green)'
                : 'var(--border)';

            return `<div style="padding:14px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;border-left:3px solid ${border};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                    <div style="font-weight:700;font-size:0.88rem;flex:1;margin-right:8px;">${b.pickup_address} → ${b.drop_address || 'N/A'}</div>
                    <span style="font-size:0.72rem;color:${color};font-family:var(--font-mono);white-space:nowrap;font-weight:600;">${label}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">${b.goods_desc} · ${b.weight_kg} kg · ${b.vehicle_type}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:0.68rem;color:var(--muted);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.05em;">Your Bid</div>
                        <div style="font-size:1.05rem;font-weight:700;color:var(--accent);">${fmt(b.my_amount)}</div>
                    </div>
                    ${b.shipment_status === 'open' ? `
                    <div style="text-align:right;">
                        <div style="font-size:0.68rem;color:var(--muted);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.05em;">${b.total_bids} bid${b.total_bids !== 1 ? 's' : ''}</div>
                        <div style="font-size:0.82rem;font-weight:600;color:${b.is_lowest ? 'var(--green)' : 'var(--muted)'};">${b.is_lowest ? "🏆 You're lowest!" : 'Lowest: ' + fmt(b.lowest_amount)}</div>
                    </div>` : b.winning_bid_amount ? `
                    <div style="text-align:right;">
                        <div style="font-size:0.68rem;color:var(--muted);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.05em;">Awarded At</div>
                        <div style="font-size:0.82rem;font-weight:600;">${fmt(b.winning_bid_amount)}</div>
                    </div>` : ''}
                </div>
                <div style="font-size:0.7rem;color:var(--muted);margin-top:8px;font-family:var(--font-mono);">Placed ${timeAgo(b.placed_at)}</div>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
}

// ── My Trips ──────────────────────────────────────────────────
async function loadMyTrips() {
    const container = document.getElementById('my-trips-list');
    try {
        const trips = await getMyShipments();
        const active    = trips.filter(t => ['assigned','in_transit'].includes(t.status)).length;
        const completed = trips.filter(t => t.status === 'delivered').length;

        document.getElementById('stat-active').textContent = active;
        document.getElementById('stat-done').textContent   = completed;

        if (!trips.length) {
            container.innerHTML = '<div class="empty-state"><div class="icon">🏁</div><p>No assigned trips yet.</p></div>';
            document.getElementById('trip-map').style.display = 'none';
            stopTracking();
            return;
        }

        const activeTrip = trips.find(t => t.status === 'in_transit');
        if (activeTrip) { plotTripOnMap(activeTrip); startTracking(activeTrip.id); }
        else {
            const assignedTrip = trips.find(t => t.status === 'assigned');
            if (assignedTrip) plotTripOnMap(assignedTrip);
            else document.getElementById('trip-map').style.display = 'none';
            stopTracking();
        }

        container.innerHTML = trips.map(t => {
            const dest = t.destinations && t.destinations.length > 0
                ? (t.destinations.length > 1 ? t.destinations.length + ' Stops' : t.destinations[0].address)
                : (t.drop_address || 'N/A');
            return `<div class="card my-trip-card fade-in" style="margin-bottom:12px;padding:16px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-weight:700">${t.pickup_address} → ${dest}</div>
                    ${statusBadge(t.status)}
                </div>
                <div class="meta-row" style="gap:16px;margin-bottom:0">
                    <div class="meta-item"><span class="meta-label">Goods</span><span class="meta-value" style="font-size:0.85rem">${t.goods_desc}</span></div>
                    ${t.winning_bid_amount ? `<div class="meta-item"><span class="meta-label">Earned</span><span class="meta-value green">${fmt(t.winning_bid_amount)}</span></div>` : ''}
                    ${t.est_time_hours ? `<div class="meta-item"><span class="meta-label">Approx Time</span><span class="meta-value">${t.est_time_hours}h</span></div>` : ''}
                    ${t.status === 'delivered' && t.started_at && t.delivered_at ? `<div class="meta-item"><span class="meta-label">Time Taken</span><span class="meta-value green">${calculateTimeTaken(t.started_at, t.delivered_at)}</span></div>` : ''}
                </div>
                ${renderTripButtons(t)}
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
}

function renderTripButtons(trip) {
    if (trip.status === 'assigned') {
        return `<div class="trip-status-btns"><button class="btn btn-primary btn-sm" onclick="doUpdateStatus('${trip.id}','in_transit')">🚚 Start Trip</button></div>`;
    }
    if (trip.status === 'in_transit') {
        let html = '<div style="margin-top:12px;font-weight:600;font-size:0.85rem;">Route Stops:</div><ul style="margin:8px 0;padding-left:20px;font-size:0.85rem;">';
        if (trip.destinations && trip.destinations.length > 0) {
            const sorted = [...trip.destinations].sort((a, b) => a.order_index - b.order_index);
            const nextIdx = sorted.findIndex(d => d.status !== 'delivered');
            sorted.forEach((d, i) => {
                const isDelivered = d.status === 'delivered';
                const isActive    = i === nextIdx;
                const isFuture    = !isDelivered && !isActive;
                let icon, label;
                if (isDelivered) {
                    icon = '✅'; label = '<span style="font-size:0.7rem;color:var(--muted);margin-left:6px;">Delivered</span>';
                } else if (isActive) {
                    if (!d.ack_status || d.ack_status === 'none') {
                        icon = '📍'; label = `<button class="btn btn-primary btn-sm" style="margin-left:8px;padding:2px 8px;font-size:0.7rem;" onclick="doSendArrival('${trip.id}','${d.id}')">I've Arrived</button>`;
                    } else if (d.ack_status === 'pending_approval') {
                        icon = '⏳'; label = '<span style="margin-left:8px;font-size:0.7rem;color:#f59e0b;font-family:var(--font-mono);">Waiting for shipper approval...</span>';
                    } else if (d.ack_status === 'approved') {
                        icon = '✔️'; label = `<button class="btn btn-outline btn-sm" style="margin-left:8px;padding:2px 8px;font-size:0.7rem;border-color:var(--green);color:var(--green);" onclick="doMarkDestDelivered('${trip.id}','${d.id}')">Mark Delivered</button>`;
                    }
                } else {
                    icon = '🔒'; label = `<span style="margin-left:8px;font-size:0.7rem;color:var(--muted);">Complete stop ${i} first</span>`;
                }
                html += `<li style="margin-bottom:8px;${isFuture ? 'opacity:0.45;' : ''}">${icon} <strong>Stop ${i+1}:</strong> ${d.address} ${label}</li>`;
            });
        } else {
            html += `<li>No multi-stop data — <button class="btn btn-outline btn-sm" onclick="doUpdateStatus('${trip.id}','delivered')">Mark Delivered</button></li>`;
        }
        html += '</ul>';
        const sorted = trip.destinations ? [...trip.destinations].sort((a,b) => a.order_index - b.order_index) : [];
        if (sorted.some(d => d.status === 'delivered') && sorted.some(d => d.status !== 'delivered')) {
            html += `<div class="trip-status-btns"><button class="btn btn-outline btn-sm" onclick="doEndTripEarly('${trip.id}')" style="color:red;border-color:red;">⚠️ End Trip Early (Abandon)</button></div>`;
        }
        return html;
    }
    return '';
}

async function doSendArrival(shipmentId, destId) {
    try { await sendArrivalAck(shipmentId, destId); await loadMyTrips(); }
    catch (err) { alert('Error: ' + err.message); }
}

async function doMarkDestDelivered(shipmentId, destId) {
    if (!confirm('Confirm: mark this stop as delivered?')) return;
    try { await updateDestinationStatus(shipmentId, destId, 'delivered'); await loadMyTrips(); }
    catch (err) { alert('Error: ' + err.message); }
}

async function doEndTripEarly(shipmentId) {
    if (!confirm('End trip early? You will be paid proportionally and remaining stops re-posted.')) return;
    try { await abandonShipment(shipmentId); await loadMyTrips(); await loadOpenLoads(); alert('Trip ended. You have been paid proportionally.'); }
    catch (err) { alert('Error: ' + err.message); }
}

async function doUpdateStatus(shipmentId, status) {
    if (!confirm(`Confirm: ${status === 'in_transit' ? 'start this trip' : 'mark as delivered'}?`)) return;
    try {
        await updateShipmentStatus(shipmentId, status);
        if (status === 'in_transit') startTracking(shipmentId); else stopTracking();
        await loadMyTrips();
    } catch (err) { alert('Error: ' + err.message); }
}

// ── GPS Tracking ──────────────────────────────────────────────
let trackingInterval = null;
let driverMap        = null;
let mapMarkers       = [];

function initDriverMap() {
    if (driverMap) return;
    document.getElementById('trip-map').style.display = 'block';
    driverMap = L.map('trip-map').setView([20.5937, 78.9629], 5); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(driverMap);
}

function plotTripOnMap(trip) {
    initDriverMap();
    mapMarkers.forEach(m => driverMap.removeLayer(m));
    mapMarkers = [];
    const points = [];
    if (trip.pickup_lat && trip.pickup_lng) {
        const p = [trip.pickup_lat, trip.pickup_lng];
        points.push(p);
        mapMarkers.push(L.marker(p).addTo(driverMap).bindPopup('Pickup: ' + trip.pickup_address));
    }
    (trip.destinations || []).forEach(d => {
        const p = [d.lat, d.lng];
        points.push(p);
        const icon = L.icon({
            iconUrl: d.status === 'delivered'
                ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
                : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25,41], iconAnchor: [12,41], popupAnchor: [1,-34], shadowSize: [41,41]
        });
        mapMarkers.push(L.marker(p, { icon }).addTo(driverMap).bindPopup('Drop: ' + d.address));
    });
    if (points.length) driverMap.fitBounds(L.latLngBounds(points), { padding: [30,30] });
}

function startTracking(shipmentId) {
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => sendDriverLocation(shipmentId, pos.coords.latitude, pos.coords.longitude).catch(e => console.error('Tracking error', e)),
                err => console.warn('Geolocation error', err)
            );
        }
    }, 15000);
}

function stopTracking() {
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
}

// ── My Rating ─────────────────────────────────────────────────
async function loadMyRating() {
    const box = document.getElementById('my-rating-box');
    if (!box) return;
    try {
        const p = await getMyDriverProfile();
        if (!p.avg_rating) {
            box.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:12px 0;">No ratings yet. Complete your first delivery to get rated.</div>';
            return;
        }
        const breakdownHtml = [5,4,3,2,1].map(star => {
            const count = p.breakdown[String(star)] || 0;
            const pct   = p.total_ratings > 0 ? Math.round((count / p.total_ratings) * 100) : 0;
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;font-size:0.8rem;">
                <span style="width:14px;text-align:right;color:var(--muted);">${star}</span>
                <span style="color:#f59e0b;font-size:0.7rem;">⭐</span>
                <div style="flex:1;background:var(--surface2);border-radius:3px;height:7px;overflow:hidden;">
                    <div style="width:${pct}%;background:#f59e0b;height:100%;border-radius:3px;"></div>
                </div>
                <span style="width:24px;color:var(--muted);font-family:var(--font-mono);font-size:0.7rem;">${count}</span>
            </div>`;
        }).join('');
        const recentHtml = p.history.slice(0, 5).map(r =>
            `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-weight:600;">${r.shipment_goods}</span>
                    <span style="color:#f59e0b;">${'⭐'.repeat(Math.round(r.score))} <strong>${r.score}</strong></span>
                </div>
                <div style="color:var(--muted);font-size:0.72rem;margin-top:2px;">By ${r.shipper_name} · ${timeAgo(r.created_at)}</div>
            </div>`
        ).join('');
        box.innerHTML = `
            <div style="display:flex;gap:20px;align-items:center;margin-bottom:16px;">
                <div style="text-align:center;">
                    <div style="font-size:2.4rem;font-weight:700;color:#f59e0b;line-height:1;">${p.avg_rating.toFixed(1)}</div>
                    <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">out of 5</div>
                </div>
                <div style="flex:1;">${breakdownHtml}</div>
                <div style="text-align:center;">
                    <div style="font-size:1.4rem;font-weight:700;">${p.total_ratings}</div>
                    <div style="font-size:0.72rem;color:var(--muted);">ratings</div>
                </div>
            </div>
            <div style="font-size:0.72rem;font-family:var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Recent Ratings</div>
            ${recentHtml}`;
    } catch (err) {
        box.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">Could not load ratings.</div>';
    }
}

// ── Init ──────────────────────────────────────────────────────
loadMyRating();
loadMyTrips();
loadMyActiveBids().then(() => loadOpenLoads());
setInterval(() => loadMyTrips(), 8000);
