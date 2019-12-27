$(function() {
  var CHECKBOX_CONTAINER_SELECTOR = '.js-list-checkbox-container';
  var STARTING_COLUMN_SELECT_SELECTOR = '.js-starting-column-container';
  var ENABLE_EXTENSION_CONTAINER_SELECTOR = '.js-enable-extension-container';
  var SUBMIT_BUTTON_SELECTOR = '#submit_settings';
  var TARGET_CT_SELECTOR = '#target_ct';
  var UNSTARTED_LIST_SUFFIX_SELECTOR = '#unstarted_suffix';
  var STARTED_LIST_SUFFIX_SELECTOR = '#started_suffix';
  var FLASH_MESSAGE_CONTAINER_SELECTOR = '#flash_message';
  var RECAlCULATE_BUTTON_SELECTOR = '#recalculate_btn';
  var requestTypes = {};
  var currentBoardId = null;

  function sendMessage(message, onResponse) {
    chrome.runtime.sendMessage(message, onResponse);
  }

  function sendMessageToCurrentTab(message, onResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, message, onResponse);
    });
  }

  function renderExtensionOnOffRadios(enabled) {
    var $container = $(ENABLE_EXTENSION_CONTAINER_SELECTOR);
    $container.empty();

    var checkedValueForOn = enabled ? ' checked' : '';
    var checkedValueForOff = enabled ? '' : ' checked';
    $container.append('\
      <label>Enable For Current Board: &nbsp;</label>\
      <div class="form-check form-check-inline">\
        <input id="enable_extension__on" class="form-check-input" type="radio" name="enable_extension" value="on"' + checkedValueForOn + '>\
        <label class="form-check-label" for="enable_extension__on">Yes</label>\
      </div>\
      <div class="form-check form-check-inline">\
        <input id="enable_extension__off" class="form-check-input" type="radio" name="enable_extension" value="off"' + checkedValueForOff + '>\
        <label class="form-check-label" for="enable_extension__off">No</label>\
      </div>\
    ');
  }

  function renderUi(settings) {
    renderExtensionOnOffRadios(settings.enabled);

    $(UNSTARTED_LIST_SUFFIX_SELECTOR).val(settings.unstartedListSuffix);
    $(STARTED_LIST_SUFFIX_SELECTOR).val(settings.startedListSuffix);
    $(TARGET_CT_SELECTOR).val(settings.targetCycleTimeMinutes / 60);

    $(RECAlCULATE_BUTTON_SELECTOR).on('click', function(e) {
      e.preventDefault();

      sendMessageToCurrentTab({ type: requestTypes.RECALCULATE });
    });
  }

  function renderFlashMessage(content, type) {
    var alertType = type || 'success';

    $(FLASH_MESSAGE_CONTAINER_SELECTOR).html('<div class="alert alert-' + alertType + ' " role="alert">' + content +'</div>');
  }

  function serializeCheckboxes() {
    return $(CHECKBOX_CONTAINER_SELECTOR + ' .form-check-input:checked').map(function() {
      return { id: $(this).val(), name: $(this).attr('name') };
    }).get();
  }

  function serializeForm() {
    var formValues = {
      enabled: $('#enable_extension__on').prop('checked'),
      targetCycleTimeMinutes: (+$('#target_ct').val() || 1) * 60,
      cycleTimeRelatedColumns: serializeCheckboxes(),
      startingColumnId: $(STARTING_COLUMN_SELECT_SELECTOR + ' option:selected').val(),
      unstartedListSuffix: $(UNSTARTED_LIST_SUFFIX_SELECTOR).val(),
      startedListSuffix: $(STARTED_LIST_SUFFIX_SELECTOR).val()
    };

    return formValues;
  }

  function submitForm() {
    var serializedForm = serializeForm();
    var updateMessage = { type: requestTypes.UPDATE_SETTINGS, data: { boardId: currentBoardId, newSettings: serializedForm } };
    sendMessage(updateMessage); // notify background process to update storage
    sendMessageToCurrentTab(updateMessage); // notify content process for any needed UI updates
    renderFlashMessage('Settings saved.');

    var enableDisableType = serializedForm.enabled ? requestTypes.ENABLE_EXTENSION : requestTypes.DISABLE_EXTENSION;
    sendMessageToCurrentTab({ type: enableDisableType });

    window.scrollTo(0, 0);
  }

  // main
  sendMessage({ type: 'help' }, function(typesResult) {
    requestTypes = typesResult;
    sendMessageToCurrentTab({ type: requestTypes.GET_CURRENT_BOARD_ID }, function (boardId) {
      currentBoardId = boardId;
      sendMessage({ type: typesResult.GET_SETTINGS, data: { boardId: boardId } }, function(settingsResult) {
        renderUi(settingsResult);

        $(SUBMIT_BUTTON_SELECTOR).on('click', function(e) {
          e.preventDefault();
          submitForm();
        });
      });
    });
  });
});
