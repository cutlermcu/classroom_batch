// Background service worker for Classroom Batch Manager - REAL API VERSION

chrome.runtime.onInstalled.addListener(() => {
  console.log('Classroom Batch Manager installed');
  
  // Create context menu if permission is available
  if (chrome.contextMenus) {
    try {
      chrome.contextMenus.create({
        id: "addToGroup",
        title: "Add to Classroom Group",
        contexts: ["page"],
        documentUrlPatterns: ["https://classroom.google.com/c/*"]
      });
      console.log('Context menu created successfully');
    } catch (error) {
      console.error('Error creating context menu:', error);
    }
  }
});

// Real Google Classroom API integration
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
          console.error('Authentication error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          this.accessToken = token;
          console.log('Authentication successful');
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

    console.log(`API Call: ${method} ${url}`);

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, try to refresh
          console.log('Token expired, refreshing...');
          chrome.identity.removeCachedAuthToken({ token: this.accessToken });
          this.accessToken = null;
          await this.authenticate();
          // Retry the request
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
    try {
      console.log('Fetching courses from Google Classroom...');
      const response = await this.makeAPICall('courses?teacherId=me&courseStates=ACTIVE&pageSize=100');
      console.log(`Found ${response.courses?.length || 0} courses`);
      return response.courses || [];
    } catch (error) {
      console.error('Error fetching courses:', error);
      throw error;
    }
  }

  async createAssignment(courseId, assignment) {
    try {
      console.log(`Creating assignment in course ${courseId}:`, assignment.title);
      
      const courseWork = {
        title: assignment.title,
        description: assignment.description || '',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        maxPoints: assignment.points ? parseInt(assignment.points) : undefined,
        submissionModificationMode: assignment.allowLate ? 'MODIFIABLE_UNTIL_TURNED_IN' : 'MODIFIABLE'
      };

      // Add due date if provided
      if (assignment.dueDate) {
        const dueDateTime = new Date(assignment.dueDate);
        courseWork.dueDate = {
          year: dueDateTime.getFullYear(),
          month: dueDateTime.getMonth() + 1,
          day: dueDateTime.getDate()
        };
        courseWork.dueTime = {
          hours: dueDateTime.getHours(),
          minutes: dueDateTime.getMinutes()
        };
      }

      // Add materials if provided
      if (assignment.materials && assignment.materials.length > 0) {
        courseWork.materials = assignment.materials;
      }

      const response = await this.makeAPICall(`courses/${courseId}/courseWork`, 'POST', courseWork);
      console.log(`✓ Assignment created: ${response.id}`);
      return response;
    } catch (error) {
      console.error('Error creating assignment:', error);
      throw error;
    }
  }

  async createAnnouncement(courseId, announcement) {
    try {
      console.log(`Creating announcement in course ${courseId}`);
      
      const announcementData = {
        text: announcement.text || announcement.description || '',
        state: 'PUBLISHED',
        materials: announcement.materials || []
      };

      const response = await this.makeAPICall(`courses/${courseId}/announcements`, 'POST', announcementData);
      console.log(`✓ Announcement created: ${response.id}`);
      return response;
    } catch (error) {
      console.error('Error creating announcement:', error);
      throw error;
    }
  }

  async uploadFile(file, fileName, folderId = null) {
    try {
      console.log(`Uploading file: ${fileName} (${file.size} bytes)`);
      
      if (!this.accessToken) {
        await this.authenticate();
      }

      // Step 1: Create metadata
      const metadata = {
        name: fileName,
        parents: folderId ? [folderId] : undefined
      };

      // Step 2: Upload file using multipart upload
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      const response = await fetch(`${this.uploadURL}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        body: form
      });

      if (!response.ok) {
        throw new Error(`File upload failed: ${response.status} ${response.statusText}`);
      }

      const fileData = await response.json();
      console.log(`✓ File uploaded: ${fileData.id}`);

      // Step 3: Make file accessible
      await this.makeFilePublic(fileData.id);

      return fileData;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  async makeFilePublic(fileId) {
    try {
      const permission = {
        role: 'reader',
        type: 'anyone'
      };

      await fetch(`${this.driveURL}/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(permission)
      });

      console.log(`✓ File permissions set: ${fileId}`);
    } catch (error) {
      console.error('Error setting file permissions:', error);
      // Don't throw - file upload was successful even if permissions failed
    }
  }

  async getUserInfo() {
    try {
      const response = await this.makeAPICall('courses?teacherId=me&pageSize=1');
      // Extract user info from the first course or API response
      return {
        authenticated: true,
        hasClassrooms: response.courses && response.courses.length > 0
      };
    } catch (error) {
      console.error('Error getting user info:', error);
      return {
        authenticated: false,
        hasClassrooms: false
      };
    }
  }
}

