const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");
const QRCode = require("qrcode");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const PROJECTS_DIR = path.join(STORAGE_DIR, "projects");
const MAILBOX_DIR = path.join(DATA_DIR, "mailbox");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_COOKIE = "photobooth_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24;
const MAIL_FROM = process.env.MAIL_FROM || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DEFAULT_TEMPLATES = [
  { id: "tpl_romantic", name: "Romantic", background: "#fff4f7", filter: "warm", layout: "polaroid", overlays: { eventTitle: "Romantic Moments", quote: "Love looks good on us." } },
  { id: "tpl_vintage", name: "Vintage", background: "#f5ead7", filter: "sepia", layout: "classic-strip", overlays: { eventTitle: "Vintage Booth", quote: "Golden hour forever." } },
  { id: "tpl_kpop", name: "K-Pop", background: "#f0efff", filter: "cool", layout: "k-style-4", overlays: { eventTitle: "Seoul Night", quote: "Main character energy." } },
  { id: "tpl_birthday", name: "Birthday", background: "#fff7d8", filter: "none", layout: "collage-2x2", overlays: { eventTitle: "Birthday Booth", quote: "Cake, chaos, camera." } },
  { id: "tpl_minimal", name: "Minimalist", background: "#ffffff", filter: "none", layout: "postcard", overlays: { eventTitle: "Minimal Mood", quote: "Clean frames, clear memories." } }
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

ensureDir(DATA_DIR);
ensureDir(STORAGE_DIR);
ensureDir(PROJECTS_DIR);
ensureDir(MAILBOX_DIR);
ensureDb();
seedTemplates();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/") {
      return sendRedirect(res, "/index.html");
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      return handleApi(req, res, requestUrl);
    }

    if (requestUrl.pathname.startsWith("/booth/p/")) {
      return handlePublicProjectPage(res, requestUrl.pathname.split("/").pop());
    }

    if (requestUrl.pathname.startsWith("/events/")) {
      return handlePublicEventPage(res, requestUrl.pathname.split("/").pop());
    }

    return serveStatic(res, requestUrl.pathname);
  } catch (error) {
    console.error("Server error:", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Photobooth server running at http://localhost:${PORT}`);
});

