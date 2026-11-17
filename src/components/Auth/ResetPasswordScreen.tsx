import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useApp } from '@/context/AppContext';

export function ResetPasswordScreen() {
  const {
    isSupabaseReady,
    authStatus,
    authLoading,
    passwordRecoveryActive,
    updatePassword,
  } = useApp();

  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hasActiveSessionForReset =
    passwordRecoveryActive || authStatus === 'authenticated';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await updatePassword(newPassword);
    setSubmitting(false);

    if (!res.ok) {
      setErrorMsg(res.error || 'Unable to update password. Please request a new reset link.');
      return;
    }

    setSuccessMsg('Your password has been updated successfully.');
    setTimeout(() => {
      navigate('/app');
    }, 1200);
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
          <span>Sign In</span>
        </Link>
      </div>

      <div className="max-w-md w-full mx-auto rounded-2xl border border-[#E2E8F0] bg-white p-6 sm:p-8 shadow-luxury space-y-5 my-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-[2px] w-5 bg-[#F4B942]" />
            <span className="text-xs font-semibold text-[#2563EB]">Account Recovery</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight">
            Set a new password
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Choose a strong password for your Zoqniva AI staff account.
          </p>
        </div>

        {!isSupabaseReady ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
            <span>Supabase configuration is required to complete password recovery.</span>
          </div>
        ) : authLoading ? (
          <div className="py-8 text-center space-y-2">
            <div className="h-7 w-7 rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Verifying recovery link...</p>
          </div>
        ) : !hasActiveSessionForReset && !successMsg ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-[#F4B942] shrink-0 mt-0.5" />
              <span>
                This password reset link is missing or has expired. Return to Sign In to request a fresh reset email.
              </span>
            </div>
            <Link
              to="/login"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <span>Return to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="rounded-xl border border-[#E11D48]/30 bg-rose-50 px-4 py-3 text-xs text-[#E11D48]">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                New Password
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-[#0F172A] focus:bg-white focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || Boolean(successMsg)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span>{submitting ? 'Updating password...' : 'Save New Password'}</span>
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
