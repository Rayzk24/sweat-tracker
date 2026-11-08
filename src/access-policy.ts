export const sessionPath = '/_sweat/session'
export const loginPath = '/_sweat/login'
export const logoutPath = '/_sweat/logout'

export function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
