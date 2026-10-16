import { query, pool } from "./db.js";

const result = await query(
  `select i.provider, i.subject, u.display_name as "displayName", u.role
   from auth_identities i join users u on u.id=i.user_id
   order by i.provider, u.created_at`
);
console.table(result.rows);
await pool.end();
