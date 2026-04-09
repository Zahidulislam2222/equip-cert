'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { config } from '@/lib/config';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { MotionPage } from '@/components/motion/MotionPage';
import { StaggerContainer, StaggerItem } from '@/components/motion/StaggerGrid';

export default function SettingsPage() {
  const { profile, organization } = useAuth();

  return (
    <MotionPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold font-display text-foreground">Settings</h1>
        <p className="text-muted-foreground">Organization and account settings</p>
      </div>

      <StaggerContainer className="grid gap-6 md:grid-cols-2">
        {/* Profile Card */}
        <StaggerItem>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold font-display text-foreground mb-4">Your Profile</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="text-foreground font-medium">{profile?.full_name || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Role</p>
                <p className="text-foreground font-medium capitalize">{profile?.role || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Qualifications</p>
                <p className="text-foreground font-medium">{profile?.qualifications || 'Not set'}</p>
              </div>
            </div>
          </div>
        </StaggerItem>

        {/* Organization Card */}
        <StaggerItem>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold font-display text-foreground mb-4">Organization</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="text-foreground font-medium">{organization?.name || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Plan</p>
                <p className="text-foreground font-medium capitalize">{organization?.plan || 'free'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">App Version</p>
                <p className="text-foreground font-medium">{config.app.name} v1.0</p>
              </div>
            </div>
          </div>
        </StaggerItem>

        {/* Appearance */}
        <StaggerItem className="md:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-lg font-semibold font-display text-foreground mb-4">Appearance</h3>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Theme</p>
              <ThemeToggle />
            </div>
          </div>
        </StaggerItem>
      </StaggerContainer>
    </MotionPage>
  );
}