async function handleApi(req, res, requestUrl) {
  const db = readDb();
  if (!Array.isArray(db.pendingRegistrations)) {
    db.pendingRegistrations = [];
  }
  cleanupExpiredSessions(db);
  writeDb(db);

  if (requestUrl.pathname === "/api/auth/register" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const name = String(body.name || "").trim();
    const username = normalizeUsername(body.username);
    if (!email || password.length < 6 || !name || !username) {
      return sendJson(res, 400, { error: "Username, name, email, and password (min 6 chars) are required." });
    }
    if (password !== confirmPassword) {
      return sendJson(res, 400, { error: "Password confirmation does not match." });
    }
    if (db.users.some((user) => user.email === email)) {
      return sendJson(res, 409, { error: "Email already registered." });
    }
    if (db.users.some((user) => user.username === username)) {
      return sendJson(res, 409, { error: "Username already registered." });
    }

    const existingPendingIndex = db.pendingRegistrations.findIndex((entry) => entry.email === email || entry.username === username);
    const verificationCode = createVerificationCode();
    const pendingRegistration = {
      id: createId("pending"),
      email,
      username,
      name,
      passwordHash: hashPassword(password),
      codeHash: hashVerificationCode(verificationCode),
      codeExpiresAt: new Date(Date.now() + VERIFY_TTL_MS).toISOString(),
      createdAt: new Date().toISOString()
    };

    if (existingPendingIndex >= 0) {
      db.pendingRegistrations.splice(existingPendingIndex, 1, pendingRegistration);
    } else {
      db.pendingRegistrations.push(pendingRegistration);
    }
    writeDb(db);
    const delivery = await deliverVerificationCodeEmail(req, pendingRegistration, verificationCode);
    return sendJson(res, 201, {
      success: true,
      requiresCode: true,
      message: "Check your email for the 6-digit code.",
      email,
      previewUrl: delivery.previewUrl || "",
      deliveryMode: delivery.mode
    });
  }

  if (requestUrl.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identifier = String(body.email || body.identifier || "").trim();
    const password = String(body.password || "");
    const normalizedEmail = normalizeEmail(identifier);
    const normalizedUsername = normalizeUsername(identifier);
    const candidateUsers = findLoginCandidates(db, normalizedEmail, normalizedUsername);
    const user = candidateUsers.find((entry) => verifyPassword(password, entry.passwordHash));

    if (!user) {
      return sendJson(res, 401, { error: "Invalid username, email, or password." });
    }
    if (!user.isVerified) {
      return sendJson(res, 403, { error: "Please verify your email before logging in." });
    }
    const session = createSession(user.id);
    db.sessions.push(session);
    writeDb(db);
    setSessionCookie(res, session.token);
    return sendJson(res, 200, { user: sanitizeUser(user) });
  }

  if (requestUrl.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = getSessionToken(req);
    if (token) {
      db.sessions = db.sessions.filter((session) => session.token !== token);
      writeDb(db);
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { success: true });
  }

  if (requestUrl.pathname === "/api/auth/me" && req.method === "GET") {
    const user = getCurrentUser(req, db);
    return sendJson(res, 200, { user: user ? sanitizeUser(user) : null });
  }

  if (requestUrl.pathname === "/api/auth/verify" && req.method === "POST") {
    const body = await readJsonBody(req);
    const token = String(body.token || "");
    const email = normalizeEmail(body.email);
    const code = String(body.code || "").trim();

    if (token) {
      const user = findUserByVerificationToken(db, token);
      if (!user) {
        return sendJson(res, 400, { error: "Invalid or expired verification link." });
      }
      user.isVerified = true;
      user.verifyTokenHash = "";
      user.verifyTokenExpiresAt = "";
      user.verifiedAt = new Date().toISOString();
      const session = createSession(user.id);
      db.sessions.push(session);
      writeDb(db);
      setSessionCookie(res, session.token);
      return sendJson(res, 200, { success: true, user: sanitizeUser(user) });
    }

    const pending = db.pendingRegistrations.find((entry) => entry.email === email);
    if (!pending || !code) {
      return sendJson(res, 400, { error: "Invalid email or code." });
    }
    if (new Date(pending.codeExpiresAt).getTime() <= Date.now()) {
      return sendJson(res, 400, { error: "Verification code expired." });
    }
    if (pending.codeHash !== hashVerificationCode(code)) {
      return sendJson(res, 400, { error: "Incorrect verification code." });
    }
    if (db.users.some((user) => user.email === pending.email)) {
      db.pendingRegistrations = db.pendingRegistrations.filter((entry) => entry.email !== pending.email);
      writeDb(db);
      return sendJson(res, 409, { error: "Email already registered." });
    }
    if (db.users.some((user) => user.username === pending.username)) {
      db.pendingRegistrations = db.pendingRegistrations.filter((entry) => entry.email !== pending.email);
      writeDb(db);
      return sendJson(res, 409, { error: "Username already registered." });
    }

    const user = {
      id: createId("user"),
      email: pending.email,
      username: pending.username,
      name: pending.name,
      passwordHash: pending.passwordHash,
      isVerified: true,
      verifyTokenHash: "",
      verifyTokenExpiresAt: "",
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    db.pendingRegistrations = db.pendingRegistrations.filter((entry) => entry.email !== pending.email);
    const session = createSession(user.id);
    db.sessions.push(session);
    writeDb(db);
    setSessionCookie(res, session.token);
    return sendJson(res, 200, { success: true, user: sanitizeUser(user) });
  }

  if (requestUrl.pathname === "/api/auth/resend-verification" && req.method === "POST") {
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const user = db.users.find((entry) => entry.email === email);
    if (user && user.isVerified) {
      return sendJson(res, 400, { error: "Email already verified." });
    }
    const pending = db.pendingRegistrations.find((entry) => entry.email === email);
    if (!pending) {
      return sendJson(res, 404, { error: "Email not found." });
    }
    const verificationCode = createVerificationCode();
    pending.codeHash = hashVerificationCode(verificationCode);
    pending.codeExpiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
    writeDb(db);
    const delivery = await deliverVerificationCodeEmail(req, pending, verificationCode);
    return sendJson(res, 200, {
      success: true,
      message: "Verification code sent.",
      previewUrl: delivery.previewUrl || "",
      deliveryMode: delivery.mode
    });
  }

  if (requestUrl.pathname === "/api/templates" && req.method === "GET") {
    return sendJson(res, 200, { templates: db.templates });
  }

  if (requestUrl.pathname === "/api/templates" && req.method === "POST") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readJsonBody(req);
    const template = buildTemplateRecord(body, user.id);
    db.templates.push(template);
    writeDb(db);
    return sendJson(res, 201, { template });
  }

  if (requestUrl.pathname === "/api/events" && req.method === "GET") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const events = db.events.filter((event) => event.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJson(res, 200, { events: events.map((event) => eventSummary(event, db)) });
  }

  if (requestUrl.pathname === "/api/events/public" && req.method === "GET") {
    const events = db.events.filter((event) => event.isPublic).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJson(res, 200, { events: events.map((event) => eventSummary(event, db)) });
  }

  if (requestUrl.pathname === "/api/events" && req.method === "POST") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readJsonBody(req);
    const event = buildEventRecord(body, user.id);
    db.events.push(event);
    writeDb(db);
    return sendJson(res, 201, { event: eventSummary(event, db) });
  }

  const eventIdMatch = requestUrl.pathname.match(/^\/api\/events\/([^/]+)$/);
  if (eventIdMatch && req.method === "GET") {
    const event = db.events.find((entry) => entry.id === eventIdMatch[1]);
    if (!event) return sendJson(res, 404, { error: "Event not found." });
    const user = getCurrentUser(req, db);
    if (!event.isPublic && (!user || user.id !== event.userId)) {
      return sendJson(res, 403, { error: "Access denied." });
    }
    const projects = db.projects.filter((project) => project.eventId === event.id).map((project) => projectSummary(project, db));
    return sendJson(res, 200, { event: eventSummary(event, db), projects });
  }

  if (requestUrl.pathname === "/api/analytics/overview" && req.method === "GET") {
    const user = requireUser(req, res, db);
    if (!user) return;
    return sendJson(res, 200, { analytics: buildAnalytics(db, user.id) });
  }

  if (requestUrl.pathname === "/api/ai/caption-suggestion" && req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, { suggestion: suggestCaption(body) });
  }

  if (requestUrl.pathname === "/api/projects/public" && req.method === "GET") {
    const projects = db.projects.filter((project) => project.isPublic).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((project) => projectSummary(project, db));
    return sendJson(res, 200, { projects });
  }

  if (requestUrl.pathname === "/api/utils/qr" && req.method === "GET") {
    const text = String(requestUrl.searchParams.get("text") || "").trim();
    if (!text) {
      return sendJson(res, 400, { error: "Text is required." });
    }
    const dataUrl = await QRCode.toDataURL(text, {
      width: 640,
      margin: 1,
      color: {
        dark: "#111111",
        light: "#ffffff"
      }
    });
    return sendJson(res, 200, { dataUrl });
  }

  if (requestUrl.pathname === "/api/projects/my" && req.method === "GET") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const projects = db.projects.filter((project) => project.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((project) => projectSummary(project, db));
    return sendJson(res, 200, { projects });
  }

  if (requestUrl.pathname === "/api/projects" && req.method === "POST") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const body = await readJsonBody(req);
    const project = buildProjectRecord(body, user.id);
    persistProjectAssets(project);
    db.projects.push(project);
    incrementEventStats(db, project.eventId, "projectCount", 1);
    writeDb(db);
    return sendJson(res, 201, { project: projectDetail(project, db) });
  }

  const projectIdMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)$/);
  const duplicateMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)\/duplicate$/);
  const downloadMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)\/downloaded$/);

  if (downloadMatch && req.method === "POST") {
    const project = db.projects.find((entry) => entry.id === downloadMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });
    project.downloadCount = Number(project.downloadCount || 0) + 1;
    project.updatedAt = new Date().toISOString();
    incrementEventStats(db, project.eventId, "downloadCount", 1);
    writeDb(db);
    return sendJson(res, 200, { success: true });
  }

  if (duplicateMatch && req.method === "POST") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const source = db.projects.find((project) => project.id === duplicateMatch[1]);
    if (!source || source.userId !== user.id) return sendJson(res, 404, { error: "Project not found." });
    const duplicate = JSON.parse(JSON.stringify(source));
    duplicate.id = createId("strip");
    duplicate.shareId = createShareId();
    duplicate.title = `${source.title} Copy`;
    duplicate.createdAt = new Date().toISOString();
    duplicate.updatedAt = duplicate.createdAt;
    duplicate.downloadCount = 0;
    duplicate.assets = cloneProjectAssets(source.id, duplicate.id, source.assets);
    duplicate.images = duplicate.images.map((image) => ({ ...image, src: rewriteAssetPath(image.src, source.id, duplicate.id) }));
    duplicate.stickers = duplicate.stickers.map((sticker) => sticker.type === "image" ? { ...sticker, src: rewriteAssetPath(sticker.src, source.id, duplicate.id) } : sticker);
    db.projects.push(duplicate);
    incrementEventStats(db, duplicate.eventId, "projectCount", 1);
    writeDb(db);
    return sendJson(res, 201, { project: projectDetail(duplicate, db) });
  }

  if (projectIdMatch) {
    const project = db.projects.find((entry) => entry.id === projectIdMatch[1]);
    if (!project) return sendJson(res, 404, { error: "Project not found." });

    if (req.method === "GET") {
      const user = getCurrentUser(req, db);
      if (!project.isPublic && (!user || user.id !== project.userId)) return sendJson(res, 403, { error: "Access denied." });
      return sendJson(res, 200, { project: projectDetail(project, db) });
    }

    const user = requireUser(req, res, db);
    if (!user) return;
    if (project.userId !== user.id) return sendJson(res, 403, { error: "Access denied." });

    if (req.method === "PUT") {
      const previousEventId = project.eventId;
      const body = await readJsonBody(req);
      updateExistingProject(project, body);
      persistProjectAssets(project);
      if (previousEventId !== project.eventId) {
        incrementEventStats(db, previousEventId, "projectCount", -1);
        incrementEventStats(db, project.eventId, "projectCount", 1);
      }
      writeDb(db);
      return sendJson(res, 200, { project: projectDetail(project, db) });
    }

    if (req.method === "DELETE") {
      deleteProjectAssets(project.id);
      db.projects = db.projects.filter((entry) => entry.id !== project.id);
      incrementEventStats(db, project.eventId, "projectCount", -1);
      writeDb(db);
      return sendJson(res, 200, { success: true });
    }
  }

  sendJson(res, 404, { error: "Route not found." });
}

