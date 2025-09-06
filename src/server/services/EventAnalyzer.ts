import { EventStructure, EventAnalysisResult, TruncateMetadata } from '@/types/base';
import { TruncateService } from './TruncateService';
import { TypeDetector, DetectedType } from '@/server/utils/TypeDetector';
import { Logger } from '@/server/utils/Logger';

/**
 * Serviço responsável por analisar eventos de webhook e extrair sua estrutura
 */
export class EventAnalyzer {
  private readonly truncateService: TruncateService;
  private readonly logger: Logger;

  constructor(truncateService: TruncateService) {
    this.truncateService = truncateService;
    this.logger = new Logger('EventAnalyzer');
  }

  /**
   * Analisa um evento completo e retorna sua estrutura
   */
  analyzeEvent(event: any): EventAnalysisResult {
    this.logger.debug('Starting event analysis');

    // IMPORTANTE: Extrai o tipo ANTES de truncar (para preservar headers)
    const eventType = this.extractEventType(event);
    
    // Depois trunca o evento para análise da estrutura
    const { truncated, metadata } = this.truncateService.truncateEvent(event);
    
    // Analisa a estrutura do evento truncado
    const structure = this.buildStructureMap(truncated, '', metadata);
    
    this.logger.debug('Event analysis completed', {
      eventType,
      hasTruncated: metadata.hasTruncated,
      fieldsCount: this.countTotalFields(structure)
    });

    return {
      structure,
      eventType,
      truncateMetadata: metadata
    };
  }

