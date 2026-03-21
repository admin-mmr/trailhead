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

// Default export for convenience: import pool from '@/lib/db/connection'
// Uses Proxy to lazily initialize the pool on first use
export default new Proxy({} as mysql.Pool, {
  get: (_, prop) => (getDb() as any)[prop],
})
