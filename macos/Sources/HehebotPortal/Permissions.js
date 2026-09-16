// Independent defense-in-depth capability removal, injected in every frame at document start.
// OS enforcement still requires the reviewed App Sandbox entitlements; this is not a bridge.
(() => {
  'use strict';
  const hide = (object, key) => {
    if (!object) return;
    try { Object.defineProperty(object, key, { value: undefined, writable: false, configurable: false }); }
    catch { /* WebKit may already expose a non-configurable unavailable capability. */ }
  };
  for (const key of ['geolocation', 'mediaDevices', 'getUserMedia', 'webkitGetUserMedia',
    'clipboard', 'requestMIDIAccess', 'usb', 'serial', 'bluetooth', 'hid', 'xr', 'credentials']) {
    hide(Object.getPrototypeOf(navigator), key);
    hide(navigator, key);
  }
  for (const key of ['Notification', 'PushManager', 'DeviceMotionEvent', 'DeviceOrientationEvent',
    'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) hide(globalThis, key);
})();