  /**
   * Converte path aninhado em nome válido para JS/TS (ex: whatsapp_business_account/messages_text -> WhatsappBusinessAccountMessagesText)
   */
  convertPathToValidName(eventType: string): string {
    // Se não tem barra, usa normalização padrão
    if (!eventType.includes('/')) {
      return this.normalizeEventType(eventType);
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
   * Extrai o tipo do evento usando várias estratégias
   */
  extractEventType(event: any): string {
    // Log para debug
    this.logger.debug('Extracting event type', {
      hasHeaders: !!event.headers,
      hasBody: !!event.body,
      headerServer: event.headers?.server,
      headerOrigin: event.headers?.origin,
      bodyType: event.body?.type || event.type
    });
    
    // Estratégia PRIORITÁRIA 1: Z-API Detection
    if (this.isZApiEvent(event)) {
      this.logger.debug('Detected as Z-API event');
      return this.detectZApiEventType(event);
    }
    
    // Estratégia PRIORITÁRIA 2: WhatsApp Business Account (Meta API)
    if (this.isWhatsAppBusinessAccount(event)) {
      return this.detectWhatsAppBusinessEventType(event);
    }
    
    // Estratégia 3: Campo eventType direto (ZuckZapGo)
    if (event.eventType && typeof event.eventType === 'string') {
      return this.normalizeEventType(event.eventType);
    }
    
    // Estratégia 4: Campo body.eventType
    if (event.body?.eventType && typeof event.body.eventType === 'string') {
      return this.normalizeEventType(event.body.eventType);
    }
    
    // Estratégia 5: Campo body.data.type
    if (event.body?.data?.type && typeof event.body.data.type === 'string') {
      return this.normalizeEventType(event.body.data.type);
    }
    
    // Estratégia 6: Baseado na estrutura do evento WhatsApp
    const structuralType = this.detectEventTypeFromStructure(event);
    if (structuralType !== 'Unknown') {
      return structuralType;
    }
    
    // Estratégia 7: Baseado em campos-chave presentes
    const keyBasedType = this.detectEventTypeFromKeys(event);
    if (keyBasedType !== 'Unknown') {
      return keyBasedType;
    }
    
    // Estratégia 8: Provider genérico
    const genericType = this.detectGenericEventType(event);
    if (genericType !== 'Unknown') {
      return genericType;
    }
    
    this.logger.warn('Could not determine event type, using Unknown', {
      availableKeys: Object.keys(event)
    });
    
    return 'Unknown';
  }

  /**
   * Verifica se é um evento do WhatsApp Business Account (Meta API)
   */
  private isWhatsAppBusinessAccount(event: any): boolean {
    return (
      event.object === 'whatsapp_business_account' &&
      Array.isArray(event.entry) &&
      event.entry.length > 0 &&
      Array.isArray(event.entry[0]?.changes) &&
      event.entry[0].changes.length > 0 &&
      event.entry[0].changes[0]?.value?.messaging_product === 'whatsapp'
    );
  }

  /**
   * Detecta tipo específico do WhatsApp Business Account baseado no field e conteúdo
   */
  private detectWhatsAppBusinessEventType(event: any): string {
    const field = event.entry[0]?.changes[0]?.field;
    const value = event.entry[0]?.changes[0]?.value;
    
    this.logger.debug('Detecting WhatsApp Business Account event type', { 
      field, 
      hasMessages: !!value?.messages,
      hasStatuses: !!value?.statuses,
      hasContacts: !!value?.contacts 
    });
    
    // Baseia a organização no formato: whatsapp_business_account/[field]_[type]
    const basePrefix = 'whatsapp_business_account';
    
    switch (field) {
      case 'messages':
        // Eventos de mensagem recebida
        if (value?.messages && Array.isArray(value.messages)) {
          const messageType = value.messages[0]?.type || 'text';
          return `${basePrefix}/messages_${messageType}`;
        }
        return `${basePrefix}/messages`;
        
      case 'message_deliveries':
        // Status de entrega de mensagens
        return `${basePrefix}/message_deliveries`;
        
      case 'message_reads':
        // Confirmações de leitura
        return `${basePrefix}/message_reads`;
        
      case 'message_reactions':
        // Reações às mensagens
        return `${basePrefix}/message_reactions`;
        
      case 'message_template_status_update':
        // Atualizações de status de templates
        return `${basePrefix}/template_status`;
        
      case 'phone_number_name_update':
        // Atualizações de perfil/nome
        return `${basePrefix}/profile_update`;
        
      case 'account_alerts':
        // Alertas da conta
        return `${basePrefix}/account_alerts`;
        
      case 'account_update':
        // Atualizações da conta
        return `${basePrefix}/account_update`;
        
      case 'business_capability_update':
        // Atualizações de capacidades do negócio
        return `${basePrefix}/capability_update`;
        
      case 'smb_message_echoes':
        // Mensagens enviadas pelo business (echo)
        return `${basePrefix}/smb_message_echoes`;
        
      default:
        // Tipo genérico para novos campos
        this.logger.warn('Unknown WhatsApp Business field, using generic type', { field });
        return `${basePrefix}/${field || 'webhook'}`;
    }
  }

  /**
   * Verifica se é um evento da Z-API
   */
  private isZApiEvent(event: any): boolean {
    // Verifica pelos headers Z-API ou pela estrutura
    if (event.headers?.server === 'Z-API' || 
        event.headers?.origin?.includes('z-api.io')) {
      return true;
    }
    
    // Verifica pela estrutura do body
    if (event.body?.type && event.body?.instanceId) {
      const knownZApiTypes = [
        'ReceivedCallback', 'SentCallback', 
        'MessageStatusCallback', 'PresenceChatCallback',
        'ConnectedCallback', 'DisconnectedCallback',
        'QrcodeCallback', 'StatusCallback'
      ];
      return knownZApiTypes.includes(event.body.type);
    }
    
    return false;
  }

  /**
   * Detecta tipo específico do evento Z-API
   */
  private detectZApiEventType(event: any): string {
    const body = event.body || event;
    const basePrefix = 'z_api';
    
    // Tipo principal do evento
    const mainType = body.type || 'unknown';
    
    switch (mainType) {
      case 'ReceivedCallback':
        // Detecta sub-tipo baseado no conteúdo - ordem importante para detecção correta
        if (body.text?.message) return `${basePrefix}/received_callback/text`;
        if (body.image?.imageUrl || body.image) return `${basePrefix}/received_callback/image`;
        if (body.sticker?.stickerUrl || body.sticker) return `${basePrefix}/received_callback/sticker`;
        if (body.audio?.audioUrl || body.audio) return `${basePrefix}/received_callback/audio`;
        if (body.video?.videoUrl || body.video) return `${basePrefix}/received_callback/video`;
        if (body.document?.documentUrl || body.document) return `${basePrefix}/received_callback/document`;
        if (body.location?.latitude || body.location) return `${basePrefix}/received_callback/location`;
        if (body.contact?.displayName || body.contact) return `${basePrefix}/received_callback/contact`;
        if (body.poll?.name || body.poll) return `${basePrefix}/received_callback/poll`;
        if (body.reaction) return `${basePrefix}/received_callback/reaction`;
        if (body.order) return `${basePrefix}/received_callback/order`;
        if (body.payment) return `${basePrefix}/received_callback/payment`;
        if (body.buttons) return `${basePrefix}/received_callback/buttons`;
        if (body.list) return `${basePrefix}/received_callback/list`;
        // Se é de grupo ou não
        if (body.isGroup) {
          return `${basePrefix}/received_callback/group_message`;
        }
        return `${basePrefix}/received_callback/unknown`;
        
      case 'SentCallback':
        // Similar ao received mas para mensagens enviadas
        if (body.text?.message) return `${basePrefix}/sent_callback/text`;
        if (body.image?.imageUrl || body.image) return `${basePrefix}/sent_callback/image`;
        if (body.sticker?.stickerUrl || body.sticker) return `${basePrefix}/sent_callback/sticker`;
        if (body.audio?.audioUrl || body.audio) return `${basePrefix}/sent_callback/audio`;
        if (body.video?.videoUrl || body.video) return `${basePrefix}/sent_callback/video`;
        if (body.document?.documentUrl || body.document) return `${basePrefix}/sent_callback/document`;
        if (body.location) return `${basePrefix}/sent_callback/location`;
        if (body.contact) return `${basePrefix}/sent_callback/contact`;
        return `${basePrefix}/sent_callback/unknown`;
        
      case 'MessageStatusCallback':
        // Status de mensagens (READ, DELIVERED, SENT, PLAYED, DELETED, etc.)
        const status = body.status?.toLowerCase() || 'unknown';
        // Se for de grupo, indica no path
        if (body.isGroup) {
          return `${basePrefix}/message_status/group_${status}`;
        }
        return `${basePrefix}/message_status/${status}`;
        
      case 'PresenceChatCallback':
        // Presença (AVAILABLE, COMPOSING, RECORDING, PAUSED, etc.)
        const presenceStatus = body.status?.toLowerCase() || 'unknown';
        return `${basePrefix}/presence_chat/${presenceStatus}`;
        
      case 'ConnectedCallback':
        // Evento de conexão estabelecida
        return `${basePrefix}/connected`;
        
      case 'DisconnectedCallback':
        // Evento de desconexão
        return `${basePrefix}/disconnected`;
        
      case 'QrcodeCallback':
        // QR Code para autenticação
        return `${basePrefix}/qrcode`;
        
      case 'StatusCallback':
        // Status da instância
        return `${basePrefix}/status`;
        
      case 'InstanceCallback':
        // Eventos da instância
        return `${basePrefix}/instance`;
        
      case 'ProfileCallback':
        // Atualizações de perfil
        return `${basePrefix}/profile`;
        
      case 'GroupCallback':
        // Eventos de grupo
        if (body.action) {
          return `${basePrefix}/group/${body.action.toLowerCase()}`;
        }
        return `${basePrefix}/group`;
        
      case 'CallCallback':
        // Eventos de chamada
        if (body.callStatus) {
          return `${basePrefix}/call/${body.callStatus.toLowerCase()}`;
        }
        return `${basePrefix}/call`;
        
      case 'ChatCallback':
        // Eventos de chat
        if (body.action) {
          return `${basePrefix}/chat/${body.action.toLowerCase()}`;
        }
        return `${basePrefix}/chat`;
        
      case 'DeviceCallback':
        // Eventos de dispositivo
        return `${basePrefix}/device`;
        
      case 'ErrorCallback':
        // Eventos de erro
        return `${basePrefix}/error`;
        
      default:
        this.logger.warn('Unknown Z-API event type', { type: mainType });
        // Tenta usar o tipo como está, em lowercase
        return `${basePrefix}/${mainType.toLowerCase().replace(/callback$/i, '')}`;
    }
  }

  /**
   * Detecta eventos de providers genéricos
   */
  private detectGenericEventType(event: any): string {
    // Primeiro tenta detectar o provider
    const provider = this.detectProvider(event);
    
    // Tenta encontrar campo de tipo comum
    const possibleTypeFields = [
      'event', 'eventType', 'type', 'evento', 'events',
      'webhook_event', 'webhookEvent', 'event_type', 'eventName',
      'action', 'message_type', 'messageType', 'notification_type',
      'notificationType', 'callback_type', 'callbackType', 'webhook_type'
    ];
    
    // Procura em vários níveis do objeto
    const searchPaths = [
      event,
      event.body,
      event.data,
      event.payload,
      event.message,
      event.notification
    ];
    
    for (const searchPath of searchPaths) {
      if (!searchPath || typeof searchPath !== 'object') continue;
      
      for (const field of possibleTypeFields) {
        if (searchPath[field] && typeof searchPath[field] === 'string') {
          const eventType = this.normalizeEventType(searchPath[field]);
          return `${provider}/${eventType}`;
        }
      }
    }
    
    // Tenta detectar tipo pela estrutura
    const structuralType = this.detectTypeByStructure(event);
    if (structuralType) {
      return `${provider}/${structuralType}`;
    }
    
    // Se não conseguiu detectar tipo específico
    return `${provider}/webhook`;
  }
  
  /**
   * Detecta o provider do evento
   */
  private detectProvider(event: any): string {
    // Headers comuns que indicam origem
    const headers = event.headers || {};
    
    // Por origem/URL
    if (headers.origin || headers['x-forwarded-host']) {
      const origin = headers.origin || headers['x-forwarded-host'];
      const provider = this.extractProviderFromOrigin(origin);
      if (provider) return provider;
    }
    
    // Por User-Agent
    if (headers['user-agent']) {
      const provider = this.extractProviderFromUserAgent(headers['user-agent']);
      if (provider) return provider;
    }
    
    // Por headers customizados
    const customHeaders = [
      'x-provider', 'x-api-provider', 'x-webhook-provider',
      'x-service', 'x-platform', 'x-source'
    ];
    
    for (const header of customHeaders) {
      if (headers[header]) {
        return this.normalizeProviderName(headers[header]);
      }
    }
    
    // Por campos no body que indicam provider
    const body = event.body || event;
    const providerFields = [
      'provider', 'platform', 'source', 'api', 'service',
      'vendor', 'integration', 'channel'
    ];
    
    for (const field of providerFields) {
      if (body[field] && typeof body[field] === 'string') {
        return this.normalizeProviderName(body[field]);
      }
    }
    
    // Provider não identificado
    return 'generic';
  }
  
  /**
   * Extrai provider do User-Agent
   */
  private extractProviderFromUserAgent(userAgent: string): string | null {
    const ua = userAgent.toLowerCase();
    
    // Patterns comuns em User-Agents de APIs
    const patterns = [
      { pattern: /baileys/i, provider: 'baileys' },
      { pattern: /venom/i, provider: 'venom' },
      { pattern: /wppconnect/i, provider: 'wppconnect' },
      { pattern: /evolution/i, provider: 'evolution' },
      { pattern: /codechat/i, provider: 'codechat' },
      { pattern: /zapme/i, provider: 'zapme' },
      { pattern: /wabiz/i, provider: 'wabiz' },
      { pattern: /notificame/i, provider: 'notificame' },
      { pattern: /chatapi/i, provider: 'chatapi' },
      { pattern: /waboxapp/i, provider: 'waboxapp' },
      { pattern: /messagebird/i, provider: 'messagebird' },
      { pattern: /twilio/i, provider: 'twilio' },
      { pattern: /wati/i, provider: 'wati' },
      { pattern: /360dialog/i, provider: '360dialog' },
      { pattern: /infobip/i, provider: 'infobip' }
    ];
    
    for (const { pattern, provider } of patterns) {
      if (pattern.test(ua)) {
        return provider;
      }
    }
    
    return null;
  }
  
  /**
   * Normaliza nome do provider
   */
  private normalizeProviderName(provider: string): string {
    return provider
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
  
  /**
   * Detecta tipo de evento pela estrutura
   */
  private detectTypeByStructure(event: any): string | null {
    const body = event.body || event;
    
    // Padrões estruturais comuns
    if (body.message || body.messages) return 'message';
    if (body.status || body.statuses) return 'status';
    if (body.notification || body.notifications) return 'notification';
    if (body.presence) return 'presence';
    if (body.receipt || body.receipts) return 'receipt';
    if (body.call || body.calls) return 'call';
    if (body.group) return 'group';
    if (body.contact || body.contacts) return 'contact';
    if (body.media) return 'media';
    if (body.location) return 'location';
    if (body.reaction || body.reactions) return 'reaction';
    if (body.error || body.errors) return 'error';
    
    return null;
  }

  /**
   * Extrai provider da origem/user-agent
   */
  private extractProviderFromOrigin(origin: string): string | null {
    const lowerOrigin = origin.toLowerCase();
    
    // Providers conhecidos
    if (lowerOrigin.includes('baileys')) return 'baileys';
    if (lowerOrigin.includes('venom')) return 'venom';
    if (lowerOrigin.includes('wppconnect')) return 'wppconnect';
    if (lowerOrigin.includes('evolution')) return 'evolution';
    if (lowerOrigin.includes('codechat')) return 'codechat';
    if (lowerOrigin.includes('zapme')) return 'zapme';
    if (lowerOrigin.includes('wabiz')) return 'wabiz';
    
    // Extrai domínio se for URL
    const domainMatch = origin.match(/https?:\/\/([^\/]+)/);
    if (domainMatch && domainMatch[1]) {
      const domain = domainMatch[1];
      const parts = domain.split('.');
      if (parts.length >= 2) {
        // Remove TLD e www
        const provider = parts[parts.length - 2];
        if (provider && provider !== 'www') {
          return provider;
        }
      }
    }
    
    return null;
  }

  /**
   * Detecta tipo de evento baseado na estrutura típica do whatsmeow
   */
  private detectEventTypeFromStructure(event: any): string {
    // Converter para string para análise de estrutura
    const eventStr = JSON.stringify(event).toLowerCase();
    
    // 1. EVENTOS DE AUTENTICAÇÃO E CONEXÃO
    if (this.hasFields(event, ['codes']) || eventStr.includes('"codes"')) {
      return 'QR';
    }
    
    if (this.hasFields(event, ['id', 'businessname', 'platform']) && 
        !this.hasFields(event, ['error'])) {
      return 'PairSuccess';
    }
    
    if (this.hasFields(event, ['id', 'businessname', 'platform', 'error'])) {
      return 'PairError';
    }
    
    if (eventStr.includes('qrscannedwithoutmultidevice') || 
        (eventStr.includes('qr') && eventStr.includes('multidevice'))) {
      return 'QRScannedWithoutMultidevice';
    }
    
    if (eventStr.includes('connected') && this.isSimpleEvent(event)) {
      return 'Connected';
    }
    
    if (this.hasFields(event, ['onconnect', 'reason']) || eventStr.includes('loggedout')) {
      return 'LoggedOut';
    }
    
    if (eventStr.includes('streamreplaced')) {
      return 'StreamReplaced';
    }
    
    if (eventStr.includes('manualloginreconnect')) {
      return 'ManualLoginReconnect';
    }
    
    if (eventStr.includes('clientoutdated')) {
      return 'ClientOutdated';
    }
    
    if (this.hasFields(event, ['error']) && eventStr.includes('cat')) {
      return 'CATRefreshError';
    }
    
    // 2. EVENTOS DE KEEPALIVE E CONEXÃO
    if (this.hasFields(event, ['errorcount', 'lastsuccess']) || eventStr.includes('keepaliveto')) {
      return 'KeepAliveTimeout';
    }
    
    if (eventStr.includes('keepaliverestored')) {
      return 'KeepAliveRestored';
    }
    
    if (this.hasFields(event, ['reason', 'message']) && eventStr.includes('connectfailure')) {
      return 'ConnectFailure';
    }
    
    if (this.hasFields(event, ['code', 'expire']) || eventStr.includes('temporaryban')) {
      return 'TemporaryBan';
    }
    
    if (this.hasFields(event, ['code', 'raw']) && eventStr.includes('stream')) {
      return 'StreamError';
    }
    
    if (eventStr.includes('disconnected') && this.isSimpleEvent(event)) {
      return 'Disconnected';
    }
    
    // 3. EVENTOS DE MENSAGENS
    if (this.hasFields(event, ['info', 'message']) || 
        (event.body?.data?.event?.message && !eventStr.includes('undecryptable'))) {
      return 'Message';
    }
    
    if (this.hasFields(event, ['message', 'transport']) || eventStr.includes('fbmessage')) {
      return 'FBMessage';
    }
    
    if (this.hasFields(event, ['info', 'isunavailable']) || 
        eventStr.includes('undecryptable')) {
      return 'UndecryptableMessage';
    }
    
    // 4. EVENTOS DE CONFIRMAÇÃO
    if (this.hasFields(event, ['messageids', 'timestamp', 'type']) && 
        (eventStr.includes('receipt') || eventStr.includes('delivered') || 
         eventStr.includes('read') || eventStr.includes('played'))) {
      return 'Receipt';
    }
    
    // 5. EVENTOS DE PRESENÇA
    if (this.hasFields(event, ['state', 'media']) && eventStr.includes('chatpresence')) {
      return 'ChatPresence';
    }
    
    if (this.hasFields(event, ['from', 'unavailable', 'lastseen']) || 
        (eventStr.includes('presence') && !eventStr.includes('chat'))) {
      return 'Presence';
    }
    
    // 6. EVENTOS DE GRUPO
    if (this.hasFields(event, ['reason', 'type', 'createkey']) || 
        eventStr.includes('joinedgroup')) {
      return 'JoinedGroup';
    }
    
    if (this.hasFields(event, ['jid', 'sender', 'timestamp']) && 
        (eventStr.includes('name') || eventStr.includes('topic') || 
         eventStr.includes('join') || eventStr.includes('leave') || 
         eventStr.includes('promote') || eventStr.includes('demote'))) {
      return 'GroupInfo';
    }
    
    // 7. EVENTOS DE MEDIA E PERFIL
    if (this.hasFields(event, ['jid', 'author', 'timestamp', 'pictureid']) || 
        (eventStr.includes('picture') && !eventStr.includes('message'))) {
      return 'Picture';
    }
    
    if (this.hasFields(event, ['jid', 'status', 'timestamp']) && 
        eventStr.includes('userabout')) {
      return 'UserAbout';
    }
    
    if (this.hasFields(event, ['ciphertext', 'iv', 'messageid', 'chatid']) || 
        eventStr.includes('mediaretry')) {
      return 'MediaRetry';
    }
    
    // 8. EVENTOS DE IDENTIDADE E PRIVACIDADE
    if (this.hasFields(event, ['jid', 'timestamp', 'implicit']) || 
        eventStr.includes('identitychange')) {
      return 'IdentityChange';
    }
    
    if (this.hasFields(event, ['newsettings']) || eventStr.includes('privacysettings')) {
      return 'PrivacySettings';
    }
    
    // 9. EVENTOS DE SINCRONIZAÇÃO
    if (this.hasFields(event, ['data']) && eventStr.includes('historysync')) {
      return 'HistorySync';
    }
    
    if (this.hasFields(event, ['total', 'appdatachanges', 'messages', 'notifications']) || 
        eventStr.includes('offlinesyncpreview')) {
      return 'OfflineSyncPreview';
    }
    
    if (this.hasFields(event, ['count']) && eventStr.includes('offlinesynccompleted')) {
      return 'OfflineSyncCompleted';
    }
    
    // 10. EVENTOS DE BLOCKLIST
    if (this.hasFields(event, ['action', 'dhash', 'changes']) || 
        eventStr.includes('blocklist')) {
      return 'Blocklist';
    }
    
    // 11. EVENTOS DE NEWSLETTER
    if (eventStr.includes('newsletter')) {
      if (eventStr.includes('join')) {
        return 'NewsletterJoin';
      } else if (eventStr.includes('leave')) {
        return 'NewsletterLeave';
      } else if (eventStr.includes('mute')) {
        return 'NewsletterMuteChange';
      } else if (eventStr.includes('live') || eventStr.includes('update')) {
        return 'NewsletterLiveUpdate';
      }
      return 'Newsletter';
    }
    
    // 12. DETECÇÃO POR ESTRUTURA ANTIGA (COMPATIBILIDADE)
    if (event.body?.data?.event) {
      const eventData = event.body.data.event;
      
      // Mensagens específicas
      if (eventData.message) {
        if (eventData.message.text) return 'Message';
        if (eventData.message.image || eventData.message.JPEGThumbnail) return 'Picture';
        if (eventData.message.audio || eventData.message.voice) return 'Audio';
        if (eventData.message.video) return 'Video';
        if (eventData.message.document) return 'Document';
        if (eventData.message.location) return 'Location';
        if (eventData.message.contact || eventData.message.vcard) return 'Contact';
        if (eventData.message.system) return 'SystemMessage';
      }
      
      // Outros tipos
      if (eventData.receipt) return 'Receipt';
      if (eventData.presence) return 'Presence';
      if (eventData.chatstate) return 'ChatState';
    }
    
    return 'Unknown';
  }

  /**
   * Detecta tipo baseado em campos-chave presentes
   */
  private detectEventTypeFromKeys(event: any): string {
    const allKeys = this.getAllKeys(event).join(',').toLowerCase();
    
    // Padrões de detecção por palavras-chave
    const patterns = [
      { type: 'BusinessName', keywords: ['business', 'businessname'] },
      { type: 'DeleteChat', keywords: ['delete', 'deletechat', 'clear'] },
      { type: 'UndecryptableMessage', keywords: ['undecryptable', 'decrypt', 'encrypted'] },
      { type: 'GroupUpdate', keywords: ['group', 'participants', 'subject'] },
      { type: 'CallEvent', keywords: ['call', 'calling', 'callevent'] },
      { type: 'StatusUpdate', keywords: ['status', 'statusupdate'] },
      { type: 'ProfileUpdate', keywords: ['profile', 'profileupdate'] }
    ];
    
    for (const pattern of patterns) {
      if (pattern.keywords.some(keyword => allKeys.includes(keyword))) {
        return pattern.type;
      }
    }
    
    return 'Unknown';
  }

  /**
   * Obtém todas as chaves de um objeto (incluindo aninhadas)
   */
  private getAllKeys(obj: any, keys: string[] = []): string[] {
    if (typeof obj !== 'object' || obj === null) return keys;
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        keys.push(key);
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.getAllKeys(obj[key], keys);
        }
      }
    }
    
    return keys;
  }

