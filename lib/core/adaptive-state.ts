import crypto from "node:crypto";

type AnyRecord = Record<string, any>;

declare global {
  var __goldPulseAdaptiveState: { state: AnyRecord | null; lockUntil: number } | undefined;
}

type StateConnection = {
  configured: boolean;
  required: boolean;
  mode: "upstash" | "memory-fallback" | "unconfigured";
  url?: string;
  token?: string;
  key: string;
  lockKey: string;
};

const memory = globalThis.__goldPulseAdaptiveState || {
  state: null as AnyRecord | null,
  lockUntil: 0
};
globalThis.__goldPulseAdaptiveState = memory;

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

export function getAdaptiveStateConnection(): StateConnection {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  const required = booleanEnv("ADAPTIVE_STATE_REQUIRED", false);
  const configured = Boolean(url && token);
  const prefix = process.env.GOLD_PULSE_STATE_PREFIX || "gold-pulse:v10.2";
  return {
    configured,
    required,
    mode: configured ? "upstash" : required ? "unconfigured" : "memory-fallback",
    url: configured ? url.replace(/\/$/, "") : undefined,
    token: configured ? token : undefined,
    key: `${prefix}:adaptive:XAUUSD`,
    lockKey: `${prefix}:lock:XAUUSD`
  };
}

async function redisCommand(connection: StateConnection, command: Array<string | number>) {
  if (!connection.configured || !connection.url || !connection.token) {
    throw new Error("adaptive-state-not-configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(connection.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      throw new Error(body?.error || `adaptive-state-http-${response.status}`);
    }
    return body?.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function acquireAdaptiveLock(ttlSeconds = 25) {
  const connection = getAdaptiveStateConnection();
  if (connection.mode === "unconfigured") {
    return { acquired: false, mode: connection.mode, reason: "adaptive-state-not-configured", connection };
  }

  if (connection.mode === "memory-fallback") {
    const now = Date.now();
    if (memory.lockUntil > now) {
      return { acquired: false, mode: connection.mode, reason: "adaptive-state-lock-busy", connection };
    }
    memory.lockUntil = now + ttlSeconds * 1000;
    return { acquired: true, mode: connection.mode, token: crypto.randomUUID(), connection };
  }

  const token = crypto.randomUUID();
  const result = await redisCommand(connection, ["SET", connection.lockKey, token, "NX", "EX", ttlSeconds]);
  return {
    acquired: result === "OK",
    mode: connection.mode,
    reason: result === "OK" ? null : "adaptive-state-lock-busy",
    token,
    connection
  };
}

export async function readAdaptiveState(connection = getAdaptiveStateConnection()): Promise<AnyRecord | null> {
  if (connection.mode === "memory-fallback") return memory.state;
  if (connection.mode === "unconfigured") throw new Error("adaptive-state-not-configured");
  const value = await redisCommand(connection, ["GET", connection.key]);
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

export async function writeAdaptiveState(state: AnyRecord, connection = getAdaptiveStateConnection()) {
  if (connection.mode === "memory-fallback") {
    memory.state = state;
    return { ok: true, mode: connection.mode };
  }
  if (connection.mode === "unconfigured") throw new Error("adaptive-state-not-configured");
  await redisCommand(connection, ["SET", connection.key, JSON.stringify(state)]);
  return { ok: true, mode: connection.mode };
}

export async function checkAdaptiveStateConnection() {
  const connection = getAdaptiveStateConnection();
  if (connection.mode === "unconfigured") {
    return { ok: false, configured: false, mode: connection.mode, reason: "UPSTASH_REDIS_REST_URL/TOKEN missing" };
  }
  if (connection.mode === "memory-fallback") {
    return { ok: true, configured: false, mode: connection.mode, reason: "best-effort memory state; not durable across Vercel instances" };
  }
  try {
    const result = await redisCommand(connection, ["PING"]);
    return { ok: result === "PONG", configured: true, mode: connection.mode, reason: result === "PONG" ? null : "unexpected-ping-response" };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      mode: connection.mode,
      reason: error instanceof Error ? error.message : "adaptive-state-connection-failed"
    };
  }
}
