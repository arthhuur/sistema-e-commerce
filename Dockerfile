# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Instala as dependências primeiro para aproveitar o cache do Docker
COPY package*.json ./
RUN npm install

# Copia o restante do código e compila
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copia apenas o necessário do builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Expõe a porta que o NestJS usa (configurada via variável de ambiente PORT)
EXPOSE 3000

# Comando para rodar a aplicação
# Nota: As migrations serão rodadas pelo DatabaseModule ao iniciar (migrationsRun: true)
CMD ["npm", "run", "start:prod"]