function buildProjectRecord(body, userId) {
  const now = new Date().toISOString();
  return {
    id: createId("strip"),
    shareId: createShareId(),
    userId,
    title: String(body.title || "Untitled Photobooth").trim() || "Untitled Photobooth",
    layout: String(body.layout || "classic-strip"),
    templateId: String(body.templateId || ""),
    eventId: String(body.eventId || ""),
    imageCount: Number(body.imageCount || 3),
    background: String(body.background || "#ffffff"),
    filter: String(body.filter || "none"),
    overlays: sanitizeOverlays(body.overlays),
    showDate: Boolean(body.showDate),
    createdAt: now,
    updatedAt: now,
    isPublic: body.isPublic !== false,
    stickers: sanitizeStickers(body.stickers || []),
    images: sanitizeImages(body.images || []),
    assets: [],
    downloadCount: 0
  };
}

function updateExistingProject(project, body) {
  project.title = String(body.title || project.title).trim() || project.title;
  project.layout = String(body.layout || project.layout);
  project.templateId = String(body.templateId || project.templateId || "");
  project.eventId = String(body.eventId || project.eventId || "");
  project.imageCount = Number(body.imageCount || project.imageCount);
  project.background = String(body.background || project.background);
  project.filter = String(body.filter || project.filter);
  project.overlays = sanitizeOverlays(body.overlays || project.overlays);
  project.showDate = typeof body.showDate === "boolean" ? body.showDate : project.showDate;
  project.isPublic = typeof body.isPublic === "boolean" ? body.isPublic : project.isPublic;
  project.stickers = sanitizeStickers(body.stickers || []);
  project.images = sanitizeImages(body.images || []);
  project.updatedAt = new Date().toISOString();
}

