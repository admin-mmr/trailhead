import mysql from 'mysql2/promise'

let pool: mysql.Pool | undefined

export function getDb(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL!,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: { rejectUnauthorized: true },
    })
  }
  return pool
}

// Proxy object for lazy pool initialization
const poolProxy = new Proxy({} as mysql.Pool, {
  get: (_, prop) => (getDb() as any)[prop],
})

// Named export: import { pool } from '@/lib/db/connection'
export { poolProxy as pool }

// Default export: import pool from '@/lib/db/connection'
export default poolProxy
