import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/process
 * 接收去背图片(base64 PNG) + 背景色 + 规格，合成证件照
 * 使用纯 JS PNG 解码/编码，完全兼容 Cloudflare Workers
 */

// 解析 hex 颜色
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

// 读取 4 字节大端 uint32
function readUint32(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0
}

// 写入 4 字节大端 uint32
function writeUint32(buf: Uint8Array, offset: number, value: number) {
  buf[offset]   = (value >>> 24) & 0xff
  buf[offset+1] = (value >>> 16) & 0xff
  buf[offset+2] = (value >>> 8)  & 0xff
  buf[offset+3] = value & 0xff
}

// CRC32 表
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0xffffffff
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// adler32 校验（用于 zlib）
function adler32(data: Uint8Array): number {
  let s1 = 1, s2 = 0
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521
    s2 = (s2 + s1) % 65521
  }
  return (s2 << 16) | s1
}

// 简单 zlib 压缩（不压缩存储模式，level=0）
function zlibStore(data: Uint8Array): Uint8Array {
  const BLOCK = 65535
  const blocks = Math.ceil(data.length / BLOCK) || 1
  // zlib header (2) + blocks + adler32 (4)
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4)
  out[0] = 0x78; out[1] = 0x01 // zlib header: CM=8, CINFO=7, FCHECK=1
  let pos = 2
  let offset = 0
  for (let b = 0; b < blocks; b++) {
    const isLast = b === blocks - 1
    const len = Math.min(BLOCK, data.length - offset)
    out[pos++] = isLast ? 1 : 0
    out[pos++] = len & 0xff
    out[pos++] = (len >> 8) & 0xff
    out[pos++] = (~len) & 0xff
    out[pos++] = ((~len) >> 8) & 0xff
    out.set(data.subarray(offset, offset + len), pos)
    pos += len
    offset += len
  }
  const adler = adler32(data)
  out[pos++] = (adler >>> 24) & 0xff
  out[pos++] = (adler >>> 16) & 0xff
  out[pos++] = (adler >>> 8) & 0xff
  out[pos++] = adler & 0xff
  return out.subarray(0, pos)
}

// 编码 PNG chunk
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.length)
  writeUint32(chunk, 0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  const crc = crc32(chunk, 4, 8 + data.length)
  writeUint32(chunk, 8 + data.length, crc)
  return chunk
}

