# Build stage
FROM node:20-alpine AS builder

# Instala dependências necessárias para build
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Copia arquivos de configuração
COPY package*.json tsconfig.json ./

# Instala todas as dependências (incluindo dev para build)
RUN npm ci && npm cache clean --force

# Copia código fonte
COPY src/ ./src/

# Build do backend TypeScript
RUN npm run build

#############################################
# Production stage
#############################################
FROM node:20-alpine AS production

# Instala dependências de sistema mínimas
RUN apk add --no-cache dumb-init sqlite curl

# Cria usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S webhook -u 1001

# Instala PM2 globalmente
RUN npm install -g pm2@latest

WORKDIR /app

# Copia package files
COPY --chown=webhook:nodejs package*.json ./

# Instala apenas dependências de produção
RUN npm ci --only=production && npm cache clean --force

# Copia build do backend
COPY --from=builder --chown=webhook:nodejs /app/dist ./dist

# Copia arquivos estáticos HTML
COPY --chown=webhook:nodejs public ./public

# Copia arquivo de configuração PM2
COPY --chown=webhook:nodejs ecosystem.config.js ./

# Cria diretórios de dados
RUN mkdir -p /app/schemas /app/data && \
    chown -R webhook:nodejs /app/schemas /app/data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expõe porta
EXPOSE 3000

# Muda para usuário não-root
USER webhook

# Inicialização com PM2
CMD ["dumb-init", "pm2-runtime", "start", "ecosystem.config.js"]
