import React from 'react';
import { Sliders, Zap, ShieldCheck, Phone, Mail, Linkedin, Globe } from 'lucide-react';
import { ModuleType, ResearchConfig } from '../../types';

interface ConfigOptionsPanelProps {
  moduleType: ModuleType;
  config: ResearchConfig;
  onChange: (updatedConfig: ResearchConfig) => void;
}

export const ConfigOptionsPanel: React.FC<ConfigOptionsPanelProps> = ({
  moduleType,
  config,
  onChange,
}) => {
  const seniorityLevels = ['C-Level', 'VP', 'Director', 'Manager', 'Senior'];
  const socialPlatforms = ['Twitter/X', 'LinkedIn', 'GitHub', 'Crunchbase', 'Facebook'];

  const handleSeniorityToggle = (level: string) => {
    const current = config.seniorityLevels || ['C-Level', 'VP'];
    const updated = current.includes(level)
      ? current.filter((l) => l !== level)
      : [...current, level];
    onChange({ ...config, seniorityLevels: updated.length ? updated : ['C-Level'] });
  };

  const handlePlatformToggle = (platform: string) => {
    const current = config.socialPlatforms || ['Twitter/X', 'GitHub', 'Crunchbase'];
    const updated = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    onChange({ ...config, socialPlatforms: updated });
  };

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-slate-800">Module Configuration & Filters</h4>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">Adapter Parameters</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 text-xs">
        {/* Module-specific options */}
        {moduleType === 'decision-maker' && (
          <>
            <div>
              <label className="block font-semibold text-slate-700 mb-2">
                Target Seniority Hierarchy
              </label>
              <div className="flex flex-wrap gap-1.5">
                {seniorityLevels.map((lvl) => {
                  const isChecked = config.seniorityLevels?.includes(lvl);
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => handleSeniorityToggle(lvl)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                        isChecked
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-2">
                Verification & Phone Enrichment
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.verifyEmails !== false}
                    onChange={(e) => onChange({ ...config, verifyEmails: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Simulate SMTP email handshake</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.findDirectPhones !== false}
                    onChange={(e) => onChange({ ...config, findDirectPhones: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Extract direct executive phone dials</span>
                </label>
              </div>
            </div>
          </>
        )}

        {moduleType === 'linkedin-finder' && (
          <>
            <div>
              <label className="block font-semibold text-slate-700 mb-2">
                Discovery Targets
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.findCompanyLinkedIn !== false}
                    onChange={(e) => onChange({ ...config, findCompanyLinkedIn: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Company Official Page</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.findPersonalLinkedIn !== false}
                    onChange={(e) => onChange({ ...config, findPersonalLinkedIn: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Key Stakeholder Profile URL</span>
                </label>
              </div>
            </div>
          </>
        )}

        {moduleType === 'contact-finder' && (
          <>
            <div>
              <label className="block font-semibold text-slate-700 mb-2">
                Email Validation Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.verifyEmails !== false}
                    onChange={(e) => onChange({ ...config, verifyEmails: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Deliverability Check (Catch-all test)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.findDirectPhones !== false}
                    onChange={(e) => onChange({ ...config, findDirectPhones: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Direct Dial & HQ Telecom Routing</span>
                </label>
              </div>
            </div>
          </>
        )}

        {moduleType === 'social-finder' && (
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-2">
              Social Channels to Scrape
            </label>
            <div className="flex flex-wrap gap-2">
              {socialPlatforms.map((plat) => {
                const isChecked = config.socialPlatforms?.includes(plat);
                return (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => handlePlatformToggle(plat)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      isChecked
                        ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {plat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {moduleType === 'website-finder' && (
          <div>
            <label className="block font-semibold text-slate-700 mb-2">
              Search & Resolution Depth
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={config.deepWebsiteDiscovery !== false}
                  onChange={(e) => onChange({ ...config, deepWebsiteDiscovery: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Follow redirects & canonical HTTP headers</span>
              </label>
            </div>
          </div>
        )}

        {/* Global simulation speed selector */}
        <div>
          <label className="block font-semibold text-slate-700 mb-1.5">
            Simulation Speed / Delay
          </label>
          <select
            value={config.simulationSpeedMs || 350}
            onChange={(e) => onChange({ ...config, simulationSpeedMs: Number(e.target.value) })}
            className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 shadow-xs"
          >
            <option value={200}>Turbo (200ms per record)</option>
            <option value={400}>Standard (400ms per record)</option>
            <option value={900}>Realistic Scraping (900ms per record)</option>
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Simulates real-world network and crawler latencies.</p>
        </div>
      </div>
    </div>
  );
};
