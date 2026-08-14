/* DESCARDED — behavioral research instrumentation (PostHog).

   Research question this taxonomy exists to answer: WHO WANTS TO CREATE?
   i.e. what draws someone from browsing DESCARDED into submitting artist
   work, vs. just joining the pre-sale — and where do would-be creators
   drop off.

   This is not generic marketing analytics. Explicitly OFF, always:
   session replay, heatmaps, autocapture, automatic form capture, rage/dead
   click detection, automatic user identification (no posthog.identify()
   is ever called — every event is anonymous).

   Never sent, by construction — no code path in this file reads these:
   email, phone, name, IP address, or any other form field value. Where a
   field matters for research (creator_type), only the field NAME or a
   fixed category value is sent, never a free-text value the visitor typed.

   Every event below was audited against two questions: does it map to a
   real, identifiable UI element/interaction, and does it inform a
   specific business decision? portfolio_link_added / social_link_added
   were removed after that audit — they fired under the exact same
   condition as field_completed(field="portfolio_url"/"social_media_url")
   and informed nothing field_completed didn't already cover. See
   docs/posthog.md's audit section for the full table.

   Full taxonomy + rationale: docs/posthog.md. If PostHog is unconfigured
   (no POSTHOG_API_KEY) or the script/network fails, every call below is a
   silent no-op — this file must never be able to break the site. */
