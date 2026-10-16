import { query, pool } from "./db.js";

const provider = process.argv[2];
const subject = process.argv[3];
if (!["local", "mutsaki"].includes(provider) || !subject) {
  console.error("Usage: npm run set-owner --workspace server -- <local|mutsaki> <subject>");
  process.exit(1);
}

const result = await query(
  `update users u set role='owner', can_create_room=true
   from auth_identities i
   where i.user_id=u.id and i.provider=$1 and i.subject=$2
   returning u.id, u.display_name as "displayName"`,
  [provider, subject]
);
if (!result.rows[0]) {
  console.error("Account not found. Ask the user to log in once, then run list-accounts.");
  process.exitCode = 1;
} else {
  console.log(`Owner account ready: ${result.rows[0].displayName}`);
}
await pool.end();
