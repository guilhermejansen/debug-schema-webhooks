# Makefile para WhatsApp Webhook Mapper
# Facilita comandos comuns de desenvolvimento e deploy

# Variáveis
DOCKER_COMPOSE = docker-compose
CONTAINER_NAME = webhook-mapper
SERVICE_NAME = webhook-mapper

# Cores para output
GREEN = \033[0;32m
YELLOW = \033[1;33m
RED = \033[0;31m
NC = \033[0m # No Color

# Comandos de desenvolvimento
.PHONY: help install dev build start stop restart logs clean

help: ## Mostra esta ajuda
	@echo "$(GREEN)WhatsApp Webhook Mapper - Comandos Disponíveis$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""

install: ## Instala dependências do projeto
	@echo "$(GREEN)Instalando dependências...$(NC)"
	npm ci
	@echo "$(GREEN)Dependências instaladas!$(NC)"

dev: ## Inicia ambiente de desenvolvimento
	@echo "$(GREEN)Iniciando ambiente de desenvolvimento...$(NC)"
	npm run dev

build: ## Constrói a aplicação para produção
	@echo "$(GREEN)Construindo aplicação...$(NC)"
	npm run build
	@echo "$(GREEN)Build concluído!$(NC)"

# Comandos Docker
.PHONY: docker-build docker-up docker-down docker-restart docker-logs docker-clean

docker-build: ## Constrói imagens Docker
	@echo "$(GREEN)Construindo imagens Docker...$(NC)"
	$(DOCKER_COMPOSE) build --no-cache

docker-up: ## Inicia todos os serviços Docker
	@echo "$(GREEN)Iniciando serviços Docker...$(NC)"
	$(DOCKER_COMPOSE) up -d
	@echo "$(GREEN)Serviços iniciados!$(NC)"
	@echo "$(YELLOW)Dashboard disponível em: http://localhost$(NC)"
	@echo "$(YELLOW)API disponível em: http://localhost/api$(NC)"
	@echo "$(YELLOW)Webhook disponível em: http://localhost/webhook$(NC)"

docker-down: ## Para todos os serviços Docker
	@echo "$(YELLOW)Parando serviços Docker...$(NC)"
	$(DOCKER_COMPOSE) down
	@echo "$(GREEN)Serviços parados!$(NC)"

docker-restart: ## Reinicia o serviço principal
	@echo "$(YELLOW)Reiniciando $(SERVICE_NAME)...$(NC)"
	$(DOCKER_COMPOSE) restart $(SERVICE_NAME)
	@echo "$(GREEN)Serviço reiniciado!$(NC)"

docker-logs: ## Mostra logs do serviço principal
	$(DOCKER_COMPOSE) logs -f $(SERVICE_NAME)

docker-clean: ## Remove containers, volumes e imagens não utilizadas
	@echo "$(YELLOW)Limpando Docker...$(NC)"
	$(DOCKER_COMPOSE) down --volumes --remove-orphans
	docker system prune -f
	@echo "$(GREEN)Limpeza concluída!$(NC)"

# Comandos de deploy
.PHONY: deploy deploy-dev deploy-prod backup

deploy: ## Deploy completo com script automatizado
	@echo "$(GREEN)Executando deploy completo...$(NC)"
	./scripts/deploy.sh

deploy-dev: ## Deploy para desenvolvimento
	@echo "$(GREEN)Deploy para desenvolvimento...$(NC)"
	$(DOCKER_COMPOSE) -f docker-compose.yml up -d --build

deploy-prod: ## Deploy para produção
	@echo "$(GREEN)Deploy para produção...$(NC)"
	$(DOCKER_COMPOSE) -f docker-compose.yml --profile production up -d --build

backup: ## Cria backup dos dados
	@echo "$(GREEN)Criando backup...$(NC)"
	@mkdir -p backups
	@BACKUP_NAME="backup-$$(date +%Y%m%d_%H%M%S)" && \
	mkdir -p "backups/$$BACKUP_NAME" && \
	cp -r data "backups/$$BACKUP_NAME/" 2>/dev/null || true && \
	cp -r schemas "backups/$$BACKUP_NAME/" 2>/dev/null || true && \
	cp -r logs "backups/$$BACKUP_NAME/" 2>/dev/null || true && \
	tar -czf "backups/$$BACKUP_NAME.tar.gz" -C backups "$$BACKUP_NAME" && \
	rm -rf "backups/$$BACKUP_NAME" && \
	echo "$(GREEN)Backup criado: backups/$$BACKUP_NAME.tar.gz$(NC)"

# Comandos de monitoramento
.PHONY: status health ps stats

status: ## Mostra status de todos os serviços
	@echo "$(GREEN)Status dos serviços:$(NC)"
	$(DOCKER_COMPOSE) ps

health: ## Verifica saúde da aplicação
	@echo "$(GREEN)Verificando saúde da aplicação...$(NC)"
	@curl -s http://localhost/health | jq '.' || echo "$(RED)Aplicação não está respondendo$(NC)"

ps: ## Mostra containers em execução
	@echo "$(GREEN)Containers em execução:$(NC)"
	docker ps --filter name=webhook

stats: ## Mostra estatísticas da aplicação
	@echo "$(GREEN)Estatísticas da aplicação:$(NC)"
	@curl -s http://localhost/api/stats | jq '.' || echo "$(RED)API não está respondendo$(NC)"

# Comandos de teste
.PHONY: test test-unit test-integration test-coverage lint

test: ## Executa todos os testes
	@echo "$(GREEN)Executando testes...$(NC)"
	npm test

test-unit: ## Executa apenas testes unitários
	@echo "$(GREEN)Executando testes unitários...$(NC)"
	npm run test:unit

test-integration: ## Executa apenas testes de integração
	@echo "$(GREEN)Executando testes de integração...$(NC)"
	npm run test:integration

test-coverage: ## Executa testes com coverage
	@echo "$(GREEN)Executando testes com coverage...$(NC)"
	npm run test:coverage

lint: ## Executa linter
	@echo "$(GREEN)Executando linter...$(NC)"
	npm run lint

lint-fix: ## Executa linter com correção automática
	@echo "$(GREEN)Executando linter com correção...$(NC)"
	npm run lint:fix

# Comandos utilitários
.PHONY: shell redis-cli db-shell generate-test-events

shell: ## Abre shell no container principal
	$(DOCKER_COMPOSE) exec $(SERVICE_NAME) sh

redis-cli: ## Abre Redis CLI
	$(DOCKER_COMPOSE) exec redis redis-cli

db-shell: ## Abre SQLite shell
	$(DOCKER_COMPOSE) exec $(SERVICE_NAME) sqlite3 /app/data/database.sqlite

generate-test-events: ## Gera eventos de teste
	@echo "$(GREEN)Gerando eventos de teste...$(NC)"
	@curl -X POST http://localhost/webhook/test \
		-H "Content-Type: application/json" \
		-d '{"count": 5, "eventType": "TestEvent"}' || \
		echo "$(RED)Falha ao gerar eventos de teste$(NC)"

# Comandos de configuração
.PHONY: setup-env setup-ssl

setup-env: ## Configura arquivo de ambiente
	@if [ ! -f .env ]; then \
		echo "$(GREEN)Criando arquivo .env...$(NC)"; \
		cp _env .env; \
		echo "$(YELLOW)Por favor, revise o arquivo .env antes de continuar$(NC)"; \
	else \
		echo "$(YELLOW)Arquivo .env já existe$(NC)"; \
	fi

setup-ssl: ## Gera certificados SSL auto-assinados
	@echo "$(GREEN)Gerando certificados SSL...$(NC)"
	@mkdir -p nginx/ssl
	@openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
		-keyout nginx/ssl/key.pem \
		-out nginx/ssl/cert.pem \
		-subj "/C=BR/ST=State/L=City/O=Organization/OU=OrgUnit/CN=localhost"
	@echo "$(GREEN)Certificados SSL criados!$(NC)"

# Comando padrão
.DEFAULT_GOAL := help
