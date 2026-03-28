import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

// A4 尺寸（300DPI）
const A4_WIDTH = 2480
const A4_HEIGHT = 3508
const PADDING = 80   // 页边距
const GAP = 40       // 照片间距

/**
 * POST /api/layout
 * 接收去背图片 + 规格，自动排版到 A4 画布
 * 全程内存操作，返回 JPG
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageData, bgColor, width, height } = body

    if (!imageData || !bgColor || !width || !height) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 })
    }

    const photoW = Number(width)
    const photoH = Number(height)

    // 解析背景色
    const hex = bgColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    const imageBuffer = Buffer.from(imageData, 'base64')

    // 生成单张证件照（带背景）
    const background = await sharp({
      create: { width: photoW, height: photoH, channels: 3, background: { r, g, b } },
    }).png().toBuffer()

    const resized = await sharp(imageBuffer)
      .resize(photoW, photoH, { fit: 'cover', position: 'top' })
      .png()
      .toBuffer()

    const singlePhoto = await sharp(background)
      .composite([{ input: resized, blend: 'over' }])
      .jpeg({ quality: 95 })
      .toBuffer()

    // 计算 A4 上能放几列几行
    const cols = Math.floor((A4_WIDTH - PADDING * 2 + GAP) / (photoW + GAP))
    const rows = Math.floor((A4_HEIGHT - PADDING * 2 + GAP) / (photoH + GAP))
    const total = cols * rows

    // 创建 A4 白色画布
    const canvas = sharp({
      create: {
        width: A4_WIDTH,
        height: A4_HEIGHT,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).png()

    // 排版：计算每张照片的位置
    const composites: sharp.OverlayOptions[] = []
    for (let i = 0; i < total; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const left = PADDING + col * (photoW + GAP)
      const top = PADDING + row * (photoH + GAP)
      composites.push({ input: singlePhoto, left, top })
    }

    const a4Buffer = await canvas
      .composite(composites)
      .jpeg({ quality: 95 })
      .toBuffer()

    return new NextResponse(a4Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(a4Buffer.length),
      },
    })
  } catch (error) {
    console.error('layout error:', error)
    return NextResponse.json({ error: 'A4 排版失败' }, { status: 500 })
  }
}
