require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { pool, initSchema } = require('../db');
const { parseJobFile } = require('../parser');
const { detectIndustry } = require('../industry');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Setup DB schema + admin pertama, cuma dijalankan sekali per cold start ---
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (rows.length === 0) {
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD || 'admin123';
        const name = process.env.ADMIN_NAME || 'Admin';
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
          'INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
          [username, hash, name, 'admin']
        );
      }
    })();
  }
  return readyPromise;
}
app.use((req, res, next) => {
  ensureReady().then(() => next()).catch(next);
});

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-secret-ganti-ini',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 hari
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Khusus admin.' });
  }
  next();
}

function jobToClient(job, users) {
  const assignee = users.find((u) => u.id === job.assigned_to);
  return {
    id: job.id,
    jobTitle: job.job_title,
    department: job.department,
    directReportTo: job.direct_report_to,
    orgStructurePosition: job.org_structure_position,
    positionType: job.position_type,
    placement: job.placement,
    officeHours: job.office_hours,
    travelRequired: job.travel_required,
    industry: job.industry,
    industryConfidence: job.industry_confidence,
    jobDescription: job.job_description,
    jobRequirements: job.job_requirements,
    preferredSkills: job.preferred_skills,
    specialRequirements: job.special_requirements,
    salaryRange: job.salary_range,
    status: job.status,
    assignedTo: job.assigned_to,
    assignedToName: assignee ? assignee.name : null,
    sourceFilename: job.source_filename,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

// ---------------- AUTH ----------------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username & password wajib diisi.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 AND active = true', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Username atau password salah.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Username atau password salah.' });

  req.session.user = { id: user.id, name: user.name, role: user.role, username: user.username };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login.' });
  res.json({ user: req.session.user });
});

// ---------------- USERS (freelancer management, admin only) ----------------

app.get('/api/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, username, name, role, active, created_at FROM users WHERE role = 'freelancer' ORDER BY created_at DESC"
  );
  res.json({ users: rows });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password, dan nama wajib diisi.' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING id, username, name, role, active, created_at',
      [username, hash, name, 'freelancer']
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username sudah dipakai.' });
    throw e;
  }
});

app.patch('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { active, password, name } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  if (typeof active === 'boolean') { updates.push(`active = $${i++}`); values.push(active); }
  if (name) { updates.push(`name = $${i++}`); values.push(name); }
  if (password) { updates.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }

  if (!updates.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });

  values.push(id);
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, values);
  res.json({ ok: true });
});

// ---------------- JOBS ----------------

// Upload + parse file (preview saja, belum tersimpan ke database)
app.post('/api/jobs/parse', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });

  try {
    const fields = await parseJobFile(req.file.buffer, req.file.originalname);
    const { industry, confidence } = detectIndustry(
      fields.job_title,
      fields.department,
      fields.job_description,
      fields.job_requirements,
      fields.preferred_skills,
      fields.special_requirements
    );
    res.json({
      fields: {
        jobTitle: fields.job_title,
        department: fields.department,
        directReportTo: fields.direct_report_to,
        orgStructurePosition: fields.org_structure_position,
        positionType: fields.position_type,
        placement: fields.placement,
        officeHours: fields.office_hours,
        travelRequired: fields.travel_required,
        jobDescription: fields.job_description,
        jobRequirements: fields.job_requirements,
        preferredSkills: fields.preferred_skills,
        specialRequirements: fields.special_requirements,
        salaryRange: fields.salary_range,
      },
      industry,
      industryConfidence: confidence,
      sourceFilename: req.file.originalname,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'Gagal membaca file.' });
  }
});

app.post('/api/jobs', requireAdmin, async (req, res) => {
  const f = req.body || {};
  const { rows } = await pool.query(
    `INSERT INTO jobs (
      job_title, department, direct_report_to, org_structure_position, position_type,
      placement, office_hours, travel_required, industry, industry_confidence,
      job_description, job_requirements, preferred_skills, special_requirements,
      salary_range, status, assigned_to, source_filename, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING *`,
    [
      f.jobTitle || '', f.department || '', f.directReportTo || '', f.orgStructurePosition || '',
      f.positionType || '', f.placement || '', f.officeHours || '', f.travelRequired || '',
      f.industry || 'Belum Teridentifikasi', f.industryConfidence || 'low',
      f.jobDescription || '', f.jobRequirements || '', f.preferredSkills || '', f.specialRequirements || '',
      f.salaryRange || '', f.status || 'open', f.assignedTo || null, f.sourceFilename || null,
      req.session.user.id,
    ]
  );
  const { rows: users } = await pool.query('SELECT id, name FROM users');
  res.status(201).json({ job: jobToClient(rows[0], users) });
});

