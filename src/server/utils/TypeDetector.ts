/**
 * Utilitário para detecção precisa de tipos JavaScript/TypeScript
 */

export type DetectedType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined' | 'function';

export class TypeDetector {
  
  /**
   * Detecta o tipo de um valor de forma precisa
   */
  static detectType(value: any): DetectedType {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number' && !isNaN(value)) return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'function') return 'function';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    
    return 'object'; // fallback
  }

  /**
   * Verifica se um valor parece ser uma string base64
   */
  static isBase64String(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    
    // Deve ter pelo menos 4 caracteres
    if (value.length < 4) return false;
    
    // Padrão básico de base64
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    if (!base64Pattern.test(value)) return false;
    
    // Deve ter tamanho múltiplo de 4 (com padding)
    if (value.length % 4 !== 0) return false;
    
    // Se for muito pequeno, provavelmente não é base64
    if (value.length < 20) return false;
    
    return true;
  }

  /**
   * Verifica se um valor parece ser JSON válido
   */
  static isJsonString(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    
    try {
      const parsed = JSON.parse(value);
      // Deve ser objeto ou array para ser considerado JSON útil
      return typeof parsed === 'object';
    } catch {
      return false;
    }
  }

  /**
   * Detecta o tipo específico de uma string grande
   */
  static detectLargeStringType(value: string): 'base64' | 'json' | 'text' {
    if (this.isBase64String(value)) return 'base64';
    if (this.isJsonString(value)) return 'json';
    return 'text';
  }

  /**
   * Verifica se um campo deve ser truncado baseado no nome e valor
   */
  static shouldTruncateField(fieldName: string, value: any, truncateFields: string[], maxLength: number): boolean {
    if (typeof value !== 'string') return false;
    
    // Verifica se o nome do campo está na lista de campos para truncar
    const normalizedFieldName = fieldName.toLowerCase();
    const shouldTruncateByName = truncateFields.some(field => 
      normalizedFieldName.includes(field.toLowerCase())
    );
    
    if (shouldTruncateByName) return true;
    
    // Verifica se é uma string muito grande que parece ser base64
    if (value.length > maxLength * 10 && this.isBase64String(value)) {
      return true;
    }
    
    return false;
  }

  /**
   * Detecta tipos únicos em um array
   */
  static detectArrayItemTypes(array: any[]): DetectedType[] {
    if (!Array.isArray(array) || array.length === 0) return [];
    
    const types = new Set<DetectedType>();
    
    for (const item of array) {
      types.add(this.detectType(item));
      
      // Limita a 5 tipos diferentes para evitar unions muito complexas
      if (types.size >= 5) break;
    }
    
    return Array.from(types);
  }

  /**
   * Verifica se um valor é "vazio" (null, undefined, string vazia, array vazio, objeto vazio)
   */
  static isEmpty(value: any): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === 'object' && Object.keys(value).length === 0) return true;
    
    return false;
  }

  /**
   * Conta a profundidade máxima de aninhamento de um objeto
   */
  static getMaxDepth(obj: any, currentDepth: number = 0): number {
    if (typeof obj !== 'object' || obj === null) return currentDepth;
    
    if (Array.isArray(obj)) {
      let maxArrayDepth = currentDepth;
      for (const item of obj) {
        const itemDepth = this.getMaxDepth(item, currentDepth + 1);
        maxArrayDepth = Math.max(maxArrayDepth, itemDepth);
      }
      return maxArrayDepth;
    }
    
    let maxDepth = currentDepth;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const valueDepth = this.getMaxDepth(obj[key], currentDepth + 1);
        maxDepth = Math.max(maxDepth, valueDepth);
      }
    }
    
    return maxDepth;
  }

  /**
   * Conta o número total de propriedades em um objeto (incluindo aninhadas)
   */
  static countTotalProperties(obj: any): number {
    if (typeof obj !== 'object' || obj === null) return 0;
    
    if (Array.isArray(obj)) {
      let count = 0;
      for (const item of obj) {
        count += this.countTotalProperties(item);
      }
      return count;
    }
    
    let count = Object.keys(obj).length;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        count += this.countTotalProperties(obj[key]);
      }
    }
    
    return count;
  }

  /**
   * Estima o tamanho em bytes de um objeto serializado
   */
  static estimateSize(obj: any): number {
    try {
      return JSON.stringify(obj).length * 2; // Aproximadamente 2 bytes por caractere UTF-8
    } catch {
      return 0;
    }
  }
}
