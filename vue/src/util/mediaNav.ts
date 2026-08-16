// Finds the next playable (video or audio) entry in a file list, walking
// away from `from` in the given direction. Used by the video/audio modal's
// prev/next navigation (functionalCallableComp.tsx) to step over images and
// non-media files sitting between clips in the same folder.
//
// Images are deliberately skipped rather than handed off to: an image opens
// in Ant Design's own image-preview component, which has its own arrow-key
// navigation, and switching the video/audio modal into that component
// mid-navigation is a larger change than this helper. No wrapping - running
// off either end returns undefined, same as there being nothing left to
// step to.
import { isVideoFile, isAudioFile } from './file'

export function nextMediaIndex(files: { name: string }[], from: number, dir: 1 | -1): number | undefined {
  for (let i = from + dir; i >= 0 && i < files.length; i += dir) {
    const name = files[i].name
    if (isVideoFile(name) || isAudioFile(name)) {
      return i
    }
  }
  return undefined
}
