import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { AIResearchAssistant } from './pages/AIResearchAssistant';
import { DecisionMakerFinder } from './pages/DecisionMakerFinder';
import { LinkedInFinder } from './pages/LinkedInFinder';
import { ContactFinder } from './pages/ContactFinder';
import { WebsiteFinder } from './pages/WebsiteFinder';
import { SocialMediaFinder } from './pages/SocialMediaFinder';
import { AllProjects } from './pages/AllProjects';
import { ExportHistory } from './pages/ExportHistory';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="ai-assistant" element={<AIResearchAssistant />} />
          <Route path="decision-maker" element={<DecisionMakerFinder />} />
          <Route path="linkedin-finder" element={<LinkedInFinder />} />
          <Route path="contact-finder" element={<ContactFinder />} />
          <Route path="website-finder" element={<WebsiteFinder />} />
          <Route path="social-finder" element={<SocialMediaFinder />} />
          <Route path="projects" element={<AllProjects />} />
          <Route path="export-history" element={<ExportHistory />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
