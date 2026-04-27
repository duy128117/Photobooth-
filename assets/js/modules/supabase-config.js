export const supabaseConfig = {
  enabled: false,
  url: "https://dqdrobdlxbrsxofxowyq.supabase.co",
  anonKey: "sb_publishable_u1awyGgyf8Uf5x3uHk8Zpg_mdcqQVh-",
  emailRedirectPath: "/login.html",
  storageBucket: "photobooth-assets"
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.enabled && supabaseConfig.url && supabaseConfig.anonKey);
}
