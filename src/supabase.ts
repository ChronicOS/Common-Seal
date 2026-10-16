import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True when both settings are present. The app shows a setup notice otherwise. */
export const isConfigured = Boolean(url && key);

// The live connection (who's online) sends its heartbeat from a small worker served by this site,
// so it keeps going in background tabs. Without a worker the heartbeat runs in the page as before.
const canUseWorker = typeof window !== "undefined" && typeof Worker !== "undefined";

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, canUseWorker ? { realtime: { worker: true, workerUrl: "/realtime-worker.js" } } : undefined) : null;
