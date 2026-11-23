(() => {
    "use strict";

    if (!window.UmarPortalAuth?.configured) {
        window.location.replace("index.html");
        return;
    }

    import("./secure-portal.js?v=20261119b")
        .then(({ startSecurePortal }) => startSecurePortal())
        .catch((error) => {
            console.error("Could not start the secure school portal.", error);
            const content = document.getElementById("portal-content");
            if (!content) return;

            content.innerHTML = `<header class="page-heading"><p>PORTAL</p><h1>Unable to start school portal</h1></header>
                <section class="panel"><p class="empty-state" id="portal-startup-error"></p></section>`;
            content.querySelector("#portal-startup-error").textContent =
                error?.message || "Please try again later or contact the school office.";
        });
})();
