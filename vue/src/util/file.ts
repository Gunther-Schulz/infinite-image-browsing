import type { FileNodeInfo } from '@/api/files'
import { apiBase } from '@/api'
import { uniqBy } from 'lodash-es'
import { isTauri } from './env'

// encodeURIComponent leaves the apostrophe alone - it is an unreserved mark in
// RFC 2396 - and that is fine for a URL but NOT for a URL pasted into a CSS
// string. FileItem renders the video cover as `background-image: url('...')`,
// single-quoted, so one apostrophe in a filename closes the string early, the
// whole declaration becomes invalid, and the computed background-image is
// `none`. On a RECYCLED tile that leaves the previous tile's picture painted,
// which is why the same bug shows up as both a missing thumbnail and, worse, as
// one video's thumbnail on another video's tile.
//
// Measured 2026-08-17 in the running gallery: of 67 video tiles, exactly the 4
// whose filenames contain an apostrophe had no background-image, and all 63
// without one rendered. Wan2GP names output files after the prompt, so "She's"
// in a prompt is enough.
//
// Encoding it here rather than escaping at the one call site: %27 is a valid
// URL escape the server decodes back, so every consumer stays correct, and the
// next `url('...')` written elsewhere cannot reintroduce this.
const encode = (value: string) => encodeURIComponent(value).replace(/'/g, '%27')
export const toRawFileUrl = (file: FileNodeInfo, download = false) =>
  `${apiBase.value}/file?path=${encode(file.fullpath)}&t=${encode(file.date)}${download ? `&disposition=${encode(file.name)}` : ''
  }`

export const toImageUrl = (file: FileNodeInfo) => {
  return `${apiBase.value}/img/${encode(file.name)}?path=${encode(file.fullpath)}&t=${encode(file.date)}`
}

export const toImageThumbnailUrl = (file: FileNodeInfo, size: string = '512x512') => {
  return `${apiBase.value}/image-thumbnail?path=${encode(file.fullpath)}&size=${size}&t=${encode(
    file.date
  )}`
}

export const toStreamVideoUrl = (file: FileNodeInfo) =>
  `${apiBase.value}/stream_video?path=${encode(file.fullpath)}`

export const toVideoCoverUrl = (file: FileNodeInfo) =>
  (isTauri ? '' : parent.document.location.origin) + `${apiBase.value}/video_cover?path=${encode(file.fullpath)}&mt=${encode(file.date)}`

export type FileTransferData = {
  path: string[]
  loc: string
  includeDir: boolean
  nodes: FileNodeInfo[]
  __id: 'FileTransferData'
}

export const isFileTransferData = (v: any): v is FileTransferData =>
  typeof v === 'object' && v.__id === 'FileTransferData'

export const getFileTransferDataFromDragEvent = (e: DragEvent) => {
  const data = JSON.parse(e.dataTransfer?.getData('text') ?? '{}')
  return isFileTransferData(data) ? data : null
}

export const uniqueFile = (files: FileNodeInfo[]) => uniqBy(files, 'fullpath')

export function isImageFile (filename: string): boolean {
  if (typeof filename !== 'string') {
    return false
  }
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.avif', '.jpe']
  const extension = filename.split('.').pop()?.toLowerCase()
  return extension !== undefined && exts.includes(`.${extension}`)
}

export function isVideoFile (filename: string): boolean {
  if (typeof filename !== 'string') {
    return false
  }
  const exts = ['.mp4', '.m4v', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.ts',  '.webm']
  const extension = filename.split('.').pop()?.toLowerCase()
  return extension !== undefined && exts.includes(`.${extension}`)
}

export function isAudioFile (filename: string): boolean {
  if (typeof filename !== 'string') {
    return false
  }
  const exts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']
  const extension = filename.split('.').pop()?.toLowerCase()
  return extension !== undefined && exts.includes(`.${extension}`)
}

export const toStreamAudioUrl = (file: FileNodeInfo) =>
  `${apiBase.value}/stream_video?path=${encode(file.fullpath)}`

export const isMediaFile = (file: string) => isImageFile(file) || isVideoFile(file) || isAudioFile(file)

export function downloadFiles (urls: string[]) {
  urls.forEach((url, index) => {
    try { 
      const urlObject = new URL(url, 'https://github.com/zanllp/sd-webui-infinite-image-browsing')
      let filename = ''
      const disposition = urlObject.searchParams.get('disposition')
      if (disposition) {
        filename = decodeURIComponent(disposition)
      }
      
      const link = document.createElement('a')
      link.style.display = 'none'
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      
      // Add small delay between downloads to avoid browser blocking
      setTimeout(() => {
        link.click()
        // Clean up after a short delay
        setTimeout(() => {
          document.body.removeChild(link)
        }, 100)
      }, index * 100)
    } catch (error) {
      console.error(`Failed to download file from URL: ${url}`, error)
    }
  })
}

export const downloadFileInfoJSON = (files: FileNodeInfo[], name?: string) => {
  const url = window.URL.createObjectURL(new Blob([JSON.stringify({
    files
  }, null, 4)]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `iib_imginfo_${name ?? new Date().toLocaleString()}.json`)
  document.body.appendChild(link)
  link.click()
}