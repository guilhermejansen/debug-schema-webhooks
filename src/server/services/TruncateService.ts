import { TruncateConfig, TruncateMetadata, TruncatedField } from '@/types/base';
import { TypeDetector } from '@/server/utils/TypeDetector';
import { Logger } from '@/server/utils/Logger';

/**
 * Serviço responsável por truncar campos grandes em eventos de webhook
 * Preserva a estrutura original enquanto reduz o tamanho dos payloads
 */
export class TruncateService {
  private readonly logger: Logger;
  private readonly config: TruncateConfig;
  private readonly truncateMarker = '[TRUNCATED]';

  constructor(config: TruncateConfig) {
    this.config = config;
    this.logger = new Logger('TruncateService');
  }

  /**
   * Trunca um evento mantendo sua estrutura original
   */
  truncateEvent(event: any): { truncated: any; metadata: TruncateMetadata } {
    this.logger.debug('Starting event truncation', {
      action: 'truncate_start',
      originalSize: TypeDetector.estimateSize(event)
    });

    const truncated = this.deepTruncate(event, '');
    const metadata = this.extractMetadata(event, truncated);

    this.logger.debug('Event truncation completed', {
      action: 'truncate_complete',
      originalSize: metadata.originalSize,
      truncatedSize: metadata.truncatedSize,
      fieldsAffected: metadata.truncatedFields.length
    });

    return { truncated, metadata };
  }

  /**
   * Trunca recursivamente todos os campos de um objeto
   */
  private deepTruncate(obj: any, path: string): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.truncateString(obj, path);
    }

    if (Array.isArray(obj)) {
      return obj.map((item, index) => 
        this.deepTruncate(item, `${path}[${index}]`)
      );
    }

    if (typeof obj === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        const newPath = path ? `${path}.${key}` : key;
        result[key] = this.deepTruncate(value, newPath);
      }
      
      return result;
    }

    // Para números, booleans, etc., retorna como está
    return obj;
  }

  /**
   * Trunca uma string se necessário
   */
  private truncateString(value: string, path: string): string {
    if (!this.shouldTruncate(path, value)) {
      return value;
    }

    // Preserva o início da string para análise de tipo
    const truncated = value.substring(0, this.config.maxLength);
    const result = `${truncated}...${this.truncateMarker}`;

    // Log detalhado para debugging
    this.logger.debug('Field truncated', {
      path,
      originalLength: value.length,
      truncatedLength: result.length,
      type: TypeDetector.detectLargeStringType(value)
    });

    return result;
  }

  /**
   * Determina se um campo deve ser truncado
   */
  private shouldTruncate(path: string, value: string): boolean {
    // Extrai o nome do campo do path
    const fieldName = this.extractFieldName(path);
    
    return TypeDetector.shouldTruncateField(
      fieldName,
      value,
      this.config.fields,
      this.config.maxLength
    );
  }

  /**
   * Extrai o nome do campo de um path
   */
  private extractFieldName(path: string): string {
    // Remove índices de arrays e pega o último nome de campo
    const cleaned = path.replace(/\[\d+\]/g, '');
    const parts = cleaned.split('.');
    return parts[parts.length - 1] || '';
  }

  /**
   * Extrai metadata sobre o processo de truncamento
   */
  private extractMetadata(original: any, truncated: any): TruncateMetadata {
    const fields: TruncatedField[] = [];
    this.findTruncatedFields(original, truncated, '', fields);
    
    return {
      hasTruncated: fields.length > 0,
      truncatedFields: fields,
      originalSize: TypeDetector.estimateSize(original),
      truncatedSize: TypeDetector.estimateSize(truncated)
    };
  }

  /**
   * Encontra todos os campos que foram truncados
   */
  private findTruncatedFields(
    original: any, 
    truncated: any, 
    path: string, 
    fields: TruncatedField[]
  ): void {
    if (typeof truncated === 'string' && truncated.includes(this.truncateMarker)) {
      const originalValue = original as string;
      
      fields.push({
        path,
        originalLength: originalValue.length,
        truncatedLength: truncated.length,
        type: TypeDetector.detectLargeStringType(originalValue)
      });
      
      return;
    }

    if (Array.isArray(truncated)) {
      truncated.forEach((item, index) => {
        const newPath = `${path}[${index}]`;
        const originalItem = Array.isArray(original) ? original[index] : undefined;
        
        if (originalItem !== undefined) {
          this.findTruncatedFields(originalItem, item, newPath, fields);
        }
      });
      return;
    }

    if (truncated && typeof truncated === 'object' && truncated !== null) {
      for (const key in truncated) {
        if (truncated.hasOwnProperty(key)) {
          const newPath = path ? `${path}.${key}` : key;
          const originalValue = original && original[key];
          
          if (originalValue !== undefined) {
            this.findTruncatedFields(originalValue, truncated[key], newPath, fields);
          }
        }
      }
    }
  }

  /**
   * Verifica se um evento foi truncado
   */
  static isTruncated(event: any): boolean {
    const jsonString = JSON.stringify(event);
    return jsonString.includes('[TRUNCATED]');
  }

  /**
   * Conta quantos campos foram truncados
   */
  static countTruncatedFields(event: any): number {
    const jsonString = JSON.stringify(event);
    const matches = jsonString.match(/\[TRUNCATED\]/g);
    return matches ? matches.length : 0;
  }

  /**
   * Remove marcadores de truncamento (para testes)
   */
  static removeTruncationMarkers(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/\.\.\.\[TRUNCATED\]$/, '');
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeTruncationMarkers(item));
    }

    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.removeTruncationMarkers(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Calcula estatísticas de truncamento
   */
  calculateTruncationStats(metadata: TruncateMetadata): {
    compressionRatio: number;
    bytesSaved: number;
    fieldsAffected: number;
    typeBreakdown: Record<string, number>;
  } {
    const bytesSaved = metadata.originalSize - metadata.truncatedSize;
    const compressionRatio = bytesSaved / metadata.originalSize;
    
    const typeBreakdown: Record<string, number> = {};
    for (const field of metadata.truncatedFields) {
      typeBreakdown[field.type] = (typeBreakdown[field.type] || 0) + 1;
    }

    return {
      compressionRatio,
      bytesSaved,
      fieldsAffected: metadata.truncatedFields.length,
      typeBreakdown
    };
  }

  /**
   * Valida se a configuração de truncamento é válida
   */
  static validateConfig(config: TruncateConfig): boolean {
    if (config.maxLength < 10 || config.maxLength > 10000) {
      throw new Error('TruncateConfig.maxLength must be between 10 and 10000');
    }

    if (!Array.isArray(config.fields) || config.fields.length === 0) {
      throw new Error('TruncateConfig.fields must be a non-empty array');
    }

    if (typeof config.preserveStructure !== 'boolean') {
      throw new Error('TruncateConfig.preserveStructure must be a boolean');
    }

    return true;
  }
}
