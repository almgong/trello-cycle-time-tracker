var TRELLO_LIST_SELECTOR = '.list';
var TRELLO_LIST_HEADER_SELECTOR = '.list-header-name';
var TRELLO_LIST_CARD_SELECTOR = 'a.list-card';

/* Authorize Trello */
window.Trello.authorize({
  type: 'popup',
  name: 'Trello Cycle Time Tracker - Chrome Extension',
  scope: {
    read: 'true'
  },
  expiration: 'never',
  success: function () { console.log('authenticated') },
  error: function () { console.log('unable to authenticate') }
});

/* Operations executor that is rate-limit aware */
function RateLimitedExecutor(maxOperationsPerPeriod, periodDurationInMs) {
  this.maxOperationsPerPeriod = maxOperationsPerPeriod;
  this.periodDurationInMs = periodDurationInMs;

  this.timeoutId = null;
  this.numRemainingOperationsForPeriod = maxOperationsPerPeriod;
  this.queue = [];
}

RateLimitedExecutor.prototype.execute = function(operationFn) {
  if (this.timeoutId === null) {
    this.timeoutId = setTimeout(this._onPeriodRefresh.bind(this), this.periodDurationInMs);
  }

  if (this.numRemainingOperationsForPeriod > 0) {
    this.numRemainingOperationsForPeriod -= 1;
    operationFn();
  } else {
    this.queue.push({ fn: operationFn });
  }
};

RateLimitedExecutor.prototype._onPeriodRefresh = function() {
  this.numRemainingOperationsForPeriod = this.maxOperationsPerPeriod;

  // flush queue if necessary
  var operationsToSatisfy = this.queue.splice(0, this.numRemainingOperationsForPeriod);
  this.numRemainingOperationsForPeriod = this.numRemainingOperationsForPeriod - operationsToSatisfy.length;

  operationsToSatisfy.forEach(function (operation) { operation.fn() });

  if (operationsToSatisfy.length) {
    this.timeoutId = setTimeout(this._onPeriodRefresh.bind(this), this.periodDurationInMs);
  } else {
    this.timeoutId = null;
  }
};

function getListsInBoard(boardId, cb) {
  var path = '/boards/' + boardId + '/lists';
  var params = '?fields=id,name&filter=all&cards=all&card_fields=shortUrl,name';

  return window.Trello.get(path + params, cb, function() { console.log('unable to get lists in board') });
}

function getActionsForCard(cardId, cb) {
  var path = '/cards/' + cardId + '/actions';
  var params = '?filter=updateCard,createCard';

  return window.Trello.get(path + params, cb, function() { console.log('unable to get actions for card ' + cardId + ' in board') });
}

// returns the timestamp of the most recent time that the card
// entered one of the specified lists
function parseMostRecentEnterTimeToListsFromActions(actions, listIds) {
  var time = actions[0] ? new Date(actions[0].date) : new Date();

  for (var i = 0; i < actions.length; i++) {
    if (actions[i].data && actions[i].data.listAfter && actions[i].data.listBefore) {
      if (listIds.indexOf(actions[i].data.listAfter.id) !== -1 && listIds.indexOf(actions[i].data.listBefore.id) === -1) {
        time = new Date(actions[i].date);
        break;
      }
    }
  }

  return time;
}

// returns the timestamp of the most recent time that the card
// exited one of the specified lists
function parseMostRecentExitTimeFromListsFromActions(actions, listIds) {
  var time = actions[0] ? new Date(actions[0].date) : new Date();

  for (var i = 0; i < actions.length; i++) {
    if (actions[i].data && actions[i].data.listAfter && actions[i].data.listBefore) {
      if (listIds.indexOf(actions[i].data.listAfter.id) === -1 && listIds.indexOf(actions[i].data.listBefore.id) !== -1) {
        time = new Date(actions[i].date);
        break;
      }
    }
  }

  return time;
}

function sendMessage(message, onResponse) {
  chrome.runtime.sendMessage(message, onResponse);
};

/**
 * The main driver of DOM manipulations
 */
function ContentManager(updateIntervalMs) {
  this.updateIntervalMs = updateIntervalMs || 15000;  // 15 seconds by default
  this.cardIdToTimeStartedMap = {}; // { <id>: <Date object>, ... }
  this.storageScope = '@tctt';
  this.executor = new RateLimitedExecutor(50, 10000);  // 50 potential network ops per 10 seconds
}