app.get('/api/jobs', requireAuth, async (req, res) => {
  const { status, industry, assignedTo } = req.query;
  const clauses = [];
  const values = [];
  let i = 1;

  if (req.session.user.role === 'freelancer') {
    clauses.push(`assigned_to = $${i++}`);
    values.push(req.session.user.id);
  } else if (assignedTo) {
    clauses.push(`assigned_to = $${i++}`);
    values.push(assignedTo);
  }
  if (status) { clauses.push(`status = $${i++}`); values.push(status); }
  if (industry) { clauses.push(`industry = $${i++}`); values.push(industry); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM jobs ${where} ORDER BY created_at DESC`, values);
  const { rows: users } = await pool.query('SELECT id, name FROM users');
  res.json({ jobs: rows.map((j) => jobToClient(j, users)) });
});

app.get('/api/jobs/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan.' });
  if (req.session.user.role === 'freelancer' && job.assigned_to !== req.session.user.id) {
    return res.status(403).json({ error: 'Job ini bukan untuk kamu.' });
  }
  const { rows: users } = await pool.query('SELECT id, name FROM users');
  const { rows: notes } = await pool.query(
    `SELECT n.id, n.note, n.created_at, u.name AS author_name
     FROM job_notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.job_id = $1 ORDER BY n.created_at ASC`,
    [req.params.id]
  );
  res.json({ job: jobToClient(job, users), notes });
});

app.patch('/api/jobs/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan.' });

  const isAdmin = req.session.user.role === 'admin';
  const isOwnerFreelancer = job.assigned_to === req.session.user.id;
  if (!isAdmin && !isOwnerFreelancer) return res.status(403).json({ error: 'Tidak punya akses.' });

  const body = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  // Freelancer cuma boleh ubah status. Admin boleh ubah semua field.
  const allowedForFreelancer = ['status'];
  const fieldMap = {
    jobTitle: 'job_title', department: 'department', directReportTo: 'direct_report_to',
    orgStructurePosition: 'org_structure_position', positionType: 'position_type', placement: 'placement',
    officeHours: 'office_hours', travelRequired: 'travel_required', industry: 'industry',
    jobDescription: 'job_description', jobRequirements: 'job_requirements', preferredSkills: 'preferred_skills',
    specialRequirements: 'special_requirements', salaryRange: 'salary_range', status: 'status',
    assignedTo: 'assigned_to',
  };

  for (const [clientKey, column] of Object.entries(fieldMap)) {
    if (!(clientKey in body)) continue;
    if (!isAdmin && !allowedForFreelancer.includes(clientKey)) continue;
    if (clientKey === 'status' && !['open', 'closed'].includes(body.status)) continue;
    updates.push(`${column} = $${i++}`);
    values.push(body[clientKey]);
  }

  if (!updates.length) return res.status(400).json({ error: 'Tidak ada perubahan valid.' });

  updates.push(`updated_at = now()`);
  values.push(req.params.id);
  const { rows: updated } = await pool.query(
    `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  const { rows: users } = await pool.query('SELECT id, name FROM users');
  res.json({ job: jobToClient(updated[0], users) });
});

app.delete('/api/jobs/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/jobs/:id/notes', requireAuth, async (req, res) => {
  const { note } = req.body || {};
  if (!note || !note.trim()) return res.status(400).json({ error: 'Catatan kosong.' });

  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan.' });
  if (req.session.user.role === 'freelancer' && job.assigned_to !== req.session.user.id) {
    return res.status(403).json({ error: 'Tidak punya akses.' });
  }

  const { rows: inserted } = await pool.query(
    'INSERT INTO job_notes (job_id, author_id, note) VALUES ($1,$2,$3) RETURNING id, note, created_at',
    [req.params.id, req.session.user.id, note.trim()]
  );
  res.status(201).json({ note: { ...inserted[0], author_name: req.session.user.name } });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server.' });
});

module.exports = app;
