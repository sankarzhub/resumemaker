import { api } from './axios'

export interface User {
  id: string
  name: string
  email: string
}

export async function register(input: { name: string; email: string; password: string }): Promise<User> {
  return (await api.post('/auth/register', input)).data.data.user
}

export async function login(input: { email: string; password: string }): Promise<User> {
  return (await api.post('/auth/login', input)).data.data.user
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export async function fetchMe(): Promise<User> {
  return (await api.get('/auth/me')).data.data.user
}

export async function deleteAccount(): Promise<void> {
  await api.delete('/auth/me')
}

export async function fetchConfig(): Promise<{ aiAvailable: boolean; uploadTotalMb?: number | null }> {
  return (await api.get('/config')).data.data
}
