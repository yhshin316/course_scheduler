import { NavLink } from 'react-router-dom'
import './Navigation.css'

const pages = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/course-input', label: 'Course input', icon: 'input' },
  { path: '/course-inputs', label: 'Course inputs', icon: 'course-list' },
  { path: '/profiles', label: 'Teacher profile', icon: 'teacher' },
  { path: '/employees', label: 'Employees', icon: 'employees' },
  { path: '/login', label: 'Login', icon: 'login' },
  { path: '/register', label: 'Register', icon: 'register' },
]

function Navigation({ isDarkMode, onToggleTheme }) {
  return (
    <aside className="navigation-sidebar">
      <div>
        <NavLink className="navigation-brand" to="/">
          <span className="navigation-mark" aria-hidden="true">M</span>
          <span>margin</span>
        </NavLink>

        <nav className="navigation-menu" aria-label="Main navigation">
          <p className="navigation-label">WORKSPACE</p>
          {pages.map((page) => (
            <NavLink
              key={page.path}
              className={({ isActive }) => `navigation-item${isActive ? ' is-active' : ''}`}
              to={page.path}
              end={page.path === '/'}
            >
              <span className={`navigation-icon icon-${page.icon}`} aria-hidden="true" />
              {page.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="navigation-bottom">
        <button
          className="theme-toggle"
          type="button"
          role="switch"
          aria-checked={isDarkMode}
          onClick={onToggleTheme}
        >
          <span className="theme-toggle-label">Dark mode</span>
          <span className="theme-toggle-track" aria-hidden="true">
            <span className="theme-toggle-thumb" />
          </span>
        </button>
        <div className="navigation-status">
          <span className="navigation-status-dot" aria-hidden="true" />
          Ready to write
        </div>
      </div>
    </aside>
  )
}

export default Navigation
