import {
  deleteProject,
  duplicateProject,
  getCurrentUser,
  getMyProjects,
  getPublicProjects,
  logoutUser
} from "./modules/backend.js";
import { initializeTheme } from "./modules/theme.js";

const PAGE_SIZE = 4;

const elements = {
  authState: document.getElementById("gallery-auth-state"),
  userEmail: document.getElementById("gallery-user-email"),
  userAvatar: document.getElementById("gallery-user-avatar"),
  loginLink: document.getElementById("gallery-login-link"),
  logoutBtn: document.getElementById("gallery-logout-btn"),
  searchInput: document.getElementById("gallery-search"),
  filters: Array.from(document.querySelectorAll("[data-filter]")),
  viewButtons: Array.from(document.querySelectorAll("[data-view]")),
  sidebarLinks: Array.from(document.querySelectorAll("[data-section]")),
  myProjectsCount: document.getElementById("my-projects-count"),
  publicProjectsCount: document.getElementById("public-projects-count"),
  editingCount: document.getElementById("editing-count"),
  downloadCount: document.getElementById("download-count"),
  projectsGrid: document.getElementById("projects-grid"),
  pager: document.getElementById("gallery-pager"),
  toast: document.getElementById("gallery-toast")
};

let currentUser = null;
let toastTimer = null;
let myProjects = [];
let publicProjects = [];
let activeSection = "all";
let searchQuery = "";
let viewMode = "grid";
let currentPage = 1;

initializeTheme(document.getElementById("theme-toggle"));

elements.logoutBtn.addEventListener("click", handleLogout);
elements.searchInput.addEventListener("input", function (event) {
  searchQuery = event.target.value.trim().toLowerCase();
  currentPage = 1;
  renderProjects();
});

elements.filters.forEach(function (button) {
  button.addEventListener("click", function () {
    activeSection = button.getAttribute("data-filter") || "all";
    currentPage = 1;
    updateFilterState();
    renderProjects();
  });
});

elements.viewButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    viewMode = button.getAttribute("data-view") || "grid";
    updateViewState();
    renderProjects();
  });
});

elements.sidebarLinks.forEach(function (button) {
  button.addEventListener("click", function () {
    activeSection = button.getAttribute("data-section") || "all";
    currentPage = 1;
    updateSidebarState();
    updateFilterState();
    renderProjects();
  });
});

elements.projectsGrid.addEventListener("click", handleGridAction);

await bootstrap();

async function bootstrap() {
  await refreshSession();
  await loadMyProjects();
  await loadPublicProjects();
  renderProjects();
}

async function refreshSession() {
  try {
    const response = await getCurrentUser();
    currentUser = response.user;
  } catch (error) {
    currentUser = null;
  }
  renderAuth();
}

function renderAuth() {
  if (currentUser) {
    elements.authState.textContent = currentUser.name;
    elements.userEmail.textContent = currentUser.email || "Đã đăng nhập";
    elements.userAvatar.textContent = (currentUser.name || "A").charAt(0).toUpperCase();
  } else {
    elements.authState.textContent = "Chưa đăng nhập";
    elements.userEmail.textContent = "Chọn một dự án để bắt đầu";
    elements.userAvatar.textContent = "A";
  }

  elements.loginLink.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  elements.loginLink.style.display = currentUser ? "none" : "inline-flex";
  elements.logoutBtn.style.display = currentUser ? "inline-flex" : "none";
  elements.logoutBtn.disabled = !currentUser;
}

async function handleLogout() {
  try {
    await logoutUser();
    currentUser = null;
    renderAuth();
    await loadMyProjects();
    renderProjects();
    showToast("Đã đăng xuất");
  } catch (error) {
    showToast(error.message || "Lỗi");
  }
}

async function loadMyProjects() {
  if (!currentUser) {
    myProjects = [];
    setCount(elements.myProjectsCount, 0);
    setCount(elements.editingCount, 0);
    return;
  }

  try {
    const response = await getMyProjects();
    myProjects = response.projects || [];
    setCount(elements.myProjectsCount, myProjects.length);
    setCount(elements.editingCount, myProjects.length ? 1 : 0);
    setCount(elements.downloadCount, sumDownloads(myProjects));
  } catch (error) {
    myProjects = [];
    setCount(elements.myProjectsCount, 0);
    setCount(elements.editingCount, 0);
  }
}

async function loadPublicProjects() {
  try {
    const response = await getPublicProjects();
    publicProjects = response.projects || [];
    setCount(elements.publicProjectsCount, publicProjects.length);
    setCount(elements.downloadCount, sumDownloads(myProjects) + sumDownloads(publicProjects));
  } catch (error) {
    publicProjects = [];
    setCount(elements.publicProjectsCount, 0);
  }
}

function renderProjects() {
  updateSidebarState();
  updateFilterState();
  updateViewState();

  const items = getVisibleProjects();
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  elements.projectsGrid.className = "project-grid" + (viewMode === "list" ? " is-list" : "");
  elements.projectsGrid.innerHTML = buildGridMarkup(pageItems);
  renderPager(pageCount);
}

function getVisibleProjects() {
  let items = [];

  if (activeSection === "mine") {
    items = myProjects.slice();
  } else if (activeSection === "public") {
    items = publicProjects.slice();
  } else if (activeSection === "shared" || activeSection === "trash") {
    items = [];
  } else {
    items = [...myProjects, ...publicProjects];
  }

  if (searchQuery) {
    items = items.filter(function (project) {
      const haystack = [
        project.title,
        project.layout,
        project.ownerName,
        project.isPublic ? "công khai" : "riêng tư"
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchQuery);
    });
  }

  return dedupeProjects(items);
}

