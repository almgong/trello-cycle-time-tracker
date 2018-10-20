var TRELLO_LIST_SELECTOR = '.list';
var TRELLO_LIST_HEADER_SELECTOR = '.list-header-name';
var TRELLO_LIST_CARD_SELECTOR = 'a.list-card';

function sendMessage(message, onResponse) {
  chrome.runtime.sendMessage(message, onResponse);
};

/**
 * The main driver of DOM manipulations
 */
function ContentManager(updateIntervalMs) {
  this.updateIntervalMs = updateIntervalMs || 15000;  // 15 seconds by default
  this.cardIdToTimeCreatedMap = {}; // { <id>: <Date object>, ... }
  this.storageScope = '@tctt';
}

ContentManager.prototype.initialize = function() {
  var self = this;
  self.loaded = false;

  // retrieve request type enum and persisted settings
  sendMessage({ type: 'help' }, function(typeResult) {
    self.requestTypes = typeResult;
    sendMessage({ type: self.requestTypes.GET_SETTINGS }, function(settingsResult) {
      self.settings = settingsResult;
      self.loaded = true;

      if (self.settings.enabled) {
        self.start();
      }
    });
  });

  self.retrieveTrelloLists();
  self.cardIdToTimeCreatedMap = this.getSavedTimestamps();
};

ContentManager.prototype.start = function() {
  if (!this.updateIntervalId) {
    this.updateIntervalId = setInterval(this.update.bind(this), this.updateIntervalMs);
    console.log('started tracking.');
  } else {
    console.log('already tracking');
  }
};

ContentManager.prototype.stop = function() {
  if (this.updateIntervalId) {
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = null;
  }

  console.log('stopped tracking');
};

ContentManager.prototype.update = function() {
  if (this.loaded) {
    var self = this;
    // iterate through all queues
    // if it is a cycle time related one, then set timestamps or update UI as needed
    // else clear any styles (this allows this method to be called to reset state)
    this.$currentTrelloLists.each(function() {
      var $currentList = $(this);

      if (self.settings.cycleTimeRelatedColumns.indexOf($currentList.find(TRELLO_LIST_HEADER_SELECTOR).text()) !== -1) {
        self.updateCardsInList($currentList);
      } else {
        self.resetCardsInList($currentList);
      }
    });

    this.saveTimestamps();  // persist timestamp mapping
  }
};

ContentManager.prototype.updateFromNewSettings = function(newSettings) {
  this.settings = newSettings;

  if (this.settings.enabled) {
    this.update();
  }
};

ContentManager.prototype.retrieveCardWithId = function(cardId) {
  return $(TRELLO_LIST_CARD_SELECTOR + '[href*="' + cardId + '"]');
};

ContentManager.prototype.retrieveListWithName = function(name) {
  return this.$currentTrelloLists.filter(function() {
    return $(this).find(TRELLO_LIST_HEADER_SELECTOR).text() === name;
  });
};

ContentManager.prototype.retrieveTrelloLists = function() {
  this.$currentTrelloLists = $(TRELLO_LIST_SELECTOR);

  return this.$currentTrelloLists.map(function() {
    return $(this).find(TRELLO_LIST_HEADER_SELECTOR).text();
  }).get();
};

ContentManager.prototype.updateCardsInList = function($list) {
  var self = this;
  var $cardsInList = $list.find(TRELLO_LIST_CARD_SELECTOR);
  $cardsInList.each(function() {
    var $card = $(this);
    var id = self.parseIdFromCardHref($card.attr('href'));
    
    if (!self.cardIdToTimeCreatedMap[id]) {
      self.cardIdToTimeCreatedMap[id] = new Date();
    }

    self.markCardBasedOnTimeElapsed($card, new Date() - self.cardIdToTimeCreatedMap[id]);
  });
};

