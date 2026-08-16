import { Button, Input, Modal, message, Spin } from 'ant-design-vue'
import { StyleValue, ref } from 'vue'
import * as Path from '@/util/path'
import { FileNodeInfo, mkdirs } from '@/api/files'
import { setTargetFrameAsCover, getImageGenerationInfo } from '@/api'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { t } from '@/i18n'
import { downloadFiles, globalEvents, toRawFileUrl, toStreamVideoUrl, toStreamAudioUrl } from '@/util'
import { DownloadOutlined, FileTextOutlined, EditOutlined, LeftOutlined, RightOutlined } from '@/icon'
import { isStandalone } from '@/util/env'
import { addCustomTag, getDbBasicInfo, rebuildImageIndex, renameFile } from '@/api/db'
import { useTagStore } from '@/store/useTagStore'
import { useGlobalStore } from '@/store/useGlobalStore'
import { base64ToFile, video2base64 } from '@/util/video'
import { closeImageFullscreenPreview } from '@/util/imagePreviewOperation'
import { pairLoras, LoraRow } from '@/util/loras'

export const openCreateFlodersModal = (base: string) => {
  const floderName = ref('')
  return new Promise<void>((resolve) => {
    Modal.confirm({
      title: t('inputFolderName'),
      content: () => <Input v-model:value={floderName.value} />,
      async onOk() {
        if (!floderName.value) {
          return
        }
        const dest = Path.join(base, floderName.value)
        await mkdirs(dest)
        resolve()
      }
    })
  })
}

export const MultiSelectTips = () => (
  <p
    style={{
      background: 'var(--zp-secondary-background)',
      padding: '8px',
      borderLeft: '4px solid var(--primary-color)'
    }}
  >
    Tips: {t('multiSelectTips')}
  </p>
)

// Prev/next navigation handed to the modal by whichever grid opened it (see
// FileItem's `siblings` prop). `idx` is the currently-open file's position
// in that grid's list; `at` looks up the neighbour in a direction, skipping
// non-media entries (nextMediaIndex, @/util/mediaNav), and returns undefined
// at either end.
export interface MediaNav {
  idx: number
  at: (from: number, dir: 1 | -1) => { file: FileNodeInfo; idx: number } | undefined
}

