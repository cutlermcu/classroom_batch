// Background service worker for Classroom Batch Manager

chrome.runtime.onInstalled.addListener(() => {
  console.log('Classroom Batch Manager installed');
});

// Handle authentication and API calls
class ClassroomAPI {
  constructor() {
    this.accessToken = null;
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

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`https://classroom.googleapis.com/v1/${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getCourses() {
    try {
      const response = await this.makeAPICall('courses?teacherId=me&courseStates=ACTIVE');
      return response.courses || [];
    } catch (error) {
      console.error('Error fetching courses:', error);
      return [];
    }
  }

  async createAssignment(courseId, assignment) {
    try {
      return await this.makeAPICall(`courses/${courseId}/courseWork`, 'POST', assignment);
    } catch (error) {
      console.error('Error creating assignment:', error);
      throw error;
    }
  }

  async createMaterial(courseId, material) {
    try {
      return await this.makeAPICall(`courses/${courseId}/announcements`, 'POST', material);
    } catch (error) {
      console.error('Error creating material:', error);
      throw error;
    }
  }
}

const classroomAPI = new ClassroomAPI();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'authenticate':
      classroomAPI.authenticate()
        .then(token => sendResponse({ success: true, token }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Will respond asynchronously

    case 'getCourses':
      classroomAPI.getCourses()
        .then(courses => sendResponse({ success: true, courses }))
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
  }
});

async function handleBatchAssignment(data) {
  const { classrooms, assignment } = data;
  const results = [];

  for (const classroom of classrooms) {
    try {
      const result = await classroomAPI.createAssignment(classroom.id, assignment);
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        assignment: result 
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
  const { classrooms, material } = data;
  const results = [];

  for (const classroom of classrooms) {
    try {
      const result = await classroomAPI.createMaterial(classroom.id, material);
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        material: result 
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

// Handle file uploads to Google Drive
async function uploadToGoogleDrive(file, fileName) {
  const metadata = {
    name: fileName,
    parents: ['your-folder-id'] // Replace with actual folder ID
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${classroomAPI.accessToken}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Drive upload failed: ${response.statusText}`);
  }

  return response.json();
}

// Context menu integration (optional)
chrome.contextMenus.create({
  id: "addToGroup",
  title: "Add to Classroom Group",
  contexts: ["page"],
  documentUrlPatterns: ["https://classroom.google.com/c/*"]
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "addToGroup") {
    chrome.tabs.sendMessage(tab.id, { action: "showAddToGroupModal" });
  }
});
