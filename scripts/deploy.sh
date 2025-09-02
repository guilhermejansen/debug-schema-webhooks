#!/bin/bash

# Deploy script para WhatsApp Webhook Mapper
# Autor: Sistema Webhook Mapper
# Versão: 1.0.0

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funções de logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Função para mostrar banner
show_banner() {
    echo -e "${BLUE}"
    cat << 'EOF'
██╗    ██╗███████╗██████╗ ██╗  ██╗ ██████╗  ██████╗ ██╗  ██╗
██║    ██║██╔════╝██╔══██╗██║  ██║██╔═══██╗██╔═══██╗██║ ██╔╝
██║ █╗ ██║█████╗  ██████╔╝███████║██║   ██║██║   ██║█████╔╝ 
██║███╗██║██╔══╝  ██╔══██╗██╔══██║██║   ██║██║   ██║██╔═██╗ 
╚███╔███╔╝███████╗██████╔╝██║  ██║╚██████╔╝╚██████╔╝██║  ██╗
 ╚══╝╚══╝ ╚══════╝╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝
                                                            
███╗   ███╗ █████╗ ██████╗ ██████╗ ███████╗██████╗ 
████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
██╔████╔██║███████║██████╔╝██████╔╝█████╗  ██████╔╝
██║╚██╔╝██║██╔══██║██╔═══╝ ██╔═══╝ ██╔══╝  ██╔══██╗
██║ ╚═╝ ██║██║  ██║██║     ██║     ███████╗██║  ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝
EOF
    echo -e "${NC}"
    echo -e "${GREEN}WhatsApp Webhook Mapper - Deploy Script v1.0.0${NC}"
    echo ""
}

# Função para verificar pré-requisitos
check_prerequisites() {
    log_info "Verificando pré-requisitos..."
    
    # Verifica se Docker está instalado
    if ! command -v docker &> /dev/null; then
        log_error "Docker não está instalado. Por favor, instale o Docker primeiro."
        exit 1
    fi
    
    # Verifica se Docker Compose está instalado
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose não está instalado. Por favor, instale o Docker Compose primeiro."
        exit 1
    fi
    
    # Verifica se está no diretório correto
    if [[ ! -f "package.json" || ! -f "docker-compose.yml" ]]; then
        log_error "Execute este script no diretório raiz do projeto."
        exit 1
    fi
    
    log_success "Pré-requisitos verificados com sucesso"
}

# Função para configurar ambiente
setup_environment() {
    log_info "Configurando ambiente..."
    
    # Verifica se arquivo .env existe
    if [[ ! -f ".env" ]]; then
        if [[ -f "_env" ]]; then
            log_warning "Arquivo .env não encontrado. Copiando de _env..."
            cp _env .env
            log_info "Por favor, revise e ajuste as configurações no arquivo .env"
            read -p "Pressione Enter para continuar após revisar o arquivo .env..."
        else
            log_error "Arquivo .env não encontrado e _env não existe."
            log_error "Por favor, crie um arquivo .env com as configurações necessárias."
            exit 1
        fi
    fi
    
    # Cria diretórios necessários
    log_info "Criando diretórios necessários..."
    mkdir -p data logs schemas backups nginx/ssl
    
    # Define permissões corretas
    chmod 755 data logs schemas
    
    log_success "Ambiente configurado"
}

# Função para fazer backup
create_backup() {
    if [[ -d "data" && "$(ls -A data)" ]]; then
        log_info "Criando backup dos dados existentes..."
        
        local backup_dir="backups/backup-$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$backup_dir"
        
        # Backup de dados
        if [[ -d "data" && "$(ls -A data)" ]]; then
            cp -r data "$backup_dir/"
            log_success "Backup do banco de dados criado"
        fi
        
        # Backup de schemas
        if [[ -d "schemas" && "$(ls -A schemas)" ]]; then
            cp -r schemas "$backup_dir/"
            log_success "Backup dos schemas criado"
        fi
        
        # Cria arquivo tar.gz
        tar -czf "$backup_dir.tar.gz" -C backups "$(basename "$backup_dir")"
        rm -rf "$backup_dir"
        
        log_success "Backup completo criado: $backup_dir.tar.gz"
    else
        log_info "Nenhum dado existente para backup"
    fi
}

# Função para build das imagens
build_images() {
    log_info "Construindo imagens Docker..."
    
    # Para de qualquer container em execução
    log_info "Parando containers existentes..."
    docker-compose down --remove-orphans || true
    
    # Build das imagens
    log_info "Construindo nova imagem..."
    docker-compose build --no-cache webhook-mapper
    
    log_success "Imagens construídas com sucesso"
}

