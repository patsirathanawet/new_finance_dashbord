import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, Eye, EyeOff, AlertCircle, CheckCircle, Loader2, Settings } from 'lucide-react';
import { useBmsSession } from '../hooks/useBmsSession';
import { extractErrorMessage, getSetupStatus } from '../lib/backendApi';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const { loginWithHosxp, loginWithDevAdmin } = useBmsSession();
  const navigate = useNavigate();

  // ตรวจสถานะ setup ตั้งแต่ mount — ถ้ายังไม่ configured ให้ redirect ไป /setup
  useEffect(() => {
    if (import.meta.env.DEV) {
      setCheckingSetup(false);
      return;
    }

    getSetupStatus()
      .then((s) => {
        if (!s.configured) {
          navigate('/setup', { replace: true });
          return;
        }
        setCheckingSetup(false);
      })
      .catch(() => setCheckingSetup(false));
  }, [navigate]);

  // กัน browser autofill — เคลียร์ค่าหลัง mount (บาง browser ignore autoComplete=off)
  useEffect(() => {
    const t = setTimeout(() => {
      setUsername('');
      setPassword('');
      const u = document.getElementById('username') as HTMLInputElement | null;
      const p = document.getElementById('password') as HTMLInputElement | null;
      if (u) u.value = '';
      if (p) p.value = '';
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('กรุณากรอก username และ password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loginWithHosxp(username.trim(), password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 600);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      // เคลียร์ช่องเตรียมกรอกใหม่ + focus กลับไปที่ username
      setUsername('');
      setPassword('');
      setTimeout(() => {
        document.getElementById('username')?.focus();
      }, 0);
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      await loginWithDevAdmin();
      setSuccess(true);
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 600);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  const assetBase = import.meta.env.BASE_URL || '/';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-500 to-primary-700 rounded-3xl shadow-soft mb-4 overflow-hidden">
            <img
              src={`${assetBase}bms-logo.png`}
              alt="BMS logo"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">BMS Finance Dashboard</h1>
          <p className="text-gray-500 mt-2 text-sm">เข้าสู่ระบบด้วยบัญชี HOSxP</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-soft overflow-hidden">
          <div className="bg-gradient-to-r from-primary-500 to-primary-700 px-6 py-4">
            <div className="flex items-center gap-2 text-white">
              <Lock className="w-4 h-4" />
              <span className="text-sm font-medium">เข้าสู่ระบบ HOSxP</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5" autoComplete="off">
            {/* Success */}
            {success && (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
                <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                <p className="text-sm text-emerald-700 font-medium">เข้าสู่ระบบสำเร็จ! กำลังโหลด...</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-2xl">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="username"
                  name="hosxp-username"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  placeholder="ชื่อผู้ใช้ HOSxP"
                  className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 bg-primary-50/50 transition-colors"
                  disabled={loading || success}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="password"
                  name="hosxp-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="รหัสผ่าน HOSxP"
                  className="w-full pl-10 pr-10 py-3 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 bg-primary-50/50 transition-colors"
                  disabled={loading || success}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || success || !username.trim() || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-500 to-primary-700 text-white font-semibold rounded-2xl hover:from-primary-600 hover:to-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-soft"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  กำลังตรวจสอบ...
                </>
              ) : success ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  สำเร็จ
                </>
              ) : (
                'เข้าสู่ระบบ'
              )}
            </button>
          </form>
        </div>

        {/* Info */}
        <div className="mt-6 p-5 bg-white rounded-2xl shadow-soft">
          <p className="text-xs text-primary-700 font-semibold mb-2">การเข้าใช้งาน</p>
          <ul className="text-xs text-gray-600 space-y-1.5 list-disc list-inside">
            <li>ใช้ username และ password เดียวกับการเข้าใช้ HOSxP</li>
            <li>ระบบจะตรวจสอบสิทธิ์ผ่านฐานข้อมูล HOSxP ของโรงพยาบาล</li>
            <li>หากเข้าสู่ระบบไม่ได้ ติดต่อ admin เพื่อตั้งค่าฐานข้อมูล</li>
          </ul>
          <button
            type="button"
            onClick={() => navigate('/setup')}
            className="mt-4 w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 hover:from-primary-600 hover:to-primary-800 rounded-2xl transition-all shadow-soft"
          >
            <Settings className="w-5 h-5" />
            ตั้งค่าฐานข้อมูล HOSxP
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={handleDevLogin}
              disabled={loading}
              className="mt-3 w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-gray-700 hover:bg-gray-800 rounded-2xl transition-all shadow-soft disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Lock className="w-5 h-5" />
              เข้าสู่ระบบแบบ Dev Admin
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          BMS Finance Dashboard &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
