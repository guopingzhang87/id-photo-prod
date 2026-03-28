import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ID Photo Production — 证件照在线制作',
  description: '无需下载软件，上传照片即可在线生成符合标准的证件照，支持身份证、护照、签证等多种规格。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  )
}
