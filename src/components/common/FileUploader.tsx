import React, { useRef, useState } from 'react';
import { UploadCloud, FileSpreadsheet, FileText, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { excelService, ParsedFileResult } from '../../services/excelService';

interface FileUploaderProps {
  onFileParsed: (parsed: ParsedFileResult) => void;
  isLoading?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileParsed, isLoading }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setErrorMessage(null);

    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const lowerName = file.name.toLowerCase();
    const isValid = validExtensions.some((ext) => lowerName.endsWith(ext));

    if (!isValid) {
      setErrorMessage('Please upload a valid Excel (.xlsx, .xls) or CSV (.csv) file.');
      return;
    }

    try {
      setSelectedFileName(file.name);
      const result = await excelService.parseFile(file);
      onFileParsed(result);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to parse spreadsheet.');
      setSelectedFileName(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center p-8 md:p-10 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 bg-white ${
          isDragging
            ? 'border-blue-500 bg-blue-50/50 scale-[0.99]'
            : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50/80 shadow-xs'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex items-center justify-center w-14 h-14 mb-4 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 shadow-xs">
          <UploadCloud className="w-7 h-7" />
        </div>

        <h4 className="text-base font-semibold text-slate-800 text-center">
          {selectedFileName ? (
            <span className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              {selectedFileName}
            </span>
          ) : (
            'Click to upload or drag & drop spreadsheet'
          )}
        </h4>

        <p className="text-xs text-slate-500 mt-1.5 text-center max-w-sm">
          Supports Microsoft Excel (<span className="font-medium text-slate-700">.xlsx, .xls</span>) and Comma-Separated Values (<span className="font-medium text-slate-700">.csv</span>). Processed securely in-browser.
        </p>

        <div className="flex items-center gap-2 mt-4">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
            <FileText className="w-3.5 h-3.5 text-sky-600" /> CSV (.csv)
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
        <span>Need a pre-formatted file to test?</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            excelService.downloadSampleTemplate('xlsx');
          }}
          className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700 hover:underline"
        >
          <Download className="w-3.5 h-3.5" />
          Download Sample Template
        </button>
      </div>
    </div>
  );
};
