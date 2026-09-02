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

// Vercel (dan hosting serverless lain) meneruskan request lewat proxy —
// tanpa ini, Express ga tau koneksinya sebenernya HTTPS, jadi cookie
// session "secure" ga pernah kekirim ke browser dan user selalu ke-logout.
app.set('trust proxy', 1);

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
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only.' });
  }
  next();
}

// A freelancer can see/act on a job if it was assigned to them directly, or
// if it was broadcast to all freelancers.
function freelancerCanAccess(job, userId) {
  return job.assigned_to_all || job.assigned_to === userId;
}

function jobToClient(job, users) {
  const assignee = users.find((u) => u.id === job.assigned_to);
  return {
    id: job.id,
    jobTitle: job.job_title,
    department: job.department,
    directReportTo: job.direct_report_to,
    positionType: job.position_type,
    placement: job.placement,
    officeHours: job.office_hours,
    workingDays: job.working_days,
    travelRequired: job.travel_required,
    industry: job.industry,
    industryConfidence: job.industry_confidence,
    jobDescription: job.job_description,
    jobRequirements: job.job_requirements,
    preferredSkills: job.preferred_skills,
    specialRequirements: job.special_requirements,
    salaryRange: job.salary_range,
    salaryType: job.salary_type,
    additionalNotes: job.additional_notes,
    status: job.status,
    assignedTo: job.assigned_to,
    assignedToAll: job.assigned_to_all,
    assignedToName: job.assigned_to_all ? 'All Freelancers' : (assignee ? assignee.name : null),
    sourceFilename: job.source_filename,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

// ---------------- AUTH ----------------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username & password are required.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 AND active = true', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });

  req.session.user = { id: user.id, name: user.name, role: user.role, username: user.username };

  // Record login history (so admin can see who logged in). If this fails,
  // don't let it break the login itself.
  pool.query(
    'INSERT INTO login_history (user_id, username, name, role, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
    [user.id, user.username, user.name, user.role, req.ip || null, (req.get('user-agent') || '').slice(0, 255)]
  ).catch((e) => console.error('Failed to record login_history:', e));

  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

// Change your own password — usable by both admin and freelancer.
app.post('/api/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password & new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  res.json({ ok: true });
});

// Login history (admin only) — see who logged in and when.
app.get('/api/login-history', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, name, role, ip_address, user_agent, logged_in_at FROM login_history ORDER BY logged_in_at DESC LIMIT 200'
  );
  res.json({ history: rows });
});

// ---------------- USERS (freelancer management, admin only) ----------------

app.get('/api/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, username, name, email, role, active, created_at FROM users WHERE role = 'freelancer' ORDER BY created_at DESC"
  );
  res.json({ users: rows });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, name, email } = req.body || {};
  if (!username || !password || !name || !email) {
    return res.status(400).json({ error: 'Username, password, name, and email are required.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, name, email, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, name, email, role, active, created_at',
      [username, hash, name, email.trim().toLowerCase(), 'freelancer']
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      const isEmail = (e.constraint || '').includes('email');
      return res.status(409).json({ error: isEmail ? 'This email is already used by another user.' : 'Username is already taken.' });
    }
    throw e;
  }
});

app.patch('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { active, password, name, email } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  if (typeof active === 'boolean') { updates.push(`active = $${i++}`); values.push(active); }
  if (name) { updates.push(`name = $${i++}`); values.push(name); }
  if (email) {
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email format.' });
    updates.push(`email = $${i++}`); values.push(email.trim().toLowerCase());
  }
  if (password) { updates.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }

  if (!updates.length) return res.status(400).json({ error: 'No changes given.' });

  values.push(id);
  try {
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This email is already used by another user.' });
    throw e;
  }
});

// ---------------- JOBS ----------------

// Upload + parse file (preview saja, belum tersimpan ke database)
app.post('/api/jobs/parse', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file found.' });

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
        positionType: fields.position_type,
        placement: fields.placement,
        officeHours: fields.office_hours,
        workingDays: fields.working_days,
        travelRequired: fields.travel_required,
        jobDescription: fields.job_description,
        jobRequirements: fields.job_requirements,
        preferredSkills: fields.preferred_skills,
        specialRequirements: fields.special_requirements,
        salaryRange: fields.salary_range,
        salaryType: fields.salary_type,
        additionalNotes: fields.additional_notes,
      },
      industry,
      industryConfidence: confidence,
      sourceFilename: req.file.originalname,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'Failed to read the file.' });
  }
});

