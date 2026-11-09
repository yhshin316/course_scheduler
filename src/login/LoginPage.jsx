import { useState } from 'react'
import { login } from '../services/loginService.js'
import './LoginPage.css'

function LoginPage() {
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    /** @type {import('../Model/Login.js').LoginCredentials} */
    const credentials = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    }
    setIsSubmitting(true)
    setStatus('Sending sign-in request...')

    try {
      await login(credentials)
      setStatus('Login request completed successfully.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      setStatus(`Could not sign in: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="login-page" aria-labelledby="login-title">
      <div className="login-card">
        <div className="login-brand" aria-label="Margin">
          <span className="login-mark" aria-hidden="true">M</span>
          <span>margin</span>
        </div>

        <p className="login-eyebrow">ACCOUNT ACCESS</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="login-copy">Sign in to your teaching workspace.</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
            />
          </div>

          <button className="login-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="login-status" aria-live="polite">{status}</p>
        </form>

        <p className="login-note">No sign-in is required to explore the app.</p>
      </div>
    </section>
  )
}

export default LoginPage