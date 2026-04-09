'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { AlertTriangle, Loader2, X, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Camera as CapCamera, CameraResultType } from '@capacitor/camera';

interface CorrectiveActionFormProps {
  inspectionId: number;
  checklistItemId: string;
  questionText: string;
  onClose: () => void;
  onSubmitted: () => void;
}

type Severity = 'critical' | 'major' | 'minor';

export function CorrectiveActionForm({
  inspectionId,
  checklistItemId,
  questionText,
  onClose,
  onSubmitted,
}: CorrectiveActionFormProps) {
  const { profile, organization } = useAuth();
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const severityOptions: { value: Severity; label: string; color: string }[] = [
    { value: 'critical', label: 'Critical', color: 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' },
    { value: 'major', label: 'Major', color: 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
    { value: 'minor', label: 'Minor', color: 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' },
  ];

  const takePhoto = async () => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
      });
      if (image.webPath) {
        setPhotoUrl(image.webPath);
      }
    } catch {
      // Camera cancelled
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setIsSubmitting(true);
    setError('');

    try {
      let uploadedPhotoUrl: string | null = null;

      if (photoUrl) {
        const response = await fetch(photoUrl);
        const blob = await response.blob();
        const fileName = `corrective-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(fileName, blob);

        if (!uploadError) {
          const { data } = supabase.storage.from('photos').getPublicUrl(fileName);
          uploadedPhotoUrl = data.publicUrl;
        }
      }

      const { error: insertError } = await supabase.from('corrective_actions').insert({
        organization_id: organization?.id,
        inspection_id: inspectionId,
        checklist_item_id: checklistItemId,
        description: description.trim(),
        severity,
        assigned_to: null,
        photo_url: uploadedPhotoUrl,
        status: severity === 'critical' ? 'open' : 'open',
      });

      if (insertError) throw insertError;
      onSubmitted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-card rounded-t-2xl sm:rounded-2xl shadow-elevated border border-border max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold font-display text-foreground">Report Issue</h3>
              <p className="text-xs text-muted-foreground">Failed checklist item</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted transition-colors">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Failed Item */}
          <div className="rounded-xl bg-destructive/5 border border-destructive/10 p-3">
            <p className="text-sm text-foreground font-medium">{questionText}</p>
          </div>

          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Severity */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Severity</label>
            <div className="flex gap-2">
              {severityOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSeverity(opt.value)}
                  className={cn(
                    'flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-all',
                    severity === opt.value ? opt.color : 'border-border bg-card text-muted-foreground hover:bg-muted'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              placeholder="Describe the issue found..."
              className="w-full rounded-xl border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
            />
          </div>

          {/* Photo Evidence */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Photo Evidence</label>
            {photoUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Issue evidence" className="w-full h-40 object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotoUrl(null)}
                  className="absolute top-2 right-2 rounded-lg bg-black/50 p-1.5 text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={takePhoto} className="w-full gap-2 rounded-xl">
                <Camera className="h-4 w-4" /> Add Photo
              </Button>
            )}
          </div>

          {/* Submit */}
          <Button type="submit" disabled={isSubmitting || !description.trim()} variant="destructive" className="w-full gap-2 h-12 rounded-xl">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
            {isSubmitting ? 'Submitting...' : 'Submit Corrective Action'}
          </Button>
        </form>
      </div>
    </div>
  );
}
