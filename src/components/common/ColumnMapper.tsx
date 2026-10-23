import React, { useState } from 'react';
import { Columns3, Check, Wand2, ArrowRight, Building2, User, Briefcase, Globe, MapPin, Linkedin } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { ColumnMapping, EnrichmentRecord } from '../../types';
import { ParsedFileResult, excelService } from '../../services/excelService';

interface ColumnMapperProps {
  parsedFile: ParsedFileResult;
  onMappingConfirmed: (records: EnrichmentRecord[], mapping: ColumnMapping) => void;
  onCancel: () => void;
}

export const ColumnMapper: React.FC<ColumnMapperProps> = ({
  parsedFile,
  onMappingConfirmed,
  onCancel,
}) => {
  const initialMapping = excelService.autoDetectMapping(parsedFile.headers);
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  const sampleRow = parsedFile.rows[0] || {};

  const targetFields = [
    {
      key: 'companyName',
      label: 'Company Name',
      required: true,
      icon: Building2,
      description: 'Primary identifier for scraping & enrichment pipelines',
    },
    {
      key: 'personName',
      label: 'Person / Decision Maker Name',
      required: false,
      icon: User,
      description: 'Used for LinkedIn matching & direct dial lookups',
    },
    {
      key: 'linkedinUrl',
      label: 'Decision Maker LinkedIn URL',
      required: false,
      icon: Linkedin,
      description: 'Primary personal profile URL required for LeadOcean email & phone enrichment',
    },
    {
      key: 'domain',
      label: 'Domain / Website',
      required: false,
      icon: Globe,
      description: 'Company website or email domain (e.g. stripe.com)',
    },
    {
      key: 'title',
      label: 'Job Title / Role',
      required: false,
      icon: Briefcase,
      description: 'Target seniority filter (e.g. CEO, VP Engineering)',
    },
    {
      key: 'country',
      label: 'Country / Geography',
      required: false,
      icon: MapPin,
      description: 'Geographic disambiguation',
    },
  ];

  const handleSelectChange = (key: string, value: string) => {
    setMapping((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleResetAuto = () => {
    const auto = excelService.autoDetectMapping(parsedFile.headers);
    setMapping(auto);
  };

  const handleConfirm = () => {
    if (!mapping.companyName) {
      alert('Please select a column for Company Name to proceed.');
      return;
    }
    const records = excelService.mapRowsToRecords(parsedFile.rows, mapping);
    onMappingConfirmed(records, mapping);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Columns3 className="w-5 h-5 text-blue-600" />
            Map Spreadsheet Columns
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            File: <span className="font-semibold text-slate-700">{parsedFile.fileName}</span> ({parsedFile.totalRows} rows detected)
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleResetAuto}
          className="text-xs text-slate-600 self-start sm:self-auto"
        >
          <Wand2 className="w-3.5 h-3.5 text-blue-600 mr-1.5" />
          Re-apply Auto Mapping
        </Button>
      </div>

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        {targetFields.map((field) => {
          const selectedCol = mapping[field.key] || '';
          const sampleVal = selectedCol && sampleRow[selectedCol] !== undefined ? String(sampleRow[selectedCol]) : '';

          return (
            <div key={field.key} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center hover:bg-slate-50/50 transition-colors">
              <div className="md:col-span-5 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 mt-0.5">
                  <field.icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                    {field.required ? (
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                        Required
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">Optional</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{field.description}</p>
                </div>
              </div>

              <div className="md:col-span-4">
                <select
                  value={selectedCol}
                  onChange={(e) => handleSelectChange(field.key, e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Do Not Map --</option>
                  {parsedFile.headers.map((hdr) => (
                    <option key={hdr} value={hdr}>
                      {hdr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3 text-xs">
                <span className="text-slate-400 block text-[11px] uppercase font-semibold mb-0.5">Preview Value</span>
                {sampleVal ? (
                  <span className="inline-block px-2 py-1 bg-slate-100 text-slate-800 rounded font-mono truncate max-w-full">
                    {sampleVal}
                  </span>
                ) : (
                  <span className="text-slate-400 italic">None</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={onCancel} className="text-xs">
          Cancel & Change File
        </Button>
        <Button onClick={handleConfirm} className="text-xs">
          <span>Load {parsedFile.totalRows} Leads & Configure</span>
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
};