function dedupeProjects(items) {
  const map = new Map();
  items.forEach(function (project) {
    if (!map.has(project.id)) {
      map.set(project.id, project);
    }
  });
  return Array.from(map.values()).sort(function (a, b) {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function buildGridMarkup(items) {
  const shouldShowCreateCard = currentUser && (activeSection === "all" || activeSection === "mine");
  const createCard = shouldShowCreateCard
    ? `
      <article class="create-card">
        <div class="create-card__inner">
          <div class="create-card__plus">+</div>
          <strong>Tạo dự án mới</strong>
          <p>Bắt đầu một photostrip mới</p>
          <a class="project-btn is-primary" href="/photobooth.html">Tạo ngay</a>
        </div>
      </article>`
    : "";

  if (!items.length && !createCard) {
    return '<div class="empty-state">Chưa có dự án nào trong mục này.</div>';
  }

  const cards = items.map(function (project) {
    return renderProjectCard(project);
  }).join("");

  return createCard + cards;
}

function renderProjectCard(project) {
  const isOwnProject = currentUser && project.ownerName === currentUser.name;
  const badge = project.isPublic
    ? '<span class="badge is-public">Công khai</span>'
    : '<span class="badge is-draft">Riêng tư</span>';

  const dateText = formatDate(project.updatedAt);
  const downloadText = `${Number(project.downloadCount || 0)} lượt xuất`;

  return `
    <article class="project-card" data-project-id="${project.id}" data-project-title="${escapeHtml(project.title)}">
      <div class="project-card__top">
        <button class="icon-btn" type="button" data-action="favorite" data-id="${project.id}" aria-label="Thích dự án">♡</button>
        <button class="icon-btn ghost" type="button" data-action="menu" data-id="${project.id}" aria-label="Tùy chọn">⋮</button>
      </div>
      <div class="project-card__preview">
        ${project.previewImage ? `<img src="${project.previewImage}" alt="${escapeHtml(project.title)}" />` : `<div class="empty-state">Chưa có ảnh xem trước</div>`}
      </div>
      <div class="project-card__body">
        <strong>${escapeHtml(project.title)}</strong>
        <div class="project-card__meta">${escapeHtml(project.layout)}</div>
        <div class="project-card__meta">${escapeHtml(dateText)} · ${escapeHtml(downloadText)}</div>
        ${badge}
      </div>
      <div class="project-card__actions">
        <button class="project-btn" type="button" data-action="share" data-id="${project.id}">Chia sẻ</button>
        <button class="project-btn" type="button" data-action="duplicate" data-id="${project.id}">Nhân bản</button>
        <button class="project-btn is-primary" type="button" data-action="open" data-id="${project.id}">Mở ↗</button>
        ${isOwnProject ? `<button class="project-btn" type="button" data-action="delete" data-id="${project.id}">Xóa</button>` : ""}
      </div>
    </article>`;
}

function renderPager(pageCount) {
  if (pageCount <= 1) {
    elements.pager.innerHTML = "";
    return;
  }

  const buttons = [];
  buttons.push(`<button type="button" data-page="${Math.max(1, currentPage - 1)}" aria-label="Trang trước">‹</button>`);
  for (let page = 1; page <= pageCount; page += 1) {
    buttons.push(`<button type="button" class="${page === currentPage ? "is-active" : ""}" data-page="${page}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${Math.min(pageCount, currentPage + 1)}" aria-label="Trang sau">›</button>`);
  elements.pager.innerHTML = buttons.join("");
  elements.pager.querySelectorAll("[data-page]").forEach(function (button) {
    button.addEventListener("click", function () {
      currentPage = Number(button.getAttribute("data-page")) || 1;
      renderProjects();
    });
  });
}

async function handleGridAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.getAttribute("data-action");
  const projectId = button.getAttribute("data-id");

  if (action === "open") {
    window.location.href = `/photobooth.html?project=${encodeURIComponent(projectId)}`;
    return;
  }

  try {
    if (action === "duplicate") {
      await duplicateProject(projectId);
      showToast("Đã sao chép");
    }

    if (action === "delete") {
      await deleteProject(projectId);
      showToast("Đã xóa");
      await loadMyProjects();
      await loadPublicProjects();
      renderProjects();
      return;
    }

    if (action === "share") {
      window.location.href = `/photobooth.html?project=${encodeURIComponent(projectId)}#share`;
      return;
    }

    if (action === "favorite" || action === "menu") {
      showToast("Tính năng này có thể nâng cấp thêm sau.");
      return;
    }

    await loadMyProjects();
    await loadPublicProjects();
    renderProjects();
  } catch (error) {
    showToast(error.message || "Lỗi");
  }
}

function updateFilterState() {
  elements.filters.forEach(function (button) {
    button.classList.toggle("is-active", button.getAttribute("data-filter") === activeSection);
  });
}

function updateViewState() {
  elements.viewButtons.forEach(function (button) {
    button.classList.toggle("is-active", button.getAttribute("data-view") === viewMode);
  });
}

function updateSidebarState() {
  elements.sidebarLinks.forEach(function (button) {
    button.classList.toggle("is-active", button.getAttribute("data-section") === activeSection);
  });
}

function setCount(node, value) {
  if (!node) {
    return;
  }
  node.textContent = String(value);
}

function sumDownloads(items) {
  return items.reduce(function (total, item) {
    return total + Number(item.downloadCount || 0);
  }, 0);
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (error) {
    return "";
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () {
    elements.toast.classList.remove("show");
  }, 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
