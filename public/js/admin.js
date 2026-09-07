const INDUSTRY_OPTIONS = [
  'Beauty, Cosmetics & Wellness', 'Fashion & Apparel', 'Retail & FMCG',
  'Food & Beverage / Hospitality', 'Banking & Financial Services', 'Insurance',
  'Technology / IT / Software', 'E-commerce', 'Healthcare & Pharmaceuticals',
  'Property & Real Estate', 'Construction & Engineering', 'Manufacturing & Industrial',
  'Automotive', 'Logistics & Supply Chain', 'Oil, Gas, Mining & Energy',
  'Telecommunications', 'Media, Advertising & Creative', 'Education & Training',
  'Agriculture & Plantation', 'Professional Services (Consulting/Legal/Accounting)',
  'Government / Non-Profit', 'Not Identified', 'Other',
];

let freelancers = [];
let lastParsedPreview = null;

async function init() {
  const { user } = await api('/api/me').catch(() => { window.location.href = '/login.html'; throw new Error(); });
  document.getElementById('whoami').textContent = `${user.name} (admin)`;

  document.getElementById('logoutBtn').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  };

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  const industrySelect = document.getElementById('f_industry');
  industrySelect.innerHTML = INDUSTRY_OPTIONS.map((i) => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');

  const filterIndustry = document.getElementById('filterIndustry');
  filterIndustry.innerHTML += INDUSTRY_OPTIONS.map((i) => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');

  await loadFreelancers();
  await loadJobs();

  wireAssignControls('f');

  document.getElementById('refreshBtn').onclick = loadJobs;
  document.getElementById('filterStatus').onchange = loadJobs;
  document.getElementById('filterAssignee').onchange = loadJobs;
  document.getElementById('filterIndustry').onchange = loadJobs;

  document.getElementById('parseBtn').onclick = handleParse;
  document.getElementById('cancelUploadBtn').onclick = resetUploadForm;
  document.getElementById('saveJobBtn').onclick = handleSaveJob;

  document.getElementById('addFreelancerBtn').onclick = handleAddFreelancer;
  document.getElementById('closeDetailBtn').onclick = () => { document.getElementById('detailModal').style.display = 'none'; };

  document.getElementById('changePasswordBtn').onclick = openPasswordModal;
  document.getElementById('closePasswordModalBtn').onclick = () => { document.getElementById('passwordModal').style.display = 'none'; };
  document.getElementById('pw_saveBtn').onclick = handleChangePassword;
}

function openPasswordModal() {
  document.getElementById('passwordErr').innerHTML = '';
  document.getElementById('pw_current').value = '';
  document.getElementById('pw_new').value = '';
  document.getElementById('passwordModal').style.display = 'flex';
}

async function handleChangePassword() {
  const errBox = document.getElementById('passwordErr');
  errBox.innerHTML = '';
  const currentPassword = document.getElementById('pw_current').value;
  const newPassword = document.getElementById('pw_new').value;
  try {
    await api('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    document.getElementById('passwordModal').style.display = 'none';
    alert('Password changed successfully.');
  } catch (e) {
    errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
  }
}

async function loadLoginHistory() {
  const { history } = await api('/api/login-history');
  const wrap = document.getElementById('historyListWrap');
  if (!history.length) {
    wrap.innerHTML = '<div class="empty-state">No login history yet.</div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Login Time</th><th>IP Address</th></tr></thead>
      <tbody>
        ${history.map((h) => `
          <tr>
            <td>${escapeHtml(h.name)} <span class="hint">(${escapeHtml(h.username)})</span></td>
            <td>${h.role === 'admin' ? 'Admin' : 'Freelancer'}</td>
            <td>${new Date(h.logged_in_at).toLocaleString('en-US')}</td>
            <td>${escapeHtml(h.ip_address || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'history') loadLoginHistory();
}

// ---------- ASSIGN CONTROLS (shared between the upload form and the detail modal) ----------

// Builds the "Not assigned yet / All Freelancers / Selected Freelancer" radio
// group + freelancer dropdown for a given id prefix (e.g. "f" or "d").
function renderAssignControls(prefix, current = {}) {
  const mode = current.assignedToAll ? 'all' : (current.assignedTo ? 'selected' : 'none');
  return `
    <div class="radio-row">
      <label><input type="radio" name="${prefix}_assignMode" value="none" ${mode === 'none' ? 'checked' : ''}> Not assigned yet</label>
      <label><input type="radio" name="${prefix}_assignMode" value="all" ${mode === 'all' ? 'checked' : ''}> All Freelancers</label>
      <label><input type="radio" name="${prefix}_assignMode" value="selected" ${mode === 'selected' ? 'checked' : ''}> Selected Freelancer</label>
    </div>
    <select id="${prefix}_assignedTo" style="margin-top:8px; display:${mode === 'selected' ? 'block' : 'none'}">
      <option value="">-- choose a freelancer --</option>
      ${freelancers.map((u) => `<option value="${u.id}" ${current.assignedTo === u.id ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.username)})</option>`).join('')}
    </select>
  `;
}

function wireAssignControls(prefix) {
  const select = document.getElementById(`${prefix}_assignedTo`);
  const update = () => {
    const checked = document.querySelector(`input[name="${prefix}_assignMode"]:checked`);
    select.style.display = checked && checked.value === 'selected' ? 'block' : 'none';
  };
  document.querySelectorAll(`input[name="${prefix}_assignMode"]`).forEach((r) => { r.onchange = update; });
  update();
}

function readAssignControls(prefix) {
  const checked = document.querySelector(`input[name="${prefix}_assignMode"]:checked`);
  const mode = checked ? checked.value : 'none';
  if (mode === 'all') return { assignedToAll: true, assignedTo: null };
  if (mode === 'selected') return { assignedToAll: false, assignedTo: document.getElementById(`${prefix}_assignedTo`).value || null };
  return { assignedToAll: false, assignedTo: null };
}

// ---------- FREELANCERS ----------

async function loadFreelancers() {
  const { users } = await api('/api/users');
  freelancers = users;

  const assignSelect = document.getElementById('f_assignedTo');
  assignSelect.innerHTML = '<option value="">-- choose a freelancer --</option>' +
    users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.username)})</option>`).join('');

  const filterAssignee = document.getElementById('filterAssignee');
  filterAssignee.innerHTML = '<option value="">All Freelancers</option><option value="ALL_BROADCAST">Broadcast to All</option>' +
    users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  const wrap = document.getElementById('freelancerListWrap');
  if (!users.length) {
    wrap.innerHTML = '<div class="empty-state">No freelancers yet. Add one in the form above.</div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Username</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email || '-')}</td>
            <td>${escapeHtml(u.username)}</td>
            <td><span class="badge ${u.active ? 'open' : 'closed'}">${u.active ? 'Active' : 'Inactive'}</span></td>
            <td>${fmtDate(u.created_at)}</td>
            <td>
              <button class="secondary" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Activate'}</button>
              <button class="secondary" data-resetpw="${u.id}">Reset Password</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      const active = btn.dataset.active === 'true';
      await api(`/api/users/${btn.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
      loadFreelancers();
    };
  });
  wrap.querySelectorAll('[data-resetpw]').forEach((btn) => {
    btn.onclick = async () => {
      const pw = prompt('New password for this freelancer:');
      if (!pw) return;
      await api(`/api/users/${btn.dataset.resetpw}`, { method: 'PATCH', body: JSON.stringify({ password: pw }) });
      alert('Password changed successfully.');
    };
  });
}

async function handleAddFreelancer() {
  const errBox = document.getElementById('userErr');
  errBox.innerHTML = '';
  const name = document.getElementById('nf_name').value.trim();
  const email = document.getElementById('nf_email').value.trim();
  const username = document.getElementById('nf_username').value.trim();
  const password = document.getElementById('nf_password').value.trim();
  if (!name || !email || !username || !password) {
    errBox.innerHTML = '<div class="error-msg">Name, email, username, and password are required.</div>';
    return;
  }
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ name, email, username, password }) });
    document.getElementById('nf_name').value = '';
    document.getElementById('nf_email').value = '';
    document.getElementById('nf_username').value = '';
    document.getElementById('nf_password').value = '';
    await loadFreelancers();
  } catch (e) {
    errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- UPLOAD & PARSE ----------

async function handleParse() {
  const errBox = document.getElementById('uploadErr');
  errBox.innerHTML = '';
  const fileInput = document.getElementById('fileInput');
  if (!fileInput.files.length) {
    errBox.innerHTML = '<div class="error-msg">Please choose a file first.</div>';
    return;
  }
  const statusEl = document.getElementById('parseStatus');
  statusEl.textContent = 'Processing file...';

  try {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const data = await api('/api/jobs/parse', { method: 'POST', body: formData });
    lastParsedPreview = data;
    fillPreviewForm(data);
    statusEl.textContent = 'Parsed successfully. Check the results below.';
    document.getElementById('previewCard').style.display = 'block';
  } catch (e) {
    statusEl.textContent = '';
    errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
  }
}

function fillPreviewForm(data) {
  const f = data.fields;
  document.getElementById('f_jobTitle').value = f.jobTitle || '';
  document.getElementById('f_department').value = f.department || '';
  document.getElementById('f_directReportTo').value = f.directReportTo || '';
  document.getElementById('f_orgStructurePosition').value = f.orgStructurePosition || '';
  setSelectValue('f_positionType', f.positionType);
  document.getElementById('f_placement').value = f.placement || '';
  document.getElementById('f_officeHours').value = f.officeHours || '';
  document.getElementById('f_workingDays').value = f.workingDays || '';
  setSelectValue('f_travelRequired', f.travelRequired);
  document.getElementById('f_salaryRange').value = f.salaryRange || '';
  setSelectValue('f_salaryType', f.salaryType || '');
  document.getElementById('f_additionalNotes').value = f.additionalNotes || '';
  document.getElementById('f_jobOverview').value = f.jobOverview || '';
  BULLET_FIELDS.forEach(({ key, label }) => {
    document.getElementById(`f_${key}_wrap`).innerHTML = renderBulletEditorField('f', key, label, f[key]);
  });
  wireBulletEditors('f');

  setSelectValue('f_industry', data.industry || 'Not Identified');
  const confNote = document.getElementById('confidenceNote');
  if (data.industryConfidence === 'low') {
    confNote.innerHTML = '<span style="color:#92400e">Low detection confidence — please review and pick manually if needed.</span>';
  } else if (data.industryConfidence === 'medium') {
    confNote.innerHTML = '<span style="color:#6b7280">Medium detection confidence, please double-check.</span>';
  } else {
    confNote.innerHTML = '<span style="color:#15803d">High detection confidence.</span>';
  }

  document.querySelector('input[name="f_assignMode"][value="none"]').checked = true;
  document.getElementById('f_assignedTo').value = '';
  wireAssignControls('f');
  document.getElementById('f_status').value = 'open';
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  const exists = Array.from(el.options).some((o) => o.value === value);
  if (exists) el.value = value;
  else if (value) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
    el.value = value;
  }
}

function resetUploadForm() {
  document.getElementById('previewCard').style.display = 'none';
  document.getElementById('fileInput').value = '';
  document.getElementById('parseStatus').textContent = '';
  lastParsedPreview = null;
}

async function handleSaveJob() {
  const errBox = document.getElementById('uploadErr');
  errBox.innerHTML = '';
  const assign = readAssignControls('f');
  const payload = {
    jobTitle: document.getElementById('f_jobTitle').value.trim(),
    department: document.getElementById('f_department').value.trim(),
    directReportTo: document.getElementById('f_directReportTo').value.trim(),
    orgStructurePosition: document.getElementById('f_orgStructurePosition').value.trim(),
    positionType: document.getElementById('f_positionType').value,
    placement: document.getElementById('f_placement').value.trim(),
    officeHours: document.getElementById('f_officeHours').value.trim(),
    workingDays: document.getElementById('f_workingDays').value.trim(),
    travelRequired: document.getElementById('f_travelRequired').value,
    salaryRange: document.getElementById('f_salaryRange').value.trim(),
    salaryType: document.getElementById('f_salaryType').value,
    additionalNotes: document.getElementById('f_additionalNotes').value.trim(),
    industry: document.getElementById('f_industry').value,
    industryConfidence: lastParsedPreview ? lastParsedPreview.industryConfidence : 'low',
    jobOverview: document.getElementById('f_jobOverview').value.trim(),
    jobDescription: readBulletEditor('f', 'jobDescription'),
    jobRequirements: readBulletEditor('f', 'jobRequirements'),
    preferredSkills: readBulletEditor('f', 'preferredSkills'),
    specialRequirements: readBulletEditor('f', 'specialRequirements'),
    assignedTo: assign.assignedTo,
    assignedToAll: assign.assignedToAll,
    status: document.getElementById('f_status').value,
    sourceFilename: lastParsedPreview ? lastParsedPreview.sourceFilename : null,
  };
  if (!payload.jobTitle) {
    errBox.innerHTML = '<div class="error-msg">Job Title is required.</div>';
    return;
  }
  try {
    await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
    resetUploadForm();
    switchTab('list');
    await loadJobs();
  } catch (e) {
    errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- BULLET EDITOR (Job Description / Requirements / Skills / Special Requirements) ----------
// A small list editor used in place of a plain textarea for the four
// long-text fields: each point gets its own row with a remove button, plus
// an "Add point" button, so the admin never has to hand-manage newlines.

const BULLET_FIELDS = [
  { key: 'jobDescription', label: 'Job Descriptions' },
  { key: 'jobRequirements', label: 'Job Requirements' },
  { key: 'preferredSkills', label: 'Preferred Skills' },
  { key: 'specialRequirements', label: 'Special Requirements' },
];

function splitToBullets(text) {
  return (text || '')
    .split('\n')
    .map((l) => l.replace(/^[\s]*[-*•●▪‣·○]\s*/, '').trim())
    .filter(Boolean);
}

function renderBulletRow(value) {
  return `
    <div class="bullet-row">
      <span class="bullet-handle">&bull;</span>
      <input type="text" value="${escapeHtml(value)}" placeholder="Add a point..." />
      <button type="button" class="bullet-remove-btn" title="Remove this point">&times;</button>
    </div>
  `;
}

// Renders a full field block (label + editable rows + "Add point" button)
// for a given id prefix ("f" for the upload form, "d" for the detail modal).
function renderBulletEditorField(prefix, key, label, text) {
  const points = splitToBullets(text);
  const rows = points.length ? points.map(renderBulletRow).join('') : renderBulletRow('');
  return `
    <label>${label}</label>
    <div class="bullet-editor" id="${prefix}_${key}_editor">${rows}</div>
    <button type="button" class="secondary bullet-add-btn" data-bullet-add="${prefix}_${key}_editor">+ Add point</button>
  `;
}

function wireBulletEditorRows(editor) {
  editor.querySelectorAll('.bullet-remove-btn').forEach((btn) => {
    btn.onclick = () => {
      const row = btn.closest('.bullet-row');
      // Always keep at least one (possibly empty) row so the list never
      // disappears entirely.
      if (editor.querySelectorAll('.bullet-row').length > 1) {
        row.remove();
      } else {
        row.querySelector('input').value = '';
      }
    };
  });
}

// Wires up every bullet editor + "Add point" button for a given prefix.
// Call this once after the fields' HTML has been placed in the DOM.
function wireBulletEditors(prefix) {
  BULLET_FIELDS.forEach(({ key }) => {
    const editor = document.getElementById(`${prefix}_${key}_editor`);
    if (editor) wireBulletEditorRows(editor);
  });
  document.querySelectorAll(`[data-bullet-add^="${prefix}_"]`).forEach((btn) => {
    btn.onclick = () => {
      const editor = document.getElementById(btn.dataset.bulletAdd);
      editor.insertAdjacentHTML('beforeend', renderBulletRow(''));
      wireBulletEditorRows(editor);
      const inputs = editor.querySelectorAll('input');
      inputs[inputs.length - 1].focus();
    };
  });
}

function readBulletEditor(prefix, key) {
  const editor = document.getElementById(`${prefix}_${key}_editor`);
  if (!editor) return '';
  return Array.from(editor.querySelectorAll('input'))
    .map((i) => i.value.trim())
    .filter(Boolean)
    .join('\n');
}

// ---------- JOB EDIT FIELDS (shared by the detail modal) ----------

// Renders the full set of editable job fields (everything except assign/status,
// which have their own section) for a given id prefix, pre-filled from `job`.
function renderJobEditFields(prefix, job = {}) {
  return `
    <div class="grid-2">
      <div class="field">
        <label>Job Title</label>
        <input id="${prefix}_jobTitle" value="${escapeHtml(job.jobTitle || '')}" />
      </div>
      <div class="field">
        <label>Department</label>
        <input id="${prefix}_department" value="${escapeHtml(job.department || '')}" />
      </div>
      <div class="field">
        <label>Direct Report To</label>
        <input id="${prefix}_directReportTo" value="${escapeHtml(job.directReportTo || '')}" />
      </div>
      <div class="field">
        <label>Position in Org Structure Chart</label>
        <input id="${prefix}_orgStructurePosition" value="${escapeHtml(job.orgStructurePosition || '')}" />
      </div>
      <div class="field">
        <label>Position Type</label>
        <select id="${prefix}_positionType">
          ${['Full Time', 'Contract', 'Part Time', 'Project Based'].map((o) => `<option value="${o}" ${job.positionType === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Placement</label>
        <input id="${prefix}_placement" value="${escapeHtml(job.placement || '')}" />
      </div>
      <div class="field">
        <label>Office Hours</label>
        <input id="${prefix}_officeHours" value="${escapeHtml(job.officeHours || '')}" />
      </div>
      <div class="field">
        <label>Working Days</label>
        <input id="${prefix}_workingDays" value="${escapeHtml(job.workingDays || '')}" placeholder="e.g. Monday - Friday" />
      </div>
      <div class="field">
        <label>Travel Required</label>
        <select id="${prefix}_travelRequired">
          ${['Yes', 'No'].map((o) => `<option value="${o}" ${job.travelRequired === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Salary Range</label>
        <div class="input-row">
          <input id="${prefix}_salaryRange" value="${escapeHtml(job.salaryRange || '')}" placeholder="e.g. Rp 15,000,000 - Rp 20,000,000" />
          <select id="${prefix}_salaryType">
            <option value="">Type</option>
            <option value="Nett" ${job.salaryType === 'Nett' ? 'selected' : ''}>Nett</option>
            <option value="Gross" ${job.salaryType === 'Gross' ? 'selected' : ''}>Gross</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>Industry</label>
        <select id="${prefix}_industry">
          ${INDUSTRY_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${job.industry === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Additional Notes</label>
      <textarea id="${prefix}_additionalNotes" rows="3" placeholder="Anything else worth noting, kept separate from the salary range">${escapeHtml(job.additionalNotes || '')}</textarea>
    </div>
    <div class="field">
      <label>Job Overview</label>
      <textarea id="${prefix}_jobOverview" rows="3" placeholder="General summary of the role, kept separate from the description bullets below">${escapeHtml(job.jobOverview || '')}</textarea>
    </div>
    ${BULLET_FIELDS.map(({ key, label }) => `
      <div class="field">${renderBulletEditorField(prefix, key, label, job[key])}</div>
    `).join('')}
  `;
}

function readJobEditFields(prefix) {
  return {
    jobTitle: document.getElementById(`${prefix}_jobTitle`).value.trim(),
    department: document.getElementById(`${prefix}_department`).value.trim(),
    directReportTo: document.getElementById(`${prefix}_directReportTo`).value.trim(),
    orgStructurePosition: document.getElementById(`${prefix}_orgStructurePosition`).value.trim(),
    positionType: document.getElementById(`${prefix}_positionType`).value,
    placement: document.getElementById(`${prefix}_placement`).value.trim(),
    officeHours: document.getElementById(`${prefix}_officeHours`).value.trim(),
    workingDays: document.getElementById(`${prefix}_workingDays`).value.trim(),
    travelRequired: document.getElementById(`${prefix}_travelRequired`).value,
    salaryRange: document.getElementById(`${prefix}_salaryRange`).value.trim(),
    salaryType: document.getElementById(`${prefix}_salaryType`).value,
    industry: document.getElementById(`${prefix}_industry`).value,
    additionalNotes: document.getElementById(`${prefix}_additionalNotes`).value.trim(),
    jobOverview: document.getElementById(`${prefix}_jobOverview`).value.trim(),
    jobDescription: readBulletEditor(prefix, 'jobDescription'),
    jobRequirements: readBulletEditor(prefix, 'jobRequirements'),
    preferredSkills: readBulletEditor(prefix, 'preferredSkills'),
    specialRequirements: readBulletEditor(prefix, 'specialRequirements'),
  };
}

// ---------- JOB LIST ----------

async function loadJobs() {
  const params = new URLSearchParams();
  const status = document.getElementById('filterStatus').value;
  const assignedTo = document.getElementById('filterAssignee').value;
  const industry = document.getElementById('filterIndustry').value;
  if (status) params.set('status', status);
  if (assignedTo) params.set('assignedTo', assignedTo);
  if (industry) params.set('industry', industry);

  const { jobs } = await api(`/api/jobs?${params.toString()}`);
  const wrap = document.getElementById('jobListWrap');

  if (!jobs.length) {
    wrap.innerHTML = '<div class="empty-state">No jobs yet. Upload a new job profile in the "Upload New Job" tab.</div>';
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Job Title</th><th>Industry</th><th>Placement</th><th>Direct Report To</th>
          <th>Assigned To</th><th>Status</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map((j) => `
          <tr>
            <td><strong>${escapeHtml(j.jobTitle)}</strong><div class="hint">${escapeHtml(j.department || '')}</div></td>
            <td>${escapeHtml(j.industry)}</td>
            <td>${escapeHtml(j.placement || '-')}</td>
            <td>${escapeHtml(j.directReportTo || '-')}</td>
            <td>${escapeHtml(j.assignedToName || '-')}</td>
            <td><span class="badge ${j.status}">${j.status === 'open' ? 'Open' : 'Closed'}</span></td>
            <td>
              <button class="secondary" data-view="${j.id}">Detail</button>
              <button class="danger" data-delete="${j.id}">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = () => openJobDetail(btn.dataset.view);
  });
  wrap.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Are you sure you want to delete this job?')) return;
      await api(`/api/jobs/${btn.dataset.delete}`, { method: 'DELETE' });
      loadJobs();
    };
  });
}

async function openJobDetail(id) {
  const { job, notes } = await api(`/api/jobs/${id}`);
  document.getElementById('detailTitle').textContent = job.jobTitle;

  document.getElementById('detailBody').innerHTML = `
    <p class="hint">Edit any field below, then click Save Changes.</p>
    ${renderJobEditFields('d', job)}

    <h3>Assign &amp; Status</h3>
    <div class="grid-2">
      <div class="field">
        <label>Assign To</label>
        ${renderAssignControls('d', { assignedTo: job.assignedTo, assignedToAll: job.assignedToAll })}
      </div>
      <div class="field">
        <label>Status</label>
        <select id="d_status">
          <option value="open" ${job.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${job.status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
      </div>
    </div>
    <div id="d_saveErr"></div>
    <button id="d_saveBtn">Save Changes</button>

    <h3>Notes</h3>
    <div id="d_notes">
      ${notes.length ? notes.map((n) => `
        <div class="note-item">
          ${escapeHtml(n.note)}
          <div class="meta">${escapeHtml(n.author_name || 'Admin')} &middot; ${fmtDate(n.created_at)}</div>
        </div>
      `).join('') : '<div class="hint">No notes yet.</div>'}
    </div>
    <div class="field" style="margin-top:10px">
      <textarea id="d_newNote" placeholder="Add a note..." rows="2"></textarea>
    </div>
    <button class="secondary" id="d_addNoteBtn">Add Note</button>
  `;

  wireAssignControls('d');
  wireBulletEditors('d');

  document.getElementById('d_saveBtn').onclick = async () => {
    const errBox = document.getElementById('d_saveErr');
    errBox.innerHTML = '';
    const fields = readJobEditFields('d');
    if (!fields.jobTitle) {
      errBox.innerHTML = '<div class="error-msg">Job Title is required.</div>';
      return;
    }
    const assign = readAssignControls('d');
    try {
      await api(`/api/jobs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...fields,
          assignedTo: assign.assignedTo,
          assignedToAll: assign.assignedToAll,
          status: document.getElementById('d_status').value,
        }),
      });
      document.getElementById('detailModal').style.display = 'none';
      loadJobs();
    } catch (e) {
      errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  };
  document.getElementById('d_addNoteBtn').onclick = async () => {
    const note = document.getElementById('d_newNote').value.trim();
    if (!note) return;
    await api(`/api/jobs/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
    openJobDetail(id);
  };

  document.getElementById('detailModal').style.display = 'flex';
}

init();
