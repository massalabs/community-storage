import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Admin } from './pages/Admin'
import { Dashboard } from './pages/Dashboard'
import { Landing } from './pages/Landing'
import { MyDashboard } from './pages/MyDashboard'
import { Sandbox } from './pages/Sandbox'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/my-dashboard" element={<MyDashboard />} />
        <Route path="/sandbox" element={<Sandbox />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  )
}

export default App
