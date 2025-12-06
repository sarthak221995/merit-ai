import React, { useState, useEffect } from 'react';
import { useSession } from '@clerk/clerk-react';
import { Check, Sparkles, Search, Filter, Loader2 } from 'lucide-react';

// This component handles the visual template selection
export default function TemplateLibrary({ onSelectTemplate, selectedTemplateId }) {
  const { session } = useSession();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [hoveredTemplate, setHoveredTemplate] = useState(null);

  // Fetch available templates from backend
  useEffect(() => {
    if (session) {
      fetchTemplates();
    }
  }, [session]);

  const fetchTemplates = async () => {
    try {
      const token = await session.getToken();
      // Call your backend endpoint that lists all templates
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
      const response = await fetch(`${backendUrl}/templates`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error("Failed to fetch");

      const data = await response.json();
      setTemplates(data.templates);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      // Fallback to mock data for demo
      setTemplates(getMockTemplates());
    } finally {
      setLoading(false);
    }
  };

  // Mock data structure (replace with actual backend data)
  const getMockTemplates = () => [
    {
      id: 'modern-minimal',
      name: 'Modern Minimal',
      description: 'Clean design with ample whitespace',
      category: 'modern',
      thumbnailUrl: '/thumbnails/modern-minimal.svg',
      tags: ['minimal', 'tech', 'startup']
    },
    {
      id: 'executive-serif',
      name: 'Executive Serif',
      description: 'Traditional and authoritative',
      category: 'professional',
      thumbnailUrl: '/thumbnails/executive-serif.svg',
      tags: ['corporate', 'executive', 'finance']
    },
    {
      id: 'creative-grid',
      name: 'Creative Grid',
      description: 'Bold layout for creative professionals',
      category: 'creative',
      thumbnailUrl: '/thumbnails/creative-grid.svg',
      tags: ['design', 'portfolio', 'creative']
    },
    {
      id: 'academic-classic',
      name: 'Academic Classic',
      description: 'Perfect for research and academia',
      category: 'academic',
      thumbnailUrl: '/thumbnails/academic-classic.svg',
      tags: ['academic', 'research', 'university']
    },
    {
      id: 'tech-sidebar',
      name: 'Tech Sidebar',
      description: 'Two-column with skills highlight',
      category: 'modern',
      thumbnailUrl: '/thumbnails/tech-sidebar.svg',
      tags: ['tech', 'developer', 'engineer']
    },
    {
      id: 'elegant-serif',
      name: 'Elegant Serif',
      description: 'Sophisticated serif typography',
      category: 'professional',
      thumbnailUrl: '/thumbnails/elegant-serif.svg',
      tags: ['law', 'consulting', 'professional']
    }
  ];

  const categories = [
    { id: 'all', label: 'All Templates' },
    { id: 'modern', label: 'Modern' },
    { id: 'professional', label: 'Professional' },
    { id: 'creative', label: 'Creative' },
    { id: 'academic', label: 'Academic' }
  ];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || template.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-brand-600" />
            Template Library
          </h2>
          <p className="text-slate-500 mt-1">Choose a design that fits your style</p>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex gap-4">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
          />
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border-none bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
          >
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-2 gap-6">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            onClick={() => onSelectTemplate(template)}
            onMouseEnter={() => setHoveredTemplate(template.id)}
            onMouseLeave={() => setHoveredTemplate(null)}
            className={`
              group relative cursor-pointer rounded-xl border-2 overflow-hidden
              transition-all duration-300 hover:shadow-2xl hover:-translate-y-1
              ${selectedTemplateId === template.id
                ? 'border-brand-600 ring-2 ring-brand-600 shadow-xl'
                : 'border-gray-200 hover:border-brand-400'
              }
            `}
          >
            {/* Selection Indicator */}
            {selectedTemplateId === template.id && (
              <div className="absolute top-3 right-3 z-10 w-8 h-8 bg-brand-600 rounded-full flex items-center justify-center shadow-lg">
                <Check className="w-5 h-5 text-white" />
              </div>
            )}

            {/* Template Preview/Thumbnail */}
            <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 aspect-[8.5/11] overflow-hidden">
              {/* This would be your actual SVG thumbnail */}
              <div className="absolute inset-0 flex items-center justify-center p-6">
                {/* Placeholder - Replace with actual thumbnail */}
                <div className="w-full h-full bg-white shadow-lg rounded-sm p-4 text-xs overflow-hidden">
                  <div className="h-3 bg-slate-800 rounded mb-2 w-2/3"></div>
                  <div className="h-2 bg-slate-300 rounded mb-1 w-1/2"></div>
                  <div className="h-2 bg-slate-300 rounded mb-3 w-1/3"></div>
                  <div className="space-y-1.5">
                    <div className="h-1.5 bg-slate-200 rounded w-full"></div>
                    <div className="h-1.5 bg-slate-200 rounded w-5/6"></div>
                    <div className="h-1.5 bg-slate-200 rounded w-4/6"></div>
                  </div>
                </div>

                {/* When you have actual thumbnails, use this instead:
                <img 
                  src={template.thumbnailUrl} 
                  alt={template.name}
                  className="w-full h-full object-contain"
                />
                */}
              </div>

              {/* Hover Overlay */}
              <div className={`
                absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0
                transition-opacity duration-300
                ${hoveredTemplate === template.id ? 'opacity-100' : 'opacity-0'}
              `} />
            </div>

            {/* Template Info */}
            <div className="p-4 bg-white">
              <h3 className="font-bold text-slate-900 mb-1">{template.name}</h3>
              <p className="text-sm text-slate-500 mb-2">{template.description}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {template.tags.slice(0, 3).map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredTemplates.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium">No templates found</p>
          <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
        </div>
      )}
    </div>
  );
}