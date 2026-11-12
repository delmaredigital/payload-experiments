'use client'

import '../theme.css'
import { theme } from '../../testSurface/theme.js'

export function RootViewMessage({ children, alert = false }: { children: string; alert?: boolean }) {
  return <div role={alert ? 'alert' : undefined} style={{ padding: theme.space[4], color: theme.color.text, background: theme.color.bg }}>{children}</div>
}
