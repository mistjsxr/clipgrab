import { neon } from '@neondatabase/serverless';

export async function initializeDatabaseTables(databaseUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sql = neon(databaseUrl);

    // Run table initialization Drizzle-equivalent DDL directly over Neon HTTP
    await sql`
      CREATE TABLE IF NOT EXISTS user_configs (
        id TEXT PRIMARY KEY,
        pass_id TEXT NOT NULL,
        download_path TEXT,
        auto_download INTEGER DEFAULT 1 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updatedAt TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS device_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        last_seen TIMESTAMP DEFAULT NOW() NOT NULL,
        metadata JSONB
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS media_queue (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        platform TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        requested_by_device_id TEXT NOT NULL,
        progress INTEGER DEFAULT 0 NOT NULL,
        file_path TEXT,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS clipboards (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        device_id TEXT NOT NULL,
        is_url INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS media_history (
        id TEXT PRIMARY KEY,
        batch_id TEXT,
        action_type TEXT,
        original_job_id TEXT,
        url TEXT NOT NULL,
        title TEXT,
        platform TEXT NOT NULL,
        final_status TEXT NOT NULL,
        file_path TEXT,
        requested_by_device_id TEXT NOT NULL,
        archived_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    // Ensure columns exist on existing databases
    await sql`ALTER TABLE media_history ADD COLUMN IF NOT EXISTS batch_id TEXT;`;
    await sql`ALTER TABLE media_history ADD COLUMN IF NOT EXISTS action_type TEXT;`;

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to initialize database tables' };
  }
}
