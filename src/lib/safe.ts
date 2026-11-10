// Helpers for links built from text a user typed. Only plain web links are allowed,
// so a profile can never carry a javascript: or data: link.

export function safeHttpUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
    const u = new URL(withScheme)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}
