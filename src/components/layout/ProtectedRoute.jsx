import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { user, loading, hasMaster } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-sm text-muted-fg">Loading FinSight…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to={hasMaster ? '/login' : '/register'} state={{ from: location }} replace />;
  }
  return children;
}
