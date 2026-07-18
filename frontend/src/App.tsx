import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { Spinner, Toaster } from './components/ui'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Attendance from './pages/Attendance'
import Employees from './pages/Employees'
import Reports from './pages/Reports'
import Erp from './pages/Erp'
import Users from './pages/Users'
import Tenants from './pages/Tenants'
import Settings from './pages/Settings'
import Audit from './pages/Audit'
import Live from './pages/Live'
import LiveBoard from './pages/LiveBoard'
import Cameras from './pages/Cameras'
import Companies from './pages/Companies'
import Recordings from './pages/Recordings'
import NvrFootage from './pages/NvrFootage'
import Pipeline from './pages/Pipeline'
import { ReactNode } from 'react'

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <Spinner />
  return me ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Overview />} />
          <Route path="board" element={<LiveBoard />} />
          <Route path="live" element={<Live />} />
          <Route path="cameras" element={<Cameras />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="nvr" element={<NvrFootage />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="companies" element={<Companies />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="employees" element={<Employees />} />
          <Route path="reports" element={<Reports />} />
          <Route path="erp" element={<Erp />} />
          <Route path="users" element={<Users />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<Audit />} />
          <Route path="tenants" element={<Tenants />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
