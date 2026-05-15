import {
  LAYOUTS,
  createImageItem,
  photoboothState,
  subscribe,
  updateState,
  resetState,
  replaceState,
  undoState,
  redoState,
  getHistoryState,
  clearHistory,
  getStateSnapshot
} from "./modules/state.js";
import { initializeTheme } from "./modules/theme.js";
import { initializeCamera } from "./modules/camera.js";
import { initializeUploads, buildGridCards } from "./modules/uploads.js";
import { initializeStickers } from "./modules/stickers.js";
import { initializeEditor } from "./modules/editor.js";
import { initializeExport } from "./modules/export.js";
import { createProject, getCurrentUser, getProject, logoutUser, updateProject } from "./modules/backend.js";
import { getQrCode } from "./modules/api.js";

const DRAFT_STORAGE_KEY = "photobooth.autosave.v3";
const AUTOSAVE_DELAY_MS = 700;

const elements = {
  captureSection: document.getElementById("capture-section"),
  uploadSection: document.getElementById("upload-section"),
  editor: document.getElementById("editor"),
  scrapbook: document.getElementById("scrapbook"),
  captureBtn: document.getElementById("capture-btn"),
  skipToUploadBtn: document.getElementById("skip-to-upload-btn"),
  openEditorBtn: document.getElementById("open-editor-btn"),
  backToCameraBtn: document.getElementById("back-to-camera-btn"),
  previewBtn: document.getElementById("preview-btn"),
  saveProjectBtn: document.getElementById("save-project-btn"),
  downloadBtn: document.getElementById("download-btn"),
  shareBtn: document.getElementById("share-btn"),
  qrBtn: document.getElementById("qr-btn"),
  retakeBtn: document.getElementById("retake-btn"),
  backToEditorBtn: document.getElementById("back-to-editor-btn"),
  undoBtn: document.getElementById("undo-btn"),
  redoBtn: document.getElementById("redo-btn"),
  captureGallery: document.getElementById("capture-gallery"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  uploadGallery: document.getElementById("upload-gallery"),
  photostrip: document.getElementById("photostrip"),
  photostripImages: document.getElementById("photostrip-images"),
  overlayStack: document.getElementById("overlay-stack"),
  scrapbookCanvas: document.getElementById("scrapbook-canvas"),
  video: document.getElementById("video"),
  cameraPreview: document.getElementById("camera-preview"),
  countdown: document.getElementById("countdown"),
  errorMessage: document.getElementById("error-message"),
  captureDebug: document.getElementById("capture-debug"),
  themeToggle: document.getElementById("theme-toggle"),
  countOptions: document.querySelectorAll(".count-option"),
  layoutButtons: document.querySelectorAll("[data-layout]"),
  cameraAiButtons: document.querySelectorAll("[data-ai-mode]"),
  modeButtons: document.querySelectorAll("[data-section-mode]"),
  captureStickerButtons: document.querySelectorAll("[data-capture-sticker]"),
  suggestCaptureStickerBtn: document.getElementById("suggest-capture-sticker-btn"),
  captureStatus: document.getElementById("capture-status"),
  uploadStatus: document.getElementById("upload-status"),
  editorStatus: document.getElementById("editor-status"),
  enableDate: document.getElementById("enable-date"),
  eventTitleInput: document.getElementById("event-title-input"),
  nameInput: document.getElementById("name-input"),
  quoteInput: document.getElementById("quote-input"),
  customDateInput: document.getElementById("custom-date-input"),
  imageAdjustments: document.getElementById("image-adjustments"),
  stickerCategories: document.getElementById("sticker-categories"),
  stickerPalette: document.getElementById("sticker-palette"),
  stickerUploadInput: document.getElementById("sticker-upload-input"),
  stickerTools: document.getElementById("sticker-tools"),
  stickerSizeRange: document.getElementById("sticker-size-range"),
  stickerRotateRange: document.getElementById("sticker-rotate-range"),
  stickerFrontBtn: document.getElementById("sticker-front-btn"),
  stickerBackBtn: document.getElementById("sticker-back-btn"),
  stickerDeleteBtn: document.getElementById("sticker-delete-btn"),
  backgroundButtons: document.querySelectorAll(".backgrounds button"),
  filterButtons: document.querySelectorAll(".filters button"),
  authState: document.getElementById("auth-state"),
  loginLink: document.getElementById("login-link"),
  logoutBtn: document.getElementById("logout-btn"),
  authPanel: document.getElementById("auth-panel"),
  userPill: document.querySelector(".user-pill"),
  uploadModePill: document.getElementById("upload-mode-pill"),
  draftStatus: document.getElementById("draft-status"),
  toast: document.getElementById("toast"),
  shareModal: document.getElementById("share-modal"),
  shareModalClose: document.getElementById("share-modal-close"),
  shareCloseBtn: document.getElementById("share-close-btn"),
  shareQrImage: document.getElementById("share-qr-image"),
  shareLink: document.getElementById("share-link")
};

let currentUser = null;
let autosaveTimer = null;
let hasBootstrapped = false;
let lastDraftSavedAt = "";
let toastTimer = null;
let runtimeErrorTimer = null;
let captureStatusTimer = null;

initializeTheme(elements.themeToggle);
window.__photoboothReportError = showRuntimeError;
window.__photoboothReportCaptureStatus = showCaptureStatus;
window.addEventListener("error", function (event) {
  if (!event || !event.error) {
    return;
  }
  showRuntimeError(event.error, {
    prefix: event.message || "Lỗi không xác định",
    fileName: event.filename,
    lineNumber: event.lineno,
    columnNumber: event.colno
  });
});
window.addEventListener("unhandledrejection", function (event) {
  const reason = event && event.reason ? event.reason : new Error("Promise bị từ chối.");
  showRuntimeError(reason, { prefix: "Unhandled promise rejection" });
});
const cameraApi = initializeCamera(elements, showToast);
initializeUploads(elements, showToast);
const stickersApi = initializeStickers(elements.photostrip);
const editorApi = initializeEditor(elements, stickersApi, showToast);
const exportApi = initializeExport(elements, showToast);

wireUiEvents();
subscribe(handleStateChange);
await bootstrap();
render();

async function bootstrap() {
  await hydrateCurrentUser();

  if (!currentUser) {
    const nextTarget = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${nextTarget}`);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project");

  if (projectId) {
    try {
      const response = await getProject(projectId);
      hydrateStateFromProject(response.project);
      clearHistory();
      showToast("Đã tải dự án.");
    } catch (error) {
      showToast(error.message || "Không thể tải dự án.");
    }
  } else if (restoreDraftFromStorage()) {
    clearHistory();
    showToast("Đã khôi phục bản nháp.");
  }

  hasBootstrapped = true;
}

function wireUiEvents() {
  elements.countOptions.forEach(function (button) {
    button.addEventListener("click", function () {
      const imageCount = Number(button.getAttribute("data-count"));
      updateState(function (state) {
        state.imageCount = imageCount;
        state.layout = getDefaultLayoutForCount(imageCount);
        state.images = state.images.slice(0, imageCount);
        state.stickers = [];
        state.selectedStickerId = null;
      });
    });
  });

  elements.skipToUploadBtn.addEventListener("click", function () {
    navigateTo("upload");
  });

  if (elements.clearAllBtn) {
    elements.clearAllBtn.addEventListener("click", function () {
      updateState(function (state) {
        state.images = Array.from({ length: state.imageCount }, function () {
          return null;
        });
        state.stickers = [];
        state.selectedStickerId = null;
      });
      cameraApi.resetCaptures();
      showToast("Đã xóa.");
    });
  }

  elements.openEditorBtn.addEventListener("click", function () {
    if (!photoboothState.images.filter(Boolean).length) {
      showToast("Hãy thêm ít nhất một ảnh.");
      return;
    }
    navigateTo("editor");
  });

  elements.backToCameraBtn.addEventListener("click", function () {
    navigateTo("capture");
  });

  elements.previewBtn.addEventListener("click", function () {
    navigateTo("scrapbook");
  });

  elements.backToEditorBtn.addEventListener("click", function () {
    navigateTo("editor");
  });

  elements.undoBtn.addEventListener("click", function () {
    if (undoState()) {
      showToast("Đã hoàn tác.");
    }
  });

  elements.redoBtn.addEventListener("click", function () {
    if (redoState()) {
      showToast("Đã làm lại.");
    }
  });

  elements.downloadBtn.addEventListener("click", function () {
    exportApi.exportStrip();
  });
  elements.saveProjectBtn.addEventListener("click", saveCurrentProject);
  elements.shareBtn.addEventListener("click", shareCurrentProject);
  elements.qrBtn.addEventListener("click", openQrModal);
  elements.shareModalClose.addEventListener("click", closeShareModal);
  elements.shareCloseBtn.addEventListener("click", closeShareModal);

  elements.retakeBtn.addEventListener("click", function () {
    resetState();
    cameraApi.resetCaptures();
    removeDraftFromStorage();
    clearHistory();
    const params = new URLSearchParams(window.location.search);
    params.delete("project");
    window.history.replaceState({}, "", params.toString() ? `?${params.toString()}` : window.location.pathname);
    showToast("Đã đặt lại.");
  });

  elements.logoutBtn.addEventListener("click", handleLogout);

  if (elements.userPill && elements.authPanel) {
    elements.userPill.addEventListener("click", function () {
      elements.authPanel.classList.toggle("is-open");
      elements.userPill.setAttribute("aria-expanded", elements.authPanel.classList.contains("is-open") ? "true" : "false");
    });
  }

  if (elements.uploadModePill) {
    elements.uploadModePill.addEventListener("click", function () {
      navigateTo("upload");
    });
  }

  elements.modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const section = button.getAttribute("data-section-mode");
      if (section) {
        navigateTo(section);
      }
    });
  });

  document.addEventListener("click", function (event) {
    if (!elements.authPanel || !elements.userPill) {
      return;
    }
    if (elements.authPanel.contains(event.target)) {
      return;
    }
    elements.authPanel.classList.remove("is-open");
    elements.userPill.setAttribute("aria-expanded", "false");
  });
}

function handleStateChange() {
  render();
  scheduleAutosave();
}

function render() {
  buildGridCards(elements.captureGallery, "capture");
  buildGridCards(elements.uploadGallery, "upload");
  editorApi.render();
  renderSections();
  renderStatus();
  renderCountPicker();
  renderCameraAiPicker();
  renderModeButtons();
  renderAuth();
  renderDraftStatus();
}

function renderSections() {
  elements.captureSection.classList.toggle("active", photoboothState.currentSection === "capture");
  elements.uploadSection.classList.toggle("active", photoboothState.currentSection === "upload");
  elements.editor.classList.toggle("active", photoboothState.currentSection === "editor");
  elements.scrapbook.classList.toggle("active", photoboothState.currentSection === "scrapbook");
}

function renderStatus() {
  const selectedImages = photoboothState.images.filter(Boolean).length;
  elements.captureStatus.textContent = selectedImages + " / " + photoboothState.imageCount;
  elements.uploadStatus.textContent = String(selectedImages);
  elements.editorStatus.textContent = LAYOUTS[photoboothState.layout].label;
  elements.openEditorBtn.disabled = selectedImages === 0;
  elements.saveProjectBtn.disabled = selectedImages === 0 || !currentUser;
  elements.shareBtn.disabled = selectedImages === 0;
  elements.qrBtn.disabled = selectedImages === 0;
}

function renderCountPicker() {
  elements.countOptions.forEach(function (button) {
    button.classList.toggle("active", Number(button.getAttribute("data-count")) === photoboothState.imageCount);
  });
}

function renderCameraAiPicker() {
  Array.from(elements.cameraAiButtons || []).forEach(function (button) {
    button.classList.toggle("active", button.getAttribute("data-ai-mode") === photoboothState.cameraAiMode);
  });
}

function renderModeButtons() {
  Array.from(elements.modeButtons || []).forEach(function (button) {
    button.classList.toggle("active", button.getAttribute("data-section-mode") === photoboothState.currentSection);
  });
}

function renderAuth() {
  elements.authState.textContent = currentUser ? currentUser.name : "Người dùng";
  elements.loginLink.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  elements.logoutBtn.disabled = !currentUser;
  elements.loginLink.style.display = currentUser ? "none" : "inline-flex";
  if (elements.userPill && elements.authPanel) {
    elements.userPill.setAttribute("aria-expanded", elements.authPanel.classList.contains("is-open") ? "true" : "false");
  }
}

function renderDraftStatus() {
  const historyState = getHistoryState();
  elements.undoBtn.disabled = !historyState.canUndo;
  elements.redoBtn.disabled = !historyState.canRedo;

  if (!hasMeaningfulDraft()) {
    elements.draftStatus.textContent = "Ảnh nhanh";
    return;
  }

  if (lastDraftSavedAt) {
    elements.draftStatus.textContent = `Đã lưu lúc ${lastDraftSavedAt}`;
    return;
  }

  elements.draftStatus.textContent = "Đang lưu";
}

function navigateTo(section) {
  updateState(function (state) {
    state.currentSection = section;
  });

  window.requestAnimationFrame(function () {
    const target = section === "upload"
      ? elements.uploadSection
      : section === "editor"
        ? elements.editor
        : section === "scrapbook"
          ? elements.scrapbook
          : elements.captureSection;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

async function hydrateCurrentUser() {
  try {
    const response = await getCurrentUser();
    currentUser = response.user;
  } catch (error) {
    currentUser = null;
  }
}

async function handleLogout() {
  try {
    await logoutUser();
    currentUser = null;
    render();
    showToast("Đã đăng xuất.");
  } catch (error) {
    showToast(error.message || "Lỗi");
  }
}

async function saveCurrentProject() {
  if (!currentUser) {
    redirectToLogin("Hãy đăng nhập trước.");
    return null;
  }

  try {
    const payload = serializeProject();
    let response;
    if (photoboothState.projectId) {
      response = await updateProject(photoboothState.projectId, payload);
      showToast("Đã cập nhật.");
    } else {
      response = await createProject(payload);
      showToast("Đã lưu.");
    }
    hydrateStateFromProject(response.project);
    clearHistory();
    const params = new URLSearchParams(window.location.search);
    params.set("project", response.project.id);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    return response.project;
  } catch (error) {
    showToast(error.message || "Không thể lưu dự án.");
    return null;
  }
}

function serializeProject() {
  return {
    title: photoboothState.overlays.eventTitle || "Ảnh nhanh",
    layout: photoboothState.layout,
    templateId: "",
    eventId: "",
    imageCount: photoboothState.imageCount,
    background: photoboothState.background,
    filter: photoboothState.filter,
    overlays: photoboothState.overlays,
    showDate: photoboothState.showDate,
    isPublic: photoboothState.isPublic,
    images: photoboothState.images.filter(Boolean),
    stickers: photoboothState.stickers
  };
}

function hydrateStateFromProject(project) {
  replaceState({
    ...getStateSnapshot(),
    projectId: project.id,
    shareId: project.shareId || "",
    templateId: "",
    eventId: "",
    layout: project.layout,
    imageCount: project.imageCount,
    background: project.background,
    filter: project.filter,
    overlays: project.overlays || photoboothState.overlays,
    showDate: project.showDate,
    images: (project.images || []).map(function (source) {
      const item = createImageItem(source.src);
      item.zoom = source.zoom || 1;
      item.offsetX = source.offsetX || 0;
      item.offsetY = source.offsetY || 0;
      item.rotation = source.rotation || 0;
      return item;
    }),
    stickers: project.stickers || [],
    createdAt: project.createdAt || photoboothState.createdAt,
    currentSection: "editor"
  }, { recordHistory: false });
}

async function shareCurrentProject() {
  const shareUrl = await ensureShareableProject();
  if (!shareUrl) {
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Ảnh nhanh",
        text: "Ảnh nhanh",
        url: shareUrl
      });
      showToast("Đã mở bảng chia sẻ.");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast("Đã sao chép liên kết.");
  } catch (error) {
    showToast("Hãy mở mã QR để chia sẻ.");
  }
}

async function openQrModal() {
  const shareUrl = await ensureShareableProject();
  if (!shareUrl) {
    return;
  }

  try {
    const response = await getQrCode(shareUrl);
    elements.shareQrImage.src = response.dataUrl;
    elements.shareLink.href = shareUrl;
    elements.shareLink.textContent = shareUrl;
    elements.shareModal.classList.remove("is-hidden");
    elements.shareModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    showToast(error.message || "Không thể tạo mã QR.");
  }
}

function closeShareModal() {
  elements.shareModal.classList.add("is-hidden");
  elements.shareModal.setAttribute("aria-hidden", "true");
}

async function ensureShareableProject() {
  if (!currentUser) {
    redirectToLogin("Hãy đăng nhập và lưu trước.");
    return "";
  }

  let shareId = photoboothState.shareId;
  if (!photoboothState.projectId || !shareId) {
    const project = await saveCurrentProject();
    if (!project) {
      return "";
    }
    shareId = project.shareId;
  }

  return `${window.location.origin}/booth/p/${shareId}`;
}

function scheduleAutosave() {
  if (!hasBootstrapped || !hasMeaningfulDraft()) {
    return;
  }

  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(function () {
    persistDraftToStorage();
    renderDraftStatus();
  }, AUTOSAVE_DELAY_MS);
}

function persistDraftToStorage() {
  const payload = {
    savedAt: new Date().toISOString(),
    state: getStateSnapshot()
  };
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  lastDraftSavedAt = formatTimestamp(payload.savedAt);
}

function restoreDraftFromStorage() {
  try {
    const rawValue = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!rawValue) {
      return false;
    }
    const draft = JSON.parse(rawValue);
    if (!draft || !draft.state) {
      return false;
    }
    replaceState(draft.state, { recordHistory: false });
    lastDraftSavedAt = draft.savedAt ? formatTimestamp(draft.savedAt) : "";
    return true;
  } catch (error) {
    console.warn("Không thể khôi phục bản nháp cục bộ", error);
    return false;
  }
}

function removeDraftFromStorage() {
  window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  lastDraftSavedAt = "";
}

function hasMeaningfulDraft() {
  return photoboothState.images.some(function (item) {
    return item && item.src;
  }) || photoboothState.stickers.length > 0 || Boolean(photoboothState.overlays.eventTitle || photoboothState.overlays.name || photoboothState.overlays.quote || photoboothState.overlays.customDate);
}

function redirectToLogin(message) {
  showToast(message);
  window.setTimeout(function () {
    window.location.href = elements.loginLink.href;
  }, 500);
}

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getDefaultLayoutForCount(imageCount) {
  if (imageCount === 2) {
    return "landscape-2";
  }
  if (imageCount === 4) {
    return "collage-2x2";
  }
  return "classic-strip";
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () {
    elements.toast.classList.remove("show");
  }, 2200);
}

function showRuntimeError(error, context) {
  if (!elements.errorMessage) {
    console.error(error);
    return;
  }

  const details = formatRuntimeError(error, context);
  elements.errorMessage.style.display = "block";
  elements.errorMessage.style.whiteSpace = "pre-wrap";
  elements.errorMessage.textContent = details;

  window.clearTimeout(runtimeErrorTimer);
  runtimeErrorTimer = window.setTimeout(function () {
    elements.errorMessage.textContent = "";
  }, 12000);
}

function showCaptureStatus(message, isSuccess) {
  if (!elements.captureDebug) {
    return;
  }

  elements.captureDebug.style.display = "block";
  elements.captureDebug.textContent = message;
  elements.captureDebug.classList.toggle("is-success", Boolean(isSuccess));
  elements.captureDebug.classList.toggle("is-error", !isSuccess && Boolean(message));

  window.clearTimeout(captureStatusTimer);
  captureStatusTimer = window.setTimeout(function () {
    if (!elements.captureDebug) {
      return;
    }
    elements.captureDebug.textContent = "San sang chup";
    elements.captureDebug.classList.remove("is-success", "is-error");
  }, 12000);
}

function formatRuntimeError(error, context) {
  const parts = [];
  const prefix = context && context.prefix ? String(context.prefix) : "Loi";
  const message = error && error.message ? error.message : String(error || "Unknown error");
  parts.push(prefix + ": " + message);

  const fileName = context && context.fileName ? context.fileName : error && (error.fileName || error.filename);
  const lineNumber = context && context.lineNumber ? context.lineNumber : error && error.lineNumber;
  const columnNumber = context && context.columnNumber ? context.columnNumber : error && error.columnNumber;
  if (fileName) {
    const location = [fileName];
    if (lineNumber) {
      location.push(String(lineNumber));
    }
    if (columnNumber) {
      location.push(String(columnNumber));
    }
    parts.push("Vi tri: " + location.join(":"));
  }

  if (error && error.stack) {
    const stackLine = String(error.stack).split("\n").find(function (line) {
      return line.includes(".js:") || line.includes(".html:");
    });
    if (stackLine) {
      parts.push(stackLine.trim());
    }
  }

  return parts.join("\n");
}
