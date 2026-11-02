const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const username = usernameInput.value.trim();
    if (!username) {
        loginError.textContent = "Please enter your username.";
        usernameInput.setAttribute("aria-invalid", "true");
        usernameInput.focus();
        return;
    }

    sessionStorage.setItem("umarPortalUsername", username);
    sessionStorage.setItem("umarPortalAuthenticated", "true");
    window.location.href = "calculator.html";
});

loginForm.addEventListener("input", () => {
    loginError.textContent = "";
    usernameInput.removeAttribute("aria-invalid");
    passwordInput.removeAttribute("aria-invalid");
});
