export type DeviceType = 'desktop' | 'mobile' | 'extension';

export interface DeviceNode {
  id: string;
  name: string;
  type: DeviceType;
  lastSeen: string;
}

export type MediaJobStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface MediaJob {
  id: string;
  url: string;
  title?: string;
  platform: 'youtube' | 'twitter' | 'tiktok' | 'instagram' | 'direct' | 'unknown';
  status: MediaJobStatus;
  requestedByDeviceId: string;
  progress?: number;
  filePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PairingPayload {
  databaseUrl: string;
  passId: string;
  createdAt: string;
}
