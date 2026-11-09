import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import CourseInputPage from './InputPages/CourseInputPage.jsx'
import ProfilesPage from './InputPages/ProfilesPage.jsx'
import LoginPage from './login/LoginPage.jsx'
import RegistrationPage from './login/RegistrationPage.jsx'
import EmployeeProfilesPage from './Display/EmployeeProfilesPage.jsx'
import CourseInputsPage from './Display/CourseInputsPage.jsx'

function WelcomePage() {
  return (
    <section className="welcome-page" aria-labelledby="welcome-title">
      <h1 id="welcome-title">Welcome</h1>
    </section>
  )
}

function EmployeesRoute() {
  const navigate = useNavigate()

  return (
    <EmployeeProfilesPage
      onSelectProfile={(profile) => navigate('/employees/detail', { state: { profile } })}
    />
  )
}

function EmployeeDetailRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = location.state?.profile

  if (!profile) return <Navigate to="/employees" replace />

  return (
    <ProfilesPage
      displayProfile={profile}
      onBack={() => navigate('/employees')}
    />
  )
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/course-input" element={<CourseInputPage />} />
      <Route path="/course-inputs" element={<CourseInputsPage />} />
      <Route path="/profiles" element={<ProfilesPage />} />
      <Route path="/employees" element={<EmployeesRoute />} />
      <Route path="/employees/detail" element={<EmployeeDetailRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default AppRouter