import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { AccessToken } from "livekit-server-sdk";
import { query } from "./db.js";
import { publicUser, requireUser } from "./auth.js";
import { installProviders } from "./providers/index.js";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

for (const key of ["JWT_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL"]) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (process.env.NODE_ENV === "production") {
  for (const key of ["JWT_SECRET", "LIVEKIT_API_SECRET"]) {
    if (process.env[key].length < 32 || process.env[key].startsWith("replace_")) {
      throw new Error(`${key} must be replaced with a random secret of at least 32 characters`);
    }
  }
  if (process.env.LIVEKIT_API_KEY.length < 12 || process.env.LIVEKIT_API_KEY.startsWith("replace_")) {
    throw new Error("LIVEKIT_API_KEY must be replaced with a random key of at least 12 characters");
  }
}

const app = express();
const port = Number(process.env.PORT || 4000);

app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

const authLimitMessage = { error: "操作太频繁，请稍后再试" };
const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false, message: authLimitMessage });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: authLimitMessage });

// Express 4 does not catch rejected promises from async handlers; forward them to the error handler
// instead of letting an unhandled rejection crash the process.
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.param("id", (req, res, next, id) => {
  if (!uuidPattern.test(id)) return res.status(404).json({ error: "资源不存在" });
  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

installProviders(app, { asyncRoute, registerLimit, loginLimit });

app.get("/me", requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/rooms", requireUser, asyncRoute(async (req, res) => {
  const result = await query(
    `select id, name, livekit_name as "livekitName", is_public as "isPublic",
            max_members as "maxMembers", created_by as "createdBy"
     from rooms
     order by is_public desc, created_at asc`
  );
  res.json({ rooms: result.rows });
}));

app.post("/rooms", requireUser, asyncRoute(async (req, res) => {
  if (req.user.role !== "owner" && !req.user.canCreateRoom) {
    return res.status(403).json({ error: "你还没有创建房间权限" });
  }

  const name = String(req.body.name || "").trim();
  const maxMembers = Math.max(2, Math.min(99, Number(req.body.maxMembers || 10)));

  if (name.length < 2 || name.length > 24) {
    return res.status(400).json({ error: "房间名需要 2-24 个字" });
  }

  const livekitName = `room_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const result = await query(
    `insert into rooms (name, livekit_name, max_members, created_by)
     values ($1, $2, $3, $4)
     returning id, name, livekit_name as "livekitName", is_public as "isPublic",
               max_members as "maxMembers", created_by as "createdBy"`,
    [name, livekitName, maxMembers, req.user.id]
  );

  res.json(result.rows[0]);
}));

app.delete("/rooms/:id", requireUser, asyncRoute(async (req, res) => {
  const roomResult = await query(
    "select id, is_public, created_by from rooms where id=$1",
    [req.params.id]
  );
  const room = roomResult.rows[0];

  if (!room) return res.status(404).json({ error: "房间不存在" });
  if (room.is_public) return res.status(400).json({ error: "公共房间不能删除" });
  if (req.user.role !== "owner" && room.created_by !== req.user.id) {
    return res.status(403).json({ error: "只能删除自己创建的房间" });
  }

  await query("delete from rooms where id=$1", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/rooms/:id/voice-token", requireUser, asyncRoute(async (req, res) => {
  const result = await query(
    "select id, livekit_name as \"livekitName\" from rooms where id=$1",
    [req.params.id]
  );
  const room = result.rows[0];
  if (!room) return res.status(404).json({ error: "房间不存在" });

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: req.user.id,
      name: req.user.displayName || req.user.username
    }
  );

  token.addGrant({
    roomJoin: true,
    room: room.livekitName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  res.json({
    token: await token.toJwt(),
    livekitUrl: process.env.LIVEKIT_URL
  });
}));

app.post("/admin/users/:id/create-room-permission", requireUser, asyncRoute(async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "只有 owner 可以授权" });

  const enabled = Boolean(req.body.enabled);
  const result = await query(
    `update users set can_create_room=$1 where id=$2
     returning id, username, role, can_create_room as "canCreateRoom"`,
    [enabled, req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ error: "用户不存在" });
  res.json({ user: publicUser(result.rows[0]) });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "服务器出错" });
});

app.listen(port, () => {
  console.log(`Koe API listening on http://localhost:${port}`);
});
