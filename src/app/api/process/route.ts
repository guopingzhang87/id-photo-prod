import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/process
 * 接收去背图片(base64) + 背景色 + 规格，用 OffscreenCanvas 合成证件照
 * 全程内存操作，返回 JPG
 * 注意：使用 OffscreenCanvas 替代 sharp，兼容 Cloudflare Workers 环境
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageData, bgColor, width, height } = body

    if (!imageData || !bgColor || !width || !height) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 })
    }

    const w = Number(width)
    const h = Number(height)

    // 用 OffscreenCanvas 合成（兼容 Cloudflare Workers）
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return NextResponse.json({ error: '无法创建 Canvas 上下文' }, { status: 500 })
    }

    // 画背景色
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, w, h)

    // 将 base64 解码为 Blob，再创建 ImageBitmap
    const binaryStr = atob(imageData)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const imgBlob = new Blob([bytes], { type: 'image/png' })
    const bitmap = await createImageBitmap(imgBlob, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    })

    // 绘制人像（cover 模式，头部居上）
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    // 导出为 JPEG
    const outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
    const arrayBuffer = await outputBlob.arrayBuffer()

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(arrayBuffer.byteLength),
      },
    })
  } catch (error) {
    console.error('process error:', error)
    return NextResponse.json({ error: '图片合成失败' }, { status: 500 })
  }
}