// 生成纯色 PNG (RGBA)
function makeSolidPNG(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  // IHDR
  const ihdr = new Uint8Array(13)
  writeUint32(ihdr, 0, w); writeUint32(ihdr, 4, h)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8bit RGB

  // Raw scanlines: filter byte(0) + RGB * w
  const raw = new Uint8Array(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0 // filter=None
    for (let x = 0; x < w; x++) {
      const p = y * (1 + w * 3) + 1 + x * 3
      raw[p] = r; raw[p+1] = g; raw[p+2] = b
    }
  }

  const idat = zlibStore(raw)
  const sig = new Uint8Array([137,80,78,71,13,10,26,10])
  const ihdrChunk = pngChunk('IHDR', ihdr)
  const idatChunk = pngChunk('IDAT', idat)
  const iendChunk = pngChunk('IEND', new Uint8Array(0))

  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const png = new Uint8Array(total)
  let off = 0
  png.set(sig, off); off += sig.length
  png.set(ihdrChunk, off); off += ihdrChunk.length
  png.set(idatChunk, off); off += idatChunk.length
  png.set(iendChunk, off)
  return png
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageData, bgColor, width, height } = body

    if (!imageData || !bgColor || !width || !height) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 })
    }

    const w = Number(width)
    const h = Number(height)
    const [r, g, b] = parseHex(bgColor)

    // 解码前景图（去背后的 PNG，含 alpha）
    const fgBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))

    // 验证是 PNG
    if (fgBytes[0] !== 137 || fgBytes[1] !== 80) {
      return NextResponse.json({ error: '前景图必须是 PNG 格式' }, { status: 400 })
    }

    // 解析 PNG: 找到 IHDR 获取宽高，找到 IDAT 获取压缩数据
    let fgW = 0, fgH = 0
    let idatData: Uint8Array[] = []
    let colorType = 0, bitDepth = 0
    let pos = 8 // skip signature

    while (pos < fgBytes.length) {
      const len = readUint32(fgBytes, pos)
      const type = String.fromCharCode(fgBytes[pos+4], fgBytes[pos+5], fgBytes[pos+6], fgBytes[pos+7])
      const dataStart = pos + 8

      if (type === 'IHDR') {
        fgW = readUint32(fgBytes, dataStart)
        fgH = readUint32(fgBytes, dataStart + 4)
        bitDepth = fgBytes[dataStart + 8]
        colorType = fgBytes[dataStart + 9]
      } else if (type === 'IDAT') {
        idatData.push(fgBytes.slice(dataStart, dataStart + len))
      } else if (type === 'IEND') {
        break
      }
      pos += 12 + len
    }

    // 合并所有 IDAT
    const totalLen = idatData.reduce((s, d) => s + d.length, 0)
    const idatCombined = new Uint8Array(totalLen)
    let off = 0
    for (const d of idatData) { idatCombined.set(d, off); off += d.length }

    // 解压 zlib（使用 DecompressionStream，CF Workers 支持）
    const ds = new DecompressionStream('deflate')
    const writer = ds.writable.getWriter()
    // 跳过 zlib header（2字节）和 adler32 trailer（4字节）
    writer.write(idatCombined.slice(2, idatCombined.length - 4))
    writer.close()
    const reader = ds.readable.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const rawLen = chunks.reduce((s, c) => s + c.length, 0)
    const raw = new Uint8Array(rawLen)
    let rawOff = 0
    for (const c of chunks) { raw.set(c, rawOff); rawOff += c.length }

    // 判断通道数
    // colorType: 2=RGB, 6=RGBA
    const channels = colorType === 6 ? 4 : (colorType === 2 ? 3 : 4)
    const stride = 1 + fgW * channels // filter byte + pixel data per row

    // 反过滤（Paeth/Sub/Up/Average/None）
    function paethPredictor(a: number, b: number, c: number): number {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      if (pa <= pb && pa <= pc) return a
      if (pb <= pc) return b
      return c
    }

    const pixels = new Uint8Array(fgW * fgH * channels)
    for (let y = 0; y < fgH; y++) {
      const filter = raw[y * stride]
      const rowStart = y * stride + 1
      const prevRowStart = y > 0 ? (y - 1) * stride + 1 : -1

      for (let x = 0; x < fgW * channels; x++) {
        const raw_byte = raw[rowStart + x]
        const a = x >= channels ? pixels[y * fgW * channels + x - channels] : 0
        const b = prevRowStart >= 0 ? pixels[(y - 1) * fgW * channels + x] : 0
        const c = (prevRowStart >= 0 && x >= channels) ? pixels[(y - 1) * fgW * channels + x - channels] : 0

        let val: number
        switch (filter) {
          case 0: val = raw_byte; break
          case 1: val = (raw_byte + a) & 0xff; break
          case 2: val = (raw_byte + b) & 0xff; break
          case 3: val = (raw_byte + Math.floor((a + b) / 2)) & 0xff; break
          case 4: val = (raw_byte + paethPredictor(a, b, c)) & 0xff; break
          default: val = raw_byte
        }
        pixels[y * fgW * channels + x] = val
      }
    }

    // 合成：将前景 resize 到目标尺寸，与背景色合并
    // 使用双线性插值缩放
    const scaleX = fgW / w
    const scaleY = fgH / h

    // 输出 RGBA 像素
    const outPixels = new Uint8Array(w * h * 4)
    for (let oy = 0; oy < h; oy++) {
      for (let ox = 0; ox < w; ox++) {
        // 源坐标（保持头部居上：cover fit）
        const sx = ox * scaleX
        const sy = oy * scaleY
        const sx0 = Math.min(Math.floor(sx), fgW - 1)
        const sy0 = Math.min(Math.floor(sy), fgH - 1)
        const sx1 = Math.min(sx0 + 1, fgW - 1)
        const sy1 = Math.min(sy0 + 1, fgH - 1)
        const fx = sx - sx0, fy = sy - sy0

        // 双线性插值
        const getChannel = (x: number, y: number, ch: number) =>
          channels === 4 ? pixels[(y * fgW + x) * 4 + ch] : (ch < 3 ? pixels[(y * fgW + x) * 3 + ch] : 255)

        const lerp = (a: number, b: number, t: number) => a + (b - a) * t

        const fgR = lerp(lerp(getChannel(sx0,sy0,0), getChannel(sx1,sy0,0), fx), lerp(getChannel(sx0,sy1,0), getChannel(sx1,sy1,0), fx), fy)
        const fgG = lerp(lerp(getChannel(sx0,sy0,1), getChannel(sx1,sy0,1), fx), lerp(getChannel(sx0,sy1,1), getChannel(sx1,sy1,1), fx), fy)
        const fgB = lerp(lerp(getChannel(sx0,sy0,2), getChannel(sx1,sy0,2), fx), lerp(getChannel(sx0,sy1,2), getChannel(sx1,sy1,2), fx), fy)
        const fgA = lerp(lerp(getChannel(sx0,sy0,3), getChannel(sx1,sy0,3), fx), lerp(getChannel(sx0,sy1,3), getChannel(sx1,sy1,3), fx), fy) / 255

        // Alpha 合成：前景 over 背景色
        const outIdx = (oy * w + ox) * 4
        outPixels[outIdx]   = Math.round(fgR * fgA + r * (1 - fgA))
        outPixels[outIdx+1] = Math.round(fgG * fgA + g * (1 - fgA))
        outPixels[outIdx+2] = Math.round(fgB * fgA + b * (1 - fgA))
        outPixels[outIdx+3] = 255
      }
    }

    // 编码输出为 PNG（RGB，无 alpha）
    const outRaw = new Uint8Array(h * (1 + w * 3))
    for (let y = 0; y < h; y++) {
      outRaw[y * (1 + w * 3)] = 0 // filter=None
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4
        const dst = y * (1 + w * 3) + 1 + x * 3
        outRaw[dst]   = outPixels[src]
        outRaw[dst+1] = outPixels[src+1]
        outRaw[dst+2] = outPixels[src+2]
      }
    }

    // 压缩输出 PNG
    const cs = new CompressionStream('deflate')
    const cWriter = cs.writable.getWriter()
    cWriter.write(outRaw)
    cWriter.close()
    const cReader = cs.readable.getReader()
    const cChunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await cReader.read()
      if (done) break
      if (value) cChunks.push(value)
    }
    const deflatedLen = cChunks.reduce((s, c) => s + c.length, 0)
    // 构造 zlib: header(2) + deflate + adler32(4)
    const adler = adler32(outRaw)
    const zlib = new Uint8Array(2 + deflatedLen + 4)
    zlib[0] = 0x78; zlib[1] = 0x9c
    let zOff = 2
    for (const c of cChunks) { zlib.set(c, zOff); zOff += c.length }
    zlib[zOff]   = (adler >>> 24) & 0xff
    zlib[zOff+1] = (adler >>> 16) & 0xff
    zlib[zOff+2] = (adler >>> 8)  & 0xff
    zlib[zOff+3] = adler & 0xff

    // 构造 PNG
    const outIhdr = new Uint8Array(13)
    writeUint32(outIhdr, 0, w); writeUint32(outIhdr, 4, h)
    outIhdr[8] = 8; outIhdr[9] = 2

    const sig = new Uint8Array([137,80,78,71,13,10,26,10])
    const ihdrChunk = pngChunk('IHDR', outIhdr)
    const idatChunk = pngChunk('IDAT', zlib)
    const iendChunk = pngChunk('IEND', new Uint8Array(0))

    const pngTotal = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length
    const pngOut = new Uint8Array(pngTotal)
    let pngOff = 0
    pngOut.set(sig, pngOff); pngOff += sig.length
    pngOut.set(ihdrChunk, pngOff); pngOff += ihdrChunk.length
    pngOut.set(idatChunk, pngOff); pngOff += idatChunk.length
    pngOut.set(iendChunk, pngOff)

    return new Response(pngOut, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(pngOut.length),
      },
    })
  } catch (error) {
    console.error('process error:', error)
    return NextResponse.json({ error: '图片合成失败' }, { status: 500 })
  }
}
