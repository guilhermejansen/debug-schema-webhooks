import * as sqlite3 from 'sqlite3';
import { Logger } from '@/server/utils/Logger';
import { env } from './env';

/**
 * Configuração e inicialização do banco SQLite
 */
export class Database {
  private static instance: Database;
  private db: sqlite3.Database | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('Database');
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  /**
   * Conecta ao banco de dados SQLite
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(env.DATABASE_PATH, (err) => {
        if (err) {
          this.logger.error('Failed to connect to database', err);
          reject(err);
        } else {
          this.logger.info('Connected to SQLite database', {
            path: env.DATABASE_PATH
          });
          resolve();
        }
      });
    });
  }

  /**
   * Inicializa as tabelas do banco
   */
  async initialize(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    const tables = [
      this.createEventsTable(),
      this.createSchemasTable(),
      this.createMetricsTable()
    ];

    for (const tableQuery of tables) {
      await this.run(tableQuery);
    }

    this.logger.info('Database tables initialized');
  }

  /**
   * Cria tabela de eventos
   */
  private createEventsTable(): string {
    return `
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        original_size INTEGER NOT NULL,
        truncated_size INTEGER NOT NULL,
        has_truncated BOOLEAN NOT NULL DEFAULT 0,
        truncated_fields_count INTEGER NOT NULL DEFAULT 0,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        processing_duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * Cria tabela de schemas
   */
  private createSchemasTable(): string {
    return `
      CREATE TABLE IF NOT EXISTS schemas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT UNIQUE NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        structure_hash TEXT NOT NULL,
        first_seen DATETIME NOT NULL,
        last_seen DATETIME NOT NULL,
        last_modified DATETIME NOT NULL,
        total_received INTEGER NOT NULL DEFAULT 0,
        required_fields_count INTEGER NOT NULL DEFAULT 0,
        optional_fields_count INTEGER NOT NULL DEFAULT 0,
        truncated_fields_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * Cria tabela de métricas
   */
  private createMetricsTable(): string {
    return `
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        metric_type TEXT NOT NULL, -- 'counter', 'gauge', 'histogram'
        tags TEXT, -- JSON string with tags
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  /**
   * Executa uma query SQL
   */
  async run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Executa uma query que retorna uma linha
   */
  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  /**
   * Executa uma query que retorna múltiplas linhas
   */
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not connected'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  /**
   * Fecha a conexão com o banco
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            this.logger.error('Error closing database', err);
          } else {
            this.logger.info('Database connection closed');
          }
          this.db = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Verifica se o banco está conectado
   */
  isConnected(): boolean {
    return this.db !== null;
  }
}

// Função utilitária para inicializar o banco
export async function initDatabase(): Promise<Database> {
  const db = Database.getInstance();
  
  if (!db.isConnected()) {
    await db.connect();
    await db.initialize();
  }
  
  return db;
}
