import { EventStructure, StructureDifference } from '@/types/base';
import { Hasher } from '@/server/utils/Hasher';
import { Logger } from '@/server/utils/Logger';

/**
 * Serviço responsável por comparar e fazer merge de estruturas de schemas
 */
export class SchemaComparator {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger('SchemaComparator');
  }

  /**
   * Compara duas estruturas para verificar se são idênticas
   */
  compareStructures(
    newStructure: EventStructure, 
    existingStructure: EventStructure
  ): boolean {
    const newHash = Hasher.hashStructure(newStructure);
    const existingHash = Hasher.hashStructure(existingStructure);
    
    const isIdentical = newHash === existingHash;
    
    this.logger.debug('Structure comparison completed', {
      newHash: newHash.substring(0, 8),
      existingHash: existingHash.substring(0, 8),
      isIdentical
    });
    
    return isIdentical;
  }

  /**
   * Encontra diferenças específicas entre duas estruturas
   */
  findDifferences(
    newStructure: EventStructure, 
    existingStructure: EventStructure
  ): StructureDifference[] {
    const differences: StructureDifference[] = [];
    
    this.compareDFS(newStructure, existingStructure, '', differences);
    
    this.logger.debug('Structure differences found', {
      totalDifferences: differences.length,
      types: differences.map(d => d.type)
    });
    
    return differences;
  }

  /**
   * Compara estruturas recursivamente usando DFS
   */
  private compareDFS(
    newNode: EventStructure,
    existingNode: EventStructure,
    path: string,
    differences: StructureDifference[]
  ): void {
    // Compara tipos
    if (newNode.type !== existingNode.type) {
      differences.push({
        type: 'type_change',
        path,
        oldType: existingNode.type,
        newType: newNode.type
      });
    }
    
    // Compara opcionalidade
    if (newNode.optional !== existingNode.optional) {
      differences.push({
        type: 'optional_change',
        path,
        wasOptional: existingNode.optional,
        isOptional: newNode.optional
      });
    }
    
    // Compara estruturas de objeto
    this.compareObjectStructures(newNode, existingNode, path, differences);
    
    // Compara estruturas de array
    this.compareArrayStructures(newNode, existingNode, path, differences);
  }

  /**
   * Compara estruturas de objetos (children)
   */
  private compareObjectStructures(
    newNode: EventStructure,
    existingNode: EventStructure,
    path: string,
    differences: StructureDifference[]
  ): void {
    if (!newNode.children && !existingNode.children) return;
    
    const newKeys = new Set(newNode.children?.keys() || []);
    const existingKeys = new Set(existingNode.children?.keys() || []);
    const allKeys = new Set([...newKeys, ...existingKeys]);
    
    for (const key of allKeys) {
      const newChild = newNode.children?.get(key);
      const existingChild = existingNode.children?.get(key);
      const childPath = path ? `${path}.${key}` : key;
      
      if (newChild && !existingChild) {
        differences.push({
          type: 'field_added',
          path: childPath,
          field: key
        });
      } else if (!newChild && existingChild) {
        differences.push({
          type: 'field_removed',
          path: childPath,
          field: key
        });
      } else if (newChild && existingChild) {
        this.compareDFS(newChild, existingChild, childPath, differences);
      }
    }
  }

  /**
   * Compara estruturas de arrays (arrayItemType)
   */
  private compareArrayStructures(
    newNode: EventStructure,
    existingNode: EventStructure,
    path: string,
    differences: StructureDifference[]
  ): void {
    const newArrayType = newNode.arrayItemType;
    const existingArrayType = existingNode.arrayItemType;
    
    if (newArrayType && existingArrayType) {
      this.compareDFS(newArrayType, existingArrayType, `${path}[]`, differences);
    } else if (newArrayType && !existingArrayType) {
      differences.push({
        type: 'field_added',
        path: `${path}[]`,
        field: 'arrayItemType'
      });
    } else if (!newArrayType && existingArrayType) {
      differences.push({
        type: 'field_removed',
        path: `${path}[]`,
        field: 'arrayItemType'
      });
    }
  }

  /**
   * Faz merge de duas estruturas, preservando informações de ambas
   */
  mergeStructures(
    base: EventStructure, 
    update: EventStructure
  ): EventStructure {
    this.logger.debug('Starting structure merge', {
      baseType: base.type,
      updateType: update.type
    });

    const merged: EventStructure = {
      path: base.path,
      type: this.mergeTypes(base.type, update.type),
      optional: this.mergeOptional(base.optional, update.optional),
      examples: this.mergeExamples(base.examples, update.examples)
    };

    // Adicionar propriedades opcionais apenas se definidas
    if (base.isTruncated !== undefined || update.isTruncated !== undefined) {
      merged.isTruncated = (base.isTruncated || update.isTruncated) as boolean | undefined;
    }

    if (base.originalType !== undefined || update.originalType !== undefined) {
      merged.originalType = (base.originalType || update.originalType) as string | undefined;
    }
    
    // Merge children
    const mergedChildren = this.mergeChildren(base.children, update.children);
    if (mergedChildren !== undefined) {
      merged.children = mergedChildren;
    }
    
    // Merge array item types
    const mergedArrayItemType = this.mergeArrayItemTypes(base.arrayItemType, update.arrayItemType);
    if (mergedArrayItemType !== undefined) {
      merged.arrayItemType = mergedArrayItemType;
    }
    
    this.logger.debug('Structure merge completed', {
      resultType: merged.type,
      childrenCount: merged.children?.size || 0
    });
    
    return merged;
  }

  /**
   * Merge tipos de duas estruturas
   */
  private mergeTypes(
    baseType: EventStructure['type'], 
    updateType: EventStructure['type']
  ): EventStructure['type'] {
    if (baseType === updateType) return baseType;
    
    // Se um dos tipos é union, mantém union
    if (baseType === 'union' || updateType === 'union') return 'union';
    
    // Se tipos são diferentes, cria union
    return 'union';
  }

  /**
   * Merge opcionalidade - se qualquer um é opcional, o resultado é opcional
   */
  private mergeOptional(baseOptional: boolean, updateOptional: boolean): boolean {
    return baseOptional || updateOptional;
  }

  /**
   * Merge exemplos, mantendo diversidade
   */
  private mergeExamples(baseExamples: any[], updateExamples: any[]): any[] {
    const combined = [...baseExamples, ...updateExamples];
    
    // Remove duplicatas simples e limita a 20 exemplos
    const unique = combined.filter((example, index, array) => {
      return index === array.findIndex(item => 
        JSON.stringify(item) === JSON.stringify(example)
      );
    });
    
    return unique.slice(-20); // Mantém os últimos 20 exemplos únicos
  }

  /**
   * Merge children de duas estruturas
   */
  private mergeChildren(
    baseChildren?: Map<string, EventStructure>,
    updateChildren?: Map<string, EventStructure>
  ): Map<string, EventStructure> | undefined {
    if (!baseChildren && !updateChildren) return undefined;
    
    const merged = new Map<string, EventStructure>();
    
    // Todas as chaves únicas
    const allKeys = new Set([
      ...(baseChildren?.keys() || []),
      ...(updateChildren?.keys() || [])
    ]);
    
    for (const key of allKeys) {
      const baseChild = baseChildren?.get(key);
      const updateChild = updateChildren?.get(key);
      
      if (baseChild && updateChild) {
        // Ambos existem, faz merge recursivo
        merged.set(key, this.mergeStructures(baseChild, updateChild));
      } else if (baseChild) {
        // Só existe na base, marca como opcional (campo removido no update)
        const optionalBase = { ...baseChild, optional: true };
        merged.set(key, optionalBase);
      } else if (updateChild) {
        // Só existe no update, marca como opcional (campo novo)
        const optionalUpdate = { ...updateChild, optional: true };
        merged.set(key, optionalUpdate);
      }
    }
    
    return merged.size > 0 ? merged : undefined;
  }

  /**
   * Merge tipos de itens de array
   */
  private mergeArrayItemTypes(
    baseArrayType?: EventStructure,
    updateArrayType?: EventStructure
  ): EventStructure | undefined {
    if (!baseArrayType && !updateArrayType) return undefined;
    if (!baseArrayType) return updateArrayType;
    if (!updateArrayType) return baseArrayType;
    
    return this.mergeStructures(baseArrayType, updateArrayType);
  }

  /**
   * Calcula score de similaridade entre duas estruturas
   */
  calculateSimilarityScore(
    structure1: EventStructure,
    structure2: EventStructure
  ): number {
    const hash1 = Hasher.hashStructure(structure1);
    const hash2 = Hasher.hashStructure(structure2);
    
    return Hasher.calculateSimilarity(hash1, hash2);
  }

  /**
   * Verifica se uma estrutura é subconjunto de outra
   */
  isSubset(
    subset: EventStructure,
    superset: EventStructure
  ): boolean {
    return this.checkSubsetRecursive(subset, superset);
  }

  /**
   * Verifica subset recursivamente
   */
  private checkSubsetRecursive(
    subset: EventStructure,
    superset: EventStructure
  ): boolean {
    // Tipo deve ser compatível
    if (!this.areTypesCompatible(subset.type, superset.type)) {
      return false;
    }
    
    // Se subset é obrigatório, superset também deve ser (ou ser union)
    if (!subset.optional && superset.optional && superset.type !== 'union') {
      return false;
    }
    
    // Verifica children
    if (subset.children) {
      if (!superset.children) return false;
      
      for (const [key, subChild] of subset.children) {
        const superChild = superset.children.get(key);
        if (!superChild || !this.checkSubsetRecursive(subChild, superChild)) {
          return false;
        }
      }
    }
    
    // Verifica array item types
    if (subset.arrayItemType) {
      if (!superset.arrayItemType) return false;
      
      if (!this.checkSubsetRecursive(subset.arrayItemType, superset.arrayItemType)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Verifica se dois tipos são compatíveis
   */
  private areTypesCompatible(
    type1: EventStructure['type'],
    type2: EventStructure['type']
  ): boolean {
    if (type1 === type2) return true;
    
    // Union é compatível com qualquer tipo
    if (type1 === 'union' || type2 === 'union') return true;
    
    return false;
  }

  /**
   * Gera relatório de diferenças legível
   */
  generateDifferenceReport(differences: StructureDifference[]): string {
    if (differences.length === 0) {
      return 'No differences found between structures.';
    }
    
    const lines = ['Structure differences found:', ''];
    
    const groupedDiffs = this.groupDifferencesByType(differences);
    
    for (const [type, diffs] of Object.entries(groupedDiffs)) {
      lines.push(`${type.toUpperCase()}:`);
      for (const diff of diffs) {
        lines.push(`  - ${this.formatDifference(diff)}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Agrupa diferenças por tipo
   */
  private groupDifferencesByType(differences: StructureDifference[]): Record<string, StructureDifference[]> {
    const grouped: Record<string, StructureDifference[]> = {};
    
    for (const diff of differences) {
      const diffType = diff.type;
      if (!grouped[diffType]) {
        grouped[diffType] = [];
      }
      grouped[diffType]!.push(diff);
    }
    
    return grouped;
  }

  /**
   * Formata uma diferença para exibição
   */
  private formatDifference(diff: StructureDifference): string {
    switch (diff.type) {
      case 'type_change':
        return `Field '${diff.path}' changed type from '${diff.oldType}' to '${diff.newType}'`;
      
      case 'optional_change':
        const optionalStatus = diff.isOptional ? 'optional' : 'required';
        const wasOptionalStatus = diff.wasOptional ? 'optional' : 'required';
        return `Field '${diff.path}' changed from '${wasOptionalStatus}' to '${optionalStatus}'`;
      
      case 'field_added':
        return `Field '${diff.field}' was added at path '${diff.path}'`;
      
      case 'field_removed':
        return `Field '${diff.field}' was removed from path '${diff.path}'`;
      
      default:
        return `Unknown difference type at path '${(diff as any).path || 'unknown'}'`;
    }
  }

  /**
   * Otimiza uma estrutura removendo informações redundantes
   */
  optimizeStructure(structure: EventStructure): EventStructure {
    const optimized = { ...structure };
    
    // Remove exemplos duplicados
    if (optimized.examples.length > 1) {
      const unique = optimized.examples.filter((example, index, array) => {
        return index === array.findIndex(item => 
          JSON.stringify(item) === JSON.stringify(example)
        );
      });
      optimized.examples = unique.slice(-10); // Máximo 10 exemplos
    }
    
    // Otimiza children recursivamente
    if (optimized.children) {
      const optimizedChildren = new Map<string, EventStructure>();
      
      for (const [key, child] of optimized.children) {
        optimizedChildren.set(key, this.optimizeStructure(child));
      }
      
      optimized.children = optimizedChildren;
    }
    
    // Otimiza array item type
    if (optimized.arrayItemType) {
      optimized.arrayItemType = this.optimizeStructure(optimized.arrayItemType);
    }
    
    return optimized;
  }
}