function buildTemplateRecord(body, userId) {
  return {
    id: createId("tpl"),
    name: String(body.name || "Untitled Template").trim() || "Untitled Template",
    background: String(body.background || "#ffffff"),
    filter: String(body.filter || "none"),
    layout: String(body.layout || "classic-strip"),
    overlays: sanitizeOverlays(body.overlays || {}),
    createdBy: userId,
    createdAt: new Date().toISOString()
  };
}

function buildEventRecord(body, userId) {
  const now = new Date().toISOString();
  return {
    id: createId("event"),
    shareId: createShareId(),
    userId,
    name: String(body.name || "Untitled Event").trim() || "Untitled Event",
    slug: slugify(body.name || "Untitled Event") + "-" + crypto.randomBytes(2).toString("hex"),
    theme: String(body.theme || "Minimalist"),
    description: String(body.description || ""),
    templateId: String(body.templateId || ""),
    isPublic: body.isPublic !== false,
    createdAt: now,
    updatedAt: now,
    projectCount: 0,
    downloadCount: 0
  };
}

function buildAnalytics(db, userId) {
  const projects = db.projects.filter((project) => project.userId === userId);
  const totalProjects = projects.length;
  const totalDownloads = projects.reduce((sum, project) => sum + Number(project.downloadCount || 0), 0);
  const templateUsage = {};
  projects.forEach((project) => {
    const key = project.templateId || "custom";
    templateUsage[key] = (templateUsage[key] || 0) + 1;
  });
  const topTemplateEntry = Object.entries(templateUsage).sort((a, b) => b[1] - a[1])[0] || ["custom", 0];
  const topTemplate = db.templates.find((template) => template.id === topTemplateEntry[0]);
  return {
    totalProjects,
    totalDownloads,
    topTemplateName: topTemplate ? topTemplate.name : topTemplateEntry[0],
    topTemplateUsage: topTemplateEntry[1],
    publicProjects: projects.filter((project) => project.isPublic).length
  };
}

