import { useGlobalStore } from '@/store/useGlobalStore'

/**
 * Pause every playing <video> in the document, unless the user turned the
 * behaviour off.
 *
 * Shared rather than inlined at each call site, and that is the whole reason
 * this file exists. Sending a file to Wan2GP is implemented in FOUR places -
 * three cases in useFileItemActions (settings, start image, start image with
 * prompt) and a standalone button in the preview popup
 * (functionalCallableComp) that builds its own BroadcastChannel. Each one that
 * grew its own copy of the pause grew its own chance to be forgotten, and two
 * of them were: first the "with prompt" case, then the popup button - which is
 * the one that mattered most, since the popup is the ONLY place a video
 * actually plays. A thumbnail is an <img>.
 *
 * Document-wide rather than targeted: the playing video may be in the preview
 * popup, the Tiktok-style viewer, or a modal. Pausing an already-paused video
 * is a no-op, so over-reaching costs nothing and under-reaching is the bug.
 */
export const pauseVideosOnSendToWan2gp = () => {
  // Read the store per call, not at module scope: this module is imported
  // during app setup, before pinia is guaranteed to be installed.
  if (!useGlobalStore().pauseVideoOnSendToWan2gp) {
    return
  }
  document.querySelectorAll('video').forEach((video) => {
    if (!video.paused) {
      video.pause()
    }
  })
}
