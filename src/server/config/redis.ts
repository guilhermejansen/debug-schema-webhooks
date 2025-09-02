import { Redis } from 'ioredis';
import { Logger } from '@/server/utils/Logger';
import { env } from './env';

/**
 * Configuração e gerenciamento de conexões Redis
 */
export class RedisManager {
  private static instance: RedisManager;
  private client: Redis | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('RedisManager');
  }

  static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  /**
   * Conecta ao Redis
   */
  async connect(): Promise<void> {
    if (this.client) {
      this.logger.debug('Redis already connected');
      return;
    }

    try {
      this.client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 30000,
        commandTimeout: 30000,
        enableReadyCheck: false
      });

      // Event listeners
      this.client.on('connect', () => {
        this.logger.info('Connected to Redis', {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT
        });
      });

      this.client.on('error', (error) => {
        this.logger.error('Redis connection error', error);
      });

      this.client.on('reconnecting', (timeToReconnect: number) => {
        this.logger.warn('Reconnecting to Redis', {
          timeToReconnect
        });
      });

      this.client.on('end', () => {
        this.logger.info('Redis connection ended');
      });

      // Conecta efetivamente
      await this.client.connect();

      this.logger.info('Redis connection established successfully');

    } catch (error) {
      this.logger.error('Failed to connect to Redis', error as Error);
      throw error;
    }
  }

  /**
   * Obtém o cliente Redis
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Verifica se está conectado
   */
  isConnected(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  /**
   * Testa a conectividade
   */
  async ping(): Promise<boolean> {
    try {
      if (!this.client) return false;
      
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis ping failed', error as Error);
      return false;
    }
  }

  /**
   * Obtém informações do servidor Redis
   */
  async getServerInfo(): Promise<Record<string, string>> {
    try {
      if (!this.client) return {};
      
      const info = await this.client.info();
      const lines = info.split('\r\n');
      const result: Record<string, string> = {};
      
      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          if (key && value) {
            result[key] = value;
          }
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error('Failed to get Redis server info', error as Error);
      return {};
    }
  }

  /**
   * Obtém estatísticas de uso de memória
   */
  async getMemoryStats(): Promise<{
    used: number;
    peak: number;
    total: number;
    fragmentation: number;
  }> {
    try {
      if (!this.client) {
        return { used: 0, peak: 0, total: 0, fragmentation: 0 };
      }
      
      const info = await this.getServerInfo();
      
      return {
        used: parseInt(info['used_memory'] || '0'),
        peak: parseInt(info['used_memory_peak'] || '0'),
        total: parseInt(info['total_system_memory'] || '0'),
        fragmentation: parseFloat(info['mem_fragmentation_ratio'] || '0')
      };
    } catch (error) {
      this.logger.error('Failed to get Redis memory stats', error as Error);
      return { used: 0, peak: 0, total: 0, fragmentation: 0 };
    }
  }

  /**
   * Limpa todos os dados (usar com cuidado!)
   */
  async flushAll(): Promise<void> {
    try {
      if (!this.client) return;
      
      await this.client.flushall();
      this.logger.warn('Redis database flushed - all data cleared');
    } catch (error) {
      this.logger.error('Failed to flush Redis database', error as Error);
      throw error;
    }
  }

  /**
   * Lista todas as chaves com padrão
   */
  async getKeys(pattern: string = '*'): Promise<string[]> {
    try {
      if (!this.client) return [];
      
      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.error('Failed to get Redis keys', error as Error);
      return [];
    }
  }

  /**
   * Obtém valor de uma chave
   */
  async get(key: string): Promise<string | null> {
    try {
      if (!this.client) return null;
      
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Failed to get Redis key: ${key}`, error as Error);
      return null;
    }
  }

  /**
   * Define valor de uma chave
   */
  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (!this.client) return false;
      
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to set Redis key: ${key}`, error as Error);
      return false;
    }
  }

  /**
   * Remove uma chave
   */
  async delete(key: string): Promise<boolean> {
    try {
      if (!this.client) return false;
      
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to delete Redis key: ${key}`, error as Error);
      return false;
    }
  }

  /**
   * Verifica se uma chave existe
   */
  async exists(key: string): Promise<boolean> {
    try {
      if (!this.client) return false;
      
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to check Redis key existence: ${key}`, error as Error);
      return false;
    }
  }

  /**
   * Incrementa um contador
   */
  async increment(key: string, value: number = 1): Promise<number> {
    try {
      if (!this.client) return 0;
      
      return await this.client.incrby(key, value);
    } catch (error) {
      this.logger.error(`Failed to increment Redis key: ${key}`, error as Error);
      return 0;
    }
  }

  /**
   * Adiciona item a uma lista
   */
  async listPush(key: string, value: string): Promise<number> {
    try {
      if (!this.client) return 0;
      
      return await this.client.lpush(key, value);
    } catch (error) {
      this.logger.error(`Failed to push to Redis list: ${key}`, error as Error);
      return 0;
    }
  }

  /**
   * Remove item de uma lista
   */
  async listPop(key: string): Promise<string | null> {
    try {
      if (!this.client) return null;
      
      return await this.client.rpop(key);
    } catch (error) {
      this.logger.error(`Failed to pop from Redis list: ${key}`, error as Error);
      return null;
    }
  }

  /**
   * Obtém tamanho de uma lista
   */
  async listLength(key: string): Promise<number> {
    try {
      if (!this.client) return 0;
      
      return await this.client.llen(key);
    } catch (error) {
      this.logger.error(`Failed to get Redis list length: ${key}`, error as Error);
      return 0;
    }
  }

  /**
   * Fecha a conexão
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.logger.info('Redis connection closed');
    }
  }
}

// Função utilitária para inicializar Redis
export async function initRedis(): Promise<RedisManager> {
  const redis = RedisManager.getInstance();
  
  if (!redis.isConnected()) {
    await redis.connect();
  }
  
  return redis;
}

// Exporta instância singleton para uso direto
export const redis = RedisManager.getInstance();
