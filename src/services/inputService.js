import { getJson, postJson } from './apiService.js'

/** @param {import('../Model/CourseInput.js').CourseInputRequest} input */
export function sendInput(input) {
  return postJson('/api/input', { text: input.text })
}

/** @returns {Promise<import('../Model/CourseInput.js').CourseInput[]>} */
export async function getCourseInputs() {
  const response = await getJson('/api/input')
  const inputs = Array.isArray(response) ? response : response?.inputs

  if (!Array.isArray(inputs)) {
    throw new Error('The course inputs response must be a list.')
  }

  return inputs.map((input, index) => (
    typeof input === 'string' ? { id: `course-input-${index}`, text: input } : input
  ))
}

/** @param {import('../Model/Profile.js').Profile} profile */
export function sendTeacherProfile(profile) {
  return postJson('/api/teacher-profiles', profile)
}

/** @returns {Promise<import('../Model/Profile.js').Profile[]>} */
export async function getTeacherProfiles() {
  const response = await getJson('/api/teacher-profiles')
  const profiles = Array.isArray(response) ? response : response?.profiles

  if (!Array.isArray(profiles)) {
    throw new Error('The profiles response must be a list.')
  }

  return profiles
}