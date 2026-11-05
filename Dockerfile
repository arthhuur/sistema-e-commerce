# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copia primeiro só os manifestos de dependências (raiz + workspace do backend).
# Assim o cache do Docker só é invalidado quando uma dependência muda — e não
# a cada alteração de código, que é o caso comum.
COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/

# Instala tudo de uma vez: num monorepo com npm workspaces, as dependências
# ficam "içadas" para a raiz (um único node_modules compartilhado).
RUN npm install

# Copia o restante do código e compila. O script da raiz delega para o backend.
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copia apenas o necessário para rodar: manifestos, dependências já resolvidas
# e o build do backend. Sem código-fonte e sem ferramentas de teste.
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# A porta real vem da variável PORT (Render/Railway a definem). 3000 é o padrão.
EXPOSE 3000

# O script da raiz delega para o workspace do backend, que executa `node dist/main`
# já com o diretório de trabalho em apps/backend — onde ficam o build e os
# caminhos das migrations. Elas são aplicadas na subida (migrationsRun: true).
CMD ["npm", "run", "start:prod"]
