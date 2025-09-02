#!/usr/bin/env tsx

/**
 * Script de teste para validar detecção de tipos de evento do whatsmeow
 * Usage: npx tsx scripts/test-event-detection.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { EventAnalyzer } from '../src/server/services/EventAnalyzer';
import { TruncateService } from '../src/server/services/TruncateService';
import { createAppConfig } from '../src/server/config/env';

interface TestCase {
  type: string;
  event: any;
  expected_type: string;
  expected_priority: number;
}

interface TestResults {
  passed: number;
  failed: number;
  details: Array<{
    type: string;
    expected: string;
    actual: string;
    status: 'PASS' | 'FAIL';
  }>;
}

/**
 * Simula o método calculatePriority do EventProcessor
 */
function calculatePriority(event: any): number {
  const eventType = event.eventType || event.body?.eventType || event.type || '';
  
  const priorityMap: Record<string, number> = {
    'Message': 15,
    'FBMessage': 15,
    'UndecryptableMessage': 12,
    'Picture': 11,
    'MediaRetry': 10,
    'Audio': 9,
    'Video': 9,
    'Document': 8,
    'JoinedGroup': 7,
    'GroupInfo': 7,
    'UserAbout': 6,
    'Newsletter': 6,
    'NewsletterJoin': 6,
    'NewsletterLeave': 6,
    'NewsletterMuteChange': 6,
    'NewsletterLiveUpdate': 7,
    'Receipt': 5,
    'ReadReceipt': 5,
    'ChatPresence': 4,
    'Presence': 4,
    'IdentityChange': 5,
    'Connected': 4,
    'PairSuccess': 4,
    'HistorySync': 3,
    'OfflineSyncCompleted': 3,
    'Blocklist': 3,
    'KeepAliveTimeout': 2,
    'KeepAliveRestored': 2,
    'PrivacySettings': 2,
    'OfflineSyncPreview': 2,
    'QR': 1,
    'StreamError': 1,
    'Disconnected': 1,
    'PairError': 8,
    'LoggedOut': 8,
    'TemporaryBan': 8,
    'ClientOutdated': 7,
    'ConnectFailure': 7,
    'CATRefreshError': 7,
    'StreamReplaced': 6,
    'Unknown': 1
  };

  // Detecção por estrutura se não encontrado
  if (!priorityMap[eventType]) {
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

  return priorityMap[eventType] || 5;
}

async function runTests(): Promise<void> {
  console.log('🚀 Iniciando testes de detecção de eventos whatsmeow...\n');

  // Carrega exemplos de teste
  const examplesPath = join(__dirname, '..', 'examples', 'whatsmeow-events.json');
  let testData: any;
  
  try {
    const fileContent = readFileSync(examplesPath, 'utf-8');
    testData = JSON.parse(fileContent);
  } catch (error) {
    console.error('❌ Erro ao carregar arquivo de exemplos:', error);
    process.exit(1);
  }

  // Inicializa serviços
  const config = createAppConfig();
  const truncateService = new TruncateService(config.truncate);
  const analyzer = new EventAnalyzer(truncateService);

  const testCases: TestCase[] = testData.whatsmeow_event_examples.examples;
  const results: TestResults = {
    passed: 0,
    failed: 0,
    details: []
  };

  console.log(`📋 Executando ${testCases.length} casos de teste...\n`);

  // Executa cada caso de teste
  for (const testCase of testCases) {
    try {
      // Testa detecção de tipo
      const analysisResult = analyzer.analyzeEvent(testCase.event);
      const actualType = analysisResult.eventType;
      
      // Testa prioridade
      const actualPriority = calculatePriority(testCase.event);
      
      const typeMatch = actualType === testCase.expected_type;
      const priorityMatch = actualPriority === testCase.expected_priority;
      const overallPass = typeMatch && priorityMatch;
      
      if (overallPass) {
        results.passed++;
        console.log(`✅ ${testCase.type}: ${actualType} (prioridade: ${actualPriority})`);
      } else {
        results.failed++;
        console.log(`❌ ${testCase.type}:`);
        if (!typeMatch) {
          console.log(`   Tipo - Esperado: ${testCase.expected_type}, Atual: ${actualType}`);
        }
        if (!priorityMatch) {
          console.log(`   Prioridade - Esperada: ${testCase.expected_priority}, Atual: ${actualPriority}`);
        }
      }

      results.details.push({
        type: testCase.type,
        expected: testCase.expected_type,
        actual: actualType,
        status: overallPass ? 'PASS' : 'FAIL'
      });

    } catch (error) {
      results.failed++;
      console.log(`❌ ${testCase.type}: ERRO - ${error}`);
      
      results.details.push({
        type: testCase.type,
        expected: testCase.expected_type,
        actual: 'ERROR',
        status: 'FAIL'
      });
    }
  }

  // Relatório final
  console.log('\n' + '='.repeat(50));
  console.log('📊 RELATÓRIO DE TESTES');
  console.log('='.repeat(50));
  console.log(`Total de testes: ${testCases.length}`);
  console.log(`✅ Passou: ${results.passed}`);
  console.log(`❌ Falhou: ${results.failed}`);
  console.log(`📈 Taxa de sucesso: ${((results.passed / testCases.length) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n🔍 DETALHES DOS FALHAS:');
    results.details
      .filter(d => d.status === 'FAIL')
      .forEach(detail => {
        console.log(`- ${detail.type}: esperado '${detail.expected}', obteve '${detail.actual}'`);
      });
  }

  console.log('\n✨ Testes concluídos!');
  
  // Exit code baseado nos resultados
  process.exit(results.failed > 0 ? 1 : 0);
}

// Executa os testes se o script for chamado diretamente
if (require.main === module) {
  runTests().catch((error) => {
    console.error('❌ Erro ao executar testes:', error);
    process.exit(1);
  });
}
