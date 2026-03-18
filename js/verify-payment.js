// ==========================================
// PAYSTACK VERIFICATION LOGIC
// ==========================================

async function startVerification() {
    const ref = document.getElementById('paystackRef').value.trim();
    const btn = document.getElementById('verifyBtn');

    if (!ref) {
        alert("Please enter your Paystack reference number.");
        return;
    }

    // Confirmation if user is sure
    if (!confirm("Are you sure you want to verify this reference? False or manipulative attempts will result in account suspension.")) {
        return;
    }

    try {
        btn.disabled = true;
        btn.innerText = "Creating order...";

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            alert("Your session has expired. Please login again.");
            window.location.href = "login.html";
            return;
        }

        // 1. Generate unique order reference
        const orderReference = 'WFO_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9).toUpperCase();
        
        // 2. Create wallet funding order with PENDING status in database
        const { data: orderData, error: orderError } = await supabase
            .from('wallet_funding_orders')
            .insert({
                user_id: session.user.id,
                reference: orderReference,
                paystack_reference: ref,
                status: 'pending',
                currency: 'GHS'
            })
            .select()
            .single();

        if (orderError || !orderData) {
            throw new Error('Failed to create funding order: ' + (orderError?.message || 'Unknown error'));
        }

        btn.innerText = "Verifying with Paystack...";

        // 3. Call the Edge Function to verify payment
        const { data, error } = await supabase.functions.invoke('verify-paystack', {
            body: { 
                reference: ref,
                order_id: orderData.id,
                order_reference: orderReference
            }
        });

        if (error) {
            // Attempt to extract detailed error from the response body if it's a function error
            let detailedMsg = error.message;
            try {
                const body = await error.context?.json();
                if (body && body.error) detailedMsg = body.error;
            } catch(e) {}
            throw new Error(detailedMsg || "Failed to communicate with verification server.");
        }

        if (data && data.error) {
            // Handle different error scenarios
            btn.disabled = false;
            btn.innerText = "Verify & Credit Wallet";
            
            // Check if payment was already credited
            if (data.error.includes("already been verified") || data.error.includes("already processed")) {
                // This payment was already credited - show warning instead of error
                if(window.showWarningPopup) {
                    window.showWarningPopup("Payment Already Credited", 
                        "✓ This payment reference has already been verified and credited to your wallet. Your balance should be updated.");
                } else {
                    alert("⚠️ Payment Already Credited:\n" + data.error);
                }
            } else {
                // Other errors - show as verification failure
                if(window.showErrorPopup) {
                    window.showErrorPopup("Verification Failed", data.error);
                } else {
                    alert("Verification Failed: " + data.error);
                }
            }
            return;
        }

        // Success!
        if (data.success) {
            if(window.showSuccessPopup) {
                window.showSuccessPopup("Wallet Funded!", 
                    data.message + "\n\nOrder Reference: " + (data.order_reference || 'N/A'), 
                    () => {
                        window.location.href = "wallet.html";
                    });
            } else {
                alert("✅ Success! " + data.message + "\n\nOrder Reference: " + (data.order_reference || 'N/A'));
                window.location.href = "wallet.html";
            }
        }

    } catch (err) {
        console.error("Verification Error:", err);
        if(window.showErrorPopup) {
            window.showErrorPopup("Unexpected Error", err.message);
        } else {
            alert("An unexpected error occurred: " + err.message);
        }
        btn.disabled = false;
        btn.innerText = "Verify & Credit Wallet";
    }
}
