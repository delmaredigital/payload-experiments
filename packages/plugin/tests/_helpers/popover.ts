import { beforeEach } from 'vitest'

/** jsdom has the UA rule hiding closed popovers, but no top-layer API. Model
 * visibility for interaction tests; real clipping/painting still needs a browser.
 */
beforeEach(() => {
  HTMLElement.prototype.showPopover = function () { this.style.display = 'block' }
  HTMLElement.prototype.hidePopover = function () { this.style.display = 'none' }
})
