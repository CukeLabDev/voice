import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const username = process.argv[2];
let password = process.argv[3];

if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
  console.error("Usage: npm run create-owner --workspace server -- <3-20 character username>");
  process.exit(1);
}

if (!password) {
  if (!process.stdin.isTTY) {
    console.error("An interactive terminal is required to enter the owner password.");
    process.exit(1);
  }
  password = await new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = process.stdin.isRaw;
    process.stdout.write("Owner password (input hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Cancelled"));
        if (char === "\u0008" || char === "\u007f") value = value.slice(0, -1);
        else if (char >= " " && value.length < 256) value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

if (password.length < 8) {
  console.error("Owner password must contain at least 8 characters.");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 10);

const client = await pool.connect();
try {
  await client.query("begin");
  const result = await client.query(
    `insert into users (username, display_name, password_hash, role, can_create_room)
     values ($1, $1, $2, 'owner', true)
     on conflict (username)
     do update set password_hash=excluded.password_hash, role='owner', can_create_room=true
     returning id`,
    [username, passwordHash]
  );
  await client.query(
    "insert into auth_identities (provider, subject, user_id) values ('local', $1, $2) on conflict do nothing",
    [username, result.rows[0].id]
  );
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}

console.log(`Owner account ready: ${username}`);
await pool.end();
