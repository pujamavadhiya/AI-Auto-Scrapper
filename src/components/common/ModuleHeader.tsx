import React from 'react';
import { LucideIcon, Sparkles, Layers, Code, Play } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ModuleHeaderProps {
  title: string;
  badge: string;
  description: string;
  icon: LucideIcon;
  inputRequirements: string[];
  outputFields: string[];
  integrationNote: string;
  onRunEnrichment?: () => void;
  isRunning?: boolean;
  totalRecordsCount?: number;
}

export const ModuleHeader: React.FC<ModuleHeaderProps> = ({
  title,
  badge,
  description,
  icon: Icon,
  inputRequirements,
  outputFields,
  integrationNote,
  onRunEnrichment,
  isRunning,
  totalRecordsCount = 0,
}) => {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 shrink-0">
            <Icon className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h2>
              <Badge variant="default" size="sm">
                {badge}
              </Badge>
              <Badge variant="secondary" size="sm" className="font-mono text-[10px]">
                Service Adapter Ready
              </Badge>
            </div>
            <p className="text-sm text-slate-600 max-w-2xl">{description}</p>
          </div>
        </div>

        {onRunEnrichment && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="primary"
              size="md"
              onClick={onRunEnrichment}
              disabled={isRunning || totalRecordsCount === 0}
              isLoading={isRunning}
              className="gap-2 px-5 font-semibold shadow-sm"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Enrichment ({totalRecordsCount})</span>
            </Button>
          </div>
        )}
      </div>

      {/* Input / Output Tags & Integration Note */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs">
        <div>
          <span className="text-slate-400 font-semibold uppercase tracking-wider block mb-1 text-[10px]">
            Input Requirements
          </span>
          <div className="flex flex-wrap gap-1">
            {inputRequirements.map((req) => (
              <span key={req} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                {req}
              </span>
            ))}
          </div>
        </div>

        <div>
          <span className="text-slate-400 font-semibold uppercase tracking-wider block mb-1 text-[10px]">
            Output Schema
          </span>
          <div className="flex flex-wrap gap-1">
            {outputFields.map((out) => (
              <span key={out} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                {out}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-[11px] mb-0.5">
            <Code className="w-3.5 h-3.5 text-blue-600" />
            <span>Developer Integration Notice</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            {integrationNote}
          </p>
        </div>
      </div>
    </div>
  );
};
