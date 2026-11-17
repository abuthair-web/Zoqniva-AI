import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';

const LOGIN_PRISM_IMG = '/src/assets/images/login_ai_prism_1794684778644.jpg';

type AuthViewMode = 'signin' | 'forgot';

export function AuthScreen() {
  const {
    isSupabaseReady,
    supabaseMissingReason,
    authStatus,
    authLoading,
    authError,
    profileAccessError,
    signInWithSupabase,
    resendConfirmationEmail,
    requestPasswordReset,
    logout,
  } = useApp();

  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthViewMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [localMsg, setLocalMsg] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const [imgError, setImgError] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setUnconfirmedEmail(null);

    if (!isSupabaseReady) {
      setLocalMsg({
        type: 'error',
        text: supabaseMissingReason || 'Workspace setup required: connect Supabase before signing in.',
      });
      return;
    }

    const res = await signInWithSupabase(email, password);
    if (res.ok) {
      navigate('/app');
    } else if (res.emailNotConfirmed) {
      setUnconfirmedEmail(email.trim());
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    const res = await requestPasswordReset(email);
    if (res.ok) {
      setLocalMsg({
        type: 'info',
        text: 'If an account exists for that email, a password reset link has been sent. Open the link to choose a new password.',
      });
    }
  };

  const handleResendConfirmation = async () => {
    if (!unconfirmedEmail) return;
    setLocalMsg(null);
    const res = await resendConfirmationEmail(unconfirmedEmail);
    if (res.ok) {
      setLocalMsg({
        type: 'info',
        text: `Confirmation email resent to ${unconfirmedEmail}. Please check your inbox.`,
      });
    } else if (res.error) {
      setLocalMsg({ type: 'error', text: res.error });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Left Brand & Artwork Panel */}
      <div className="lg:w-[48%] bg-gradient-to-br from-white via-[#EFF6FF]/60 to-white border-b lg:border-b-0 lg:border-r border-[#E2E8F0] p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <Link to="/">
            <BrandLogo size="sm" showTagline />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#2563EB] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Website</span>
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="my-10 space-y-6 max-w-lg mx-auto lg:mx-0"
        >
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-luxury relative overflow-hidden">
            <div className="pointer-events-none absolute top-3 left-3 h-5 w-5 border-t-2 border-l-2 border-[#F4B942]/80 rounded-tl-md" />
            <div className="pointer-events-none absolute bottom-3 right-3 h-5 w-5 border-b-2 border-r-2 border-[#F4B942]/80 rounded-br-md" />
            {!imgError ? (
              <img
                src={LOGIN_PRISM_IMG}
                alt="Zoqniva AI architectural glass prism illustration"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-56 sm:h-64 object-cover rounded-xl"
              />
            ) : (
              <div className="w-full h-56 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
                <Sparkles className="h-10 w-10 text-[#2563EB]" />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="h-[2px] w-7 bg-[#F4B942]" />
              <span className="text-xs font-semibold text-[#2563EB]">
                WhatsApp Business CRM Platform
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight [text-wrap:balance]">
              Intelligent Conversations.{' '}
              <span className="text-[#2563EB]">Seamless Automation.</span>
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sign in to access your shared team inbox, customer directory, approved WhatsApp
              templates, and workflow automation controls.
            </p>
          </div>
        </motion.div>

        <div className="relative z-10 pt-5 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2563EB]" />
            Supabase Auth &amp; Row Level Security
          </span>
          <span>Noor Labs</span>
        </div>
      </div>

      {/* Right Sign-In Form Surface */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-white">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="w-full max-w-md"
        >
          {authStatus === 'unauthorized_access' ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#E11D48]/30 bg-rose-50 p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-[#E11D48]">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <h2 className="font-display text-lg font-bold text-[#0F172A]">
                    Workspace Access Denied
                  </h2>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {profileAccessError ||
                    'Your account does not have an active business membership in this workspace.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold text-[#0F172A] hover:bg-slate-100 cursor-pointer"
              >
                <LogOut className="h-4 w-4 text-[#E11D48]" />
                <span>Sign Out &amp; Return to Login</span>
              </button>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight">
                  {mode === 'forgot' ? 'Reset your password' : 'Sign in to your workspace'}
                </h2>
                <p className="mt-1.5 text-sm text-slate-500">
                  {!isSupabaseReady
                    ? 'Connect your Supabase authentication backend to enable workspace sign-in.'
                    : mode === 'forgot'
                    ? 'Enter your work email and we will send a password reset link.'
                    : 'Enter your staff credentials to continue to Zoqniva AI.'}
                </p>
              </div>

              {!isSupabaseReady && (
                <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Supabase Connection Setup Required</p>
                    <p className="leading-relaxed text-amber-900">
                      {supabaseMissingReason ||
                        'Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment before signing in.'}
                    </p>
                  </div>
                </div>
              )}

              {(authError || localMsg) && (
                <div
                  className={`mb-5 rounded-xl border px-4 py-3 text-xs space-y-2 ${
                    localMsg?.type === 'info' && !authError
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-[#E11D48]/30 bg-rose-50 text-[#E11D48]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {localMsg?.type === 'info' && !authError ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <span>{authError || localMsg?.text}</span>
                  </div>
                  {unconfirmedEmail && (
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      className="text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Resend confirmation email to {unconfirmedEmail}
                    </button>
                  )}
                </div>
              )}

              {mode === 'forgot' ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                      Work Email
                    </label>
                    <div className="relative">
                      <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        required
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading || !isSupabaseReady}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    <KeyRound className="h-4 w-4" />
                    <span>{authLoading ? 'Sending reset link...' : 'Send Reset Link'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setLocalMsg(null);
                    }}
                    className="w-full text-center text-xs font-semibold text-slate-600 hover:text-[#2563EB] cursor-pointer pt-1"
                  >
                    Back to Sign In
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                      Work Email
                    </label>
                    <div className="relative">
                      <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        required
                        autoComplete="email"
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-[#0F172A]">
                        Password
                      </label>
                      {isSupabaseReady && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode('forgot');
                            setLocalMsg(null);
                          }}
                          className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        minLength={6}
                        autoComplete="current-password"
                        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading || !isSupabaseReady}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    <span>{authLoading ? 'Signing in...' : 'Sign In'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  {isSupabaseReady && (
                    <p className="text-center text-[11px] text-slate-500 pt-2">
                      Invite-only workspace. Contact your administrator for staff account access.
                    </p>
                  )}
                </form>
              )}
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
