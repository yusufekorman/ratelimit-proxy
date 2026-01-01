import Fastify from "fastify";
import Redis from "ioredis";
import crypto from "crypto";
import Joi from "joi";

const app = Fastify({ logger: true });

/* =======================
   REDIS + IN-MEMORY FALLBACK
======================= */
let redis: Redis | null = null;
let redisConnected = false;

// In-memory fallback store
const memoryStore = new Map<string, { count: number; expiresAt: number }>();

// Memory store cleanup interval (her 10 saniyede expired key'leri temizle)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore) {
    if (value.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 10_000);

// Redis bağlantısı
function connectRedis() {
  if (!process.env.REDIS_URL) {
    console.warn("REDIS_URL not set, using in-memory fallback");
    return;
  }

  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null; // 3 denemeden sonra vazgeç
      return Math.min(times * 200, 2000);
    },
    enableOfflineQueue: false,
  });

  redis.on("connect", () => {
    redisConnected = true;
    console.log("Redis connected");
  });

  redis.on("error", (err) => {
    redisConnected = false;
    console.error("Redis error:", err.message);
  });

  redis.on("close", () => {
    redisConnected = false;
    console.warn("Redis disconnected, using in-memory fallback");
  });
}

connectRedis();

/* =======================
   CONFIG
======================= */
if (!process.env.RL_SECRET) {
  console.error("❌ FATAL: RL_SECRET environment variable is required!");
  process.exit(1);
}

const SHARED_SECRET = process.env.RL_SECRET;
const MAX_CLOCK_SKEW_MS = 30_000; // 30 sn

console.log("✅ Rate Limit Service Configuration:", {
  redisUrl: process.env.REDIS_URL
    ? "Configured"
    : "Not configured (using memory)",
  secretLength: SHARED_SECRET.length,
  maxClockSkew: MAX_CLOCK_SKEW_MS,
  port: 3001,
});

/* =======================
   REDIS LUA SCRIPT (Atomic INCR + EXPIRE)
======================= */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local duration = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, duration)
end

local ttl = redis.call('TTL', key)
return {current, ttl}
`;

/* =======================
   UTILS
======================= */
function hmac(data: string) {
  return crypto.createHmac("sha256", SHARED_SECRET).update(data).digest("hex");
}

// Rate limit işlemi (Redis veya Memory)
async function rateLimit(
  key: string,
  limit: number,
  duration: number
): Promise<{ current: number; ttl: number }> {
  // Redis bağlıysa Redis kullan
  if (redis && redisConnected) {
    try {
      const result = (await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        limit,
        duration
      )) as [number, number];
      return { current: result[0], ttl: result[1] };
    } catch (err) {
      console.error("Redis eval error, falling back to memory:", err);
      // Redis hatası, memory'ye fall through
    }
  }

  // In-memory fallback
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (existing && existing.expiresAt > now) {
    existing.count++;
    return {
      current: existing.count,
      ttl: Math.ceil((existing.expiresAt - now) / 1000),
    };
  }

  // Yeni key
  memoryStore.set(key, {
    count: 1,
    expiresAt: now + duration * 1000,
  });

  return { current: 1, ttl: duration };
}

/* =======================
   AUTH + HMAC GUARD
======================= */
app.addHook("preHandler", async (req, reply) => {
  // Health endpoint için sadece Bearer token yeterli
  if (req.routeOptions.url === "/health") {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${SHARED_SECRET}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return; // Diğer kontrolleri atla
  }

  const auth = req.headers.authorization;
  const ts = Number(req.headers["x-timestamp"]);
  const sig = req.headers["x-signature"];

  if (!auth || auth !== `Bearer ${SHARED_SECRET}`) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  if (!ts || !sig) {
    return reply.status(400).send({ error: "Missing signature" });
  }

  if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return reply.status(401).send({ error: "Expired request" });
  }

  const expected = hmac(ts.toString());
  if (sig !== expected) {
    return reply.status(401).send({ error: "Invalid signature" });
  }
});

/* =======================
   RATE LIMIT ENDPOINT
======================= */
const rateLimitSchema = Joi.object({
  key: Joi.string().min(1).required(),
  points: Joi.number().integer().min(1).optional(),
  duration: Joi.number().integer().min(1).optional(),
});

app.post("/ratelimit", async (req, reply) => {
  const { error, value } = rateLimitSchema.validate(req.body);
  if (error) {
    console.warn("[VALIDATION ERROR]", error.details?.[0]?.message);
    return reply
      .status(400)
      .send({ error: error.details?.[0]?.message || "Validation error" });
  }

  const { key, points = 100, duration = 60 } = value;
  console.log("[RATE LIMIT CHECK]", { key, points, duration });

  const redisKey = `rl:${key}`;
  const { current, ttl } = await rateLimit(redisKey, points, duration);

  console.log("[RATE LIMIT RESULT]", {
    key,
    current,
    points,
    allowed: current <= points,
    ttl,
  });

  if (current > points) {
    return reply.status(429).send({
      allowed: false,
      retryAfter: ttl,
    });
  }

  return {
    allowed: true,
    remaining: points - current,
  };
});

/* =======================
   HEALTH CHECK
======================= */
app.get("/health", async () => {
  // get all rl:* keys and values from redis or memory

  const keys: Record<string, any> = {};
  if (redis && redisConnected) {
    const redisKeys = await redis.keys("rl:*");

    if (redisKeys.length > 0) {
      const redisValues = await redis.mget(...redisKeys);
      redisKeys.forEach((k, i) => {
        keys[k] = redisValues[i];
      });
    }
  } else {
    for (const [k, v] of memoryStore) {
      keys[`rl:${k}`] = v;
    }
  }

  return {
    status: "ok",
    redis: redisConnected
      ? "connected"
      : "disconnected (using memory fallback)",
    keys,
  };
});

/* =======================
   START
======================= */
app.listen({ port: 3001, host: "0.0.0.0" });
