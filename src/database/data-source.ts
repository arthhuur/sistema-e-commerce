import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { DATABASE_ENTITIES } from './database.module.js';

// Carrega as variáveis do .env manualmente para que a CLI do TypeORM as veja
config();

const url = process.env.POSTGRES_URL && process.env.POSTGRES_URL.trim() !== '' ? process.env.POSTGRES_URL : undefined;
const ssl = process.env.POSTGRES_SSL === 'true';
const migrations =
  process.env.NODE_ENV === 'production'
    ? ['dist/database/migrations/*.js']
    : ['src/database/migrations/*.ts'];

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...(url
    ? { url }
    : {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        username: process.env.POSTGRES_USER ?? 'payment_router',
        password: process.env.POSTGRES_PASSWORD ?? 'payment_router',
        database: process.env.POSTGRES_DB ?? 'payment_router',
      }),
  ssl: ssl ? { rejectUnauthorized: false } : false,
  entities: DATABASE_ENTITIES,
  migrations,
  synchronize: false,
});
