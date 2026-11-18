import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';

const LOGIN_PRISM_IMG = '/src/assets/images/login_ai_prism_1794684778644.jpg';

export type AuthViewMode = 'signin' | 'signup' | 'forgot';

interface AuthScreenProps {
  mode?: AuthViewMode;
}

export function AuthScreen({ mode = 'signin' }: AuthScreenProps) {
  const {
    isSupabaseReady,
    supabaseMissingReason,
    authLoading,
    authError,
    signInWithSupabase,
    signUpWithSupabase,
    resendConfirmationEmail,
    requestPasswordReset,
  } = useApp();

  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [localMsg, setLocalMsg] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setLocalMsg(null);
    setUnconfirmedEmail(null);
  }, [mode]);

  const routeForMode = (target: AuthViewMode) => {
    if (target === 'signup') return '/register';
    if (target === 'forgot') return '/forgot-password';
    return '/login';
  };

  const switchMode = (nextMode: AuthViewMode) => {
    setLocalMsg(null);
    setUnconfirmedEmail(null);
    navigate(routeForMode(nextMode));
  };

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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setUnconfirmedEmail(null);

    if (!isSupabaseReady) {
      setLocalMsg({
        type: 'error',
        text: supabaseMissingReason || 'Workspace setup required: connect Supabase before creating an account.',
      });
      return;
    }

    if (fullName.trim().length < 2) {
      setLocalMsg({
        type: 'error',
        text: 'Please enter your full name (at least 2 characters).',
      });
      return;
    }

    if (password.length < 6) {
      setLocalMsg({
        type: 'error',
        text: 'Password must be at least 6 characters long.',
      });
      return;
    }

    if (password !== confirmPassword) {
      setLocalMsg({
        type: 'error',
        text: 'Password and Confirm Password do not match.',
      });
      return;
    }

    const res = await signUpWithSupabase({ fullName, email, password });
    if (!res.ok) {
      if (res.error) {
        setLocalMsg({ type: 'error', text: res.error });
      }
      return;
    }

    if (res.requiresEmailConfirmation) {
      setLocalMsg({
        type: 'info',
        text: 'Account created. Please confirm your email address, then sign in.',
      });
      navigate('/login');
      return;
    }

    navigate('/app');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);

    if (!isSupabaseReady) {
      setLocalMsg({
        type: 'error',
        text: supabaseMissingReason || 'Workspace setup required: connect Supabase first.',
      });
      return;
    }

    setForgotSubmitting(true);
    const res = await requestPasswordReset(email);
    setForgotSubmitting(false);

    if (res.ok) {
      setLocalMsg({
        type: 'info',
        text: `If an account exists for ${email.trim()}, a password reset link has been sent. Check your inbox and open the link to update your password.`,
      });
    } else if (res.error) {
      setLocalMsg({ type: 'error', text: res.error });
    }
  };

  const handleResendConfirmation = async () => {
    if (!unconfirmedEmail) return;
    setLocalMsg(null);
    const res = await resendConfirmationEmail(unconfirmedEmail);
    if (res.ok) {
      setLocalMsg({
        type: 'info',
        text: `Confirmation email resent to ${unconfirmedEmail}.`,
      });
    } else if (res.error) {
      setLocalMsg({ type: 'error', text: res.error });
    }
  };

  const activeError = localMsg?.type === 'error' ? localMsg.text : authError;
  const activeInfo = localMsg?.type === 'info' ? localMsg.text : null;

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
              Sign in or create an account to access your shared team inbox, customer directory,
              approved WhatsApp templates, and workflow automation controls.
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

      {/* Right Sign-In, Registration & Forgot-Password Surface */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-white">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="w-full max-w-md"
        >
          {mode !== 'forgot' && (
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="grid grid-cols-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-1 mb-6"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                onClick={() => switchMode('signin')}
                className={`rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'signin'
                    ? 'bg-white text-[#0F172A] shadow-2xs border border-[#E2E8F0]/80'
                    : 'text-slate-500 hover:text-[#0F172A]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                onClick={() => switchMode('signup')}
                className={`rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-white text-[#2563EB] shadow-2xs border border-[#E2E8F0]/80'
                    : 'text-slate-500 hover:text-[#0F172A]'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight">
              {mode === 'forgot'
                ? 'Forgot your password?'
                : mode === 'signup'
                ? 'Create your account'
                : 'Sign in to your workspace'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {!isSupabaseReady
                ? 'Connect your Supabase authentication backend to continue.'
                : mode === 'forgot'
                ? 'Enter your email address and we will send a password reset link.'
                : mode === 'signup'
                ? 'Register a Zoqniva AI account to request workspace access.'
                : 'Enter your email and password to continue to Zoqniva AI.'}
            </p>
          </div>

          {!isSupabaseReady && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Supabase Connection Setup Required</p>
                <p className="leading-relaxed text-amber-900">
                  {supabaseMissingReason ||
                    'Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment before continuing.'}
                </p>
              </div>
            </div>
          )}

          {(activeError || activeInfo) && (
            <div
              className={`mb-5 rounded-xl border px-4 py-3 text-xs space-y-2 ${
                activeInfo && !activeError
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-[#E11D48]/30 bg-rose-50 text-[#E11D48]'
              }`}
            >
              <div className="flex items-start gap-2">
                {activeInfo && !activeError ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{activeError || activeInfo}</span>
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
                <label
                  htmlFor="forgot-email"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="forgot-email"
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

              <button
                type="submit"
                disabled={forgotSubmitting || !isSupabaseReady}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <KeyRound className="h-4 w-4" />
                <span>{forgotSubmitting ? 'Sending reset link...' : 'Send Reset Link'}</span>
              </button>

              <div className="text-center pt-1">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#2563EB]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to Login</span>
                </Link>
              </div>
            </form>
          ) : mode === 'signup' ? (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label
                  htmlFor="signup-fullname"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signup-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    required
                    minLength={2}
                    autoComplete="name"
                    className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signup-email"
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
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password (min 6 characters)"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-confirm-password"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading || !isSupabaseReady}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <UserPlus className="h-4 w-4" />
                <span>{authLoading ? 'Creating account...' : 'Create Account'}</span>
              </button>

              <p className="text-center text-xs text-slate-500 pt-1">
                Already have an account?{' '}
                <Link to="/login" className="font-semibold text-[#2563EB] hover:underline">
                  Sign In
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label
                  htmlFor="signin-email"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signin-email"
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
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-[#2563EB] hover:underline"
                  >
                    Forgot Password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="signin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
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

              <p className="text-center text-xs text-slate-500 pt-1">
                New to Zoqniva AI?{' '}
                <Link to="/register" className="font-semibold text-[#2563EB] hover:underline">
                  Create Account
                </Link>
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
