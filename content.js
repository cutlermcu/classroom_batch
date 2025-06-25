// Content script for Google Classroom Batch Manager
class ClassroomBatchManager {
  constructor() {
    this.groups = {};
    this.init();
  }

  init() {
    this.loadStoredGroups();
    this.addBatchManagerUI();
    this.observePageChanges();
  }

  async loadStoredGroups() {
    const result = await chrome.storage.sync.get(['classroomGroups']);
    this.groups = result.classroomGroups || {};
  }

  async saveGroups() {
    await chrome.storage.sync.set({ classroomGroups: this.groups });
  }

  addBatchManagerUI() {
    // Only add UI on main classroom page
    if (!window.location.pathname.includes('/u/') && 
        window.location.pathname === '/') {
      this.addMainPageUI();
    }
    
    // Add UI to individual classroom pages
    if (window.location.pathname.includes('/c/')) {
      this.addClassroomPageUI();
    }
  }

  addMainPageUI() {
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
    const toolbar = document.querySelector('[data-test-id="classroom-header"]') || 
                   document.querySelector('.z0LcW');
    if (!toolbar) return;

    const batchButton = document.createElement('button');
    batchButton.id = 'add-to-group-btn';
    batchButton.className = 'batch-classroom-btn';
    batchButton.innerHTML = '📁 Add to Group';
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
    
    Object.entries(this.groups).forEach(([groupName, classrooms]) => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'group-item';
      groupDiv.innerHTML = `
        <div class="group-header">
          <span class="group-name">${groupName}</span>
          <span class="classroom-count">${classrooms.length} classes</span>
          <button class="edit-group-btn" data-group="${groupName}">✏️</button>
          <button class="delete-group-btn" data-group="${groupName}">🗑️</button>
        </div>
        <div class="group-classrooms">
          ${classrooms.map(c => `<span class="classroom-tag">${c.name}</span>`).join('')}
        </div>
      `;
      groupsDisplay.appendChild(groupDiv);
    });

