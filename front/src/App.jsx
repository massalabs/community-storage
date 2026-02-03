import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Admin } from './pages/Admin'
import { Landing } from './pages/Landing'
import { ProvideStorage } from './pages/ProvideStorage'
import { StoreFiles } from './pages/StoreFiles'
import { MyFiles } from './pages/MyFiles'
import { Sandbox } from './pages/Sandbox'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/provide-storage" element={<ProvideStorage />} />
        <Route path="/upload" element={<StoreFiles />} />
        <Route path="/store-files" element={<Navigate to="/upload" replace />} />
        <Route path="/my-files" element={<MyFiles />} />
        <Route path="/my-dashboard" element={<Navigate to="/provide-storage" replace />} />
        <Route path="/sandbox" element={<Sandbox />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  )
}

export default App
