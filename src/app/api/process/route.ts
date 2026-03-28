import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

/**
 * POST /api/process
 * 接收去背图片(base64) + 背景色 + 规格，用 Sharp 合成证件照
 * 全程内存操作，返回 JPG
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageData, bgColor, width, height } = body

    if (!imageData || !bgColor || !width || !height) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 })
    }

    // base64 → Buffer
    const imageBuffer = Buffer.from(imageData, 'base64')

    // 解析背景色（hex → rgb）
    const hex = bgColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    // 创建纯色背景
    const background = await sharp({
      create: {
        width: Number(width),
        height: Number(height),
        channels: 3,
        background: { r, g, b },
      },
    })
      .png()
      .toBuffer()

    // 将去背图片 resize 并合成到背景上（内存操作）
    const resized = await sharp(imageBuffer)
      .resize(Number(width), Number(height), {
        fit: 'cover',
        position: 'top', // 证件照一般头部居上
      })
      .png()
      .toBuffer()

    // 合成：背景 + 人像
    const composed = await sharp(background)
      .composite([{ input: resized, blend: 'over' }])
      .jpeg({ quality: 95 })
      .toBuffer()

    return new NextResponse(composed, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(composed.length),
      },
    })
  } catch (error) {
    console.error('process error:', error)
    return NextResponse.json({ error: '图片合成失败' }, { status: 500 })
  }
}