    // Attach group action events
    document.querySelectorAll('.edit-group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.editGroup(e.target.dataset.group);
      });
    });

    document.querySelectorAll('.delete-group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.deleteGroup(e.target.dataset.group);
      });
    });
  }

  showGroupManagementModal() {
    const modal = this.createModal('Manage Classroom Groups', `
      <div class="group-management">
        <div class="create-group-section">
          <h4>Create New Group</h4>
          <input type="text" id="new-group-name" placeholder="Group name (e.g., '6th Grade Math')">
          <button id="create-group-btn" class="batch-btn primary">Create Group</button>
        </div>
        <div class="available-classrooms">
          <h4>Available Classrooms</h4>
          <div id="classroom-list" class="classroom-list">
            Loading classrooms...
          </div>
        </div>
      </div>
    `);

    this.loadAvailableClassrooms();
    
    document.getElementById('create-group-btn')?.addEventListener('click', () => {
      this.createNewGroup();
    });
  }

  async loadAvailableClassrooms() {
    const classroomList = document.getElementById('classroom-list');
    if (!classroomList) return;

    // Parse classrooms from the current page
    const classroomElements = document.querySelectorAll('[data-test-id="class-card-title"]');
    const classrooms = Array.from(classroomElements).map(el => ({
      name: el.textContent.trim(),
      id: this.extractClassroomId(el.closest('[href]')?.href || ''),
      element: el
    }));

    classroomList.innerHTML = '';
    classrooms.forEach(classroom => {
      const classroomDiv = document.createElement('div');
      classroomDiv.className = 'classroom-item';
      classroomDiv.innerHTML = `
        <input type="checkbox" id="classroom-${classroom.id}" value="${classroom.id}" data-name="${classroom.name}">
        <label for="classroom-${classroom.id}">${classroom.name}</label>
      `;
      classroomList.appendChild(classroomDiv);
    });
  }

  createNewGroup() {
    const groupName = document.getElementById('new-group-name')?.value.trim();
    if (!groupName) {
      alert('Please enter a group name');
      return;
    }

    const selectedClassrooms = [];
    document.querySelectorAll('#classroom-list input[type="checkbox"]:checked').forEach(checkbox => {
      selectedClassrooms.push({
        id: checkbox.value,
        name: checkbox.dataset.name
      });
    });

    if (selectedClassrooms.length === 0) {
      alert('Please select at least one classroom');
      return;
    }

    this.groups[groupName] = selectedClassrooms;
    this.saveGroups();
    this.displayGroups();
    this.closeModal();
    
    alert(`Group "${groupName}" created with ${selectedClassrooms.length} classrooms!`);
  }

  showBatchUploadModal() {
    const modal = this.createModal('Batch Upload Files', `
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
          <h4>Upload Options</h4>
          <label>
            <input type="radio" name="upload-type" value="material" checked> Add as Material
          </label>
          <label>
            <input type="radio" name="upload-type" value="assignment"> Create Assignment
          </label>
          <div id="assignment-options" style="display: none;">
            <input type="text" id="assignment-title" placeholder="Assignment title">
            <textarea id="assignment-description" placeholder="Assignment description"></textarea>
            <input type="date" id="assignment-due-date">
          </div>
        </div>
        <button id="execute-batch-upload" class="batch-btn primary">Upload to All Classes</button>
      </div>
    `);

    // Handle upload type change
    document.querySelectorAll('input[name="upload-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const assignmentOptions = document.getElementById('assignment-options');
        assignmentOptions.style.display = e.target.value === 'assignment' ? 'block' : 'none';
      });
    });

    // Handle file selection
    document.getElementById('batch-files')?.addEventListener('change', (e) => {
      this.displaySelectedFiles(e.target.files);
    });

    document.getElementById('execute-batch-upload')?.addEventListener('click', () => {
      this.executeBatchUpload();
    });
  }

  showBatchAssignmentModal() {
    const modal = this.createModal('Batch Create Assignment', `
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
          <input type="text" id="batch-assignment-title" placeholder="Assignment title" required>
          <textarea id="batch-assignment-description" placeholder="Assignment description" rows="4"></textarea>
          <div class="assignment-settings">
            <label>
              Due Date: <input type="datetime-local" id="batch-due-date">
            </label>
            <label>
              Points: <input type="number" id="batch-points" min="0" placeholder="100">
            </label>
            <label>
              <input type="checkbox" id="batch-allow-late"> Allow late submissions
            </label>
          </div>
        </div>
        <button id="execute-batch-assignment" class="batch-btn primary">Create Assignment in All Classes</button>
      </div>
    `);

    document.getElementById('execute-batch-assignment')?.addEventListener('click', () => {
      this.executeBatchAssignment();
    });
  }

  async executeBatchUpload() {
    const groupName = document.getElementById('upload-group-select')?.value;
    const files = document.getElementById('batch-files')?.files;
    const uploadType = document.querySelector('input[name="upload-type"]:checked')?.value;

    if (!groupName || !files?.length) {
      alert('Please select a group and files');
      return;
    }

    const classrooms = this.groups[groupName];
    alert(`This would upload ${files.length} file(s) to ${classrooms.length} classrooms in the "${groupName}" group.\n\nNote: Full implementation requires Google Classroom API integration.`);
    
    // In a complete implementation, this would:
    // 1. Upload files to Google Drive
    // 2. Use Classroom API to add materials/create assignments
    // 3. Show progress indicator
    // 4. Handle errors gracefully
  }

  async executeBatchAssignment() {
    const groupName = document.getElementById('assignment-group-select')?.value;
    const title = document.getElementById('batch-assignment-title')?.value;
    const description = document.getElementById('batch-assignment-description')?.value;

    if (!groupName || !title) {
      alert('Please select a group and enter an assignment title');
      return;
    }

    const classrooms = this.groups[groupName];
    alert(`This would create the assignment "${title}" in ${classrooms.length} classrooms in the "${groupName}" group.\n\nNote: Full implementation requires Google Classroom API integration.`);
  }

  displaySelectedFiles(files) {
    const fileList = document.getElementById('selected-files');
    if (!fileList) return;

    fileList.innerHTML = '';
    Array.from(files).forEach(file => {
      const fileDiv = document.createElement('div');
      fileDiv.className = 'selected-file';
      fileDiv.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
      fileList.appendChild(fileDiv);
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  deleteGroup(groupName) {
    if (confirm(`Delete group "${groupName}"?`)) {
      delete this.groups[groupName];
      this.saveGroups();
      this.displayGroups();
    }
  }

  extractClassroomId(href) {
    const match = href.match(/\/c\/([^\/]+)/);
    return match ? match[1] : Math.random().toString(36).substr(2, 9);
  }

  createModal(title, content) {
    const existingModal = document.getElementById('batch-manager-modal');
    if (existingModal) existingModal.remove();

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

    // Close modal events
    modal.querySelector('.batch-modal-close')?.addEventListener('click', () => {
      this.closeModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeModal();
    });

    return modal;
  }

  closeModal() {
    const modal = document.getElementById('batch-manager-modal');
    if (modal) modal.remove();
  }

  observePageChanges() {
    // Re-initialize UI when navigating within Google Classroom
    const observer = new MutationObserver(() => {
      if (!document.getElementById('batch-manager-container')) {
        setTimeout(() => this.addBatchManagerUI(), 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ClassroomBatchManager();
  });
} else {
  new ClassroomBatchManager();
}
