import { pauseAllVideos } from './pauseVideosOnSend'

/**
 * Pause playing videos when the host page hides this gallery.
 *
 * WHY THE HOST HAS TO TELL US. When the gallery runs as an iframe inside
 * Wan2GP, switching to another Gradio tab hides the frame with CSS. That is
 * invisible from in here: a document inside a `display:none` iframe still
 * reports `visibilityState === 'visible'` and fires no `visibilitychange`, so
 * nothing in this document can observe the switch. The parent can - it owns
 * the element - and the iib-bridge plugin posts on the shared bus when the
 * frame stops intersecting.
 *
 * `visibilitychange` is still worth listening to, and covers the case the host
 * cannot: the whole BROWSER tab being hidden or the window minimised, where
 * the frame keeps intersecting and the host observer stays silent. The two
 * signals are disjoint, which is why both are here.
 *
 * Ungated, unlike pauseVideosOnSendToWan2gp: that setting is about not losing
 * your place when you send a file somewhere, a send being a thing you did on
 * purpose to one file. Leaving the tab is not - a video left playing to an
 * empty room is audio in a room nobody is in - so there is no toggle to get
 * this wrong. Pausing an already-paused video is a no-op.
 */
export const HOST_HIDDEN_EVENT = 'wan2gp_host_hidden'

export const listenForHostHide = (busName = 'iib-image-transfer-bus') => {
  // Its own channel object rather than importing the one in
  // page/fileTransfer/hooks: that module pulls the whole file-transfer graph
  // in, and this runs at app setup. Several BroadcastChannel objects on one
  // name in one context is the normal way to use the API.
  const bus = new BroadcastChannel(busName)
  bus.onmessage = (ev) => {
    if (ev?.data?.event === HOST_HIDDEN_EVENT) {
      pauseAllVideos()
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseAllVideos()
    }
  })
}
