# Multi-stage build para otimizar tamanho da imagem
FROM node:20-alpine AS base

# Instala dependências necessárias
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências
RUN npm ci --only=production && npm cache clean --force

#############################################
# Build stage para backend
#############################################
FROM base AS backend-builder

# Instala devDependencies para build
RUN npm ci

# Copia código fonte
COPY src/ ./src/
COPY _env ./.env

# Build do backend TypeScript
RUN npm run build

#############################################
# Production stage
#############################################
FROM node:20-alpine AS production

# Instala dependências de sistema
RUN apk add --no-cache \
    dumb-init \
    sqlite \
    curl

# Cria usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S webhook -u 1001

# Instala PM2 globalmente
RUN npm install -g pm2@latest

# Define diretório de trabalho
WORKDIR /app

# Copia dependências de produção
COPY --from=base --chown=webhook:nodejs /app/node_modules ./node_modules
COPY --chown=webhook:nodejs package*.json ./

# Copia build do backend
COPY --from=backend-builder --chown=webhook:nodejs /app/dist ./dist

# Copia arquivos estáticos HTML
COPY --chown=webhook:nodejs public ./public

# Cria diretórios necessários
RUN mkdir -p /app/schemas /app/data && \
    chown -R webhook:nodejs /app/schemas /app/data

# Copia arquivos de configuração
COPY --chown=webhook:nodejs ecosystem.config.js ./
COPY --chown=webhook:nodejs _env ./.env.example

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expõe porta da aplicação
EXPOSE 3000

# Muda para usuário não-root
USER webhook

# Comando de inicialização com PM2
CMD ["dumb-init", "pm2-runtime", "start", "ecosystem.config.js"]

#############################################
# Development stage (opcional)
#############################################
FROM base AS development

# Instala todas as dependências (incluindo dev)
RUN npm ci

# Instala PM2 para development
RUN npm install -g pm2@latest

# Cria diretórios
RUN mkdir -p /app/schemas /app/data

# Copia código fonte
COPY . .

# Usuário root para desenvolvimento (facilita debugging)
USER root

# Comando para desenvolvimento
CMD ["npm", "run", "dev"]
