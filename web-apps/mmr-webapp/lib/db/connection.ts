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
