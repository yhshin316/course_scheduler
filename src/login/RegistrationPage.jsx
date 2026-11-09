import { useState } from 'react'
import './RegistrationPage.css'

function RegistrationPage() {
  const [isManager, setIsManager] = useState(false)
  const [status, setStatus] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    /** @type {import('../Model/Registration.js').RegistrationRequest} */
    const registration = {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      role: isManager ? 'manager' : 'employee',
    }
    const accountType = registration.role === 'manager' ? 'Manager' : 'Regular employee'
    setStatus(`${accountType} registration is a preview and is not connected yet.`)
  }

  return (
    <section className="registration-page" aria-labelledby="registration-title">
      <div className="registration-card">
        <div className="registration-brand" aria-label="Margin">
          <span className="registration-mark" aria-hidden="true">M</span>
          <span>margin</span>
        </div>

        <p className="registration-eyebrow">CREATE AN ACCOUNT</p>
        <h1 id="registration-title">Join your team.</h1>
        <p className="registration-copy">Set up an account for your teaching workspace.</p>

        <form className="registration-form" onSubmit={handleSubmit} noValidate>
          <div className="registration-field">
            <label htmlFor="registration-name">Full name</label>
            <input
              id="registration-name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
            />
          </div>

          <div className="registration-field">
            <label htmlFor="registration-email">Email address</label>
            <input
              id="registration-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="registration-field">
            <label htmlFor="registration-password">Password</label>
            <input
              id="registration-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Create a password"
            />
          </div>

          <label className="registration-role" htmlFor="registration-manager">
            <input
              id="registration-manager"
              name="isManager"
              type="checkbox"
              checked={isManager}
              onChange={(event) => {
                setIsManager(event.target.checked)
                setStatus('')
              }}
            />
            <span className="registration-role-copy">
              <strong>Register as a manager</strong>
              <small>Leave unchecked to register as a regular employee.</small>
            </span>
          </label>

          <p className="registration-current-role" aria-live="polite">
            Account type: {isManager ? 'Manager' : 'Regular employee'}
          </p>

          <button className="registration-submit" type="submit">Create account</button>
          <p className="registration-status" aria-live="polite">{status}</p>
        </form>

        <p className="registration-note">Registration is a preview; no account will be created.</p>
      </div>
    </section>
  )
}

export default RegistrationPage