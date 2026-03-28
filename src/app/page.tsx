'use client'

import { useState, useRef, useCallback } from 'react'

// 证件照规格
const SPECS = [
  { id: '1cun', name: '1寸', width: 295, height: 413, dpi: 300 },
  { id: '2cun', name: '2寸', width: 413, height: 579, dpi: 300 },
  { id: 'idcard', name: '身份证', width: 358, height: 441, dpi: 350 },
  { id: 'passport', name: '护照', width: 390, height: 567, dpi: 300 },
  { id: 'us-visa', name: '美国签证', width: 600, height: 600, dpi: 300 },
]

// 背景颜色
const BG_COLORS = [
  { id: 'white', name: '白色', hex: '#FFFFFF', border: 'border-gray-300' },
  { id: 'blue', name: '蓝色', hex: '#438EDB', border: 'border-blue-400' },
  { id: 'red', name: '红色', hex: '#D02B2B', border: 'border-red-400' },
]

type Step = 'upload' | 'processing' | 'done' | 'error'

export default function Home() {
  const [step, setStep] = useState<Step>('upload')
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [removedBgData, setRemovedBgData] = useState<string | null>(null) // base64 PNG
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  const [selectedBg, setSelectedBg] = useState(BG_COLORS[0])
  const [selectedSpec, setSelectedSpec] = useState(SPECS[0])
  const [errorMsg, setErrorMsg] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 处理文件上传
  const handleFile = useCallback(async (file: File) => {
    if (!file.type.match(/image\/(jpeg|png)/)) {
      setErrorMsg('仅支持 JPG / PNG 格式')
      setStep('error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('图片大小不能超过 10MB')
      setStep('error')
      return
    }

    // 预览原图
    setOriginalUrl(URL.createObjectURL(file))
    setStep('processing')
    setProcessedUrl(null)

    try {
      // Step 1: 去背
      const formData = new FormData()
      formData.append('image', file)
      const bgRes = await fetch('/api/remove-bg', { method: 'POST', body: formData })
      if (!bgRes.ok) {
        const err = await bgRes.json()
        throw new Error(err.error || '背景去除失败')
      }
      const bgJson = await bgRes.json()
      setRemovedBgData(bgJson.data) // base64 PNG

      // Step 2: 合成
      await applySettings(bgJson.data, selectedBg.hex, selectedSpec)
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '处理失败，请重试')
      setStep('error')
    }
  }, [selectedBg, selectedSpec])

  // 应用背景色 + 规格
  const applySettings = useCallback(async (
    bgData: string,
    bgColor: string,
    spec: typeof SPECS[0]
  ) => {
    setIsProcessing(true)
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: bgData, bgColor, width: spec.width, height: spec.height }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '合成失败')
      }
      const blob = await res.blob()
      setProcessedUrl(URL.createObjectURL(blob))
      setStep('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '合成失败，请重试')
      setStep('error')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // 切换背景色或规格时重新合成
  const handleBgChange = async (bg: typeof BG_COLORS[0]) => {
    setSelectedBg(bg)
    if (removedBgData) await applySettings(removedBgData, bg.hex, selectedSpec)
  }

  const handleSpecChange = async (spec: typeof SPECS[0]) => {
    setSelectedSpec(spec)
    if (removedBgData) await applySettings(removedBgData, selectedBg.hex, spec)
  }

  // 下载 A4 排版
  const handleDownloadA4 = async () => {
    if (!removedBgData) return
    setIsProcessing(true)
    try {
      const res = await fetch('/api/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: removedBgData,
          bgColor: selectedBg.hex,
          width: selectedSpec.width,
          height: selectedSpec.height,
        }),
      })
      if (!res.ok) throw new Error('排版失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `id-photo-A4-${selectedSpec.id}.jpg`
      a.click()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '排版失败')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownloadSingle = () => {
    if (!processedUrl) return
    const a = document.createElement('a')
    a.href = processedUrl
    a.download = `id-photo-${selectedSpec.id}.jpg`
    a.click()
  }

  const handleReset = () => {
    setStep('upload')
    setOriginalUrl(null)
    setRemovedBgData(null)
    setProcessedUrl(null)
    setErrorMsg('')
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-800">📷 证件照在线制作</h1>
        <p className="text-gray-500 mt-2">上传照片 · 3步完成 · 无需注册 · 隐私保护</p>
      </div>

      {/* Step 1: 上传 */}
      {step === 'upload' && (
        <div
          className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
        >
          <div className="text-5xl mb-4">📁</div>
          <p className="text-gray-600 text-lg">点击或拖拽照片到此处</p>
          <p className="text-gray-400 text-sm mt-2">支持 JPG / PNG，最大 10MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      )}

      {/* Step 2+3: 设置 + 预览 */}
      {(step === 'processing' || step === 'done') && (
        <div className="space-y-6">
          {/* 背景色 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">背景颜色</h2>
            <div className="flex gap-3">
              {BG_COLORS.map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => handleBgChange(bg)}
                  className={`w-12 h-12 rounded-full border-4 transition-all ${
                    selectedBg.id === bg.id ? 'scale-110 ' + bg.border : 'border-transparent'
                  }`}
                  style={{ backgroundColor: bg.hex }}
                  title={bg.name}
                />
              ))}
            </div>
          </div>

          {/* 规格选择 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">证件照规格</h2>
            <div className="flex flex-wrap gap-2">
              {SPECS.map((spec) => (
                <button
                  key={spec.id}
                  onClick={() => handleSpecChange(spec)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedSpec.id === spec.id
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {spec.name}
                  <span className="text-xs ml-1 opacity-70">{spec.width}×{spec.height}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 预览 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold text-gray-700 mb-3">预览</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-2">原图</p>
                {originalUrl && (
                  <img src={originalUrl} alt="原图" className="w-full rounded-lg object-cover" />
                )}
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-2">处理后</p>
                {isProcessing ? (
                  <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg">
                    <div className="animate-spin text-3xl">⚙️</div>
                  </div>
                ) : processedUrl ? (
                  <img src={processedUrl} alt="处理后" className="w-full rounded-lg object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg text-gray-400 text-sm">
                    处理中...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 下载按钮 */}
          <div className="flex gap-3">
            <button
              onClick={handleDownloadSingle}
              disabled={!processedUrl || isProcessing}
              className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ⬇️ 下载单张
            </button>
            <button
              onClick={handleDownloadA4}
              disabled={!removedBgData || isProcessing}
              className="flex-1 py-3 rounded-xl bg-green-500 text-white font-semibold hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              🖨️ 下载 A4 排版
            </button>
            <button
              onClick={handleReset}
              className="px-5 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              重新上传
            </button>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {step === 'error' && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">😢</div>
          <p className="text-red-500 font-medium">{errorMsg}</p>
          <button
            onClick={handleReset}
            className="mt-6 px-8 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600"
          >
            重新上传
          </button>
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-gray-400 text-xs mt-12">
        所有图片在内存中处理，不存储任何数据，保护您的隐私
      </p>
    </main>
  )
}
