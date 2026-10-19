import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderGit2,
  Plus,
  Search,
  Trash2,
  Play,
  Copy,
  ExternalLink,
  Calendar,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { storageService } from '../services/storageService';
import { Project, ModuleType } from '../types';
import { formatDate } from '../lib/utils';

export const AllProjects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>(() => storageService.getProjects());
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const filteredProjects = projects.filter((p) => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (moduleFilter !== 'all' && p.moduleType !== moduleFilter) {
      return false;
    }
    return true;
  });

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete project "${name}"?`)) {
      storageService.deleteProject(id);
      setProjects(storageService.getProjects());
    }
  };

  const handleDuplicate = (project: Project) => {
    const duplicated: Project = {
      ...project,
      id: `proj-${Date.now()}`,
      name: `${project.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    storageService.saveProject(duplicated);
    setProjects(storageService.getProjects());
  };

  const getModuleBadge = (type: ModuleType) => {
    switch (type) {
      case 'decision-maker':
        return <Badge variant="default">Decision Maker</Badge>;
      case 'linkedin-finder':
        return <Badge variant="info">LinkedIn Finder</Badge>;
      case 'contact-finder':
        return <Badge variant="success">Email & Phone</Badge>;
      case 'website-finder':
        return <Badge variant="secondary">Website Finder</Badge>;
      case 'social-finder':
        return <Badge variant="warning">Social Finder</Badge>;
      default:
        return <Badge variant="secondary">Pipeline</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">All Research Projects</h2>
            <Badge variant="secondary" size="sm">
              {projects.length} Saved
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Browse, re-open, or duplicate your batch enrichment workspaces and imported spreadsheets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/decision-maker">
            <Button variant="primary" size="sm" className="gap-1.5 shadow-sm text-xs font-semibold">
              <Plus className="w-4 h-4" />
              <span>New Enrichment Batch</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search projects by name, description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Module:</span>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-slate-300 text-xs bg-white text-slate-700 shadow-xs"
          >
            <option value="all">All Modules</option>
            <option value="decision-maker">Decision Maker Finder</option>
            <option value="linkedin-finder">LinkedIn URL Finder</option>
            <option value="contact-finder">Email & Phone Finder</option>
            <option value="website-finder">Company Website Finder</option>
            <option value="social-finder">Social Media URL Finder</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProjects.length === 0 ? (
          <div className="col-span-full p-12 text-center rounded-2xl border border-dashed border-slate-300 bg-white">
            <FolderGit2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-800">No projects match criteria</h4>
            <p className="text-xs text-slate-500 mt-1">
              Start an enrichment run in any research module to automatically save a project.
            </p>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <Card key={project.id} className="flex flex-col justify-between hover:shadow-md transition-shadow">
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  {getModuleBadge(project.moduleType)}
                  <Badge variant={project.status === 'completed' ? 'success' : 'warning'} size="sm">
                    {project.status}
                  </Badge>
                </div>

                <CardTitle className="text-base text-slate-900 line-clamp-1" title={project.name}>
                  {project.name}
                </CardTitle>

                <CardDescription className="text-xs mt-1 line-clamp-2">
                  {project.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-4">
                <div className="flex items-center justify-between text-xs py-2 border-y border-slate-100">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-medium">TOTAL RECORDS</span>
                    <span className="font-bold text-slate-800">{project.totalRecords || project.records?.length || 0}</span>
                  </div>

                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-slate-400 font-medium">LAST MODIFIED</span>
                    <span className="text-slate-600 font-medium">{formatDate(project.updatedAt)}</span>
                  </div>
                </div>

                {project.sourceFileName && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono truncate">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">{project.sourceFileName}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDuplicate(project)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Duplicate project"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(project.id, project.name)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <Link to={`/${project.moduleType}`}>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-semibold gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                      <span>Open Workspace</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
