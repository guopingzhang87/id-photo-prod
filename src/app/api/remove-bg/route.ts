import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/remove-bg
 * 接收图片文件，调用 Remove.bg API 去除背景
 * 返回 base64 编码的 PNG 图片数据
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.REMOVEBG_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Remove.bg API Key 未配置' }, { status: 500 })
    }

    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    if (!imageFile) {
      return NextResponse.json({ error: '请上传图片' }, { status: 400 })
    }

    if (!['image/jpeg', 'image/png'].includes(imageFile.type)) {
      return NextResponse.json({ error: '仅支持 JPG / PNG 格式' }, { status: 400 })
    }

    // 发送到 Remove.bg
    const rbFormData = new FormData()
    rbFormData.append('image_file', imageFile)
    rbFormData.append('size', 'auto')

    const rbRes = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: rbFormData,
    })

    if (!rbRes.ok) {
      if (rbRes.status === 402) {
        return NextResponse.json({ error: 'Remove.bg API 额度已用完，请充值或更换 Key' }, { status: 402 })
      }
      const errText = await rbRes.text()
      console.error('Remove.bg error:', errText)
      return NextResponse.json({ error: '背景去除失败，请稍后重试' }, { status: 500 })
    }

    // 全程内存操作，转 base64 返回
    const arrayBuffer = await rbRes.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    return NextResponse.json({ data: base64 })
  } catch (error) {
    console.error('remove-bg error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
