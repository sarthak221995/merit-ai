import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser, UserButton, useSession } from '@clerk/clerk-react';
// import { useUser, UserButton, useSession } from './MockClerk';
import { createClient } from '@supabase/supabase-js';
import {
  Plus, Clock, Command, Loader2, FileText, History, Trash2
} from 'lucide-react';

// 1. Setup Supabase Config
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { session } = useSession();
  const [resumes, setResumes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (user && session) fetchResumes();
  }, [user, session]);

  // Helper to create authenticated client
  const getAuthenticatedSupabase = async () => {
    try {
      const token = await session.getToken({ template: 'supabase' });
      return createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    } catch (e) {
      console.warn("Failed to get 'supabase' token template. Implementation Note: You need to create a JWT template named 'supabase' in Clerk Dashboard. Falling back to standard token (RLS might fail).");
      const token = await session.getToken();
      return createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    }
  };

  const fetchResumes = async () => {
    setIsLoading(true);
    try {
      const supabase = await getAuthenticatedSupabase();

      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching resumes:', error);
      } else {
        setResumes(data || []);
      }
    } catch (err) {
      console.error("Unexpected error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const createNewResume = async () => {
    try {
      const supabase = await getAuthenticatedSupabase();

      const { data, error } = await supabase
        .from('resumes')
        .insert([
          {
            user_id: user.id,
            title: 'Untitled Resume',
            html_content: '',
            version: 1
          }
        ])
        .select();

      if (error) {
        console.error('Supabase Error:', error);
        alert(`Failed to create document: ${error.message}`);
      } else {
        const newId = data[0].id;
        navigate(`/editor/${newId}`);
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      alert("An unexpected error occurred.");
    }
  };

  const handleDeleteResume = async (e, resumeId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure? This cannot be undone.")) return;

    setDeletingId(resumeId);

    try {
      const supabase = await getAuthenticatedSupabase();
      const { error } = await supabase.from('resumes').delete().eq('id', resumeId);

      if (!error) {
        setResumes(prev => prev.filter(r => r.id !== resumeId));
      } else {
        console.error("Delete error:", error);
        alert("Failed to delete resume.");
      }
    } catch (err) {
      console.error("Unexpected error:", err);
    } finally {
      setDeletingId(null);
    }
  };

  // Helper to ensure thumbnail has white background
  const getThumbnailHtml = (html) => {
    return `<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;background:white;}</style></head><body>${html}</body></html>`;
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <nav className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
              <Command size={18} />
            </div>
            <span className="font-bold text-lg tracking-tight">Merit</span>
          </div>

          {/* --- LAUNCH BADGE --- */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wide">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            Launch Special: Free for first 100 users
          </div>
        </div>

        <UserButton afterSignOutUrl="/sign-in" />
      </nav>

      <main className="max-w-5xl mx-auto py-12 px-6">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Dashboard</h1>
            <p className="text-slate-500 text-sm">Manage your resumes.</p>
          </div>
          <button
            onClick={createNewResume}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-all"
          >
            <Plus size={18} />
            <span>Create New</span>
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-slate-300" size={32} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Create Card */}
            <div
              onClick={createNewResume}
              className="group flex flex-col items-center justify-center aspect-[3/4] border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 group-hover:scale-110 transition-transform">
                <Plus size={24} className="text-slate-400 group-hover:text-blue-500" />
              </div>
              <span className="font-medium text-slate-600 group-hover:text-blue-600">New Document</span>
            </div>

            {/* Resume Cards */}
            {resumes.map((resume) => (
              <div
                key={resume.id}
                onClick={() => navigate(`/editor/${resume.id}`)}
                className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer"
              >
                {/* THUMBNAIL AREA */}
                <div className="aspect-[3/2] bg-slate-100 relative border-b border-slate-100 overflow-hidden group-hover:bg-slate-50 transition-colors">
                  {resume.html_content ? (
                    <iframe
                      srcDoc={getThumbnailHtml(resume.html_content)}
                      title="Thumbnail"
                      className="w-[400%] h-[400%] scale-[0.25] border-none origin-top-left pointer-events-none select-none"
                      tabIndex="-1"
                      scrolling="no"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="text-slate-300 w-16 h-16 group-hover:scale-105 transition-transform" />
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-slate-900 line-clamp-1">{resume.title || "Untitled"}</h3>
                    <button
                      onClick={(e) => handleDeleteResume(e, resume.id)}
                      className="text-slate-300 hover:text-red-500 p-1"
                    >
                      {deletingId === resume.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {new Date(resume.updated_at).toLocaleDateString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <History size={12} /> v{resume.version}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}