export function matchFiles(paths: string[], query: string) {
  const needle = query.trim().toLowerCase().replace(/\\/g, '/')
  return paths.map((path, order) => {
    const text = path.toLowerCase(), name = text.split('/').pop()!
    let score = Infinity
    if (!needle) score = 0
    else if (name === needle) score = 0
    else if (name.startsWith(needle)) score = 1
    else if (text.includes(needle)) score = 2
    else {
      let position = 0
      for (const char of needle) {
        const index = text.indexOf(char, position)
        if (index < 0) { position = -1; break }
        position = index + 1
      }
      if (position >= 0) score = 3
    }
    return { path, order, score }
  }).filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, 100).map(item => item.path)
}
