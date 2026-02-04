import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Landing } from './pages/Landing'
import { ProvideStorage } from './pages/ProvideStorage'
import { StoreFiles } from './pages/StoreFiles'
import { MyFiles } from './pages/MyFiles'
import { Settings } from './pages/Settings'

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
        <Route path="/settings" element={<Settings />} />
        <Route path="/sandbox" element={<Navigate to="/" replace />} />
        <Route path="/admin" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
