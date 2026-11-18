import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';

type RecoveryViewState = 'checking' | 'ready' | 'invalid' | 'success';

export function UpdatePasswordScreen() {
  const { isSupabaseReady, authLoading, passwordRecoveryActive, updatePassword } = useApp();
  const location = useLocation();

  const [viewState, setViewState] = useState<RecoveryViewState>('checking');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [linkErrorMsg, setLinkErrorMsg] = useState<string | null>(null);

  const recoveryProcessedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseReady || !supabase) {
      setViewState('invalid');
      setLinkErrorMsg('Supabase configuration is required to process password recovery links.');
      return;
    }

    if (completedRef.current) return;

    let active = true;
    const client = supabase;

    const inspectRecoverySession = async () => {
      const searchParams = new URLSearchParams(location.search || window.location.search);
      const rawHash = location.hash || window.location.hash;
      const hashClean = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
      const hashParams = new URLSearchParams(hashClean);

      const urlError = hashParams.get('error') || searchParams.get('error');
      const urlErrorCode = hashParams.get('error_code') || searchParams.get('error_code');
      const urlErrorDesc =
        hashParams.get('error_description') || searchParams.get('error_description');

      if (urlError || urlErrorDesc) {
        if (!active) return;
        const readable =
          urlErrorCode === 'otp_expired'
            ? 'This password reset link has expired. Please request a new reset link.'
            : urlErrorDesc
            ? urlErrorDesc.replace(/\+/g, ' ')
            : 'This password reset link is invalid or has expired.';
        setLinkErrorMsg(readable);
        setViewState('invalid');
        return;
      }

      // Let Supabase client (detectSessionInUrl: true) finish processing #access_token or ?code
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (!active) return;

      if (sessionErr) {
        setLinkErrorMsg(sessionErr.message || 'Unable to validate recovery session.');
        setViewState('invalid');
        return;
      }

      if (sessionData.session?.user || passwordRecoveryActive) {
        setLinkErrorMsg(null);
        setViewState('ready');
        return;
      }

      // Support token_hash recovery templates (?token_hash=...&type=recovery) once without double-consuming
      const tokenHash = searchParams.get('token_hash');
      const typeParam = searchParams.get('type');
      if (tokenHash && typeParam === 'recovery' && !recoveryProcessedRef.current) {
        recoveryProcessedRef.current = true;
        const { data: otpData, error: otpErr } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });
        if (!active) return;
        if (otpErr || !otpData.session) {
          setLinkErrorMsg(
            otpErr?.message || 'This password reset link is invalid or has expired.'
          );
          setViewState('invalid');
          return;
        }
        setLinkErrorMsg(null);
        setViewState('ready');
        return;
      }

      // Wait until global auth initialization completes before declaring missing/expired session
      if (!authLoading) {
        setLinkErrorMsg(
          'This password reset link is missing, invalid, or has expired. Request a new link below.'
        );
        setViewState('invalid');
      }
    };

    void inspectRecoverySession();

    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (!active || completedRef.current) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session?.user)) {
        setLinkErrorMsg(null);
        setViewState('ready');
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [authLoading, isSupabaseReady, location.hash, location.search, passwordRecoveryActive]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New Password and Confirm New Password do not match.');
      return;
    }

    setSubmitting(true);
    const res = await updatePassword(newPassword);
    setSubmitting(false);

    if (!res.ok) {
      setErrorMsg(res.error || 'Unable to update password. Please request a new reset link.');
      return;
    }

    completedRef.current = true;
    setViewState('success');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-6 sm:p-10">
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <Link to="/">
          <BrandLogo size="sm" showTagline />
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#2563EB]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Login</span>
        </Link>
      </div>

      <div className="max-w-md w-full mx-auto rounded-2xl border border-[#E2E8F0] bg-white p-6 sm:p-8 shadow-luxury space-y-5 my-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Account Recovery</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight">
            Update your password
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Choose a new password for your Zoqniva AI account.
          </p>
        </div>

        {viewState === 'checking' ? (
          <div className="py-8 text-center space-y-2.5">
            <div className="h-7 w-7 rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin mx-auto" />
            <p className="text-xs font-medium text-slate-500">
              Verifying your password recovery session...
            </p>
          </div>
        ) : viewState === 'success' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-xs text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Password updated successfully</p>
                <p className="text-emerald-800 leading-relaxed">
                  Your password has been saved. You can now sign in with your new password.
                </p>
              </div>
            </div>
            <Link
              to="/login"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors"
            >
              <span>Continue to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : viewState === 'invalid' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                {linkErrorMsg ||
                  'This password reset link is missing, invalid, or has expired.'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Link
                to="/forgot-password"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Request New Reset Link</span>
              </Link>
              <Link
                to="/login"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
              >
                <span>Back to Login</span>
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="rounded-xl border border-[#E11D48]/30 bg-rose-50 px-4 py-3 text-xs text-[#E11D48] flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="update-new-password"
                className="block text-xs font-semibold text-[#0F172A] mb-1.5"
              >
                New Password
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="update-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="update-confirm-password"
                className="block text-xs font-semibold text-[#0F172A] mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="update-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={
                    showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                  }
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
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <span>{submitting ? 'Updating password...' : 'Update Password'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>

      <div className="max-w-md w-full mx-auto flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[#2563EB]" />
          Supabase Auth Recovery
        </span>
        <span>Noor Labs</span>
      </div>
    </div>
  );
}
