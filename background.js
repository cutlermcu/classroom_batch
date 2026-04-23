// Background service worker for Classroom Batch Manager

chrome.runtime.onInstalled.addListener(() => {
  console.log('Classroom Batch Manager installed');

  if (chrome.contextMenus) {
    try {
      chrome.contextMenus.create({
        id: "addToGroup",
        title: "Add to Classroom Group",
        contexts: ["page"],
        documentUrlPatterns: ["https://classroom.google.com/c/*"]
      });
    } catch (error) {
      console.error('Error creating context menu:', error);
    }
  }
});

class ClassroomAPI {
  constructor() {
    this.accessToken = null;
    this.baseURL = 'https://classroom.googleapis.com/v1';
    this.driveURL = 'https://www.googleapis.com/drive/v3';
    this.uploadURL = 'https://www.googleapis.com/upload/drive/v3';
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          this.accessToken = token;
          resolve(token);
        }
      });
    });
  }

  async makeAPICall(endpoint, method = 'GET', body = null) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}/${endpoint}`;

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        if (response.status === 401) {
          chrome.identity.removeCachedAuthToken({ token: this.accessToken });
          this.accessToken = null;
          await this.authenticate();
          options.headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(url, options);
          if (!retryResponse.ok) {
            throw new Error(`API call failed: ${retryResponse.status} ${retryResponse.statusText}`);
          }
          return retryResponse.json();
        }
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('API call error:', error);
      throw error;
    }
  }

  async getCourses() {
    const response = await this.makeAPICall('courses?teacherId=me&courseStates=ACTIVE&pageSize=100');
    return response.courses || [];
  }

  async getTopics(courseId) {
    try {
      const response = await this.makeAPICall(`courses/${courseId}/topics?pageSize=100`);
      return response.topic || []; // API returns "topic" not "topics"
    } catch (error) {
      return [];
    }
  }

  async createTopic(courseId, name) {
    return this.makeAPICall(`courses/${courseId}/topics`, 'POST', { name });
  }

  async createAssignment(courseId, assignment) {
    const courseWork = {
      title: assignment.title,
      description: assignment.description || '',
      workType: assignment.workType || 'ASSIGNMENT',
      state: assignment.state || 'PUBLISHED',
      submissionModificationMode: assignment.allowLate
        ? 'MODIFIABLE_UNTIL_TURNED_IN'
        : 'MODIFIABLE'
    };

    // Points only make sense for ASSIGNMENT type
    if (
      courseWork.workType === 'ASSIGNMENT' &&
      assignment.points !== undefined &&
      assignment.points !== null &&
      assignment.points !== ''
    ) {
      courseWork.maxPoints = parseInt(assignment.points);
    }

    // Due date is rejected by the API when state is DRAFT
    if (assignment.dueDate && courseWork.state !== 'DRAFT') {
      const d = new Date(assignment.dueDate);
      courseWork.dueDate = {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate()
      };
      courseWork.dueTime = {
        hours: d.getUTCHours(),
        minutes: d.getUTCMinutes()
      };
    }

    // scheduledTime only applies when publishing (not draft)
    if (assignment.scheduledTime && courseWork.state === 'PUBLISHED') {
      courseWork.scheduledTime = assignment.scheduledTime;
    }

    if (assignment.topicId) {
      courseWork.topicId = assignment.topicId;
    }

    if (
      courseWork.workType === 'MULTIPLE_CHOICE_QUESTION' &&
      assignment.choices &&
      assignment.choices.length > 0
    ) {
      courseWork.multipleChoiceQuestion = { choices: assignment.choices };
    }

    if (assignment.materials && assignment.materials.length > 0) {
      courseWork.materials = assignment.materials;
    }

    return this.makeAPICall(`courses/${courseId}/courseWork`, 'POST', courseWork);
  }

  async createAnnouncement(courseId, announcement) {
    const announcementData = {
      text: announcement.text || announcement.description || '',
      state: 'PUBLISHED',
      materials: announcement.materials || []
    };
    return this.makeAPICall(`courses/${courseId}/announcements`, 'POST', announcementData);
  }

  async createMaterial(courseId, material) {
    const materialData = {
      title: material.title || 'Class Material',
      description: material.description || '',
      state: material.state || 'PUBLISHED',
      materials: material.materials || []
    };

    if (material.scheduledTime && materialData.state === 'PUBLISHED') {
      materialData.scheduledTime = material.scheduledTime;
    }

    if (material.topicId) {
      materialData.topicId = material.topicId;
    }

    return this.makeAPICall(`courses/${courseId}/courseWorkMaterials`, 'POST', materialData);
  }

  // fileData: { name, type, data (base64 string) } from content script, or a Blob/File
  async uploadFile(fileData, fileName, folderId = null) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    let blob;
    if (fileData && fileData.data) {
      const binary = atob(fileData.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: fileData.type || 'application/octet-stream' });
      fileName = fileName || fileData.name;
    } else {
      blob = fileData;
    }

    const metadata = {
      name: fileName,
      parents: folderId ? [folderId] : undefined
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const response = await fetch(`${this.uploadURL}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
      body: form
    });

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status} ${response.statusText}`);
    }

    const fileResult = await response.json();
    await this.makeFilePublic(fileResult.id);
    return fileResult;
  }

  async makeFilePublic(fileId) {
    try {
      await fetch(`${this.driveURL}/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
    } catch (error) {
      console.error('Error setting file permissions:', error);
    }
  }

  async getUserInfo() {
    try {
      const response = await this.makeAPICall('courses?teacherId=me&pageSize=1');
      return {
        authenticated: true,
        hasClassrooms: response.courses && response.courses.length > 0
      };
    } catch (error) {
      return { authenticated: false, hasClassrooms: false };
    }
  }
}

