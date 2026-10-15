import jwt from "jsonwebtoken";
import { query } from "./db.js";

const jwtSecret = process.env.JWT_SECRET;

export function signUser(user) {
  return jwt.sign({ id: user.id }, jwtSecret, { expiresIn: "7d" });
}

export async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return res.status(401).json({ error: "请先登录" });

  try {
    const payload = jwt.verify(token, jwtSecret);
    const result = await query(
      "select id, username, role, can_create_room as \"canCreateRoom\" from users where id=$1",
      [payload.id]
    );

    if (!result.rows[0]) return res.status(401).json({ error: "账号不存在" });

    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    canCreateRoom: user.canCreateRoom ?? user.can_create_room
  };
}
