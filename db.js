const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Neon / Render Postgres perlu SSL, Postgres lokal biasanya tidak.
const useSSL = /sslmode=require|neon\.tech|render\.com/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'freelancer')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      job_title TEXT,
      department TEXT,
      direct_report_to TEXT,
      org_structure_position TEXT,
      position_type TEXT,
      placement TEXT,
      office_hours TEXT,
      travel_required TEXT,
      industry TEXT,
      industry_confidence TEXT,
      job_description TEXT,
      job_requirements TEXT,
      preferred_skills TEXT,
      special_requirements TEXT,
      salary_range TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_filename TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS job_notes (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, initSchema };
