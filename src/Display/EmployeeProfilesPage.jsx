import { useEffect, useState } from 'react'
import { getTeacherProfiles } from '../services/inputService.js'
import './EmployeeProfilesPage.css'

function hasEmployeeName(profile) {
  return typeof profile?.name === 'string' && profile.name.trim().length > 0
}

function readLocalProfiles() {
  try {
    const savedList = JSON.parse(window.localStorage.getItem('employee-profiles') ?? 'null')
    if (Array.isArray(savedList)) return savedList.filter(hasEmployeeName)

    const savedProfile = JSON.parse(window.localStorage.getItem('teacher-profile') ?? 'null')
    return hasEmployeeName(savedProfile) ? [savedProfile] : []
  } catch {
    return []
  }
}

function EmployeeProfilesPage({ onSelectProfile }) {
  const [profiles, setProfiles] = useState(readLocalProfiles)
  const [isLoading, setIsLoading] = useState(true)
  const [source, setSource] = useState('')
  const profilesToDisplay = profiles.length > 0
    ? profiles
    : isLoading
      ? []
      : [{ id: 'example-employee', name: 'Example Employee', isExample: true }]

  useEffect(() => {
    let isCurrent = true

    getTeacherProfiles()
      .then((nextProfiles) => {
        if (!isCurrent) return
        const namedProfiles = nextProfiles.filter(hasEmployeeName)
        setProfiles(namedProfiles)
        setSource(namedProfiles.length === 0 ? 'No employee data yet. Showing an example row.' : '')
      })
      .catch(() => {
        if (!isCurrent) return
        setSource(profiles.length > 0
          ? 'Showing locally saved profiles. Connect the backend to load all employees.'
          : 'Backend unavailable. Showing an example row.')
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  return (
    <section className="employee-list-page" aria-labelledby="employee-list-title">
      <div className="employee-list-content">
        <p className="employee-list-eyebrow">MANAGER WORKSPACE</p>
        <div className="employee-list-heading">
          <div>
            <h1 id="employee-list-title">Employee profiles</h1>
            <p>Browse the names of employees on your team.</p>
          </div>
          <span className="employee-list-count">{profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}</span>
        </div>

        {source && <p className="employee-list-source" role="status">{source}</p>}

        <div className="employee-list-table-wrap">
          <table className="employee-list-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
              </tr>
            </thead>
            <tbody>
                  {profilesToDisplay.map((profile, index) => (
                    <tr key={profile.id ?? profile.email ?? `${profile.name ?? 'employee'}-${index}`}>
                      <td className="employee-list-cell">
                        <button
                          className="employee-list-button"
                          type="button"
                          onClick={() => onSelectProfile(profile)}
                        >
                          <span className="employee-list-name">
                            {typeof profile.name === 'string' && profile.name.trim() ? profile.name : 'Name not provided'}
                            {profile.isExample && <span className="employee-list-example">Example</span>}
                          </span>
                          <span className="employee-list-open">View profile</span>
                        </button>
                      </td>
                </tr>
              ))}
            </tbody>
          </table>

          {isLoading && <p className="employee-list-empty">Loading profiles...</p>}
        </div>
      </div>
    </section>
  )
}

export default EmployeeProfilesPage