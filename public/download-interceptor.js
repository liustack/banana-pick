(function () {
  'use strict';

  var _fetch = window.fetch;
  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  var pendingCaptureIds = [];
  var MAX_PENDING_CAPTURES = 64;
  var DOWNLOAD_RPC_PATTERN = /\/BardChatUi\/data\/batchexecute\?.*rpcids=c8o8Fe/i;
  var DOWNLOAD_URL_PATTERN = /https:\/\/[^\s"'\\]+\/(?:rd-gg-dl|gg-dl)\/[^\s"'\\]+/i;

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) {
      return;
    }

    if (event.data.type === 'GBD_CAPTURE_EXPECT' && typeof event.data.captureId === 'string') {
      pendingCaptureIds.push(event.data.captureId);

      if (pendingCaptureIds.length > MAX_PENDING_CAPTURES) {
        pendingCaptureIds.splice(0, pendingCaptureIds.length - MAX_PENDING_CAPTURES);
      }
      return;
    }

    if (event.data.type === 'GBD_CAPTURE_CANCEL' && typeof event.data.captureId === 'string') {
      var idx = pendingCaptureIds.indexOf(event.data.captureId);
      if (idx !== -1) {
        pendingCaptureIds.splice(idx, 1);
      }
    }
  });

  function postCapturedBlob(blob, captureId) {
    var reader = new FileReader();
    reader.onload = function () {
      window.postMessage({
        type: 'GBD_IMAGE_CAPTURED',
        captureId: captureId,
        dataUrl: reader.result,
        size: blob.size
      }, '*');
    };
    reader.readAsDataURL(blob);
  }

  function extractDownloadUrl(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return null;
    }

    var match = text.match(DOWNLOAD_URL_PATTERN);
    return match ? match[0] : null;
  }

  async function captureFromDownloadChain(startUrl, captureId) {
    var currentUrl = startUrl;

    for (var step = 0; step < 4; step++) {
      var response = await _fetch.call(window, currentUrl, {
        credentials: 'include'
      });
      var contentType = (response.headers.get('content-type') || '').toLowerCase();

      if (contentType.indexOf('image/') === 0) {
        var blob = await response.blob();
        postCapturedBlob(blob, captureId);
        return;
      }

      var text = await response.text();
      var nextUrl = extractDownloadUrl(text);
      if (!nextUrl) {
        throw new Error('Unable to resolve next Gemini download URL');
      }
      currentUrl = nextUrl;
    }

    throw new Error('Gemini download chain exceeded expected length');
  }

  function consumePendingCaptureId() {
    return pendingCaptureIds.length > 0 ? pendingCaptureIds.shift() : null;
  }

  // Patch fetch to intercept final image responses from Gemini download chain.
  // Redirect chain: gg-dl/ -> (text) -> rd-gg-dl/ -> (text) -> rd-gg-dl/ -> image/png
  //
  // Download suppression (preventing the native blob: download) is handled by
  // the background service worker via chrome.downloads.onCreated — that approach
  // is reliable regardless of how the page triggers downloads (anchor.click,
  // dispatchEvent, navigation, etc.)
  window.fetch = async function () {
    var args = arguments;
    var response = await _fetch.apply(this, args);
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);

    if (url && (url.indexOf('/rd-gg-dl/') !== -1 || url.indexOf('/gg-dl/') !== -1)) {
      var contentType = response.headers.get('content-type') || '';
      if (contentType.indexOf('image/') === 0) {
        // Final image in the redirect chain — convert to data URL and post to content script
        var captureId = consumePendingCaptureId();
        var cloned = response.clone();
        cloned.blob().then(function (blob) {
          postCapturedBlob(blob, captureId);
        });
      }
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gbdMethod = method;
    this.__gbdUrl = typeof url === 'string' ? url : String(url || '');
    return _xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this.__gbdMethod === 'POST' && DOWNLOAD_RPC_PATTERN.test(this.__gbdUrl || '')) {
      this.addEventListener('loadend', function () {
        if (this.status !== 200 || pendingCaptureIds.length === 0) {
          return;
        }

        var downloadUrl = extractDownloadUrl(this.responseText || '');
        if (!downloadUrl) {
          return;
        }

        var captureId = consumePendingCaptureId();
        if (!captureId) {
          return;
        }

        captureFromDownloadChain(downloadUrl, captureId).catch(function (error) {
          console.warn('[Banana Pick] Gemini XHR capture failed:', error);
        });
      }, { once: true });
    }

    return _xhrSend.apply(this, arguments);
  };
})();
