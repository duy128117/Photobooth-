import { getCurrentUser, loginUser, registerUser, resendVerification, verifyUser } from "./modules/backend.js";
import { initializeTheme } from "./modules/theme.js";

const params = new URLSearchParams(window.location.search);
const nextUrl = sanitizeNext(params.get("next") || "/photobooth.html");
const requestedMode = params.get("mode") === "register" ? "register" : "login";

const elements = {
  heading: document.getElementById("auth-heading"),
  subcopy: document.getElementById("auth-subcopy"),
  form: document.getElementById("auth-form"),
  submit: document.getElementById("auth-submit"),
  status: document.getElementById("auth-status"),
  nameField: document.getElementById("name-field"),
  usernameField: document.getElementById("username-field"),
  confirmField: document.getElementById("confirm-field"),
  name: document.getElementById("auth-name"),
  username: document.getElementById("auth-username"),
  email: document.getElementById("auth-email"),
  password: document.getElementById("auth-password"),
  confirmPassword: document.getElementById("auth-confirm-password"),
  code: document.getElementById("auth-code"),
  tabs: document.querySelectorAll(".auth-tab"),
  backLink: document.getElementById("back-link"),
  note: document.getElementById("auth-note"),
  previewLink: document.getElementById("preview-link"),
  resendBtn: document.getElementById("resend-btn"),
  stepAccount: document.getElementById("auth-step-account"),
  stepCode: document.getElementById("auth-step-code"),
  steps: document.getElementById("auth-steps"),
  stepAccountBadge: document.getElementById("step-account"),
  stepCodeBadge: document.getElementById("step-code"),
  panel: document.getElementById("slide-panel"),
  panelTitle: document.getElementById("panel-title"),
  panelDesc: document.getElementById("panel-desc"),
  panelToggleBtn: document.getElementById("panel-toggle-btn"),
  authCard: document.getElementById("auth-card"),
  cursor: document.getElementById("cursor"),
  cursorRing: document.getElementById("cursorRing")
};

let mode = requestedMode;
let registerPhase = "account";
let pendingRegisterEmail = "";

elements.backLink.href = "/index.html";
elements.tabs.forEach(function (button) {
  button.addEventListener("click", function () {
    setMode(button.getAttribute("data-mode"));
  });
});
elements.form.addEventListener("submit", handleSubmit);
elements.resendBtn.addEventListener("click", handleResend);
if (elements.panelToggleBtn) {
  elements.panelToggleBtn.addEventListener("click", function () {
    setMode(mode === "login" ? "register" : "login");
  });
}
initializeTheme(document.getElementById("theme-toggle"));
initializeCursorEffects();

await bootstrap();

async function bootstrap() {
  try {
    const response = await getCurrentUser();
    if (response.user) {
      elements.status.textContent = "Đã đăng nhập. Bạn có thể đăng nhập tài khoản khác.";
    }
  } catch (error) {
    // Stay on auth page when not logged in.
  }
  setMode(mode);
}

