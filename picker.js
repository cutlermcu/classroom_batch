// Picker page script — runs inside the picker.html extension popup window

function showError(msg) {
  document.getElementById('status').style.display = 'none';
  const err = document.getElementById('error');
  err.textContent = msg;
  err.style.display = 'block';
}

// Request OAuth token + API key from the background service worker
chrome.runtime.sendMessage({ action: 'getPickerCredentials' }, (response) => {
  if (chrome.runtime.lastError) {
    showError('Extension error: ' + chrome.runtime.lastError.message);
    return;
  }
  if (!response?.success) {
    showError(response?.error || 'Could not get credentials.');
    return;
  }

  const { token, apiKey } = response;

  gapi.load('picker', () => {
    try {
      const docsView = new google.picker.DocsView()
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const recentView = new google.picker.DocsView(google.picker.ViewId.RECENTLY_PICKED);

      const picker = new google.picker.PickerBuilder()
        .addView(docsView)
        .addView(recentView)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setTitle('Select files for your assignment')
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback(handlePickerCallback)
        .build();

      picker.setVisible(true);
      document.getElementById('status').style.display = 'none';
    } catch (e) {
      showError('Failed to open picker: ' + e.message);
    }
  });
});

function handlePickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const files = data.docs.map(doc => ({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      url: doc.url || `https://drive.google.com/file/d/${doc.id}/view`
    }));

    chrome.runtime.sendMessage({ action: 'pickerResult', files }, () => {
      window.close();
    });

  } else if (data.action === google.picker.Action.CANCEL) {
    window.close();
  }
}