function suggestCaption(body) {
  const template = String(body.templateName || "").trim();
  const eventName = String(body.eventName || "").trim();
  const layout = String(body.layout || "classic-strip").replaceAll("-", " ");
  const base = eventName || template || "Photobooth";
  const suggestions = [
    `${base} memories, framed in ${layout}.`,
    `${base} energy, one perfect strip at a time.`,
    `${base} moments worth keeping forever.`
  ];
  return suggestions[Math.floor(Math.random() * suggestions.length)];
}

function eventSummary(event, db) {
  const owner = db.users.find((user) => user.id === event.userId);
  const template = db.templates.find((entry) => entry.id === event.templateId);
  return {
    id: event.id,
    shareId: event.shareId,
    name: event.name,
    slug: event.slug,
    theme: event.theme,
    description: event.description,
    templateId: event.templateId,
    templateName: template ? template.name : "Custom",
    ownerName: owner ? owner.name : "Unknown",
    isPublic: event.isPublic,
    projectCount: Number(event.projectCount || 0),
    downloadCount: Number(event.downloadCount || 0),
    updatedAt: event.updatedAt
  };
}

function projectSummary(project, db) {
  const owner = db.users.find((user) => user.id === project.userId);
  const template = db.templates.find((entry) => entry.id === project.templateId);
  const event = db.events.find((entry) => entry.id === project.eventId);
  return {
    id: project.id,
    shareId: project.shareId,
    title: project.title,
    layout: project.layout,
    background: project.background,
    filter: project.filter,
    templateId: project.templateId || "",
    templateName: template ? template.name : "Custom",
    eventId: project.eventId || "",
    eventName: event ? event.name : "",
    eventShareId: event ? event.shareId : "",
    eventTheme: event ? event.theme : "",
    eventProjectCount: event ? Number(event.projectCount || 0) : 0,
    imageCount: project.imageCount,
    previewImage: project.images[0] ? project.images[0].src : "",
    updatedAt: project.updatedAt,
    ownerName: owner ? owner.name : "Unknown",
    isPublic: project.isPublic,
    downloadCount: Number(project.downloadCount || 0)
  };
}

function projectDetail(project, db) {
  return {
    ...projectSummary(project, db),
    overlays: project.overlays,
    showDate: project.showDate,
    images: project.images,
    stickers: project.stickers,
    createdAt: project.createdAt
  };
}

function requireUser(req, res, db) {
  const user = getCurrentUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  return user;
}

function getCurrentUser(req, db) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = db.sessions.find((entry) => entry.token === token && new Date(entry.expiresAt).getTime() > Date.now());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function handlePublicProjectPage(res, shareId) {
  const db = readDb();
  const project = db.projects.find((entry) => entry.shareId === shareId && entry.isPublic);
  if (!project) return sendHtml(res, 404, "<h1>Project not found</h1>");
  const owner = db.users.find((user) => user.id === project.userId);
  const event = db.events.find((entry) => entry.id === project.eventId);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(project.title)}</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f7efe8;color:#1f1a17}.page{max-width:900px;margin:0 auto;padding:32px 20px 60px}.card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 16px 32px rgba(0,0,0,.08)}.meta{color:#6b5a53;margin-bottom:18px}.strip{display:grid;gap:12px;background:${project.background};padding:18px;border-radius:24px}.strip img{width:100%;border-radius:18px;border:6px solid #ff99cc;display:block}.overlay{text-align:center;margin-top:14px}a{color:#2e73d3}</style></head><body><main class="page"><div class="card"><p><a href="/gallery.html">Back to gallery</a></p><h1>${escapeHtml(project.title)}</h1><p class="meta">by ${escapeHtml(owner ? owner.name : "Unknown")} � ${escapeHtml(new Date(project.updatedAt).toLocaleString())}${event ? ` � Event: ${escapeHtml(event.name)}` : ""}</p><div class="strip">${project.images.map((image) => `<img src="${image.src}" alt="Project image" />`).join("")}<div class="overlay">${project.overlays.eventTitle ? `<div><strong>${escapeHtml(project.overlays.eventTitle)}</strong></div>` : ""}${project.overlays.name ? `<div>${escapeHtml(project.overlays.name)}</div>` : ""}${project.overlays.quote ? `<div><em>${escapeHtml(project.overlays.quote)}</em></div>` : ""}${project.showDate ? `<div>${escapeHtml(project.overlays.customDate || new Date(project.createdAt).toLocaleDateString())}</div>` : ""}</div></div></div></main></body></html>`;
  return sendHtml(res, 200, html);
}

