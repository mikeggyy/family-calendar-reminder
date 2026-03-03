import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const defaultSettings = {
  endpoint: '',
  token: ''
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function extractPathFromDrop(event) {
  const droppedFile = event.dataTransfer?.files?.[0]
  if (droppedFile?.path) return droppedFile.path

  const uri = event.dataTransfer?.getData?.('text/uri-list') || event.dataTransfer?.getData?.('text/plain')
  if (uri && uri.startsWith('file://')) {
    try {
      const parsed = decodeURIComponent(uri.replace('file://', '').trim())
      if (/^\/[A-Za-z]:\//.test(parsed)) {
        return parsed.slice(1).replaceAll('/', '\\')
      }
      return parsed
    } catch {
      return ''
    }
  }

  return ''
}

export default function App() {
  const [tab, setTab] = useState('process')
  const [filePath, setFilePath] = useState('')
  const [fileSize, setFileSize] = useState(null)
  const [fileError, setFileError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('等待影片')
  const [jobs, setJobs] = useState([])
  const [settings, setSettings] = useState(() => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem('aiSettings') || '{}') }
    } catch {
      return defaultSettings
    }
  })

  useEffect(() => {
    localStorage.setItem('aiSettings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    let unlisten = null
    listen('process-progress', (event) => {
      const payload = event.payload || {}
      if (typeof payload.progress === 'number') setProgress(payload.progress)
      if (payload.message) setStatusText(payload.message)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  const canStart = useMemo(() => !!filePath && !processing && !fileError, [filePath, processing, fileError])

  const applySelectedPath = async (rawPath, fallbackSize) => {
    if (!rawPath) {
      setFileError('讀不到檔案路徑，請改用「選擇檔案」或重新拖拉一次。')
      setFilePath('')
      setFileSize(null)
      return
    }

    try {
      const info = await invoke('inspect_video_file', { inputPath: rawPath })
      setFilePath(info.path)
      setFileSize(info.size)
      setFileError('')
      setStatusText(`已選擇影片：${info.path}`)
    } catch (error) {
      const msg = typeof error === 'string' ? error : String(error)
      setFilePath(rawPath)
      setFileSize(typeof fallbackSize === 'number' ? fallbackSize : null)
      setFileError(`無法讀取檔案：${msg}`)
      setStatusText(`選檔失敗：${msg}`)
    }
  }

  const onFileInput = async (event) => {
    const f = event.target.files?.[0]
    await applySelectedPath(f?.path || '', typeof f?.size === 'number' ? f.size : null)
  }

  const onDrop = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const f = event.dataTransfer?.files?.[0]
    const path = extractPathFromDrop(event)
    await applySelectedPath(path, typeof f?.size === 'number' ? f.size : null)
  }

  const onDragOver = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const startProcess = async () => {
    if (!filePath) return
    setProcessing(true)
    setProgress(0)
    setStatusText('開始處理...')

    try {
      const result = await invoke('process_video', { inputPath: filePath })
      setJobs((prev) => [result, ...prev])
      setProgress(100)
      setStatusText('完成')
    } catch (error) {
      setStatusText(`失敗：${error}`)
    } finally {
      setProcessing(false)
    }
  }

  const mockSubmit = async (job) => {
    setStatusText('模擬送出中...')
    try {
      const response = await invoke('mock_submit_ai', {
        endpoint: settings.endpoint,
        token: settings.token,
        metadataPath: job.metadata_path
      })
      setStatusText(`Mock 成功：${response}`)
    } catch (error) {
      setStatusText(`Mock 失敗：${error}`)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Video Frame Desktop V1</h1>
        <div className="tabs">
          <button className={tab === 'process' ? 'active' : ''} onClick={() => setTab('process')}>處理影片</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>AI 設定</button>
        </div>
      </header>

      {tab === 'process' && (
        <>
          <section className="dropzone" onDrop={onDrop} onDragOver={onDragOver}>
            <p>拖拉 mp4 到這裡，或手動選檔</p>
            <input type="file" accept="video/mp4,.mp4" onChange={onFileInput} />
            <small>路徑：{filePath || '尚未選擇檔案'}</small>
            <small>大小：{fileSize === null ? '-' : formatBytes(fileSize)}</small>
            {fileError && <small className="error">{fileError}</small>}
          </section>

          <section className="actions">
            <button onClick={startProcess} disabled={!canStart}>
              {processing ? '處理中...' : '開始擷取每 1.5 秒一張'}
            </button>
            <div className="progress-wrap">
              <div className="progress" style={{ width: `${progress}%` }} />
            </div>
            <small>{statusText}</small>
          </section>

          <section>
            <h2>結果列表</h2>
            {jobs.length === 0 && <p className="muted">尚無結果</p>}
            {jobs.map((job) => (
              <article key={job.job_id} className="job-item">
                <div>
                  <strong>{job.job_id}</strong>
                  <p>Frames: {job.frame_count}</p>
                  <p>Output: {job.output_dir}</p>
                  <p>Metadata: {job.metadata_path}</p>
                </div>
                <button onClick={() => mockSubmit(job)}>Mock 送 AI API</button>
              </article>
            ))}
          </section>
        </>
      )}

      {tab === 'settings' && (
        <section className="settings">
          <label>
            API Endpoint
            <input
              value={settings.endpoint}
              onChange={(e) => setSettings((prev) => ({ ...prev, endpoint: e.target.value }))}
              placeholder="https://api.example.com/ingest"
            />
          </label>
          <label>
            API Token
            <input
              value={settings.token}
              onChange={(e) => setSettings((prev) => ({ ...prev, token: e.target.value }))}
              placeholder="sk-xxxx"
              type="password"
            />
          </label>
          <p className="muted">目前為 V1：先儲存設定 + mock 呼叫，後續可改成真實上傳 metadata / frames。</p>
        </section>
      )}
    </div>
  )
}
