// The single place brand strings and asset pointers live. A self-hoster rebrands by
// editing this and swapping the assets under web/public — no component changes needed.
// Colors are NOT here; they live in styles/tokens.css.

export interface BrandConfig {
  appName: string
  productLabel: string
  wordmark: { primary: string; suffix: string }
  favicon: string
  icons: { ccpImageBaseUrl: string; defaultIconSize: number }
  storageKeyPrefix: string
}

export const brand: BrandConfig = {
  appName: 'BurnSun · AT Comp Tool',
  productLabel: 'AT Comp Tool',
  wordmark: { primary: 'burnsun', suffix: '.space' },
  favicon: '/favicon.svg',
  icons: { ccpImageBaseUrl: 'https://images.evetech.net', defaultIconSize: 32 },
  storageKeyPrefix: 'comp-tool',
}
