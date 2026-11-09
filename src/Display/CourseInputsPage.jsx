import { useEffect, useState } from 'react'
import { getCourseInputs } from '../services/inputService.js'
import './CourseInputsPage.css'

const STORAGE_KEY = 'course-inputs'

function readLocalInputs() {
  try {
    const savedInputs = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(savedInputs) ? savedInputs.filter((input) => typeof input?.text === 'string') : []
  } catch {
    return []
  }
}

function formatSubmittedAt(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function CourseInputsPage() {
  const [courseInputs, setCourseInputs] = useState(readLocalInputs)
  const [isLoading, setIsLoading] = useState(true)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let isCurrent = true

    getCourseInputs()
      .then((inputs) => {
        if (!isCurrent) return
        setCourseInputs(inputs.filter((input) => typeof input?.text === 'string'))
        setNotice('')
      })
      .catch(() => {
        if (!isCurrent) return
        setNotice(courseInputs.length > 0
          ? 'Showing locally saved course inputs. Connect the backend to sync the list.'
          : 'Backend unavailable. Add entries to build this list.')
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  return (
    <section className="course-list-page" aria-labelledby="course-list-title">
      <div className="course-list-content">
        <p className="course-list-eyebrow">COURSE MATERIALS</p>
        <div className="course-list-heading">
          <div>
            <h1 id="course-list-title">Course inputs</h1>
            <p>Submitted course information.</p>
          </div>
          <span className="course-list-count">{courseInputs.length} {courseInputs.length === 1 ? 'entry' : 'entries'}</span>
        </div>

        {notice && <p className="course-list-notice" role="status">{notice}</p>}

        <div className="course-list-table-wrap">
          <table className="course-list-table">
            <thead>
              <tr>
                <th scope="col">Course input</th>
                <th scope="col">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {courseInputs.map((input, index) => (
                <tr key={input.id ?? `${input.submittedAt ?? 'entry'}-${index}`}>
                  <td className="course-list-text">{input.text}</td>
                  <td className="course-list-date">{formatSubmittedAt(input.submittedAt ?? input.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {isLoading && <p className="course-list-empty">Loading course inputs...</p>}
          {!isLoading && courseInputs.length === 0 && (
            <p className="course-list-empty">No course inputs yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export default CourseInputsPage