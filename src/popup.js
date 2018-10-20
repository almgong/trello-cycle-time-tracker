$(function() {
  var CHECKBOX_CONTAINER_SELECTOR = '.js-list-checkbox-container';
  var ENABLE_EXTENSION_CONTAINER_SELECTOR = '.js-enable-extension-container';
  var SUBMIT_BUTTON_SELECTOR = '#submit_settings';
  var TARGET_CT_SELECTOR = '#target_ct';
  var FLASH_MESSAGE_CONTAINER_SELECTOR = '#flash_message';
  var requestTypes = {};

  function sendMessage(message, onResponse) {
    chrome.runtime.sendMessage(message, onResponse);
  }

  function sendMessageToCurrentTab(message, onResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, message, onResponse);
    });
  }

  function renderListCheckboxFor(selectedColumns, listHeading) {
    var formCheckDiv = document.createElement('div');
    formCheckDiv.classList = ['form-check'];

    var checkboxInput = document.createElement('input');
    checkboxInput.classList = ['form-check-input'];
    checkboxInput.type = 'checkbox';
    checkboxInput.name = listHeading;
    checkboxInput.checked = selectedColumns.indexOf(listHeading) !== -1;

    var checkboxLabel = document.createElement('label');
    checkboxLabel.innerText = listHeading;

    formCheckDiv.appendChild(checkboxInput);
    formCheckDiv.appendChild(checkboxLabel);

    $(CHECKBOX_CONTAINER_SELECTOR).append(formCheckDiv);
  }

  function renderExtensionOnOffRadios(enabled) {
    var $container = $(ENABLE_EXTENSION_CONTAINER_SELECTOR);
    $container.empty();

    var checkedValueForOn = enabled ? ' checked' : '';
    var checkedValueForOff = enabled ? '' : ' checked';
    $container.append('\
      <label>Enable Extension: &nbsp;</label>\
      <div class="form-check form-check-inline">\
        <input id="enable_extension__on" class="form-check-input" type="radio" name="enable_extension" value="on"' + checkedValueForOn + '>\
        <label class="form-check-label" for="enable_extension__on">On</label>\
      </div>\
      <div class="form-check form-check-inline">\
        <input id="enable_extension__off" class="form-check-input" type="radio" name="enable_extension" value="off"' + checkedValueForOff + '>\
        <label class="form-check-label" for="enable_extension__off">Off</label>\
      </div>\
    ');
  }

  function renderUi(settings, trelloLists) {
    renderExtensionOnOffRadios(settings.enabled);

    trelloLists.forEach(function(listHeading) {
      renderListCheckboxFor(settings.cycleTimeRelatedColumns, listHeading);
    });

    $(TARGET_CT_SELECTOR).val(settings.targetCycleTimeMinutes / 60);
  }

  function renderFlashMessage(content, type) {
    var alertType = type || 'success';

    $(FLASH_MESSAGE_CONTAINER_SELECTOR).html('<div class="alert alert-' + alertType + ' " role="alert">' + content +'</div>');
  }

  function serializeCheckboxes() {
    return $(CHECKBOX_CONTAINER_SELECTOR + ' .form-check-input:checked').map(function() {
      return $(this).attr('name');
    }).get();
  }

  function serializeForm() {
    var formValues = {
      enabled: $('#enable_extension__on').prop('checked'),
      targetCycleTimeMinutes: (+$('#target_ct').val() || 1) * 60,
      cycleTimeRelatedColumns: serializeCheckboxes()
    };

    return formValues;
  }

  function submitForm() {
    var serializedForm = serializeForm();
    var updateMessage = { type: requestTypes.UPDATE_SETTINGS, data: serializedForm };
    sendMessage(updateMessage); // notify background process to update storage
    sendMessageToCurrentTab(updateMessage); // notify content process for any needed UI updates
    renderFlashMessage('Settings saved.');

    var enableDisableType = serializedForm.enabled ? requestTypes.ENABLE_EXTENSION : requestTypes.DISABLE_EXTENSION;
    sendMessageToCurrentTab({ type: enableDisableType });
  }

  // main

  sendMessage({ type: 'help' }, function(typesResult) {
    requestTypes = typesResult;
    sendMessage({ type: typesResult.GET_SETTINGS }, function(settingsResult) {
      sendMessageToCurrentTab({ type: typesResult.GET_CURRENT_TRELLO_LISTS_FROM_BOARD }, function(listResult) {
        renderUi(settingsResult, listResult);
      });
    });
  });

  $(SUBMIT_BUTTON_SELECTOR).on('click', function(e) {
    e.preventDefault();

    submitForm();
  });
});
