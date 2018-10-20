/**
 * On initialization
 */

var STORAGE_SETTINGS_KEY = 'settings';
var DEFAULT_SETTINGS = {
  enabled: true,
  targetCycleTimeMinutes: 60,
  cycleTimeRelatedColumns: []
};

chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.get(STORAGE_SETTINGS_KEY, function(result) {
    if (!result[STORAGE_SETTINGS_KEY]) {
      console.log('No entry for settings, storing defaults...');
      var settings = {};
      settings[STORAGE_SETTINGS_KEY] = DEFAULT_SETTINGS;
      chrome.storage.sync.set(settings, function() {
        if (chrome.runtime.lastError) {
          console.log('Unable to store default settings.');
        } else {
          console.log('Successfully stored default settings.');
        }
      });
    }
  });
});

/**
 * All possible request types.
 *
 * Note that the background script will not satisfy all of these types, and this acts more
 * of a single point of registry for all possible requests sent among content, background, and
 * popup scripts.
 */
var REQUEST_TYPES_ENUM = {
  GET_SETTINGS: 0,
  UPDATE_SETTINGS: 1,
  GET_CURRENT_TRELLO_LISTS_FROM_BOARD: 2,
  ENABLE_EXTENSION: 3,
  DISABLE_EXTENSION: 4
};

/**
 * Event registration.
 *
 * The idea is that this background script will be passively waiting to "answer" requests
 * from a sender.
 */

function handleGetSettingsRequest(cb) {
  chrome.storage.sync.get(STORAGE_SETTINGS_KEY, function(result) {
    cb(result[STORAGE_SETTINGS_KEY]);
  });
}

function handleSetSettingsRequest(newSettings) {
  var settings = {};
  settings[STORAGE_SETTINGS_KEY] = newSettings;
  chrome.storage.sync.set(settings);
}

// all messages are in form { type: ..., data: ... }
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch(request.type) {
    case REQUEST_TYPES_ENUM.GET_SETTINGS:
      handleGetSettingsRequest(sendResponse);
      break;
    case REQUEST_TYPES_ENUM.UPDATE_SETTINGS:
      handleSetSettingsRequest(request.data);
      break;
    case 'help': // this is the only (hardcoded) exception to the rule
      sendResponse(REQUEST_TYPES_ENUM);
      break;
    default:
      console.log('received unhandled request', request)
  }

  return true;  // always respond asynchronously
});