ContentManager.prototype.resetCardsInList = function($list) {
  var self = this;
  var $cardsInList = $list.find(TRELLO_LIST_CARD_SELECTOR);

  // for each card sitting in an untracked list, remove marking and
  // entry in timestamps map
  $cardsInList.each(function() {
    var $card = $(this);
    self.removeMarkingOnCard($card);

    var href = self.parseIdFromCardHref($card.attr('href'));
    delete self.cardIdToTimeCreatedMap[self.parseIdFromCardHref(href)];
  });
};

ContentManager.prototype.markCardBasedOnTimeElapsed = function($card, timeElapsedMs) {
  var $block = $card.find('.js-marker');
  var elapsedTimeInHours = Math.floor(timeElapsedMs / 3600000);
  var elapsedTimeInMinutes = timeElapsedMs / 60000;
  var humanizedTimeLabel = this.getHumanizedLabelFor(elapsedTimeInHours);
  var markerType = this.getMarkerTypeFor(elapsedTimeInMinutes);

  if (!$block.length) {
    $card.append('<div class="js-marker marker marker--' + markerType + '">' + humanizedTimeLabel + '</div>');
  } else {
    $block.text(humanizedTimeLabel);
    $block.removeClass(); // removes ALL classes
    $block.addClass('js-marker marker marker--' + markerType);
  }
};

ContentManager.prototype.removeMarkingOnCard = function($card) {
  $card.find('.js-marker').remove();
};

ContentManager.prototype.getHumanizedLabelFor = function(elapsedTimeInFullHours) {
  var humanizedTimeLabel = null;

  if (elapsedTimeInFullHours === 0) {
    humanizedTimeLabel = '< 1hr';
  } else if (elapsedTimeInFullHours === 1 ) {
    humanizedTimeLabel = '1hr';
  } else {
    var days = Math.floor(elapsedTimeInFullHours / 24);
    humanizedTimeLabel = (days ? days + 'd ' : '' ) + (elapsedTimeInFullHours % 24) + 'hrs';
  }

  return humanizedTimeLabel;
}

ContentManager.prototype.getMarkerTypeFor = function(elapsedTimeInMinutes) {
  var ratio = elapsedTimeInMinutes / this.settings.targetCycleTimeMinutes;
  var markerType = null;

  if (ratio < .5) {
    markerType = 'green';
  } else if (ratio < .75) {
    markerType = 'orange';
  } else {
    markerType = 'red';
  }

  return markerType;
};

ContentManager.prototype.parseIdFromCardHref = function(href) {
  // note that cardId here refers to the unique part of the card URL
  // e.g. https://trello.com/c/WiNIc9tP/1-test-card-1 => WiNIc9tP
  return href.split('/').slice(-2)[0];
};

ContentManager.prototype.saveTimestamps = function() {
  var key = this.storageScope + '/card_timestamps';
  window.localStorage.setItem(key, JSON.stringify(this.cardIdToTimeCreatedMap));
};

ContentManager.prototype.getSavedTimestamps = function() {
  var key = this.storageScope + '/card_timestamps';
  var persisted = window.localStorage.getItem(key);
  var parsedPersisted = persisted ? JSON.parse(persisted) : {};

  Object.keys(parsedPersisted).forEach((k) => {
    parsedPersisted[k] = new Date(parsedPersisted[k]);
  });

  return parsedPersisted;
};

var manager = new ContentManager();
manager.initialize();

/**
 * Event registration
 */

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch(request.type) {
    case manager.requestTypes.GET_CURRENT_TRELLO_LISTS_FROM_BOARD:
      sendResponse(manager.retrieveTrelloLists());
      break;
    case manager.requestTypes.UPDATE_SETTINGS:
      manager.updateFromNewSettings(request.data);
      break;
    case manager.requestTypes.ENABLE_EXTENSION:
      manager.start();
      break;
    case manager.requestTypes.DISABLE_EXTENSION:
      manager.stop();
      break;
    default:
      console.log('received unhandled request', request);
  }

  return true;
});
