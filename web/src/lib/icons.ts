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

/**
 * The smallest served size that is *not smaller* than what was asked for.
 *
 * Nearest is wrong for anything drawn as a circle at a written size. A 17px presence mark asks for
 * 34 to survive a 2× screen, nearest answers 32, and the browser then scales 32 up to 34 device
 * pixels — a face at that size is mostly edges, and the upscale is exactly what makes it read as
 * soft and its ring as ragged. Rounding up costs a few KB once and is then the same file for every
 * mark on the board: 17px tiles and the 18px strip both land on 64, so it is one fetch, not two.
 */
function atLeastSize(size: number): number {
  if (!Number.isFinite(size)) return 32
  return CCP_ICON_SIZES.find((candidate) => candidate >= size) ?? CCP_ICON_SIZES.at(-1)!
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

// A character's portrait, from the same image service as the hull icons. Unlike a hull icon this
// is rounded *up* to a served size — see `atLeastSize`; a portrait is a face in a circle and an
// upscaled one shows it.
export function buildCcpPortraitUrl(
  characterId: number | null | undefined,
  size: number = brand.icons.defaultIconSize,
  baseUrl: string = brand.icons.ccpImageBaseUrl,
): string | null {
  if (typeof characterId !== 'number' || !Number.isFinite(characterId) || characterId <= 0) {
    return null
  }
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/characters/${Math.trunc(characterId)}/portrait?size=${atLeastSize(size)}`
}
