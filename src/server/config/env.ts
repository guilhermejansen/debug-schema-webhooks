import { z } from 'zod';
import { AppConfig } from '@/types/base';

// Schema de validação para variáveis de ambiente
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Database
  DATABASE_PATH: z.string().default('./data/database.sqlite'),
  
  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  
  // Security
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),
  
  // Truncate Configuration
  TRUNCATE_MAX_LENGTH: z.coerce.number().default(100),
  TRUNCATE_FIELDS: z.string().default('base64,JPEGThumbnail,thumbnail,data,image'),
  
  // File Management
  MAX_RAW_SAMPLES: z.coerce.number().default(10),
  MAX_EXAMPLES_PER_SCHEMA: z.coerce.number().default(20),
  
  // Queue Configuration
  QUEUE_CONCURRENCY: z.coerce.number().default(5),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().default(3),
  QUEUE_BACKOFF_DELAY: z.coerce.number().default(2000),
  
  // Monitoring
  ENABLE_METRICS: z.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9090)
});

// Valida as variáveis de ambiente
function validateEnv(): z.infer<typeof envSchema> {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    console.error('❌ Invalid environment variables:', error);
    process.exit(1);
  }
}

// Variáveis de ambiente validadas
export const env = validateEnv();

// Configuração da aplicação derivada das variáveis de ambiente
export function createAppConfig(): AppConfig {
  const truncateFields = env.TRUNCATE_FIELDS.split(',').map(field => field.trim());
  
  return {
    server: {
      port: env.PORT,
      host: env.HOST,
      bodyLimit: 100 * 1024 * 1024 // 100MB
    },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT
    },
    database: {
      path: env.DATABASE_PATH
    },
    truncate: {
      maxLength: env.TRUNCATE_MAX_LENGTH,
      fields: truncateFields,
      preserveStructure: true
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
      maxAttempts: env.QUEUE_MAX_ATTEMPTS,
      backoffDelay: env.QUEUE_BACKOFF_DELAY
    },
    files: {
      maxRawSamples: env.MAX_RAW_SAMPLES,
      maxExamplesPerSchema: env.MAX_EXAMPLES_PER_SCHEMA
    }
  };
}

// Helper para verificar se estamos em desenvolvimento
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
