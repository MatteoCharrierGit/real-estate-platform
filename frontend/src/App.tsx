import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/Guards';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import PropertyDetail from './pages/PropertyDetail';
import Login from './pages/Login';
import Callback from './pages/Callback';
import NotFound from './pages/NotFound';

// Pagine dell'area riservata caricate a richiesta: il visitatore anonimo scarica meno JavaScript.
const MyProperties = lazy(() => import('./pages/MyProperties'));
const PropertyEdit = lazy(() => import('./pages/PropertyEdit'));
const Offers = lazy(() => import('./pages/Offers'));
const Profile = lazy(() => import('./pages/Profile'));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount'));

const AGENT = ['agent', 'admin'] as const;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/callback" element={<Callback />} />
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="properties/:id" element={<PropertyDetail />} />
              <Route path="login" element={<Login />} />
              <Route path="agent/properties" element={<RequireAuth roles={[...AGENT]}><MyProperties /></RequireAuth>} />
              <Route path="agent/properties/new" element={<RequireAuth roles={[...AGENT]}><PropertyEdit key="new" /></RequireAuth>} />
              <Route path="agent/properties/:id/edit" element={<RequireAuth roles={[...AGENT]}><PropertyEdit /></RequireAuth>} />
              <Route path="offers" element={<RequireAuth><Offers /></RequireAuth>} />
              <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
              <Route path="profile/delete" element={<RequireAuth><DeleteAccount /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