const classroomAPI = new ClassroomAPI();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  switch (request.action) {
    case 'authenticate':
      classroomAPI.authenticate()
        .then(token => {
          console.log('Authentication successful');
          sendResponse({ success: true, token });
        })
        .catch(error => {
          console.error('Authentication failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'getCourses':
      classroomAPI.getCourses()
        .then(courses => {
          console.log('Courses retrieved:', courses.length);
          sendResponse({ success: true, courses });
        })
        .catch(error => {
          console.error('Get courses failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'getUserInfo':
      classroomAPI.getUserInfo()
        .then(userInfo => {
          sendResponse({ success: true, userInfo });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'batchCreateAssignment':
      handleBatchAssignment(request.data)
        .then(results => {
          console.log('Batch assignment completed:', results);
          sendResponse({ success: true, results });
        })
        .catch(error => {
          console.error('Batch assignment failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'batchUploadMaterial':
      handleBatchMaterial(request.data)
        .then(results => {
          console.log('Batch material upload completed:', results);
          sendResponse({ success: true, results });
        })
        .catch(error => {
          console.error('Batch material upload failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'uploadFiles':
      handleFileUpload(request.data)
        .then(results => {
          console.log('File upload completed:', results);
          sendResponse({ success: true, results });
        })
        .catch(error => {
          console.error('File upload failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'testConnection':
      sendResponse({ 
        success: true, 
        message: 'Background script is working',
        timestamp: new Date().toISOString(),
        apiIntegration: 'REAL_API_MODE'
      });
      return false;

    default:
      console.warn('Unknown action:', request.action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

// Handle batch assignment creation with real API
async function handleBatchAssignment(data) {
  const { classrooms, assignment } = data;
  const results = [];
  
  console.log(`Creating assignment "${assignment.title}" in ${classrooms.length} classrooms`);

  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    
    try {
      // Add delay to prevent rate limiting (Google API limits)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const result = await classroomAPI.createAssignment(classroom.id, assignment);
      
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        assignment: result,
        assignmentUrl: `https://classroom.google.com/c/${classroom.id}/a/${result.id}`
      });
      
      console.log(`✓ Assignment created in ${classroom.name}`);
      
    } catch (error) {
      console.error(`✗ Failed to create assignment in ${classroom.name}:`, error);
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

// Handle batch material upload with real API
async function handleBatchMaterial(data) {
  const { classrooms, material, files } = data;
  const results = [];
  
  console.log(`Uploading materials to ${classrooms.length} classrooms`);

  // First, upload files to Google Drive if any
  let uploadedFiles = [];
  if (files && files.length > 0) {
    console.log(`Uploading ${files.length} files to Google Drive...`);
    
    for (const file of files) {
      try {
        const uploadResult = await classroomAPI.uploadFile(file, file.name);
        uploadedFiles.push({
          driveFile: {
            driveFile: {
              id: uploadResult.id,
              title: uploadResult.name,
              alternateLink: `https://drive.google.com/file/d/${uploadResult.id}/view`
            },
            shareMode: 'VIEW'
          }
        });
        console.log(`✓ File uploaded: ${file.name}`);
      } catch (error) {
        console.error(`✗ Failed to upload file ${file.name}:`, error);
      }
    }
  }

  // Then create announcements in each classroom
  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    
    try {
      // Add delay to prevent rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const announcementData = {
        text: material.description || 'New materials have been added to the class.',
        materials: uploadedFiles
      };
      
      const result = await classroomAPI.createAnnouncement(classroom.id, announcementData);
      
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        announcement: result,
        filesUploaded: uploadedFiles.length,
        announcementUrl: `https://classroom.google.com/c/${classroom.id}`
      });
      
      console.log(`✓ Material posted in ${classroom.name}`);
      
    } catch (error) {
      console.error(`✗ Failed to create material in ${classroom.name}:`, error);
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

// Handle standalone file upload
async function handleFileUpload(data) {
  const { files } = data;
  const results = [];
  
  console.log(`Uploading ${files.length} files to Google Drive...`);
  
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
      console.log(`✓ File uploaded: ${file.name}`);
    } catch (error) {
      console.error(`✗ Failed to upload file ${file.name}:`, error);
      results.push({
        fileName: file.name,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// Context menu click handler
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('Context menu clicked:', info.menuItemId);
    
    if (info.menuItemId === "addToGroup") {
      chrome.tabs.sendMessage(tab.id, { 
        action: "showAddToGroupModal",
        url: info.pageUrl 
      }).catch(error => {
        console.error('Error sending message to content script:', error);
      });
    }
  });
}

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Classroom Batch Manager started');
});

// Handle when extension is disabled/enabled
chrome.runtime.onSuspend.addListener(() => {
  console.log('Classroom Batch Manager suspended');
});

console.log('Background service worker initialized - REAL API MODE');cess: true, results });
        })
        .catch(error => {
          console.error('Batch material upload failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'uploadFiles':
      handleFileUpload(request.data)
        .then(results => {
          console.log('File upload completed:', results);
          sendResponse({ success: true, results });
        })
        .catch(error => {
          console.error('File upload failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'testConnection':
      sendResponse({ 
        success: true, 
        message: 'Background script is working',
        timestamp: new Date().toISOString()
      });
      return false;

    default:
      console.warn('Unknown action:', request.action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

// Handle batch assignment creation
async function handleBatchAssignment(data) {
  const { classrooms, assignment } = data;
  const results = [];
  
  console.log(`Creating assignment "${assignment.title}" in ${classrooms.length} classrooms`);

  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    
    try {
      // Add a small delay to prevent rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const result = await classroomAPI.createAssignment(classroom.id, {
        title: assignment.title,
        description: assignment.description,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        maxPoints: assignment.points ? parseInt(assignment.points) : null,
        dueDate: assignment.dueDate ? formatDateForAPI(assignment.dueDate) : null,
        submissionModificationMode: assignment.allowLate ? 'MODIFIABLE_UNTIL_TURNED_IN' : 'MODIFIABLE'
      });
      
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        assignment: result 
      });
      
      console.log(`✓ Assignment created in ${classroom.name}`);
      
    } catch (error) {
      console.error(`✗ Failed to create assignment in ${classroom.name}:`, error);
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

// Handle batch material upload
async function handleBatchMaterial(data) {
  const { classrooms, material, files } = data;
  const results = [];
  
  console.log(`Uploading materials to ${classrooms.length} classrooms`);

  // First, upload files if any
  let uploadedFiles = [];
  if (files && files.length > 0) {
    console.log(`Uploading ${files.length} files...`);
    
    for (const file of files) {
      try {
        const uploadResult = await classroomAPI.uploadFile(file, file.name);
        uploadedFiles.push(uploadResult);
        console.log(`✓ File uploaded: ${file.name}`);
      } catch (error) {
        console.error(`✗ Failed to upload file ${file.name}:`, error);
      }
    }
  }

  // Then create materials in each classroom
  for (let i = 0; i < classrooms.length; i++) {
    const classroom = classrooms[i];
    
    try {
      // Add delay to prevent rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const materialData = {
        text: material.description || '',
        state: 'PUBLISHED',
        materials: uploadedFiles.map(file => ({
          driveFile: {
            driveFile: {
              id: file.id,
              title: file.name
            },
            shareMode: 'VIEW'
          }
        }))
      };
      
      const result = await classroomAPI.createMaterial(classroom.id, materialData);
      
      results.push({ 
        classroomId: classroom.id, 
        classroomName: classroom.name,
        success: true, 
        material: result,
        filesUploaded: uploadedFiles.length
      });
      
      console.log(`✓ Material created in ${classroom.name}`);
      
    } catch (error) {
      console.error(`✗ Failed to create material in ${classroom.name}:`, error);
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

// Handle file upload
async function handleFileUpload(data) {
  const { files } = data;
  const results = [];
  
  console.log(`Uploading ${files.length} files to Google Drive...`);
  
  for (const file of files) {
    try {
      const result = await classroomAPI.uploadFile(file, file.name);
      results.push({
        fileName: file.name,
        success: true,
        fileId: result.id,
        downloadUrl: result.webContentLink
      });
      console.log(`✓ File uploaded: ${file.name}`);
    } catch (error) {
      console.error(`✗ Failed to upload file ${file.name}:`, error);
      results.push({
        fileName: file.name,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// Utility function to format date for Google Classroom API
function formatDateForAPI(dateString) {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1, // API expects 1-12
      day: date.getDate()
    };
  } catch (error) {
    console.error('Error formatting date:', error);
    return null;
  }
}

// Context menu click handler
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('Context menu clicked:', info.menuItemId);
    
    if (info.menuItemId === "addToGroup") {
      chrome.tabs.sendMessage(tab.id, { 
        action: "showAddToGroupModal",
        url: info.pageUrl 
      }).catch(error => {
        console.error('Error sending message to content script:', error);
      });
    }
  });
}

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Classroom Batch Manager started');
});

// Handle when extension is disabled/enabled
chrome.runtime.onSuspend.addListener(() => {
  console.log('Classroom Batch Manager suspended');
});

console.log('Background service worker initialized');