  /**
   * Verifica se o evento possui todos os campos especificados
   */
  private hasFields(obj: any, fields: string[]): boolean {
    if (!obj || typeof obj !== 'object') return false;
    
    return fields.every(field => {
      // Suporte para campos aninhados (ex: 'body.data.event')
      const fieldPath = field.toLowerCase();
      const allKeys = this.getAllKeys(obj).map(k => k.toLowerCase());
      
      return allKeys.includes(fieldPath) || obj.hasOwnProperty(field) || obj.hasOwnProperty(fieldPath);
    });
  }

  /**
   * Verifica se é um evento simples (poucos campos, provavelmente um evento de estado)
   */
  private isSimpleEvent(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    
    const keys = Object.keys(obj);
    return keys.length <= 3 && !keys.some(key => 
      typeof obj[key] === 'object' && obj[key] !== null && Object.keys(obj[key]).length > 2
    );
  }

  /**
   * Normaliza o nome do tipo de evento
   */
  private normalizeEventType(eventType: string): string {
    // Remove caracteres especiais e converte para PascalCase
    const normalized = eventType
      .replace(/[^a-zA-Z0-9]/g, '_')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    
    return normalized || 'Unknown';
  }

  /**
   * Constrói o mapa de estrutura recursivamente
   */
  buildStructureMap(
    obj: any, 
    path: string = '',
    truncateMetadata?: TruncateMetadata
  ): EventStructure {
    const type = TypeDetector.detectType(obj);
    
    const structure: EventStructure = {
      path,
      type: this.mapDetectedTypeToStructureType(type),
      optional: false,
      examples: [obj]
    };

    // Verifica se foi truncado
    if (truncateMetadata?.truncatedFields) {
      const truncatedField = truncateMetadata.truncatedFields.find(
        field => field.path === path
      );
      if (truncatedField) {
        structure.isTruncated = true;
        structure.originalType = truncatedField.type;
      }
    }

    // Processa filhos se é objeto
    if (type === 'object' && obj !== null) {
      structure.children = new Map();
      
      for (const [key, value] of Object.entries(obj)) {
        const childPath = path ? `${path}.${key}` : key;
        const childStructure = this.buildStructureMap(value, childPath, truncateMetadata);
        structure.children.set(key, childStructure);
      }
    }

    // Processa itens se é array
    if (type === 'array' && Array.isArray(obj) && obj.length > 0) {
      const itemTypes = TypeDetector.detectArrayItemTypes(obj);
      
      if (itemTypes.length === 1) {
        // Todos os itens são do mesmo tipo
        const firstItem = obj[0];
        structure.arrayItemType = this.buildStructureMap(
          firstItem, 
          `${path}[0]`,
          truncateMetadata
        );
      } else if (itemTypes.length > 1) {
        // União de tipos
        structure.type = 'union';
        structure.arrayItemType = {
          path: `${path}[*]`,
          type: 'union',
          optional: false,
          examples: obj.slice(0, 5) // Máximo 5 exemplos
        };
      }
    }

    return structure;
  }

