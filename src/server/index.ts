import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import path from 'path';

import { webhookRoutes } from './routes/webhook';
import { apiRoutes } from './routes/api';
import { initDatabase } from './config/database';
import { initRedis } from './config/redis';
import { Logger } from './utils/Logger';
import { env, createAppConfig, isDevelopment } from './config/env';

/**
 * Servidor principal da aplicação Webhook Mapper
 */
class WebhookMapperServer {
  private app: FastifyInstance;
  private logger: Logger;
  private config = createAppConfig();

  constructor() {
    this.logger = new Logger('Server');
    this.app = this.createFastifyInstance();
  }

  /**
   * Cria instância do Fastify com configurações otimizadas
   */
  private createFastifyInstance(): FastifyInstance {
    return Fastify({
      logger: {
        level: env.LOG_LEVEL,
        // Em produção, usa formato estruturado para melhor parsing
        transport: isDevelopment ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        } as any : undefined
      },
      bodyLimit: this.config.server.bodyLimit,
      trustProxy: true,
      keepAliveTimeout: 30000,
      connectionTimeout: 10000,
      pluginTimeout: 30000
    });
  }

  /**
   * Registra todos os plugins necessários
   */
  private async registerPlugins(): Promise<void> {
    this.logger.info('Registering Fastify plugins...');

    // Plugin para servir arquivos estáticos
    await this.app.register(staticFiles, {
      root: path.join(process.cwd(), 'public'),
      prefix: '/public/',
    });

    // CORS - permite requisições de qualquer origem
    await this.app.register(cors, {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    });

    // Helmet para segurança
    await this.app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false
    });

    // Rate limiting
    await this.app.register(rateLimit, {
      max: env.RATE_LIMIT_MAX,
      timeWindow: env.RATE_LIMIT_WINDOW,
      skipOnError: true, // Não bloqueia se Redis estiver indisponível
      errorResponseBuilder: (_request, context: any) => {
        return {
          code: 429,
          error: 'Rate limit exceeded',
          message: `Too many requests, please try again later. Limit: ${context.max} requests per ${Math.floor(context.timeWindow / 1000)} seconds`,
          retryAfter: Math.round(context.timeWindow / 1000)
        };
      },
      keyGenerator: (request) => {
        // Rate limit por IP, mas permite bypass para health checks
        if (request.url?.includes('/health')) {
          return `health-${request.ip}`;
        }
        return request.ip;
      }
    });

    this.logger.info('All plugins registered successfully');
  }

  /**
   * Registra todas as rotas da aplicação
   */
  private async registerRoutes(): Promise<void> {
    this.logger.info('Registering application routes...');

    // Rota principal do dashboard
    this.app.get('/', async (_request, reply) => {
      return reply.sendFile('index.html', path.join(process.cwd(), 'public'));
    });

    // Health check principal
    this.app.get('/health', {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'number' },
              uptime: { type: 'number' },
              version: { type: 'string' },
              env: { type: 'string' }
            }
          }
        }
      }
    }, async (_request, reply) => {
      return reply.send({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: '1.0.0',
        env: env.NODE_ENV
      });
    });

    // Registra rotas do webhook
    await this.app.register(webhookRoutes);

    // Registra rotas da API com prefixo
    await this.app.register(apiRoutes, { prefix: '/api' });

    // Rota catch-all para 404
    this.app.setNotFoundHandler((request, reply) => {
      this.logger.warn('Route not found', {
        method: request.method,
        url: request.url,
        ip: request.ip
      });

      reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Route not found',
        timestamp: new Date().toISOString()
      });
    });

    this.logger.info('All routes registered successfully');
  }

  /**
   * Configura handlers de erro globais
   */
  private setupErrorHandlers(): void {
    // Handler de erro global do Fastify
    this.app.setErrorHandler((error, request, reply) => {
      this.logger.error('Unhandled error occurred', error, {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent']
      });

      // Não expõe detalhes do erro em produção
      const errorMessage = isDevelopment ? error.message : 'Internal Server Error';
      const errorDetails = isDevelopment ? error.stack : undefined;

      reply.code(error.statusCode || 500).send({
        statusCode: error.statusCode || 500,
        error: error.name || 'Internal Server Error',
        message: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString()
      });
    });

    // Handlers de processo para shutdown graceful
    const gracefulShutdown = (signal: string) => {
      this.logger.info(`${signal} received, starting graceful shutdown...`);

      this.app.close((err?: Error) => {
        if (err) {
          this.logger.error('Error during shutdown', err);
          process.exit(1);
        }

        this.logger.info('Server closed successfully');
        process.exit(0);
      });

      // Force close após 10 segundos
      setTimeout(() => {
        this.logger.error('Forceful shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handler para uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception - shutting down...', error);
      process.exit(1);
    });

    // Handler para unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at Promise', new Error(reason as string), {
        promise: promise.toString()
      });
    });
  }

  /**
   * Inicializa todas as dependências externas
   */
  private async initializeExternalServices(): Promise<void> {
    this.logger.info('Initializing external services...');

    try {
      // Inicializa banco de dados
      await initDatabase();
      this.logger.info('Database initialized successfully');

      // Inicializa Redis
      await initRedis();
      this.logger.info('Redis initialized successfully');

      // Cria diretórios necessários
      await this.ensureDirectoriesExist();
      this.logger.info('Required directories created');

    } catch (error) {
      this.logger.error('Failed to initialize external services', error as Error);
      throw error;
    }
  }

  /**
   * Garante que todos os diretórios necessários existem
   */
  private async ensureDirectoriesExist(): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const directories = [
      './schemas',
      './logs',
      './data',
      path.dirname(env.DATABASE_PATH)
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // Ignora erro se diretório já existe
        if ((error as any)?.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }

  /**
   * Registra hooks de ciclo de vida do Fastify
   */
  private registerHooks(): void {
    // Hook executado em toda requisição
    this.app.addHook('onRequest', async (request, _reply) => {
      request.startTime = Date.now();
    });

    // Hook executado após resposta enviada
    this.app.addHook('onResponse', async (request, reply) => {
      const duration = Date.now() - (request.startTime || Date.now());

      // Log apenas se duração for significativa ou se for erro
      if (duration > 1000 || reply.statusCode >= 400) {
        this.logger.info('Request completed', {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          duration,
          ip: request.ip,
          userAgent: request.headers['user-agent']
        });
      }
    });

    // Hook para shutdown graceful
    this.app.addHook('onClose', async () => {
      this.logger.info('Server is closing, cleaning up resources...');
      
      // Aqui poderíamos fechar conexões de banco, Redis, etc.
      // Mas isso já é feito pelos respectivos managers
    });
  }

  /**
   * Inicia o servidor
   */
  async start(): Promise<void> {
    try {
      this.logger.info('Starting Webhook Mapper Server...', {
        version: '1.0.0',
        environment: env.NODE_ENV,
        nodeVersion: process.version
      });

      // Inicializa serviços externos primeiro
      await this.initializeExternalServices();

      // Registra plugins
      await this.registerPlugins();

      // Registra hooks
      this.registerHooks();

      // Registra rotas
      await this.registerRoutes();

      // Configura error handlers
      this.setupErrorHandlers();

      // Inicia o servidor
      await this.app.listen({
        port: this.config.server.port,
        host: this.config.server.host
      });

      this.logger.info('🚀 Webhook Mapper Server started successfully', {
        port: this.config.server.port,
        host: this.config.server.host,
        environment: env.NODE_ENV,
        webhookUrl: `http://${this.config.server.host}:${this.config.server.port}/webhook`,
        apiUrl: `http://${this.config.server.host}:${this.config.server.port}/api`,
        healthUrl: `http://${this.config.server.host}:${this.config.server.port}/health`,
        author: 'https://github.com/guilhermejansen/'
      });

    } catch (error) {
      this.logger.error('Failed to start server', error as Error);
      process.exit(1);
    }
  }
}

// Declaração de tipos para propriedades customizadas
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

// Função principal
async function main(): Promise<void> {
  const server = new WebhookMapperServer();
  await server.start();
}

// Inicia aplicação apenas se não estiver sendo importada
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error starting application:', error);
    process.exit(1);
  });
}

export { WebhookMapperServer };
