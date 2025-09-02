import * as crypto from 'crypto';
import { EventStructure } from '@/types/base';

/**
 * Utilitário para geração de hashes de estruturas de dados
 */
export class Hasher {
  
  /**
   * Gera hash SHA-256 de uma estrutura normalizada
   */
  static hashStructure(structure: EventStructure): string {
    const normalized = this.normalizeStructure(structure);
    const json = JSON.stringify(normalized, null, 0);
    
    return crypto
      .createHash('sha256')
      .update(json, 'utf8')
      .digest('hex');
  }

  /**
   * Normaliza uma estrutura para gerar hash consistente
   * Remove valores específicos, mantém apenas a estrutura
   */
  private static normalizeStructure(structure: EventStructure): any {
    const normalized: any = {
      type: structure.type,
      optional: structure.optional
    };
    
    // Se tem filhos, normaliza recursivamente
    if (structure.children) {
      normalized.children = {};
      
      // Ordena as chaves para garantir hash consistente
      const sortedKeys = Array.from(structure.children.keys()).sort();
      
      for (const key of sortedKeys) {
        const child = structure.children.get(key);
        if (child) {
          normalized.children[key] = this.normalizeStructure(child);
        }
      }
    }
    
    // Se é array, normaliza o tipo do item
    if (structure.arrayItemType) {
      normalized.arrayItemType = this.normalizeStructure(structure.arrayItemType);
    }
    
    // Não inclui no hash:
    // - examples (valores podem mudar)
    // - path (é contextual)
    // - isTruncated (é metadata, não estrutura)
    // - originalType (é metadata, não estrutura)
    
    return normalized;
  }

  /**
   * Gera hash de um payload completo (incluindo valores)
   */
  static hashPayload(payload: any): string {
    const json = JSON.stringify(payload, this.replacer);
    
    return crypto
      .createHash('sha256')
      .update(json, 'utf8')
      .digest('hex');
  }

  /**
   * Gera hash de um payload sem campos grandes (para deduplicação)
   */
  static hashPayloadStructure(payload: any): string {
    const normalized = this.normalizePayload(payload);
    const json = JSON.stringify(normalized, null, 0);
    
    return crypto
      .createHash('sha256')
      .update(json, 'utf8')
      .digest('hex');
  }

  /**
   * Normaliza um payload removendo valores específicos mas mantendo a estrutura
   */
  private static normalizePayload(obj: any, maxDepth: number = 10, currentDepth: number = 0): any {
    if (currentDepth > maxDepth) return '[MAX_DEPTH_REACHED]';
    if (obj === null) return null;
    if (obj === undefined) return undefined;
    
    if (typeof obj === 'string') {
      // Para strings grandes, mantém apenas uma representação do tipo
      if (obj.length > 1000) {
        if (/^[A-Za-z0-9+/]+=*$/.test(obj)) return '[BASE64_DATA]';
        if (obj.startsWith('{') || obj.startsWith('[')) return '[JSON_DATA]';
        return '[LARGE_TEXT]';
      }
      return obj.length < 100 ? obj : '[TEXT_DATA]';
    }
    
    if (typeof obj === 'number') return typeof obj;
    if (typeof obj === 'boolean') return typeof obj;
    
    if (Array.isArray(obj)) {
      if (obj.length === 0) return [];
      
      // Para arrays grandes, pega apenas alguns exemplos
      const sampleSize = Math.min(3, obj.length);
      const samples = obj.slice(0, sampleSize).map(item => 
        this.normalizePayload(item, maxDepth, currentDepth + 1)
      );
      
      if (obj.length > sampleSize) {
        samples.push('[MORE_ITEMS]');
      }
      
      return samples;
    }
    
    if (typeof obj === 'object') {
      const normalized: any = {};
      const keys = Object.keys(obj).sort(); // Ordena para hash consistente
      
      for (const key of keys) {
        normalized[key] = this.normalizePayload(obj[key], maxDepth, currentDepth + 1);
      }
      
      return normalized;
    }
    
    return typeof obj;
  }

  /**
   * Replacer function para JSON.stringify que trata valores especiais
   */
  private static replacer(_key: string, value: any): any {
    // Remove valores undefined
    if (value === undefined) return null;
    
    // Para strings muito grandes, substitui por placeholder
    if (typeof value === 'string' && value.length > 10000) {
      return '[LARGE_STRING]';
    }
    
    return value;
  }

  /**
   * Gera hash rápido (MD5) para casos onde performance é crítica
   */
  static quickHash(data: string): string {
    return crypto
      .createHash('md5')
      .update(data, 'utf8')
      .digest('hex');
  }

  /**
   * Gera identificador único baseado em timestamp e hash
   */
  static generateId(prefix: string = ''): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const combined = `${prefix}${timestamp}${random}`;
    
    return this.quickHash(combined).substring(0, 16);
  }

  /**
   * Compara dois hashes de estrutura para verificar se são idênticos
   */
  static compareStructures(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }

  /**
   * Gera hash para nome de arquivo baseado no tipo de evento
   */
  static hashEventType(eventType: string): string {
    // Remove caracteres especiais e converte para lowercase
    const cleaned = eventType.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    
    // Se for muito longo, usa hash
    if (cleaned.length > 50) {
      return this.quickHash(cleaned);
    }
    
    return cleaned;
  }

  /**
   * Verifica a integridade de dados comparando hashes
   */
  static verifyIntegrity(data: any, expectedHash: string): boolean {
    const actualHash = this.hashPayload(data);
    return actualHash === expectedHash;
  }

  /**
   * Calcula diferença aproximada entre duas estruturas baseado nos hashes
   */
  static calculateSimilarity(hash1: string, hash2: string): number {
    if (hash1 === hash2) return 1.0;
    
    // Usa distância de Hamming para strings de mesmo tamanho
    if (hash1.length !== hash2.length) return 0.0;
    
    let differences = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        differences++;
      }
    }
    
    return 1 - (differences / hash1.length);
  }
}
