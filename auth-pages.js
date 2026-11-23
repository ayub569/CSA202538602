(function () {
    "use strict";

    const page = document.body.dataset.page || "";

    if (page === "account-pending" || page === "account-suspended") {
        const statusMessage = document.querySelector("#status-message");
        const status = new URLSearchParams(window.location.search).get("status");
        if (statusMessage && status === "pending") {
            statusMessage.textContent = "Your account is awaiting approval. Check back later or contact the school office.";
        } else if (statusMessage && status === "suspended") {
            statusMessage.textContent = "This account has been suspended. To regain access, contact the school office.";
        }
    }

})();