// 合并的视频/音频 modal 实现
const openMediaModalImpl = (
  file: FileNodeInfo,
  onTagClick?: (id: string| number) => void,
  onTiktokView?: () => void,
  mediaType: 'video' | 'audio' = 'video',
  nav?: MediaNav,
  // Set when the operator clicked the PLAY BADGE rather than the thumbnail.
  // The badge means play, so it plays whatever the autoplay setting says;
  // clicking anywhere else on the cell follows the setting. That is what
  // makes the badge worth showing on every video: it is an affordance with
  // its own meaning, not decoration that has to be hidden when the setting
  // is off.
  forcePlay = false
) => {
  const tagStore = useTagStore()
  const global = useGlobalStore()
  const isSelected = (id: string | number) => {
    return !!tagStore.tagMap.get(file.fullpath)?.some(v => v.id === id)
  }
  const videoRef = ref<HTMLVideoElement | null>(null)
  const imageGenInfo = ref('')
  const promptLoading = ref(false)
  const showAllMeta = ref(false)

  // 加载提示词
  const loadPrompt = async () => {
    promptLoading.value = true
    try {
      const info = await getImageGenerationInfo(file.fullpath)
      imageGenInfo.value = info
    } catch (error) {
      console.error('Load prompt error:', error)
      imageGenInfo.value = ''
    } finally {
      promptLoading.value = false
    }
  }

  const tagBaseStyle: StyleValue = {
    margin: '2px',
    padding: '2px 16px',
    'border-radius': '4px',
    display: 'inline-block',
    cursor: 'pointer',
    'font-weight': 'bold',
    transition: '.5s all ease',
    'user-select': 'none',
  }

  // 解析提示词结构
  const geninfoStruct = () => parse(imageGenInfo.value)

  interface MetaSections {
    generation: [string, string][]
    loras: LoraRow[]
    lsetName: string
    timing: [string, string][]
    rest: [string, string][]
  }

  // Which model made the clip, and how it was sampled - the fields you
  // change between attempts.
  const GENERATION_KEYS = [
    'type', 'model_type', 'base_model_type', 'model_filename', 'model_mode',
    'seed', 'steps', 'num_inference_steps', 'guidance_scale',
    'guidance2_scale', 'guidance3_scale', 'guidance_phases',
    'switch_threshold', 'switch_threshold2', 'flow_shift', 'sample_solver',
    'denoising_strength', 'NAG_scale', 'NAG_tau', 'NAG_alpha',
    'resolution', 'size', 'video_length', 'fps', 'num_frames', 'batch_size',
  ]
  // Provenance - useful, rarely the thing you came for.
  const TIMING_KEYS = ['generation_time', 'creation_date', 'settings_version', 'video_quality']
  // Consumed by the LoRAs section below, never shown as raw rows.
  // activated_loras and loras_multipliers become the paired table (pairLoras);
  // lset_name is the name of the LoRA SET those came from, so it belongs
  // beside them rather than alphabetically among the housekeeping fields -
  // it answers "which preset was this" about the very rows underneath it.
  const LORA_KEYS = new Set(['activated_loras', 'loras_multipliers', 'lset_name'])

  // The meta block's rows, split into named sections instead of one flat
  // table: which model & how it was sampled (Generation), LoRAs paired name
  // to multiplier (its own table - see pairLoras, @/util/loras), timing /
  // provenance (Timing), and everything else, alphabetical, collapsed behind
  // a toggle so the panel isn't buried in housekeeping fields nobody asked
  // for.
  //
  // Two things this still has to get right that a plain key/value dump did
  // not. extraJsonMetaInfo is an OBJECT - the parser hands back the
  // generator's full payload under that one key - so printing it directly
  // gives "[object Object]" and hides everything in it; its entries are
  // flattened in instead, which is the point of keeping it. And empty
  // values are dropped: a row reading "Resources:" with nothing after it is
  // the whole reason this panel looked broken rather than sparse.
  const metaSections = (): MetaSections => {
    const skip = new Set(['prompt', 'negativePrompt', 'extraJsonMetaInfo'])
    const seen = new Set<string>()

    const push = (bucket: [string, string][], key: string, value: unknown) => {
      if (value === null || value === undefined) return
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
      if (!text.trim() || text === '{}' || text === '[]') return
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      if (seen.has(label.toLowerCase())) return
      seen.add(label.toLowerCase())
      bucket.push([label, text])
    }

    const struct = geninfoStruct() as Record<string, unknown>
    const collected: [string, unknown][] = []
    for (const [key, value] of Object.entries(struct)) {
      if (skip.has(key)) continue
      collected.push([key, value])
    }
    const extra = struct.extraJsonMetaInfo
    if (extra && typeof extra === 'object') {
      for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
        if (key === 'prompt' || key === 'negative_prompt') continue
        collected.push([key, value])
      }
    }

    // First occurrence wins - top-level keys are collected before the
    // flattened extraJsonMetaInfo entries, so a name present in both keeps
    // its top-level value, same as the old single-pass push order did.
    const byKey = new Map<string, unknown>()
    for (const [key, value] of collected) {
      if (!byKey.has(key)) byKey.set(key, value)
    }

    const generation: [string, string][] = []
    for (const key of GENERATION_KEYS) {
      if (byKey.has(key)) push(generation, key, byKey.get(key))
    }

    const loras = pairLoras(byKey.get('activated_loras'), byKey.get('loras_multipliers'))

    const timing: [string, string][] = []
    for (const key of TIMING_KEYS) {
      if (byKey.has(key)) push(timing, key, byKey.get(key))
    }

    // Everything not claimed by a named section above. Arrival order would
    // be arbitrary to the reader, and this is where the forty fields nobody
    // named end up - alphabetical at least makes one findable by name.
    const claimed = new Set<string>([...GENERATION_KEYS, ...TIMING_KEYS, ...LORA_KEYS])
    const restKeys = [...byKey.keys()].filter(k => !claimed.has(k)).sort((a, b) => a.localeCompare(b))
    const rest: [string, string][] = []
    for (const key of restKeys) push(rest, key, byKey.get(key))

    const rawLset = byKey.get('lset_name')
    const lsetName = typeof rawLset === 'string' ? rawLset.trim() : ''

    return { generation, loras, lsetName, timing, rest }
  }

  // 计算文本长度（中文算3个字符）
  const getTextLength = (text: string): number => {
    let length = 0
    for (const char of text) {
      if (/[\u4e00-\u9fa5]/.test(char)) {
        length += 3
      } else {
        length += 1
      }
    }
    return length
  }

  // 判断是否为 tag 风格的提示词
  const isTagStylePrompt = (tags: string[]): boolean => {
    if (tags.length === 0) return false

    let totalLength = 0
    for (const tag of tags) {
      const tagLength = getTextLength(tag)
      totalLength += tagLength

      if (tagLength > 50) {
        return false
      }
    }

    const avgLength = totalLength / tags.length
    if (avgLength > 30) {
      return false
    }

    return true
  }

  // 提示词包装函数（支持 tag 风格和自然语言风格）
  const spanWrap = (text: string) => {
    if (!text) return ''

    const specBreakTag = 'BREAK'
    const values = text.replace(/&gt;\s/g, '> ,').replace(/\sBREAK\s/g, ',' + specBreakTag + ',')
      .split(/[\n,]+/)
      .map(v => v.trim())
      .filter(v => v)

    // 判断是否为 tag 风格
    if (!isTagStylePrompt(values)) {
      // 自然语言风格
      return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => `<p style="margin:0; padding:4px 0;">${line}</p>`)
        .join('')
    }

    // Tag 风格
    const frags: string[] = []
    let parenthesisActive = false
    for (let i = 0; i < values.length; i++) {
      if (values[i] === specBreakTag) {
        frags.push('<br><span style="color:var(--zp-secondary); font-weight:bold;">BREAK</span><br>')
        continue
      }
      const trimmedValue = values[i]
      if (!parenthesisActive) parenthesisActive = trimmedValue.includes('(')
      const styles = ['background: var(--zp-secondary-variant-background)', 'color: var(--zp-primary)', 'padding: 2px 6px', 'border-radius: 4px', 'margin-right: 6px', 'margin-top: 4px', 'display: inline-block']
      if (parenthesisActive) styles.push('border: 1px solid var(--zp-secondary)')
      if (getTextLength(trimmedValue) < 32) styles.push('font-size: 0.9em')
      frags.push(`<span style="${styles.join('; ')}">${trimmedValue}</span>`)
      if (parenthesisActive) parenthesisActive = !trimmedValue.includes(')')
    }
    return frags.join(' ')
  }

  // 加载提示词
  loadPrompt()

  // Hide the controls after a spell of no input, and bring them back on any.
  //
  // Chromium has its own inactivity timer, but on these clips it never seems to
  // reach the operator: the videos run a few seconds, usually looping, and in
  // FULLSCREEN the control bar with its dark scrim sits on the picture the
  // whole time. Fullscreen is also what rules out the obvious alternative -
  // hiding the controls when the pointer leaves the video - because the video
  // is the whole screen and there is nowhere for the pointer to go.
  //
  // Stillness works everywhere the pointer does not: playing plus no input for
  // IDLE_MS hides, any input shows. Paused always shows, or a paused clip would
  // have no visible way to resume.
  //
  // Set on the ELEMENT rather than through a reactive prop: the modal's content
  // is a render function, and re-rendering on every mouse move would rebuild
  // the <video> and restart playback. Toggling the property leaves the playhead
  // alone.
  const IDLE_MS = 2500
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const clearIdleTimer = () => {
    if (idleTimer !== undefined) { clearTimeout(idleTimer); idleTimer = undefined }
  }
  const showControls = (el: HTMLVideoElement) => { el.controls = true }
  // Input restarts the idle clock. Nothing else does.
  const resetIdleHide = (el: HTMLVideoElement) => {
    clearIdleTimer()
    if (el.paused) return
    idleTimer = setTimeout(() => { if (!el.paused) el.controls = false }, IDLE_MS)
  }
  // A loop restart must NOT restart it. The clock measures time since the last
  // input, not since the last play event: with the last mouse move at 9s of a
  // 10s clip, the controls are due to go 1.5s into the next lap, not a fresh
  // 2.5s after it - which is what the operator saw and correctly called wrong.
  // So this only starts a clock when none is running.
  const ensureIdleHide = (el: HTMLVideoElement) => {
    if (idleTimer !== undefined) return
    resetIdleHide(el)
  }
  // play/loop must ARM the timer without SHOWING anything. Per the HTML spec a
  // loop restart fires neither play nor pause - it seeks and carries on - but
  // this does not depend on that: if some browser did fire play each cycle, a
  // handler that showed the controls would flash them back on every loop, which
  // is precisely the complaint. Only real input shows them.
  const onVideoPlaying = (e: Event) => {
    if (!global.autoHideVideoControls) return
    const el = (e.currentTarget ?? videoRef.value) as HTMLVideoElement | null
    if (el) ensureIdleHide(el)
  }
  // Input is watched on the DOCUMENT, not on the <video>.
  //
  // Element-level listeners looked right and did not work: in fullscreen the
  // operator saw the controls hide when a loop restarted - the onPlay path
  // above - and then never again after moving the mouse, until the next
  // restart. That is exactly the signature of the movement never reaching this
  // handler, leaving onPlay as the only thing arming the timer. The native
  // control bar is a shadow-DOM overlay sitting on top of the video, so
  // pointer movement across the part of the screen that matters most is not
  // reliably the video element's own event to hear.
  //
  // The document hears it either way, in fullscreen and out, and the video is
  // resolved through videoRef rather than the event target.
  const onVideoActivity = () => {
    if (!global.autoHideVideoControls) return
    const el = videoRef.value
    if (!el) return
    showControls(el)
    resetIdleHide(el)
  }
  const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
  const watchActivity = () => {
    activityEvents.forEach(name =>
      document.addEventListener(name, onVideoActivity, { passive: true }))
  }
  const unwatchActivity = () => {
    activityEvents.forEach(name =>
      document.removeEventListener(name, onVideoActivity))
  }
  const onVideoPause = (e: Event) => {
    if (!global.autoHideVideoControls) return
    clearIdleTimer()
    const el = (e.currentTarget ?? videoRef.value) as HTMLVideoElement | null
    if (el) showControls(el)
  }

  const onTiktokViewWrapper = () => {
    onTiktokView?.()
    closeImageFullscreenPreview()
    modal.destroy()
  }

  // Navigating closes this modal and opens a fresh one for the neighbour
  // file, rather than mutating the current one in place. This component
  // closes over `file` and holds prompt-loading state, a videoRef and tag
  // state that all belong to that one file; making all of that reactive to
  // an in-place file swap would be a much larger change than reopening is.
  const goTo = (dir: 1 | -1) => {
    if (!nav) return
    const next = nav.at(nav.idx, dir)
    if (!next) return
    modal.destroy()
    openMediaModalImpl(next.file, onTagClick, onTiktokView, mediaType, { ...nav, idx: next.idx }, forcePlay)
  }

  const isTypingTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    // A focused <video> already uses arrow keys to seek; stealing them here
    // would break the player's own controls. Inputs/textareas get the same
    // pass-through for the obvious reason.
    return tag === 'VIDEO' || tag === 'INPUT' || tag === 'TEXTAREA'
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!nav || isTypingTarget(e.target)) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goTo(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goTo(1)
    }
  }

  if (nav) {
    window.addEventListener('keydown', onKeyDown)
  }

  const modal = Modal.confirm({
    width: mediaType === 'video' ? '80vw' : '70vw',
    title: file.name,
    icon: null,
    content: () => {
      // Shared with the right-hand panel in the split (video) layout, so the
      // panel's scroll area is always capped at the same height as the player.
      const mediaMaxHeight = isStandalone ? '80vh' : '60vh'
      // Same knob the fullscreen LR panel publishes (useFullscreenLayout.ts) -
      // reused rather than a second number, so both layouts move together.
      const panelWidth = global.conf?.app_fe_setting?.fullscreen_layout?.panelWidth ?? 384
      const isSplit = mediaType === 'video'

      const sidePanel = (
        <>
          {/* 标签选择区域 */}
          <div style={{ marginTop: '16px' }}>
            <div onClick={openAddNewTagModal}  style={{
              background: 'var(--zp-primary-background)',
              color: 'var(--zp-luminous)',
              border: '2px solid var(--zp-luminous)',
              ...tagBaseStyle
            }}>
              { t('addNewCustomTag') }
            </div>
            {global.conf!.all_custom_tags.map((tag) =>
              <div key={tag.id} onClick={() => onTagClick?.(tag.id)}  style={{
                background: isSelected(tag.id) ? tagStore.getColor(tag) : 'var(--zp-primary-background)',
                color: !isSelected(tag.id) ? tagStore.getColor(tag) : 'white',
                border: `2px solid ${tagStore.getColor(tag)}`,
                ...tagBaseStyle
              }}>
                { tag.name }
              </div>)}
          </div>

          {/* 操作按钮 */}
          <div class="actions" style={{ marginTop: '16px' }}>
            {nav && (
              <Button onClick={() => goTo(-1)} disabled={!nav.at(nav.idx, -1)}>
                {{
                  icon: <LeftOutlined/>,
                  default: t('previousMedia')
                }}
              </Button>
            )}
            {nav && (
              <Button onClick={() => goTo(1)} disabled={!nav.at(nav.idx, 1)}>
                {{
                  icon: <RightOutlined/>,
                  default: t('nextMedia')
                }}
              </Button>
            )}
            <Button onClick={() => downloadFiles([toRawFileUrl(file, true)])}>
              {{
                icon: <DownloadOutlined/>,
                default: t('download')
              }}
            </Button>
            {onTiktokView && (
              <Button onClick={onTiktokViewWrapper} type="primary">
                {{
                  default: t('tiktokView')
                }}
              </Button>
            )}
            {mediaType === 'video' && (
              <Button onClick={async () => {
                if (!videoRef.value) return
                const video = videoRef.value
                video.pause()
                const base64 = video2base64(video)
                await setTargetFrameAsCover({ path: file.fullpath, base64_img: base64, updated_time: file.date })
                file.cover_url = URL.createObjectURL(await base64ToFile(base64, 'cover'))
                message.success(t('success') + '!  ' + t('clearCacheIfNotTakeEffect'))
              }}>
                {{ default: t('setCurrFrameAsVideoPoster') }}
              </Button>
            )}
            {mediaType === 'video' && global.conf?.launch_mode === 'wan2gp' && (
              <Button onClick={() => {
                const bus = new BroadcastChannel('iib-image-transfer-bus')
                bus.postMessage({ event: 'wan2gp_load_settings', path: file.fullpath })
                bus.close()
                message.success(t('settingsSentToVideoGenerator'))
              }}>
                {{ default: t('sendSettingsToVideoGenerator') }}
              </Button>
            )}
            <Button onClick={async () => {
              await openEditPromptModal(file)
              await loadPrompt()
            }} icon={<EditOutlined />}>
              {{ default: t('editPrompt') }}
            </Button>
          </div>

          {/* 提示词显示区域 */}
          {promptLoading.value ? (
            <div style={{ marginTop: '24px', width: '100%', textAlign: 'center' }}>
              <Spin />
            </div>
          ) : imageGenInfo.value ? (
            <div style={{ marginTop: '24px', width: '100%', maxWidth: mediaType === 'video' ? '1000px' : '900px', alignSelf: 'center' /* centred like the player and buttons above; flex-start left this block hanging off to one side */ }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--zp-primary)', fontSize: '14px', fontWeight: 500 }}>
                <FileTextOutlined />
                <span>Prompt</span>
              </div>
              {geninfoStruct().prompt && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px' }}>Positive</div>
                  <code style={{ fontSize: '13px', display: 'block', padding: '10px 12px', background: 'var(--zp-primary-background)', borderRadius: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6em' }} innerHTML={spanWrap(geninfoStruct().prompt ?? '')}></code>
                </div>
              )}
              {geninfoStruct().negativePrompt && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px' }}>Negative</div>
                  <code style={{ fontSize: '13px', display: 'block', padding: '10px 12px', background: 'var(--zp-primary-background)', borderRadius: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6em' }} innerHTML={spanWrap(geninfoStruct().negativePrompt ?? '')}></code>
                </div>
              )}
              {(() => {
                const sections = metaSections()
                const hasMeta = sections.generation.length > 0 || sections.loras.length > 0 ||
                  sections.lsetName.length > 0 ||
                  sections.timing.length > 0 || sections.rest.length > 0
                if (!hasMeta) return null

                const renderKvTable = (rows: [string, string][]) => (
                  <div style={{ background: 'var(--zp-secondary-background)', borderRadius: '6px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', lineHeight: '1.5em', tableLayout: 'fixed' }}>
                      <tbody>
                        {rows.map(([key, value], i) => (
                          <tr key={key} style={{ background: i % 2 ? 'transparent' : 'rgba(127,127,127,0.06)' }}>
                            <td style={{ padding: '5px 10px', width: '38%', color: 'var(--zp-primary)', opacity: 0.65, verticalAlign: 'top', wordBreak: 'break-word' }}>{key}</td>
                            <td style={{ padding: '5px 10px', color: 'var(--zp-primary)', verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )

                return (
                  <div style={{ alignSelf: 'center' }}>
                    {sections.generation.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px' }}>{t('metaSectionGeneration')}</div>
                        {renderKvTable(sections.generation)}
                      </div>
                    )}
                    {(sections.loras.length > 0 || sections.lsetName) && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px' }}>{t('metaSectionLoras')}</div>
                        {sections.lsetName && (
                          <div style={{ fontSize: '12px', color: 'var(--zp-secondary)', marginBottom: '6px' }}>{sections.lsetName}</div>
                        )}
                        {sections.loras.length > 0 && (
                        <div style={{ background: 'var(--zp-secondary-background)', borderRadius: '6px', overflow: 'hidden' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', lineHeight: '1.5em', tableLayout: 'fixed' }}>
                            <tbody>
                              {sections.loras.map((row, i) => (
                                <tr key={row.name} style={{ background: i % 2 ? 'transparent' : 'rgba(127,127,127,0.06)' }}>
                                  <td style={{ padding: '5px 10px', color: 'var(--zp-primary)', verticalAlign: 'top', wordBreak: 'break-word' }}>{row.name}</td>
                                  <td style={{ padding: '5px 10px', width: '1%', whiteSpace: 'nowrap', color: 'var(--zp-primary)', verticalAlign: 'top' }}>x{row.multiplier}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        )}
                      </div>
                    )}
                    {sections.timing.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px' }}>{t('metaSectionTiming')}</div>
                        {renderKvTable(sections.timing)}
                      </div>
                    )}
                    {sections.rest.length > 0 && (
                      <div>
                        <div
                          style={{ fontSize: '12px', color: 'var(--zp-primary)', marginBottom: '6px', cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => { showAllMeta.value = !showAllMeta.value }}
                        >
                          {t('metaSectionEverythingElse')} - {showAllMeta.value ? t('metaHide') : `${t('metaShowAll')} (${sections.rest.length})`}
                        </div>
                        {showAllMeta.value && renderKvTable(sections.rest)}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          ) : null}
        </>
      )

      return (
        <div
          class={isSplit ? 'iib-media-modal-body iib-media-modal-body--split' : 'iib-media-modal-body'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            ...(isSplit ? { '--iib-media-panel-width': `${panelWidth}px`, '--iib-media-max-height': mediaMaxHeight } : {})
          } as any}
        >
          {mediaType === 'video' ? (
            <>
              <video
                ref={videoRef}
                class={['iib-media-modal-video', global.hideVideoControlScrim ? 'iib-media-video--no-scrim' : '']}
                style={{ maxHeight: mediaMaxHeight, maxWidth: '100%', minWidth: '70%' }}
                src={toStreamVideoUrl(file)}
                controls
                autoplay={(forcePlay || global.autoPlayMedia) || undefined}
                loop={global.loopMedia || undefined}
                onPlay={onVideoPlaying}
                onPause={onVideoPause}
              ></video>
              <div class="iib-media-modal-right">
                {sidePanel}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '80px', marginBottom: '16px' }}>🎵</div>
              <audio style={{ width: '100%', maxWidth: '500px' }} src={toStreamAudioUrl(file)} controls autoplay={(forcePlay || global.autoPlayMedia) || undefined} loop={global.loopMedia || undefined}></audio>
              {sidePanel}
            </>
          )}
        </div>
      )
    },
    maskClosable: true,
    wrapClassName: 'hidden-antd-btns-modal',
    afterClose: () => {
      clearIdleTimer()
      unwatchActivity()
      if (nav) {
        window.removeEventListener('keydown', onKeyDown)
      }
    }
  })

  // Only for video, and only once the modal exists: audio has no frame to
  // uncover, and document listeners with no modal open would be a leak.
  if (mediaType === 'video') {
    watchActivity()
  }
}

export const openVideoModal = (
  file: FileNodeInfo,
  onTagClick?: (id: string| number) => void,
  onTiktokView?: () => void,
  nav?: MediaNav,
  forcePlay = false
) => openMediaModalImpl(file, onTagClick, onTiktokView, 'video', nav, forcePlay)

export const openAudioModal = (
  file: FileNodeInfo,
  onTagClick?: (id: string| number) => void,
  onTiktokView?: () => void,
  nav?: MediaNav,
  forcePlay = false
) => openMediaModalImpl(file, onTagClick, onTiktokView, 'audio', nav, forcePlay)

export const openRebuildImageIndexModal = () => {
  Modal.confirm({
    title: t('confirmRebuildImageIndex'),
    onOk: async () => {
      await rebuildImageIndex()
      globalEvents.emit('searchIndexExpired')
      message.success(t('rebuildComplete'))
    }
  })
}


export const openRenameFileModal = (path: string) => {
  const name = ref(path.split(/[\\/]/).pop() ?? '')
  return new Promise<string>((resolve) => {
    Modal.confirm({
      title: t('rename'),
      content: () => <Input v-model:value={name.value} />,
      async onOk() {
        if (!name.value) {
          return
        }
        const resp = await renameFile({ path, name: name.value })
        resolve(resp.new_path)
      }
    })
  })
}


export const openAddNewTagModal = () => {
  const name = ref('')
  const global = useGlobalStore()
  return new Promise<string>((resolve) => {
    Modal.confirm({
      title: t('addNewCustomTag'),
      content: () => <Input v-model:value={name.value} />,
      async onOk() {
        if (!name.value) {
          return
        }
        const info = await getDbBasicInfo()
        const tag = await addCustomTag({ tag_name: name.value })
        if (tag.type !== 'custom') {
          message.error(t('existInOtherType'))
          throw new Error(t('existInOtherType'))
        }
        if (info.tags.find((v) => v.id === tag.id)) {
          message.error(t('alreadyExists'))
          throw new Error(t('alreadyExists'))
        } else {
          global.conf?.all_custom_tags.push(tag)
          message.success(t('success'))
        }
        resolve(name.value)
      }
    })
  })
}

export const openEditPromptModal = async (file: FileNodeInfo) => {
  globalEvents.off('promptEditorUpdated') // 确保事件监听器不会重复绑定
  return new Promise<void>((resolve) => {
    const handler = () => {
      globalEvents.off('promptEditorUpdated', handler)
      resolve()
    }

    globalEvents.on('promptEditorUpdated', handler)
    globalEvents.emit('openPromptEditor', { file })
  })
}