  /**
   * Mapeia tipos detectados para tipos de estrutura
   */
  private mapDetectedTypeToStructureType(detectedType: DetectedType): EventStructure['type'] {
    const mapping: Record<DetectedType, EventStructure['type']> = {
      'string': 'string',
      'number': 'number',
      'boolean': 'boolean',
      'object': 'object',
      'array': 'array',
      'null': 'null',
      'undefined': 'null', // Trata undefined como null
      'function': 'object' // Functions são raras, trata como object
    };

    return mapping[detectedType] || 'object';
  }

  /**
   * Merge duas estruturas (usado para atualizar schemas existentes)
   */
  mergeStructures(
    existing: EventStructure, 
    newStructure: EventStructure
  ): EventStructure {
    const merged: EventStructure = {
      ...existing,
      // Combina exemplos, mantendo os últimos
      examples: [...existing.examples, ...newStructure.examples].slice(-10)
    };
    
    // Se há mudança de tipo, cria union
    if (existing.type !== newStructure.type) {
      merged.type = 'union';
    }

    // Merge de filhos
    if (existing.children && newStructure.children) {
      merged.children = new Map();
      
      const allKeys = new Set([
        ...existing.children.keys(),
        ...newStructure.children.keys()
      ]);
      
      for (const key of allKeys) {
        const existingChild = existing.children.get(key);
        const newChild = newStructure.children.get(key);
        
        if (existingChild && newChild) {
          // Ambos existem, faz merge recursivo
          merged.children.set(key, this.mergeStructures(existingChild, newChild));
        } else if (existingChild) {
          // Só existe no antigo, marca como opcional
          existingChild.optional = true;
          merged.children.set(key, existingChild);
        } else if (newChild) {
          // Só existe no novo, marca como opcional
          newChild.optional = true;
          merged.children.set(key, newChild);
        }
      }
    }
    
    return merged;
  }

  /**
   * Conta o total de campos em uma estrutura
   */
  private countTotalFields(structure: EventStructure): number {
    let count = 1; // A própria estrutura
    
    if (structure.children) {
      for (const child of structure.children.values()) {
        count += this.countTotalFields(child);
      }
    }
    
    if (structure.arrayItemType) {
      count += this.countTotalFields(structure.arrayItemType);
    }
    
    return count;
  }

  /**
   * Valida se uma estrutura é válida
   */
  validateStructure(structure: EventStructure): boolean {
    // Validações básicas
    if (!structure.path && structure.path !== '') return false;
    if (!structure.type) return false;
    if (typeof structure.optional !== 'boolean') return false;
    if (!Array.isArray(structure.examples)) return false;
    
    // Validação recursiva
    if (structure.children) {
      for (const child of structure.children.values()) {
        if (!this.validateStructure(child)) return false;
      }
    }
    
    if (structure.arrayItemType) {
      if (!this.validateStructure(structure.arrayItemType)) return false;
    }
    
    return true;
  }
}
