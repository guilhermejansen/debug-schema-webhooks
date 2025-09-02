import * as fs from 'fs/promises';
import * as path from 'path';
import { GeneratedSchema, EventMetadata, SchemaVariation } from '@/types/base';
import { Logger } from '@/server/utils/Logger';

/**
 * Serviço responsável por gerenciar arquivos de schemas no sistema de arquivos
 */
export class FileManager {
  private readonly logger: Logger;
  private readonly schemasDir: string;

  constructor(schemasDir: string = './schemas') {
    this.schemasDir = schemasDir;
    this.logger = new Logger('FileManager');
  }

  /**
   * Salva um schema completo no sistema de arquivos
   */
  async saveSchema(eventType: string, schema: GeneratedSchema): Promise<void> {
    this.logger.debug('Saving schema', { eventType });

    try {
      const folder = await this.getEventTypeFolder(eventType);
      
      // Salva todos os arquivos em paralelo para performance
      await Promise.all([
        this.writeSchemaFile(folder, 'schema.zod.ts', schema.zodSchema),
        this.writeSchemaFile(folder, 'interface.ts', schema.tsInterface),
        this.writeSchemaFile(folder, 'examples.json', JSON.stringify(schema.examples, null, 2)),
        this.updateMetadata(eventType, schema.metadata)
      ]);
      
      // Salva amostra raw se fornecida
      if (schema.rawSample) {
        await this.saveRawSample(eventType, schema.rawSample);
      }
      
      this.logger.info('Schema saved successfully', { 
        eventType,
        folder: folder.replace(process.cwd(), '.')
      });
      
    } catch (error) {
      this.logger.error('Failed to save schema', error as Error, { eventType });
      throw error;
    }
  }

  /**
   * Carrega todos os schemas existentes (suporta estruturas aninhadas)
   */
  async loadExistingSchemas(): Promise<Map<string, GeneratedSchema>> {
    this.logger.debug('Loading existing schemas');

    const schemas = new Map<string, GeneratedSchema>();
    
    try {
      await this.ensureDirectoryExists(this.schemasDir);
      
      // Busca schemas recursivamente em diretórios aninhados
      const allEventTypes = await this.findAllEventTypes(this.schemasDir);
      
      // Carrega schemas em paralelo
      const loadPromises = allEventTypes.map(async (eventType) => {
        try {
          const schema = await this.loadSchema(eventType);
          if (schema) {
            return { eventType, schema };
          }
        } catch (error) {
          this.logger.warn(`Failed to load schema for ${eventType}`, { error });
        }
        return null;
      });
      
      const results = await Promise.all(loadPromises);
      
      for (const result of results) {
        if (result) {
          schemas.set(result.eventType, result.schema);
        }
      }
      
      this.logger.info('Schemas loaded successfully', { 
        count: schemas.size,
        eventTypes: Array.from(schemas.keys())
      });
      
    } catch (error) {
      this.logger.error('Failed to load existing schemas', error as Error);
    }
    
    return schemas;
  }

