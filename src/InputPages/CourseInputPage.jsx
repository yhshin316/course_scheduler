import { useState } from 'react'
import { sendInput } from '../services/inputService.js'
import './CourseInputPage.css'

const STORAGE_KEY = 'course-inputs'

function saveLocalInput(input) {
  const savedInputs = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
  const inputs = Array.isArray(savedInputs) ? savedInputs : []
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([input, ...inputs]))
}

function CourseInputPage() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [isSending, setIsSending] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()

    if (!text.trim()) {
      setStatus('Enter course information before adding it.')
      return
    }

    /** @type {import('../Model/CourseInput.js').CourseInput} */
    const courseInput = {
      id: globalThis.crypto?.randomUUID?.() ?? `course-${Date.now()}`,
      text: text.trim(),
      submittedAt: new Date().toISOString(),
    }

    try {
      saveLocalInput(courseInput)
    } catch {
      setStatus('Could not save this course input in the browser.')
      return
    }

    setIsSending(true)
    setStatus('Sending course input...')

    try {
      await sendInput({ text: courseInput.text })
      setStatus('Course input added.')
      setText('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      setStatus(`Saved locally, but could not send to backend: ${message}`)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className="course-input-page">
      <section className="course-input-content" aria-labelledby="course-input-title">
        <p className="course-input-eyebrow">COURSE ENTRY</p>
        <h1 id="course-input-title">Add course information.</h1>

        <form className="course-input-panel" onSubmit={handleSubmit}>
          <label htmlFor="course-input-text">Course details</label>
          <input
            id="course-input-text"
            name="text"
            type="text"
            placeholder="Enter a course title or detail..."
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setStatus('')
            }}
          />
          <button type="submit" disabled={isSending}>
            {isSending ? 'Adding...' : 'Add course input'}
          </button>
          <p className="course-input-status" aria-live="polite">{status}</p>
        </form>
      </section>
    </section>
  )
}

export default CourseInputPage