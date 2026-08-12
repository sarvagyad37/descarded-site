/* DESCARDED — shared behavior. No build step, no dependencies.
   Talks to /api/* (Cloudflare Pages Functions in functions/api/), which
   persist to Google Sheets server-side. There is no local/demo fallback —
   if the API is unreachable or rejects the request, the UI shows a real
   failure state. Never tell the user they're in unless persistence
   actually confirmed it. */

(function () {
  'use strict';

  var API_BASE = '/api';
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  var UNREACHABLE_ERROR = "COULDN'T REACH THE SERVER. CHECK YOUR CONNECTION AND TRY AGAIN.";

  function isEmail(v) { return EMAIL_RE.test(String(v || '').trim()); }

  var URL_RE = /^\S+\.\S{2,}$/; // loose: no whitespace, has a dot with 2+ chars after — matches server-side check
  function looksLikeUrl(v) { return URL_RE.test(String(v || '').trim()); }

  async function post(path, body) {
    var res;
    try {
      res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return { ok: false, error: UNREACHABLE_ERROR };
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      return { ok: false, error: data.error || 'SOMETHING WENT WRONG. TRY AGAIN.', code: data.code };
    }
    return Object.assign({ ok: true }, data);
  }

  /* ── Attribution: captured once per browser session (first touch wins),
     read back in at submit time. Falls back to blank fields — never
     blocks or fails a submission — if sessionStorage is unavailable
     (e.g. private-browsing edge cases). Only fields with a column in the
     Presale sheet are captured — no document.referrer/landing_page here,
     the schema doesn't have a place for them. */
  var ATTRIBUTION_KEY = 'dscAttribution';

  function readAttribution() {
    try {
      var raw = sessionStorage.getItem(ATTRIBUTION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* sessionStorage unavailable — fall through */ }

    var params = new URLSearchParams(location.search);
    var attribution = {
      source: params.get('utm_source') || '',
      campaign: params.get('utm_campaign') || '',
      medium: params.get('utm_medium') || '',
      term: params.get('utm_term') || '',
      content: params.get('utm_content') || '',
      referred_by: params.get('ref') || ''
    };
    try { sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution)); } catch (e) { /* ignore */ }
    return attribution;
  }

  var attribution = readAttribution();

  /* ── Mobile menu ── */
  var menuToggle = document.querySelector('[data-menu-toggle]');
  var mobileMenu = document.querySelector('[data-mobile-menu]');
  function setMenu(open) {
    if (!menuToggle || !mobileMenu) return;
    mobileMenu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', function () {
      setMenu(mobileMenu.hidden);
    });
    mobileMenu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
  }

  /* ── Presale modal (present on every page) ── */
  var backdrop = document.querySelector('[data-presale-backdrop]');
  var panel = document.querySelector('[data-presale-panel]');
  var openTriggers = document.querySelectorAll('[data-open-presale]');
  var closeTriggers = document.querySelectorAll('[data-close-presale]');
  var formView = document.querySelector('[data-presale-form-view]');
  var resultView = document.querySelector('[data-presale-result-view]');
  var form = document.querySelector('[data-presale-form]');
  var emailInput = document.querySelector('[data-presale-email]');
  var phoneInput = document.querySelector('[data-presale-phone]');
  var smsConsentInput = document.querySelector('[data-presale-sms-consent]');
  var honeypot = document.querySelector('[data-presale-honeypot]');
  var submitBtn = document.querySelector('[data-presale-submit]');
  var status = document.querySelector('[data-presale-status]');
  var fieldError = document.querySelector('[data-presale-field-error]');
  var resultHeadline = document.querySelector('[data-presale-result-headline]');
  var resultBody = document.querySelector('[data-presale-result-body]');

  function openPresale(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!backdrop || !panel) return;
    backdrop.hidden = false;
    panel.hidden = false;
    setMenu(false);
    if (formView) formView.hidden = false;
    if (resultView) resultView.hidden = true;
    if (form) form.reset();
    if (emailInput) emailInput.focus();
    clearFieldError();
  }

  function closePresale() {
    if (!backdrop || !panel) return;
    backdrop.hidden = true;
    panel.hidden = true;
  }

  function clearFieldError() {
    if (!fieldError) return;
    fieldError.hidden = true;
    fieldError.textContent = '';
  }

  function showFieldError(msg) {
    if (!fieldError) return;
    fieldError.hidden = false;
    fieldError.textContent = msg;
  }

  openTriggers.forEach(function (el) { el.addEventListener('click', openPresale); });
  closeTriggers.forEach(function (el) { el.addEventListener('click', closePresale); });
  if (backdrop) backdrop.addEventListener('click', closePresale);
  if (panel) panel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePresale(); setMenu(false); }
  });

  if (emailInput) {
    emailInput.addEventListener('input', function () {
      clearFieldError();
      if (submitBtn) submitBtn.textContent = 'JOIN';
    });
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (honeypot && honeypot.value) return; // spam trap — silently drop
      var email = (emailInput && emailInput.value || '').trim();
      if (!isEmail(email)) {
        showFieldError("THAT EMAIL DOESN'T LOOK RIGHT. CHECK IT AND TRY AGAIN.");
        return;
      }
      var phone = (phoneInput && phoneInput.value || '').trim();
      var smsConsent = !!(smsConsentInput && smsConsentInput.checked);
      if (smsConsent && !phone) {
        showFieldError('ADD A PHONE NUMBER TO GET TEXT UPDATES.');
        return;
      }
      clearFieldError();
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'JOINING…'; }
      if (status) { status.hidden = false; status.textContent = 'JOINING…'; }

      var formData = new FormData(form);
      var r = await post('/presale', {
        email: email,
        first_name: String(formData.get('first_name') || '').trim(),
        last_name: String(formData.get('last_name') || '').trim(),
        phone: phone,
        sms_consent: smsConsent,
        source: attribution.source,
        campaign: attribution.campaign,
        medium: attribution.medium,
        term: attribution.term,
        content: attribution.content,
        referred_by: attribution.referred_by
      });

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'JOIN'; }
      if (status) status.hidden = true;

      if (r.ok === false) {
        showFieldError(r.error || "COULDN'T JOIN. NOTHING WAS SUBMITTED. CHECK THE EMAIL AND TRY AGAIN.");
        if (submitBtn) submitBtn.textContent = 'TRY AGAIN';
        return;
      }

      var already = r.code === 'already';
      showResult(already);
    });
  }

  function showResult(already) {
    if (formView) formView.hidden = true;
    if (resultView) resultView.hidden = false;
    if (resultHeadline) resultHeadline.textContent = already ? "YOU'RE ALREADY IN." : "YOU'RE IN.";
    if (resultBody) resultBody.textContent = "WE'LL SEND THE VENUE + FIRST TICKET RELEASE HERE.";
  }

  /* ── Artist submission form (artists.html only) ── */
  var artistForm = document.querySelector('[data-artist-form]');
  if (artistForm) {
    var aSubmit = document.querySelector('[data-artist-submit]');
    var aError = document.querySelector('[data-artist-error]');
    var aFormView = document.querySelector('[data-artist-form-view]');
    var aResultView = document.querySelector('[data-artist-result-view]');
    var aRefEl = document.querySelector('[data-artist-ref]');
    var aResetBtn = document.querySelector('[data-artist-reset]');
    var aHoneypot = document.querySelector('[data-artist-honeypot]');

    function setArtistError(msg) {
      if (!aError) return;
      if (msg) { aError.hidden = false; aError.textContent = msg; }
      else { aError.hidden = true; aError.textContent = ''; }
    }

    artistForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (aHoneypot && aHoneypot.value) return;

      var data = new FormData(artistForm);
      var artistName = String(data.get('artist_name') || '').trim();
      var email = String(data.get('email') || '').trim();
      var genre = String(data.get('genre') || '').trim();
      var phone = String(data.get('phone') || '').trim();
      var portfolioUrl = String(data.get('portfolio_url') || '').trim();
      var socialMediaUrl = String(data.get('social_media_url') || '').trim();

      if (!artistName) return setArtistError('ADD A NAME OR ALIAS.');
      if (!isEmail(email)) return setArtistError("THAT EMAIL DOESN'T LOOK RIGHT.");
      if (!genre) return setArtistError('ADD A GENRE.');
      if (!looksLikeUrl(portfolioUrl)) return setArtistError('ADD A VALID PORTFOLIO LINK.');
      if (socialMediaUrl && !looksLikeUrl(socialMediaUrl)) return setArtistError("THAT SOCIAL LINK DOESN'T LOOK RIGHT.");

      setArtistError(null);
      if (aSubmit) { aSubmit.disabled = true; aSubmit.textContent = 'SENDING…'; }

      var r = await post('/artists', {
        artist_name: artistName,
        email: email,
        genre: genre,
        phone: phone,
        portfolio_url: portfolioUrl,
        social_media_url: socialMediaUrl
      });

      if (aSubmit) { aSubmit.disabled = false; aSubmit.textContent = 'SEND SUBMISSION'; }

      if (r.ok === false || !r.ref) {
        // A ref is only ever fabricated server-side after persistence
        // succeeds — if it's missing here, don't invent one client-side.
        setArtistError(r.error || 'SOMETHING WENT WRONG. TRY AGAIN.');
        return;
      }

      if (aRefEl) aRefEl.textContent = 'REF ' + r.ref;
      if (aFormView) aFormView.hidden = true;
      if (aResultView) aResultView.hidden = false;
    });

    if (aResetBtn) {
      aResetBtn.addEventListener('click', function () {
        artistForm.reset();
        setArtistError(null);
        if (aFormView) aFormView.hidden = false;
        if (aResultView) aResultView.hidden = true;
      });
    }
  }
})();
