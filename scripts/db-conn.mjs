// 공용 DB 접속 설정 (구DB/신DB). pooler(session, 5432) 사용.
// 사용: import { sourceClient, targetClient } from "./db-conn.mjs";
//       node --env-file=.env.local 로 실행해야 env가 로드됨.
import pg from "pg";
const { Client } = pg;

function cfg(host, user, password) {
  if (!host || !user || !password)
    throw new Error("DB 접속정보 누락 — node --env-file=.env.local 로 실행했는지 확인");
  return {
    host, port: 5432, user, password, database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
    query_timeout: 120000, statement_timeout: 120000,
  };
}

export const SOURCE_CFG = cfg(process.env.SOURCE_DB_HOST, process.env.SOURCE_DB_USER, process.env.SOURCE_DB_PASSWORD);
export const TARGET_CFG = cfg(process.env.TARGET_DB_HOST, process.env.TARGET_DB_USER, process.env.TARGET_DB_PASSWORD);

export async function sourceClient() { const c = new Client(SOURCE_CFG); await c.connect(); return c; }
export async function targetClient() { const c = new Client(TARGET_CFG); await c.connect(); return c; }
