// ==========================================
// PAYMENT GATEWAY SETTINGS (loaded from DB)
// ==========================================
let paystackPublicKey = '';
let paystackEnabled = false; // default to false until loaded
let manualEnabled = false;   // default to false until loaded
let manualMomoNumber = '';
let manualMomoName = '';
let currentPaymentMethod = 'paystack'; // Track method here centrally

async function loadPaymentSettings() {
  try {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['paystack_public_key', 'paystack_enabled', 'manual_transfer_enabled', 'manual_momo_number', 'manual_momo_name']);

    if (settings) {
      settings.forEach(s => {
        if (s.key === 'paystack_public_key') paystackPublicKey = s.value;
        if (s.key === 'paystack_enabled') paystackEnabled = s.value === 'true';
        if (s.key === 'manual_transfer_enabled') manualEnabled = s.value === 'true';
        if (s.key === 'manual_momo_number') manualMomoNumber = s.value;
        if (s.key === 'manual_momo_name') manualMomoName = s.value;
      });
    }

    // Update DOM elements with latest dynamic settings
    const momoNumInline = document.getElementById("momoNumberInline");
    const momoNameInline = document.getElementById("momoNameInline");
    if (momoNumInline) momoNumInline.innerText = manualMomoNumber || '---';
    if (momoNameInline) momoNameInline.innerText = manualMomoName || '---';

    // Hide/disable payment methods based on settings
    const paystackOpt = document.getElementById('optPaystack');
    const manualOpt = document.getElementById('optManual');

    if (!paystackEnabled && paystackOpt) {
      paystackOpt.style.opacity = '0.4';
      paystackOpt.style.pointerEvents = 'none';
      paystackOpt.innerHTML = '<h4>Paystack</h4><p style="color:#ef4444; font-weight:600;">Currently unavailable</p>';
      // If paystack is default but disabled, switch to manual
      if (manualEnabled) {
        selectMethod('manual');
      }
    }

    if (!manualEnabled && manualOpt) {
      manualOpt.style.opacity = '0.4';
      manualOpt.style.pointerEvents = 'none';
      manualOpt.innerHTML = '<h4>Manual Transfer (Agent)</h4><p style="color:#ef4444; font-weight:600;">Currently unavailable</p>';
    }

    if (!paystackEnabled && !manualEnabled) {
      const fundBtn = document.getElementById('fundBtn');
      if (fundBtn) {
        fundBtn.disabled = true;
        fundBtn.innerText = 'All payment methods are currently disabled';
        fundBtn.style.background = '#94a3b8';
      }
    }

  } catch(e) {
    console.error('Failed to load payment settings:', e);
  }
}

document.addEventListener('DOMContentLoaded', loadPaymentSettings);


