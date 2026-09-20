import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!secretKey) {
  throw new Error("Supabase secret key is unavailable.");
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    switch (action) {
      case "create":
        return await createSession(req, body);
      case "pair":
        return await pairSession(req, body);
      case "rotate":
        return await rotatePairCode(body);
      case "heartbeat":
        return await heartbeatSession(body);
      case "close":
        return await closeSession(body);
      default:
        return respond({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    console.error("lumarig-remote-session", error);
    return respond(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      500,
    );
  }
});

async function createSession(req: Request, body: Record<string, unknown>) {
  const studioId = String(body.studioId ?? "");
  const studioName = String(body.studioName ?? "LumaRig Studio").slice(0, 80);

  if (!isUuid(studioId)) {
    return respond({ error: "A valid studioId is required." }, 400);
  }

  const fingerprint = await requestFingerprint(req, "create");
  const recentCreates = await attemptCount(fingerprint, 60);
  if (recentCreates >= 30) {
    return respond({ error: "Too many session requests. Try again later." }, 429);
  }
  await logAttempt(fingerprint, true);
  await cleanupExpiredData();

  await admin
    .from("lumarig_remote_sessions")
    .update({ active: false })
    .eq("studio_id", studioId)
    .eq("active", true);

  await admin
    .from("lumarig_remote_sessions")
    .update({ active: false })
    .eq("active", true)
    .lt("expires_at", new Date().toISOString());

  const roomToken = randomToken(32);
  const studioToken = randomToken(32);
  const studioTokenHash = await sha256(studioToken);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pairCode = randomDigits(6);
    const now = Date.now();
    const pairExpiresAt = new Date(now + 10 * 60_000).toISOString();
    const expiresAt = new Date(now + 12 * 60 * 60_000).toISOString();

    const { data, error } = await admin
      .from("lumarig_remote_sessions")
      .insert({
        studio_id: studioId,
        studio_name: studioName,
        pair_code: pairCode,
        room_token: roomToken,
        studio_token_hash: studioTokenHash,
        pair_expires_at: pairExpiresAt,
        expires_at: expiresAt,
      })
      .select("id, pair_expires_at, expires_at")
      .single();

    if (!error && data) {
      return respond({
        sessionId: data.id,
        pairCode,
        topic: topicFor(data.id, roomToken),
        studioToken,
        pairExpiresAt: data.pair_expires_at,
        expiresAt: data.expires_at,
      });
    }

    if (error?.code !== "23505") {
      throw error;
    }
  }

  return respond({ error: "Could not allocate a pairing code." }, 503);
}

async function pairSession(req: Request, body: Record<string, unknown>) {
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) {
    return respond({ error: "Enter the 6-digit pairing code." }, 400);
  }

  const fingerprint = await requestFingerprint(req, "pair");
  const recentAttempts = await attemptCount(fingerprint, 5);
  if (recentAttempts >= 10) {
    return respond({ error: "Too many pairing attempts. Wait a few minutes." }, 429);
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("lumarig_remote_sessions")
    .select("id, room_token, studio_name, expires_at, paired_count")
    .eq("pair_code", code)
    .eq("active", true)
    .gt("pair_expires_at", now)
    .gt("expires_at", now)
    .maybeSingle();

  const success = Boolean(data && !error);
  await logAttempt(fingerprint, success);

  if (error) throw error;
  if (!data) {
    return respond({ error: "Pairing code is invalid or expired." }, 404);
  }

  if (Number(data.paired_count ?? 0) >= 6) {
    return respond(
      { error: "This pairing code has reached its device limit. Generate a new code in Studio." },
      409,
    );
  }

  await admin
    .from("lumarig_remote_sessions")
    .update({
      paired_count: Number(data.paired_count ?? 0) + 1,
      last_seen_at: now,
    })
    .eq("id", data.id);

  return respond({
    sessionId: data.id,
    studioName: data.studio_name,
    topic: topicFor(data.id, data.room_token),
    expiresAt: data.expires_at,
  });
}

async function rotatePairCode(body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "");
  const studioToken = String(body.studioToken ?? "");

  const session = await authorizedStudioSession(sessionId, studioToken);
  if (!session) {
    return respond({ error: "Session authorization failed." }, 401);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pairCode = randomDigits(6);
    const pairExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    const { data, error } = await admin
      .from("lumarig_remote_sessions")
      .update({
        pair_code: pairCode,
        pair_expires_at: pairExpiresAt,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("active", true)
      .select("id, room_token, expires_at")
      .single();

    if (!error && data) {
      return respond({
        sessionId: data.id,
        pairCode,
        topic: topicFor(data.id, data.room_token),
        studioToken,
        pairExpiresAt,
        expiresAt: data.expires_at,
      });
    }

    if (error?.code !== "23505") {
      throw error;
    }
  }

  return respond({ error: "Could not rotate pairing code." }, 503);
}

async function heartbeatSession(body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "");
  const studioToken = String(body.studioToken ?? "");

  const session = await authorizedStudioSession(sessionId, studioToken);
  if (!session) {
    return respond({ error: "Session authorization failed." }, 401);
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("lumarig_remote_sessions")
    .update({ last_seen_at: now })
    .eq("id", sessionId)
    .eq("active", true);

  if (error) throw error;
  return respond({ ok: true, at: now });
}

async function closeSession(body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "");
  const studioToken = String(body.studioToken ?? "");

  const session = await authorizedStudioSession(sessionId, studioToken);
  if (!session) {
    return respond({ error: "Session authorization failed." }, 401);
  }

  const { error } = await admin
    .from("lumarig_remote_sessions")
    .update({ active: false, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) throw error;
  return respond({ ok: true });
}

async function authorizedStudioSession(sessionId: string, studioToken: string) {
  if (!isUuid(sessionId) || studioToken.length < 20) return null;

  const { data, error } = await admin
    .from("lumarig_remote_sessions")
    .select("id, studio_token_hash, expires_at")
    .eq("id", sessionId)
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const incomingHash = await sha256(studioToken);
  return timingSafeEqual(incomingHash, data.studio_token_hash) ? data : null;
}

async function cleanupExpiredData() {
  const attemptsBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const sessionsBefore = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();

  const [{ error: attemptsError }, { error: sessionsError }] = await Promise.all([
    admin
      .from("lumarig_remote_pair_attempts")
      .delete()
      .lt("attempted_at", attemptsBefore),
    admin
      .from("lumarig_remote_sessions")
      .delete()
      .lt("expires_at", sessionsBefore),
  ]);

  if (attemptsError) console.warn("pair-attempt cleanup failed", attemptsError);
  if (sessionsError) console.warn("session cleanup failed", sessionsError);
}

async function attemptCount(fingerprint: string, minutes: number) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await admin
    .from("lumarig_remote_pair_attempts")
    .select("id", { count: "exact", head: true })
    .eq("fingerprint", fingerprint)
    .gte("attempted_at", since);

  if (error) throw error;
  return count ?? 0;
}

async function logAttempt(fingerprint: string, success: boolean) {
  const { error } = await admin
    .from("lumarig_remote_pair_attempts")
    .insert({ fingerprint, success });

  if (error) throw error;
}

async function requestFingerprint(req: Request, action: string) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwarded ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return sha256(action + ":" + ip);
}

function topicFor(sessionId: string, roomToken: string) {
  return "lumarig:" + sessionId + ":" + roomToken;
}

function randomDigits(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => String(value % 10)).join("");
}

function randomToken(bytesLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}
