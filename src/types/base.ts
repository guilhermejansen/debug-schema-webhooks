/**
 * Tipos base para o sistema de mapeamento de webhooks WhatsApp
 */

// Tipos de logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  eventType?: string | undefined;
  duration?: number | undefined;
  action?: string | undefined;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  context?: LogContext | undefined;
  error?: {
    name: string;
    message: string;
    stack?: string | undefined;
  } | undefined;
}

// Estrutura de evento analisada
export interface EventStructure {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'union';
  optional: boolean;
  children?: Map<string, EventStructure> | undefined;
  arrayItemType?: EventStructure | undefined;
  examples: any[];
  isTruncated?: boolean | undefined;
  originalType?: string | undefined;
}

// Configuração de truncamento
export interface TruncateConfig {
  maxLength: number;
  fields: string[];
  preserveStructure: boolean;
}

// Metadata de truncamento
export interface TruncateMetadata {
  hasTruncated: boolean;
  truncatedFields: TruncatedField[];
  originalSize: number;
  truncatedSize: number;
}

export interface TruncatedField {
  path: string;
  originalLength: number;
  truncatedLength: number;
  type: 'base64' | 'json' | 'text';
}

// Resultado da análise de evento
export interface EventAnalysisResult {
  structure: EventStructure;
  eventType: string;
  truncateMetadata: TruncateMetadata;
}

// Schema gerado
export interface GeneratedSchema {
  zodSchema: string;
  tsInterface: string;
  examples: any;
  metadata: EventMetadata;
  rawSample?: any | undefined;
}

// Metadata de evento
export interface EventMetadata {
  eventType: string;
  firstSeen: string;
  lastSeen: string;
  totalReceived: number;
  schemaVersion: number;
  lastModified: string;
  fields: {
    required: string[];
    optional: string[];
    truncated: string[];
  };
  variations: SchemaVariation[];
}

export interface SchemaVariation {
  hash: string;
  count: number;
  description: string;
}

// Diferenças entre estruturas
export type StructureDifference = 
  | { type: 'type_change'; path: string; oldType: string; newType: string; }
  | { type: 'optional_change'; path: string; wasOptional: boolean; isOptional: boolean; }
  | { type: 'field_added'; path: string; field: string; }
  | { type: 'field_removed'; path: string; field: string; };

// Resultado de processamento
export interface ProcessResult<T> {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
  metadata: ProcessMetadata;
}

export interface ProcessMetadata {
  processingTime: number;
  timestamp: string;
  version: string;
}

// Configuração da aplicação
export interface AppConfig {
  server: {
    port: number;
    host: string;
    bodyLimit: number;
  };
  redis: {
    host: string;
    port: number;
  };
  database: {
    path: string;
  };
  truncate: TruncateConfig;
  queue: {
    concurrency: number;
    maxAttempts: number;
    backoffDelay: number;
  };
  files: {
    maxRawSamples: number;
    maxExamplesPerSchema: number;
  };
}

// Error customizado para webhook processing
export class WebhookProcessingError extends Error {
  constructor(
    message: string,
    public readonly eventType: string,
    public readonly originalError?: Error | undefined,
    public readonly context?: Record<string, any> | undefined
  ) {
    super(message);
    this.name = 'WebhookProcessingError';
  }
}

// Result pattern para operações que podem falhar
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

// Tipos para API responses
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string | undefined;
  timestamp: string;
}

// Tipos para dashboard
export interface EventSummary {
  id: string;
  eventType: string;
  timestamp: string;
  truncated: boolean;
  size: number;
  schemaVersion: number;
}

export interface EventStats {
  totalEvents: number;
  uniqueEventTypes: number;
  eventsLastHour: number;
  eventsLastDay: number;
  averageProcessingTime: number;
  queueSize: number;
  diskUsage: {
    schemas: number;
    logs: number;
    database: number;
  };
}

export interface SchemaData {
  eventType: string;
  zodSchema: string;
  tsInterface: string;
  examples: any;
  metadata: EventMetadata;
}

export interface EventTimeData {
  hour: number;
  count: number;
  avgSize: number;
}
