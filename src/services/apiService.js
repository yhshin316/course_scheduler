export const BACKEND_URL = 'https://your-backend-url.example'

export async function postJson(path, payload) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`)
  }

  return response
}

export async function getJson(path) {
  const response = await fetch(`${BACKEND_URL}${path}`)

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`)
  }

  return response.json()
}