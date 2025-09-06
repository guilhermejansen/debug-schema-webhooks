import { Queue, Worker, Job } from 'bullmq';
import { EventAnalyzer } from '@/server/services/EventAnalyzer';
import { SchemaGenerator } from '@/server/services/SchemaGenerator';
import { SchemaComparator } from '@/server/services/SchemaComparator';
import { FileManager } from '@/server/services/FileManager';
import { TruncateService } from '@/server/services/TruncateService';
import { Database } from '@/server/config/database';
import { redis } from '@/server/config/redis';
import { Logger } from '@/server/utils/Logger';
import { Hasher } from '@/server/utils/Hasher';
import { createAppConfig } from '@/server/config/env';
import { EventMetadata, GeneratedSchema, EventStructure } from '@/types/base';

/**
 * Interface para dados do job de processamento de evento
 */
interface EventJobData {
  event: any;
  receivedAt: string;
  eventId: string;
}

/**
 * Processador principal de eventos de webhook
 * Gerencia queue, workers e processamento assíncrono
 */
export class EventProcessor {
  private queue!: Queue<EventJobData>;
  private worker!: Worker<EventJobData>;
  private analyzer!: EventAnalyzer;
  private generator!: SchemaGenerator;
  private comparator!: SchemaComparator;
  private fileManager!: FileManager;
  private truncateService!: TruncateService;
  private database!: Database;
  private logger: Logger;
  private config = createAppConfig();

  constructor() {
    this.logger = new Logger('EventProcessor');
    this.initializeServices();
    this.setupQueue();
    this.setupWorker();
  }

  /**
   * Inicializa todos os serviços necessários
   */
  private initializeServices(): void {
    this.database = Database.getInstance();
    this.truncateService = new TruncateService(this.config.truncate);
    this.analyzer = new EventAnalyzer(this.truncateService);
    this.generator = new SchemaGenerator();
    this.comparator = new SchemaComparator();
    this.fileManager = new FileManager();
  }

  /**
   * Configura a queue do BullMQ
   */
  private setupQueue(): void {
    const connection = redis.getClient();
    
    this.queue = new Queue<EventJobData>('events', {
      connection,
      defaultJobOptions: {
        attempts: this.config.queue.maxAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.queue.backoffDelay
        },
        removeOnComplete: 100, // Mantém apenas os últimos 100 jobs completos
        removeOnFail: 50       // Mantém apenas os últimos 50 jobs falhados
      }
    });

    // Event listeners para a queue
    this.queue.on('error', (error: Error) => {
      this.logger.error('Queue error occurred', error);
    });

