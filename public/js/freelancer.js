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
        <tr><th>Code</th><th>Job Title</th><th>Industry</th><th>Placement</th><th>Status</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${jobs.map((j) => `
          <tr>
            <td>${escapeHtml(j.jobCode || '-')}</td>
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
    ${renderJobFieldsHtml(job)}

    <div class="field" style="margin-top:16px">
      <label>Status</label>
      <div class="v"><span class="badge ${job.status}">${job.status === 'open' ? 'Open' : 'Closed'}</span></div>
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
  `;

  document.getElementById('detailModal').style.display = 'flex';
}

init();