const classroomAPI = new ClassroomAPI();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'authenticate':
      classroomAPI.authenticate()
        .then(token => sendResponse({ success: true, token }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getCourses':
      classroomAPI.getCourses()
        .then(courses => sendResponse({ success: true, courses }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getUserInfo':
      classroomAPI.getUserInfo()
        .then(userInfo => sendResponse({ success: true, userInfo }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'batchCreateAssignment':
      handleBatchAssignment(request.data)
        .then(results => sendResponse({ success: true, results }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'batchUploadMaterial':
      handleBatchMaterial(request.data)
        .then(results => sendResponse({ success: true, results }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'uploadFiles':
      handleFileUpload(request.data)
        .then(results => sendResponse({ success: true, results }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'openPicker':
      (async () => {
        try {
          if (!classroomAPI.accessToken) await classroomAPI.authenticate();
          const stored = await chrome.storage.sync.get(['apiKey']);
          if (!stored.apiKey) {
            sendResponse({ success: false, error: 'No API key saved. Add your Google API key in the extension popup settings.' });
            return;
          }
          // Store picker session so picker.js can retrieve credentials
          await chrome.storage.session.set({
            pickerState: {
              token: classroomAPI.accessToken,
              apiKey: stored.apiKey,
              tabId: sender.tab?.id
            }
          });
          await chrome.windows.create({
            url: chrome.runtime.getURL('picker.html'),
            type: 'popup',
            width: 1051,
            height: 650,
            focused: true
          });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;

    case 'getPickerCredentials':
      (async () => {
        const stored = await chrome.storage.session.get(['pickerState']);
        if (!stored.pickerState) {
          sendResponse({ success: false, error: 'No picker session found' });
          return;
        }
        sendResponse({ success: true, ...stored.pickerState });
      })();
      return true;

    case 'pickerResult':
      (async () => {
        const stored = await chrome.storage.session.get(['pickerState']);
        const tabId = stored.pickerState?.tabId;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { action: 'driveFilesSelected', files: request.files })
            .catch(() => {}); // Tab may have navigated away
        }
        await chrome.storage.session.remove(['pickerState']);
        sendResponse({ success: true });
      })();
      return true;

    case 'testConnection':
      sendResponse({ success: true, message: 'Background script is working', timestamp: new Date().toISOString() });
      return false;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

async function uploadFilesToDrive(files) {
  const uploadedFiles = [];
  for (const file of files) {
    try {
      const result = await classroomAPI.uploadFile(file, file.name);
      uploadedFiles.push({
        driveFile: {
          driveFile: {
            id: result.id,
            title: result.name,
            alternateLink: `https://drive.google.com/file/d/${result.id}/view`
          },
          shareMode: 'VIEW'
        }
      });
    } catch (error) {
      console.error(`Failed to upload file ${file.name}:`, error);
    }
  }
  return uploadedFiles;
}

// For each course, find an existing topic by name (case-insensitive) or create it.
async function resolveTopicId(courseId, topicName) {
  if (!topicName || !topicName.trim()) return null;
  const trimmed = topicName.trim().toLowerCase();
  try {
    const topics = await classroomAPI.getTopics(courseId);
    const existing = topics.find(t => t.name.toLowerCase() === trimmed);
    if (existing) return existing.topicId;
    const created = await classroomAPI.createTopic(courseId, topicName.trim());
    return created.topicId;
  } catch (error) {
    console.warn(`Could not resolve topic "${topicName}" for course ${courseId}:`, error);
    return null;
  }
}

async function handleBatchAssignment(data) {
  const { classrooms, assignment, files } = data;
  const results = [];

  let driveMaterials = [];
  if (files && files.length > 0) {
    driveMaterials = await uploadFilesToDrive(files);
  }

  const assignmentBase = {
    ...assignment,
    materials: [...(assignment.materials || []), ...driveMaterials]
  };

  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const topicId = await resolveTopicId(classroom.id, assignment.topicName);
      const result = await classroomAPI.createAssignment(classroom.id, {
        ...assignmentBase,
        topicId
      });
      results.push({
        classroomId: classroom.id,
        classroomName: classroom.name,
        success: true,
        assignment: result,
        assignmentUrl: `https://classroom.google.com/c/${classroom.id}/a/${result.id}`
      });
    } catch (error) {
      results.push({
        classroomId: classroom.id,
        classroomName: classroom.name,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

async function handleBatchMaterial(data) {
  const { classrooms, material, files } = data;
  const results = [];

  let driveMaterials = [];
  if (files && files.length > 0) {
    driveMaterials = await uploadFilesToDrive(files);
  }

  // Merge pre-selected Drive files with newly uploaded ones
  const materialBase = { ...material, materials: [...(material.materials || []), ...driveMaterials] };

  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const topicId = await resolveTopicId(classroom.id, material.topicName);
      const result = await classroomAPI.createMaterial(classroom.id, {
        ...materialBase,
        topicId
      });
      results.push({
        classroomId: classroom.id,
        classroomName: classroom.name,
        success: true,
        material: result,
        filesUploaded: driveMaterials.length,
        materialUrl: `https://classroom.google.com/c/${classroom.id}`
      });
    } catch (error) {
      results.push({
        classroomId: classroom.id,
        classroomName: classroom.name,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

async function handleFileUpload(data) {
  const { files } = data;
  const results = [];

  for (const file of files) {
    try {
      const result = await classroomAPI.uploadFile(file, file.name);
      results.push({
        fileName: file.name,
        success: true,
        fileId: result.id,
        downloadUrl: `https://drive.google.com/file/d/${result.id}/view`,
        directUrl: `https://drive.google.com/uc?id=${result.id}`
      });
    } catch (error) {
      results.push({ fileName: file.name, success: false, error: error.message });
    }
  }

  return results;
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "addToGroup") {
      chrome.tabs.sendMessage(tab.id, {
        action: "showAddToGroupModal",
        url: info.pageUrl
      }).catch(error => console.error('Error sending message to content script:', error));
    }
  });
}

chrome.runtime.onStartup.addListener(() => {
  console.log('Classroom Batch Manager started');
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('Classroom Batch Manager suspended');
});

console.log('Background service worker initialized');
