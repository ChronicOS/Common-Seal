import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True when both settings are present. The app shows a setup notice otherwise. */
export const isConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;
