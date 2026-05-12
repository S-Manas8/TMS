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
        if (activeTrip) { plotTripOnMap(activeTrip); startTracking(activeTrip.id); startProofRequestPolling(activeTrip.id); }
        else {
            const assignedTrip = trips.find(t => t.status === 'assigned');
            if (assignedTrip) plotTripOnMap(assignedTrip);
            else document.getElementById('trip-map').style.display = 'none';
            stopTracking();
            stopProofRequestPolling();
        }

        // Remember which photo sections are currently open so we can restore after re-render
        const openSections = new Set(
            [...document.querySelectorAll('[id^="photo-section-"]')]
                .filter(el => el.style.display !== 'none')
                .map(el => el.id)
        );

        // Fetch pending proof requests for in-transit trips so we can render inline
        const proofMap = {};
        for (const t of trips.filter(t => t.status === 'in_transit')) {
            try {
                const reqs = await getProofRequests(t.id);
                const pending = reqs.find(r => r.status === 'pending');
                proofMap[t.id] = pending ? pending.request_id : null;
            } catch (e) { proofMap[t.id] = null; }
        }

        // Fetch uploaded photos for in_transit and delivered trips
        const photosMap = {};
        for (const t of trips.filter(t => ['in_transit','delivered'].includes(t.status))) {
            try {
                photosMap[t.id] = await getShipmentPhotos(t.id);
            } catch (e) { photosMap[t.id] = []; }
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
                ${renderProofRequestInline(t, proofMap[t.id])}
                ${renderTripButtons(t)}
                ${renderDriverPhotoHistory(t, photosMap[t.id] || [])}
            </div>`;
        }).join('');

        // Restore open photo sections
        openSections.forEach(sectionId => {
            const body  = document.getElementById(sectionId);
            const arrow = document.getElementById(sectionId + '-arrow');
            if (body)  body.style.display  = 'block';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
}

// ── Inline proof request block inside trip card ───────────────
function renderProofRequestInline(trip, pendingRequestId) {
    if (trip.status !== 'in_transit') return '';
    if (!pendingRequestId) return '';

    return `
        <div style="margin-top:14px;padding:14px;background:rgba(245,158,11,0.1);
                    border:2px solid #f59e0b;border-radius:10px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <span style="font-size:1.3rem;">📸</span>
                <div>
                    <div style="font-weight:700;font-size:0.88rem;color:#f59e0b;">Shipper Requested Proof</div>
                    <div style="font-size:0.75rem;color:#94a3b8;margin-top:1px;">Take a photo of the goods and upload it now</div>
                </div>
            </div>
            <label style="display:flex;align-items:center;justify-content:center;gap:8px;
                           padding:10px;background:#f59e0b;color:#000;font-weight:700;
                           border-radius:8px;cursor:pointer;font-size:0.85rem;width:100%;box-sizing:border-box;">
                📷 Take / Upload Proof Photo
                <input type="file" accept="image/*" capture="environment" style="display:none"
                    onchange="doFulfillProofRequest('${trip.id}','${pendingRequestId}',this)">
            </label>
        </div>`;
}

// ── Photo history inside trip card (driver view) ──────────────
function renderDriverPhotoHistory(trip, photos) {
    if (!photos || photos.length === 0) return '';

    const sectionId = `photo-section-${trip.id}`;

    const rows = photos.map(p => {
        const isProof   = p.pod_type === 'proof_request';
        const isRejected = p.ack_status === 'rejected';
        const isApproved = p.ack_status === 'approved';

        const typeLabel = isProof
            ? '<span style="font-size:0.68rem;font-family:var(--font-mono);color:#f59e0b;background:rgba(245,158,11,0.15);padding:1px 6px;border-radius:4px;">🔔 Proof</span>'
            : '<span style="font-size:0.68rem;font-family:var(--font-mono);color:var(--green);background:rgba(34,197,94,0.12);padding:1px 6px;border-radius:4px;">✅ Delivery</span>';

        const ackBadge = isApproved
            ? '<span style="font-size:0.68rem;color:var(--green);font-family:var(--font-mono);margin-left:4px;">✅ Approved</span>'
            : isRejected
            ? '<span style="font-size:0.68rem;color:#ef4444;font-family:var(--font-mono);margin-left:4px;">❌ Rejected</span>'
            : '<span style="font-size:0.68rem;color:#f59e0b;font-family:var(--font-mono);margin-left:4px;">⏳ Pending</span>';

        const location = p.dest_address
            ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">📍 ${p.dest_address}</div>`
            : `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">On-demand proof</div>`;

        const dt      = new Date(p.uploaded_at);
        const dateStr = dt.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

        // Rejection notice + re-upload button
        const rejectionBlock = isRejected ? `
            <div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,0.1);
                        border:1px solid #ef4444;border-radius:6px;">
                <div style="font-size:0.72rem;color:#ef4444;font-weight:600;margin-bottom:4px;">
                    ❌ Shipper rejected this photo
                </div>
                ${p.ack_notes ? `<div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;">"${p.ack_notes}"</div>` : ''}
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
                               padding:5px 10px;background:#ef4444;color:#fff;border-radius:6px;
                               font-size:0.75rem;font-weight:600;">
                    📷 Re-upload Photo
                    <input type="file" accept="image/*" capture="environment" style="display:none"
                        onchange="doReuploadPhoto('${trip.id}','${p.dest_id || ''}','${p.pod_id}',this)">
                </label>
            </div>` : '';

        const borderColor = isApproved ? 'var(--green)' : isRejected ? '#ef4444' : 'var(--border)';

        return `
            <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;
                        border-bottom:1px solid var(--border);">
                <img src="${p.image_url}" alt="photo"
                     onclick="driverOpenPhoto('${p.image_url}','${(p.dest_address||'Proof Photo').replace(/'/g,"\\'")}','${p.uploaded_at}','${(p.shipper_name||'').replace(/'/g,"\\'")}')"
                     style="width:64px;height:64px;object-fit:cover;border-radius:6px;
                            cursor:pointer;flex-shrink:0;border:2px solid ${borderColor};">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                        ${typeLabel}${ackBadge}
                        <span style="font-size:0.7rem;color:var(--muted);margin-left:2px;">${dateStr} · ${timeStr}</span>
                    </div>
                    ${location}
                    <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">
                        👤 <strong style="color:var(--text);">${p.shipper_name || 'Unknown'}</strong>
                        ${p.shipper_phone ? `· ${p.shipper_phone}` : ''}
                    </div>
                    ${rejectionBlock}
                </div>
            </div>`;
    }).join('');

    return `
        <div style="margin-top:12px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
            <button onclick="togglePhotoSection('${sectionId}')"
                    style="width:100%;display:flex;justify-content:space-between;align-items:center;
                           padding:10px 14px;background:var(--surface2);border:none;cursor:pointer;
                           font-size:0.82rem;font-weight:600;color:var(--text);">
                <span>📷 Delivery Photos <span style="font-size:0.72rem;font-family:var(--font-mono);
                      color:var(--muted);font-weight:400;margin-left:4px;">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span>
                ${photos.some(p => p.ack_status === 'rejected') ? '<span style="font-size:0.7rem;color:#ef4444;margin-left:6px;">⚠ Action needed</span>' : ''}
                </span>
                <span id="${sectionId}-arrow" style="font-size:0.75rem;color:var(--muted);transition:transform 0.2s;">▼</span>
            </button>
            <div id="${sectionId}" style="display:none;padding:0 14px;">
                ${rows}
            </div>
        </div>`;
}

function togglePhotoSection(sectionId) {
    const body  = document.getElementById(sectionId);
    const arrow = document.getElementById(sectionId + '-arrow');
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ── Driver photo full-screen viewer ──────────────────────────
function driverOpenPhoto(url, label, uploadedAt, shipperName) {
    const existing = document.getElementById('driver-photo-modal');
    if (existing) existing.remove();

    const dt      = new Date(uploadedAt);
    const dateStr = dt.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
    const timeStr = dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

    const modal = document.createElement('div');
    modal.id = 'driver-photo-modal';
    modal.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.88);
        z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    modal.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
                    max-width:520px;width:100%;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.5);">
            <!-- Header -->
            <div style="padding:14px 18px;border-bottom:1px solid var(--border);
                        display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-weight:700;font-size:0.9rem;">📷 ${label}</div>
                    <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">
                        ${dateStr} at ${timeStr}
                        ${shipperName ? ` · Shipper: <strong>${shipperName}</strong>` : ''}
                    </div>
                </div>
                <button onclick="document.getElementById('driver-photo-modal').remove()"
                        style="background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <!-- Image -->
            <div style="background:#000;display:flex;align-items:center;justify-content:center;max-height:60vh;overflow:hidden;">
                <img src="${url}" alt="Photo"
                     style="max-width:100%;max-height:60vh;object-fit:contain;display:block;">
            </div>
            <!-- Footer -->
            <div style="padding:12px 18px;display:flex;justify-content:flex-end;gap:8px;">
                <a href="${url}" download target="_blank"
                   class="btn btn-outline btn-sm" style="font-size:0.78rem;">⬇ Download</a>
                <button onclick="document.getElementById('driver-photo-modal').remove()"
                        class="btn btn-outline btn-sm" style="font-size:0.78rem;">✕ Close</button>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
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
                        icon = '✔️';
                        label = `
                            <button class="btn btn-outline btn-sm" style="margin-left:8px;padding:2px 8px;font-size:0.7rem;border-color:var(--green);color:var(--green);" onclick="doMarkDestDelivered('${trip.id}','${d.id}')">Mark Delivered</button>
                            <label class="btn btn-outline btn-sm" style="margin-left:6px;padding:2px 8px;font-size:0.7rem;cursor:pointer;" title="Upload delivery photo">
                                📷 Photo
                                <input type="file" accept="image/*" capture="environment" style="display:none"
                                    onchange="doUploadDeliveryPhoto('${trip.id}','${d.id}',this)">
                            </label>`;
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

// Lightweight background refresh — only updates stats + proof banners,
// never rebuilds the trip cards HTML so photo sections stay open.
setInterval(refreshTripStats, 10000);

async function refreshTripStats() {
    try {
        const trips = await getMyShipments();
        const active    = trips.filter(t => ['assigned','in_transit'].includes(t.status)).length;
        const completed = trips.filter(t => t.status === 'delivered').length;
        document.getElementById('stat-active').textContent = active;
        document.getElementById('stat-done').textContent   = completed;

        // Check proof requests for in-transit trips without re-rendering
        for (const t of trips.filter(t => t.status === 'in_transit')) {
            try {
                const reqs    = await getProofRequests(t.id);
                const pending = reqs.find(r => r.status === 'pending');
                if (pending && pending.request_id !== activeProofRequestId) {
                    activeProofRequestId = pending.request_id;
                    showProofRequestBanner(t.id, pending.request_id);
                    const inlineEl = document.getElementById(`proof-inline-${t.id}`);
                    if (inlineEl) inlineEl.style.display = 'block';
                } else if (!pending) {
                    const banner = document.getElementById('proof-request-banner');
                    if (banner) banner.remove();
                    if (activeProofRequestId) activeProofRequestId = null;
                }
            } catch (e) { /* silent */ }

            // Check if any photos were rejected — auto-open photo section so driver sees it
            try {
                const photos   = await getShipmentPhotos(t.id);
                const rejected = photos.some(p => p.ack_status === 'rejected');
                if (rejected) {
                    const sectionId = `photo-section-${t.id}`;
                    const body      = document.getElementById(sectionId);
                    const arrow     = document.getElementById(sectionId + '-arrow');
                    if (body && body.style.display === 'none') {
                        body.style.display    = 'block';
                        if (arrow) arrow.style.transform = 'rotate(180deg)';
                        showToast('⚠️ Shipper rejected a photo — please re-upload', 'error');
                    }
                }
            } catch (e) { /* silent */ }
        }
    } catch (e) { /* silent */ }
}

// ── Delivery Photo Upload ─────────────────────────────────────
async function doUploadDeliveryPhoto(shipmentId, destId, inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    inputEl.value = '';
    showPhotoPreviewModal({
        file,
        title: '📷 Delivery Photo Preview',
        subtitle: 'Review the photo before uploading as proof of delivery',
        confirmLabel: '✅ Upload as Delivery Proof',
        onConfirm: async () => {
            try {
                await uploadDeliveryPhoto(shipmentId, destId, file);
                showToast('📷 Delivery photo uploaded!', 'success');
            } catch (err) {
                showToast('Upload failed: ' + err.message, 'error');
            }
        }
    });
}

// ── Re-upload after shipper rejection ────────────────────────
async function doReuploadPhoto(shipmentId, destId, oldPodId, inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    inputEl.value = '';
    showPhotoPreviewModal({
        file,
        title: '📷 Re-upload Photo',
        subtitle: 'Shipper rejected the previous photo — review before sending',
        confirmLabel: '📤 Send New Photo',
        onConfirm: async () => {
            try {
                // Use "none" as destId when photo is not tied to a specific stop
                const effectiveDestId = destId || 'none';
                await uploadDeliveryPhoto(shipmentId, effectiveDestId, file, 'Re-uploaded after shipper rejection');
                showToast('📷 New photo sent to shipper!', 'success');
                await loadMyTrips();
            } catch (err) {
                showToast('Upload failed: ' + err.message, 'error');
            }
        }
    });
}

// ── Proof Request Polling ─────────────────────────────────────
// Check every 12 seconds if shipper has raised a proof request
let proofPollInterval = null;
let activeProofRequestId = null;

function startProofRequestPolling(shipmentId) {
    if (proofPollInterval) clearInterval(proofPollInterval);
    proofPollInterval = setInterval(() => checkProofRequests(shipmentId), 12000);
}

function stopProofRequestPolling() {
    if (proofPollInterval) clearInterval(proofPollInterval);
    proofPollInterval = null;
    activeProofRequestId = null;
}

async function checkProofRequests(shipmentId) {
    try {
        const requests = await getProofRequests(shipmentId);
        const pending  = requests.find(r => r.status === 'pending');
        if (pending && pending.request_id !== activeProofRequestId) {
            activeProofRequestId = pending.request_id;
            showProofRequestBanner(shipmentId, pending.request_id);
        } else if (!pending) {
            // Remove banner if no pending request
            const banner = document.getElementById('proof-request-banner');
            if (banner) banner.remove();
            activeProofRequestId = null;
        }
    } catch (e) { /* silent */ }
}

function showProofRequestBanner(shipmentId, requestId) {
    // Remove existing banner
    const existing = document.getElementById('proof-request-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'proof-request-banner';
    banner.style.cssText = `
        position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
        background: #1e293b; border: 2px solid #f59e0b; border-radius: 12px;
        padding: 18px 24px; z-index: 999; max-width: 420px; width: 90%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;
    banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <span style="font-size:1.5rem;">📸</span>
            <div>
                <div style="font-weight:700;font-size:0.95rem;color:#f59e0b;">Shipper Requested Proof</div>
                <div style="font-size:0.78rem;color:#94a3b8;margin-top:2px;">Please take a photo of the goods now</div>
            </div>
        </div>
        <label style="display:block;width:100%;text-align:center;padding:10px;background:#f59e0b;
                       color:#000;font-weight:700;border-radius:8px;cursor:pointer;font-size:0.9rem;">
            📷 Take / Upload Photo
            <input type="file" accept="image/*" capture="environment" style="display:none"
                onchange="doFulfillProofRequest('${shipmentId}','${requestId}',this)">
        </label>
        <button onclick="document.getElementById('proof-request-banner').remove()"
                style="margin-top:8px;width:100%;background:none;border:1px solid #334155;
                       color:#94a3b8;border-radius:8px;padding:6px;cursor:pointer;font-size:0.8rem;">
            Dismiss (respond later)
        </button>
    `;
    document.body.appendChild(banner);
}

async function doFulfillProofRequest(shipmentId, requestId, inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    inputEl.value = '';
    showPhotoPreviewModal({
        file,
        title: '📸 Proof Photo Preview',
        subtitle: 'Shipper requested this — review before sending',
        confirmLabel: '📤 Send to Shipper',
        onConfirm: async () => {
            try {
                await fulfillProofRequest(shipmentId, requestId, file);
                const banner = document.getElementById('proof-request-banner');
                if (banner) banner.remove();
                activeProofRequestId = null;
                showToast('✅ Proof photo sent to shipper!', 'success');
                await loadMyTrips();
            } catch (err) {
                showToast('Upload failed: ' + err.message, 'error');
            }
        }
    });
}

// ── Photo Preview Modal ───────────────────────────────────────
// Shows a preview of the selected image before uploading.
// Options: { file, title, subtitle, confirmLabel, onConfirm }
function showPhotoPreviewModal({ file, title, subtitle, confirmLabel, onConfirm }) {
    const existing = document.getElementById('photo-preview-modal');
    if (existing) existing.remove();

    const objectUrl = URL.createObjectURL(file);
    const sizeMB    = (file.size / (1024 * 1024)).toFixed(2);

    const modal = document.createElement('div');
    modal.id = 'photo-preview-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.82);
        z-index: 2000; display: flex; align-items: center;
        justify-content: center; padding: 20px;
    `;

    modal.innerHTML = `
        <div style="background: var(--surface); border: 1px solid var(--border);
                    border-radius: 14px; max-width: 480px; width: 100%;
                    overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.5);">

            <!-- Header -->
            <div style="padding: 16px 20px; border-bottom: 1px solid var(--border);
                        display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 700; font-size: 0.95rem;">${title}</div>
                    <div style="font-size: 0.75rem; color: var(--muted); margin-top: 2px;">${subtitle}</div>
                </div>
                <button id="ppm-close" style="background:none;border:none;color:var(--muted);
                        font-size:1.3rem;cursor:pointer;padding:4px 8px;line-height:1;">✕</button>
            </div>

            <!-- Image preview -->
            <div style="background: #000; position: relative; max-height: 55vh; overflow: hidden;
                        display: flex; align-items: center; justify-content: center;">
                <img id="ppm-img" src="${objectUrl}" alt="Preview"
                     style="max-width: 100%; max-height: 55vh; object-fit: contain; display: block;">
            </div>

            <!-- File info -->
            <div style="padding: 10px 20px; background: var(--surface2);
                        display: flex; gap: 16px; font-size: 0.78rem; color: var(--muted);
                        border-bottom: 1px solid var(--border);">
                <span>📄 ${file.name}</span>
                <span>📦 ${sizeMB} MB</span>
                <span>🖼 ${file.type.split('/')[1].toUpperCase()}</span>
            </div>

            <!-- Re-select option -->
            <div style="padding: 10px 20px; border-bottom: 1px solid var(--border);">
                <label style="display: inline-flex; align-items: center; gap: 6px;
                               font-size: 0.8rem; color: var(--muted); cursor: pointer;">
                    <input type="file" id="ppm-reselect" accept="image/*" capture="environment"
                           style="display:none">
                    🔄 Choose a different photo
                </label>
            </div>

            <!-- Actions -->
            <div style="padding: 16px 20px; display: flex; gap: 10px;">
                <button id="ppm-cancel" class="btn btn-outline" style="flex: 1;">
                    ✕ Cancel
                </button>
                <button id="ppm-confirm" class="btn btn-primary" style="flex: 2; font-weight: 700;">
                    ${confirmLabel}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close / cancel
    const closeModal = () => {
        URL.revokeObjectURL(objectUrl);
        modal.remove();
    };
    document.getElementById('ppm-close').onclick   = closeModal;
    document.getElementById('ppm-cancel').onclick  = closeModal;
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // Re-select a different photo
    document.getElementById('ppm-reselect').addEventListener('change', function () {
        const newFile = this.files[0];
        if (!newFile) return;
        URL.revokeObjectURL(objectUrl);
        modal.remove();
        // Re-open preview with the new file, same callbacks
        showPhotoPreviewModal({ file: newFile, title, subtitle, confirmLabel, onConfirm });
    });

    // Confirm upload
    const confirmBtn = document.getElementById('ppm-confirm');
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Uploading...';
        await onConfirm();
        closeModal();
    };
}

// ── Toast helper ──────────────────────────────────────────────
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: ${type === 'success' ? '#22c55e' : '#ef4444'};
        color: #fff; padding: 12px 24px; border-radius: 8px; font-weight: 600;
        font-size: 0.88rem; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        animation: fadeInUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}
