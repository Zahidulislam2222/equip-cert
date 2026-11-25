'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getProfile, getOrganization, completeOnboarding, discardPendingInvite } from '@/lib/auth';
import type { Profile, Organization } from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  isLoading: boolean;
  /** Why automatic onboarding failed (e.g. an expired invitation), shown on the onboarding screen. */
  onboardingError: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  organization: null,
  isLoading: true,
  onboardingError: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const loadUserData = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setProfile(null);
      setOrganization(null);
      return;
    }

    let userProfile = await getProfile(currentUser.id);

    // A confirmed account with no profile: finish onboarding here, in a signed-in session —
    // redeem a parked invitation, or create the organisation named at signup (DEF-045). Both
    // are one server-side transaction, so a dropped connection cannot strand half a tenant.
    if (!userProfile) {
      try {
        if (await completeOnboarding()) {
          setOnboardingError(null);
          userProfile = await getProfile(currentUser.id);
        }
      } catch (err) {
        setOnboardingError(err instanceof Error ? err.message : 'Could not finish setting up your account.');
      }
    }
    // Already in an organisation: an invitation parked on this device is not for this account
    // (one organisation per account), and must not wait for the next one.
    if (userProfile) discardPendingInvite();
    setProfile(userProfile);

    if (userProfile?.org_id) {
      const org = await getOrganization(userProfile.org_id);
      setOrganization(org);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadUserData(user);
  }, [user, loadUserData]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      loadUserData(s?.user ?? null).finally(() => setIsLoading(false));
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        await loadUserData(s?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadUserData]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setOrganization(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        organization,
        isLoading,
        onboardingError,
        signOut: handleSignOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
