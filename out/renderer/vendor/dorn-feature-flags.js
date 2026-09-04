"use strict";

(() => {
  const features = Object.freeze({
    accountAuthentication: false,
    accountControls: false,
    releaseState: "prepared-hidden"
  });

  Object.defineProperty(window, "__DORN_INTERNAL_FEATURES__", {
    value: features,
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
