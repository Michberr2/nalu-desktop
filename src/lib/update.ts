// Lightweight update check for the desktop app. Because the app is ad-hoc
// signed (silent Squirrel auto-update needs a paid Developer ID), we CHECK the
// latest published release and, if there's a newer one, notify the user with a
// one-click download — so an already-installed app still gets updates.

const RELEASES_API = 'https://api.github.com/repos/Michberr2/nalu-desktop/releases/latest'
export const DOWNLOAD_PAGE = 'https://n4lu.ai/download.html'

// Compare dotted versions: 1 if a > b, -1 if a < b, 0 if equal.
export function cmpVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export type UpdateInfo = { current: string; latest: string }

// Returns update info if a newer release exists, else null.
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const current = await window.nalu.appVersion()
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const j = (await res.json()) as { tag_name?: string; name?: string }
    const latest = (j.tag_name || j.name || '').replace(/^v/, '').trim()
    if (latest && cmpVersions(latest, current) > 0) return { current, latest }
    return null
  } catch {
    return null
  }
}
