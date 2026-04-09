'use client';

import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Pen, RotateCcw, Check } from 'lucide-react';

interface SignaturePadProps {
  onSave: (signatureDataUrl: string) => void;
  savedSignature: string | null;
  esignConsented?: boolean;
}

export function SignaturePad({ onSave, savedSignature, esignConsented }: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [hasConsented, setHasConsented] = useState(esignConsented || false);

  const handleClear = () => {
    sigRef.current?.clear();
    setIsEmpty(true);
  };

  const handleSave = () => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      const dataUrl = sigRef.current.getTrimmedCanvas().toDataURL('image/png');
      onSave(dataUrl);
      setIsOpen(false);
    }
  };

  if (savedSignature) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-success">
          <Check className="h-3.5 w-3.5" /> Signature captured
        </div>
        <div className="rounded-xl border border-success/20 bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={savedSignature} alt="Signature" className="h-16 w-full object-contain" />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => { onSave(''); setIsOpen(true); }} className="text-xs">
          Re-sign
        </Button>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="w-full gap-2 rounded-xl"
      >
        <Pen className="h-4 w-4" /> Add Digital Signature
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {/* ESIGN Act consent — must be affirmative before signing */}
      {!hasConsented && (
        <div className="rounded-xl border border-primary/20 bg-primary-light p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">Electronic Signature Consent</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            By checking this box, you AFFIRMATIVELY CONSENT to sign this equipment inspection
            record electronically under the ESIGN Act (15 U.S.C. &sect;7001). Your electronic
            signature has the same legal effect as a handwritten signature. Signed records cannot
            be modified after submission. You may withdraw consent by contacting your administrator.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              onChange={(e) => setHasConsented(e.target.checked)}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium text-foreground">I agree to sign electronically</span>
          </label>
        </div>
      )}

      {hasConsented && <p className="text-sm font-medium text-foreground">Sign below</p>}
      {hasConsented && <div className="rounded-xl border-2 border-dashed border-primary/30 bg-white overflow-hidden">
        <SignatureCanvas
          ref={sigRef}
          canvasProps={{
            className: 'w-full',
            style: { width: '100%', height: 150 },
          }}
          onBegin={() => setIsEmpty(false)}
          penColor="#1a1a2e"
          dotSize={2}
          minWidth={1.5}
          maxWidth={3}
        />
      </div>}
      {hasConsented && <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={handleClear} className="gap-2 rounded-xl flex-1">
          <RotateCcw className="h-4 w-4" /> Clear
        </Button>
        <Button type="button" onClick={handleSave} disabled={isEmpty} className="gap-2 rounded-xl flex-1">
          <Check className="h-4 w-4" /> Confirm Signature
        </Button>
      </div>}
    </div>
  );
}
