export async function apiRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : "Request failed");
  }

  return payload;
}

export function registerUser(input) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function loginUser(input) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function verifyUser(input) {
  return apiRequest("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify(typeof input === "string" ? { token: input } : input)
  });
}

export function resendVerification(email) {
  return apiRequest("/api/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function logoutUser() {
  return apiRequest("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getCurrentUser() {
  return apiRequest("/api/auth/me");
}

export function createProject(project) {
  return apiRequest("/api/projects", {
    method: "POST",
    body: JSON.stringify(project)
  });
}

export function updateProject(projectId, project) {
  return apiRequest(`/api/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(project)
  });
}

export function getMyProjects() {
  return apiRequest("/api/projects/my");
}

export function getPublicProjects() {
  return apiRequest("/api/projects/public");
}

export function getProject(projectId) {
  return apiRequest(`/api/projects/${projectId}`);
}

export function deleteProject(projectId) {
  return apiRequest(`/api/projects/${projectId}`, {
    method: "DELETE",
    body: JSON.stringify({})
  });
}

export function duplicateProject(projectId) {
  return apiRequest(`/api/projects/${projectId}/duplicate`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function markProjectDownloaded(projectId) {
  return apiRequest(`/api/projects/${projectId}/downloaded`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getQrCode(text) {
  return apiRequest(`/api/utils/qr?text=${encodeURIComponent(text)}`);
}

export function getTemplates() {
  return apiRequest("/api/templates");
}

export function createTemplate(template) {
  return apiRequest("/api/templates", {
    method: "POST",
    body: JSON.stringify(template)
  });
}

export function getEvents() {
  return apiRequest("/api/events");
}

export function getPublicEvents() {
  return apiRequest("/api/events/public");
}

export function createEvent(eventInput) {
  return apiRequest("/api/events", {
    method: "POST",
    body: JSON.stringify(eventInput)
  });
}

export function getAnalyticsOverview() {
  return apiRequest("/api/analytics/overview");
}

export function getCaptionSuggestion(input) {
  return apiRequest("/api/ai/caption-suggestion", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
