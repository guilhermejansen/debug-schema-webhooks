import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventProcessor } from '@/server/queue/processors/EventProcessor';
import { Logger } from '@/server/utils/Logger';

/**
 * Rotas relacionadas ao webhook principal
 */
export async function webhookRoutes(app: FastifyInstance) {
  const logger = new Logger('WebhookRoutes');
  const processor = new EventProcessor();

  /**
   * Handler compartilhado para o webhook principal
   */
  const webhookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      
      try {
        const body = request.body;
        const clientIp = request.ip;
        const userAgent = request.headers['user-agent'];
        
        // Cria evento completo com headers e body
        const event = {
          headers: request.headers as any,
          body: body
        };
        
        // Log do evento recebido
        logger.info('Webhook event received', { 
          clientIp,
          userAgent,
          contentLength: JSON.stringify(body).length,
          eventType: (body as any)?.eventType || (body as any)?.type || 'unknown',
          timestamp: Date.now()
        });
        
        // Validação básica
        if (!body || typeof body !== 'object') {
          logger.warn('Invalid webhook payload received', {
            clientIp,
            payloadType: typeof body
          });
          
          return reply.code(400).send({
            status: 'error',
            message: 'Invalid JSON payload',
            timestamp: Date.now()
          });
        }
        
        // Processa de forma assíncrona via queue
        await processor.addToQueue(event);
        
        const processingTime = Date.now() - startTime;
        
        logger.info('Webhook event queued successfully', {
          clientIp,
          processingTime,
          queueSize: await processor.getQueueSize()
        });
        
        // Responde imediatamente com sucesso
        return reply.code(200).send({ 
          status: 'ok', 
          message: 'Event received and queued for processing',
          timestamp: Date.now()
        });
        
      } catch (error) {
        const processingTime = Date.now() - startTime;
        
        logger.error('Error processing webhook', error as Error, {
          clientIp: request.ip,
          processingTime,
          contentLength: request.headers['content-length']
        });
        
        // Ainda retorna 200 para não quebrar o webhook do cliente
        // Mas indica erro na resposta
        return reply.code(200).send({ 
          status: 'error', 
          message: 'Event received but processing failed',
          timestamp: Date.now()
        });
      }
    };

  /**
   * Endpoint principal do webhook - aceita tanto /webhook quanto /webhook/
   */
  app.post('/webhook', {
    bodyLimit: 100 * 1024 * 1024, // Limite de 100MB para suportar imagens base64 grandes
    handler: webhookHandler
  });

  /**
   * Endpoint alternativo para /webhook/ (com barra final)
   */
  app.post('/webhook/', {
    bodyLimit: 100 * 1024 * 1024, // Limite de 100MB para suportar imagens base64 grandes
    handler: webhookHandler
  });

  /**
   * Health check específico do webhook
   */
  app.get('/webhook/health', {
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const queueSize = await processor.getQueueSize();
        const queueStats = await processor.getQueueStats();
        
        return reply.send({ 
          status: 'healthy', 
          timestamp: Date.now(),
          uptime: process.uptime(),
          queue: {
            size: queueSize,
            stats: queueStats
          }
        });
        
      } catch (error) {
        logger.error('Health check failed', error as Error);
        
        return reply.code(503).send({
          status: 'unhealthy',
          timestamp: Date.now(),
          uptime: process.uptime(),
          queue: {
            size: 0,
            stats: {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0
            }
          }
        });
      }
    }
  });

  /**
   * Endpoint para pausar o processamento (útil para manutenção)
   */
  app.post('/webhook/pause', {
    // Schema removido para compatibilidade com Fastify - validação feita em runtime
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await processor.pause();
        
        logger.info('Webhook processing paused', {
          clientIp: request.ip,
          userAgent: request.headers['user-agent']
        });
        
        return reply.send({
          status: 'ok',
          message: 'Webhook processing paused',
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Failed to pause webhook processing', error as Error);
        
        return reply.code(500).send({
          status: 'error',
          message: 'Failed to pause processing',
          timestamp: Date.now()
        });
      }
    }
  });

  /**
   * Endpoint para retomar o processamento
   */
  app.post('/webhook/resume', {
    // Schema removido para compatibilidade com Fastify - validação feita em runtime
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await processor.resume();
        
        logger.info('Webhook processing resumed', {
          clientIp: request.ip,
          userAgent: request.headers['user-agent']
        });
        
        return reply.send({
          status: 'ok',
          message: 'Webhook processing resumed',
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Failed to resume webhook processing', error as Error);
        
        return reply.code(500).send({
          status: 'error',
          message: 'Failed to resume processing',
          timestamp: Date.now()
        });
      }
    }
  });

  /**
   * Endpoint para obter estatísticas da queue
   */
  app.get('/webhook/stats', {
    // Schema removido para compatibilidade com Fastify - validação feita em runtime
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const queueSize = await processor.getQueueSize();
        const queueStats = await processor.getQueueStats();
        
        return reply.send({
          queue: {
            size: queueSize,
            stats: queueStats
          },
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Failed to get webhook stats', error as Error);
        
        return reply.code(500).send({
          queue: {
            size: 0,
            stats: {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0
            }
          },
          timestamp: Date.now()
        });
      }
    }
  });

  /**
   * Endpoint para teste de carga/desenvolvimento
   */
  app.post('/webhook/test', {
    // Schema removido para compatibilidade com Fastify - validação feita em runtime
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validação manual do body
        const body = request.body as any;
        const count = Math.max(1, Math.min(1000, body?.count || 1));
        const eventType = body?.eventType || 'TestEvent';
        
        // Gera eventos de teste
        const promises = [];
        for (let i = 0; i < count; i++) {
          const testEvent = {
            eventType,
            body: {
              data: {
                event: {
                  message: {
                    text: `Test message ${i + 1}`,
                    timestamp: Date.now()
                  }
                }
              }
            },
            metadata: {
              generated: true,
              index: i + 1,
              total: count
            }
          };
          
          promises.push(processor.addToQueue(testEvent));
        }
        
        await Promise.all(promises);
        
        logger.info('Test events generated', {
          count,
          eventType,
          clientIp: request.ip
        });
        
        return reply.send({
          status: 'ok',
          message: `${count} test events generated and queued`,
          eventsGenerated: count,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error('Failed to generate test events', error as Error);
        
        return reply.code(500).send({
          status: 'error',
          message: 'Failed to generate test events',
          eventsGenerated: 0,
          timestamp: Date.now()
        });
      }
    }
  });

  logger.info('Webhook routes registered successfully');
}