app.post('/api/jobs', requireAdmin, async (req, res) => {
  const f = req.body || {};
  const assignedToAll = !!f.assignedToAll;
  const { rows } = await pool.query(
    `INSERT INTO jobs (
      job_title, department, direct_report_to, position_type,
      placement, office_hours, working_days, travel_required, industry, industry_confidence,
      job_description, job_requirements, preferred_skills, special_requirements,
      salary_range, salary_type, additional_notes, status, assigned_to, assigned_to_all,
      source_filename, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    RETURNING *`,
    [
      f.jobTitle || '', f.department || '', f.directReportTo || '',
      f.positionType || '', f.placement || '', f.officeHours || '', f.workingDays || '', f.travelRequired || '',
      f.industry || 'Not Identified', f.industryConfidence || 'low',
      f.jobDescription || '', f.jobRequirements || '', f.preferredSkills || '', f.specialRequirements || '',
      f.salaryRange || '', f.salaryType || '', f.additionalNotes || '',
      f.status || 'open', assignedToAll ? null : (f.assignedTo || null), assignedToAll,
      f.sourceFilename || null,
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
    clauses.push(`(assigned_to = $${i++} OR assigned_to_all = true)`);
    values.push(req.session.user.id);
  } else if (assignedTo === 'ALL_BROADCAST') {
    clauses.push('assigned_to_all = true');
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
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.session.user.role === 'freelancer' && !freelancerCanAccess(job, req.session.user.id)) {
    return res.status(403).json({ error: 'This job is not assigned to you.' });
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
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const isAdmin = req.session.user.role === 'admin';
  if (!isAdmin && !freelancerCanAccess(job, req.session.user.id)) {
    return res.status(403).json({ error: 'You do not have access to this job.' });
  }

  const body = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  // A freelancer may only change the status. Admin may change any field.
  const allowedForFreelancer = ['status'];
  const fieldMap = {
    jobTitle: 'job_title', department: 'department', directReportTo: 'direct_report_to',
    positionType: 'position_type', placement: 'placement',
    officeHours: 'office_hours', workingDays: 'working_days', travelRequired: 'travel_required', industry: 'industry',
    jobDescription: 'job_description', jobRequirements: 'job_requirements', preferredSkills: 'preferred_skills',
    specialRequirements: 'special_requirements', salaryRange: 'salary_range', salaryType: 'salary_type',
    additionalNotes: 'additional_notes', status: 'status',
    assignedTo: 'assigned_to', assignedToAll: 'assigned_to_all',
  };

  for (const [clientKey, column] of Object.entries(fieldMap)) {
    if (!(clientKey in body)) continue;
    if (!isAdmin && !allowedForFreelancer.includes(clientKey)) continue;
    if (clientKey === 'status' && !['open', 'closed'].includes(body.status)) continue;
    updates.push(`${column} = $${i++}`);
    values.push(body[clientKey]);
  }

  // Assigning to "all freelancers" and assigning to one specific freelancer
  // are mutually exclusive — keep the two columns in sync.
  if (isAdmin && 'assignedToAll' in body && body.assignedToAll) {
    updates.push(`assigned_to = $${i++}`);
    values.push(null);
  }

  if (!updates.length) return res.status(400).json({ error: 'No valid changes given.' });

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
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note is empty.' });

  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.session.user.role === 'freelancer' && !freelancerCanAccess(job, req.session.user.id)) {
    return res.status(403).json({ error: 'You do not have access to this job.' });
  }

  const { rows: inserted } = await pool.query(
    'INSERT INTO job_notes (job_id, author_id, note) VALUES ($1,$2,$3) RETURNING id, note, created_at',
    [req.params.id, req.session.user.id, note.trim()]
  );
  res.status(201).json({ note: { ...inserted[0], author_name: req.session.user.name } });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'A server error occurred.' });
});

module.exports = app;
