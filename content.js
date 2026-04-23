// Content script for Google Classroom Batch Manager
class ClassroomBatchManager {
  constructor() {
    this.groups = {};
    this.selectedDriveFiles = [];
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
      if (request.action === 'driveFilesSelected') this.onDriveFilesSelected(request.files);
    });
  }

  onDriveFilesSelected(files) {
    // Deduplicate by Drive file ID
    const existingIds = new Set(this.selectedDriveFiles.map(f => f.id));
    files.forEach(f => { if (!existingIds.has(f.id)) this.selectedDriveFiles.push(f); });
    this.renderSelectedDriveFiles();
  }

  renderSelectedDriveFiles() {
    const container = document.getElementById('drive-files-list');
    if (!container) return;

    container.innerHTML = '';
    this.selectedDriveFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'drive-file-chip';
      chip.innerHTML = `
        <span class="drive-file-icon">&#128196;</span>
        <span class="drive-file-name">${file.name}</span>
        <button class="drive-file-remove" data-index="${index}" title="Remove">&times;</button>
      `;
      container.appendChild(chip);
    });

    container.querySelectorAll('.drive-file-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectedDriveFiles.splice(parseInt(e.target.dataset.index), 1);
        this.renderSelectedDriveFiles();
      });
    });
  }

  buildDrivePickerSection() {
    return `
      <div class="form-row">
        <label class="field-label">From Google Drive</label>
        <button type="button" id="open-drive-picker" class="batch-btn drive-picker-btn">
          Pick from Drive
        </button>
        <div id="drive-files-list" class="drive-files-list"></div>
      </div>
    `;
  }

  async openDrivePicker() {
    const response = await chrome.runtime.sendMessage({ action: 'openPicker' });
    if (!response.success) {
      alert(`Could not open Drive picker: ${response.error}`);
    }
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

  // ── Publish controls helpers ──────────────────────────────────────────────────

  buildPublishControls(idPrefix) {
    return `
      <div class="form-row">
        <label class="field-label">Publishing</label>
        <div class="publish-mode-group">
          <label class="radio-label">
            <input type="radio" name="${idPrefix}-publish-mode" value="now" checked> Publish now
          </label>
          <label class="radio-label">
            <input type="radio" name="${idPrefix}-publish-mode" value="scheduled"> Schedule
          </label>
          <label class="radio-label">
            <input type="radio" name="${idPrefix}-publish-mode" value="draft"> Save as draft
          </label>
        </div>
        <div id="${idPrefix}-scheduled-time-row" class="scheduled-time-row" style="display:none;">
          <label class="field-label">Publish at:
            <input type="datetime-local" id="${idPrefix}-scheduled-time">
          </label>
        </div>
      </div>
    `;
  }

  attachPublishModeListener(idPrefix) {
    document.querySelectorAll(`input[name="${idPrefix}-publish-mode"]`).forEach(radio => {
      radio.addEventListener('change', (e) => {
        const scheduledRow = document.getElementById(`${idPrefix}-scheduled-time-row`);
        if (scheduledRow) scheduledRow.style.display = e.target.value === 'scheduled' ? 'block' : 'none';
        // Hide due date in draft mode (assignments only)
        const dueRow = document.getElementById(`${idPrefix}-due-row`);
        if (dueRow) dueRow.style.display = e.target.value === 'draft' ? 'none' : 'flex';
      });
    });
  }

  readPublishState(idPrefix) {
    const mode = document.querySelector(`input[name="${idPrefix}-publish-mode"]:checked`)?.value || 'now';
    if (mode === 'draft') return { state: 'DRAFT', scheduledTime: null };
    if (mode === 'scheduled') {
      const raw = document.getElementById(`${idPrefix}-scheduled-time`)?.value;
      if (!raw) { alert('Please select a scheduled publish time.'); return null; }
      if (new Date(raw) <= new Date()) { alert('Scheduled time must be in the future.'); return null; }
      return { state: 'PUBLISHED', scheduledTime: new Date(raw).toISOString() };
    }
    return { state: 'PUBLISHED', scheduledTime: null };
  }

  buildTopicField(idPrefix) {
    return `
      <div class="form-row">
        <label class="field-label" for="${idPrefix}-topic">Topic (optional)</label>
        <input type="text" id="${idPrefix}-topic" class="field-input"
               placeholder="e.g. Unit 3 — Forces">
        <p class="field-hint">A matching topic is found or created in each classroom.</p>
      </div>
    `;
  }

  // ── Group Management ──────────────────────────────────────────────────────────

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
    document.getElementById('create-group-btn')?.addEventListener('click', () => this.createNewGroup());
  }

  async loadAvailableClassrooms(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];

    container.innerHTML = 'Loading classrooms...';
    let courses = [];

    const stored = await chrome.storage.local.get(['cachedCourses']);
    if (stored.cachedCourses && stored.cachedCourses.length > 0) {
      courses = stored.cachedCourses;
    } else {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getCourses' });
        if (response.success && response.courses.length > 0) {
          courses = response.courses.map(c => ({ id: c.id, name: c.name }));
          await chrome.storage.local.set({ cachedCourses: courses });
        }
      } catch (e) {
        console.warn('API fetch failed, falling back to DOM parsing');
      }

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
        <input type="checkbox" id="cls-${containerId}-${classroom.id}"
               value="${classroom.id}" data-name="${classroom.name}">
        <label for="cls-${containerId}-${classroom.id}">${classroom.name}</label>
      `;
      container.appendChild(div);
    });

    return courses;
  }

  createNewGroup() {
    const groupName = document.getElementById('new-group-name')?.value.trim();
    if (!groupName) { alert('Please enter a group name'); return; }

    const selected = [];
    document.querySelectorAll('#create-classroom-list input[type="checkbox"]:checked').forEach(cb => {
      selected.push({ id: cb.value, name: cb.dataset.name });
    });
    if (selected.length === 0) { alert('Please select at least one classroom'); return; }

    this.groups[groupName] = selected;
    this.saveGroups();
    this.displayGroups();
    this.closeModal();
  }

  editGroup(groupName) {
    const currentIds = new Set((this.groups[groupName] || []).map(c => c.id));

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

    if (!courseId) { alert('Could not determine classroom ID from this page.'); return; }

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

  // ── Batch Upload (files → material or assignment) ─────────────────────────────

  showBatchUploadModal() {
    this.selectedDriveFiles = [];
    this.createModal('Batch Upload Files', `
      <div class="batch-upload">
        <div class="form-section">
          <h4>Select Group</h4>
          <select id="upload-group-select" class="group-select">
            <option value="">Choose a group...</option>
            ${Object.keys(this.groups).map(group =>
              `<option value="${group}">${group} (${this.groups[group].length} classes)</option>`
            ).join('')}
          </select>
        </div>

        <div class="form-section">
          <h4>Select Files</h4>
          <input type="file" id="batch-files" multiple accept="*/*">
          <div class="file-list" id="selected-files"></div>
          ${this.buildDrivePickerSection()}
        </div>

        <div class="form-section">
          <h4>Upload Type</h4>
          <label class="radio-label"><input type="radio" name="upload-type" value="material" checked> Add as Material</label>
          <label class="radio-label"><input type="radio" name="upload-type" value="assignment"> Create Assignment</label>
        </div>

        <div id="material-options" class="form-section">
          <h4>Material Details</h4>
          <input type="text" id="material-title" class="field-input" placeholder="Material title (required)">
          <textarea id="material-description" class="field-input" rows="2" placeholder="Description (optional)"></textarea>
          ${this.buildTopicField('bum')}
          ${this.buildPublishControls('bum')}
        </div>

        <div id="assignment-options" class="form-section" style="display:none;">
          <h4>Assignment Details</h4>
          <input type="text" id="assignment-title" class="field-input" placeholder="Assignment title (required)">
          <textarea id="assignment-description" class="field-input" rows="2" placeholder="Instructions (optional)"></textarea>
          <div class="settings-grid">
            <div class="settings-row">
              <label class="field-label">Due Date</label>
              <input type="datetime-local" id="assignment-due-date">
            </div>
          </div>
          ${this.buildTopicField('bua')}
          ${this.buildPublishControls('bua')}
        </div>

        <button id="execute-batch-upload" class="batch-btn primary full-width">Upload to All Classes</button>
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
      this.displaySelectedFilesInto(e.target.files, 'selected-files');
    });

    document.getElementById('open-drive-picker')?.addEventListener('click', () => {
      this.openDrivePicker();
    });

    this.attachPublishModeListener('bum');
    this.attachPublishModeListener('bua');

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

      const publishState = this.readPublishState('bua');
      if (publishState === null) return;

      this.closeModal();
      this.showProgressModal(`Creating assignment in ${classrooms.length} classrooms...`);

      const fileDataArray = await this.readFilesAsBase64(files);
      const driveMaterials = this.selectedDriveFiles.map(f => ({
        driveFile: { driveFile: { id: f.id, title: f.name }, shareMode: 'VIEW' }
      }));
      const response = await chrome.runtime.sendMessage({
        action: 'batchCreateAssignment',
        data: {
          classrooms,
          assignment: {
            title,
            description: document.getElementById('assignment-description')?.value.trim(),
            workType: 'ASSIGNMENT',
            dueDate: document.getElementById('assignment-due-date')?.value,
            topicName: document.getElementById('bua-topic')?.value.trim(),
            state: publishState.state,
            scheduledTime: publishState.scheduledTime,
            materials: driveMaterials
          },
          files: fileDataArray
        }
      });
      this.showResultsModal(response.results || [], response.error);

    } else {
      const title = document.getElementById('material-title')?.value.trim();
      if (!title) { alert('Please enter a material title'); return; }

      const publishState = this.readPublishState('bum');
      if (publishState === null) return;

      this.closeModal();
      this.showProgressModal(`Uploading material to ${classrooms.length} classrooms...`);

      const fileDataArray = await this.readFilesAsBase64(files);
      const driveMaterials = this.selectedDriveFiles.map(f => ({
        driveFile: { driveFile: { id: f.id, title: f.name }, shareMode: 'VIEW' }
      }));
      const response = await chrome.runtime.sendMessage({
        action: 'batchUploadMaterial',
        data: {
          classrooms,
          material: {
            title,
            description: document.getElementById('material-description')?.value.trim(),
            topicName: document.getElementById('bum-topic')?.value.trim(),
            state: publishState.state,
            scheduledTime: publishState.scheduledTime,
            materials: driveMaterials
          },
          files: fileDataArray
        }
      });
      this.showResultsModal(response.results || [], response.error);
    }
  }

  // ── Batch Assignment ───────────────────────────────────────────────────────────

  showBatchAssignmentModal() {
    this.selectedDriveFiles = [];
    this.createModal('Batch Create Assignment', `
      <div class="batch-assignment">

        <div class="form-section">
          <h4>Select Group</h4>
          <select id="ba-group-select" class="group-select">
            <option value="">Choose a group...</option>
            ${Object.keys(this.groups).map(g =>
              `<option value="${g}">${g} (${this.groups[g].length} classes)</option>`
            ).join('')}
          </select>
        </div>

        <div class="form-section">
          <h4>Details</h4>
          <input type="text" id="ba-title" class="field-input" placeholder="Title (required)" required>
          <textarea id="ba-description" class="field-input" rows="3"
                    placeholder="Instructions (optional)"></textarea>
        </div>

        <div class="form-section">
          <h4>Work Type</h4>
          <div class="work-type-group">
            <label class="radio-label">
              <input type="radio" name="ba-work-type" value="ASSIGNMENT" checked> Assignment
            </label>
            <label class="radio-label">
              <input type="radio" name="ba-work-type" value="SHORT_ANSWER_QUESTION"> Short Answer Question
            </label>
            <label class="radio-label">
              <input type="radio" name="ba-work-type" value="MULTIPLE_CHOICE_QUESTION"> Multiple Choice Question
            </label>
          </div>
          <div id="ba-mcq-options" class="mcq-options" style="display:none;">
            <label class="field-label">Choices (one per line, minimum 2)</label>
            <textarea id="ba-mcq-choices" class="field-input" rows="4"
                      placeholder="Choice A&#10;Choice B&#10;Choice C"></textarea>
          </div>
        </div>

        <div class="form-section">
          <h4>Settings</h4>
          <div class="settings-grid">
            <div id="ba-due-row" class="settings-row">
              <label class="field-label">Due Date</label>
              <input type="datetime-local" id="ba-due-date">
            </div>
            <div id="ba-points-row" class="settings-row">
              <label class="field-label">Points Possible</label>
              <input type="number" id="ba-points" min="0" placeholder="100">
            </div>
            <div id="ba-late-row" class="settings-row">
              <label class="field-label">Allow Late Submissions</label>
              <input type="checkbox" id="ba-allow-late">
            </div>
          </div>
          ${this.buildTopicField('ba')}
          ${this.buildPublishControls('ba')}
        </div>

        <div class="form-section">
          <h4>Attachments (optional)</h4>
          <input type="file" id="ba-files" multiple accept="*/*">
          <div class="file-list" id="ba-selected-files"></div>
          ${this.buildDrivePickerSection()}
        </div>

        <button id="execute-batch-assignment" class="batch-btn primary full-width">
          Create in All Classes
        </button>
      </div>
    `);

    document.querySelector('#batch-manager-modal .batch-modal')
      ?.classList.add('batch-modal--wide');

    document.querySelectorAll('input[name="ba-work-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const isQuestion = e.target.value !== 'ASSIGNMENT';
        const isMCQ = e.target.value === 'MULTIPLE_CHOICE_QUESTION';
        document.getElementById('ba-mcq-options').style.display = isMCQ ? 'block' : 'none';
        document.getElementById('ba-points-row').style.display = isQuestion ? 'none' : 'flex';
        document.getElementById('ba-late-row').style.display = isQuestion ? 'none' : 'flex';
      });
    });

    this.attachPublishModeListener('ba');

    document.getElementById('ba-files')?.addEventListener('change', (e) => {
      this.displaySelectedFilesInto(e.target.files, 'ba-selected-files');
    });

    document.getElementById('open-drive-picker')?.addEventListener('click', () => {
      this.openDrivePicker();
    });

    document.getElementById('execute-batch-assignment')?.addEventListener('click', () => {
      this.executeBatchAssignment();
    });
  }

  async executeBatchAssignment() {
    const groupName = document.getElementById('ba-group-select')?.value;
    const title = document.getElementById('ba-title')?.value.trim();

    if (!groupName) { alert('Please select a group'); return; }
    if (!title) { alert('Please enter an assignment title'); return; }

    const classrooms = this.groups[groupName];
    const workType = document.querySelector('input[name="ba-work-type"]:checked')?.value || 'ASSIGNMENT';

    let choices = [];
    if (workType === 'MULTIPLE_CHOICE_QUESTION') {
      const raw = document.getElementById('ba-mcq-choices')?.value || '';
      choices = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (choices.length < 2) {
        alert('Multiple choice questions require at least 2 choices.');
        return;
      }
    }

    const publishState = this.readPublishState('ba');
    if (publishState === null) return;

    const description = document.getElementById('ba-description')?.value.trim();
    const dueDate = document.getElementById('ba-due-date')?.value;
    const points = document.getElementById('ba-points')?.value;
    const allowLate = document.getElementById('ba-allow-late')?.checked;
    const topicName = document.getElementById('ba-topic')?.value.trim();
    const files = document.getElementById('ba-files')?.files;

    this.closeModal();
    this.showProgressModal(`Creating assignment in ${classrooms.length} classrooms...`);

    const fileDataArray = (files && files.length > 0)
      ? await this.readFilesAsBase64(files)
      : [];

    // Drive files are already on Drive — pass as pre-built materials, no upload needed
    const driveMaterials = this.selectedDriveFiles.map(f => ({
      driveFile: { driveFile: { id: f.id, title: f.name }, shareMode: 'VIEW' }
    }));

    const response = await chrome.runtime.sendMessage({
      action: 'batchCreateAssignment',
      data: {
        classrooms,
        assignment: {
          title,
          description,
          workType,
          choices,
          dueDate: publishState.state !== 'DRAFT' ? dueDate : null,
          points,
          allowLate,
          topicName,
          state: publishState.state,
          scheduledTime: publishState.scheduledTime,
          materials: driveMaterials
        },
        files: fileDataArray
      }
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
            <p style="color:#c62828;">Operation failed: ${errorMsg}</p>
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
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      results.push({ name: file.name, type: file.type, size: file.size, data: btoa(binary) });
    }
    return results;
  }

  displaySelectedFilesInto(files, containerId) {
    const fileList = document.getElementById(containerId);
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
