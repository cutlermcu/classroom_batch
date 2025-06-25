# Google Classroom Batch Manager - Installation Guide

## Overview
This custom Chrome extension allows you to create groups of Google Classrooms and perform batch operations like uploading files and creating assignments across multiple classes simultaneously.

## Features
- ✅ Create custom classroom groups (e.g., "6th Grade Math", "All Science Classes")
- ✅ Batch upload files to multiple classrooms at once
- ✅ Create identical assignments across classroom groups
- ✅ Organize classrooms by grade level or subject
- ✅ Clean, integrated UI within Google Classroom
- ✅ Secure authentication with Google APIs

## Installation Steps

### 1. Download Extension Files
Save each of these files in a new folder called `classroom-batch-manager`:

**Required Files:**
- `manifest.json` - Extension configuration
- `content.js` - Main interface and functionality
- `styles.css` - UI styling
- `background.js` - API handling and authentication
- `popup.html` - Extension popup interface
- `popup.js` - Popup functionality

### 2. Set Up Google API Credentials

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Create a new project or select existing one

2. **Enable Required APIs**
   - Enable "Google Classroom API"
   - Enable "Google Drive API"

3. **Create OAuth 2.0 Credentials**
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: "Chrome Extension"
   - Add your extension ID (get this after loading the extension)

4. **Update manifest.json**
   - Replace `YOUR_GOOGLE_CLIENT_ID` with your actual client ID

### 3. Install the Extension

1. **Open Chrome Extension Management**
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)

2. **Load the Extension**
   - Click "Load unpacked"
   - Select your `classroom-batch-manager` folder
   - Note the Extension ID that appears

3. **Update OAuth Settings**
   - Go back to Google Cloud Console
   - Update your OAuth client with the actual extension ID
   - Format: `chrome-extension://[EXTENSION_ID]/*`

4. **Test Installation**
   - Navigate to https://classroom.google.com
   - You should see the "Classroom Batch Manager" panel

## How to Use

### Creating Classroom Groups

1. **Navigate to Google Classroom**
   - Go to https://classroom.google.com
   - You'll see the Batch Manager panel on your main page

2. **Create a New Group**
   - Click "Manage Groups"
   - Enter a group name (e.g., "6th Grade Math")
   - Select classrooms to include
   - Click "Create Group"

3. **Manage Existing Groups**
   - View all your groups on the main page
   - Edit or delete groups as needed

### Batch Upload Files

1. **Select Group**
   - Click "Batch Upload"
   - Choose the classroom group

2. **Upload Files**
   - Select multiple files
   - Choose upload type:
     - **Material**: Add as class materials
     - **Assignment**: Create new assignments

3. **Execute Upload**
   - Files will be uploaded to all classrooms in the group
   - Progress tracking shows success/failure for each class

### Batch Create Assignments

1. **Select Group**
   - Click "Batch Assignment"
   - Choose classroom group

2. **Assignment Details**
   - Enter title and description
   - Set due date and points
   - Configure submission settings

3. **Create Assignments**
   - Identical assignments created in all group classrooms
   - Individual classroom customization available after creation

## Advanced Features

### Group Organization Strategies

**By Grade Level:**
- "6th Grade All Subjects"
- "7th Grade Math & Science"
- "8th Grade Language Arts"

**By Subject:**
- "All Math Classes"
- "Science Courses"
- "Language Arts"

**By Schedule:**
- "Period 1 Classes"
- "Morning Block"
- "Afternoon Sessions"

### Workflow Examples

**Weekly Assignment Distribution:**
1. Create assignment template
2. Select "All Math Classes" group
3. Batch create with different due dates per period
4. Customize individual classes as needed

**Resource Sharing:**
1. Upload lesson materials to Drive
2. Select appropriate classroom group
3. Batch distribute as materials
4. Students access immediately across all classes

## Troubleshooting

### Extension Not Loading
- Verify all files are in the same folder
- Check Developer Mode is enabled
- Reload the extension after code changes

### API Authentication Issues
- Confirm Google Cloud project has correct APIs enabled
- Verify OAuth client ID matches in manifest.json
- Check extension ID in OAuth settings

### Classroom Not Detected
- Ensure you're on classroom.google.com
- Refresh the page after installing extension
- Check browser console for error messages

### Batch Operations Failing
- Verify Google Classroom API permissions
- Check internet connection
- Confirm you have teacher access to selected classrooms

## Security & Privacy

- Extension only accesses Google Classroom and Drive APIs
- No data stored on external servers
- All classroom groups saved locally in Chrome storage
- OAuth authentication through Google's secure system
- No tracking or analytics

## Support & Customization

This is a bespoke solution tailored to your needs. For modifications or additional features:

- Edit `content.js` for UI changes
- Modify `background.js` for API functionality
- Update `styles.css` for appearance customization
- Add new features by extending existing code

## Future Enhancements

Potential additions based on your feedback:
- Assignment template library
- Scheduled batch operations
- Grade export across groups
- Student progress analytics
- Integration with other educational tools

---

**Need help with installation or customization? Let me know what specific challenges you encounter!**
