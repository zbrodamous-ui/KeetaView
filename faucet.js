const form = document.getElementById("faucetInterestForm");
const addressInput = document.getElementById("faucetAddress");
const consentInput = document.getElementById("faucetConsent");
const submitButton = document.getElementById("faucetSubmit");
const feedback = document.getElementById("faucetFeedback");

form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!consentInput.checked) {
        feedback.textContent = "Please confirm the prototype terms before continuing.";
        feedback.dataset.state = "error";
        return;
    }

    submitButton.disabled = true;
    feedback.textContent = "Recording your interest…";
    feedback.dataset.state = "";

    try {
        const response = await fetch("/api/faucet/interest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                address: addressInput.value.trim(),
                consent: true
            })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "We couldn't record your interest.");
        }

        feedback.textContent = result.data?.message || "Your interest was recorded.";
        feedback.dataset.state = "success";
        form.reset();
    } catch (error) {
        feedback.textContent = error.message || "The request could not be completed. Please try again.";
        feedback.dataset.state = "error";
    } finally {
        submitButton.disabled = false;
    }
});
