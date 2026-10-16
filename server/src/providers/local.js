import bcrypt from "bcryptjs";
import { pool, query } from "../db.js";
import { publicUser, signUser } from "../auth.js";

export const localProvider = {
  id: "local",
  label: "本地账号",
  install(app, { asyncRoute, registerLimit, loginLimit }) {
    app.post("/auth/register", registerLimit, asyncRoute(async (req, res) => {
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: "用户名只能用 3-20 位英文、数字或下划线" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "密码至少 8 位" });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `insert into users (username, display_name, password_hash)
           values ($1, $1, $2)
           returning id, username, display_name as "displayName", 'local' as provider,
                     role, can_create_room as "canCreateRoom"`,
          [username, passwordHash]
        );
        const user = result.rows[0];
        await client.query("insert into auth_identities (provider, subject, user_id) values ('local', $1, $2)", [username, user.id]);
        await client.query("commit");
        res.json({ user: publicUser(user), token: signUser(user) });
      } catch (error) {
        await client.query("rollback");
        if (error.code === "23505") return res.status(409).json({ error: "用户名已存在" });
        throw error;
      } finally {
        client.release();
      }
    }));

    app.post("/auth/login", loginLimit, asyncRoute(async (req, res) => {
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");
      const result = await query(
        `select id, username, display_name as "displayName", 'local' as provider, password_hash, role,
                can_create_room as "canCreateRoom"
         from users where username=$1 and password_hash is not null`,
        [username]
      );
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "用户名或密码不正确" });
      }
      res.json({ user: publicUser(user), token: signUser(user) });
    }));
  }
};
