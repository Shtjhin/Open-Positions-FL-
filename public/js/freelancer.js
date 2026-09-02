async function init() {
  const { user } = await api('/api/me').catch(() => { window.location.href = '/login.html'; throw new Error(); });
  document.getElementById('whoami').textContent = user.name;

  document.getElementById('logoutBtn').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  };
  document.getElementById('refreshBtn').onclick = loadJobs;
  document.getElementById('filterStatus').onchange = loadJobs;
  document.getElementById('closeDetailBtn').onclick = () => { document.getElementById('detailModal').style.display = 'none'; };

  await loadJobs();
}

async function loadJobs() {
  const params = new URLSearchParams();
  const status = document.getElementById('filterStatus').value;
  if (status) params.set('status', status);

  const { jobs } = await api(`/api/jobs?${params.toString()}`);
  const wrap = document.getElementById('jobListWrap');

  if (!jobs.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada job yang di-assign ke kamu.</div>';
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr><th>Job Title</th><th>Industry</th><th>Placement</th><th>Status</th><th>Aksi</th></tr>
      </thead>
      <tbody>
        ${jobs.map((j) => `
          <tr>
            <td><strong>${escapeHtml(j.jobTitle)}</strong><div class="hint">${escapeHtml(j.department || '')}</div></td>
            <td>${escapeHtml(j.industry)}</td>
            <td>${escapeHtml(j.placement || '-')}</td>
            <td><span class="badge ${j.status}">${j.status === 'open' ? 'Open' : 'Closed'}</span></td>
            <td><button class="secondary" data-view="${j.id}">Detail</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = () => openJobDetail(btn.dataset.view);
  });
}

async function openJobDetail(id) {
  const { job, notes } = await api(`/api/jobs/${id}`);
  document.getElementById('detailTitle').textContent = job.jobTitle;

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

    <div class="field" style="margin-top:16px">
      <label>Status</label>
      <div class="status-toggle">
        <button data-status="open" ${job.status === 'open' ? 'disabled' : ''}>Tandai Open</button>
        <button data-status="closed" class="secondary" ${job.status === 'closed' ? 'disabled' : ''}>Tandai Closed</button>
      </div>
    </div>

    <h3>Catatan</h3>
    <div id="d_notes">
      ${notes.length ? notes.map((n) => `
        <div class="note-item">
          ${escapeHtml(n.note)}
          <div class="meta">${escapeHtml(n.author_name || '-')} &middot; ${fmtDate(n.created_at)}</div>
        </div>
      `).join('') : '<div class="hint">Belum ada catatan.</div>'}
    </div>
    <div class="field" style="margin-top:10px">
      <textarea id="d_newNote" placeholder="Tambah catatan/update progress..." rows="2"></textarea>
    </div>
    <button class="secondary" id="d_addNoteBtn">Tambah Catatan</button>
  `;

  document.getElementById('detailBody').querySelectorAll('[data-status]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
      document.getElementById('detailModal').style.display = 'none';
      loadJobs();
    };
  });
  document.getElementById('d_addNoteBtn').onclick = async () => {
    const note = document.getElementById('d_newNote').value.trim();
    if (!note) return;
    await api(`/api/jobs/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
    openJobDetail(id);
  };

  document.getElementById('detailModal').style.display = 'flex';
}

init();
