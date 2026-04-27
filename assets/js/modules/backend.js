import * as localApi from "./api.js";
import { isSupabaseConfigured, supabaseConfig } from "./supabase-config.js";

let supabaseClientPromise = null;

function useSupabase() {
  return isSupabaseConfigured();
}

async function getSupabase() {
  if (!useSupabase()) {
    return null;
  }

  if (!supabaseClientPromise) {
    supabaseClientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(function (module) {
      return module.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "photobooth-supabase-auth"
        }
      });
    });
  }

  return supabaseClientPromise;
}

function buildRedirectUrl() {
  return window.location.origin + (supabaseConfig.emailRedirectPath || "/login.html");
}

function mapSupabaseUser(user, profile) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email || "",
    name: (profile && profile.name) || user.user_metadata?.name || user.email || "Ảnh nhanh",
    isVerified: Boolean(user.email_confirmed_at),
    createdAt: user.created_at || new Date().toISOString(),
    verifiedAt: user.email_confirmed_at || ""
  };
}

function mapProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    shareId: row.share_id || row.id,
    title: row.title || "Ảnh nhanh",
    layout: row.layout || "classic-strip",
    background: row.background || "#ffffff",
    filter: row.filter_name || "none",
    templateId: "",
    templateName: "Custom",
    eventId: "",
    eventName: "",
    imageCount: Number(row.image_count || 3),
    previewImage: row.preview_image || (Array.isArray(row.images) && row.images[0] ? row.images[0].src || "" : ""),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
    ownerName: row.owner_name || "Ảnh nhanh",
    isPublic: row.is_public !== false,
    downloadCount: Number(row.download_count || 0),
    overlays: row.overlays || { eventTitle: "", name: "", quote: "", customDate: "" },
    showDate: Boolean(row.show_date),
    images: Array.isArray(row.images) ? row.images : [],
    stickers: Array.isArray(row.stickers) ? row.stickers : [],
    createdAt: row.created_at || new Date().toISOString()
  };
}

