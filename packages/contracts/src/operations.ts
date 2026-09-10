export interface OperationalCheckDto {
  status: 'ok' | 'warning' | 'failed' | 'unconfigured'
  message: string
  value?: number
}

export interface OperationsStatusDto {
  sampledAt: string
  startedAt: string
  checks: Record<'database' | 'storage' | 'videoQueue' | 'ffmpeg' | 'mail' | 'backup' | 'maintenance', OperationalCheckDto>
  http: { requests: number; errors5xx: number; windowSeconds: number }
  backup: { snapshotAt: string | null; verifiedAt: string | null; snapshotId: string | null }
  targets: { rpoSeconds: 3600; rtoSeconds: 14400; verified: false }
}
