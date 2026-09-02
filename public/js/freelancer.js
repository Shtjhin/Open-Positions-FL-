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

  document.getElementById('changePasswordBtn').onclick = openPasswordModal;
  document.getElementById('closePasswordModalBtn').onclick = () => { document.getElementById('passwordModal').style.display = 'none'; };
  document.getElementById('pw_saveBtn').onclick = handleChangePassword;

  await loadJobs();
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

async function loadJobs() {
  const params = new URLSearchParams();
  const status = document.getElementById('filterStatus').value;
  if (status) params.set('status', status);

  const { jobs } = await api(`/api/jobs?${params.toString()}`);
  const wrap = document.getElementById('jobListWrap');

  if (!jobs.length) {
    wrap.innerHTML = '<div class="empty-state">No jobs have been assigned to you yet.</div>';
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr><th>Job Title</th><th>Industry</th><th>Placement</th><th>Status</th><th>Actions</th></tr>
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
      <div class="detail-row"><div class="k">Working Days</div><div class="v">${escapeHtml(job.workingDays || '-')}</div></div>
      <div class="detail-row"><div class="k">Travel Required</div><div class="v">${escapeHtml(job.travelRequired || '-')}</div></div>
      <div class="detail-row"><div class="k">Salary Range</div><div class="v">${escapeHtml(job.salaryRange || '-')}${job.salaryType ? ` <span class="hint">(${escapeHtml(job.salaryType)})</span>` : ''}</div></div>
      <div class="detail-row"><div class="k">Industry</div><div class="v">${escapeHtml(job.industry)}</div></div>
    </div>
    <div class="detail-row"><div class="k">Additional Notes</div><div class="v">${escapeHtml(job.additionalNotes || '-')}</div></div>
    <div class="detail-row"><div class="k">Job Description</div>${renderBullets(job.jobDescription)}</div>
    <div class="detail-row"><div class="k">Job Requirements</div>${renderBullets(job.jobRequirements)}</div>
    <div class="detail-row"><div class="k">Preferred Skills</div>${renderBullets(job.preferredSkills)}</div>
    <div class="detail-row"><div class="k">Special Requirements</div>${renderBullets(job.specialRequirements)}</div>

    <div class="field" style="margin-top:16px">
      <label>Status</label>
      <div class="status-toggle">
        <button data-status="open" ${job.status === 'open' ? 'disabled' : ''}>Mark Open</button>
        <button data-status="closed" class="secondary" ${job.status === 'closed' ? 'disabled' : ''}>Mark Closed</button>
      </div>
    </div>

    <h3>Notes</h3>
    <div id="d_notes">
      ${notes.length ? notes.map((n) => `
        <div class="note-item">
          ${escapeHtml(n.note)}
          <div class="meta">${escapeHtml(n.author_name || '-')} &middot; ${fmtDate(n.created_at)}</div>
        </div>
      `).join('') : '<div class="hint">No notes yet.</div>'}
    </div>
    <div class="field" style="margin-top:10px">
      <textarea id="d_newNote" placeholder="Add a note or progress update..." rows="2"></textarea>
    </div>
    <button class="secondary" id="d_addNoteBtn">Add Note</button>
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
