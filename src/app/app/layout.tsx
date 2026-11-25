'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { HelpAssistant } from '@/components/shared/HelpAssistant';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
      <HelpAssistant />
    </ProtectedRoute>
  );
}
