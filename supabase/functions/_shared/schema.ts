// Brings the database up to date the first time a function runs after an update,
// so updating the bot is only ever "deploy the functions". Best effort: if it
// cannot (no database address, no permission) the functions go on as they are,
// and the same statements can be run by hand from supabase/migrations.

import postgres from 'npm:postgres@3';
import { TASK_SETTINGS_PRESENT, TASK_SETTINGS_SQL } from './schema-sql.ts';

let done: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  done ??= update().catch((error) => console.error("schema update skipped:"));
  return done;
}

async function update(): Promise<void> {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) return;
  const db = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 8, prepare: false });
  try {
    const [row] = await db.unsafe(TASK_SETTINGS_PRESENT);
    if (!row?.present) {
      await db.unsafe(TASK_SETTINGS_SQL);
      console.log("schema updated: task settings");
    }
  } finally {
    await db.end({ timeout: 2 });
  }
}
