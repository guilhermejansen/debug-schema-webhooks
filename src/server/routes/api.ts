import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FileManager } from '@/server/services/FileManager';
import { Database } from '@/server/config/database';
import { redis } from '@/server/config/redis';
import { Logger } from '@/server/utils/Logger';
import { EventStats, EventSummary, SchemaData } from '@/types/base';

/**
 * Rotas da API para consultar schemas e estatísticas
 */
export async function apiRoutes(app: FastifyInstance) {
  const logger = new Logger('ApiRoutes');
  const fileManager = new FileManager();
  const database = Database.getInstance();

  // Middleware para CORS específico da API
  app.addHook('preHandler', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (request.method === 'OPTIONS') {
      return reply.code(200).send();
    }
  });

  /**
   * Lista todos os tipos de eventos mapeados
   */
  app.get('/schemas', {
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        logger.debug('Fetching all schema types');
        
        const schemas = await fileManager.loadExistingSchemas();
        const schemaList = [];
        
        for (const [eventType, schema] of schemas) {
          const metadata = typeof schema.metadata === 'string' 
            ? JSON.parse(schema.metadata) 
            : schema.metadata;
          
          schemaList.push({
            eventType,
            schemaVersion: metadata.schemaVersion,
            totalReceived: metadata.totalReceived,
            lastSeen: metadata.lastSeen,
            hasTruncatedFields: metadata.fields.truncated.length > 0,
            fieldsCount: {
              required: metadata.fields.required.length,
              optional: metadata.fields.optional.length,
              truncated: metadata.fields.truncated.length
            }
          });
        }
        
        // Ordena por totalReceived (mais recebidos primeiro)
        schemaList.sort((a, b) => b.totalReceived - a.totalReceived);
        
        logger.info('Schema list retrieved', { count: schemaList.length });
        
        return reply.send({
          success: true,
          data: schemaList,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Failed to fetch schema list', error as Error);
        
        return reply.code(500).send({
          success: false,
          data: [],
          timestamp: new Date().toISOString(),
          error: 'Failed to fetch schemas'
        });
      }
    }
  });

  /**
   * Obtém schema específico por tipo de evento
   */
  app.get('/schemas/:eventType', {
    handler: async (request: FastifyRequest<{
      Params: { eventType: string }
    }>, reply: FastifyReply) => {
      try {
        const { eventType } = request.params;
        
        logger.debug('Fetching specific schema', { eventType });
        
        const schemas = await fileManager.loadExistingSchemas();
        const schema = schemas.get(eventType);
        
        if (!schema) {
          logger.warn('Schema not found', { eventType });
          
          return reply.code(404).send({
            success: false,
            error: `Schema not found for event type: ${eventType}`,
            timestamp: new Date().toISOString()
          });
        }
        
        const metadata = typeof schema.metadata === 'string'
          ? JSON.parse(schema.metadata)
          : schema.metadata;
        
        const schemaData: SchemaData = {
          eventType,
          zodSchema: schema.zodSchema,
          tsInterface: schema.tsInterface,
          examples: schema.examples,
          metadata
        };
        
        logger.info('Schema retrieved successfully', { eventType });
        
        return reply.send({
          success: true,
          data: schemaData,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Failed to fetch specific schema', error as Error, {
          eventType: request.params.eventType
        });
        
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch schema',
          timestamp: new Date().toISOString()
        });
      }
    }
  });

  /**
   * Obtém estatísticas gerais do sistema
   */
  app.get('/stats', {
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        logger.debug('Fetching system statistics');
        
        // Consultas paralelas para performance
        const [
          totalEventsResult,
          uniqueTypesResult,
          eventsLastHourResult,
          eventsLastDayResult,
          avgProcessingTimeResult,
          queueSize,
          diskUsage
        ] = await Promise.all([
          database.get<{ count: number }>('SELECT COUNT(*) as count FROM events'),
          database.get<{ count: number }>('SELECT COUNT(DISTINCT event_type) as count FROM events'),
          database.get<{ count: number }>(`
            SELECT COUNT(*) as count FROM events 
            WHERE received_at > datetime('now', '-1 hour')
          `),
          database.get<{ count: number }>(`
            SELECT COUNT(*) as count FROM events 
            WHERE received_at > datetime('now', '-1 day')
          `),
          database.get<{ avg: number }>(`
            SELECT AVG(processing_duration) as avg FROM events 
            WHERE processing_duration IS NOT NULL
          `),
          getQueueSize(),
          fileManager.getFileSystemStats()
        ]);
        
        const stats: EventStats = {
          totalEvents: totalEventsResult?.count || 0,
          uniqueEventTypes: uniqueTypesResult?.count || 0,
          eventsLastHour: eventsLastHourResult?.count || 0,
          eventsLastDay: eventsLastDayResult?.count || 0,
          averageProcessingTime: avgProcessingTimeResult?.avg || 0,
          queueSize: queueSize,
          diskUsage: {
            schemas: diskUsage.totalSize,
            logs: 0, // TODO: Implementar contagem de logs
            database: 0 // TODO: Implementar tamanho do banco
          }
        };
        
        logger.info('System statistics retrieved', {
          totalEvents: stats.totalEvents,
          uniqueEventTypes: stats.uniqueEventTypes
        });
        
        return reply.send({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Failed to fetch system statistics', error as Error);
        
        return reply.code(500).send({
          success: false,
          data: {
            totalEvents: 0,
            uniqueEventTypes: 0,
            eventsLastHour: 0,
            eventsLastDay: 0,
            averageProcessingTime: 0,
            queueSize: 0,
            diskUsage: { schemas: 0, logs: 0, database: 0 }
          },
          timestamp: new Date().toISOString(),
          error: 'Failed to fetch statistics'
        });
      }
    }
  });

  /**
   * Obtém eventos recentes
   */
  app.get('/events/recent', {
    handler: async (request: FastifyRequest<{
      Querystring: { limit?: number; eventType?: string; }
    }>, reply: FastifyReply) => {
      try {
        const { limit = 50, eventType } = request.query;
        
        logger.debug('Fetching recent events', { limit, eventType: eventType as string | undefined });
        
        let sql = `
          SELECT 
            ROWID as id,
            event_type,
            received_at as timestamp,
            has_truncated as truncated,
            original_size as size,
            processing_duration
          FROM events
        `;
        
        const params: any[] = [];
        
        if (eventType) {
          sql += ' WHERE event_type = ?';
          params.push(eventType);
        }
        
        sql += ' ORDER BY received_at DESC LIMIT ?';
        params.push(limit);
        
        const events = await database.all<{
          id: string;
          event_type: string;
          timestamp: string;
          truncated: number;
          size: number;
          processing_duration: number;
        }>(sql, params);
        
        const eventSummaries: EventSummary[] = events.map(event => ({
          id: event.id.toString(),
          eventType: event.event_type,
          timestamp: event.timestamp,
          truncated: event.truncated === 1,
          size: event.size,
          schemaVersion: 1 // TODO: Implementar busca da versão do schema
        }));
        
        logger.info('Recent events retrieved', { count: eventSummaries.length });
        
        return reply.send({
          success: true,
          data: eventSummaries,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Failed to fetch recent events', error as Error);
        
        return reply.code(500).send({
          success: false,
          data: [],
          timestamp: new Date().toISOString(),
          error: 'Failed to fetch recent events'
        });
      }
    }
  });

  /**
   * Obtém dados para gráfico de eventos ao longo do tempo
   */
  app.get('/events/timeline', {
    handler: async (request: FastifyRequest<{
      Querystring: { hours?: number; eventType?: string; }
    }>, reply: FastifyReply) => {
      try {
        const { hours = 24, eventType } = request.query;
        
        logger.debug('Fetching events timeline', { hours, eventType: eventType as string | undefined });
        
        let sql = `
          SELECT 
            strftime('%H', received_at) as hour,
            COUNT(*) as count,
            AVG(original_size) as avgSize
          FROM events
          WHERE received_at > datetime('now', '-${hours} hours')
        `;
        
        const params: any[] = [];
        
        if (eventType) {
          sql += ' AND event_type = ?';
          params.push(eventType);
        }
        
        sql += ' GROUP BY hour ORDER BY hour';
        
        const timelineData = await database.all<{
          hour: string;
          count: number;
          avgSize: number;
        }>(sql, params);
        
        const formattedData = timelineData.map(item => ({
          hour: parseInt(item.hour),
          count: item.count,
          avgSize: Math.round(item.avgSize || 0)
        }));
        
        logger.info('Events timeline retrieved', { 
          dataPoints: formattedData.length,
          hours,
          eventType: eventType as string | undefined
        });
        
        return reply.send({
          success: true,
          data: formattedData,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Failed to fetch events timeline', error as Error);
        
        return reply.code(500).send({
          success: false,
          data: [],
          timestamp: new Date().toISOString(),
          error: 'Failed to fetch timeline'
        });
      }
    }
  });

  /**
   * Health check da API
   */
  app.get('/health', {
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      const services = {
        database: false,
        redis: false,
        fileSystem: false
      };
      
      try {
        // Testa database
        await database.get('SELECT 1');
        services.database = true;
      } catch (error) {
        logger.error('Database health check failed', error as Error);
      }
      
      try {
        // Testa Redis
        services.redis = await redis.ping();
      } catch (error) {
        logger.error('Redis health check failed', error as Error);
      }
      
      try {
        // Testa file system
        await fileManager.listEventTypes();
        services.fileSystem = true;
      } catch (error) {
        logger.error('File system health check failed', error as Error);
      }
      
      const isHealthy = Object.values(services).every(service => service);
      const status = isHealthy ? 'healthy' : 'degraded';
      
      return reply.code(isHealthy ? 200 : 503).send({
        status,
        timestamp: Date.now(),
        services
      });
    }
  });

  /**
   * Helper para obter tamanho da queue
   */
  async function getQueueSize(): Promise<number> {
    try {
      const queueLength = await redis.listLength('bull:events:waiting');
      return queueLength;
    } catch (error) {
      logger.error('Failed to get queue size', error as Error);
      return 0;
    }
  }

  logger.info('API routes registered successfully');
}
