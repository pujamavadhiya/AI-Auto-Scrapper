import React from 'react';
import { Activity, Clock, Users, ShieldAlert, XCircle, CheckCircle2 } from 'lucide-react';
import { ResearchProgress } from '../../types';
import { Button } from '../ui/Button';

interface ProgressIndicatorProps {
  progress: ResearchProgress;
  onCancel: () => void;
  moduleName?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  progress,
  onCancel,
  moduleName = 'Research Pipeline',
}) => {
  if (!progress.isActive && progress.status !== 'running') {
    return null;
  }

  return (
    <div className="rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/50 to-white p-5 shadow-sm space-y-4">
      {/* Header & Stage */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/25 shrink-0">
            <Activity className="w-5 h-5 animate-spin" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900">{moduleName} Executing</h4>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                Simulating Crawl
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              {progress.stageMessage || 'Analyzing accounts and resolving data points...'}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="self-start sm:self-auto h-8 text-xs text-slate-700 hover:text-rose-600 hover:border-rose-300"
        >
          <XCircle className="w-3.5 h-3.5 mr-1" />
          Cancel Run
        </Button>
      </div>

      {/* Progress Bar with animated shimmer */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs font-semibold">
          <span className="text-slate-700">
            Processing: <span className="text-blue-600 font-bold">{progress.currentItemName || 'Initializing...'}</span>
          </span>
          <span className="text-slate-900 font-bold font-mono">
            {progress.percentage}%
          </span>
        </div>

        <div className="relative w-full h-3 bg-slate-200/80 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(2, progress.percentage))}%` }}
          />
        </div>
      </div>

      {/* Live Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-white/80 border border-slate-200/60">
          <Users className="w-4 h-4 text-blue-600 shrink-0" />
          <div>
            <div className="text-[10px] text-slate-500 font-medium">Leads Processed</div>
            <div className="font-bold text-slate-800">
              {progress.leadsProcessed} / {progress.totalCount}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-white/80 border border-slate-200/60">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div>
            <div className="text-[10px] text-slate-500 font-medium">Enriched & Validated</div>
            <div className="font-bold text-slate-800">{progress.leadsFound}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-white/80 border border-slate-200/60">
          <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
          <div>
            <div className="text-[10px] text-slate-500 font-medium">Elapsed Time</div>
            <div className="font-bold text-slate-800 font-mono">{progress.elapsedSeconds}s</div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-white/80 border border-slate-200/60">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <div className="text-[10px] text-slate-500 font-medium">Adapter Mode</div>
            <div className="font-bold text-slate-800">Mock Sandbox</div>
          </div>
        </div>
      </div>
    </div>
  );
};
