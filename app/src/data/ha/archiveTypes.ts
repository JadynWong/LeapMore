export type SyncOrigin = 'leapmotor_cloud' | 'phone_gnss' | 'ha_cloud';
export type SyncFidelity = 'native_raw' | 'legacy_processed' | 'legacy_partial' | 'legacy_summary';
export type SyncEntityType = 'observation' | 'record' | 'capture_event';
export type SyncRecordKind = 'trip' | 'charge';
export type SyncChangeOp = 'observation.upsert' | 'observation.delete' | 'record.upsert' | 'record.delete' | 'capture_event.append';

export interface RawObservation {
  observation_id: string;
  vehicle_id: string;
  origin: SyncOrigin;
  fidelity: SyncFidelity;
  field_schema: string;
  layout: 'signal_map' | 'named_signal' | 'named_data' | 'legacy_points';
  coordinate_system: 'gcj02' | 'wgs84' | 'unknown';
  received_at_ms: number;
  source_timestamps: Record<string, number | string>;
  signals_raw: Record<string, unknown>;
  legacy_record?: unknown;
}

export interface RawRecord {
  record_id: string;
  vehicle_id: string;
  kind: SyncRecordKind;
  phase: 'recording' | 'completed' | 'partial';
  revision: number;
  boundary_hint?: Record<string, unknown>;
  observation_refs?: string[];
  algorithm_version?: string;
  legacy?: boolean;
}

export interface CaptureEvent {
  event_id: string;
  vehicle_id: string;
  kind: 'collector_started' | 'collector_stopped' | 'poll_success' | 'poll_failed' | 'vehicle_unavailable' | 'archive_recovered';
  at_ms: number;
  detail?: Record<string, unknown>;
}

export interface SyncChange {
  seq: number;
  op: SyncChangeOp;
  entity_id: string;
  data: RawObservation | RawRecord | CaptureEvent;
}

export interface SyncScope {
  sourceId: string;
  datasetId: string;
  vehicleId: string;
}

export interface SyncStoreCounts {
  observations: number;
  records: number;
  captureEvents: number;
}

export interface StoredObservation extends RawObservation {
  source_id: string;
  dataset_id: string;
  stored_at_ms: number;
}

export interface StoredRecord extends RawRecord {
  source_id: string;
  dataset_id: string;
}

export interface SyncStatus {
  cursor: string | null;
  snapshotState: string | null;
  bootstrapId: string | null;
  lastSyncAt: number | null;
  errorCode: string | null;
  counts: SyncStoreCounts;
}
