import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import SetupPage from '../pages/SetupPage';
import OverviewPage from '../pages/OverviewPage';
import NHSOPage from '../pages/NHSOPage';
import GovernmentPage from '../pages/GovernmentPage';
import GovUploadPage from '../pages/GovUploadPage';
import GovREPPage from '../pages/GovREPPage';
import GovSTMPage from '../pages/GovSTMPage';
import SocialPage from '../pages/SocialPage';
import InsurancePage from '../pages/InsurancePage';
import SelfPayPage from '../pages/SelfPayPage';
import IPDPage from '../pages/IPDPage';
import ERPage from '../pages/ERPage';
import OPDPage from '../pages/OPDPage';
import DbConfigPage from '../pages/DbConfigPage';
import ClaimDbConfigPage from '../pages/ClaimDbConfigPage';
import EclaimFundDashboard from '../pages/EclaimFundDashboard';
import { RedirectIfAuthed, RequireAuth } from './AuthGuards';

export const router = createBrowserRouter([
  {
    path: '/setup',
    element: <SetupPage />,
  },
  {
    path: '/login',
    element: <RedirectIfAuthed />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'claims', element: <GovUploadPage /> },
      { path: 'eclaim/:fundSlug', element: <EclaimFundDashboard /> },
      { path: 'nhso', element: <NHSOPage /> },
      { path: 'government', element: <GovernmentPage /> },
      { path: 'government/rep/:id', element: <GovREPPage /> },
      { path: 'government/stm/:id', element: <GovSTMPage /> },
      { path: 'social', element: <SocialPage /> },
      { path: 'insurance', element: <InsurancePage /> },
      { path: 'self-pay', element: <SelfPayPage /> },
      { path: 'ipd', element: <IPDPage /> },
      { path: 'er', element: <ERPage /> },
      { path: 'opd', element: <OPDPage /> },
      { path: 'settings/db-config', element: <DbConfigPage /> },
      { path: 'settings/claim-db', element: <ClaimDbConfigPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
], { basename: import.meta.env.BASE_URL });