function setMode(nextMode) {
  mode = nextMode;
  if (mode !== "register") {
    registerPhase = "account";
  }

  const isRegister = mode === "register";
  elements.tabs.forEach(function (button) {
    const isActive = button.getAttribute("data-mode") === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  elements.nameField.classList.toggle("is-hidden", !isRegister);
  elements.usernameField.classList.toggle("is-hidden", !isRegister);
  elements.confirmField.classList.toggle("is-hidden", !isRegister);
  elements.steps.classList.toggle("is-hidden", !isRegister);

  elements.heading.innerHTML = isRegister ? "Đăng <em>ký.</em>" : "Đăng <em>nhập.</em>";
  elements.subcopy.textContent = isRegister
    ? (registerPhase === "code" ? "Nhập mã 6 số được gửi qua email." : "Tạo tài khoản để lưu và chia sẻ photo strip của bạn.")
    : "Tiếp tục lưu giữ những khoảnh khắc của bạn.";
  elements.submit.textContent = isRegister ? (registerPhase === "code" ? "Xác nhận mã" : "Tiếp tục") : "Đăng nhập";
  elements.password.autocomplete = isRegister ? "new-password" : "current-password";
  elements.status.textContent = "Ảnh nhanh";

  const showCodeStep = isRegister && registerPhase === "code";
  elements.stepAccount.classList.toggle("is-hidden", showCodeStep);
  elements.stepCode.classList.toggle("is-hidden", !showCodeStep);
  elements.stepAccount.setAttribute("aria-hidden", showCodeStep ? "true" : "false");
  elements.stepCode.setAttribute("aria-hidden", showCodeStep ? "false" : "true");
  elements.steps.setAttribute("aria-hidden", isRegister ? "false" : "true");
  elements.stepAccountBadge.classList.toggle("is-active", !showCodeStep);
  elements.stepCodeBadge.classList.toggle("is-active", showCodeStep);
  showVerificationNote("", isRegister && registerPhase === "code");
  updateSlidingPanel();
}

async function handleSubmit(event) {
  event.preventDefault();
  elements.submit.disabled = true;
  elements.status.textContent = mode === "register" ? "Đang xử lý..." : "Đang đăng nhập...";

  try {
    if (mode === "register") {
      if (registerPhase === "account") {
        await startRegistration();
      } else {
        await confirmRegistrationCode();
      }
      return;
    }

    await loginUser({
      email: elements.email.value,
      password: elements.password.value
    });

    elements.status.textContent = "Ảnh nhanh";
    window.location.replace(nextUrl);
  } catch (error) {
    elements.status.textContent = error.message || "Ảnh nhanh";
  } finally {
    elements.submit.disabled = false;
  }
}

async function startRegistration() {
  const validationError = validateRegistrationStep();
  if (validationError) {
    elements.status.textContent = validationError;
    return;
  }

  let response;
  try {
    response = await registerUser({
      name: elements.name.value,
      username: elements.username.value,
      email: elements.email.value,
      password: elements.password.value,
      confirmPassword: elements.confirmPassword.value
    });
  } catch (error) {
    const normalizedMessage = String(error && error.message ? error.message : "").toLowerCase();
    const hasExistingAccount = normalizedMessage.includes("already registered") || normalizedMessage.includes("username already");

    if (hasExistingAccount) {
      registerPhase = "account";
      setMode("login");
      elements.status.textContent = "Tài khoản đã tồn tại. Vui lòng đăng nhập.";
      elements.password.value = "";
      elements.confirmPassword.value = "";
      return;
    }

    throw error;
  }

  pendingRegisterEmail = elements.email.value.trim();
  registerPhase = "code";
  setMode("register");
  elements.status.textContent = "Nhập mã 6 số";
  showVerificationNote(response.previewUrl || "", true);
}

async function confirmRegistrationCode() {
  const response = await verifyUser({
    email: pendingRegisterEmail || elements.email.value,
    code: elements.code.value
  });

  elements.status.textContent = "Thành công";
  if (response.user) {
    window.location.replace(nextUrl);
    return;
  }
  window.location.replace("/login.html?next=" + encodeURIComponent(nextUrl));
}

async function handleResend() {
  const email = (pendingRegisterEmail || elements.email.value || "").trim();
  if (!email) {
    elements.status.textContent = "Nhập email";
    return;
  }

  elements.resendBtn.disabled = true;
  elements.status.textContent = "Đang gửi...";

  try {
    const response = await resendVerification(email);
    elements.status.textContent = "Đã gửi lại";
    showVerificationNote(response.previewUrl || "", true);
  } catch (error) {
    elements.status.textContent = error.message || "Lỗi";
  } finally {
    elements.resendBtn.disabled = false;
  }
}

function showVerificationNote(previewUrl, visible) {
  elements.note.classList.toggle("is-hidden", !visible);
  elements.previewLink.style.display = previewUrl ? "inline-flex" : "none";
  if (previewUrl) {
    elements.previewLink.href = previewUrl;
  }
}

function validateRegistrationStep() {
  const name = elements.name.value.trim();
  const username = elements.username.value.trim();
  const email = elements.email.value.trim();
  const password = elements.password.value;
  const confirmPassword = elements.confirmPassword.value;

  if (!name || !username || !email || !password || !confirmPassword) {
    return "Nhập đầy đủ thông tin";
  }

  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    return "Tên đăng nhập tối thiểu 3 ký tự";
  }

  if (!email.includes("@")) {
    return "Email không hợp lệ";
  }

  if (password.length < 6) {
    return "Mật khẩu tối thiểu 6 ký tự";
  }

  if (password !== confirmPassword) {
    return "Mật khẩu nhập lại không khớp";
  }

  return "";
}

function sanitizeNext(rawValue) {
  if (!rawValue || !rawValue.startsWith("/")) {
    return "/photobooth.html";
  }
  return rawValue;
}

function updateSlidingPanel() {
  if (!elements.panel) {
    return;
  }

  const isRegister = mode === "register";
  if (elements.authCard) {
    elements.authCard.classList.toggle("is-register", isRegister);
  }
  elements.panel.classList.toggle("at-left", isRegister);
  elements.panel.classList.toggle("at-right", !isRegister);

  if (!elements.panelTitle || !elements.panelDesc || !elements.panelToggleBtn) {
    return;
  }

  if (isRegister) {
    elements.panelTitle.innerHTML = "Đã có<br><em>tài khoản?</em>";
    elements.panelDesc.textContent = "Đăng nhập để tiếp tục lưu giữ những khoảnh khắc của bạn.";
    elements.panelToggleBtn.textContent = "← Đăng nhập";
    return;
  }

  elements.panelTitle.innerHTML = "Chưa có<br><em>tài khoản?</em>";
  elements.panelDesc.textContent = "Đăng ký miễn phí để lưu và chia sẻ photo strip của bạn.";
  elements.panelToggleBtn.textContent = "Đăng ký ngay →";
}

function initializeCursorEffects() {
  if (!elements.cursor || !elements.cursorRing || window.matchMedia("(pointer: coarse)").matches) {
    return;
  }

  let mouseX = 0;
  let mouseY = 0;
  let ringX = 0;
  let ringY = 0;

  document.addEventListener("mousemove", function (event) {
    mouseX = event.clientX;
    mouseY = event.clientY;
    elements.cursor.style.transform = `translate(${mouseX - 5}px, ${mouseY - 5}px)`;
  });

  function animateRing() {
    ringX += (mouseX - ringX) * 0.12;
    ringY += (mouseY - ringY) * 0.12;
    elements.cursorRing.style.transform = `translate(${ringX - 17}px, ${ringY - 17}px)`;
    window.requestAnimationFrame(animateRing);
  }

  animateRing();

  document.querySelectorAll("a, button, input").forEach(function (node) {
    node.addEventListener("mouseenter", function () {
      elements.cursorRing.style.width = "48px";
      elements.cursorRing.style.height = "48px";
    });
    node.addEventListener("mouseleave", function () {
      elements.cursorRing.style.width = "34px";
      elements.cursorRing.style.height = "34px";
    });
  });
}
