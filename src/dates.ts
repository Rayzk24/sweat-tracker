export const timeZone = 'Europe/Paris'

const parisCalendar = new Intl.DateTimeFormat('fr-FR', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
})
const formats = {
  long: new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', dateStyle: 'long' }),
  short: new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' }),
  full: new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
}

export function parisDay(now = new Date()) {
  const parts = Object.fromEntries(parisCalendar.formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function calendarDate(day: string) {
  return new Date(`${day}T12:00:00.000Z`)
}

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < '0001-01-01') return false
  const date = calendarDate(value)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function formatDay(day: string, style: keyof typeof formats = 'long') {
  return formats[style].format(calendarDate(day))
}

export function capitalise(text: string) {
  return text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1)
}