function handlePublicEventPage(res, shareId) {
  const db = readDb();
  const event = db.events.find((entry) => entry.shareId === shareId && entry.isPublic);
  if (!event) return sendHtml(res, 404, "<h1>Event not found</h1>");
  const projects = db.projects.filter((project) => project.eventId === event.id && project.isPublic);
  const owner = db.users.find((user) => user.id === event.userId);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(event.name)}</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f7efe8;color:#1f1a17}.page{max-width:1100px;margin:0 auto;padding:32px 20px 60px}.card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 16px 32px rgba(0,0,0,.08)}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.item{background:#f8f3ee;border-radius:18px;overflow:hidden;padding:12px}.item img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;display:block}.meta{color:#6b5a53;margin-bottom:18px}a{color:#2e73d3}</style></head><body><main class="page"><div class="card"><p><a href="/gallery.html?view=public">Back to public gallery</a></p><h1>${escapeHtml(event.name)}</h1><p class="meta">Hosted by ${escapeHtml(owner ? owner.name : "Unknown")} � Theme: ${escapeHtml(event.theme)} � ${projects.length} strips</p><div class="grid">${projects.map((project) => `<a class="item" href="/booth/p/${project.shareId}"><img src="${project.images[0] ? project.images[0].src : ""}" alt="${escapeHtml(project.title)}" /><p>${escapeHtml(project.title)}</p></a>`).join("")}</div></div></main></body></html>`;
  return sendHtml(res, 200, html);
}

function persistProjectAssets(project) {
  const targetDir = path.join(PROJECTS_DIR, project.id);
  ensureDir(targetDir);
  const assets = [];
  project.images = project.images.map((image, index) => {
    const nextImage = { ...image };
    if (isDataUrl(nextImage.src)) {
      const ext = extensionFromDataUrl(nextImage.src);
      const fileName = `image-${index + 1}.${ext}`;
      fs.writeFileSync(path.join(targetDir, fileName), Buffer.from(nextImage.src.split(",")[1], "base64"));
      nextImage.src = `/storage/projects/${project.id}/${fileName}`;
    }
    assets.push(nextImage.src);
    return nextImage;
  });
  project.stickers = project.stickers.map((sticker, index) => {
    if (sticker.type === "image" && isDataUrl(sticker.src)) {
      const ext = extensionFromDataUrl(sticker.src);
      const fileName = `sticker-${index + 1}.${ext}`;
      fs.writeFileSync(path.join(targetDir, fileName), Buffer.from(sticker.src.split(",")[1], "base64"));
      return { ...sticker, src: `/storage/projects/${project.id}/${fileName}` };
    }
    return sticker;
  });
  project.assets = assets;
}

function cloneProjectAssets(sourceId, targetId, assetUrls) {
  const sourceDir = path.join(PROJECTS_DIR, sourceId);
  const targetDir = path.join(PROJECTS_DIR, targetId);
  ensureDir(targetDir);
  const copiedAssets = [];
  assetUrls.forEach((assetUrl) => {
    const fileName = path.basename(assetUrl);
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
    copiedAssets.push(`/storage/projects/${targetId}/${fileName}`);
  });
  return copiedAssets;
}

function rewriteAssetPath(url, sourceId, targetId) {
  if (!url.includes(`/storage/projects/${sourceId}/`)) return url;
  return url.replace(`/storage/projects/${sourceId}/`, `/storage/projects/${targetId}/`);
}

