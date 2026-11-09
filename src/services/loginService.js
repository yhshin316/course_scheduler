import { postJson } from './apiService.js'

/** @param {import('../Model/Login.js').LoginCredentials} credentials */
export function login(credentials) {
  return postJson('/api/login', credentials)
}