// ==========================================
// ADMIN HQ: CORE LOGIC
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Verify Authorization immediately (double lock)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = "admin-login.html";
        return;
    }

    const { data: dbData } = await supabase.from('users').select('role').eq('id', user.id).single();
    const allowedAdminRoles = ['admin'];
    if (!dbData || !allowedAdminRoles.includes(dbData.role)) {
        window.location.href = "admin-login.html";
        return;
    }

    // Store admin role for permission checks
    window.adminRole = dbData.role;

    // Clearance verified. Load the first tab.
    loadOverviewStats();
});

function adminLogout() {
    supabase.auth.signOut().then(() => {
        window.location.href = "admin-login.html";
    });
}

function switchTab(tabId) {
    // Update Nav UI
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    event.currentTarget.classList.add('active');

    // Update Panes
    document.querySelectorAll('.dashboard-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');

    // Load Data
    switch(tabId) {
        case 'overview':
            loadOverviewStats();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'scheduled':
            loadScheduledOrdersAdmin();
            break;
        case 'manual':
            loadManualFunding();
            break;
        case 'support':
            loadSupportTickets();
            break;
        case 'users':
            loadUsers();
            break;
        case 'pricing':
            loadPricingConfig();
            break;
        case 'afa':
            loadAfa();
            break;
        case 'profit':
            loadProfitReport();
            break;

        case 'stores':
            loadStoresAdmin();
            break;
        case 'apikey':
            loadApiKeysPage();
            break;
    }
}

function hardRefresh() {
    // Determine active tab and force a refresh of the DB queries
    if(document.getElementById('tab-overview').classList.contains('active')) return loadOverviewStats();
    if(document.getElementById('tab-orders').classList.contains('active')) return loadOrders();
    if(document.getElementById('tab-scheduled').classList.contains('active')) return loadScheduledOrdersAdmin();
    if(document.getElementById('tab-manual').classList.contains('active')) return loadManualFunding();
    if(document.getElementById('tab-support').classList.contains('active')) return loadSupportTickets();
    if(document.getElementById('tab-users').classList.contains('active')) return loadUsers();

    if(document.getElementById('tab-stores').classList.contains('active')) return loadStoresAdmin();
}