function incrementEventStats(db, eventId, field, delta) {
  if (!eventId) return;
  const event = db.events.find((entry) => entry.id === eventId);
  if (!event) return;
  event[field] = Math.max(0, Number(event[field] || 0) + delta);
  event.updatedAt = new Date().toISOString();
}

function seedTemplates() {
  const db = readDb();
  if (!Array.isArray(db.templates)) db.templates = [];
  if (!db.templates.length) {
    db.templates = DEFAULT_TEMPLATES.map((template) => ({ ...template, createdAt: new Date().toISOString(), createdBy: "system" }));
    writeDb(db);
  }
}

function sanitizeImages(images) {
  return images.filter((image) => image && image.src).map((image) => ({ src: String(image.src), zoom: Number(image.zoom || 1), offsetX: Number(image.offsetX || 0), offsetY: Number(image.offsetY || 0), rotation: Number(image.rotation || 0) }));
}

function sanitizeStickers(stickers) {
  return stickers.map((sticker) => ({ id: String(sticker.id || createId("sticker")), type: sticker.type === "image" ? "image" : "emoji", character: String(sticker.character || ""), src: String(sticker.src || ""), category: String(sticker.category || "custom"), x: Number(sticker.x || 50), y: Number(sticker.y || 16), scale: Number(sticker.scale || 1), rotation: Number(sticker.rotation || 0), zIndex: Number(sticker.zIndex || 1) }));
}

function sanitizeOverlays(overlays) {
  return { eventTitle: String(overlays.eventTitle || ""), name: String(overlays.name || ""), quote: String(overlays.quote || ""), customDate: String(overlays.customDate || "") };
}

async function deliverVerificationEmail(req, user, token) {
  const verificationLink = buildAbsoluteUrl(req, "/verify.html?token=" + encodeURIComponent(token));
  const subject = "Verify your Photobooth account";
  const html = '<div style="font-family:Arial,sans-serif;padding:24px;color:#1f1a17"><h1>Photobooth</h1><p>Hello ' + escapeHtml(user.name) + ',</p><p>Click the button below to verify your account.</p><p><a href="' + verificationLink + '" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#f28b50;color:#fff;text-decoration:none;font-weight:700">Verify email</a></p><p>If the button does not work, open this link:</p><p><a href="' + verificationLink + '">' + verificationLink + '</a></p><p>This link expires in 24 hours.</p></div>';

  if (RESEND_API_KEY && MAIL_FROM) {
    await sendEmailWithResend({ to: user.email, subject, html });
    return { mode: "email", previewUrl: "" };
  }

  const previewUrl = writeLocalEmailPreview(user.email, subject, html);
  return { mode: "preview", previewUrl };
}

async function deliverVerificationCodeEmail(req, pendingRegistration, code) {
  const subject = "Your Photobooth verification code";
  const html = '<div style="font-family:Arial,sans-serif;padding:24px;color:#1f1a17"><h1>Photobooth</h1><p>Hello ' + escapeHtml(pendingRegistration.name) + ',</p><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:10px;margin:20px 0;">' + escapeHtml(code) + '</p><p>Enter this 6-digit code in the app to finish creating your account.</p><p>This code expires in 24 hours.</p></div>';

  if (RESEND_API_KEY && MAIL_FROM) {
    await sendEmailWithResend({ to: pendingRegistration.email, subject, html });
    return { mode: "email", previewUrl: "" };
  }

  const previewUrl = writeLocalEmailPreview(pendingRegistration.email, subject, html);
  return { mode: "preview", previewUrl };
}

function createVerificationToken() {
  const token = crypto.randomBytes(24).toString("hex");
  return {
    token,
    tokenHash: hashVerificationToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS).toISOString()
  };
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function hashVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function findUserByVerificationToken(db, token) {
  const tokenHash = hashVerificationToken(token);
  return db.users.find((user) => user.verifyTokenHash === tokenHash && user.verifyTokenExpiresAt && new Date(user.verifyTokenExpiresAt).getTime() > Date.now());
}

function buildAbsoluteUrl(req, pathname) {
  const host = req.headers.host || "localhost:" + PORT;
  return "http://" + host + pathname;
}

