import { EventStructure, EventMetadata } from '@/types/base';
import { Logger } from '@/server/utils/Logger';
import * as prettier from 'prettier';

/**
 * Serviço responsável por gerar schemas Zod e interfaces TypeScript
 */
export class SchemaGenerator {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger('SchemaGenerator');
  }

  /**
   * Converte eventType path para nome válido JS/TS (ex: whatsapp_business_account/messages_text -> WhatsappBusinessAccountMessagesText)
   */
  private convertPathToValidName(eventType: string): string {
    // Se não tem barra, usa normalização padrão
    if (!eventType.includes('/')) {
      return this.normalizeEventTypeName(eventType);
    }
    
    // Separa por barra, normaliza cada parte e junta
    const parts = eventType.split('/');
    const normalizedParts = parts.map(part => 
      part.replace(/[^a-zA-Z0-9]/g, '_')
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join('')
    );
    
    return normalizedParts.join('');
  }

  /**
   * Normaliza nome do tipo de evento para identificador válido JS/TS
   */
  private normalizeEventTypeName(eventType: string): string {
    return eventType
      .replace(/[^a-zA-Z0-9]/g, '_')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Gera schema Zod a partir de uma estrutura de evento
   */
  async generateZodSchema(
    structure: EventStructure, 
    eventType: string
  ): Promise<string> {
    this.logger.debug('Generating Zod schema', { eventType });

    // Converte path para nome válido
    const validName = this.convertPathToValidName(eventType);
    const schemaName = `${validName}Schema`;
    const schemaCode = this.buildZodSchema(structure, schemaName, eventType);
    
    const fullCode = `import { z } from 'zod';

${schemaCode}

export type ${validName} = z.infer<typeof ${schemaName}>;
`;

    const formatted = await this.formatCode(fullCode, 'typescript');
    
    this.logger.debug('Zod schema generated successfully', { 
      eventType,
      schemaLines: formatted.split('\n').length 
    });
    
    return formatted;
  }

  /**
   * Constrói o código do schema Zod recursivamente
   */
  private buildZodSchema(structure: EventStructure, name: string, originalEventType: string): string {
    const zodType = this.structureToZod(structure, 0);
    
    return `/**
 * Schema Zod para evento ${originalEventType}
 * Gerado automaticamente pelo Webhook Mapper
 */
export const ${name} = ${zodType};`;
  }

  /**
   * Converte uma estrutura para código Zod
   */
  private structureToZod(structure: EventStructure, depth: number = 0): string {
    const indent = '  '.repeat(depth);
    
    switch (structure.type) {
      case 'string':
        if (structure.isTruncated) {
          const description = `TRUNCATED FIELD - Original type: ${structure.originalType}`;
          return `z.string().describe('${description}')`;
        }
        return 'z.string()';
      
      case 'number':
        return 'z.number()';
      
      case 'boolean':
        return 'z.boolean()';
      
      case 'null':
        return 'z.null()';
      
      case 'array':
        if (structure.arrayItemType) {
          const itemSchema = this.structureToZod(structure.arrayItemType, depth);
          return `z.array(${itemSchema})`;
        }
        return 'z.array(z.any())';
      
      case 'object':
        if (structure.children && structure.children.size > 0) {
          const properties: string[] = [];
          
          for (const [key, child] of structure.children) {
            const zodType = this.structureToZod(child, depth + 1);
            const propertyKey = this.sanitizePropertyKey(key);
            
            // Adiciona comentário se foi truncado
            if (child.isTruncated) {
              properties.push(`${indent}  /** TRUNCATED FIELD - Original: ${child.originalType} */`);
            }
            
            if (child.optional) {
              properties.push(`${indent}  ${propertyKey}: ${zodType}.optional()`);
            } else {
              properties.push(`${indent}  ${propertyKey}: ${zodType}`);
            }
          }
          
          return `z.object({\n${properties.join(',\n')}\n${indent}})`;
        }
        return 'z.object({})';
      
      case 'union':
        if (structure.examples && structure.examples.length > 0) {
          const types = this.getUnionTypes(structure.examples);
          const zodTypes = types.map(type => this.primitiveTypeToZod(type));
          return `z.union([${zodTypes.join(', ')}])`;
        }
        return 'z.any()';
      
      default:
        return 'z.any()';
    }
  }

  /**
   * Sanitiza uma chave de propriedade para uso no Zod
   */
  private sanitizePropertyKey(key: string): string {
    // Se a chave é um identificador válido, usa como está
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return key;
    }
    
    // Caso contrário, usa string literal
    return `"${key.replace(/"/g, '\\"')}"`;
  }

  /**
   * Obtém tipos únicos de um array de exemplos
   */
  private getUnionTypes(examples: any[]): string[] {
    const types = new Set<string>();
    
    for (const example of examples) {
      if (example === null) {
        types.add('null');
      } else if (example === undefined) {
        types.add('undefined');
      } else if (Array.isArray(example)) {
        types.add('array');
      } else {
        types.add(typeof example);
      }
    }
    
    return Array.from(types);
  }

  /**
   * Converte tipo primitivo para Zod
   */
  private primitiveTypeToZod(type: string): string {
    const typeMap: Record<string, string> = {
      'string': 'z.string()',
      'number': 'z.number()',
      'boolean': 'z.boolean()',
      'null': 'z.null()',
      'undefined': 'z.undefined()',
      'object': 'z.object({})',
      'array': 'z.array(z.any())'
    };
    
    return typeMap[type] || 'z.any()';
  }

  /**
   * Gera interface TypeScript a partir de uma estrutura
   */
  async generateTypeScriptInterface(
    structure: EventStructure,
    eventType: string
  ): Promise<string> {
    this.logger.debug('Generating TypeScript interface', { eventType });

    try {
      // Converte path para nome válido
      const validName = this.convertPathToValidName(eventType);
      const interfaceCode = this.buildInterface(structure, validName, 0);
      
      const fullCode = `/**
 * Interface TypeScript para evento ${eventType}
 * Gerado automaticamente pelo Webhook Mapper
 */
${interfaceCode}`;

      // Valida sintaxe básica antes de formatar
      if (!this.validateTypeScriptSyntax(fullCode)) {
        this.logger.warn('Generated TypeScript has syntax issues, trying without validation', { 
          eventType,
          codePreview: fullCode.substring(0, 200)
        });
        
        // Tenta formatar sem validação primeiro
        try {
          const formatted = await this.formatCode(fullCode, 'typescript');
          this.logger.info('TypeScript formatted successfully despite validation issues', { eventType });
          return formatted;
        } catch (error) {
          this.logger.warn('Formatting also failed, using fallback', { eventType });
          return this.generateFallbackInterface(validName);
        }
      }

      const formatted = await this.formatCode(fullCode, 'typescript');
      
      this.logger.debug('TypeScript interface generated successfully', { 
        eventType,
        interfaceLines: formatted.split('\n').length 
      });
      
      return formatted;
    } catch (error) {
      this.logger.error('Failed to generate TypeScript interface', error as Error, { eventType });
      const validName = this.convertPathToValidName(eventType);
      return this.generateFallbackInterface(validName);
    }
  }

  /**
   * Constrói a interface TypeScript recursivamente
   */
  private buildInterface(structure: EventStructure, name: string, depth: number = 0): string {
    const properties = this.structureToInterface(structure, depth + 1);
    
    return `export interface ${name} ${properties}`;
  }

  /**
   * Converte estrutura para propriedades de interface TypeScript
   */
  private structureToInterface(structure: EventStructure, depth: number = 0): string {
    const indent = '  '.repeat(depth);
    
    switch (structure.type) {
      case 'string':
        if (structure.isTruncated) {
          return 'string'; // Remove comentário inline problemático
        }
        return 'string';
      
      case 'number':
        return 'number';
      
      case 'boolean':
        return 'boolean';
      
      case 'null':
        return 'null';
      
      case 'array':
        if (structure.arrayItemType) {
          const itemType = this.structureToInterface(structure.arrayItemType, depth);
          // Sanitiza o tipo para arrays, garantindo que seja válido
          const cleanItemType = this.sanitizeTypeForArray(itemType);
          return `${cleanItemType}[]`;
        }
        return 'any[]';
      
      case 'object':
        if (structure.children && structure.children.size > 0) {
          const properties: string[] = [];
          
          for (const [key, child] of structure.children) {
            const tsType = this.structureToInterface(child, depth + 1);
            const propertyKey = this.sanitizePropertyKey(key);
            const optional = child.optional ? '?' : '';
            
            // Adiciona comentário se foi truncado (como comentário separado)
            if (child.isTruncated) {
              properties.push(`${indent}  /** TRUNCATED FIELD - Original: ${child.originalType} */`);
            }
            
            // Sempre gera propriedade simples e válida
            properties.push(`${indent}  ${propertyKey}${optional}: ${tsType};`);
          }
          
          return `{\n${properties.join('\n')}\n${indent}}`;
        }
        return '{}';
      
      case 'union':
        if (structure.examples && structure.examples.length > 0) {
          const types = this.getUnionTypes(structure.examples);
          const tsTypes = types.map(type => this.primitiveTypeToTS(type));
          return tsTypes.join(' | ');
        }
        return 'any';
      
      default:
        return 'any';
    }
  }

  /**
   * Converte tipo primitivo para TypeScript
   */
  private primitiveTypeToTS(type: string): string {
    const typeMap: Record<string, string> = {
      'string': 'string',
      'number': 'number',
      'boolean': 'boolean',
      'null': 'null',
      'undefined': 'undefined',
      'object': 'object',
      'array': 'any[]'
    };
    
    return typeMap[type] || 'any';
  }

  /**
   * Gera exemplos para documentação
   */
  generateExamples(structure: EventStructure): object {
    const examples = structure.examples.slice(-5); // Últimos 5 exemplos
    
    return {
      truncated: examples,
      metadata: {
        totalExamples: structure.examples.length,
        examplesShown: examples.length,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      }
    };
  }

  /**
   * Gera metadata para o evento
   */
  generateMetadata(
    eventType: string,
    structure: EventStructure,
    existingMetadata?: EventMetadata
  ): EventMetadata {
    const requiredFields = this.extractRequiredFields(structure);
    const optionalFields = this.extractOptionalFields(structure);
    const truncatedFields = this.extractTruncatedFields(structure);
    
    const now = new Date().toISOString();
    
    return {
      eventType,
      firstSeen: existingMetadata?.firstSeen || now,
      lastSeen: now,
      totalReceived: (existingMetadata?.totalReceived || 0) + 1,
      schemaVersion: (existingMetadata?.schemaVersion || 0) + 1,
      lastModified: now,
      fields: {
        required: requiredFields,
        optional: optionalFields,
        truncated: truncatedFields
      },
      variations: existingMetadata?.variations || []
    };
  }

  /**
   * Extrai campos obrigatórios da estrutura
   */
  private extractRequiredFields(structure: EventStructure): string[] {
    const fields: string[] = [];
    
    const traverse = (node: EventStructure, path: string = '') => {
      if (!node.optional && path) {
        fields.push(path);
      }
      
      if (node.children) {
        for (const [key, child] of node.children) {
          const childPath = path ? `${path}.${key}` : key;
          traverse(child, childPath);
        }
      }
      
      if (node.arrayItemType) {
        traverse(node.arrayItemType, `${path}[]`);
      }
    };
    
    traverse(structure);
    return fields;
  }

  /**
   * Extrai campos opcionais da estrutura
   */
  private extractOptionalFields(structure: EventStructure): string[] {
    const fields: string[] = [];
    
    const traverse = (node: EventStructure, path: string = '') => {
      if (node.optional && path) {
        fields.push(path);
      }
      
      if (node.children) {
        for (const [key, child] of node.children) {
          const childPath = path ? `${path}.${key}` : key;
          traverse(child, childPath);
        }
      }
      
      if (node.arrayItemType) {
        traverse(node.arrayItemType, `${path}[]`);
      }
    };
    
    traverse(structure);
    return fields;
  }

  /**
   * Extrai campos truncados da estrutura
   */
  private extractTruncatedFields(structure: EventStructure): string[] {
    const fields: string[] = [];
    
    const traverse = (node: EventStructure, path: string = '') => {
      if (node.isTruncated && path) {
        fields.push(path);
      }
      
      if (node.children) {
        for (const [key, child] of node.children) {
          const childPath = path ? `${path}.${key}` : key;
          traverse(child, childPath);
        }
      }
      
      if (node.arrayItemType) {
        traverse(node.arrayItemType, `${path}[]`);
      }
    };
    
    traverse(structure);
    return fields;
  }

  /**
   * Formata código usando Prettier
   */
  private async formatCode(code: string, parser: 'typescript' | 'json'): Promise<string> {
    try {
      // Validação básica antes de formatar
      if (!code || typeof code !== 'string') {
        throw new Error('Invalid code input');
      }
      
      return await prettier.format(code, {
        parser,
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        trailingComma: 'es5',
        printWidth: 100,
        bracketSpacing: true,
        arrowParens: 'avoid'
      });
    } catch (error) {
      this.logger.error('Failed to format code with Prettier', error as Error, {
        parser,
        codeLength: code?.length || 0,
        codePreview: code?.substring(0, 100) || 'N/A'
      });
      
      // Retorna código não formatado mas com indentação básica
      return this.addBasicFormatting(code);
    }
  }
  
  /**
   * Adiciona formatação básica quando Prettier falha
   */
  private addBasicFormatting(code: string): string {
    if (!code) return '';
    
    try {
      const lines = code.split('\n');
      const formatted: string[] = [];
      let indent = 0;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          formatted.push('');
          continue;
        }
        
        // Diminui indentação antes de adicionar linha que fecha
        if (trimmed.startsWith('}')) {
          indent = Math.max(0, indent - 1);
        }
        
        formatted.push('  '.repeat(indent) + trimmed);
        
        // Aumenta indentação depois de linha que abre
        if (trimmed.endsWith('{')) {
          indent++;
        }
      }
      
      return formatted.join('\n');
    } catch {
      return code; // Se tudo falhar, retorna original
    }
  }

  /**
   * Sanitiza tipo para uso em arrays, preservando estruturas complexas
   */
  private sanitizeTypeForArray(type: string | undefined): string {
    if (!type || typeof type !== 'string') {
      return 'any';
    }
    
    try {
      // Para tipos primitivos simples, sanitiza normalmente
      const trimmed = type.trim();
      
      if (!trimmed || trimmed === 'undefined') {
        return 'any';
      }
      
      // Se é um tipo primitivo simples, remove comentários
      if (!trimmed.includes('{') && !trimmed.includes('\n')) {
        const cleanType = trimmed
          .split('//')[0]  // Remove comentários
          ?.split(';')[0]   // Remove ponto-e-vírgula
          ?.trim()          // Remove espaços
          ?.replace(/\s+/g, ' ') || 'any';
        
        return cleanType || 'any';
      }
      
      // Para tipos complexos (objetos), preserva a estrutura
      // Apenas remove comentários inline problemáticos que quebram sintaxe
      const cleanType = trimmed
        .replace(/\/\*.*?\*\//g, '') // Remove comentários de bloco
        .replace(/\/\/.*$/gm, '')     // Remove comentários de linha
        .replace(/;\s*$/gm, '')       // Remove ponto-e-vírgula no final
        .trim();
      
      // Valida se a estrutura parece válida
      if (this.isValidTypeScriptType(cleanType)) {
        return cleanType;
      }
      
      return 'any';
    } catch {
      return 'any';
    }
  }
  
  /**
   * Valida se um tipo TypeScript parece válido
   */
  private isValidTypeScriptType(type: string): boolean {
    if (!type) return false;
    
    // Conta chaves balanceadas
    let braceCount = 0;
    let parenCount = 0;
    
    for (const char of type) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      
      // Se ficou negativo, estrutura inválida
      if (braceCount < 0 || parenCount < 0) {
        return false;
      }
    }
    
    // Deve estar balanceado
    return braceCount === 0 && parenCount === 0;
  }
  
  /**
   * Valida sintaxe básica do TypeScript gerado
   */
  private validateTypeScriptSyntax(code: string): boolean {
    try {
      // Verificações básicas de sintaxe
      const lines = code.split('\n');
      let braceCount = 0;
      let parenCount = 0;
      let bracketCount = 0; // Para arrays []
      
      for (const line of lines) {
        // Conta delimitadores
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (char === '(') parenCount++;
          if (char === ')') parenCount--;
          if (char === '[') bracketCount++;
          if (char === ']') bracketCount--;
        }
        
        // Verifica sintaxe básica de propriedade (mais permissiva)
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('export')) {
          // Se linha tem : deve terminar apropriadamente
          if (trimmed.includes(':') && trimmed.length > 10) { // Só valida linhas substanciais
            const isValid = trimmed.endsWith(';') || 
                           trimmed.endsWith('{') || 
                           trimmed.endsWith('}') || 
                           trimmed.endsWith('[]') ||
                           trimmed.endsWith('[') ||
                           trimmed.includes('[]') ||
                           trimmed.includes('?:'); // Optional properties
            
            if (!isValid) {
              return false;
            }
          }
        }
        
        // Se ficaram negativos, estrutura inválida
        if (braceCount < 0 || parenCount < 0 || bracketCount < 0) {
          return false;
        }
      }
      
      // Verifica se todos os delimitadores estão balanceados
      return braceCount === 0 && parenCount === 0 && bracketCount === 0;
    } catch {
      return false;
    }
  }
  
  /**
   * Gera interface TypeScript fallback simples
   */
  private generateFallbackInterface(validName: string): string {
    return `/**
 * Interface TypeScript (Fallback)
 * Gerado automaticamente pelo Webhook Mapper
 */
export interface ${validName} {
  [key: string]: any;
}`;
  }

  /**
   * Valida se um schema gerado é válido
   */
  validateGeneratedSchema(zodSchema: string, tsInterface: string): boolean {
    try {
      // Verificações básicas de sintaxe
      if (!zodSchema.includes('z.object') && !zodSchema.includes('z.')) {
        return false;
      }
      
      if (!tsInterface.includes('interface') && !tsInterface.includes('export')) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }
}