async function payWithPaystack(){
  if (!paystackEnabled) {
    alert('Paystack payments are currently disabled. Please use another payment method.');
    return;
  }
  if (!paystackPublicKey) {
    alert('Payment gateway is not configured. Please contact support.');
    return;
  }

  let amountInput = document.getElementById("amount").value;
  let amount = parseFloat(amountInput);

  if(isNaN(amount) || amount <= 0){
    alert("Enter valid amount");
    return;
  }

  // Pay exact amount entered by user (multiplied by 100 for PESEWAS)
  let paystackAmount = Math.round(amount * 100); 

  // 0. Get current user info for receipt
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return alert("You must be logged in to fund your wallet.");

  const paystack = new PaystackPop();
  paystack.newTransaction({
    key: paystackPublicKey,
    email: user.email, 
    amount: paystackAmount,
    currency: "GHS",
    metadata: {
      custom_fields: [
        { display_name: "User ID", variable_name: "user_id", value: user.id }
      ]
    },
    onSuccess: async function(response){
      // Show loading state
      if(window.showLoadingPopup) window.showLoadingPopup("Verifying Payment...");
      
      try {
        // CALL SECURE EDGE FUNCTION FOR VERIFICATION
        const { data, error } = await window.supabase.functions.invoke('verify-paystack', {
          body: { reference: response.reference }
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
          if(window.showErrorPopup) {
            window.showErrorPopup("Verification Failed", data.error);
          } else {
            alert("Verification Failed: " + data.error);
          }
          return;
        }

        if (data && data.success) {
          if(window.showSuccessPopup) {
            window.showSuccessPopup("Wallet Funded!", data.message, () => {
              window.location.reload();
            });
          } else {
            alert("✅ Success! " + data.message);
            window.location.reload();
          }
        }
      } catch (err) {
        console.error("Verification Error:", err);
        const errorMsg = err.message || "An unexpected error occurred during verification.";
        if(window.showErrorPopup) {
          window.showErrorPopup("Verification Error", errorMsg + "\n\nPlease use 'Verify Transaction' if your balance is not updated.");
        } else {
          alert("Verification Error: " + errorMsg);
        }
      }
    },
    onCancel: function(){
      alert("Transaction cancelled");
    }
  });
}

// Unified Router
function processFunding(){
  if(currentPaymentMethod === "paystack"){
    payWithPaystack();
  } else {
    submitManualRequest();
  }
}

// Method Selection Logic
function selectPaymentMethod(method){
  currentPaymentMethod = method;
  const optPaystack = document.getElementById("optPaystack");
  const optManual = document.getElementById("optManual");
  const manualDetails = document.getElementById("manualDetails");
  const refBox = document.getElementById("refBox");
  const fundBtn = document.getElementById("fundBtn");
  const feeBreakdown = document.getElementById("feeBreakdown");
  const amountInput = document.getElementById("amount");

  if(method === "paystack"){
    if(optPaystack) optPaystack.classList.add("selected-paystack");
    if(optManual) optManual.classList.remove("selected-manual");
    if(manualDetails) manualDetails.style.display = "none";
    if(refBox) refBox.style.display = "none";
    if(fundBtn) {
       fundBtn.innerText = "Fund with Paystack";
       fundBtn.style.background = "#2a7de1";
    }
    if(feeBreakdown) feeBreakdown.style.display = (amountInput && amountInput.value > 0) ? "block" : "none";
    calculateFundingFee();
  } else {
    if(optManual) optManual.classList.add("selected-manual");
    if(optPaystack) optPaystack.classList.remove("selected-paystack");
    if(feeBreakdown) feeBreakdown.style.display = "none";
    if(manualDetails) manualDetails.style.display = "block";
    if(refBox) refBox.style.display = "flex";
    if(fundBtn) {
      fundBtn.innerText = "Submit Manual Request";
      fundBtn.style.background = "#f39c12";
    }

    // Auto-generate reference for manual flow
    const refEl = document.getElementById("refId");
    if (refEl && !refEl.innerText) {
      let randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
      refEl.innerText = "D4G-" + randomChars;
    }
  }
}

// Fee Calculation Logic
function calculateFundingFee(){
  let amountInputObj = document.getElementById("amount");
  if(!amountInputObj) return;
  
  let amountVal = parseFloat(amountInputObj.value);
  const feeBreakdown = document.getElementById("feeBreakdown");
  
  if(isNaN(amountVal) || amountVal <= 0){
    if(feeBreakdown) feeBreakdown.style.display = "none";
    return;
  }
  
  if(currentPaymentMethod === "paystack"){
    if(feeBreakdown) feeBreakdown.style.display = "block";
    let fee = amountVal * 0.02;
    let netCredit = amountVal - fee;
    
    const baseEl = document.getElementById("baseAmount");
    const feeEl = document.getElementById("feeAmount");
    const totalEl = document.getElementById("totalAmount");
    
    if(baseEl) baseEl.innerText = "₵" + amountVal.toFixed(2);
    if(feeEl) feeEl.innerText = "- ₵" + fee.toFixed(2);
    if(totalEl) totalEl.innerText = "₵" + netCredit.toFixed(2);
  }
}

function prepareManualTransfer() {
  const amountInput = parseFloat(document.getElementById("amount").value);
  if(isNaN(amountInput) || amountInput <= 0) {
    alert("Please enter a valid amount first.");
    return;
  }

  // Generate Reference ID if not already set
  let refEl = document.getElementById("refId");
  if (refEl && !refEl.innerText) {
    let randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    refEl.innerText = "D4G-" + randomChars;
  }
  
  // Inject latest details from settings
  const momoNum = document.getElementById("momoNumberInline");
  const momoName = document.getElementById("momoNameInline");
  if (momoNum) momoNum.innerText = manualMomoNumber || '---';
  if (momoName) momoName.innerText = manualMomoName || '---';

  // Manual requests are finalized by the user clicking 'Submit Manual Request'
}

function closeManualModal() {
  // Keeping for compatibility with possible state resets
}

async function submitManualRequest() {
  let amount = parseFloat(document.getElementById("amount").value);
  let refId = document.getElementById("refId").innerText;

  if(isNaN(amount) || amount <= 0) {
    alert("Invalid amount.");
    return;
  }

  const submitBtn = document.getElementById("fundBtn") || document.getElementById("submitManualBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Submitting Request...";
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) {
      window.location.href = "login.html";
      return;
    }

    // Fetch user phone natively
    let { data: currUser } = await supabase
      .from("users")
      .select("phone")
      .eq("id", user.id)
      .single();

    // Insert pending transaction (balance remains untouched)
    const { error: insertError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        type: "Deposit (Manual)",
        amount: amount,
        status: "pending",
        reference: refId
      });

    if (insertError) throw insertError;

    // Dispatch SMS Notification
    if(window.sendSmsNotification && currUser?.phone) {
      window.sendSmsNotification(currUser.phone, `Your manual funding request of ₵${amount} with Ref: ${refId} is pending review by our agents.`);
    }

    closeManualModal();
    
    if(window.showSuccessPopup) {
      window.showSuccessPopup("Request Submitted!", "Your manual funding request has been submitted. We will process it shortly.", () => {
        window.location.reload();
      });
    } else {
      alert("Manual funding request submitted successfully! We will process it shortly.");
      window.location.reload();
    }
    
  } catch (err) {
    alert("Failed to submit request.");
    console.error(err);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "Submit Manual Request";
    }
  }
}

// Globalize all necessary functions
window.submitManualRequest = submitManualRequest;
window.processFunding = processFunding;
window.selectPaymentMethod = selectPaymentMethod;
window.calculateFundingFee = calculateFundingFee;