function writeLocalEmailPreview(email, subject, html) {
  const safeEmail = String(email).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "user";
  const fileName = Date.now() + "-" + safeEmail + ".html";
  fs.writeFileSync(path.join(MAILBOX_DIR, fileName), '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + escapeHtml(subject) + '</title></head><body style="background:#f6efe7;margin:0;padding:32px">' + html + '</body></html>');
  return "/data/mailbox/" + fileName;
}

function sendEmailWithResend({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ from: MAIL_FROM, to: [to], subject, html });
    const request = https.request("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Authorization: "Bearer " + RESEND_API_KEY
      }
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error("Email delivery failed (" + (response.statusCode || 500) + "). " + raw));
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function readJsonBody(req) { return new Promise((resolve, reject) => { let raw = ""; req.on("data", (chunk) => { raw += chunk; if (raw.length > 10 * 1024 * 1024) { reject(new Error("Payload too large")); req.destroy(); } }); req.on("end", () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } }); req.on("error", reject); }); }
function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
function writeDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function ensureDb() { if (!fs.existsSync(DB_FILE)) writeDb({ users: [], sessions: [], projects: [], events: [], templates: [], pendingRegistrations: [] }); const db = readDb(); if (!Array.isArray(db.users)) db.users = []; if (!Array.isArray(db.sessions)) db.sessions = []; if (!Array.isArray(db.projects)) db.projects = []; if (!Array.isArray(db.events)) db.events = []; if (!Array.isArray(db.templates)) db.templates = []; if (!Array.isArray(db.pendingRegistrations)) db.pendingRegistrations = []; let changed = false; db.users = db.users.map((user) => { const nextUser = { ...user }; if (!("username" in nextUser)) { nextUser.username = normalizeUsername(nextUser.email ? String(nextUser.email).split("@")[0] : nextUser.name || "user"); changed = true; } if (typeof nextUser.isVerified !== "boolean") { nextUser.isVerified = true; changed = true; } if (!("verifyTokenHash" in nextUser)) { nextUser.verifyTokenHash = ""; changed = true; } if (!("verifyTokenExpiresAt" in nextUser)) { nextUser.verifyTokenExpiresAt = ""; changed = true; } if (!("verifiedAt" in nextUser)) { nextUser.verifiedAt = nextUser.isVerified ? (nextUser.createdAt || new Date().toISOString()) : ""; changed = true; } return nextUser; }); if (changed) writeDb(db); }
function ensureDir(dirPath) { if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true }); }
function createId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString("hex")}`; }
function createShareId() { return crypto.randomBytes(6).toString("base64url"); }
function hashPassword(password) { const salt = crypto.randomBytes(16).toString("hex"); const hash = crypto.scryptSync(password, salt, 64).toString("hex"); return `${salt}:${hash}`; }
function verifyPassword(password, stored) { const [salt, hash] = String(stored).split(":"); if (!salt || !hash) return false; const attempted = crypto.scryptSync(password, salt, 64).toString("hex"); return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempted, "hex")); }
function createSession(userId) { return { token: crypto.randomBytes(24).toString("hex"), userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }; }
function cleanupExpiredSessions(db) { db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now()); }
function getSessionToken(req) { const cookies = parseCookies(req.headers.cookie || ""); return cookies[SESSION_COOKIE] || null; }
function parseCookies(headerValue) { return headerValue.split(";").reduce((acc, part) => { const [key, ...rest] = part.trim().split("="); if (!key) return acc; acc[key] = decodeURIComponent(rest.join("=")); return acc; }, {}); }
function setSessionCookie(res, token) { res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`); }
function clearSessionCookie(res) { res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`); }
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendHtml(res, statusCode, html) { res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); }
function sendRedirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function sanitizeUser(user) { return { id: user.id, email: user.email, username: user.username || "", name: user.name, isVerified: Boolean(user.isVerified), createdAt: user.createdAt, verifiedAt: user.verifiedAt || "" }; }
function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function normalizeUsername(username) { return String(username || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, ""); }
function findLoginCandidates(db, normalizedEmail, normalizedUsername) {
  const byEmail = db.users.filter((entry) => entry.email === normalizedEmail);
  const byUsername = db.users.filter((entry) => entry.username === normalizedUsername);
  const seen = new Set();
  const candidates = [];

  byEmail.concat(byUsername).forEach((entry) => {
    if (!entry || seen.has(entry.id)) {
      return;
    }
    seen.add(entry.id);
    candidates.push(entry);
  });

  return candidates;
}
function isDataUrl(value) { return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(value || "")); }
function extensionFromDataUrl(value) { const match = String(value).match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/); if (!match) return "png"; if (match[1] === "jpeg") return "jpg"; return match[1]; }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function slugify(value) { return String(value || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event"; }

function serveStatic(res, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);
  if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendHtml(res, 404, "<h1>Not found</h1>");
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mimeType });
  fs.createReadStream(filePath).pipe(res);
}


