import { STRINGS } from './he.js';
import { installDismissedKey } from './storage.js';

/**
 * Register the Service Worker (`./sw.js` with `{ scope: './' }`) and manage the update toast flow.
 * Only reloads on `controllerchange` when the user explicitly clicked the update prompt,
 * preventing any interruption during initial SW installation/claim.
 */
export function initServiceWorker({ onUpdateToast }) {
  if (!('serviceWorker' in navigator)) return;

  let updateRequested = false;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested && !reloading) {
      reloading = true;
      globalThis.location.reload();
    }
  });

  const promptUpdate = waitingWorker => {
    if (!waitingWorker) return;
    onUpdateToast?.(STRINGS.swUpdateAvailable, () => {
      updateRequested = true;
      waitingWorker.postMessage('SKIP_WAITING');
    });
  };

  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(registration => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        promptUpdate(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            promptUpdate(newWorker);
          }
        });
      });
    })
    .catch(err => {
      console.warn('Service worker registration failed:', err);
    });
}

/**
 * Check if the app is currently running in standalone installed PWA mode.
 */
export function isStandaloneMode() {
  return (
    Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches) ||
    globalThis.navigator?.standalone === true
  );
}

/**
 * Detect iOS Safari (for manual Add-to-Home-Screen instructions).
 */
function isIosSafari() {
  const ua = globalThis.navigator?.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (globalThis.navigator?.platform === 'MacIntel' &&
      globalThis.navigator?.maxTouchPoints > 1);
  return isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
}

/**
 * Initialize the install hint banner on the library screen.
 */
export function initInstallBanner(bannerEl) {
  if (!bannerEl) return;

  if (isStandaloneMode()) {
    bannerEl.hidden = true;
    return;
  }

  let deferredPrompt = null;

  const isDismissed = () => {
    try {
      return (
        localStorage.getItem(installDismissedKey) === '1' ||
        localStorage.getItem('installDismissed') === '1'
      );
    } catch {
      return false;
    }
  };

  const markDismissed = () => {
    try {
      localStorage.setItem(installDismissedKey, '1');
      localStorage.setItem('installDismissed', '1');
    } catch {
      // Ignore storage errors
    }
    bannerEl.hidden = true;
  };

  const renderBanner = mode => {
    if (isDismissed() || isStandaloneMode()) {
      bannerEl.hidden = true;
      return;
    }

    if (mode === 'prompt' && deferredPrompt) {
      bannerEl.hidden = false;
      bannerEl.innerHTML = `
        <span class="install-hint-text">${STRINGS.installPromptText}</span>
        <div class="install-hint-actions">
          <button type="button" class="button tiny primary" id="install-trigger-btn">${STRINGS.installBtn}</button>
          <button type="button" class="icon tiny" id="install-dismiss-btn" aria-label="${STRINGS.dismissInstallAria}">×</button>
        </div>
      `;
      bannerEl
        .querySelector('#install-trigger-btn')
        ?.addEventListener('click', async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          try {
            await deferredPrompt.userChoice;
          } catch {
            // Ignore choice errors
          }
          deferredPrompt = null;
          bannerEl.hidden = true;
        });
      bannerEl
        .querySelector('#install-dismiss-btn')
        ?.addEventListener('click', markDismissed);
    } else if (mode === 'ios') {
      bannerEl.hidden = false;
      bannerEl.innerHTML = `
        <span class="install-hint-text">${STRINGS.installIosText}</span>
        <button type="button" class="icon tiny" id="install-dismiss-btn" aria-label="${STRINGS.dismissInstallAria}">×</button>
      `;
      bannerEl
        .querySelector('#install-dismiss-btn')
        ?.addEventListener('click', markDismissed);
    }
  };

  globalThis.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    renderBanner('prompt');
  });

  globalThis.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    bannerEl.hidden = true;
  });

  if (isIosSafari()) {
    renderBanner('ios');
  }
}

/**
 * Initialize PWA File Handling API (`launchQueue`) if supported.
 */
export function initLaunchQueue(onOpenFile) {
  if ('launchQueue' in globalThis && 'setConsumer' in globalThis.launchQueue) {
    try {
      globalThis.launchQueue.setConsumer(async launchParams => {
        if (!launchParams?.files?.length) return;
        const fileHandle = launchParams.files[0];
        if (fileHandle && typeof fileHandle.getFile === 'function') {
          const file = await fileHandle.getFile();
          if (file) onOpenFile?.(file);
        }
      });
    } catch {
      // Ignore launchQueue errors
    }
  }
}

/**
 * Initialize Fullscreen button (hidden automatically on platforms like iOS that lack Fullscreen API).
 */
export function initFullscreenControl(fullscreenBtn) {
  if (!fullscreenBtn) return;

  const isSupported = Boolean(
    document.fullscreenEnabled || document.webkitFullscreenEnabled,
  );
  if (!isSupported) {
    fullscreenBtn.hidden = true;
    return;
  }

  fullscreenBtn.hidden = false;

  const updateState = () => {
    const isFs = Boolean(
      document.fullscreenElement || document.webkitFullscreenElement,
    );
    fullscreenBtn.setAttribute(
      'aria-label',
      isFs ? STRINGS.fullscreenExit : STRINGS.fullscreenEnter,
    );
    fullscreenBtn.setAttribute('aria-pressed', isFs ? 'true' : 'false');
  };

  fullscreenBtn.addEventListener('click', async () => {
    try {
      const isFs = Boolean(
        document.fullscreenElement || document.webkitFullscreenElement,
      );
      if (isFs) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } else {
        const root = document.documentElement;
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      }
    } catch {
      // Ignore fullscreen rejection
    }
    updateState();
  });

  document.addEventListener('fullscreenchange', updateState);
  updateState();
}

/**
 * Manage Screen Wake Lock (feature-detected, re-acquired on visibilitychange).
 */
export class WakeLockController {
  #sentinel = null;
  #enabled = false;
  #activeReading = false;

  get isSupported() {
    return Boolean(
      globalThis.navigator?.wakeLock &&
        typeof globalThis.navigator.wakeLock.request === 'function',
    );
  }

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.#enabled && this.#activeReading) {
        this.#acquire();
      }
    });
  }

  setState({ enabled, activeReading }) {
    this.#enabled = Boolean(enabled);
    this.#activeReading = Boolean(activeReading);
    if (this.#enabled && this.#activeReading) {
      this.#acquire();
    } else {
      this.#release();
    }
  }

  async #acquire() {
    if (!this.isSupported || this.#sentinel) return;
    try {
      this.#sentinel = await navigator.wakeLock.request('screen');
      this.#sentinel.addEventListener('release', () => {
        this.#sentinel = null;
      });
    } catch {
      this.#sentinel = null;
    }
  }

  async #release() {
    if (!this.#sentinel) return;
    try {
      await this.#sentinel.release();
    } catch {
      // Ignore release errors
    }
    this.#sentinel = null;
  }
}