    this.logger.info('Event processing queue initialized');
  }

  /**
   * Configura o worker para processar jobs
   */
  private setupWorker(): void {
    const connection = redis.getClient();

    this.worker = new Worker<EventJobData>(
      'events',
      async (job: Job<EventJobData>) => {
        return this.processEventJob(job);
      },
      {
        connection,
        concurrency: this.config.queue.concurrency
      }
    );

    // Event listeners para o worker
    this.worker.on('completed', (job: Job<EventJobData>) => {
      this.logger.info('Job completed successfully', {
        jobId: job.id,
        eventId: job.data.eventId,
        duration: job.processedOn ? job.processedOn - job.processedOn : 0
      });
    });

    this.worker.on('failed', (job: Job<EventJobData> | undefined, error: Error) => {
      this.logger.error('Job failed', error, {
        jobId: job?.id,
        eventId: job?.data?.eventId,
        attempts: job?.attemptsMade
      });
    });

    this.worker.on('stalled', (jobId: string) => {
      this.logger.warn('Job stalled', { jobId });
    });

    this.logger.info('Event processing worker initialized', {
      concurrency: this.config.queue.concurrency
    });
  }

  /**
   * Adiciona evento na queue para processamento
   */
  async addToQueue(event: any): Promise<void> {
    const eventId = Hasher.generateId('evt_');
    const receivedAt = new Date().toISOString();

    const jobData: EventJobData = {
      event,
      receivedAt,
      eventId
    };

    await this.queue.add('process-event', jobData, {
      jobId: eventId, // Usa o eventId como jobId para evitar duplicações
      priority: this.calculatePriority(event)
    });

    this.logger.debug('Event added to processing queue', {
      eventId,
      queueSize: await this.getQueueSize()
    });
  }

  /**
   * Calcula prioridade do job baseado no tipo de evento
   * Baseado nos tipos de evento do whatsmeow
   */
  private calculatePriority(event: any): number {
    // Extrai o tipo do evento usando as mesmas estratégias do EventAnalyzer
    const eventType = event.eventType || event.body?.eventType || event.type || '';
    
    // Mapeamento de prioridades baseado na importância dos eventos
    const priorityMap: Record<string, number> = {
      // CRÍTICOS - Eventos de mensagem e comunicação (10-15)
      'Message': 15,
      'FBMessage': 15,
      'UndecryptableMessage': 12,
      
      // ALTOS - Media e conteúdo importante (8-11)
      'Picture': 11,
      'MediaRetry': 10,
      'Audio': 9,
      'Video': 9,
      'Document': 8,
      
      // MÉDIO-ALTOS - Eventos de grupo e social (6-7)
      'JoinedGroup': 7,
      'GroupInfo': 7,
      'UserAbout': 6,
      'Newsletter': 6,
      'NewsletterJoin': 6,
      'NewsletterLeave': 6,
      'NewsletterMuteChange': 6,
      'NewsletterLiveUpdate': 7,
      
      // MÉDIOS - Confirmações e estados (4-5)
      'Receipt': 5,
      'ReadReceipt': 5,
      'ChatPresence': 4,
      'Presence': 4,
      'IdentityChange': 5,
      
      // BAIXO-MÉDIOS - Eventos de sistema importantes (3-4)
      'Connected': 4,
      'PairSuccess': 4,
      'HistorySync': 3,
      'OfflineSyncCompleted': 3,
      'Blocklist': 3,
      
      // BAIXOS - Eventos de monitoramento e estados (1-2)
      'KeepAliveTimeout': 2,
      'KeepAliveRestored': 2,
      'PrivacySettings': 2,
      'OfflineSyncPreview': 2,
      'QR': 1,
      'StreamError': 1,
      'Disconnected': 1,
      
      // ESPECIAIS - Eventos de erro e falha (podem ser críticos)
      'PairError': 8,
      'LoggedOut': 8,
      'TemporaryBan': 8,
      'ClientOutdated': 7,
      'ConnectFailure': 7,
      'CATRefreshError': 7,
      'StreamReplaced': 6,
      
      // DEFAULT
      'Unknown': 1
    };

    // Tenta detectar por estrutura se o eventType não foi encontrado
    if (!priorityMap[eventType]) {
      // Detecção por campos presentes na estrutura
      const eventStr = JSON.stringify(event).toLowerCase();
      
      // Mensagens têm prioridade alta
      if (eventStr.includes('message') && !eventStr.includes('undecryptable')) {
        return 15;
      }
      
      // Media
      if (eventStr.includes('image') || eventStr.includes('picture') || 
          eventStr.includes('photo') || eventStr.includes('thumbnail')) {
        return 11;
      }
      
      if (eventStr.includes('audio') || eventStr.includes('voice')) {
        return 9;
      }
      
      if (eventStr.includes('video')) {
        return 9;
      }
      
      if (eventStr.includes('document')) {
        return 8;
      }
      
      // Grupos
      if (eventStr.includes('group') || eventStr.includes('participant')) {
        return 7;
      }
      
      // Receipts e confirmações
      if (eventStr.includes('receipt') || eventStr.includes('read') || 
          eventStr.includes('delivered')) {
        return 5;
      }
      
      // Presença
      if (eventStr.includes('presence') || eventStr.includes('online') || 
          eventStr.includes('offline')) {
        return 4;
      }
      
      // Conexão
      if (eventStr.includes('connect') || eventStr.includes('pair') || 
          eventStr.includes('qr')) {
        return 4;
      }
    }

    return priorityMap[eventType] || 5; // Prioridade padrão
  }

  /**
   * Processa um job de evento
   */
  private async processEventJob(job: Job<EventJobData>): Promise<void> {
    const { event, receivedAt, eventId } = job.data;
    const startTime = Date.now();

    this.logger.eventProcessingStarted(eventId, { receivedAt });

    try {
      // 1. Analisa o evento (com truncamento)
      const analysisResult = this.analyzer.analyzeEvent(event);
      const { structure, eventType, truncateMetadata } = analysisResult;

      this.logger.debug('Event analysis completed', {
        eventId,
        eventType,
        hasTruncated: truncateMetadata.hasTruncated,
        truncatedFields: truncateMetadata.truncatedFields.length
      });

      // 2. Verifica se já existe schema para este tipo
      const existingSchemas = await this.fileManager.loadExistingSchemas();
      const existingSchema = existingSchemas.get(eventType);

      // 3. Determina se precisa atualizar o schema
      const shouldUpdateSchema = await this.shouldUpdateSchema(
        structure,
        existingSchema,
        eventType
      );

      // 4. Gera ou atualiza schema se necessário
      let finalStructure = structure;
      let schemaVersion = 1;

      if (shouldUpdateSchema) {
        if (existingSchema) {
          // Faz merge com schema existente
          const existingStructure = await this.parseExistingStructure(existingSchema);
          finalStructure = this.comparator.mergeStructures(existingStructure, structure);
          const metadata = typeof existingSchema.metadata === 'string' ? 
            JSON.parse(existingSchema.metadata) : existingSchema.metadata;
          schemaVersion = metadata.schemaVersion + 1;

          this.logger.debug('Schema will be updated', {
            eventType,
            newVersion: schemaVersion
          });
        } else {
          this.logger.debug('New schema will be created', { eventType });
        }

        await this.generateAndSaveSchema(
          finalStructure,
          eventType,
          event,
          schemaVersion,
          existingSchema
        );
      } else {
        // Apenas atualiza metadata
        await this.updateExistingMetadata(eventType, truncateMetadata);
        
        this.logger.debug('Schema unchanged, metadata updated', { eventType });
      }

      // 5. Salva evento no banco para estatísticas
      await this.saveEventToDatabase(
        eventId,
        eventType,
        event,
        truncateMetadata,
        receivedAt,
        Date.now() - startTime,
        structure
      );

      const duration = Date.now() - startTime;
      this.logger.eventProcessingCompleted(eventType, duration, {
        eventId,
        schemaUpdated: shouldUpdateSchema,
        schemaVersion
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.eventProcessingFailed(eventId, error as Error, {
        duration,
        receivedAt
      });
      throw error; // Re-lança para o BullMQ tratar retry
    }
  }

  /**
   * Determina se o schema deve ser atualizado
   */
  private async shouldUpdateSchema(
    newStructure: EventStructure,
    existingSchema: GeneratedSchema | undefined,
    eventType: string
  ): Promise<boolean> {
    if (!existingSchema) {
      return true; // Novo tipo de evento
    }

    try {
      const existingStructure = await this.parseExistingStructure(existingSchema);
      const isIdentical = this.comparator.compareStructures(newStructure, existingStructure);
      
      if (!isIdentical) {
        const differences = this.comparator.findDifferences(newStructure, existingStructure);
        
        this.logger.debug('Structure differences detected', {
          eventType,
          differenceCount: differences.length,
          differenceTypes: differences.map(d => d.type)
        });
        
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.warn('Failed to compare structures, will update schema', {
        eventType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return true;
    }
  }

  /**
   * Gera e salva um schema completo
   */
  private async generateAndSaveSchema(
    structure: EventStructure,
    eventType: string,
    originalEvent: any,
    schemaVersion: number,
    existingSchema?: GeneratedSchema
  ): Promise<void> {
    // Gera schema Zod
    const zodSchema = await this.generator.generateZodSchema(structure, eventType);
    
    // Gera interface TypeScript
    const tsInterface = await this.generator.generateTypeScriptInterface(structure, eventType);
    
    // Gera exemplos
    const examples = this.generator.generateExamples(structure);

    // Gera metadata com estrutura salva para reconstrução futura
    const existingMetadata = existingSchema ? 
      (typeof existingSchema.metadata === 'string' ? JSON.parse(existingSchema.metadata) : existingSchema.metadata) : undefined;
    const metadata = this.generator.generateMetadata(eventType, structure, existingMetadata);
    metadata.schemaVersion = schemaVersion;
    
    // IMPORTANTE: Salva a estrutura completa no metadata para reconstrução futura
    metadata.savedStructure = this.serializeStructureForStorage(structure);

    // Salva tudo
    const generatedSchema: GeneratedSchema = {
      zodSchema,
      tsInterface,
      examples,
      metadata,
      rawSample: originalEvent
    };

    await this.fileManager.saveSchema(eventType, generatedSchema);

          if (existingSchema) {
        const prevVersion = typeof existingMetadata === 'object' ? existingMetadata?.schemaVersion || 0 : 0;
        this.logger.schemaUpdated(eventType, prevVersion, schemaVersion);
      } else {
      this.logger.schemaGenerated(eventType, schemaVersion);
    }
  }

  /**
   * Serializa estrutura para armazenamento no metadata
   */
  private serializeStructureForStorage(structure: EventStructure): any {
    const serialize = (node: EventStructure): any => {
      const serialized: any = {
        path: node.path,
        type: node.type,
        optional: node.optional,
        examples: node.examples.slice(-5) // Mantém apenas últimos 5 exemplos para economizar espaço
      };
      
      if (node.isTruncated !== undefined) {
        serialized.isTruncated = node.isTruncated;
      }
      
      if (node.originalType !== undefined) {
        serialized.originalType = node.originalType;
      }
      
      if (node.children && node.children.size > 0) {
        serialized.children = {};
        for (const [key, child] of node.children) {
          serialized.children[key] = serialize(child);
        }
      }
      
      if (node.arrayItemType) {
        serialized.arrayItemType = serialize(node.arrayItemType);
      }
      
      return serialized;
    };
    
    return serialize(structure);
  }

  /**
   * Atualiza metadata de schema existente
   */
  private async updateExistingMetadata(
    eventType: string,
    truncateMetadata: any
  ): Promise<void> {
    const partialMetadata: Partial<EventMetadata> = {
      lastSeen: new Date().toISOString(),
      totalReceived: 1, // Será somado pelo FileManager
      fields: {
        required: [],
        optional: [],
        truncated: truncateMetadata.truncatedFields.map((f: any) => f.path)
      },
      variations: []
    };

    await this.fileManager.updateMetadata(eventType, partialMetadata as EventMetadata);
  }

  /**
   * Parse estrutura de schema existente a partir dos dados salvos
   */
  private async parseExistingStructure(schema: GeneratedSchema): Promise<EventStructure> {
    try {
      // Se temos metadata com estrutura salva, usa ela
      const metadata = typeof schema.metadata === 'string' ? 
        JSON.parse(schema.metadata) : schema.metadata;
      
      if (metadata?.savedStructure) {
        // Reconstrói a estrutura a partir do metadata salvo
        return this.reconstructStructureFromMetadata(metadata.savedStructure);
      }
      
      // Fallback: reconstrói a partir dos exemplos salvos
      if (schema.examples) {
        const examples = typeof schema.examples === 'string' ? 
          JSON.parse(schema.examples) : schema.examples;
        
        if (examples.truncated && examples.truncated.length > 0) {
          // Usa o analyzer para reconstruir a estrutura dos exemplos
          const mergedStructure = this.reconstructFromExamples(examples.truncated);
          return mergedStructure;
        }
      }
      
      // Última tentativa: reconstrói do rawSample se disponível
      if (schema.rawSample) {
        const sample = typeof schema.rawSample === 'string' ? 
          JSON.parse(schema.rawSample) : schema.rawSample;
        return this.analyzer.buildStructureMap(sample);
      }
      
      // Se nada funcionou, retorna estrutura básica
      this.logger.warn('Could not reconstruct existing structure, using basic structure');
      return {
        path: '',
        type: 'object',
        optional: false,
        examples: []
      };
      
    } catch (error) {
      this.logger.error('Failed to parse existing structure', error as Error);
      return {
        path: '',
        type: 'object',
        optional: false,
        examples: []
      };
    }
  }
  
  /**
   * Reconstrói estrutura a partir de múltiplos exemplos
   */
  private reconstructFromExamples(examples: any[]): EventStructure {
    if (!examples || examples.length === 0) {
      return {
        path: '',
        type: 'object',
        optional: false,
        examples: []
      };
    }
    
    // Analisa cada exemplo e faz merge das estruturas
    let mergedStructure: EventStructure | null = null;
    
    for (const example of examples) {
      const structure = this.analyzer.buildStructureMap(example);
      
      if (!mergedStructure) {
        mergedStructure = structure;
      } else {
        // Faz merge preservando todos os campos
        mergedStructure = this.comparator.mergeStructures(mergedStructure, structure);
      }
    }
    
    return mergedStructure || {
      path: '',
      type: 'object',
      optional: false,
      examples: examples
    };
  }
  
  /**
   * Reconstrói estrutura a partir de metadata salvo
   */
  private reconstructStructureFromMetadata(savedStructure: any): EventStructure {
    // Reconstrói recursivamente a estrutura
    const reconstruct = (node: any): EventStructure => {
      const structure: EventStructure = {
        path: node.path || '',
        type: node.type || 'object',
        optional: node.optional || false,
        examples: node.examples || []
      };
      
      if (node.isTruncated !== undefined) {
        structure.isTruncated = node.isTruncated;
      }
      
      if (node.originalType !== undefined) {
        structure.originalType = node.originalType;
      }
      
      if (node.children && typeof node.children === 'object') {
        structure.children = new Map();
        
        // Reconstrói o Map de children
        for (const [key, child] of Object.entries(node.children)) {
          structure.children.set(key, reconstruct(child));
        }
      }
      
      if (node.arrayItemType) {
        structure.arrayItemType = reconstruct(node.arrayItemType);
      }
      
      return structure;
    };
    
    return reconstruct(savedStructure);
  }

  /**
   * Salva evento no banco de dados
   */
  private async saveEventToDatabase(
    eventId: string,
    eventType: string,
    event: any,
    truncateMetadata: any,
    receivedAt: string,
    processingDuration: number,
    structure: EventStructure
  ): Promise<void> {
    try {
      const eventHash = Hasher.hashPayload(event);
      const originalSize = JSON.stringify(event).length;
      
      await this.database.run(`
        INSERT INTO events (
          event_type, event_hash, original_size, truncated_size,
          has_truncated, truncated_fields_count, received_at,
          processed_at, processing_duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eventType,
        eventHash,
        originalSize,
        truncateMetadata.truncatedSize,
        truncateMetadata.hasTruncated ? 1 : 0,
        truncateMetadata.truncatedFields.length,
        receivedAt,
        new Date().toISOString(),
        processingDuration
      ]);

      // Atualiza estatísticas de schema
      await this.updateSchemaStats(eventType, structure);

    } catch (error) {
      this.logger.error('Failed to save event to database', error as Error, {
        eventId,
        eventType
      });
    }
  }

  /**
   * Atualiza estatísticas de schema no banco
   */
  private async updateSchemaStats(eventType: string, structure?: EventStructure): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      // Gera hash da estrutura se fornecida, ou usa placeholder para schemas existentes
      const structureHash = structure ? 
        Hasher.hashStructure(structure) : 
        `placeholder_${eventType}_${Date.now()}`;
      
      await this.database.run(`
        INSERT OR REPLACE INTO schemas (
          event_type, 
          schema_version,
          structure_hash, 
          first_seen, 
          last_seen, 
          last_modified,
          total_received, 
          updated_at
        ) VALUES (
          ?,
          COALESCE((SELECT schema_version FROM schemas WHERE event_type = ?), 1),
          ?,
          COALESCE((SELECT first_seen FROM schemas WHERE event_type = ?), ?),
          ?,
          ?,
          COALESCE((SELECT total_received FROM schemas WHERE event_type = ?), 0) + 1,
          ?
        )
      `, [
        eventType, 
        eventType, 
        structureHash, 
        eventType, 
        now, 
        now, 
        now, 
        eventType, 
        now
      ]);

    } catch (error) {
      this.logger.error('Failed to update schema stats', error as Error, { eventType });
    }
  }

  /**
   * Obtém tamanho atual da queue
   */
  async getQueueSize(): Promise<number> {
    try {
      return await this.queue.count();
    } catch (error) {
      this.logger.error('Failed to get queue size', error as Error);
      return 0;
    }
  }

  /**
   * Obtém estatísticas da queue
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed(),
        this.queue.getDelayed()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length
      };
    } catch (error) {
      this.logger.error('Failed to get queue stats', error as Error);
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
  }

  /**
   * Pausa o processamento
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    this.logger.info('Event processing paused');
  }

  /**
   * Resume o processamento
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    this.logger.info('Event processing resumed');
  }

  /**
   * Fecha worker e queue
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.logger.info('Event processor closed');
  }
}
