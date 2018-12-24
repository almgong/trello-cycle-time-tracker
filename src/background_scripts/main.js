/**
 * On initialization
 */

 /**
  * Settings is in form:
  * {
  *   boards: {
  *     boardId: {
  *       enabled: boolean,
  *       targetCycleTime: 60,
  *       cycleTimeRelatedColumns: [...],
  *       startingColumnId: '...'
  *     }
  *   }
  * }
  */
var STORAGE_SETTINGS_KEY = 'settings';
var DEFAULT_SETTINGS = {
  boards: {}
};
var DEFAULT_INDIVIDUAL_BOARD_SETTINGS = {
  enabled: false,
  targetCycleTimeMinutes: 60,
  cycleTimeRelatedColumns: [], // [{ id: '...', name: '...'  }, ...]
  startingColumnId: null
};

// ensure that there are some settings for the extension
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
  GET_CURRENT_BOARD_ID: 2,
  GET_CURRENT_TRELLO_LISTS_FROM_BOARD: 3,
  ENABLE_EXTENSION: 4,
  DISABLE_EXTENSION: 5,
  RECALCULATE: 6
};

/**
 * Event registration.
 *
 * The idea is that this background script will be passively waiting to "answer" requests
 * from a sender.
 */

function handleGetSettingsRequest(boardId, cb) {
  chrome.storage.sync.get(STORAGE_SETTINGS_KEY, function(result) {
    if (!result[STORAGE_SETTINGS_KEY].boards[boardId]) {
      result[STORAGE_SETTINGS_KEY].boards[boardId] = DEFAULT_INDIVIDUAL_BOARD_SETTINGS;
    }

    cb(result[STORAGE_SETTINGS_KEY].boards[boardId]);
  });
}

function handleSetSettingsRequest(boardId, newSettings) {
  chrome.storage.sync.get(STORAGE_SETTINGS_KEY, function(result) {
    result[STORAGE_SETTINGS_KEY].boards[boardId] = newSettings;
    chrome.storage.sync.set(result);
  });
}

// all messages are in form { type: ..., data: ... }
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch(request.type) {
    case REQUEST_TYPES_ENUM.GET_SETTINGS:
      handleGetSettingsRequest(request.data.boardId, sendResponse);
      break;
    case REQUEST_TYPES_ENUM.UPDATE_SETTINGS:
      handleSetSettingsRequest(request.data.boardId, request.data.newSettings);
      break;
    case 'help': // this is the only (hardcoded) exception to the rule
      sendResponse(REQUEST_TYPES_ENUM);
      break;
    default:
      console.log('received unhandled request', request)
  }

  return true;  // always respond asynchronously
});
