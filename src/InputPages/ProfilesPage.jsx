import { useState } from 'react'
import { sendTeacherProfile } from '../services/inputService.js'
import './ProfilesPage.css'

const STORAGE_KEY = 'teacher-profile'
const EMPLOYEE_PROFILES_KEY = 'employee-profiles'
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function readProfile() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * @param {import('../Model/Profile.js').Profile} previousProfile
 * @param {import('../Model/Profile.js').Profile} updatedProfile
 */
function saveEmployeeProfile(previousProfile, updatedProfile) {
  let savedProfiles = []

  try {
    const storedProfiles = JSON.parse(window.localStorage.getItem(EMPLOYEE_PROFILES_KEY) ?? 'null')
    if (Array.isArray(storedProfiles)) {
      savedProfiles = storedProfiles
    } else {
      const currentProfile = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (currentProfile && typeof currentProfile === 'object') savedProfiles = [currentProfile]
    }
  } catch {
    savedProfiles = []
  }

  const profileIndex = savedProfiles.findIndex((savedProfile) => {
    if (previousProfile.id != null) return savedProfile.id === previousProfile.id
    if (previousProfile.email) return savedProfile.email === previousProfile.email
    return savedProfile.name === previousProfile.name
  })

  const nextProfiles = [...savedProfiles]
  if (profileIndex === -1) {
    nextProfiles.push(updatedProfile)
  } else {
    nextProfiles[profileIndex] = updatedProfile
  }

  window.localStorage.setItem(EMPLOYEE_PROFILES_KEY, JSON.stringify(nextProfiles))
}

function ProfilesPage({ displayProfile, onBack }) {
  const isEmployeeProfile = displayProfile != null
  const [profile, setProfile] = useState(() => displayProfile ?? readProfile())
  const [status, setStatus] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    /** @type {import('../Model/Profile.js').Profile} */
    const nextProfile = {
      ...profile,
      ...Object.fromEntries(formData.entries()),
      availability: formData.getAll('availability'),
    }

    try {
      if (isEmployeeProfile) {
        saveEmployeeProfile(profile, nextProfile)
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile))
      }
      setProfile(nextProfile)
      setIsEditing(false)
    } catch {
      setStatus('Could not save this profile in the browser.')
      return
    }

    setIsSending(true)
    setStatus('Sending profile...')

    try {
      await sendTeacherProfile(nextProfile)
      setStatus('Profile sent successfully.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      setStatus(`Saved in this browser, but could not send to backend: ${message}`)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className="teacher-profile-page" aria-labelledby="teacher-profile-title">
      <div className="teacher-profile-content">
        {isEmployeeProfile && (
          <button
            className="teacher-profile-back"
            type="button"
            onClick={onBack}
            disabled={isSending}
          >
            Back to employees
          </button>
        )}
        <p className="teacher-profile-eyebrow">{isEmployeeProfile ? 'EMPLOYEE DETAILS' : 'TEACHER DETAILS'}</p>
        <h1 id="teacher-profile-title">
          {isEmployeeProfile ? profile.name || 'Employee profile' : 'Build your teaching profile.'}
        </h1>
        {!isEmployeeProfile && <p className="teacher-profile-intro">Share a little about what and when you teach.</p>}

        <form className="teacher-profile-form" onSubmit={handleSubmit}>
          <div className="teacher-profile-fields">
            <div className="teacher-field">
              <label htmlFor="teacher-name">Full name</label>
              <input id="teacher-name" name="name" type="text" autoComplete="name" defaultValue={profile.name ?? ''} disabled={!isEditing || isSending} />
            </div>

            <div className="teacher-field">
              <label htmlFor="teacher-email">Email</label>
              <input id="teacher-email" name="email" type="email" autoComplete="email" defaultValue={profile.email ?? ''} disabled={!isEditing || isSending} />
            </div>

            <div className="teacher-field">
              <label htmlFor="teacher-subject">Primary subject</label>
              <select id="teacher-subject" name="subject" defaultValue={profile.subject ?? ''} disabled={!isEditing || isSending}>
                <option value="" disabled>Select a subject</option>
                <option>Math</option>
                <option>Science</option>
                <option>English</option>
                <option>Languages</option>
                <option>History</option>
                <option>Arts</option>
                <option>Other</option>
              </select>
            </div>

            <div className="teacher-field">
              <label htmlFor="teacher-level">Student level</label>
              <select id="teacher-level" name="studentLevel" defaultValue={profile.studentLevel ?? ''} disabled={!isEditing || isSending}>
                <option value="" disabled>Select a level</option>
                <option>Elementary</option>
                <option>Middle school</option>
                <option>High school</option>
                <option>College</option>
                <option>Adult learners</option>
                <option>All levels</option>
              </select>
            </div>

            <div className="teacher-field">
              <label htmlFor="preferred-time">Preferred teaching time</label>
              <select id="preferred-time" name="preferredTime" defaultValue={profile.preferredTime ?? ''} disabled={!isEditing || isSending}>
                <option value="" disabled>Select a time</option>
                <option>Morning</option>
                <option>Afternoon</option>
                <option>Evening</option>
                <option>Flexible</option>
              </select>
            </div>

            <div className="teacher-field">
              <label htmlFor="teaching-format">Teaching format</label>
              <select id="teaching-format" name="format" defaultValue={profile.format ?? ''} disabled={!isEditing || isSending}>
                <option value="" disabled>Select a format</option>
                <option>Online</option>
                <option>In person</option>
                <option>Either</option>
              </select>
            </div>

            <div className="teacher-field">
              <label htmlFor="experience">Years of experience</label>
              <input
                id="experience"
                name="experienceYears"
                type="number"
                min="0"
                max="60"
                defaultValue={profile.experienceYears ?? ''}
                disabled={!isEditing || isSending}
              />
            </div>

            <fieldset className="teacher-availability" disabled={!isEditing || isSending}>
              <legend>Available days</legend>
              <div className="teacher-days">
                {weekdays.map((day) => (
                  <label className="teacher-day" key={day}>
                    <input
                      type="checkbox"
                      name="availability"
                      value={day}
                      defaultChecked={profile.availability?.includes(day) ?? false}
                    />
                    <span>{day.slice(0, 3)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="teacher-field teacher-bio-field">
              <label htmlFor="teacher-bio">Short introduction</label>
              <textarea
                id="teacher-bio"
                name="bio"
                rows="4"
                maxLength="500"
                placeholder="Tell students a little about your teaching approach..."
                defaultValue={profile.bio ?? ''}
                disabled={!isEditing || isSending}
              />
            </div>
          </div>

          <div className="teacher-profile-actions">
            <p className="teacher-profile-status" aria-live="polite">{status}</p>
            {isEditing ? (
              <button type="submit" disabled={isSending}>
                {isSending ? 'Sending...' : 'Save profile'}
              </button>
            ) : (
              <button
                type="button"
                disabled={isSending}
                onClick={(event) => {
                  event.preventDefault()
                  setIsEditing(true)
                  setStatus('')
                }}
              >
                Edit
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}

export default ProfilesPage
