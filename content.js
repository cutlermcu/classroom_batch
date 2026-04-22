// Content script for Google Classroom Batch Manager
class ClassroomBatchManager {
  constructor() {
    this.groups = {};
    this.init();
  }

  init() {
    this.loadStoredGroups().then(() => {
      this.addBatchManagerUI();
    });
    this.observePageChanges();
    this.listenForPopupMessages();
  }

  async loadStoredGroups() {
    const result = await chrome.storage.sync.get(['classroomGroups']);
    this.groups = result.classroomGroups || {};
  }

  async saveGroups() {
    await chrome.storage.sync.set({ classroomGroups: this.groups });
  }

  listenForPopupMessages() {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'showGroupManagement') this.showGroupManagementModal();
      if (request.action === 'showBatchUpload') this.showBatchUploadModal();
      if (request.action === 'showBatchAssignment') this.showBatchAssignmentModal();
      if (request.action === 'showAddToGroupModal') this.showAddToGroupModal();
    });
  }

  addBatchManagerUI() {
    if (window.location.pathname === '/' || window.location.pathname.match(/^\/u\/\d+\/?$/)) {
      this.addMainPageUI();
    }

    if (window.location.pathname.includes('/c/')) {
      this.addClassroomPageUI();
    }
  }

  addMainPageUI() {
    if (document.getElementById('batch-manager-container')) return;

    const classroomList = document.querySelector('[data-module-id="eJz7eQ"]');
    if (!classroomList) return;

    const batchContainer = document.createElement('div');
    batchContainer.id = 'batch-manager-container';
    batchContainer.innerHTML = `
      <div class="batch-manager-panel">
        <h3>Classroom Batch Manager</h3>
        <div class="batch-actions">
          <button id="manage-groups-btn" class="batch-btn primary">Manage Groups</button>
          <button id="batch-upload-btn" class="batch-btn">Batch Upload</button>
          <button id="batch-assign-btn" class="batch-btn">Batch Assignment</button>
        </div>
        <div id="groups-display" class="groups-display"></div>
      </div>
    `;

    classroomList.parentNode.insertBefore(batchContainer, classroomList);
    this.attachMainPageEvents();
    this.displayGroups();
  }

  addClassroomPageUI() {
    if (document.getElementById('add-to-group-btn')) return;

    const toolbar = document.querySelector('[data-test-id="classroom-header"]') ||
                    document.querySelector('.z0LcW');
    if (!toolbar) return;

    const batchButton = document.createElement('button');
    batchButton.id = 'add-to-group-btn';
    batchButton.className = 'batch-classroom-btn';
    batchButton.textContent = 'Add to Group';
    batchButton.addEventListener('click', () => this.showAddToGroupModal());
    toolbar.appendChild(batchButton);
  }

  attachMainPageEvents() {
    document.getElementById('manage-groups-btn')?.addEventListener('click', () => {
      this.showGroupManagementModal();
    });
    document.getElementById('batch-upload-btn')?.addEventListener('click', () => {
      this.showBatchUploadModal();
    });
    document.getElementById('batch-assign-btn')?.addEventListener('click', () => {
      this.showBatchAssignmentModal();
    });
  }

  displayGroups() {
    const groupsDisplay = document.getElementById('groups-display');
    if (!groupsDisplay) return;

    groupsDisplay.innerHTML = '';

    if (Object.keys(this.groups).length === 0) {
      groupsDisplay.innerHTML = '<p class="no-groups-msg">No groups yet. Click "Manage Groups" to create one.</p>';
      return;
    }

    Object.entries(this.groups).forEach(([groupName, classrooms]) => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'group-item';
      groupDiv.innerHTML = `
        <div class="group-header">
          <span class="group-name">${groupName}</span>
          <span class="classroom-count">${classrooms.length} classes</span>
          <button class="edit-group-btn" data-group="${groupName}" title="Edit group">&#9998;</button>
          <button class="delete-group-btn" data-group="${groupName}" title="Delete group">&#128465;</button>
        </div>
        <div class="group-classrooms">
          ${classrooms.map(c => `<span class="classroom-tag">${c.name}</span>`).join('')}
        </div>
      `;
      groupsDisplay.appendChild(groupDiv);
    });

    document.querySelectorAll('.edit-group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.editGroup(e.target.dataset.group));
    });

    document.querySelectorAll('.delete-group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.deleteGroup(e.target.dataset.group));
    });
  }

  // ── Group Management ────────────────────────────────────────────────────────

  showGroupManagementModal() {
    this.createModal('Manage Classroom Groups', `
      <div class="group-management">
        <div class="create-group-section">
          <h4>Create New Group</h4>
          <input type="text" id="new-group-name" placeholder="Group name (e.g., '6th Grade Advisory')">
          <div id="create-classroom-list" class="classroom-list">Loading classrooms...</div>
          <button id="create-group-btn" class="batch-btn primary">Create Group</button>
        </div>
      </div>
    `);

    this.loadAvailableClassrooms('create-classroom-list');

    document.getElementById('create-group-btn')?.addEventListener('click', () => {
      this.createNewGroup();
    });
  }

  async loadAvailableClassrooms(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];

    container.innerHTML = 'Loading classrooms...';

    let courses = [];

    // Try locally-cached courses first (stored in local, not sync, to avoid quota)
    const stored = await chrome.storage.local.get(['cachedCourses']);
    if (stored.cachedCourses && stored.cachedCourses.length > 0) {
      courses = stored.cachedCourses;
    } else {
      // Fetch from API
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getCourses' });
        if (response.success && response.courses.length > 0) {
          courses = response.courses.map(c => ({ id: c.id, name: c.name }));
          await chrome.storage.local.set({ cachedCourses: courses });
        }
      } catch (e) {
        console.warn('API fetch failed, falling back to DOM parsing');
      }

      // DOM fallback
      if (courses.length === 0) {
        const elements = document.querySelectorAll('[data-test-id="class-card-title"]');
        courses = Array.from(elements).map(el => ({
          name: el.textContent.trim(),
          id: this.extractClassroomId(el.closest('[href]')?.href || '')
        })).filter(c => c.id);
      }
    }

    if (courses.length === 0) {
      container.innerHTML = '<p class="no-groups-msg">No classrooms found. Try syncing from the popup first.</p>';
      return [];
    }

    container.innerHTML = '';
    courses.forEach(classroom => {
      const div = document.createElement('div');
      div.className = 'classroom-item';
      div.innerHTML = `
        <input type="checkbox" id="cls-${containerId}-${classroom.id}" value="${classroom.id}" data-name="${classroom.name}">
        <label for="cls-${containerId}-${classroom.id}">${classroom.name}</label>
      `;
      container.appendChild(div);
    });

    return courses;
  }

  createNewGroup() {
    const groupName = document.getElementById('new-group-name')?.value.trim();
    if (!groupName) {
      alert('Please enter a group name');
      return;
    }

    const selected = [];
    document.querySelectorAll('#create-classroom-list input[type="checkbox"]:checked').forEach(cb => {
      selected.push({ id: cb.value, name: cb.dataset.name });
    });

    if (selected.length === 0) {
      alert('Please select at least one classroom');
      return;
    }

    this.groups[groupName] = selected;
    this.saveGroups();
    this.displayGroups();
    this.closeModal();
  }

  editGroup(groupName) {
    const currentClassrooms = this.groups[groupName] || [];
    const currentIds = new Set(currentClassrooms.map(c => c.id));

    this.createModal(`Edit Group: ${groupName}`, `
      <div class="group-management">
        <div class="create-group-section">
          <h4>Rename Group</h4>
          <input type="text" id="edit-group-name" value="${groupName}" placeholder="Group name">
          <h4>Classrooms in Group</h4>
          <div id="edit-classroom-list" class="classroom-list">Loading classrooms...</div>
          <button id="save-edit-group-btn" class="batch-btn primary">Save Changes</button>
        </div>
      </div>
    `);

    this.loadAvailableClassrooms('edit-classroom-list').then(() => {
      // Pre-check classrooms already in this group
      document.querySelectorAll('#edit-classroom-list input[type="checkbox"]').forEach(cb => {
        if (currentIds.has(cb.value)) cb.checked = true;
      });
    });

    document.getElementById('save-edit-group-btn')?.addEventListener('click', () => {
      const newName = document.getElementById('edit-group-name')?.value.trim();
      if (!newName) { alert('Please enter a group name'); return; }

      const selected = [];
      document.querySelectorAll('#edit-classroom-list input[type="checkbox"]:checked').forEach(cb => {
        selected.push({ id: cb.value, name: cb.dataset.name });
      });

      if (selected.length === 0) { alert('Please select at least one classroom'); return; }

      delete this.groups[groupName];
      this.groups[newName] = selected;
      this.saveGroups();
      this.displayGroups();
      this.closeModal();
    });
  }

  deleteGroup(groupName) {
    if (confirm(`Delete group "${groupName}"?`)) {
      delete this.groups[groupName];
      this.saveGroups();
      this.displayGroups();
    }
  }

  showAddToGroupModal() {
    const courseId = this.extractClassroomId(window.location.href);
    const courseName = document.title.replace(' - Google Classroom', '').trim();

    if (!courseId) {
      alert('Could not determine classroom ID from this page.');
      return;
    }

    const groupNames = Object.keys(this.groups);
    if (groupNames.length === 0) {
      alert('No groups exist yet. Create a group first from the main Classroom page.');
      return;
    }

    this.createModal('Add to Group', `
      <div class="group-management">
        <p>Adding <strong>${courseName}</strong> to a group:</p>
        <div id="add-to-group-list">
          ${groupNames.map(name => `
            <div class="classroom-item">
              <input type="checkbox" id="atg-${name}" value="${name}"
                ${(this.groups[name] || []).some(c => c.id === courseId) ? 'checked' : ''}>
              <label for="atg-${name}">${name} (${this.groups[name].length} classes)</label>
            </div>
          `).join('')}
        </div>
        <button id="save-add-to-group-btn" class="batch-btn primary">Save</button>
      </div>
    `);

    document.getElementById('save-add-to-group-btn')?.addEventListener('click', () => {
      groupNames.forEach(name => {
        const cb = document.getElementById(`atg-${name}`);
        const alreadyIn = (this.groups[name] || []).some(c => c.id === courseId);
        if (cb.checked && !alreadyIn) {
          this.groups[name].push({ id: courseId, name: courseName });
        } else if (!cb.checked && alreadyIn) {
          this.groups[name] = this.groups[name].filter(c => c.id !== courseId);
        }
      });
      this.saveGroups();
      this.closeModal();
      alert('Group membership updated.');
    });
  }

  // ── Batch Upload ─────────────────────────────────────────────────────────────

  showBatchUploadModal() {
    this.createModal('Batch Upload Files', `
      <div class="batch-upload">
        <div class="group-selection">
          <h4>Select Group</h4>
          <select id="upload-group-select" class="group-select">
            <option value="">Choose a group...</option>
            ${Object.keys(this.groups).map(group =>
              `<option value="${group}">${group} (${this.groups[group].length} classes)</option>`
            ).join('')}
          </select>
        </div>
        <div class="file-selection">
          <h4>Select Files</h4>
          <input type="file" id="batch-files" multiple accept="*/*">
          <div class="file-list" id="selected-files"></div>
        </div>
        <div class="upload-options">
          <h4>Upload Type</h4>
          <label><input type="radio" name="upload-type" value="material" checked> Add as Material</label>
          <label><input type="radio" name="upload-type" value="assignment"> Create Assignment</label>
          <div id="assignment-options" style="display:none;">
            <input type="text" id="assignment-title" placeholder="Assignment title (required)">
            <textarea id="assignment-description" placeholder="Assignment description"></textarea>
            <input type="date" id="assignment-due-date">
          </div>
          <div id="material-options">
            <input type="text" id="material-title" placeholder="Material title (required)">
            <textarea id="material-description" placeholder="Description (optional)"></textarea>
          </div>
        </div>
        <button id="execute-batch-upload" class="batch-btn primary">Upload to All Classes</button>
      </div>
    `);

    document.querySelectorAll('input[name="upload-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        document.getElementById('assignment-options').style.display =
          e.target.value === 'assignment' ? 'block' : 'none';
        document.getElementById('material-options').style.display =
          e.target.value === 'material' ? 'block' : 'none';
      });
    });

    document.getElementById('batch-files')?.addEventListener('change', (e) => {
      this.displaySelectedFiles(e.target.files);
    });

    document.getElementById('execute-batch-upload')?.addEventListener('click', () => {
      this.executeBatchUpload();
    });
  }

  async executeBatchUpload() {
    const groupName = document.getElementById('upload-group-select')?.value;
    const files = document.getElementById('batch-files')?.files;
    const uploadType = document.querySelector('input[name="upload-type"]:checked')?.value;

    if (!groupName) { alert('Please select a group'); return; }
    if (!files || files.length === 0) { alert('Please select at least one file'); return; }

    const classrooms = this.groups[groupName];

    if (uploadType === 'assignment') {
      const title = document.getElementById('assignment-title')?.value.trim();
      if (!title) { alert('Please enter an assignment title'); return; }
      const description = document.getElementById('assignment-description')?.value.trim();
      const dueDate = document.getElementById('assignment-due-date')?.value;

      this.closeModal();
      this.showProgressModal(`Creating assignment in ${classrooms.length} classrooms...`);

      const fileDataArray = await this.readFilesAsBase64(files);
      const response = await chrome.runtime.sendMessage({
        action: 'batchCreateAssignment',
        data: { classrooms, assignment: { title, description, dueDate }, files: fileDataArray }
      });

      this.showResultsModal(response.results || [], response.error);
    } else {
      const title = document.getElementById('material-title')?.value.trim();
      if (!title) { alert('Please enter a material title'); return; }
      const description = document.getElementById('material-description')?.value.trim();

      this.closeModal();
      this.showProgressModal(`Uploading material to ${classrooms.length} classrooms...`);

      const fileDataArray = await this.readFilesAsBase64(files);
      const response = await chrome.runtime.sendMessage({
        action: 'batchUploadMaterial',
        data: { classrooms, material: { title, description }, files: fileDataArray }
      });

      this.showResultsModal(response.results || [], response.error);
    }
  }

  // ── Batch Assignment ──────────────────────────────────────────────────────────

  showBatchAssignmentModal() {
    this.createModal('Batch Create Assignment', `
      <div class="batch-assignment">
        <div class="group-selection">
          <h4>Select Group</h4>
          <select id="assignment-group-select" class="group-select">
            <option value="">Choose a group...</option>
            ${Object.keys(this.groups).map(group =>
              `<option value="${group}">${group} (${this.groups[group].length} classes)</option>`
            ).join('')}
          </select>
        </div>
        <div class="assignment-details">
          <h4>Assignment Details</h4>
          <input type="text" id="batch-assignment-title" placeholder="Assignment title (required)" required>
          <textarea id="batch-assignment-description" placeholder="Assignment description" rows="4"></textarea>
          <div class="assignment-settings">
            <label>Due Date: <input type="datetime-local" id="batch-due-date"></label>
            <label>Points: <input type="number" id="batch-points" min="0" placeholder="100"></label>
            <label><input type="checkbox" id="batch-allow-late"> Allow late submissions</label>
          </div>
        </div>
        <button id="execute-batch-assignment" class="batch-btn primary">Create Assignment in All Classes</button>
      </div>
    `);

    document.getElementById('execute-batch-assignment')?.addEventListener('click', () => {
      this.executeBatchAssignment();
    });
  }

  async executeBatchAssignment() {
    const groupName = document.getElementById('assignment-group-select')?.value;
    const title = document.getElementById('batch-assignment-title')?.value.trim();

    if (!groupName) { alert('Please select a group'); return; }
    if (!title) { alert('Please enter an assignment title'); return; }

    const classrooms = this.groups[groupName];
    const description = document.getElementById('batch-assignment-description')?.value.trim();
    const dueDate = document.getElementById('batch-due-date')?.value;
    const points = document.getElementById('batch-points')?.value;
    const allowLate = document.getElementById('batch-allow-late')?.checked;

    this.closeModal();
    this.showProgressModal(`Creating assignment in ${classrooms.length} classrooms...`);

    const response = await chrome.runtime.sendMessage({
      action: 'batchCreateAssignment',
      data: { classrooms, assignment: { title, description, dueDate, points, allowLate } }
    });

    this.showResultsModal(response.results || [], response.error);
  }

  // ── Progress & Results UI ─────────────────────────────────────────────────────

  showProgressModal(message) {
    const existing = document.getElementById('batch-manager-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'batch-manager-modal';
    modal.className = 'batch-modal-overlay';
    modal.innerHTML = `
      <div class="batch-modal">
        <div class="batch-modal-header">
          <h3>Working...</h3>
        </div>
        <div class="batch-modal-content">
          <div class="batch-progress">
            <div class="batch-spinner"></div>
            <p>${message}</p>
            <p class="progress-note">Please keep this tab open. This may take a minute for large groups.</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showResultsModal(results, errorMsg) {
    const existing = document.getElementById('batch-manager-modal');
    if (existing) existing.remove();

    if (errorMsg && results.length === 0) {
      const modal = document.createElement('div');
      modal.id = 'batch-manager-modal';
      modal.className = 'batch-modal-overlay';
      modal.innerHTML = `
        <div class="batch-modal">
          <div class="batch-modal-header">
            <h3>Error</h3>
            <button class="batch-modal-close">&times;</button>
          </div>
          <div class="batch-modal-content">
            <p class="result-error">Operation failed: ${errorMsg}</p>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('.batch-modal-close')?.addEventListener('click', () => this.closeModal());
      return;
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    const modal = document.createElement('div');
    modal.id = 'batch-manager-modal';
    modal.className = 'batch-modal-overlay';
    modal.innerHTML = `
      <div class="batch-modal">
        <div class="batch-modal-header">
          <h3>Batch Operation Complete</h3>
          <button class="batch-modal-close">&times;</button>
        </div>
        <div class="batch-modal-content">
          <div class="batch-summary ${failed === 0 ? 'summary-success' : 'summary-partial'}">
            ${succeeded} of ${results.length} classrooms succeeded${failed > 0 ? ` &mdash; ${failed} failed` : ''}
          </div>
          <div class="batch-results-list">
            ${results.map(r => `
              <div class="result-row ${r.success ? 'result-success' : 'result-error'}">
                <span class="result-icon">${r.success ? '&#10003;' : '&#10007;'}</span>
                <span class="result-classroom">${r.classroomName}</span>
                ${r.success && (r.assignmentUrl || r.materialUrl)
                  ? `<a class="result-link" href="${r.assignmentUrl || r.materialUrl}" target="_blank">View</a>`
                  : ''}
                ${!r.success ? `<span class="result-error-msg">${r.error || 'Unknown error'}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.batch-modal-close')?.addEventListener('click', () => this.closeModal());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  async readFilesAsBase64(fileList) {
    const results = [];
    for (const file of fileList) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      // Process in chunks to avoid call stack overflow on large files
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      results.push({ name: file.name, type: file.type, size: file.size, data: btoa(binary) });
    }
    return results;
  }

  displaySelectedFiles(files) {
    const fileList = document.getElementById('selected-files');
    if (!fileList) return;
    fileList.innerHTML = '';
    Array.from(files).forEach(file => {
      const div = document.createElement('div');
      div.className = 'selected-file';
      div.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
      fileList.appendChild(div);
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  extractClassroomId(href) {
    const match = href.match(/\/c\/([^\/\?]+)/);
    return match ? match[1] : null;
  }

  createModal(title, content) {
    const existing = document.getElementById('batch-manager-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'batch-manager-modal';
    modal.className = 'batch-modal-overlay';
    modal.innerHTML = `
      <div class="batch-modal">
        <div class="batch-modal-header">
          <h3>${title}</h3>
          <button class="batch-modal-close">&times;</button>
        </div>
        <div class="batch-modal-content">
          ${content}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.batch-modal-close')?.addEventListener('click', () => this.closeModal());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });

    return modal;
  }

  closeModal() {
    const modal = document.getElementById('batch-manager-modal');
    if (modal) modal.remove();
  }

  observePageChanges() {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('batch-manager-container') &&
          !document.getElementById('batch-manager-modal')) {
        setTimeout(() => this.addBatchManagerUI(), 1000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ClassroomBatchManager());
} else {
  new ClassroomBatchManager();
}
