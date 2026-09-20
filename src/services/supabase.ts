import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://lmldxkukfksfswzbliuy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_0t7OtaGP4O7zNxcYaGansw_2diBelTK";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      params: {
        eventsPerSecond: 20
      }
    }
  }
);

export const supabaseConfig = {
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY
};
