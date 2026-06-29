'use strict';
const OTPModule = (() => {
  let _config = { digits: 4, onSuccess: null, onResend: null, target: '', kind: 'login', containerId: 'otp-mount' };
  let _digits = []; let _status = 'idle'; let _timerRef = null; let _timerSecs = 59; let _sending = false;

  function build(config = {}) {
    Object.assign(_config, config);
    _digits = new Array(_config.digits).fill(''); _status = 'idle';
    const mount = document.getElementById(_config.containerId);
    if (!mount) { console.error('[OTP] mount not found:', _config.containerId); return; }
    mount.innerHTML = `
      <div class="otp-page-wrapper" id="otp-page-wrapper">
        <div class="otp-container" id="otp-card">
          <div class="otp-drag-handle"></div>
          <div class="otp-header">
            <div class="otp-header-text show" id="otp-header-text">
              <h1 id="otp-title">Verify your ${_config.kind === 'email_verify' ? 'email' : 'number'}</h1>
              <p id="otp-subtitle">We've sent a ${_config.digits}-digit code to<br><strong>${_config.target}</strong><br>It'll auto-verify once entered.</p>
            </div>
          </div>
          <div class="otp-inputs-row ${_config.digits === 6 ? 'otp-6' : ''}" id="otp-inputs-row">
            ${Array.from({ length: _config.digits }, (_, i) => `
              <div class="otp-box-wrap" id="otp-wrap-${i}">
                <input type="text" inputmode="numeric" maxlength="1" class="otp-digit-input" id="otp-digit-${i}" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" data-index="${i}" />
                ${i === 0 ? `<svg viewBox="0 0 24 24" fill="none" class="otp-tick-svg" id="otp-tick"><path d="M5 13l4 4L19 7" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="otp-tick-path" /></svg>` : ''}
              </div>`).join('')}
          </div>
          <div class="otp-verified-badge" id="otp-verified-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>Verified</div>
          <div class="otp-footer-row"><span>Didn't receive the code?</span><button type="button" id="otp-resend-btn" onclick="OTPModule.resend()">Resend</button></div>
          <div class="otp-timer" id="otp-timer"></div>
        </div>
      </div>`;
    _bindEvents(); _startTimer();
    setTimeout(() => document.getElementById('otp-digit-0')?.focus(), 100);
  }

  function _bindEvents() {
    for (let i = 0; i < _config.digits; i++) {
      const input = document.getElementById(`otp-digit-${i}`); if (!input) continue;
      input.addEventListener('input', e => _handleInput(i, e));
      input.addEventListener('keydown', e => _handleKeyDown(i, e));
      input.addEventListener('focus', () => input.select());
    }
    document.getElementById('otp-inputs-row')?.addEventListener('paste', _handlePaste);
  }

  function _handleInput(index, e) {
    if (_status !== 'idle') return;
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) { _digits[index] = ''; _render(); return; }
    if (raw.length > 1) { _pasteDigits(raw.split('').slice(0, _config.digits)); return; }
    _digits[index] = raw; _render();
    if (raw && index < _config.digits - 1) document.getElementById(`otp-digit-${index + 1}`)?.focus();
    if (_digits.every(d => d !== '')) _onComplete();
  }

  function _handleKeyDown(index, e) {
    if (_status !== 'idle') return;
    if (e.key === 'Backspace') {
      if (_digits[index]) { _digits[index] = ''; _render(); }
      else if (index > 0) { _digits[index - 1] = ''; _render(); document.getElementById(`otp-digit-${index - 1}`)?.focus(); }
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' && index > 0) document.getElementById(`otp-digit-${index - 1}`)?.focus();
    if (e.key === 'ArrowRight' && index < _config.digits - 1) document.getElementById(`otp-digit-${index + 1}`)?.focus();
  }

  function _handlePaste(e) {
    if (_status !== 'idle') return;
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, _config.digits);
    _pasteDigits(text.split(''));
  }

  function _pasteDigits(chars) {
    chars.forEach((ch, i) => { if (i < _config.digits) _digits[i] = ch; });
    _render();
    document.getElementById(`otp-digit-${Math.min(chars.length, _config.digits - 1)}`)?.focus();
    if (_digits.every(d => d !== '')) _onComplete();
  }

  function _render() { _digits.forEach((d, i) => { const input = document.getElementById(`otp-digit-${i}`); if (input && input.value !== d) input.value = d; }); }

  function _onComplete() {
    _status = 'success';
    for (let i = 0; i < _config.digits; i++) document.getElementById(`otp-digit-${i}`)?.blur();
    document.getElementById('otp-card')?.classList.add('is-complete');
    setTimeout(() => {
      const title = document.getElementById('otp-title'); const subtitle = document.getElementById('otp-subtitle'); const text = document.getElementById('otp-header-text');
      if (text) text.classList.replace('show', 'hide');
      setTimeout(() => {
        if (title) title.textContent = 'Verified successfully';
        if (subtitle) subtitle.textContent = 'Your identity has been confirmed.';
        if (text) text.classList.replace('hide', 'show');
      }, 300);
    }, 1500);
    const otp = _digits.join('');
    if (_config.onSuccess) setTimeout(() => _config.onSuccess(otp), 2100);
  }

  function showError(msg = 'Invalid code. Try again.') {
    _status = 'error';
    const row = document.getElementById('otp-inputs-row');
    if (row) { row.classList.add('error', 'shake'); setTimeout(() => { row.classList.remove('shake', 'error'); _reset(); }, 1200); }
    if (typeof Toast !== 'undefined') Toast.error(msg);
  }

  function _reset() {
    _digits = new Array(_config.digits).fill(''); _status = 'idle'; _render();
    document.getElementById('otp-card')?.classList.remove('is-complete');
    document.getElementById('otp-digit-0')?.focus();
  }

  function _startTimer() {
    _timerSecs = 59;
    const timerEl = document.getElementById('otp-timer'); const resendBtn = document.getElementById('otp-resend-btn');
    if (resendBtn) resendBtn.disabled = true;
    if (_timerRef) clearInterval(_timerRef);
    _timerRef = setInterval(() => {
      _timerSecs--;
      if (timerEl) timerEl.textContent = `Resend available in ${_timerSecs}s`;
      if (_timerSecs <= 0) { clearInterval(_timerRef); if (timerEl) timerEl.textContent = ''; if (resendBtn) resendBtn.disabled = false; }
    }, 1000);
  }

  async function resend() {
    if (_sending) return;
    _sending = true; _reset(); _startTimer();
    try {
      const payload = _config.target.includes('@') ? { email: _config.target, kind: _config.kind } : { phone: _config.target, kind: _config.kind };
      const r = await API.post('/auth/otp/send', payload);
      if (typeof Toast !== 'undefined') r.success ? Toast.success('OTP resent!') : Toast.error(r.error || 'Could not resend OTP');
    } catch (e) { if (typeof Toast !== 'undefined') Toast.error(e.message || 'Network error'); }
    finally { _sending = false; }
    if (_config.onResend) _config.onResend();
  }

  function mountPage(opts = {}) {
    const el = document.getElementById('app-content') || document.getElementById('otp-mount');
    if (!el) return;
    el.innerHTML = `<div id="otp-mount"></div>`;
    build({ containerId: 'otp-mount', digits: opts.digits || 6, target: opts.target || '', kind: opts.kind || 'login', onSuccess: opts.onSuccess, onResend: opts.onResend });
  }

  return { build, mountPage, showError, resend };
})();
