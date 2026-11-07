export const sessionPath = '/_sweat/session'
export const forgetPath = '/_sweat/forget'
export const logoutPath = '/cdn-cgi/access/logout'
export const authorizationHeader = 'X-Sweat-Authorized'
export const expiryHeader = 'X-Sweat-Offline-Until'
export const offlineHeader = 'X-Sweat-Offline'
export const forgetHeader = 'X-Sweat-Forget'
export const maximumOfflineMs = 24 * 60 * 60 * 1000

export function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function validOfflineUntil(value: unknown, now = Date.now()) {
  if (typeof value !== 'string' || !/^[0-9]{13}$/.test(value)) return false
  const expiry = Number(value)
  return expiry > now && expiry <= now + maximumOfflineMs
}

export function authorizedSession(response: Response) {
  return response.status === 204 && response.headers.get(authorizationHeader) === '1'
}

