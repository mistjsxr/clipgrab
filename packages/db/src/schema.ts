import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const userConfigs = pgTable('user_configs', {
  id: text('id').primaryKey(),
  passId: text('pass_id').notNull(),
  downloadPath: text('download_path'),
  autoDownload: integer('auto_download').default(1).notNull(), // 1 = true, 0 = false
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deviceNodes = pgTable('device_nodes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'desktop' | 'mobile' | 'extension'
  lastSeen: timestamp('last_seen').defaultNow().notNull(),
  metadata: jsonb('metadata'),
});

export const mediaQueue = pgTable('media_queue', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title'),
  platform: text('platform').notNull(), // 'youtube' | 'twitter' | 'tiktok' | 'instagram' | 'direct' | 'unknown'
  status: text('status').notNull().default('pending'), // 'pending' | 'downloading' | 'completed' | 'failed'
  requestedByDeviceId: text('requested_by_device_id').notNull(),
  progress: integer('progress').default(0).notNull(),
  filePath: text('file_path'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clipboards = pgTable('clipboards', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  deviceId: text('device_id').notNull(),
  isUrl: integer('is_url').default(0).notNull(), // 1 = true, 0 = false
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const mediaHistory = pgTable('media_history', {
  id: text('id').primaryKey(),
  batchId: text('batch_id'),
  actionType: text('action_type'), // 'CLEAR_WORKSPACE' | 'CLEAR_COMPLETED' | 'BULK_DELETE' | 'SINGLE_DELETE'
  originalJobId: text('original_job_id'),
  url: text('url').notNull(),
  title: text('title'),
  platform: text('platform').notNull(),
  finalStatus: text('final_status').notNull(), // 'completed' | 'failed' | 'cleared'
  filePath: text('file_path'),
  requestedByDeviceId: text('requested_by_device_id').notNull(),
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
});
