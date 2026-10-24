import axios, { AxiosError } from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  withCredentials: true,
  timeout: 60_000,
  // Double-submit CSRF: axios copies the rc_csrf cookie into this header on every request.
  xsrfCookieName: 'rc_csrf',
  xsrfHeaderName: 'x-csrf-token',
  withXSRFToken: true,
})

interface ApiErrorBody {
  success: false
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> }
}

export function getErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as ApiErrorBody | undefined
    if (body?.error?.details?.length) return `${body.error.message} ${body.error.details.map((d) => `${d.path}: ${d.message}`).join('; ')}`
    if (body?.error?.message) return body.error.message
    if (err.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the API running?'
    if (err.code === 'ECONNABORTED') return 'The request timed out. Please try again.'
  }
  return fallback
}

export function getErrorStatus(err: unknown): number | undefined {
  return err instanceof AxiosError ? err.response?.status : undefined
}
