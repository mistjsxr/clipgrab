import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export function createNeonClient(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export async function verifyNeonConnection(databaseUrl: string): Promise<boolean> {
  try {
    const sql = neon(databaseUrl);
    const result = await sql`SELECT 1 as connected`;
    return Array.isArray(result) && result.length > 0;
  } catch (error) {
    console.error('Neon DB Connection verification failed:', error);
    return false;
  }
}

export type NeonClient = ReturnType<typeof createNeonClient>;