async function ensureProfile(userId, name) {
  const supabase = await getSupabase();
  const payload = {
    id: userId,
    name: String(name || "").trim() || "Ảnh nhanh"
  };

  const result = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function getProfile(userId) {
  const supabase = await getSupabase();
  const result = await supabase.from("profiles").select("id, name").eq("id", userId).maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data || null;
}

export async function registerUser(input) {
  if (!useSupabase()) {
    return localApi.registerUser(input);
  }

  return requestOtp({
    email: input.email,
    name: input.name,
    username: input.username,
    mode: "register"
  });
}

export async function loginUser(input) {
  if (!useSupabase()) {
    return localApi.loginUser(input);
  }

  const supabase = await getSupabase();
  const result = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  const profile = result.data.user ? await getProfile(result.data.user.id) : null;
  return { user: mapSupabaseUser(result.data.user, profile) };
}

export async function verifyUser(token) {
  if (!useSupabase()) {
    return localApi.verifyUser(token);
  }

  const supabase = await getSupabase();
  const payload = typeof token === "string" ? { token } : token;
  const result = await supabase.auth.verifyOtp({
    email: payload.email,
    token: payload.code || payload.token,
    type: "email"
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  const profile = result.data.user ? await getProfile(result.data.user.id).catch(function () {
    return null;
  }) : null;

  if (result.data.user && !profile && payload.name) {
    try {
      await ensureProfile(result.data.user.id, payload.name);
    } catch (error) {
      console.warn("Unable to sync Supabase profile", error);
    }
  }

  return { success: true, user: mapSupabaseUser(result.data.user, profile) };
}

export async function resendVerification(email) {
  if (!useSupabase()) {
    return localApi.resendVerification(email);
  }

  return requestOtp({
    email,
    mode: "login"
  });
}

export async function requestOtp(input) {
  if (!useSupabase()) {
    if (input.mode === "register") {
      return localApi.registerUser({
        name: input.name,
        username: input.username,
        email: input.email,
        password: input.password || "password123",
        confirmPassword: input.confirmPassword || "password123"
      });
    }

    throw new Error("OTP requires Supabase mode.");
  }

  const supabase = await getSupabase();
  const result = await supabase.auth.signInWithOtp({
    email: input.email,
    options: {
      emailRedirectTo: buildRedirectUrl(),
      shouldCreateUser: input.mode === "register",
      data: input.mode === "register"
        ? {
            name: input.name || "Ảnh nhanh",
            username: input.username || ""
          }
        : undefined
    }
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    success: true,
    message: "Verification code sent.",
    previewUrl: "",
    deliveryMode: "email"
  };
}

export async function logoutUser() {
  if (!useSupabase()) {
    return localApi.logoutUser();
  }

  const supabase = await getSupabase();
  const result = await supabase.auth.signOut();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return { success: true };
}

export async function getCurrentUser() {
  if (!useSupabase()) {
    return localApi.getCurrentUser();
  }

  const supabase = await getSupabase();
  const authResult = await supabase.auth.getUser();
  if (authResult.error) {
    throw new Error(authResult.error.message);
  }

  const user = authResult.data.user;
  if (!user) {
    return { user: null };
  }

  const profile = await getProfile(user.id).catch(function () {
    return null;
  });

  return { user: mapSupabaseUser(user, profile) };
}

export async function createProject(project) {
  if (!useSupabase()) {
    return localApi.createProject(project);
  }

  const current = await getCurrentUser();
  if (!current.user) {
    throw new Error("Authentication required.");
  }

  const payload = {
    user_id: current.user.id,
    title: project.title || "Ảnh nhanh",
    layout: project.layout,
    image_count: project.imageCount,
    background: project.background,
    filter_name: project.filter,
    overlays: project.overlays,
    show_date: Boolean(project.showDate),
    is_public: project.isPublic !== false,
    images: project.images || [],
    stickers: project.stickers || [],
    preview_image: project.images && project.images[0] ? project.images[0].src || "" : ""
  };

  const supabase = await getSupabase();
  const result = await supabase.from("projects").insert(payload).select("*").single();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return { project: mapProjectRow({ ...result.data, owner_name: current.user.name }) };
}

export async function updateProject(projectId, project) {
  if (!useSupabase()) {
    return localApi.updateProject(projectId, project);
  }

  const payload = {
    title: project.title || "Ảnh nhanh",
    layout: project.layout,
    image_count: project.imageCount,
    background: project.background,
    filter_name: project.filter,
    overlays: project.overlays,
    show_date: Boolean(project.showDate),
    is_public: project.isPublic !== false,
    images: project.images || [],
    stickers: project.stickers || [],
    preview_image: project.images && project.images[0] ? project.images[0].src || "" : "",
    updated_at: new Date().toISOString()
  };

  const supabase = await getSupabase();
  const result = await supabase.from("projects").update(payload).eq("id", projectId).select("*").single();
  if (result.error) {
    throw new Error(result.error.message);
  }

  const current = await getCurrentUser();
  return { project: mapProjectRow({ ...result.data, owner_name: current.user ? current.user.name : "Ảnh nhanh" }) };
}

export async function getMyProjects() {
  if (!useSupabase()) {
    return localApi.getMyProjects();
  }

  const current = await getCurrentUser();
  if (!current.user) {
    throw new Error("Authentication required.");
  }

  const supabase = await getSupabase();
  const result = await supabase.from("projects").select("*").eq("user_id", current.user.id).order("updated_at", { ascending: false });
  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    projects: (result.data || []).map(function (row) {
      return mapProjectRow({ ...row, owner_name: current.user.name });
    })
  };
}

export async function getPublicProjects() {
  if (!useSupabase()) {
    return localApi.getPublicProjects();
  }

  const supabase = await getSupabase();
  const result = await supabase.from("projects").select("*").eq("is_public", true).order("updated_at", { ascending: false });
  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    projects: result.data.map(function (row) {
      return mapProjectRow(row);
    })
  };
}

export async function getProject(projectId) {
  if (!useSupabase()) {
    return localApi.getProject(projectId);
  }

  const supabase = await getSupabase();
  const result = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return { project: mapProjectRow(result.data) };
}

export async function deleteProject(projectId) {
  if (!useSupabase()) {
    return localApi.deleteProject(projectId);
  }

  const supabase = await getSupabase();
  const result = await supabase.from("projects").delete().eq("id", projectId);
  if (result.error) {
    throw new Error(result.error.message);
  }

  return { success: true };
}

export async function duplicateProject(projectId) {
  if (!useSupabase()) {
    return localApi.duplicateProject(projectId);
  }

  const current = await getCurrentUser();
  if (!current.user) {
    throw new Error("Authentication required.");
  }

  const source = await getProject(projectId);
  const duplicatePayload = {
    ...source.project,
    title: (source.project.title || "Ảnh nhanh") + " Bản sao",
    isPublic: source.project.isPublic,
    imageCount: source.project.imageCount,
    showDate: source.project.showDate
  };

  return createProject(duplicatePayload);
}

export async function markProjectDownloaded(projectId) {
  if (!useSupabase()) {
    return localApi.markProjectDownloaded(projectId);
  }

  const supabase = await getSupabase();
  const source = await supabase.from("projects").select("download_count").eq("id", projectId).single();
  if (source.error) {
    throw new Error(source.error.message);
  }

  const result = await supabase
    .from("projects")
    .update({ download_count: Number(source.data.download_count || 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return { success: true };
}

export { useSupabase };
