// Popup script for Classroom Batch Manager
document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
  checkClassroomStatus();
});

async function loadStats() {
  try {
    const result = await chrome.storage.sync.get(['classroomGroups', 'lastSync']);
    const groups = result.classroomGroups || {};
    
    // Update group count
    document.getElementById('groupCount').textContent = Object.keys(groups).length;
    
    // Update total classroom count
    const totalClassrooms = Object.values(groups).reduce((total, group) => total + group.length, 0);
    document.getElementById('classroomCount').textContent = totalClassrooms;
    
    // Update last sync
    const lastSync = result.lastSync;
    if (lastSync) {
      const date = new Date(lastSync);
      document.getElementById('lastSync').textContent = date.toLocaleDateString();
    } else {
      document.getElementById('lastSync').textContent = 'Never';
    }
    
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function setupEventListeners() {
  document.getElementById('openClassroom').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://classroom.google.com' });
    window.close();
  });

  document.getElementById('manageGroups').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (currentTab.url.includes('classroom.google.com')) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'showGroupManagement' });
      window.close();
    } else {
      showError('Please navigate to Google Classroom first');
    }
  });

  document.getElementById('quickUpload').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (currentTab.url.includes('classroom.google.com')) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'showBatchUpload' });
      window.close();
    } else {
      showError('Please navigate to Google Classroom first');
    }
  });

  document.getElementById('quickAssignment').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (currentTab.url.includes('classroom.google.com')) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'showBatchAssignment' });
      window.close();
    } else {
      showError('Please navigate to Google Classroom first');
    }
  });

  document.getElementById('syncData').addEventListener('click', async () => {
    await syncWithClassroom();
  });
}

async function checkClassroomStatus() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (currentTab.url.includes('classroom.google.com')) {
      updateStatus('✅ Connected to Google Classroom', 'success');
      enableActions(true);
    } else {
      updateStatus('⚠️ Navigate to Google Classroom to use batch features', 'warning');
      enableActions(false);
    }
  } catch (error) {
    updateStatus('❌ Error checking status', 'error');
    enableActions(false);
  }
}

function updateStatus(message, type = 'info') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function enableActions(enabled) {
  const actionButtons = document.querySelectorAll('.action-btn:not(#openClassroom):not(#syncData)');
  actionButtons.forEach(btn => {
    if (enabled) {
      btn.classList.remove('disabled');
      btn.disabled = false;
    } else {
      btn.classList.add('disabled');
      btn.disabled = true;
    }
  });
}

async function syncWithClassroom() {
  const syncBtn = document.getElementById('syncData');
  const originalText = syncBtn.textContent;
  
  syncBtn.textContent = '🔄 Syncing...';
  syncBtn.disabled = true;
  
  try {
    // Get fresh classroom data
    const response = await chrome.runtime.sendMessage({ action: 'getCourses' });
    
    if (response.success) {
      // Update last sync time
      await chrome.storage.sync.set({ lastSync: new Date().toISOString() });
      
      updateStatus('✅ Successfully synced with Google Classroom', 'success');
      await loadStats(); // Refresh stats
      
      setTimeout(() => {
        updateStatus('✅ Connected to Google Classroom', 'success');
      }, 2000);
      
    } else {
      throw new Error(response.error || 'Sync failed');
    }
    
  } catch (error) {
    console.error('Sync error:', error);
    updateStatus('❌ Sync failed. Please try again.', 'error');
  } finally {
    syncBtn.textContent = originalText;
    syncBtn.disabled = false;
  }
}

function showError(message) {
  const existingError = document.querySelector('.error');
  if (existingError) existingError.remove();
  
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;
  
  const actionsDiv = document.querySelector('.quick-actions');
  actionsDiv.parentNode.insertBefore(errorDiv, actionsDiv);
  
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.remove();
    }
  }, 5000);
}

// Listen for tab updates to refresh status
chrome.tabs.onActivated.addListener(() => {
  checkClassroomStatus();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    checkClassroomStatus();
  }
});