// ==========================================
// TAB 0: OVERVIEW ANALYTICS
// ==========================================
async function loadOverviewStats() {
    try {
        // 1. Fetch all overview data in a single RPC call
        const { data: stats, error: statsErr } = await supabase.rpc('get_admin_dashboard_stats');
        
        if (statsErr) {
            console.error("Overview stats fetch failed:", statsErr);
        } else if (stats) {
            document.getElementById("metric-real-users").innerText = stats.user_count || 0;
            document.getElementById("metric-orders").innerText = stats.today_orders || 0;
            
            const salesVal = parseFloat(stats.today_revenue || 0);
            document.getElementById("metric-sales").innerText = "₵" + salesVal.toFixed(2);

            // Matrix Counts
            const sc = stats.status_counts || {};
            const totalPending = (sc.pending || 0) + (sc.waiting || 0);
            const totalCompleted = (sc.completed || 0) + (sc.received || 0);
            const totalProcessing = (sc.processing || 0) + (sc.transit || 0);

            document.getElementById("overview-count-all").innerText = (sc.pending || 0) + (sc.completed || 0) + (sc.processing || 0) + (sc.transit || 0) + (sc.received || 0) + (sc.refunded || 0) + (sc.failed || 0) + (sc.cancelled || 0) + (sc.waiting || 0) || 0;
            document.getElementById("overview-count-pending").innerText = totalPending;
            document.getElementById("overview-count-completed").innerText = totalCompleted;
            document.getElementById("overview-count-processing").innerText = totalProcessing;
            document.getElementById("overview-count-refunded").innerText = sc.refunded || 0;
        }

        // 2. Global SMS Balance
        fetchAdminSmsBalance();

        // 3. Comprehensive Totals (Revenue, Profit, Liability)
        fetchComprehensiveTotals();

        // 7. Recent Registrations Table Mini-view
        const tbody = document.getElementById("overviewRecentUsersBody");
        tbody.innerHTML = `<tr><td colspan="4" class="state-msg">Fetching newest users...</td></tr>`;

        const { data: recentUsers } = await supabase
            .from('users')
            .select('first_name, last_name, email, phone, created_at')
            .not('role', 'eq', 'admin')
            .order('created_at', { ascending: false })
            .limit(5);

        if(!recentUsers || recentUsers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="state-msg">No recent registrations found.</td></tr>`;
            return;
        }

        let html = '';
        recentUsers.forEach(u => {
            const d = new Date(u.created_at).toLocaleDateString();
            html += `
                <tr>
                    <td><strong>${u.first_name || ''} ${u.last_name || ''}</strong></td>
                    <td>${u.email}</td>
                    <td>${u.phone || 'N/A'}</td>
                    <td style="font-size:12px; color:#64748b;">${d}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
        
    } catch (err) {
        console.error("Overview Stats Error:", err);
    }
}

async function fetchComprehensiveTotals() {
    try {
        const { data: metrics, error: metricsErr } = await supabase.rpc('get_financial_metrics');
        
        if (metricsErr) {
            console.error("Financial metrics fetch failed:", metricsErr);
            return;
        }

        if (metrics) {
            const liability = parseFloat(metrics.total_liability || 0);
            const revenue = parseFloat(metrics.total_revenue || 0);
            const profit = parseFloat(metrics.total_profit || 0);

            document.getElementById('metric-user-balances').innerText = "₵" + liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('metric-revenue-total').innerText = "₵" + revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('metric-profit-total').innerText = "₵" + profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            // Update Lifetime Profit in the Margin Report section as well
            const reportLifetimeElem = document.getElementById('lifetimeProfitCounterReport');
            if (reportLifetimeElem) {
                reportLifetimeElem.innerText = "₵" + profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }

    } catch (err) {
        console.error("Error fetching comprehensive totals:", err);
        document.getElementById('metric-user-balances').innerText = "Error";
        document.getElementById('metric-revenue-total').innerText = "Error";
        document.getElementById('metric-profit-total').innerText = "Error";
    }
}

async function fetchAdminSmsBalance() {
    const balanceElem = document.getElementById('metric-sms-balance');
    if (!balanceElem) return;
    
    balanceElem.innerText = "...";
    try {
        const { data, error } = await supabase.functions.invoke('check-sms-balance');
        
        if (error) {
            console.error("SMS Edge Function Invoke Error:", error);
            balanceElem.innerText = "Invoke Error";
            balanceElem.style.color = "#dc2626";
            return;
        }

        if (!data.success) {
            console.error("SMS Balance Fetch Failed:", data.error);
            balanceElem.innerText = "Fetch Error";
            balanceElem.style.color = "#dc2626";
            return;
        }
        
        let responseString = data.balance_response || "";
        console.log("SMS Balance received:", responseString);
        
        let balanceValue = "N/A";

        // BulkSMSGh typically returns balance as "1000|Success"
        if(responseString.includes("|")) {
            balanceValue = responseString.split("|")[0];
        } else if (responseString) {
            balanceValue = responseString;
        }

        balanceElem.innerText = balanceValue;

        // UI Feedback for low balance
        const numericBalance = parseFloat(balanceValue);
        if (!isNaN(numericBalance)) {
            if (numericBalance < 50) {
                balanceElem.style.color = "#dc2626"; // Red for low
                balanceElem.title = "Low SMS Balance! Please top up.";
            } else {
                balanceElem.style.color = "#059669"; // Green for okay
                balanceElem.title = "SMS Balance OK";
            }
        } else {
            balanceElem.style.color = "#0f172a"; // Default
        }

    } catch (err) {
        console.error("Critical Balance Check Error:", err);
        balanceElem.innerText = "Crit Error";
        balanceElem.style.color = "#dc2626";
    }
}

// ==========================================
// TAB 1: ADVANCED DATA ORDERS
// ==========================================
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const ROWS_PER_PAGE = 50;

async function loadOrders() {
    const tbody = document.getElementById("ordersTableBody");
    tbody.innerHTML = `<tr><td colspan="7" class="state-msg">Fetching complete network orders matrix...</td></tr>`;

    // Fetch up to 5000 orders to allow local filtering
    const { data, error } = await supabase
        .from('orders')
        .select('*, users(email)')
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-msg" style="color:red!important;">Error: ${error.message}</td></tr>`;
        return;
    }

    allOrders = data || [];
    updateOrderStatusCounts();
    applyOrderFilters(); // Initial render
}

function updateOrderStatusCounts() {
    const counts = {
        all: allOrders.length,
        pending: 0,
        completed: 0,
        processing: 0,
        transit: 0,
        received: 0,
        undelivered: 0,
        refunded: 0,
        failed: 0,
        cancelled: 0,
        waiting: 0
    };

    allOrders.forEach(o => {
        const s = String(o.status || '').toLowerCase();
        if (s === 'false' || s === 'pending') counts.pending++;
        else if (s === 'true' || s === 'completed') counts.completed++;
        else if (s === 'processing') counts.processing++;
        else if (s.includes('transit')) counts.transit++;
        else if (s.includes('received')) counts.received++;
        else if (s === 'undelivered') counts.undelivered++;
        else if (s === 'refunded' || s === 'refund') counts.refunded++;
        else if (s === 'failed') counts.failed++;
        else if (s === 'cancelled' || s === 'cancel') counts.cancelled++;
        else if (s === 'waiting') counts.waiting++;
    });

    document.getElementById("count_all").innerText = counts.all;
    document.getElementById("count_pending").innerText = counts.pending;
    document.getElementById("count_completed").innerText = counts.completed;
    document.getElementById("count_processing").innerText = counts.processing;
    if (document.getElementById("count_transit")) document.getElementById("count_transit").innerText = counts.transit;
    if (document.getElementById("count_received")) document.getElementById("count_received").innerText = counts.received;
    if (document.getElementById("count_undelivered")) document.getElementById("count_undelivered").innerText = counts.undelivered;
    document.getElementById("count_refunded").innerText = counts.refunded;
    if (document.getElementById("count_failed")) document.getElementById("count_failed").innerText = counts.failed;
    if (document.getElementById("count_cancelled")) document.getElementById("count_cancelled").innerText = counts.cancelled;
    if (document.getElementById("count_waiting")) document.getElementById("count_waiting").innerText = counts.waiting;
}

function quickFilterStatus(status) {
    document.getElementById("filterStatus").value = status;
    applyOrderFilters();
}

function applyOrderFilters() {
    const phone = document.getElementById("filterPhone").value.toLowerCase();
    const refSearch = document.getElementById("filterRef")?.value.toLowerCase() || "";
    const sDateFrom = document.getElementById("filterDateFrom").value;
    const sDateTo = document.getElementById("filterDateTo").value;
    const status = document.getElementById("filterStatus").value;
    const product = document.getElementById("filterProduct").value;

    filteredOrders = allOrders.filter(o => {
        let match = true;
        
        if (phone && !o.phone.includes(phone)) match = false;
        
        if (refSearch) {
            const fRef = getFriendlyRef(o).toLowerCase();
            const aRef = (o.api_reference || "").toLowerCase();
            const uuidMatch = o.id.toLowerCase().includes(refSearch);
            if (!fRef.includes(refSearch) && !aRef.includes(refSearch) && !uuidMatch) match = false;
        }

        if (status) {
            const orderStatus = String(o.status || '').toLowerCase();
            const filterStatus = status.toLowerCase();
            
            if (filterStatus === 'false') {
                if (orderStatus !== 'false' && orderStatus !== 'pending') match = false;
            } else if (filterStatus === 'true') {
                if (orderStatus !== 'true' && orderStatus !== 'completed') match = false;
            } else if (orderStatus !== filterStatus) {
                match = false;
            }
        }
    
        // 3. Product match
        if(product !== "" && o.network !== product) match = false;

        // 4. Date Range
        if(match && (sDateFrom || sDateTo)) {
            const orderDate = new Date(o.created_at);
            if(sDateFrom) {
                const fromD = new Date(sDateFrom);
                fromD.setHours(0,0,0,0);
                if(orderDate < fromD) match = false;
            }
            if(sDateTo) {
                const toD = new Date(sDateTo);
                toD.setHours(23,59,59,999);
                if(orderDate > toD) match = false;
            }
        }
        return match;
    });

    document.getElementById("totalResultsCounter").innerText = filteredOrders.length;
    currentPage = 1;
    renderOrdersPage(1);
}

function renderOrdersPage(page) {
    currentPage = page;
    const tbody = document.getElementById("ordersTableBody");
    
    if (filteredOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-msg">Zero orders match these advanced filters.</td></tr>`;
        document.getElementById("orderPagination").innerHTML = "";
        return;
    }

    // Uncheck master toggle
    document.getElementById("selectAllOrders").checked = false;
    document.getElementById("selectCounter").innerText = "0";

    const startIndex = (page - 1) * ROWS_PER_PAGE;
    const endIndex = startIndex + ROWS_PER_PAGE;
    const pageData = filteredOrders.slice(startIndex, endIndex);

    let html = '';
    const fullAsc = [...allOrders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    pageData.forEach(o => {
        const d = new Date(o.created_at).toLocaleString();
        const statLabel = getStatusBadge(o.status);
        const userEmail = o.users?.email || 'Unknown';
        const sequenceNum = fullAsc.findIndex(item => item.id === o.id) + 1;
        const orderRef = getFriendlyRef(o, sequenceNum);
        
        const storeBadge = o.is_store_order ? `<span class="type-pill" style="background:#e0f2fe; color:#0369a1; font-size:9px; margin-bottom:4px;">SHOP</span>` : '';
        
        html += `
            <tr data-id="${o.id}">
                <td><input type="checkbox" class="order-checkbox" value="${o.id}" data-phone="${o.phone}" data-vol="${o.plan}" onclick="updateSelectCount()"></td>
                <td style="font-weight:600; color:#475569;">${orderRef}</td>
                <td>
                    ${storeBadge}
                    <div style="font-size:11px; color:#64748b;">User: ${userEmail}</div>
                    <div style="font-weight:700; color:#0f172a;">Rec: ${o.phone}</div>
                </td>
                <td>
                    <div style="font-size:11px; font-weight:700; color:#4f46e5;">${o.network}</div>
                    <div style="font-weight:600;">${(o.plan || o.bundle || '-').toString().includes('GB') ? (o.plan || o.bundle) : (o.plan || o.bundle) + ' GB'}</div>
                </td>
                <td><strong>₵${parseFloat(o.amount||0).toFixed(2)}</strong></td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${statLabel}
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <button onclick="selectRange('${o.id}', 'above')" title="Select all above" style="border:none; background:none; cursor:pointer; padding:0; color:#94a3b8; font-size:10px; line-height:1;">▲</button>
                            <button onclick="selectRange('${o.id}', 'below')" title="Select all below" style="border:none; background:none; cursor:pointer; padding:0; color:#94a3b8; font-size:10px; line-height:1;">▼</button>
                        </div>
                    </div>
                </td>
                <td style="font-size:12px; color:#64748b;">${d}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    // Build Pagination
    const totalPages = Math.ceil(filteredOrders.length / ROWS_PER_PAGE);
    let pagHtml = '';
    for(let i=1; i<=totalPages; i++) {
        pagHtml += `<button class="refresh-btn" style="${i===page ? 'background:#3b82f6; color:white; border-color:#3b82f6;' : ''}" onclick="renderOrdersPage(${i})">${i}</button>`;
    }
    document.getElementById("orderPagination").innerHTML = pagHtml;
}

function toggleAllOrders(source) {
    const checkboxes = document.querySelectorAll('.order-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
    updateSelectCount();
}

function updateSelectCount() {
    const checkedLength = document.querySelectorAll('.order-checkbox:checked').length;
    document.getElementById("selectCounter").innerText = checkedLength;
}

function selectAllForNumber() {
    const phone = document.getElementById("filterPhone").value.trim();
    if (!phone) return alert("Please enter a phone number in the search filter first.");
    
    const checkboxes = document.querySelectorAll('.order-checkbox');
    let count = 0;
    checkboxes.forEach(cb => {
        if (cb.getAttribute('data-phone').includes(phone)) {
            cb.checked = true;
            count++;
        }
    });
    updateSelectCount();
    if (count === 0) alert("No rows found matching that phone number in the current view.");
}

function selectSameStatus() {
    const phone = document.getElementById("filterPhone").value.trim();
    if (!phone) return alert("Please enter a phone number in the search filter to identify the target status.");
    
    // Find the status of the first order matching this phone
    const targetOrder = filteredOrders.find(o => o.phone.includes(phone));
    if (!targetOrder) return alert("No order found for this number to determine status.");
    
    const targetStatus = String(targetOrder.status);
    const checkboxes = document.querySelectorAll('.order-checkbox');
    let count = 0;
    
    checkboxes.forEach(cb => {
        const order = filteredOrders.find(o => o.id === cb.value);
        if (order && String(order.status) === targetStatus) {
            cb.checked = true;
            count++;
        }
    });
    updateSelectCount();
    alert(`Selected ${count} orders with status: ${targetStatus.toUpperCase()}`);
}

function selectRange(targetId, direction) {
    const checkboxes = Array.from(document.querySelectorAll('.order-checkbox'));
    const targetIndex = checkboxes.findIndex(cb => cb.value === targetId);
    
    if (targetIndex === -1) return;

    if (direction === 'above') {
        for (let i = 0; i <= targetIndex; i++) {
            checkboxes[i].checked = true;
        }
    } else {
        for (let i = targetIndex; i < checkboxes.length; i++) {
            checkboxes[i].checked = true;
        }
    }
    updateSelectCount();
}

function autoSelectRows() {
    const count = parseInt(document.getElementById("autoSelectCount").value) || 0;
    const checkboxes = document.querySelectorAll('.order-checkbox');
    
    checkboxes.forEach(cb => cb.checked = false); // clear first
    
    let selected = 0;
    for(let i=0; i<checkboxes.length; i++) {
        if(selected >= count) break;
        checkboxes[i].checked = true;
        selected++;
    }
    updateSelectCount();
}

async function applyMassStatusUpdateOrders() {
    const status = document.getElementById('massStatusUpdateSelect').value;
    if (!status) return alert("Select a status to apply.");
    
    const checked = document.querySelectorAll('.order-checkbox:checked');
    if (checked.length === 0) return alert("Select at least one order to update.");

    if (!confirm(`Update ${checked.length} orders to status: ${status.toUpperCase()}?`)) return;

    let idsToUpdate = [];
    checked.forEach(cb => idsToUpdate.push(cb.value));

    try {
        if (status === 'Refund') {
            // Handle massive refunding
            let processed = 0;
            for (const id of idsToUpdate) {
                const { data: order } = await supabase.from('orders').select('*').eq('id', id).single();
                if (order && order.status !== 'Refunded') {
                    // Refund to user
                    const { data: user } = await supabase.from('users').select('wallet_balance').eq('id', order.user_id).single();
                    if (user) {
                        const newBal = parseFloat(user.wallet_balance || 0) + parseFloat(order.amount || 0);
                        await supabase.from('users').update({ wallet_balance: newBal }).eq('id', order.user_id);
                        await supabase.from('orders').update({ status: 'Refunded' }).eq('id', id);
                        processed++;
                    }
                }
            }
            alert(`✅ Successfully refunded ${processed} orders to user wallets.`);
        } else {
            const { error } = await supabase.from('orders').update({ status }).in('id', idsToUpdate);
            if (error) throw error;
            alert(`✅ Successfully updated ${checked.length} orders to ${status.toUpperCase()}.`);
        }
        loadOrders();
    } catch (e) {
        alert("Update Error: " + e.message);
    }
}

async function massUpdateSelected() {
    // Keep legacy helper but point to new logic if desired or keep simple
    const checked = document.querySelectorAll('.order-checkbox:checked');
    if(checked.length === 0) return alert("Select at least one order to fulfill.");
    
    if(!confirm(`Are you sure you want to MASS FULFILL ${checked.length} orders? Triggers SMS to all.`)) return;

    let idsToUpdate = [];
    checked.forEach(cb => idsToUpdate.push(cb.value));

    const { error } = await supabase.from('orders').update({ status: 'true' }).in('id', idsToUpdate);
    if(error) alert("Error: " + error.message);
    else { alert("Success!"); loadOrders(); }
}

function exportSelectedToExcel() {
    const checked = document.querySelectorAll('.order-checkbox:checked');
    if(checked.length === 0) return alert("Select at least one order to export.");

    let csvContent = "Recipient Number,Data Volume (Raw)\n";

    checked.forEach(cb => {
        const phone = cb.getAttribute('data-phone');
        const rawVol = cb.getAttribute('data-vol');
        
        // Strip text: "10GB" -> "10", "1.5 GB" -> "1.5"
        const cleanVol = rawVol.replace(/[^0-9.]/g, '');
        
        csvContent += `${phone},${cleanVol}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Data4Ghana_Orders_Export_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// ==========================================
// TAB 1.5: SCHEDULED ORDERS ADMIN
// ==========================================
let allSchedAdmin = [];
let filteredSchedAdmin = [];

async function loadScheduledOrdersAdmin() {
    const tbody = document.getElementById("scheduledTableBody");
    tbody.innerHTML = `<tr><td colspan="7" class="state-msg">Fetching scheduled orders queue...</td></tr>`;

    const { data, error } = await supabase
        .from('scheduled_orders')
        .select('*, users(email)')
        // Removed status check to allow viewing all (Refunded, Processing, etc.)
        .order('scheduled_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-msg" style="color:red!important;">Error: ${error.message}</td></tr>`;
        return;
    }

    allSchedAdmin = data || [];
    applyScheduledFiltersAdmin();
}

function applyScheduledFiltersAdmin() {
    const phone = document.getElementById("schedFilterPhone").value.toLowerCase();
    const refSearch = document.getElementById("schedFilterRef")?.value.toLowerCase() || "";
    const network = document.getElementById("schedFilterNetwork").value;
    const status = document.getElementById("schedFilterStatus")?.value || "";

    filteredSchedAdmin = allSchedAdmin.filter(o => {
        let match = true;
        if (phone && !o.phone.includes(phone)) match = false;
        
        if (refSearch) {
            const fRef = getFriendlyRef(o).toLowerCase();
            const aRef = (o.api_reference || "").toLowerCase();
            if (!fRef.includes(refSearch) && !aRef.includes(refSearch)) match = false;
        }

        if (network && o.network !== network) match = false;
        if (status && String(o.status) !== status) match = false;
        return match;
    });

    document.getElementById("schedTotalCounter").innerText = filteredSchedAdmin.length;
    renderScheduledOrdersAdmin();
}

function renderScheduledOrdersAdmin() {
    const tbody = document.getElementById("scheduledTableBody");

    if (filteredSchedAdmin.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-msg">Zero scheduled orders found in the queue.</td></tr>`;
        return;
    }

    // Reset master checkbox
    document.getElementById("selectAllScheduled").checked = false;
    document.getElementById("schedSelectCounter").innerText = "0";

    let html = '';
    const fullAsc = [...allSchedAdmin].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    filteredSchedAdmin.forEach(o => {
        const d = new Date(o.scheduled_at).toLocaleString();
        const userEmail = o.users?.email || 'Unknown';
        const sequenceNum = fullAsc.findIndex(item => item.id === o.id) + 1;
        const orderRef = getFriendlyRef(o, sequenceNum);
        const statLabel = getStatusBadge(o.status);
        
        html += `
            <tr data-id="${o.id}">
                <td><input type="checkbox" class="sched-checkbox" value="${o.id}" onclick="updateSchedSelectCount()"></td>
                <td style="font-weight:600; color:#475569;">${orderRef}</td>
                <td>
                    <div style="font-size:11px; color:#64748b;">User: ${userEmail}</div>
                    <div style="font-weight:700; color:#0f172a;">Rec: ${o.phone}</div>
                </td>
                <td>
                    <div style="font-size:11px; font-weight:700; color:#4f46e5;">${o.network}</div>
                    <div style="font-weight:600;">${(o.plan || o.bundle || '-').toString().includes('GB') ? (o.plan || o.bundle) : (o.plan || o.bundle) + ' GB'}</div>
                </td>
                <td><strong>₵${parseFloat(o.amount||0).toFixed(2)}</strong></td>
                <td>${statLabel}</td>
                <td>
                    <button class="action-btn btn-approve" onclick="processScheduledSingleAdmin('${o.id}')" style="margin-bottom:4px; padding:6px; font-size:11px;">▶ Process</button>
                    <button class="action-btn btn-reject" onclick="deleteScheduledSingleAdmin('${o.id}')" style="padding:6px; font-size:11px; background:#ef4444;">🗑 Void</button>
                </td>
                <td style="font-size:12px; color:#64748b;">${d}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function toggleAllScheduled(source) {
    document.querySelectorAll('.sched-checkbox').forEach(cb => cb.checked = source.checked);
    updateSchedSelectCount();
}

function updateSchedSelectCount() {
    const count = document.querySelectorAll('.sched-checkbox:checked').length;
    document.getElementById("schedSelectCounter").innerText = count;
}

async function processScheduledSingleAdmin(id) {
    if(!confirm("Push this single scheduled order into the live Pending queue right now?")) return;
    const order = allSchedAdmin.find(o => o.id === id);
    if (!order) return;
    
    await executeProcessScheduledOrders([order]);
}

async function massProcessScheduledAdmin() {
    const checked = [...document.querySelectorAll('.sched-checkbox:checked')].map(cb => cb.value);
    if (!checked.length) return alert("Select at least one scheduled order to process.");
    
    if(!confirm(`Push ${checked.length} selected scheduled orders into the live Pending queue right now?`)) return;
    
    const orders = allSchedAdmin.filter(o => checked.includes(o.id));
    await executeProcessScheduledOrders(orders);
}

// Internal reusable processing func
async function executeProcessScheduledOrders(ordersArr) {
    try {
        let successCount = 0;
        for (const order of ordersArr) {
            // Push to regular live orders table
            await supabase.from('orders').insert({
                user_id: order.user_id,
                network: order.network,
                phone:   order.phone,
                plan:    order.plan,
                amount:  order.amount,
                status:  'pending'
            });

            // Mark scheduled order as processed
            await supabase.from('scheduled_orders').update({ status: 'processed' }).eq('id', order.id);

            // Optional SMS (Admin dashboard might not have the user's phone context if we just rely on `order.phone` which is recipient, so we'll skip SMS here or just trust a DB trigger)
            successCount++;
        }
        alert(`✅ Successfully processed ${successCount} scheduled orders to live queue.`);
        loadScheduledOrdersAdmin();
    } catch(err) {
        alert("Processing Error: " + err.message);
    }
}

async function deleteScheduledSingleAdmin(id) {
    if(!confirm("Void this scheduled order and refund the wallet balance to the user? (Cannot be undone)")) return;
    const order = allSchedAdmin.find(o => o.id === id);
    if (!order) return;
    
    await executeDeleteScheduledOrders([order]);
}

async function applyMassStatusUpdateSched() {
    const status = document.getElementById('massStatusUpdateSelectSched').value;
    if (!status) return alert("Select a status to apply.");
    
    const checked = [...document.querySelectorAll('.sched-checkbox:checked')].map(cb => cb.value);
    if (!checked.length) return alert("Select at least one scheduled order to update.");

    if (!confirm(`Update ${checked.length} scheduled orders to status: ${status.toUpperCase()}?`)) return;

    try {
        if (status === 'Refund') {
            const orders = allSchedAdmin.filter(o => checked.includes(o.id));
            await executeDeleteScheduledOrders(orders); // Existing refund logic
        } else {
            const { error } = await supabase.from('scheduled_orders').update({ status }).in('id', checked);
            if (error) throw error;
            alert(`✅ Successfully updated ${checked.length} scheduled orders to ${status.toUpperCase()}.`);
        }
        loadScheduledOrdersAdmin();
    } catch (e) {
        alert("Update Error: " + e.message);
    }
}

async function massDeleteScheduledAdmin() {
    const checked = [...document.querySelectorAll('.sched-checkbox:checked')].map(cb => cb.value);
    if (!checked.length) return alert("Select at least one scheduled order to void.");
    
    if(!confirm(`Void ${checked.length} scheduled orders and refund the users? (Cannot be undone)`)) return;
    const orders = allSchedAdmin.filter(o => checked.includes(o.id));
    await executeDeleteScheduledOrders(orders);
}

async function executeDeleteScheduledOrders(ordersArr) {
    try {
        let successCount = 0;
        let totalRefunded = 0;

        // Note: For mass deletion spanning multiple users, we should ideally use a stored procedure to prevent race conditions.
        // For right now, we will iterate and process sequentially. 
        for (const order of ordersArr) {
            const { data: userData } = await supabase.from('users').select('wallet_balance').eq('id', order.user_id).single();
            if(!userData) continue;

            const refund = parseFloat(order.amount || 0);
            const currentBal = parseFloat(userData.wallet_balance || 0);
            const newBal = (currentBal + refund).toFixed(2);

            // 1. Update wallet
            await supabase.from('users').update({ wallet_balance: newBal }).eq('id', order.user_id);
            
            // 2. Add refund transaction
            await supabase.from('transactions').insert({
                user_id: order.user_id,
                type: 'Admin Voided Scheduled Order',
                amount: refund,
                balance_before: currentBal,
                balance_after: newBal,
                status: 'Refunded'
            });

            // 3. Delete scheduled record
            await supabase.from('scheduled_orders').delete().eq('id', order.id);

            successCount++;
            totalRefunded += refund;
        }

        alert(`✅ Voided ${successCount} queued orders. Total of ₵${totalRefunded.toFixed(2)} refunded.`);
        loadScheduledOrdersAdmin();
    } catch(err) {
        alert("Voiding Error: " + err.message);
    }
}

// ==========================================
// TAB 7: PRICING & GATEWAY CONTROLS
// ==========================================
const ROLES = ['client', 'vip_customer', 'elite_agent', 'super_agent', 'admin'];
const NETWORKS = ['data_mtn', 'data_telecel', 'data_tigo', 'data_bigtime'];

async function loadPricingConfig() {
    try {
        // 1. Load Data Pricing Matrix
        const { data: pricingData, error: pErr } = await supabase.from('pricing').select('*');
        if (pErr) throw pErr;

        renderPricingMatrix(pricingData || []);


        // 2. Load AFA Config
        const { data: afaData } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'afa_settings')
            .single();

        if (afaData) {
            document.getElementById('afaNormalCost').value = afaData.value.normal_tier_price || 0;
            document.getElementById('afaPremiumCost').value = afaData.value.premium_tier_price || 0;
        }

        // 3. Load Gateway Config
        const { data: settings } = await supabase
            .from('app_settings')
            .select('key, value')
            .in('key', ['paystack_public_key', 'paystack_secret_key', 'paystack_enabled', 'manual_transfer_enabled', 'manual_momo_number', 'manual_momo_name', 'maintenance_mode']);

        if (settings) {
            settings.forEach(s => {
                if (s.key === 'paystack_public_key') document.getElementById('paystackPubKey').value = s.value;
                if (s.key === 'paystack_secret_key') document.getElementById('paystackSecretKey').value = s.value;
                if (s.key === 'paystack_enabled') document.getElementById('paystackStatusToggle').value = s.value;
                if (s.key === 'manual_transfer_enabled') document.getElementById('manualStatusToggle').value = s.value;
                if (s.key === 'manual_momo_number') document.getElementById('manualMomoNumber').value = s.value;
                if (s.key === 'manual_momo_name') document.getElementById('manualMomoName').value = s.value;
                if (s.key === 'maintenance_mode') {
                    const isActive = s.value === 'true';
                    const label = document.getElementById('maintenanceStatusLabel');
                    const btn = document.getElementById('maintenanceToggleBtn');
                    if (label) {
                        label.innerText = isActive ? 'ACTIVE' : 'OFF';
                        label.style.color = isActive ? '#ef4444' : '#9a3412';
                    }
                    if (btn) {
                        btn.innerText = isActive ? 'Disable Maintenance' : 'Enable Maintenance';
                        btn.style.background = isActive ? '#ef4444' : '#9a3412';
                    }
                }
            });
        }

    } catch (err) {
        console.error("Config Load Error:", err);
    }
}

async function saveGatewaySettings() {
    const pubKey = document.getElementById('paystackPubKey').value.trim();
    const secKey = document.getElementById('paystackSecretKey').value.trim();
    const paystackOn = document.getElementById('paystackStatusToggle').value;
    const manualOn = document.getElementById('manualStatusToggle').value;
    const momoNum = document.getElementById('manualMomoNumber').value.trim();
    const momoName = document.getElementById('manualMomoName').value.trim();

    const updates = [
        { key: 'paystack_public_key', value: pubKey },
        { key: 'paystack_secret_key', value: secKey },
        { key: 'paystack_enabled', value: paystackOn },
        { key: 'manual_transfer_enabled', value: manualOn },
        { key: 'manual_momo_number', value: momoNum },
        { key: 'manual_momo_name', value: momoName }
    ];

    try {
        const { error } = await supabase
            .from('app_settings')
            .upsert(updates, { onConflict: 'key' });

        if (error) throw error;
        alert("✅ Payment Gateway settings successfully updated!");
    } catch (err) {
        alert("Gateway Update Error: " + err.message);
    }
}

// ==========================================
// API AUTO-FULFILLMENT (DATARJUST)
// ==========================================

// ==========================================
// API KEYS MANAGEMENT (PHASE 2)


async function toggleMaintenanceMode() {
    const label = document.getElementById('maintenanceStatusLabel');
    const isCurrentlyActive = label && label.innerText === 'ACTIVE';
    const newState = !isCurrentlyActive;
    
    if (!confirm(`Are you sure you want to ${newState ? 'ENABLE' : 'DISABLE'} System Maintenance Mode?`)) return;

    try {
        const { error } = await supabase
            .from('app_settings')
            .upsert({ key: 'maintenance_mode', value: String(newState) }, { onConflict: 'key' });

        if (error) throw error;
        alert(`✅ System Maintenance Mode has been ${newState ? 'enabled' : 'disabled'}.`);
        loadPricingConfig();
    } catch (err) {
        alert("Maintenance Toggle Error: " + err.message);
    }
}

function renderPricingMatrix(dbPrices) {
    const tbody = document.getElementById("pricingMatrixBody");
    tbody.innerHTML = '';

    // Grouping: uniqueKey = product + gb_size
    // map[uniqueKey] = { product, gb_size, is_in_stock, roles: { role1: price1, ... } }
    const groupMap = {};
    
    // Populate from DB records
    dbPrices.forEach(p => {
        const sz = p.gb_size || 0;
        const key = `${p.product}_${sz}`;
        if (!groupMap[key]) {
            groupMap[key] = { product: p.product, sz: sz, stock: p.is_in_stock, roles: {} };
        }
        groupMap[key].roles[p.role] = p.price;
        groupMap[key].stock = p.is_in_stock; 
    });

    const netLabels = {
        'data_mtn': 'MTN Data',
        'data_telecel': 'Telecel',
        'data_tigo': 'AirtelTigo',
        'data_bigtime': 'BigTime'
    };

    let html = '';
    // Sort by product then size
    Object.keys(groupMap).sort((a,b) => {
        const [pA, sA] = a.split('_');
        const [pB, sB] = b.split('_');
        if (pA !== pB) return pA.localeCompare(pB);
        return parseFloat(sA) - parseFloat(sB);
    }).forEach(key => {
        const item = groupMap[key];
        const szLabel = item.sz === 0 ? 'Per GB (Base)' : `${item.sz} GB`;
        
        html += `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:15px 12px; font-weight:600; color:#475569;">${netLabels[item.product] || item.product}</td>
            <td style="padding:15px 12px; color:#64748b; font-weight:700;">${szLabel}</td>
            <td style="padding:15px 12px;">
                <select class="admin-input stock-toggle" data-product="${item.product}" data-size="${item.sz}" style="width:80px; padding:4px;">
                    <option value="true" ${item.stock !== false ? 'selected' : ''}>In</option>
                    <option value="false" ${item.stock === false ? 'selected' : ''}>Out</option>
                </select>
            </td>`;
            
        ROLES.forEach(r => {
            const val = item.roles[r] ? parseFloat(item.roles[r]).toFixed(2) : '0.00';
            html += `<td style="padding:10px 8px;">
                <input type="number" step="0.01" min="0.00" 
                       class="admin-input price-input" 
                       data-role="${r}" 
                       data-product="${item.product}" 
                       data-size="${item.sz}"
                       value="${val}" 
                       style="width:75px; text-align:right; padding:6px;">
            </td>`;
        });
        html += `<td style="padding:10px 8px; text-align:center;">
            <button onclick="deletePricingSize('${item.product}', ${item.sz})" style="background:#ef4444; color:white; border:none; border-radius:6px; padding:6px 10px; cursor:pointer;" title="Delete Row">🗑️</button>
        </td>`;
        
        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

async function deletePricingSize(product, size) {
    if (!confirm(`Are you sure you want to delete the ${size}GB size for ${product}?`)) return;

    try {
        const { error } = await supabase
            .from('pricing')
            .delete()
            .match({ product: product, gb_size: size });
            
        if (error) throw error;
        alert(`✅ ${size}GB size has been deleted.`);
        loadPricingConfig();
    } catch (err) {
        alert("Error deleting size: " + err.message);
    }
}

async function addPricingSize() {
    const sizeInput = document.getElementById('newGbSizeInput');
    const productSelect = document.getElementById('newGbSizeProduct');
    const size = parseFloat(sizeInput.value);
    const selectedProduct = productSelect ? productSelect.value : 'data_mtn';

    if (isNaN(size) || size <= 0) {
        alert("Please enter a valid GB size.");
        return;
    }

    // Insert placeholders for the selected network and all roles for this new size
    const newRows = [];
    ROLES.forEach(role => {
        newRows.push({
            product: selectedProduct,
            gb_size: size,
            role: role,
            price: 0,
            is_in_stock: true
        });
    });

    try {
        const { error } = await supabase.from('pricing').upsert(newRows, { onConflict: 'role, product, gb_size' });
        if (error) throw error;
        sizeInput.value = '';
        
        const friendlyNames = {
            'data_mtn': 'MTN Data',
            'data_telecel': 'Telecel',
            'data_tigo': 'AirtelTigo',
            'data_bigtime': 'BigTime'
        };
        const productName = friendlyNames[selectedProduct] || selectedProduct;
        
        alert(`✅ ${size}GB size added to ${productName}. Now set the prices in the matrix below.`);
        loadPricingConfig();
    } catch (err) {
        alert("Error adding size: " + err.message);
    }
}

async function saveDataPricingMatrix() {
    const updates = [];
    const stockToggles = document.querySelectorAll('.stock-toggle');
    const priceInputs = document.querySelectorAll('.price-input');

    // Use a temporary map to build the final list
    const finalData = [];

    priceInputs.forEach(inp => {
        const role = inp.dataset.role;
        const product = inp.dataset.product;
        const size = parseFloat(inp.dataset.size);
        const price = parseFloat(inp.value) || 0;
        
        // Find matching stock toggle
        const stockEl = Array.from(stockToggles).find(t => t.dataset.product === product && parseFloat(t.dataset.size) === size);
        const isInStock = stockEl ? stockEl.value === 'true' : true;

        updates.push({
            role: role,
            product: product,
            gb_size: size,
            price: price,
            is_in_stock: isInStock
        });
    });

    try {
        const { error } = await supabase.from('pricing').upsert(updates, { onConflict: 'role, product, gb_size' });
        if (error) throw error;
        alert("✅ Granular Pricing & Stock Matrix Successfully Updated!");
        loadPricingConfig();
    } catch(err) {
        alert("Error saving matrix: " + err.message);
    }
}

async function saveAfaSettings() {
    const normal = parseFloat(document.getElementById('afaNormalCost').value) || 0;
    const premium = parseFloat(document.getElementById('afaPremiumCost').value) || 0;

    const payload = {
        normal_tier_price: normal,
        premium_tier_price: premium
    };

    try {
        const { error } = await supabase
            .from('system_config')
            .upsert({
                key: 'afa_settings',
                value: payload,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (error) throw error;
        alert("✅ AFA Registration Costs Successfully Updated!");
    } catch (err) {
        alert("Error saving AFA config: " + err.message);
    }
}
// ==========================================
// TAB 6: AFA REGISTRATIONS
// ==========================================
async function loadAfa() {
    const tbody = document.getElementById("afaTableBody");
    tbody.innerHTML = `<tr><td colspan="8" class="state-msg">Syncing AFA applications...</td></tr>`;

    const { data, error } = await supabase
        .from('afa_registrations')
        .select('*, users(email)')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="state-msg" style="color:red!important;">Error: ${error.message}</td></tr>`;
        return;
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="state-msg">No AFA registrations pending.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(r => {
        const d = new Date(r.created_at).toLocaleDateString();
        const userEmail = r.users?.email || 'Unknown User';
        
        // Tier Badge
        const tierBadge = r.tier === 'premium' 
            ? '<span class="status-badge" style="background:#fef3c7; color:#d97706;">PREMIUM AFA</span>'
            : '<span class="status-badge" style="background:#e0f2fe; color:#0284c7;">NORMAL AFA</span>';

        // Status Badge
        let statBadge = '';
        let actBtns = '';
        if(r.status === 'pending') {
            statBadge = '<span class="status-badge status-checking">PENDING</span>';
            actBtns = `
                <button class="action-btn btn-approve" onclick="updateAfaStatus('${r.id}', 'approved', '${userEmail}')" style="margin-right:5px;">Approve</button>
                <button class="action-btn" onclick="updateAfaStatus('${r.id}', 'rejected', '${userEmail}')" style="background:#ef4444; color:white;">Reject</button>
            `;
        } else if(r.status === 'approved') {
            statBadge = '<span class="status-badge status-approved">APPROVED</span>';
            actBtns = `<span style="font-size:12px; color:#64748b; font-style:italic;">Resolved</span>`;
        } else {
            statBadge = '<span class="status-badge status-false">REJECTED</span>';
            actBtns = `<span style="font-size:12px; color:#64748b; font-style:italic;">Resolved</span>`;
        }

        // View Docs Button for AFA
        let docsBtn = '';
        if (r.id_front_url || r.id_back_url) {
            docsBtn = `<button class="action-btn" onclick="viewAfaDocs('${r.id_front_url}', '${r.id_back_url}')" style="background:#4f46e5; color:white; margin-top:5px; width:100%; display:block; font-weight:700;">📂 View ID Docs</button>`;
        }

        html += `
            <tr>
                <td style="font-weight:600; color:#0f172a;">${userEmail}</td>
                <td>${tierBadge}</td>
                <td><strong>${r.full_name}</strong></td>
                <td>${r.phone}</td>
                <td style="font-size:12px;">
                    <div style="font-weight:700; color:#1e293b;">${r.id_type}</div>
                    <div>#${r.id_number}</div>
                    <div style="color:#64748b;">DOB: ${r.dob || 'N/A'}</div>
                </td>
                <td>${statBadge}</td>
                <td style="font-size:12px; color:#64748b;">${d}</td>
                <td style="white-space:nowrap;">
                    ${actBtns}
                    ${docsBtn}
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

async function updateAfaStatus(id, newStatus, email) {
    if(!confirm(`Are you sure you want to mark this request from ${email} as ${newStatus.toUpperCase()}?`)) return;

    const { error } = await supabase.from('afa_registrations').update({ status: newStatus }).eq('id', id);
    if(error) {
        alert("AFA Update Error: " + error.message);
    } else {
        alert(`AFA Request successfully marked as ${newStatus}.`);
        loadAfa();
    }
}

async function viewAfaDocs(frontPath, backPath) {
    if (!frontPath && !backPath) return alert("No documents uploaded for this request.");

    document.getElementById("modalTitle").innerText = "AFA Identity Verification";
    const body = document.getElementById("modalBody");
    body.innerHTML = '<div class="state-msg">Fetching documents...</div>';
    document.getElementById("imageModal").style.display = "block";

    try {
        let html = '<div style="display:flex; gap:15px; flex-wrap:wrap; justify-content:center;">';
        let found = false;

        if (frontPath) {
            // Support both 'tickets' and 'afa' buckets just in case
            let { data } = supabase.storage.from('tickets').getPublicUrl(frontPath);
            if (!data.publicUrl || data.publicUrl.includes("undefined")) {
                data = supabase.storage.from('afa').getPublicUrl(frontPath).data;
            }

            if (data && data.publicUrl) {
                found = true;
                html += `
                    <div style="flex:1; min-width:300px; text-align:center; background:#f8fafc; padding:15px; border-radius:12px; border:1px solid #e2e8f0;">
                        <p style="font-size:11px; font-weight:800; color:#475569; margin-bottom:12px; text-transform:uppercase; letter-spacing:0.05em;">ID FRONT VIEW</p>
                        <img src="${data.publicUrl}" style="width:100%; border-radius:8px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="margin-top:12px; display:flex; gap:10px; justify-content:center;">
                            <a href="${data.publicUrl}" target="_blank" style="font-size:12px; color:#4f46e5; text-decoration:none; font-weight:600; padding:4px 8px; background:#eff6ff; border-radius:6px;">View Full ↗</a>
                            <button onclick="downloadAfaImage('${data.publicUrl}', 'ID_Front')" style="font-size:12px; color:#10b981; border:none; background:#ecfdf5; cursor:pointer; font-weight:600; padding:4px 8px; border-radius:6px;">Download ↓</button>
                        </div>
                    </div>`;
            }
        }

        if (backPath) {
            let { data } = supabase.storage.from('tickets').getPublicUrl(backPath);
            if (!data.publicUrl || data.publicUrl.includes("undefined")) {
                data = supabase.storage.from('afa').getPublicUrl(backPath).data;
            }

            if (data && data.publicUrl) {
                found = true;
                html += `
                    <div style="flex:1; min-width:300px; text-align:center; background:#f8fafc; padding:15px; border-radius:12px; border:1px solid #e2e8f0;">
                        <p style="font-size:11px; font-weight:800; color:#475569; margin-bottom:12px; text-transform:uppercase; letter-spacing:0.05em;">ID BACK VIEW</p>
                        <img src="${data.publicUrl}" style="width:100%; border-radius:8px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="margin-top:12px; display:flex; gap:10px; justify-content:center;">
                            <a href="${data.publicUrl}" target="_blank" style="font-size:12px; color:#4f46e5; text-decoration:none; font-weight:600; padding:4px 8px; background:#eff6ff; border-radius:6px;">View Full ↗</a>
                            <button onclick="downloadAfaImage('${data.publicUrl}', 'ID_Back')" style="font-size:12px; color:#10b981; border:none; background:#ecfdf5; cursor:pointer; font-weight:600; padding:4px 8px; border-radius:6px;">Download ↓</button>
                        </div>
                    </div>`;
            }
        }
        
        html += '</div>';

        if (found) {
            body.innerHTML = html;
        } else {
            body.innerHTML = '<div class="state-msg" style="color:#ef4444;">Failed to generate document links. Please ensure files exist in Storage.</div>';
        }
    } catch (e) {
        body.innerHTML = `<div class="state-msg" style="color:#ef4444;">Error: ${e.message}</div>`;
    }
}

// Helper to download images from different origins
async function downloadAfaImage(url, name) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `${name}_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error("Download failed:", err);
        alert("Failed to download image. Try opening 'View Full' and right-clicking to save.");
    }
}

// ==========================================

// ==========================================
// TAB 2: MANUAL FUNDING
// ==========================================
async function loadManualFunding() {
    const tbody = document.getElementById("manualTableBody");
    tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Fetching manual transfers...</td></tr>`;

    // Fetch pending manual transfers
    const { data, error } = await supabase
        .from('transactions')
        .select('*, users(email, phone)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Zero manual transfers awaiting approval.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(t => {
        const d = new Date(t.created_at).toLocaleString();
        html += `
            <tr>
                <td style="font-family:monospace; color:#64748b;">${t.id.substring(0,8)}...</td>
                <td>${t.users?.email || 'Unknown User'}</td>
                <td><strong style="color:#059669;">₵ ${t.amount}</strong></td>
                <td style="font-size:12px;">${d}</td>
                <td>
                    <button class="action-btn btn-approve" onclick="approveFunding('${t.id}', '${t.user_id}', ${t.amount})">Approve Credit</button>
                    <button class="action-btn btn-reject" onclick="rejectFunding('${t.id}')">Reject</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

async function approveFunding(txId, userId, amount) {
    if(!confirm(`Approve adding ₵${amount} to this user's wallet?`)) return;

    // 1. Mark transaction as completed
    await supabase.from('transactions').update({ status: 'completed' }).eq('id', txId);
    
    // 2. Safely read current wallet balance and phone
    const { data: u } = await supabase.from('users').select('wallet_balance, phone').eq('id', userId).single();
    if (!u) return alert("User not found.");

    const newBal = (parseFloat(u.wallet_balance || 0) + parseFloat(amount)).toFixed(2);
    
    // 3. Update User's balance completely
    await supabase.from('users').update({ wallet_balance: newBal }).eq('id', userId);
    
    // 4. Trigger SMS Notification
    if (window.sendSmsNotification && u.phone) {
        window.sendSmsNotification(u.phone, `Wallet Credited: Your manual funding request of ₵${amount} has been approved. Your new balance is ₵${newBal}. Thank you for choosing Data4Ghana!`);
    }

    alert("Funds successfully deposited to user wallet.");
    loadManualFunding();
}

async function rejectFunding(txId) {
    if(!confirm("Are you sure you want to reject this manual transfer request?")) return;

    // Fetch user and amount first for SMS
    const { data: tx } = await supabase.from('transactions').select('amount, user_id').eq('id', txId).single();
    if (tx) {
        const { data: u } = await supabase.from('users').select('phone').eq('id', tx.user_id).single();
        if (window.sendSmsNotification && u?.phone) {
            window.sendSmsNotification(u.phone, `Funding Rejected: Your manual funding request of ₵${tx.amount} has been rejected. Please contact technical support if you believe this is an error.`);
        }
    }

    await supabase.from('transactions').update({ status: 'rejected' }).eq('id', txId);
    loadManualFunding();
}

// ==========================================
// TAB 3: SUPPORT TICKETS
// ==========================================
async function loadSupportTickets() {
    const tbody = document.getElementById("supportTableBody");
    tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Fetching active support tickets...</td></tr>`;

    // Fetch tickets that still need reviewing
    const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('status', 'checking')
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Zero active support tickets. The queue is completely clear.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(t => {
        // Build screenshot URL
        const { data: publicUrlData } = supabase.storage.from('tickets').getPublicUrl(t.screenshot_url);
        const imgUrl = publicUrlData.publicUrl;

        const orderDisplay = t.order_id 
            ? `<a href="#" onclick="viewOrderFromTicket('${t.order_id}'); return false;" style="color:#2563eb; font-weight:700; text-decoration:underline;">${t.order_id.substring(0,8)}</a>`
            : '<span style="color:#64748b;">General</span>';

        html += `
            <tr>
                <td style="font-family:monospace; color:#64748b;">${t.id.substring(0,8)}</td>
                <td style="font-family:monospace;">${orderDisplay}</td>
                <td><strong>${t.phone}</strong></td>
                <td style="max-width:300px;">${t.issue}</td>
                <td>
                    <button class="action-btn btn-view" onclick="openImageModal('${imgUrl}')">View Image</button>
                </td>
                <td>
                    <button class="action-btn btn-approve" onclick="resolveTicket('${t.id}', 'approved')">Approve Issue</button>
                    <button class="action-btn btn-reject" onclick="resolveTicket('${t.id}', 'false')">Mark Invalid</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function viewOrderFromTicket(orderId) {
    // 1. Switch to orders tab
    const orderTabLink = document.querySelector('a[onclick*="switchTab(\'orders\')"]');
    if (orderTabLink) orderTabLink.click();
    else switchTab('orders');

    // 2. Set the filter
    const filterInput = document.getElementById("filterRef");
    if (filterInput) {
        filterInput.value = orderId;
        // 3. Trigger filtering
        applyOrderFilters();
    }
}

async function resolveTicket(ticketId, finalStatus) {
    if(!confirm(`Are you sure you want to mark this ticket as ${finalStatus.toUpperCase()}? This will text the user's phone.`)) return;
    
    // Changing the status will trigger the public.trigger_ticket_sms Postgres function!
    await supabase.from('support_tickets').update({ status: finalStatus }).eq('id', ticketId);
    loadSupportTickets();
}

// Image Modal Logic
function openImageModal(imgSrc, title = "Screenshot Preview") {
    document.getElementById("modalTitle").innerText = title;
    const body = document.getElementById("modalBody");
    body.innerHTML = `<img src="${imgSrc}" style="max-width:100%; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.15);">`;
    document.getElementById("imageModal").style.display = "block";
}
function closeModal() {
    document.getElementById("imageModal").style.display = "none";
}

// ==========================================
// TAB 4: USERS DATABASE
// ==========================================
async function loadUsers() {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Syncing User Database...</td></tr>`;

    const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, phone, business_name, region, wallet_balance, role')
        .not('role', 'eq', 'admin')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="5" class="state-msg">Database failure.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(u => {
        // Build dynamic role selector
        const roleStr = u.role || 'client';
        const selectMenu = `
            <select class="admin-input" style="padding:4px; font-size:12px; width:110px;" onchange="updateUserRole('${u.id}', this.value)">
                <option value="client" ${roleStr === 'client' ? 'selected' : ''}>Client</option>
                <option value="elite_agent" ${roleStr === 'elite_agent' ? 'selected' : ''}>Elite Agent</option>
                <option value="super_agent" ${roleStr === 'super_agent' ? 'selected' : ''}>Super Agent</option>
                <option value="admin" ${roleStr === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
        `;

        html += `
            <tr>
                <td><strong>${u.first_name || ''} ${u.last_name || ''}</strong></td>
                <td>${u.email}</td>
                <td>${u.phone || 'N/A'}</td>
                <td>
                    <div style="font-weight:700; color:#4f46e5;">${u.business_name || 'N/A'}</div>
                    <div style="font-size:11px; color:#64748b;">${u.region || 'N/A'}</div>
                </td>
                <td><strong>₵ ${parseFloat(u.wallet_balance || 0).toFixed(2)}</strong></td>
                <td>${selectMenu}</td>
                <td style="white-space:nowrap;">
                    <button onclick="openWalletModal('${u.email}', '${(u.first_name || '').replace(/'/g, "\\'")} ${(u.last_name || '').replace(/'/g, "\\'")}', ${u.wallet_balance || 0})" style="padding:5px 10px; border:1px solid #10b981; background:rgba(16,185,129,0.1); color:#10b981; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; margin-right:4px;" title="Credit or Debit wallet">💳</button>
                    <button onclick="openTxModal('${u.email}', '${(u.first_name || '').replace(/'/g, "\\'")} ${(u.last_name || '').replace(/'/g, "\\'")}' )" style="padding:5px 10px; border:1px solid #3b82f6; background:rgba(59,130,246,0.1); color:#3b82f6; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="View transactions">📋</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

async function exportAllUsersCSV() {
    if (!confirm("Are you sure you want to download the entire user database?")) return;

    try {
        let allUsers = [];
        let from = 0;
        const step = 1000;
        let more = true;

        while (more) {
            const { data, error } = await supabase
                .from('users')
                .select('first_name, last_name, email, phone, business_name, region, wallet_balance, role, created_at')
                .range(from, from + step - 1)
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (data.length === 0) {
                more = false;
            } else {
                allUsers = [...allUsers, ...data];
                from += step;
                if (data.length < step) more = false;
            }
        }

        if (allUsers.length === 0) return alert("No users found to export.");

        const headers = ["First Name", "Last Name", "Email", "Phone", "Business Name", "Region", "Wallet Balance", "Role", "Joined Date"];
        let csvContent = headers.join(",") + "\n";

        allUsers.forEach(u => {
            const row = [
                u.first_name || "",
                u.last_name || "",
                u.email,
                u.phone || "",
                u.business_name || "",
                u.region || "",
                u.wallet_balance || 0,
                u.role || "client",
                new Date(u.created_at).toLocaleDateString()
            ];
            csvContent += row.map(v => `"${v}"`).join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Data4Ghana_Users_MasterList_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (err) {
        console.error("Export error:", err);
        alert("Failed to export users: " + err.message);
    }
}

// ==========================================
// UPDATE USER ROLE (called by inline onchange in Users tab)
// ==========================================
async function updateUserRole(userId, newRole) {
    if (!confirm(`Change this user's role to ${newRole.toUpperCase().replace(/_/g, ' ')}?`)) {
        loadUsers(); // re-render to revert the dropdown visual state
        return;
    }

    try {
        // Prefer the secure SECURITY DEFINER RPC (validates admin server-side)
        const { error: rpcError } = await supabase.rpc('admin_update_role', {
            target_user_id: userId,
            new_role: newRole
        });

        if (rpcError) {
            // RPC may not exist yet — fall back to direct update (still protected by RLS)
            const { error: directError } = await supabase
                .from('users')
                .update({ role: newRole })
                .eq('id', userId);
            if (directError) throw directError;
        }

        // Trigger SMS Notification
        const { data: u } = await supabase.from('users').select('phone').eq('id', userId).single();
        if (window.sendSmsNotification && u?.phone) {
            const roleName = newRole.toUpperCase().replace(/_/g, ' ');
            window.sendSmsNotification(u.phone, `Your account role has been updated to ${roleName}. Log in to see your new benefits!`);
        }

        alert(`✅ Role updated to ${newRole.toUpperCase().replace(/_/g, ' ')}`);
        loadUsers();
    } catch(e) {
        alert('Failed to update role: ' + e.message);
        loadUsers();
    }
}

// ==========================================
// CHANGE USER ROLE (legacy — kept for compatibility)
// ==========================================
async function changeUserRole(email, newRole) {
    if (window.adminRole !== 'admin') {
        alert('Only admins can change user roles.');
        loadUsers();
        return;
    }

    if (!confirm(`Change this user's role to ${newRole.toUpperCase().replace(/_/g, ' ')}?`)) {
        loadUsers();
        return;
    }

    try {
        const { error } = await supabase
            .from('users')
            .update({ role: newRole })
            .eq('email', email);

        if (error) throw error;

        // Trigger SMS Notification
        const { data: u } = await supabase.from('users').select('phone').eq('email', email).single();
        if (window.sendSmsNotification && u?.phone) {
            const roleName = newRole.toUpperCase().replace(/_/g, ' ');
            window.sendSmsNotification(u.phone, `Your account role has been updated to ${roleName}. Log in to see your new benefits!`);
        }

        alert(`✅ Role updated to ${newRole.toUpperCase().replace(/_/g, ' ')}`);
        loadUsers();
    } catch(e) {
        alert('Failed to update role: ' + e.message);
        loadUsers();
    }
}

// ==========================================
// CREDIT / DEBIT USER WALLET
// ==========================================
let walletModalEmail = '';
let walletModalBalance = 0;
let walletAction = 'credit';

function openWalletModal(email, name, currentBalance) {
    walletModalEmail = email;
    walletModalBalance = parseFloat(currentBalance) || 0;
    walletAction = 'credit';

    document.getElementById('walletModalUser').innerHTML = `<strong>${name.trim()}</strong> · ${email}<br>Current Balance: <strong>₵${walletModalBalance.toFixed(2)}</strong>`;
    document.getElementById('walletAmount').value = '';
    document.getElementById('walletReason').value = '';
    setWalletAction('credit');
    document.getElementById('walletModal').style.display = 'flex';
}

function closeWalletModal() {
    document.getElementById('walletModal').style.display = 'none';
}

function setWalletAction(action) {
    walletAction = action;
    const creditBtn = document.getElementById('creditTabBtn');
    const debitBtn = document.getElementById('debitTabBtn');
    const submitBtn = document.getElementById('walletSubmitBtn');

    if (action === 'credit') {
        creditBtn.style.border = '2px solid #10b981';
        creditBtn.style.background = 'rgba(16,185,129,0.1)';
        creditBtn.style.color = '#10b981';
        debitBtn.style.border = '2px solid #e2e8f0';
        debitBtn.style.background = 'white';
        debitBtn.style.color = '#64748b';
        submitBtn.style.background = '#10b981';
        submitBtn.innerText = 'Confirm Credit';
    } else {
        debitBtn.style.border = '2px solid #ef4444';
        debitBtn.style.background = 'rgba(239,68,68,0.1)';
        debitBtn.style.color = '#ef4444';
        creditBtn.style.border = '2px solid #e2e8f0';
        creditBtn.style.background = 'white';
        creditBtn.style.color = '#64748b';
        submitBtn.style.background = '#ef4444';
        submitBtn.innerText = 'Confirm Debit';
    }
}

async function submitWalletAction() {
    const amount = parseFloat(document.getElementById('walletAmount').value);
    const reason = document.getElementById('walletReason').value.trim() || (walletAction === 'credit' ? 'Admin Credit' : 'Admin Debit');

    if (!amount || amount <= 0) {
        alert('Please enter a valid amount.');
        return;
    }

    if (walletAction === 'debit' && amount > walletModalBalance) {
        alert(`Cannot debit ₵${amount.toFixed(2)} — user only has ₵${walletModalBalance.toFixed(2)}`);
        return;
    }

    const newBalance = walletAction === 'credit'
        ? walletModalBalance + amount
        : walletModalBalance - amount;

    const actionLabel = walletAction === 'credit' ? 'Credit' : 'Debit';
    if (!confirm(`${actionLabel} ₵${amount.toFixed(2)} ${walletAction === 'credit' ? 'to' : 'from'} this user?\n\nNew balance: ₵${newBalance.toFixed(2)}\nReason: ${reason}`)) {
        return;
    }

    try {
        // Get user ID and Phone from email
        const { data: userData, error: userErr } = await supabase
            .from('users')
            .select('id, phone')
            .eq('email', walletModalEmail)
            .single();
    
        if (userErr || !userData) throw new Error('User not found');
    
        // Update wallet balance
        const { error: updateErr } = await supabase
            .from('users')
            .update({ wallet_balance: newBalance })
            .eq('id', userData.id);
    
        if (updateErr) throw updateErr;
    
        // Record the transaction
        await supabase
            .from('transactions')
            .insert({
                user_id: userData.id,
                type: `Admin ${actionLabel}`,
                amount: amount,
                balance_before: walletModalBalance,
                balance_after: newBalance,
                status: 'Completed',
                reference: `ADMIN_${walletAction.toUpperCase()}_${Date.now()}`
            });
    
        // Trigger SMS Notification
        if (window.sendSmsNotification && userData.phone) {
            const msg = walletAction === 'credit'
                ? `Your wallet has been credited with ₵${amount.toFixed(2)} by Admin. New Balance: ₵${newBalance.toFixed(2)}. Thank you!`
                : `Your wallet has been debited by ₵${amount.toFixed(2)} (Admin). New Balance: ₵${newBalance.toFixed(2)}.`;
            window.sendSmsNotification(userData.phone, msg);
        }

        alert(`✅ ${actionLabel} of ₵${amount.toFixed(2)} applied. New balance: ₵${newBalance.toFixed(2)}`);
        closeWalletModal();
        loadUsers();
    } catch(e) {
        alert('Failed: ' + e.message);
    }
}

// ==========================================
// VIEW USER TRANSACTIONS
// ==========================================
async function openTxModal(email, name) {
    document.getElementById('txModalTitle').innerHTML = `📋 Transactions — <strong>${name.trim()}</strong>`;
    document.getElementById('txModalBody').innerHTML = '<p style="color:#94a3b8;">Loading transactions...</p>';
    document.getElementById('txModal').style.display = 'flex';

    try {
        // Get user ID
        const { data: userData } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (!userData) {
            document.getElementById('txModalBody').innerHTML = '<p style="color:#ef4444;">User not found.</p>';
            return;
        }

        // Fetch last 50 transactions
        const { data: txns, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userData.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (!txns || txns.length === 0) {
            document.getElementById('txModalBody').innerHTML = '<p style="color:#94a3b8; text-align:center; padding:30px;">No transactions found for this user.</p>';
            return;
        }

        let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
                <tr style="border-bottom:2px solid #e2e8f0; text-align:left;">
                    <th style="padding:8px 6px; color:#64748b;">Date</th>
                    <th style="padding:8px 6px; color:#64748b;">Type</th>
                    <th style="padding:8px 6px; color:#64748b;">Amount</th>
                    <th style="padding:8px 6px; color:#64748b;">Before</th>
                    <th style="padding:8px 6px; color:#64748b;">After</th>
                    <th style="padding:8px 6px; color:#64748b;">Status</th>
                    <th style="padding:8px 6px; color:#64748b;">Ref</th>
                </tr>
            </thead><tbody>`;

        txns.forEach(tx => {
            const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'N/A';
            const isCredit = (tx.type || '').toLowerCase().includes('credit') || (tx.type || '').toLowerCase().includes('fund');
            const amtColor = isCredit ? '#10b981' : '#ef4444';
            const amtPrefix = isCredit ? '+' : '-';

            const statusColors = {
                'Completed': '#10b981', 'completed': '#10b981',
                'Pending': '#f59e0b', 'pending': '#f59e0b',
                'Failed': '#ef4444', 'failed': '#ef4444',
            };
            const sColor = statusColors[tx.status] || '#64748b';

            html += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px 6px; white-space:nowrap;">${date}</td>
                <td style="padding:8px 6px;">${tx.type || 'N/A'}</td>
                <td style="padding:8px 6px; color:${amtColor}; font-weight:700;">${amtPrefix}₵${parseFloat(tx.amount || 0).toFixed(2)}</td>
                <td style="padding:8px 6px;">₵${parseFloat(tx.balance_before || 0).toFixed(2)}</td>
                <td style="padding:8px 6px;">₵${parseFloat(tx.balance_after || 0).toFixed(2)}</td>
                <td style="padding:8px 6px;"><span style="padding:2px 8px; border-radius:8px; font-size:10px; font-weight:700; background:${sColor}15; color:${sColor};">${tx.status || 'N/A'}</span></td>
                <td style="padding:8px 6px; font-size:10px; color:#94a3b8;">${tx.reference || '—'}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        document.getElementById('txModalBody').innerHTML = html;

    } catch(e) {
        document.getElementById('txModalBody').innerHTML = `<p style="color:#ef4444;">Error: ${e.message}</p>`;
    }
}

function closeTxModal() {
    document.getElementById('txModal').style.display = 'none';
}

// ==========================================


// ==========================================
// PROFIT CALCULATOR & ANALYTICS
// ==========================================
const defaultGbSizes = [1, 2, 3, 5, 10, 15, 20];
const networkMeta = {
    mtn:     { icon: '🟡', label: 'MTN',       border: '#fcd34d', bg: '#fef9c3', text: '#854d0e' },
    telecel: { icon: '🔴', label: 'Telecel',    border: '#f87171', bg: '#fef2f2', text: '#991b1b' },
    tigo:    { icon: '🔵', label: 'AirtelTigo',  border: '#60a5fa', bg: '#eff6ff', text: '#1e40af' },
    bigtime: { icon: '🟣', label: 'Bigtime',     border: '#a78bfa', bg: '#f5f3ff', text: '#6b21a8' }
};

// Structure: { mtn: { "1": 2.50, "2": 4.80, ... }, telecel: {...}, ... }
let profitBaseCosts = { mtn: {}, telecel: {}, tigo: {}, bigtime: {} };
let profitReportData = [];
let activeBaseCostNetwork = 'mtn';

async function loadProfitReport() {
    try {
        const { data } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'profit_base_costs_v2')
            .single();
        if (data && data.value) {
            const costs = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            profitBaseCosts = { mtn: {}, telecel: {}, tigo: {}, bigtime: {}, ...costs };
        }
    } catch(e) { console.log('No saved base costs found.'); }
    showBaseCostPanel('mtn');
}

function showBaseCostPanel(network) {
    activeBaseCostNetwork = network;
    const meta = networkMeta[network];
    const container = document.getElementById('baseCostFields');
    const label = document.getElementById('baseCostNetLabel');
    label.textContent = `${meta.icon} ${meta.label} — Base Costs per GB Size`;

    // Style the active tab
    document.querySelectorAll('.base-cost-tab').forEach(btn => {
        btn.style.border = '2px solid #e2e8f0';
        btn.style.background = 'white';
        btn.style.color = '#64748b';
    });
    const activeBtn = document.getElementById('bcTab_' + network);
    activeBtn.style.border = `2px solid ${meta.border}`;
    activeBtn.style.background = meta.bg;
    activeBtn.style.color = meta.text;

    // Determine GB sizes to show (merged default + any custom ones already saved)
    const savedSizes = Object.keys(profitBaseCosts[network] || {}).map(Number);
    const allSizes = [...new Set([...defaultGbSizes, ...savedSizes])].sort((a, b) => a - b);

    container.innerHTML = '';
    allSizes.forEach(gb => {
        const val = profitBaseCosts[network]?.[String(gb)] || '';
        container.innerHTML += `
            <div style="text-align:center;">
                <label style="font-size:12px; font-weight:700; color:${meta.text}; display:block; margin-bottom:4px;">${gb} GB</label>
                <input type="number" class="admin-input bc-input" data-gb="${gb}" step="0.01" placeholder="₵0.00" value="${val}" style="width:100%; text-align:center; font-weight:600;">
            </div>`;
    });
}

function addCustomGbSize() {
    const gb = prompt('Enter custom GB size (e.g. 25):');
    if (!gb || isNaN(gb) || parseFloat(gb) <= 0) return;
    const gbNum = parseFloat(gb);
    // Add to the current network and re-render
    if (!profitBaseCosts[activeBaseCostNetwork]) profitBaseCosts[activeBaseCostNetwork] = {};
    if (!profitBaseCosts[activeBaseCostNetwork][String(gbNum)]) {
        profitBaseCosts[activeBaseCostNetwork][String(gbNum)] = 0;
    }
    showBaseCostPanel(activeBaseCostNetwork);
}

async function saveBaseCosts() {
    // Read all current inputs for the active network
    const inputs = document.querySelectorAll('#baseCostFields .bc-input');
    if (!profitBaseCosts[activeBaseCostNetwork]) profitBaseCosts[activeBaseCostNetwork] = {};
    inputs.forEach(inp => {
        const gb = inp.dataset.gb;
        const val = parseFloat(inp.value) || 0;
        profitBaseCosts[activeBaseCostNetwork][gb] = val;
    });

    try {
        const { error } = await supabase.from('system_config').upsert({
            key: 'profit_base_costs_v2', value: profitBaseCosts, updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
        if (error) throw error;
        alert(`✅ ${networkMeta[activeBaseCostNetwork].label} base costs saved!`);
    } catch(e) { alert('Failed to save: ' + e.message); }
}

function getBaseCost(network, volume) {
    const net = network.toLowerCase();
    let key = 'mtn';
    if (net.includes('mtn')) key = 'mtn';
    else if (net.includes('telecel') || net.includes('vodafone')) key = 'telecel';
    else if (net.includes('tigo') || net.includes('airtel')) key = 'tigo';
    else if (net.includes('big')) key = 'bigtime';

    const costs = profitBaseCosts[key] || {};
    // Exact match first
    if (costs[String(volume)] !== undefined) return costs[String(volume)];
    // Fallback: find nearest lower GB size
    const sizes = Object.keys(costs).map(Number).sort((a, b) => a - b);
    let nearest = 0;
    for (const s of sizes) { if (s <= volume) nearest = costs[String(s)]; }
    return nearest || 0;
}

async function generateProfitReport() {
    const dateFrom = document.getElementById('profitDateFrom').value;
    const dateTo = document.getElementById('profitDateTo').value;
    const productFilter = document.getElementById('profitProduct').value;
    const roleFilter = document.getElementById('profitRole').value;
    const tbody = document.getElementById('profitTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="state-msg">Crunching numbers...</td></tr>';

    try {
        let query = supabase.from('orders').select('*, users!inner(role), wholesale_cost').eq('status', 'true');
        if (dateFrom) query = query.gte('created_at', dateFrom + 'T00:00:00');
        if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');
        if (productFilter) query = query.eq('network', productFilter);
        if (roleFilter) query = query.eq('users.role', roleFilter);
        query = query.order('created_at', { ascending: false });

        const { data: orders, error } = await query;
        if (error) throw error;

        if (!orders || orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="state-msg">No completed orders found for selected filters.</td></tr>';
            resetProfitCounters();
            return;
        }

        profitReportData = [];
        let totalProfit = 0;
        const pp = { MTN:{p:0,c:0}, Telecel:{p:0,c:0}, AirtelTigo:{p:0,c:0}, Bigtime:{p:0,c:0} };
        const rp = { client:0, vip_customer:0, elite_agent:0, super_agent:0 };
        tbody.innerHTML = '';

        const fullAsc = [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        orders.forEach(order => {
            const dateStr = new Date(order.created_at).toLocaleDateString();
            const network = order.network || '-';
            const volumeStr = order.plan || order.bundle || '0';
            // Extract numeric value from "10GB" or "1.5 GB"
            const volumeNum = parseFloat(volumeStr.toString().replace(/[^0-9.]/g, '')) || 0;
            const role = order.users?.role || 'client';
            const charged = parseFloat(order.amount || 0);
            const baseCost = order.wholesale_cost ? parseFloat(order.wholesale_cost) : getBaseCost(network, volumeNum);
            const netProfit = parseFloat((charged - baseCost).toFixed(2));
            totalProfit += netProfit;

            const sequenceNum = fullAsc.findIndex(item => item.id === order.id) + 1;

            const net = network.toLowerCase(); 
            if (net.includes('mtn')) { pp.MTN.p += netProfit; pp.MTN.c++; }
            else if (net.includes('telecel') || net.includes('vodafone')) { pp.Telecel.p += netProfit; pp.Telecel.c++; }
            else if (net.includes('tigo') || net.includes('airtel')) { pp.AirtelTigo.p += netProfit; pp.AirtelTigo.c++; }
            else if (net.includes('big')) { pp.Bigtime.p += netProfit; pp.Bigtime.c++; }

            if (rp.hasOwnProperty(role)) rp[role] += netProfit;

            let nb = 'background:#f1f5f9; color:#475569;';
            if (net.includes('mtn')) nb = 'background:#fef08a; color:#854d0e;';
            else if (net.includes('telecel')) nb = 'background:#fecaca; color:#991b1b;';
            else if (net.includes('tigo') || net.includes('airtel')) nb = 'background:#bfdbfe; color:#1e40af;';
            else if (net.includes('big')) nb = 'background:#e9d5ff; color:#6b21a8;';

            const pc = netProfit >= 0 ? '#059669' : '#dc2626';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="color:#64748b;">${dateStr}</td>
                <td style="font-weight:600; color:#475569;">${getFriendlyRef(order, sequenceNum)}</td>
                <td><span style="padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600; ${nb}">${network}</span></td>
                <td style="font-weight:600;">${(volumeStr || order.plan || '-').toString().includes('GB') ? (volumeStr || order.plan) : (volumeStr || order.plan) + ' GB'}</td>
                <td><span style="padding:3px 8px; border-radius:6px; font-size:11px; font-weight:600; background:#f1f5f9; color:#475569; text-transform:capitalize;">${role.replace(/_/g, ' ')}</span></td>
                <td style="font-weight:600;">₵${charged.toFixed(2)}</td>
                <td style="color:#64748b;">₵${baseCost.toFixed(2)}</td>
                <td style="font-weight:700; color:${pc};">₵${netProfit.toFixed(2)}</td>`;
            tbody.appendChild(tr);
            profitReportData.push({ date: dateStr, id: getFriendlyRef(order, sequenceNum), network, volume: volumeStr, role, charged, baseCost, netProfit });
        });

        document.getElementById('totalProfitCounter').textContent = `₵${totalProfit.toFixed(2)}`;
        document.getElementById('totalProfitCounter').style.color = totalProfit >= 0 ? '#059669' : '#dc2626';
        document.getElementById('profit_mtn').textContent = `₵${pp.MTN.p.toFixed(2)}`;
        document.getElementById('profit_mtn_orders').textContent = pp.MTN.c;
        document.getElementById('profit_telecel').textContent = `₵${pp.Telecel.p.toFixed(2)}`;
        document.getElementById('profit_telecel_orders').textContent = pp.Telecel.c;
        document.getElementById('profit_tigo').textContent = `₵${pp.AirtelTigo.p.toFixed(2)}`;
        document.getElementById('profit_tigo_orders').textContent = pp.AirtelTigo.c;
        document.getElementById('profit_bigtime').textContent = `₵${pp.Bigtime.p.toFixed(2)}`;
        document.getElementById('profit_bigtime_orders').textContent = pp.Bigtime.c;
        document.getElementById('profit_role_client').textContent = `₵${rp.client.toFixed(2)}`;
        document.getElementById('profit_role_vip').textContent = `₵${rp.vip_customer.toFixed(2)}`;
        document.getElementById('profit_role_elite').textContent = `₵${rp.elite_agent.toFixed(2)}`;
        document.getElementById('profit_role_super').textContent = `₵${rp.super_agent.toFixed(2)}`;

    } catch(e) {
        console.error('Profit report error:', e);
        tbody.innerHTML = `<tr><td colspan="8" class="state-msg" style="color:#dc2626;">Error: ${e.message}</td></tr>`;
    }
}

function resetProfitCounters() {
    document.getElementById('totalProfitCounter').textContent = '₵0.00';
    ['profit_mtn','profit_telecel','profit_tigo','profit_bigtime','profit_role_client','profit_role_vip','profit_role_elite','profit_role_super'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '₵0.00';
    });
    ['profit_mtn_orders','profit_telecel_orders','profit_tigo_orders','profit_bigtime_orders'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '0';
    });
}

function downloadProfitCSV() {
    if (!profitReportData.length) { alert('Run the analytics report first.'); return; }
    const headers = ['Date','Id','Product','GB Size','Role','Charged','Base Cost','Net Profit'];
    const rows = profitReportData.map(r => [r.date, r.id, r.network, r.volume, r.role, r.charged, r.baseCost, r.netProfit]);
    let csv = headers.join(',') + '\n';
    rows.forEach(row => { csv += row.join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function getStatusBadge(status) {
    const s = String(status).toLowerCase();
    
    // Default palette
    let bg = '#f1f5f9';
    let text = '#475569';
    let dot = '#94a3b8';
    let label = s.toUpperCase();

    if (s === 'true' || s === 'completed') {
        bg = '#d1fae5'; text = '#059669'; dot = '#10b981'; label = 'COMPLETED';
    } else if (s === 'received') {
        bg = '#cffafe'; text = '#0e7490'; dot = '#06b6d4'; label = 'RECEIVED';
    } else if (s === 'false' || s === 'pending' || s === 'scheduled' || s === 'waiting') {
        bg = '#fee2e2'; text = '#dc2626'; dot = '#ef4444'; label = s === 'false' ? 'PENDING' : s.toUpperCase();
    } else if (s === 'processing') {
        bg = '#dbeafe'; text = '#1e40af'; dot = '#2563eb'; label = 'PROCESSING';
    } else if (s.includes('transit')) {
        bg = '#ede9fe'; text = '#5b21b6'; dot = '#8b5cf6'; label = 'IN TRANSIT';
    } else if (s === 'refund' || s === 'refunded') {
        bg = '#fef3c7'; text = '#92400e'; dot = '#f59e0b'; label = 'REFUNDED';
    } else if (s === 'undelivered' || s === 'failed' || s === 'cancelled' || s === 'cancel') {
        bg = '#fecaca'; text = '#991b1b'; dot = '#dc2626'; label = s.toUpperCase();
    }

    return `<span class="status-badge" style="background:${bg}; color:${text}; border:1px solid rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                <span class="status-dot" style="background:${dot}; width: 6px; height: 6px; border-radius: 50%;"></span>${label}
            </span>`;
}

function getFriendlyRef(order, sequenceNum) {
    const prefix = (order.network || 'ORD').toUpperCase();
    if (sequenceNum) return `${prefix}-${sequenceNum}`;

    // Fallback: Check which table it belongs to (this is a bit hacky but works for filters)
    let list = [];
    if (order.hasOwnProperty('scheduled_at')) {
        list = allSchedAdmin;
    } else {
        list = allOrders;
    }
    
    const fullAsc = [...list].sort((a, b) => new Date(a.created_at || a.scheduled_at) - new Date(b.created_at || b.scheduled_at));
    const num = fullAsc.findIndex(item => item.id === order.id) + 1;
    return `${prefix}-${num || '?'}`;
}



// ==========================================
// TAB: STORE MANAGEMENT
// ==========================================
async function loadStoresAdmin() {
    const tbody = document.getElementById('storesAdminBody');
    const counter = document.getElementById('storeTotalCounter');
    if (!tbody || !counter) return;

    tbody.innerHTML = '<tr><td colspan="5" class="state-msg">Syncing storefront data...</td></tr>';

    try {
        // Fetch users who have a store configured
        const { data: stores, error } = await supabase
            .from('users')
            .select('id, email, first_name, last_name, store_name, store_slug, store_active, store_description, whatsapp_number')
            .not('store_slug', 'is', null)
            .order('store_name', { ascending: true });

        if (error) throw error;

        counter.innerText = `${stores ? stores.length : 0} Global Stores`;

        if (!stores || stores.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="state-msg">No agent storefronts found.</td></tr>';
            return;
        }

        let html = '';
        stores.forEach(s => {
            const agentName = `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'No Name';
            const statusLabel = s.store_active ? 
                `<span class="status-badge" style="background:#d1fae5; color:#059669; border:1px solid rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><span class="status-dot" style="background:#10b981; width: 6px; height: 6px; border-radius: 50%;"></span>PUBLIC</span>` : 
                `<span class="status-badge" style="background:#fee2e2; color:#dc2626; border:1px solid rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><span class="status-dot" style="background:#ef4444; width: 6px; height: 6px; border-radius: 50%;"></span>HIDDEN</span>`;
            
            const toggleBtn = s.store_active ? 
                `<button onclick="toggleStoreStatus('${s.id}', true)" class="action-btn btn-reject" style="background:#ef4444; padding:6px 12px; font-size:11px;">Deactivate Hub</button>` : 
                `<button onclick="toggleStoreStatus('${s.id}', false)" class="action-btn btn-approve" style="background:#10b981; padding:6px 12px; font-size:11px;">Activate Hub</button>`;

            html += `
                <tr>
                    <td>
                        <div style="font-weight:700; color:#0f172a;">${agentName}</div>
                        <div style="font-size:11px; color:#64748b;">${s.email}</div>
                    </td>
                    <td>
                        <div style="font-weight:600; color:#4f46e5;">${s.store_name || 'Unnamed Store'}</div>
                        <code style="font-size:10px; background:#f1f5f9; padding:2px 4px; border-radius:4px;">/${s.store_slug}</code>
                    </td>
                    <td>${statusLabel}</td>
                    <td>
                        <div style="font-size:11px; color:#475569;">WhatsApp: ${s.whatsapp_number || '—'}</div>
                        <div style="font-size:10px; color:#94a3b8; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.store_description || 'No description'}</div>
                    </td>
                    <td>
                        ${toggleBtn}
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;

    } catch (err) {
        console.error("Store load error:", err);
        tbody.innerHTML = '<tr><td colspan="5" class="state-msg" style="color:red;">Failed to sync data.</td></tr>';
    }
}

async function toggleStoreStatus(userId, currentStatus) {
    const action = currentStatus ? "DEACTIVATE" : "ACTIVATE";
    if (!confirm(`Are you sure you want to ${action} this storefront?`)) return;

    try {
        const { error } = await supabase
            .from('users')
            .update({ store_active: !currentStatus })
            .eq('id', userId);

        if (error) throw error;
        
        loadStoresAdmin();
    } catch (err) {
        alert("Operation failed: " + err.message);
    }
}
