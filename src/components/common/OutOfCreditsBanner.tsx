import React, { useState } from 'react';
import { AlertCircle, Play, KeyRound, Loader2, X } from 'lucide-react';
import { Button } from '../ui/Button';

export interface OutOfCreditsBannerProps {
  providerName: string;
  message?: string;
  onSaveAndResume: (newKey: string) => Promise<void> | void;
  onResume: () => Promise<void> | void;
  onDismiss?: () => void;
  isSaving?: boolean;
}

export const OutOfCreditsBanner: React.FC<OutOfCreditsBannerProps> = ({
  providerName,
  message,
  onSaveAndResume,
  onResume,
  onDismiss,
  isSaving = false,
}) => {
  const [newKey, setNewKey] = useState('');
  const [localSaving, setLocalSaving] = useState(false);

  const handleSaveAndResume = async () => {
    if (!newKey.trim()) {
      alert(`Please enter a valid ${providerName} API Key.`);
      return;
    }
    setLocalSaving(true);
    try {
      await onSaveAndResume(newKey.trim());
      setNewKey('');
    } finally {
      setLocalSaving(false);
    }
  };

  const busy = isSaving || localSaving;

  return (
    <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in transition-all">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle className="w-5 h-5 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-amber-900">
              {providerName} key is out of credits
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-amber-200/70 text-amber-900 border border-amber-300">
              Paused
            </span>
          </div>
          <p className="text-xs text-amber-800 mt-0.5 break-words">
            {message ||
              `The ${providerName} API key has run out of credits or quota. All fetched data has been preserved. Enter a new key below to continue processing from wherever it stopped.`}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <KeyRound className="w-3.5 h-3.5 text-amber-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKey.trim() && !busy) {
                    handleSaveAndResume();
                  }
                }}
                disabled={busy}
                placeholder={`Paste new ${providerName} API Key...`}
                className="w-full pl-8 pr-3 py-1.5 text-xs font-mono rounded-lg border border-amber-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 shadow-2xs text-slate-800 placeholder:text-amber-700/50"
              />
            </div>

            <Button
              size="sm"
              onClick={handleSaveAndResume}
              disabled={busy || !newKey.trim()}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1" />
                  Save Key & Resume
                </>
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onResume()}
              disabled={busy}
              className="text-xs border-amber-300 text-amber-900 hover:bg-amber-100/80"
            >
              Resume from Stopped
            </Button>
          </div>
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-700/70 hover:text-amber-900 p-1 rounded-md transition-colors"
          title="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