(function () {
  'use strict';

  var POSTHOG_SCRIPT_URL = 'https://us-assets.i.posthog.com/static/array.js';
  var VISITOR_ID_KEY = 'dscAnonVisitorId';
  var SESSION_ID_KEY = 'dscSessionId';
  var FIRST_TOUCH_KEY = 'dscFirstTouch';

  // ---- anonymous identifiers (never tied to identify(), never PII) ----
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreate(storage, key) {
    try {
      var v = storage.getItem(key);
      if (!v) { v = uuid(); storage.setItem(key, v); }
      return v;
    } catch (e) { return uuid(); } // storage unavailable — degrade, don't throw
  }

  var anonymousVisitorId = getOrCreate(window.localStorage, VISITOR_ID_KEY);
  var sessionId = getOrCreate(window.sessionStorage, SESSION_ID_KEY);

  // ---- first-touch acquisition context (captured once per browser session) ----
  function captureFirstTouch() {
    try {
      var existing = sessionStorage.getItem(FIRST_TOUCH_KEY);
      if (existing) return JSON.parse(existing);
    } catch (e) { /* fall through to recompute */ }

    var params = new URLSearchParams(window.location.search);
    var touch = {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      referrer: document.referrer || null,
    };
    try { sessionStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch)); } catch (e) { /* ignore */ }
    return touch;
  }

  var firstTouch = captureFirstTouch();

  function deviceType() {
    if (window.matchMedia('(max-width: 640px)').matches) return 'mobile';
    if (window.matchMedia('(max-width: 1024px)').matches) return 'tablet';
    return 'desktop';
  }

  // ---- PostHog bootstrap ----
  var readyPromise = null;

  function loadScript() {
    return new Promise(function (resolve, reject) {
      if (window.posthog && window.posthog.__loaded) return resolve(window.posthog);
      var s = document.createElement('script');
      s.src = POSTHOG_SCRIPT_URL;
      s.async = true;
      s.onload = function () { resolve(window.posthog || null); };
      s.onerror = function () { reject(new Error('posthog script failed')); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = fetch('/api/config')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.posthogApiKey) return null;
        return loadScript().then(function (posthog) {
          if (!posthog) return null;
          posthog.init(cfg.posthogApiKey, {
            api_host: cfg.posthogHost || 'https://us.i.posthog.com',
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            disable_session_recording: true,
            enable_heatmaps: false,
            capture_dead_clicks: false,
            person_profiles: 'identified_only', // no identify() is ever called, so no person profile is ever created
          });
          posthog.register({
            anonymous_visitor_id: anonymousVisitorId,
            session_id: sessionId,
            utm_source: firstTouch.utm_source,
            utm_medium: firstTouch.utm_medium,
            utm_campaign: firstTouch.utm_campaign,
            referrer: firstTouch.referrer,
          });
          return posthog;
        });
      })
      .catch(function () { return null; });
    return readyPromise;
  }

  function track(event, props) {
    init().then(function (posthog) {
      if (!posthog) return;
      var payload = Object.assign({ device_type: deviceType() }, props || {});
      posthog.capture(event, payload);
    });
  }

  // ==================== event taxonomy ====================

  // -- home_viewed --
  var path = window.location.pathname;
  if (path === '/' || path === '/index.html') {
    track('home_viewed');
  }

  // -- artist_section_viewed: fires once when the artist submission
  //    section actually scrolls into view (artists.html only) --
  var artistFormWrap = document.querySelector('.artists-form-wrap');
  if (artistFormWrap && 'IntersectionObserver' in window) {
    var artistSeen = false;
    var artistObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !artistSeen) {
          artistSeen = true;
          track('artist_section_viewed');
          artistObserver.disconnect();
        }
      });
    }, { threshold: 0.4 });
    artistObserver.observe(artistFormWrap);
  }

  // -- presale_section_viewed: the pre-sale form only exists inside the
  //    modal, so "viewed" == the modal actually became visible. Watched
  //    via MutationObserver on the panel's `hidden` attribute rather than
  //    a click on the trigger — openPresale() only ever flips `hidden` on
  //    success, but a click is a request to open, not proof it opened, and
  //    the two must not be conflated. --
  var presalePanel = document.querySelector('[data-presale-panel]');
  if (presalePanel && 'MutationObserver' in window) {
    var presaleSeen = false;
    var presaleObserver = new MutationObserver(function () {
      if (!presalePanel.hidden && !presaleSeen) {
        presaleSeen = true;
        track('presale_section_viewed');
      }
    });
    presaleObserver.observe(presalePanel, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ==================== generic form instrumentation ====================
  // Applies identically to both forms via a `form` property so
  // form_started / field_completed / form_abandoned / form_submitted are
  // one taxonomy, not two.
  //
  // form_started fires on `input`/`change`, never `focus`: the pre-sale
  // modal calls emailInput.focus() programmatically when it opens
  // (app.js openPresale()), so a focus-based trigger would fire
  // "form_started" for every modal open even if the visitor closes it
  // immediately without typing anything. input/change only fire from an
  // actual keystroke, paste, or selection — a real user action.
  //
  // form_submitted is derived from the confirmed-success DOM state (the
  // result view becoming visible), not the raw `submit` event: app.js
  // only unhides the result view after the API call resolves successfully
  // (D1 is the authority on whether it actually persisted — see
  // functions/api/presale.js / artists.js). A `submit` event fires even
  // when client-side validation immediately rejects the attempt, which
  // would both wrongly count a rejected attempt as "submitted" and
  // suppress the "form_abandoned" event that attempt should produce if
  // the visitor then leaves without ever succeeding.

  function instrumentForm(formEl, formName, opts) {
    if (!formEl) return;
    opts = opts || {};
    var started = false;
    var submitted = false;
    var completedFields = {};

    function fieldsToWatch() {
      return Array.prototype.filter.call(formEl.elements, function (el) {
        return el.name && el.name !== 'company'; // never instrument the honeypot
      });
    }

    function onFirstInteraction() {
      if (started) return;
      started = true;
      track('form_started', { form: formName });
    }

    fieldsToWatch().forEach(function (el) {
      el.addEventListener('input', onFirstInteraction);
      el.addEventListener('change', onFirstInteraction);

      el.addEventListener('blur', function () {
        var hasValue = String(el.value || '').trim() !== '';
        if (hasValue && !completedFields[el.name]) {
          completedFields[el.name] = true;
          track('field_completed', { form: formName, field: el.name });
        }
      });

      if (el.tagName === 'SELECT' && opts.selectEvents && opts.selectEvents[el.name]) {
        el.addEventListener('change', function () {
          if (!el.value) return;
          track(opts.selectEvents[el.name], { form: formName, value: el.value });
        });
      }
    });

    function maybeTrackAbandon() {
      if (started && !submitted) {
        track('form_abandoned', { form: formName });
        started = false; // avoid double-firing if both handlers run
      }
    }

    if (opts.resultView && 'MutationObserver' in window) {
      var resultObserver = new MutationObserver(function () {
        if (!opts.resultView.hidden && !submitted) {
          submitted = true;
          track('form_submitted', { form: formName });
        }
      });
      resultObserver.observe(opts.resultView, { attributes: true, attributeFilter: ['hidden'] });
    }

    window.addEventListener('pagehide', maybeTrackAbandon);
    if (opts.onClose) opts.onClose(maybeTrackAbandon);
  }

  var presaleForm = document.querySelector('[data-presale-form]');
  instrumentForm(presaleForm, 'presale', {
    resultView: document.querySelector('[data-presale-result-view]'),
    onClose: function (maybeTrackAbandon) {
      document.querySelectorAll('[data-close-presale]').forEach(function (el) {
        el.addEventListener('click', maybeTrackAbandon);
      });
      var backdrop = document.querySelector('[data-presale-backdrop]');
      if (backdrop) backdrop.addEventListener('click', maybeTrackAbandon);
    },
  });

  var artistForm = document.querySelector('[data-artist-form]');
  instrumentForm(artistForm, 'artist', {
    resultView: document.querySelector('[data-artist-result-view]'),
    selectEvents: { creator_type: 'creator_type_selected' },
  });
})();