# Função para deploy dos serviços
deploy_services() {
    log_info "Iniciando deploy dos serviços..."
    
    # Inicia Redis primeiro
    log_info "Iniciando Redis..."
    docker-compose up -d redis
    
    # Aguarda Redis ficar saudável
    log_info "Aguardando Redis ficar saudável..."
    local timeout=60
    local count=0
    while [[ $count -lt $timeout ]]; do
        if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
            log_success "Redis está saudável"
            break
        fi
        sleep 1
        ((count++))
        
        if [[ $count -eq $timeout ]]; then
            log_error "Timeout aguardando Redis ficar saudável"
            exit 1
        fi
    done
    
    # Inicia aplicação principal
    log_info "Iniciando aplicação principal..."
    docker-compose up -d webhook-mapper
    
    # Aguarda aplicação ficar saudável
    log_info "Aguardando aplicação ficar saudável..."
    timeout=120
    count=0
    while [[ $count -lt $timeout ]]; do
        if curl -f http://localhost:3000/health > /dev/null 2>&1; then
            log_success "Aplicação está saudável"
            break
        fi
        sleep 1
        ((count++))
        
        if [[ $count -eq $timeout ]]; then
            log_error "Timeout aguardando aplicação ficar saudável"
            docker-compose logs webhook-mapper
            exit 1
        fi
    done
    
    # Inicia Nginx
    log_info "Iniciando Nginx..."
    docker-compose up -d nginx
    
    log_success "Todos os serviços iniciados com sucesso"
}

# Função para verificar status final
check_deployment() {
    log_info "Verificando status do deployment..."
    
    # Verifica se todos os containers estão rodando
    local containers=("webhook-redis" "webhook-mapper" "webhook-nginx")
    
    for container in "${containers[@]}"; do
        if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
            log_success "Container $container está rodando"
        else
            log_error "Container $container não está rodando"
            return 1
        fi
    done
    
    # Testa endpoints
    log_info "Testando endpoints..."
    
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        log_success "Endpoint de saúde da aplicação está respondendo"
    else
        log_error "Endpoint de saúde da aplicação não está respondendo"
        return 1
    fi
    
    if curl -f http://localhost/health > /dev/null 2>&1; then
        log_success "Nginx está respondendo corretamente"
    else
        log_error "Nginx não está respondendo"
        return 1
    fi
    
    return 0
}

# Função para mostrar informações de acesso
show_access_info() {
    echo ""
    log_success "==============================================="
    log_success "🚀 DEPLOY CONCLUÍDO COM SUCESSO!"
    log_success "==============================================="
    echo ""
    echo -e "${GREEN}📍 URLs de Acesso:${NC}"
    echo -e "   • Dashboard: ${BLUE}http://localhost${NC}"
    echo -e "   • API: ${BLUE}http://localhost/api${NC}"
    echo -e "   • Webhook: ${BLUE}http://localhost/webhook${NC}"
    echo -e "   • Health Check: ${BLUE}http://localhost/health${NC}"
    echo ""
    echo -e "${GREEN}📊 Monitoramento:${NC}"
    echo -e "   • Logs: ${BLUE}docker-compose logs -f webhook-mapper${NC}"
    echo -e "   • Status: ${BLUE}docker-compose ps${NC}"
    echo -e "   • Stats: ${BLUE}curl http://localhost/webhook/stats${NC}"
    echo ""
    echo -e "${GREEN}🔧 Comandos Úteis:${NC}"
    echo -e "   • Parar: ${BLUE}docker-compose down${NC}"
    echo -e "   • Restart: ${BLUE}docker-compose restart webhook-mapper${NC}"
    echo -e "   • Backup: ${BLUE}./scripts/backup.sh${NC}"
    echo ""
    echo -e "${YELLOW}📝 Nota: Configure seu webhook para apontar para:${NC}"
    echo -e "   ${BLUE}http://seu-servidor/webhook${NC}"
    echo ""
}

# Função para limpeza em caso de erro
cleanup_on_error() {
    log_warning "Erro durante deploy. Executando limpeza..."
    docker-compose down --remove-orphans || true
    log_info "Limpeza concluída"
}

# Função principal
main() {
    show_banner
    
    # Configurar trap para limpeza em caso de erro
    trap cleanup_on_error ERR
    
    # Executa todas as etapas
    check_prerequisites
    setup_environment
    create_backup
    build_images
    deploy_services
    
    # Verifica se deploy foi bem sucedido
    if check_deployment; then
        show_access_info
        exit 0
    else
        log_error "Deploy falhou na verificação final"
        cleanup_on_error
        exit 1
    fi
}

# Executa função principal
main "$@"
