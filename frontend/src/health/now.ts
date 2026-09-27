/** Local date and time as the forms want them; toISOString() is UTC and gives yesterday late at night. */
const pad = (n: number) => String(n).padStart(2, '0')

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nowTime(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