ContentManager.prototype.initialize = function() {
  var self = this;
  self.loaded = false;

  // retrieve request type enum and persisted settings
  sendMessage({ type: 'help' }, function(typeResult) {
    self.requestTypes = typeResult;
    sendMessage({ type: self.requestTypes.GET_SETTINGS }, function(settingsResult) {
      self.settings = settingsResult;
      self.boardId = self.parseBoardIdFromCurrentUrl();
      self.cardIdToTimeStartedMap = self.getSavedTimestamps();
      self.loaded = true;

      if (self.settings.enabled) {
        self.start();
      }
    });
  });
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

    // iterate through all lists in board
    this.retrieveTrelloLists(function(listsWithCards) {
      listsWithCards.forEach(function (listWithCards) {
        var $currentList = $(TRELLO_LIST_HEADER_SELECTOR).filter(function () {
          return $(this).text() === listWithCards.name;
        }).closest(TRELLO_LIST_SELECTOR);

        var cycleTimeListIds = self.settings.cycleTimeRelatedColumns.map(function (l) { return l.id });
        var isCycleTimeList = cycleTimeListIds.indexOf(listWithCards.id) !== -1;

        if (isCycleTimeList) {
          self.updateInProgressCardsInList($currentList, listWithCards);
        } else if (listWithCards.id === self.settings.startingColumnId) { // non starting column, i.e. completed
          self.resetCardsInList($currentList);
        } else {
          self.markCardsInListAsCompleted($currentList, listWithCards);
        }
      });
    });
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

ContentManager.prototype.retrieveTrelloLists = function(cb) {
  var self = this;
  this.executor.execute(function() {
    getListsInBoard(self.boardId, function(lists) {

      if (cb) {
        cb(lists);
      }
    });
  });
};

ContentManager.prototype.retrieveTrelloActionsForCard = function(cardId, cb) {
  var self = this;
  this.executor.execute(function() {
    getActionsForCard(cardId, function(actions) {

      if (cb) {
        cb(actions);
      }
    });
  });
};

ContentManager.prototype.updateCardsInList = function($list, options) {
  var self = this;
  var options = options || {};
  var $cardsInList = $list.find(TRELLO_LIST_CARD_SELECTOR);

  $cardsInList.each(function() {
    var $card = $(this);
    var id = self.parseIdFromCardHref($card.attr('href'));

    if (self.cardIdToTimeStartedMap[id]) {
      if (options.completed && self.cardIdToTimeStartedMap[id].completedAt) {
        self.markCardBasedOnTimeElapsed($card, self.cardIdToTimeStartedMap[id].completedAt - self.cardIdToTimeStartedMap[id].startedAt, 'Completed in:');
      } else if (self.cardIdToTimeStartedMap[id].startedAt) {
        self.markCardBasedOnTimeElapsed($card, new Date() - self.cardIdToTimeStartedMap[id].startedAt);
      }
    }
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
    delete self.cardIdToTimeStartedMap[self.parseIdFromCardHref(href)];
  });
};

ContentManager.prototype.markCardBasedOnTimeElapsed = function($card, timeElapsedMs, labelPrefix) {
  var prefix = labelPrefix ? (labelPrefix + ' ') : '';
  var $block = $card.find('.js-marker');
  var elapsedTimeInHours = Math.floor(timeElapsedMs / 3600000);
  var elapsedTimeInMinutes = timeElapsedMs / 60000;
  var humanizedTimeLabel = prefix + this.getHumanizedLabelFor(elapsedTimeInHours);
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
  } else if (ratio < .90) {
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

ContentManager.prototype.parseBoardIdFromCurrentUrl = function() {
  // URL is in form https://trello.com/b/WiNIc9tP/board-name => WiNIc9tP
  return window.location.href.split('/').slice(-2)[0];
};

ContentManager.prototype.saveTimestamps = function() {
  var key = this.storageScope + '/card_timestamps/' + this.boardId;
  window.localStorage.setItem(key, JSON.stringify(this.cardIdToTimeStartedMap));
};

ContentManager.prototype.getSavedTimestamps = function() {
  var key = this.storageScope + '/card_timestamps/' + this.boardId;
  var persisted = window.localStorage.getItem(key);
  var parsedPersisted = persisted ? JSON.parse(persisted) : {};

  Object.keys(parsedPersisted).forEach(function (k) {
    try {
      Object.keys(parsedPersisted[k]).forEach(function (nestedKey) {
        if (nestedKey.match(/.*At$/)) {
          parsedPersisted[k][nestedKey] = new Date(parsedPersisted[k][nestedKey]);
        }
      });
    } catch (err) {
      // it's ok
    }
  });

  return parsedPersisted;
};

ContentManager.prototype.clearTimestamps = function() {
  var key = this.storageScope + '/card_timestamps/' + this.boardId;
  window.localStorage.removeItem(key);
  this.cardIdToTimeStartedMap = {};
};

ContentManager.prototype.assignStartTimesForCardsInList = function (listWithCards, cb) {
  var self = this;
  var assignedCount = 0;
  var onComplete = function () {
    self.saveTimestamps();
    cb();
  }

  listWithCards.cards.forEach(function (card) {
    var cardId = card.shortUrl.split("/").slice(-1)[0];

    if (!(self.cardIdToTimeStartedMap[cardId] && self.cardIdToTimeStartedMap[cardId].startedAt)) {
      self.retrieveTrelloActionsForCard(card.id, function(actions) {
        var cycleTimeListIds = self.settings.cycleTimeRelatedColumns.map(function (list) { return list.id });
        var startTime = parseMostRecentEnterTimeToListsFromActions(actions, cycleTimeListIds);

        self.cardIdToTimeStartedMap[cardId] = self.cardIdToTimeStartedMap[cardId] || {};
        self.cardIdToTimeStartedMap[cardId].startedAt = startTime;

        if (++assignedCount === listWithCards.cards.length) {
          onComplete();
        }
      });
    } else {
      if (++assignedCount === listWithCards.cards.length) {
        onComplete();
      }
    }
  });
};

ContentManager.prototype.assignCompletedTimesForCardsInList = function (listWithCards, cb) {
  var self = this;
  var assignedCount = 0;
  var onComplete = function () {
    self.saveTimestamps();
    cb();
  }

  listWithCards.cards.forEach(function (card) {
    var cardId = card.shortUrl.split("/").slice(-1)[0];

    if (!self.cardIdToTimeStartedMap[cardId] || (!self.cardIdToTimeStartedMap[cardId].completedAt)) {
      self.retrieveTrelloActionsForCard(card.id, function(actions) {
        var cycleTimeListIds = self.settings.cycleTimeRelatedColumns.map(function (list) { return list.id });
        var exitTime = parseMostRecentExitTimeFromListsFromActions(actions, cycleTimeListIds.concat(self.settings.startingColumnId));

        self.cardIdToTimeStartedMap[cardId] = self.cardIdToTimeStartedMap[cardId] || {};
        self.cardIdToTimeStartedMap[cardId].completedAt = exitTime;

        // ensures every completed card also has a start time
        if (!self.cardIdToTimeStartedMap[cardId].startedAt) {
          var cycleTimeListIds = self.settings.cycleTimeRelatedColumns.map(function (list) { return list.id });
          var startTime = parseMostRecentEnterTimeToListsFromActions(actions, cycleTimeListIds);
          self.cardIdToTimeStartedMap[cardId].startedAt = startTime;
        }

        if (++assignedCount === listWithCards.cards.length) {
          onComplete();
        }
      });
    } else {
      if (++assignedCount === listWithCards.cards.length) {
        onComplete();
      }
    }
  });
};

ContentManager.prototype.markCardsInListAsCompleted = function ($currentList, listWithCards) {
  var self = this;

  this.assignCompletedTimesForCardsInList(listWithCards, function() {
    self.updateCardsInList($currentList, { completed: true });
  });
};

ContentManager.prototype.updateInProgressCardsInList = function ($currentList, listWithCards) {
  var self = this;

  this.assignStartTimesForCardsInList(listWithCards, function () {
    self.updateCardsInList($currentList);
  });
};

var manager = new ContentManager();
manager.initialize();

/**
 * Event registration
 */

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  switch(request.type) {
    case manager.requestTypes.GET_CURRENT_TRELLO_LISTS_FROM_BOARD:
      manager.retrieveTrelloLists(function (lists) {
        sendResponse(lists);
      });
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
    case manager.requestTypes.RECALCULATE:
      manager.clearTimestamps();
      manager.update();
      break;
    default:
      console.log('received unhandled request', request);
  }

  return true;
});
