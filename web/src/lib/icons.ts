// Hull/type icons from the CCP Image Service. Base URL and default size come from the
// brand config so a self-hoster can point at a mirror.

import { brand } from '../brand/brandConfig'

const CCP_ICON_SIZES = [32, 64, 128, 256, 512, 1024] as const

function nearestSize(size: number): number {
  if (!Number.isFinite(size)) return 32
  return CCP_ICON_SIZES.reduce((best, candidate) =>
    Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best,
  )
}

export function buildCcpTypeIconUrl(
  typeId: number | null | undefined,
  size: number = brand.icons.defaultIconSize,
  baseUrl: string = brand.icons.ccpImageBaseUrl,
): string | null {
  if (typeof typeId !== 'number' || !Number.isFinite(typeId) || typeId <= 0) return null
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/types/${Math.trunc(typeId)}/icon?size=${nearestSize(size)}`
}
