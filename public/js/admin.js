const INDUSTRY_OPTIONS = [
  'Beauty, Cosmetics & Wellness', 'Fashion & Apparel', 'Retail & FMCG',
  'Food & Beverage / Hospitality', 'Banking & Financial Services', 'Insurance',
  'Technology / IT / Software', 'E-commerce', 'Healthcare & Pharmaceuticals',
  'Property & Real Estate', 'Construction & Engineering', 'Manufacturing & Industrial',
  'Automotive', 'Logistics & Supply Chain', 'Oil, Gas, Mining & Energy',
  'Telecommunications', 'Media, Advertising & Creative', 'Education & Training',
  'Agriculture & Plantation', 'Professional Services (Consulting/Legal/Accounting)',
  'Government / Non-Profit', 'Belum Teridentifikasi', 'Lainnya',
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

  document.getElementById('refreshBtn').onclick = loadJobs;
  document.getElementById('filterStatus').onchange = loadJobs;
  document.getElementById('filterAssignee').onchange = loadJobs;
  document.getElementById('filterIndustry').onchange = loadJobs;

  document.getElementById('parseBtn').onclick = handleParse;
  document.getElementById('cancelUploadBtn').onclick = resetUploadForm;
  document.getElementById('saveJobBtn').onclick = handleSaveJob;

  document.getElementById('addFreelancerBtn').onclick = handleAddFreelancer;
  document.getElementById('closeDetailBtn').onclick = () => { document.getElementById('detailModal').style.display = 'none'; };
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// ---------- FREELANCERS ----------

async function loadFreelancers() {
  const { users } = await api('/api/users');
  freelancers = users;

  const assignSelect = document.getElementById('f_assignedTo');
  assignSelect.innerHTML = '<option value="">Belum di-assign</option>' +
    users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.username)})</option>`).join('');

  const filterAssignee = document.getElementById('filterAssignee');
  filterAssignee.innerHTML = '<option value="">Semua Freelancer</option>' +
    users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  const wrap = document.getElementById('freelancerListWrap');
  if (!users.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada freelancer. Tambahkan di form atas.</div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Nama</th><th>Username</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.username)}</td>
            <td><span class="badge ${u.active ? 'open' : 'closed'}">${u.active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td>${fmtDate(u.created_at)}</td>
            <td>
              <button class="secondary" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
      const pw = prompt('Password baru untuk freelancer ini:');
      if (!pw) return;
      await api(`/api/users/${btn.dataset.resetpw}`, { method: 'PATCH', body: JSON.stringify({ password: pw }) });
      alert('Password berhasil diubah.');
    };
  });
}

async function handleAddFreelancer() {
  const errBox = document.getElementById('userErr');
  errBox.innerHTML = '';
  const name = document.getElementById('nf_name').value.trim();
  const username = document.getElementById('nf_username').value.trim();
  const password = document.getElementById('nf_password').value.trim();
  if (!name || !username || !password) {
    errBox.innerHTML = '<div class="error-msg">Nama, username, dan password wajib diisi.</div>';
    return;
  }
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ name, username, password }) });
    document.getElementById('nf_name').value = '';
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
    errBox.innerHTML = '<div class="error-msg">Pilih file dulu ya.</div>';
    return;
  }
  const statusEl = document.getElementById('parseStatus');
  statusEl.textContent = 'Memproses file...';

  try {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const data = await api('/api/jobs/parse', { method: 'POST', body: formData });
    lastParsedPreview = data;
    fillPreviewForm(data);
    statusEl.textContent = 'Berhasil di-parse. Cek hasilnya di bawah.';
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
  setSelectValue('f_travelRequired', f.travelRequired);
  document.getElementById('f_salaryRange').value = f.salaryRange || '';
  document.getElementById('f_jobDescription').value = f.jobDescription || '';
  document.getElementById('f_jobRequirements').value = f.jobRequirements || '';
  document.getElementById('f_preferredSkills').value = f.preferredSkills || '';
  document.getElementById('f_specialRequirements').value = f.specialRequirements || '';

  setSelectValue('f_industry', data.industry || 'Belum Teridentifikasi');
  const confNote = document.getElementById('confidenceNote');
  if (data.industryConfidence === 'low') {
    confNote.innerHTML = '<span style="color:#92400e">Keyakinan deteksi rendah — tolong cek & pilih manual kalau perlu.</span>';
  } else if (data.industryConfidence === 'medium') {
    confNote.innerHTML = '<span style="color:#6b7280">Keyakinan deteksi sedang, silakan cek ulang.</span>';
  } else {
    confNote.innerHTML = '<span style="color:#15803d">Keyakinan deteksi tinggi.</span>';
  }

  document.getElementById('f_assignedTo').value = '';
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
  const payload = {
    jobTitle: document.getElementById('f_jobTitle').value.trim(),
    department: document.getElementById('f_department').value.trim(),
    directReportTo: document.getElementById('f_directReportTo').value.trim(),
    orgStructurePosition: document.getElementById('f_orgStructurePosition').value.trim(),
    positionType: document.getElementById('f_positionType').value,
    placement: document.getElementById('f_placement').value.trim(),
    officeHours: document.getElementById('f_officeHours').value.trim(),
    travelRequired: document.getElementById('f_travelRequired').value,
    salaryRange: document.getElementById('f_salaryRange').value.trim(),
    industry: document.getElementById('f_industry').value,
    industryConfidence: lastParsedPreview ? lastParsedPreview.industryConfidence : 'low',
    jobDescription: document.getElementById('f_jobDescription').value.trim(),
    jobRequirements: document.getElementById('f_jobRequirements').value.trim(),
    preferredSkills: document.getElementById('f_preferredSkills').value.trim(),
    specialRequirements: document.getElementById('f_specialRequirements').value.trim(),
    assignedTo: document.getElementById('f_assignedTo').value || null,
    status: document.getElementById('f_status').value,
    sourceFilename: lastParsedPreview ? lastParsedPreview.sourceFilename : null,
  };
  if (!payload.jobTitle) {
    errBox.innerHTML = '<div class="error-msg">Job Title wajib diisi.</div>';
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
    wrap.innerHTML = '<div class="empty-state">Belum ada job. Upload job profile baru di tab "Upload Job Baru".</div>';
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Job Title</th><th>Industry</th><th>Placement</th><th>Direct Report To</th>
          <th>Assigned To</th><th>Status</th><th>Aksi</th>
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
              <button class="danger" data-delete="${j.id}">Hapus</button>
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
      if (!confirm('Yakin mau hapus job ini?')) return;
      await api(`/api/jobs/${btn.dataset.delete}`, { method: 'DELETE' });
      loadJobs();
    };
  });
}

async function openJobDetail(id) {
  const { job, notes } = await api(`/api/jobs/${id}`);
  document.getElementById('detailTitle').textContent = job.jobTitle;

  const assigneeOptions = ['<option value="">Belum di-assign</option>']
    .concat(freelancers.map((u) => `<option value="${u.id}" ${u.id === job.assignedTo ? 'selected' : ''}>${escapeHtml(u.name)}</option>`))
    .join('');

  document.getElementById('detailBody').innerHTML = `
    <div class="grid-2">
      <div class="detail-row"><div class="k">Department</div><div class="v">${escapeHtml(job.department || '-')}</div></div>
      <div class="detail-row"><div class="k">Direct Report To</div><div class="v">${escapeHtml(job.directReportTo || '-')}</div></div>
      <div class="detail-row"><div class="k">Position Type</div><div class="v">${escapeHtml(job.positionType || '-')}</div></div>
      <div class="detail-row"><div class="k">Placement</div><div class="v">${escapeHtml(job.placement || '-')}</div></div>
      <div class="detail-row"><div class="k">Office Hours</div><div class="v">${escapeHtml(job.officeHours || '-')}</div></div>
      <div class="detail-row"><div class="k">Travel Required</div><div class="v">${escapeHtml(job.travelRequired || '-')}</div></div>
      <div class="detail-row"><div class="k">Salary Range</div><div class="v">${escapeHtml(job.salaryRange || '-')}</div></div>
      <div class="detail-row"><div class="k">Industry</div><div class="v">${escapeHtml(job.industry)}</div></div>
    </div>
    <div class="detail-row"><div class="k">Job Description</div><div class="v">${escapeHtml(job.jobDescription || '-')}</div></div>
    <div class="detail-row"><div class="k">Job Requirements</div><div class="v">${escapeHtml(job.jobRequirements || '-')}</div></div>
    <div class="detail-row"><div class="k">Preferred Skills</div><div class="v">${escapeHtml(job.preferredSkills || '-')}</div></div>
    <div class="detail-row"><div class="k">Special Requirements</div><div class="v">${escapeHtml(job.specialRequirements || '-')}</div></div>

    <div class="grid-2" style="margin-top:16px">
      <div class="field">
        <label>Assign ke Freelancer</label>
        <select id="d_assignedTo">${assigneeOptions}</select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="d_status">
          <option value="open" ${job.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${job.status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
      </div>
    </div>
    <button id="d_saveBtn">Simpan Perubahan</button>

    <h3>Catatan</h3>
    <div id="d_notes">
      ${notes.length ? notes.map((n) => `
        <div class="note-item">
          ${escapeHtml(n.note)}
          <div class="meta">${escapeHtml(n.author_name || 'Admin')} &middot; ${fmtDate(n.created_at)}</div>
        </div>
      `).join('') : '<div class="hint">Belum ada catatan.</div>'}
    </div>
    <div class="field" style="margin-top:10px">
      <textarea id="d_newNote" placeholder="Tambah catatan..." rows="2"></textarea>
    </div>
    <button class="secondary" id="d_addNoteBtn">Tambah Catatan</button>
  `;

  document.getElementById('d_saveBtn').onclick = async () => {
    await api(`/api/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        assignedTo: document.getElementById('d_assignedTo').value || null,
        status: document.getElementById('d_status').value,
      }),
    });
    document.getElementById('detailModal').style.display = 'none';
    loadJobs();
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
