(() => {
    "use strict";

    const loginForm = document.getElementById("login-form");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginError = document.getElementById("login-error");
    const activationPanel = document.getElementById("activation-panel");
    const activationForm = document.getElementById("activation-form");
    const activationError = document.getElementById("activation-error");
    const loginHelp = document.getElementById("login-help");
    let remoteClient = null;

    function showActivation() {
        loginForm.hidden = true;
        loginHelp.hidden = true;
        activationPanel.hidden = false;
        document.getElementById("new-password").focus();
    }

    async function checkExistingRemoteSession() {
        try {
            remoteClient = await window.UmarPortalAuth.getClient();
            const { data: { session } } = await remoteClient.auth.getSession();
            if (!session) return;
            const { data: profiles, error } = await remoteClient.rpc("current_account_profile");
            const profile = profiles?.[0];
            if (error || !profile) throw error || new Error("The school account profile is missing.");
            if (profile.status === "pending" && profile.temporary_password_expires_at) showActivation();
            else if (profile.status === "pending") {
                await remoteClient.auth.signOut();
                window.location.replace("account-pending.html");
            } else if (profile.status === "active") {
                window.location.replace("calculator.html");
            } else {
                await remoteClient.auth.signOut();
                loginError.textContent = "This account is suspended or inactive. Contact the school office.";
            }
        } catch (error) {
            console.error("Could not verify the current school account.", error);
            loginError.textContent = "Could not verify your account. Please try again.";
        }
    }

    async function remoteSignIn(username, password) {
        if (!remoteClient) remoteClient = await window.UmarPortalAuth.getClient();
        const identifier = username.trim().toLowerCase();
        let email = identifier;
        if (!identifier.includes("@")) {
            const domain = window.UmarPortalAuth.accountEmailDomain;
            if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
                throw new Error("The school account email domain is not configured correctly.");
            }
            email = `${identifier}@${domain}`;
        }
        const { data, error } = await remoteClient.auth.signInWithPassword({
            email,
            password
        });
        if (error || !data.user) throw new Error("The username or password is incorrect.");
        const { data: profiles, error: profileError } = await remoteClient.rpc("current_account_profile");
        const profile = profiles?.[0];
        if (profileError || !profile) throw new Error("The school account profile could not be verified.");
        if (profile.status === "pending") {
            if (!profile.temporary_password_expires_at) {
                await remoteClient.auth.signOut();
                window.location.assign("account-pending.html");
                return;
            }
            if (new Date(profile.temporary_password_expires_at) <= new Date()) {
                await remoteClient.auth.signOut();
                throw new Error("The temporary password has expired. Ask the school administrator to reset it.");
            }
            showActivation();
            return;
        }
        if (profile.status !== "active") {
            await remoteClient.auth.signOut();
            throw new Error("This account is suspended or inactive. Contact the school office.");
        }
        window.location.assign("calculator.html");
    }

    if (!window.UmarPortalAuth?.configured) {
        loginForm.querySelectorAll("input, button").forEach((control) => {
            control.disabled = true;
        });
        activationForm.querySelectorAll("input, button").forEach((control) => {
            control.disabled = true;
        });
        loginHelp.textContent = "Secure sign-in is unavailable until the school portal is configured. Contact the portal administrator.";
        activationPanel.hidden = true;
        return;
    }

    checkExistingRemoteSession();

    activationForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        activationError.textContent = "";
        const password = document.getElementById("new-password").value;
        const confirmation = document.getElementById("confirm-password").value;
        if (password.length < 12) {
            activationError.textContent = "Choose a password with at least 12 characters.";
            return;
        }
        if (password !== confirmation) {
            activationError.textContent = "The password confirmation does not match.";
            return;
        }
        try {
            const { data, error } = await remoteClient.functions.invoke("activate-account", {
                body: { new_password: password, confirm_password: confirmation }
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            window.location.replace("calculator.html");
        } catch (error) {
            console.error("Account activation failed.", error);
            activationError.textContent = error.message || "Account activation failed. Ask an administrator to issue a new temporary password.";
        }
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        loginError.textContent = "";
        try {
            await remoteSignIn(usernameInput.value.trim(), passwordInput.value);
        } catch (error) {
            console.error("Login could not be completed.", error);
            loginError.textContent = error.message || "Sign-in could not be completed. Please try again.";
        }
    });

    loginForm.addEventListener("input", () => {
        loginError.textContent = "";
        usernameInput.removeAttribute("aria-invalid");
        passwordInput.removeAttribute("aria-invalid");
    });
})();
