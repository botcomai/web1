let currentUser = null;
let allRates = [];

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Check Auth
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    currentUser = user;

    // 2. Initial Load
    fetchCommissionSummary();
    fetchCommissionHistory();
    fetchCommissionRates();
});

// 0. Fetch and Render Rates
async function fetchCommissionRates() {
    try {
        const { data, error } = await window.supabase
            .from('commission_rates')
            .select('*')
            .order('amount', { ascending: true });
        
        if (error) throw error;
        allRates = data;
        
        // Initial render (MTN)
        renderRates('MTN');
        
    } catch (err) {
        console.error("Rates fetch error:", err);
    }
}

window.renderRates = function(network) {
    const container = document.getElementById('ratesDisplay');
    const filtered = allRates.filter(r => r.network.toUpperCase() === network.toUpperCase());
    
    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">No rates found for ${network}.</div>`;
        return;
    }
    
    let html = '';
    filtered.forEach(r => {
        html += `
            <div class="rate-item">
                <div class="rate-info">
                    <div class="gb">${r.gb_size}</div>
                    <div class="network-name">${r.network}</div>
                </div>
                <div class="rate-value">GH₵${r.amount.toFixed(2)}</div>
            </div>
        `;
    });
    container.innerHTML = html;
};

// 1. Fetch Summary Data
async function fetchCommissionSummary() {
    try {
        const { data: userData, error: userError } = await window.supabase
            .from('users')
            .select('commission_balance')
            .eq('id', currentUser.id)
            .single();

        if (userError) throw userError;
        
        document.getElementById('commBalance').innerText = userData.commission_balance.toFixed(2);

        const { data: transactions, error: txError } = await window.supabase
            .from('commission_transactions')
            .select('amount, type')
            .eq('user_id', currentUser.id);

        if (txError) throw txError;

        let totalEarned = 0;
        let totalWithdrawn = 0;

        transactions.forEach(t => {
            if (t.type === 'earned') totalEarned += Number(t.amount);
            if (t.type === 'withdrawn') totalWithdrawn += Number(t.amount);
        });

        document.getElementById('totalEarned').innerText = `₵${totalEarned.toFixed(2)}`;
        document.getElementById('totalWithdrawn').innerText = `₵${totalWithdrawn.toFixed(2)}`;

        const { data: pending, error: pendError } = await window.supabase
            .from('withdrawal_requests')
            .select('amount')
            .eq('user_id', currentUser.id)
            .eq('status', 'pending');

        if (pendError) throw pendError;

        const totalPending = pending.reduce((sum, r) => sum + Number(r.amount), 0);
        document.getElementById('pendingWithdrawals').innerText = `₵${totalPending.toFixed(2)}`;

    } catch (err) {
        console.error("Summary load error:", err);
    }
}

// 2. Fetch Transaction History
async function fetchCommissionHistory() {
    const historyBody = document.getElementById('historyBody');
    
    try {
        const { data, error } = await window.supabase
            .from('commission_transactions')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (data.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:#94a3b8;">No movements found yet.</td></tr>';
            return;
        }

        let html = '';
        data.forEach(t => {
            const dateStr = new Date(t.created_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const typeClass = t.type === 'earned' ? 'type-earned' : 'type-withdrawn';
            
            html += `
                <tr>
                    <td style="color:#64748b; font-size:13px;">${dateStr}</td>
                    <td style="font-weight:500;">${t.description || 'System Credit'}</td>
                    <td><span class="type-pill ${typeClass}">${t.type}</span></td>
                    <td style="font-weight:700; color:${t.type === 'earned' ? 'var(--success)' : '#dc2626'}">
                        ${t.type === 'earned' ? '+' : '-'}₵${t.amount.toFixed(2)}
                    </td>
                </tr>
            `;
        });
        historyBody.innerHTML = html;

    } catch (err) {
        console.error("History load error:", err);
        historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Failed to load history.</td></tr>';
    }
}

// 3. Handle Withdrawal Submission
document.getElementById('withdrawalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const method = document.getElementById('withdrawMethod').value;
    const amount = Number(document.getElementById('withdrawAmount').value);
    const momoNumber = document.getElementById('momoNumber').value;
    const btn = document.getElementById('withdrawBtn');

    if (amount < 50) {
        alert("Minimum withdrawal is ₵50.00");
        return;
    }

    const currentBal = Number(document.getElementById('commBalance').innerText);
    if (amount > currentBal) {
        alert("Insufficient commission balance.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Processing...`;

    try {
        if (method === 'wallet') {
            const { data, error } = await window.supabase
                .rpc('withdraw_commission_to_wallet', { amount_to_withdraw: amount });

            if (error) throw error;
            alert("Success! GH₵" + amount.toFixed(2) + " has been added to your wallet.");
        } else {
            const { data: request, error: reqError } = await window.supabase
                .from('withdrawal_requests')
                .insert({
                    user_id: currentUser.id,
                    amount: amount,
                    method: 'momo',
                    momo_number: momoNumber,
                    status: 'pending'
                });

            if (reqError) throw reqError;

            const { error: balError } = await window.supabase
                .from('users')
                .update({ commission_balance: currentBal - amount })
                .eq('id', currentUser.id);

            if (balError) throw balError;

            alert("Withdrawal request submitted! Processing usually takes less than 24 hours.");
        }

        fetchCommissionSummary();
        fetchCommissionHistory();
        document.getElementById('withdrawalForm').reset();
        document.getElementById('momoFields').style.display = 'none';

    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Confirm Withdrawal";
    }
});