  /**
   * Encontra todos os event types recursivamente (suporta estruturas aninhadas)
   */
  private async findAllEventTypes(baseDir: string, relativePath: string = ''): Promise<string[]> {
    const eventTypes: string[] = [];
    
    try {
      const entries = await fs.readdir(baseDir);
      
      for (const entry of entries) {
        const entryPath = path.join(baseDir, entry);
        const stat = await fs.stat(entryPath);
        
        if (stat.isDirectory()) {
          const currentPath = relativePath ? `${relativePath}/${entry}` : entry;
          
          // Verifica se é um diretório de schema (tem arquivos necessários)
          if (await this.isSchemaDirectory(entryPath)) {
            eventTypes.push(currentPath);
          } else {
            // Busca recursivamente em subdiretórios
            const subEventTypes = await this.findAllEventTypes(entryPath, currentPath);
            eventTypes.push(...subEventTypes);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to scan directory ${baseDir}`, { error });
    }
    
    return eventTypes;
  }

  /**
   * Verifica se um diretório contém um schema válido
   */
  private async isSchemaDirectory(dir: string): Promise<boolean> {
    const requiredFiles = ['schema.zod.ts', 'interface.ts', 'examples.json', 'metadata.json'];
    
    try {
      const fileExistenceChecks = requiredFiles.map(async (filename) => {
        try {
          await fs.access(path.join(dir, filename));
          return true;
        } catch {
          return false;
        }
      });
      
      const filesExist = await Promise.all(fileExistenceChecks);
      return filesExist.every(exists => exists);
    } catch {
      return false;
    }
  }

  /**
   * Carrega um schema específico
   */
  private async loadSchema(eventType: string): Promise<GeneratedSchema | null> {
    const folder = path.join(this.schemasDir, eventType);
    
    try {
      // Verifica se todos os arquivos necessários existem
      const requiredFiles = [
        'schema.zod.ts',
        'interface.ts', 
        'examples.json',
        'metadata.json'
      ];
      
      const fileExistenceChecks = requiredFiles.map(async (filename) => {
        try {
          await fs.access(path.join(folder, filename));
          return true;
        } catch {
          return false;
        }
      });
      
      const filesExist = await Promise.all(fileExistenceChecks);
      const allFilesExist = filesExist.every(exists => exists);
      
      if (!allFilesExist) {
        this.logger.warn(`Missing files for schema ${eventType}`, {
          missingFiles: requiredFiles.filter((_, index) => !filesExist[index])
        });
        return null;
      }
      
      // Carrega todos os arquivos em paralelo
      const [zodSchema, tsInterface, examples, metadata] = await Promise.all([
        fs.readFile(path.join(folder, 'schema.zod.ts'), 'utf-8'),
        fs.readFile(path.join(folder, 'interface.ts'), 'utf-8'),
        fs.readFile(path.join(folder, 'examples.json'), 'utf-8'),
        fs.readFile(path.join(folder, 'metadata.json'), 'utf-8')
      ]);
      
      return {
        zodSchema,
        tsInterface,
        examples: JSON.parse(examples),
        metadata: JSON.parse(metadata)
      };
      
    } catch (error) {
      this.logger.error(`Failed to load schema for ${eventType}`, error as Error);
      return null;
    }
  }

  /**
   * Atualiza metadata de um evento
   */
  async updateMetadata(eventType: string, metadata: EventMetadata): Promise<void> {
    try {
      const folder = await this.getEventTypeFolder(eventType);
      const metadataPath = path.join(folder, 'metadata.json');
      
      let existingMetadata: EventMetadata | null = null;
      
      // Tenta carregar metadata existente
      try {
        const existing = await fs.readFile(metadataPath, 'utf-8');
        existingMetadata = JSON.parse(existing);
      } catch {
        // Arquivo não existe ou é inválido, continuará com null
      }
      
      // Merge metadata
      const updatedMetadata = this.mergeMetadata(existingMetadata, metadata);
      
      // Salva metadata atualizada
      await fs.writeFile(
        metadataPath,
        JSON.stringify(updatedMetadata, null, 2),
        'utf-8'
      );
      
      this.logger.debug('Metadata updated', { 
        eventType,
        totalReceived: updatedMetadata.totalReceived,
        schemaVersion: updatedMetadata.schemaVersion
      });
      
    } catch (error) {
      this.logger.error('Failed to update metadata', error as Error, { eventType });
      throw error;
    }
  }

  /**
   * Faz merge de metadata nova com existente
   */
  private mergeMetadata(
    existing: EventMetadata | null,
    newMetadata: EventMetadata
  ): EventMetadata {
    if (!existing) {
      return {
        ...newMetadata,
        firstSeen: newMetadata.firstSeen || new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        totalReceived: 1
      };
    }
    
    return {
      ...existing,
      lastSeen: new Date().toISOString(),
      totalReceived: existing.totalReceived + 1,
      schemaVersion: newMetadata.schemaVersion || existing.schemaVersion,
      lastModified: newMetadata.lastModified || new Date().toISOString(),
      fields: {
        required: [...new Set([...existing.fields.required, ...newMetadata.fields.required])],
        optional: [...new Set([...existing.fields.optional, ...newMetadata.fields.optional])],
        truncated: [...new Set([...existing.fields.truncated, ...newMetadata.fields.truncated])]
      },
      variations: this.mergeVariations(existing.variations, newMetadata.variations)
    };
  }

  /**
   * Faz merge de variações de schema
   */
  private mergeVariations(
    existing: SchemaVariation[],
    newVariations: SchemaVariation[]
  ): SchemaVariation[] {
    const variationMap = new Map<string, SchemaVariation>();
    
    // Adiciona existentes
    for (const variation of existing) {
      variationMap.set(variation.hash, variation);
    }
    
    // Adiciona ou atualiza novas
    for (const variation of newVariations) {
      const existingVariation = variationMap.get(variation.hash);
      if (existingVariation) {
        existingVariation.count += variation.count;
      } else {
        variationMap.set(variation.hash, { ...variation });
      }
    }
    
    // Mantém apenas as 10 variações mais comuns
    return Array.from(variationMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Obtém ou cria pasta para um tipo de evento (suporta estruturas aninhadas)
   */
  async getEventTypeFolder(eventType: string): Promise<string> {
    const sanitizedEventType = this.sanitizeEventType(eventType);
    const folder = path.join(this.schemasDir, sanitizedEventType);
    
    await this.ensureDirectoryExists(folder);
    await this.ensureDirectoryExists(path.join(folder, 'raw-samples'));
    
    return folder;
  }

  /**
   * Sanitiza nome de tipo de evento para usar como nome de pasta
   * Preserva '/' para estruturas aninhadas (ex: whatsapp_business_account/messages_text)
   */
  private sanitizeEventType(eventType: string): string {
    // Primeiro separa por '/' para processar cada parte individualmente
    const parts = eventType.split('/');
    
    // Sanitiza cada parte separadamente, preservando a estrutura de diretórios
    const sanitizedParts = parts.map(part => 
      part.replace(/[^a-zA-Z0-9_-]/g, '_')
    );
    
    // Reconstroi o caminho mantendo as barras para estrutura aninhada
    return sanitizedParts.join('/');
  }

  /**
   * Salva uma amostra raw (sem truncamento)
   */
  async saveRawSample(eventType: string, sample: any): Promise<void> {
    try {
      const folder = await this.getEventTypeFolder(eventType);
      const samplesDir = path.join(folder, 'raw-samples');
      
      const timestamp = Date.now();
      const filename = `sample-${timestamp}.json`;
      const filePath = path.join(samplesDir, filename);
      
      await fs.writeFile(
        filePath,
        JSON.stringify(sample, null, 2),
        'utf-8'
      );
      
      // Limpa amostras antigas
      await this.cleanOldSamples(samplesDir, 10);
      
      this.logger.debug('Raw sample saved', { 
        eventType,
        filename,
        sampleSize: JSON.stringify(sample).length
      });
      
    } catch (error) {
      this.logger.error('Failed to save raw sample', error as Error, { eventType });
    }
  }

  /**
   * Remove amostras antigas mantendo apenas as mais recentes
   */
  private async cleanOldSamples(dir: string, maxSamples: number): Promise<void> {
    try {
      const files = await fs.readdir(dir);
      
      if (files.length <= maxSamples) return;
      
      // Obtém informações de todos os arquivos
      const filesWithStats = await Promise.all(
        files.map(async (file) => {
          try {
            const filePath = path.join(dir, file);
            const stat = await fs.stat(filePath);
            return { file, mtime: stat.mtime.getTime() };
          } catch {
            return null;
          }
        })
      );
      
      // Remove entradas nulas e ordena por data (mais recente primeiro)
      const validFiles = filesWithStats
        .filter(item => item !== null)
        .sort((a, b) => b!.mtime - a!.mtime);
      
      // Remove arquivos mais antigos
      const filesToDelete = validFiles.slice(maxSamples);
      
      await Promise.all(
        filesToDelete.map(async ({ file }) => {
          try {
            await fs.unlink(path.join(dir, file));
          } catch (error) {
            this.logger.warn(`Failed to delete old sample ${file}`, { error });
          }
        })
      );
      
      if (filesToDelete.length > 0) {
        this.logger.debug('Cleaned old samples', { 
          directory: dir,
          deletedCount: filesToDelete.length,
          remainingCount: maxSamples
        });
      }
      
    } catch (error) {
      this.logger.error('Failed to clean old samples', error as Error, { directory: dir });
    }
  }

  /**
   * Escreve arquivo de schema com tratamento de erro
   */
  private async writeSchemaFile(folder: string, filename: string, content: string): Promise<void> {
    try {
      await fs.writeFile(path.join(folder, filename), content, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to write ${filename}`, error as Error, { folder });
      throw error;
    }
  }

  /**
   * Garante que um diretório existe
   */
  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Ignora erro se diretório já existe
      if ((error as any)?.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Lista todos os tipos de evento disponíveis (suporta estruturas aninhadas)
   */
  async listEventTypes(): Promise<string[]> {
    try {
      await this.ensureDirectoryExists(this.schemasDir);
      
      // Usa a função recursiva para encontrar todos os event types
      const eventTypes = await this.findAllEventTypes(this.schemasDir);
      
      return eventTypes.sort();
      
    } catch (error) {
      this.logger.error('Failed to list event types', error as Error);
      return [];
    }
  }

  /**
   * Obtém estatísticas do sistema de arquivos
   */
  async getFileSystemStats(): Promise<{
    totalSchemas: number;
    totalSize: number;
    oldestSchema: string | null;
    newestSchema: string | null;
  }> {
    try {
      const eventTypes = await this.listEventTypes();
      let totalSize = 0;
      let oldestTime = Number.MAX_SAFE_INTEGER;
      let newestTime = 0;
      let oldestSchema: string | null = null;
      let newestSchema: string | null = null;
      
      for (const eventType of eventTypes) {
        const folder = path.join(this.schemasDir, eventType);
        
        try {
          const files = await fs.readdir(folder);
          
          for (const file of files) {
            const filePath = path.join(folder, file);
            const stat = await fs.stat(filePath);
            
            totalSize += stat.size;
            
            if (stat.mtime.getTime() < oldestTime) {
              oldestTime = stat.mtime.getTime();
              oldestSchema = eventType;
            }
            
            if (stat.mtime.getTime() > newestTime) {
              newestTime = stat.mtime.getTime();
              newestSchema = eventType;
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to get stats for ${eventType}`, { error });
        }
      }
      
      return {
        totalSchemas: eventTypes.length,
        totalSize,
        oldestSchema,
        newestSchema
      };
      
    } catch (error) {
      this.logger.error('Failed to get filesystem stats', error as Error);
      return {
        totalSchemas: 0,
        totalSize: 0,
        oldestSchema: null,
        newestSchema: null
      };
    }
  }

  /**
   * Remove um schema específico
   */
  async removeSchema(eventType: string): Promise<boolean> {
    try {
      const folder = path.join(this.schemasDir, this.sanitizeEventType(eventType));
      await fs.rm(folder, { recursive: true, force: true });
      
      this.logger.info('Schema removed', { eventType });
      return true;
      
    } catch (error) {
      this.logger.error('Failed to remove schema', error as Error, { eventType });
      return false;
    }
  }
}
