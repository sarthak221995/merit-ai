import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from 'react-router-dom';
import axios from "axios";
import { useSession } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import {
  Upload, Download, Loader2,
  Layout, CheckCircle2,
  Send, Bot, User, Sparkles, AlertCircle,
  FileText, ArrowLeft, Cpu, Layers, Zap,
  Command, Edit3, RotateCcw
} from "lucide-react";

// --- CONFIGURATION ---

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

axios.defaults.timeout = 180000;

const PROCESSING_STAGES = [
  { id: 1, label: "Uploading document...", icon: Upload, duration: 4000, target: 10 },
  { id: 2, label: "Extracting text data...", icon: FileText, duration: 15000, target: 35 },
  { id: 3, label: "Analyzing structure & skills...", icon: Cpu, duration: 25000, target: 65 },
  { id: 4, label: "Applying design layout...", icon: Layers, duration: 25000, target: 85 },
  { id: 5, label: "Finalizing PDF...", icon: Sparkles, duration: 40000, target: 98 }
];

export default function Editor() {
  const { id } = useParams();
  const { session } = useSession();

  // --- STATE ---

  // UI State
  const [step, setStep] = useState(1);
  const [isFetchingInitialData, setIsFetchingInitialData] = useState(true);

  // Data State
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);

  // Editor State
  const [htmlCode, setHtmlCode] = useState("");
  const [extractedContext, setExtractedContext] = useState("");
  const [pdfUrl, setPdfUrl] = useState(null);
  const [resumeTitle, setResumeTitle] = useState("Untitled Resume");

  // AI/Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [userPrompt, setUserPrompt] = useState("");
  const [codeHistory, setCodeHistory] = useState([]);
  const [currentCodeVersionId, setCurrentCodeVersionId] = useState(1);

  // Status Flags
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerationDone, setIsGenerationDone] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const chatEndRef = useRef(null);

  // Ref to track if we have already fetched data for this ID to prevent loops
  const dataFetchedRef = useRef(false);

  // --- 0. SECURITY HELPERS ---

  const getAuthenticatedSupabase = useCallback(async () => {
    try {
      const token = await session.getToken({ template: 'supabase' });
      return createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    } catch (e) {
      console.warn("Retrying with standard token (Supabase JWT template missing).");
      const token = await session.getToken();
      return createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    }
  }, [session]);

  const secureApiRequest = useCallback(async (method, endpoint, data = null, isBlob = false) => {
    const token = await session.getToken();

    const config = {
      method: method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' })
      },
      responseType: isBlob ? 'blob' : 'json'
    };

    if (data) config.data = data;

    return axios(config);
  }, [session]);

  // --- 1. INITIALIZATION & DATA LOADING ---

  // Reset the fetch tracker when the ID changes (user navigates to a different resume)
  useEffect(() => {
    dataFetchedRef.current = false;
  }, [id]);

  useEffect(() => {
    // Only proceed if we have a session, an ID, and haven't fetched yet
    if (!session || !id || dataFetchedRef.current) return;

    const init = async () => {
      dataFetchedRef.current = true; // Mark as fetched immediately to block concurrent runs

      await fetchTemplates();

      if (id !== 'new') {
        await fetchResumeData(id);
      } else {
        setIsFetchingInitialData(false);
      }
    };

    init();

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const fetchResumeData = async (resumeId) => {
    try {
      const supabase = await getAuthenticatedSupabase();

      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('id', resumeId)
        .single();

      if (error) throw error;

      if (data) {
        setResumeTitle(data.title || "Untitled Resume");
        if (data.html_content && data.html_content.length > 50) {
          setHtmlCode(data.html_content);
          setCodeHistory([{ id: data.version, code: data.html_content }]);
          setCurrentCodeVersionId(data.version);
          setStep(2);
          updatePdfPreview(data.html_content);
        }
      }
    } catch (err) {
      console.error("Error loading resume:", err);
    } finally {
      setIsFetchingInitialData(false);
    }
  };

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const response = await secureApiRequest('GET', '/templates');
      const templateList = response.data.templates || [];

      const templatesWithContent = await Promise.all(
        templateList.map(async (t) => {
          try {
            const contentRes = await secureApiRequest('GET', `/templates/get-raw-code?filename=${t.filename}`);
            return { ...t, rawHtml: contentRes.data };
          } catch (e) {
            return { ...t, rawHtml: "" };
          }
        })
      );
      setTemplates(templatesWithContent);
    } catch (err) {
      console.error("Failed to load templates", err);
    }
    setIsLoadingTemplates(false);
  };

  // --- 2. CORE ACTIONS ---

  const saveResume = async (newHtml, newVersion, newTitle = null) => {
    if (!id || id === 'new') return;
    setIsSaving(true);
    try {
      const supabase = await getAuthenticatedSupabase();

      const updates = {
        html_content: newHtml,
        version: newVersion,
        updated_at: new Date()
      };

      if (newTitle) updates.title = newTitle;

      const { error } = await supabase
        .from('resumes')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      console.error("Failed to save resume:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTitleSave = async () => {
    if (!id || id === 'new' || !resumeTitle.trim()) return;
    try {
      const supabase = await getAuthenticatedSupabase();
      await supabase
        .from('resumes')
        .update({ title: resumeTitle, updated_at: new Date() })
        .eq('id', id);
    } catch (err) {
      console.error("Failed to update title", err);
    }
  };

  const updatePdfPreview = async (codeToRender) => {
    setIsGeneratingPreview(true);
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);

      const formData = new FormData();
      formData.append("html_content", codeToRender);

      const response = await secureApiRequest('POST', '/preview-pdf-bytes', formData, true);

      const blobUrl = URL.createObjectURL(response.data);
      setPdfUrl(blobUrl);
    } catch (err) {
      console.error("Preview generation failed", err);
    }
    setIsGeneratingPreview(false);
  };

  // --- 2.1 UNDO FEATURE ---
  const handleUndo = async () => {
    const currentIndex = codeHistory.findIndex(item => item.id === currentCodeVersionId);

    if (currentIndex > 0) {
      const prevVersion = codeHistory[currentIndex - 1];

      setHtmlCode(prevVersion.code);
      setCurrentCodeVersionId(prevVersion.id);

      updatePdfPreview(prevVersion.code);
      saveResume(prevVersion.code, prevVersion.id);
    }
  };

  const handleExtractAndGenerate = async () => {
    if (!resumeFile || !selectedTemplate) {
      alert("Please select a template and upload a resume.");
      return;
    }

    setIsProcessing(true);
    setIsGenerationDone(false);

    try {
      const formData = new FormData();
      formData.append("file", resumeFile);
      formData.append("template_id", selectedTemplate.id);

      const response = await secureApiRequest('POST', '/process_html', formData);

      if (response.data.success) {
        const initialCode = response.data.html_code;
        const initialVersion = 1;
        const rawData = response.data.extracted_data || "";

        const autoTitle = resumeFile.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");

        setCodeHistory([{ id: initialVersion, code: initialCode }]);
        setCurrentCodeVersionId(initialVersion);
        setHtmlCode(initialCode);
        setExtractedContext(rawData);
        setResumeTitle(autoTitle);
        setStep(2);

        await saveResume(initialCode, initialVersion, autoTitle);
        await updatePdfPreview(initialCode);
        setChatMessages([{ role: "ai", content: "I've generated your PDF resume! Review the preview on the right. What would you like to change?", codeVersionId: 1 }]);

        setIsGenerationDone(true);
      } else {
        alert("Extraction failed: " + (response.data.error || "Unknown error"));
        setIsProcessing(false);
      }
    } catch (err) {
      console.error("Extract error:", err);
      alert("Server error during generation.");
      setIsProcessing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!userPrompt.trim()) return;

    const currentPrompt = userPrompt;
    setUserPrompt("");
    setIsModifying(true);

    const newUserMessage = { role: "user", content: currentPrompt };
    const updatedMessages = [...chatMessages, newUserMessage];
    setChatMessages(updatedMessages);

    const conversationHistory = updatedMessages.map(msg => ({ role: msg.role, content: msg.content }));
    const currentCode = codeHistory.find(v => v.id === currentCodeVersionId)?.code || htmlCode;

    try {
      const response = await secureApiRequest('POST', '/modify-resume', {
        html_code: currentCode,
        prompt: currentPrompt,
        history: conversationHistory.slice(-5),
        extracted_data: extractedContext
      });

      if (response.data.success) {
        const newCode = response.data.html_code;
        const agentReply = response.data.reply_text;

        const isCodeChanged = newCode !== currentCode;
        const newVersionId = isCodeChanged ? currentCodeVersionId + 1 : currentCodeVersionId;

        if (isCodeChanged) {
          setCodeHistory(prev => [...prev, { id: newVersionId, code: newCode }]);
          setCurrentCodeVersionId(newVersionId);
          setHtmlCode(newCode);

          saveResume(newCode, newVersionId);
          updatePdfPreview(newCode);
        }

        setChatMessages(prev => [...prev, { role: "ai", content: agentReply, codeVersionId: newVersionId }]);
      } else {
        setChatMessages(prev => [...prev, { role: "ai", content: "Sorry, I couldn't process that request." }]);
      }
    } catch (err) {
      console.error("Modify error:", err);
      setChatMessages(prev => [...prev, { role: "ai", content: "Error contacting AI server." }]);
    }
    setIsModifying(false);
  };

  const handleDownloadPDF = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `${resumeTitle || "Resume"}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleOverlayComplete = () => {
    setIsProcessing(false);
    setIsGenerationDone(false);
  };

  // --- 3. HELPER COMPONENTS ---

  const getThumbnailHtml = (rawHtml) => {
    if (!rawHtml) return "";
    return `<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;background:white;transform-origin:top left;}html{-webkit-font-smoothing:antialiased;}</style></head><body>${rawHtml}</body></html>`;
  };

  const ProcessingOverlay = ({ isDone, onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [activeStage, setActiveStage] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
      if (isDone) {
        setActiveStage(PROCESSING_STAGES.length);
        setDuration(500);
        requestAnimationFrame(() => setProgress(100));
        const timer = setTimeout(() => {
          onComplete();
        }, 800);
        return () => clearTimeout(timer);
      }
    }, [isDone, onComplete]);

    useEffect(() => {
      if (isDone) return;

      let currentTimeout;
      const runStages = (index) => {
        if (index >= PROCESSING_STAGES.length) return;

        const stage = PROCESSING_STAGES[index];
        setActiveStage(index);
        setDuration(stage.duration);
        requestAnimationFrame(() => setProgress(stage.target));

        currentTimeout = setTimeout(() => {
          runStages(index + 1);
        }, stage.duration);
      };

      runStages(0);
      return () => clearTimeout(currentTimeout);
    }, [isDone]);

    return (
      <div className="fixed inset-0 z-[100] bg-white/90 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-100 p-8 flex flex-col items-center relative overflow-hidden">
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute inset-0 bg-blue-500/10 rounded-full animate-ping opacity-75"></div>
            <div className="absolute inset-0 border-4 border-slate-50 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
            {isDone ? (
              <div className="absolute inset-2 bg-blue-600 rounded-full shadow-sm flex items-center justify-center z-10 animate-in zoom-in duration-300">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
            ) : (
              <div className="absolute inset-2 bg-white rounded-full shadow-sm flex items-center justify-center z-10 border border-slate-50">
                <Zap className="w-8 h-8 text-blue-600 fill-blue-600 animate-pulse" />
              </div>
            )}
          </div>
          <div className="text-center w-full mb-8 z-10">
            <h2 className="text-xl font-bold text-slate-900 mb-2">{isDone ? "Resume Ready!" : "Generating Resume"}</h2>
            <p className="text-slate-500 text-sm">{isDone ? "Redirecting to editor..." : "Please keep this tab open while we process."}</p>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mb-8 overflow-hidden z-10">
            <div
              className="h-full bg-blue-600 rounded-full ease-linear"
              style={{
                width: `${progress}%`,
                transitionProperty: "width",
                transitionDuration: `${duration}ms`,
                transitionTimingFunction: isDone ? "ease-out" : "linear"
              }}
            />
          </div>
          <div className="w-full space-y-3 z-10">
            {PROCESSING_STAGES.map((stage, idx) => {
              const isActive = idx === activeStage && !isDone;
              const isFinished = idx < activeStage || isDone;
              const isPending = idx > activeStage && !isDone;
              return (
                <div key={stage.id} className={`flex items-center gap-3 transition-all duration-500 ${isPending ? 'opacity-40 grayscale' : 'opacity-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-colors duration-300 ${isFinished ? 'bg-blue-600 border-blue-600 text-white' : isActive ? 'bg-white border-blue-600 text-blue-600' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                    {isFinished ? <CheckCircle2 size={12} /> : isActive ? <Loader2 size={12} className="animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? 'text-blue-700' : isFinished ? 'text-slate-700' : 'text-slate-400'}`}>{stage.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // --- 4. MAIN RENDER ---

  if (isFetchingInitialData) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
          <p className="text-slate-500 font-medium">Loading Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">

      {isProcessing && <ProcessingOverlay isDone={isGenerationDone} onComplete={handleOverlayComplete} />}

      {/* --- SIDEBAR --- */}
      <aside className="w-[72px] bg-white border-r border-slate-200 flex flex-col items-center py-6 gap-6 z-30 flex-shrink-0">
        <div onClick={() => window.location.href = '/'} className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg cursor-pointer hover:scale-105 transition-transform">
          <Command className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col gap-2 w-full px-2 mt-4">
          <button
            onClick={() => setStep(1)}
            className={`group relative flex items-center justify-center w-full aspect-square rounded-xl transition-all duration-200 ${step === 1 ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-white hover:text-slate-600'}`}
            title="Templates"
          >
            <Layout className="w-5 h-5" />
          </button>
          <button
            onClick={() => step === 2 && setStep(2)}
            disabled={step === 1}
            className={`group relative flex items-center justify-center w-full aspect-square rounded-xl transition-all duration-200 ${step === 2 ? 'bg-slate-100 text-blue-600' : 'text-slate-300'}`}
            title="Editor"
          >
            <Sparkles className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* --- MAIN LAYOUT --- */}
      <main className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL: CONFIG or CHAT */}
        <div className="w-[420px] flex flex-col border-r border-slate-200 bg-white shadow-2xl shadow-slate-200/50 z-20 relative">

          {step === 1 ? (
            /* --- STEP 1: UPLOAD & TEMPLATE --- */
            <div className="flex flex-col h-full animate-in slide-in-from-left-4 duration-300">
              <div className="p-8 pb-4 border-b border-slate-100">
                <h2 className="text-xl font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  Create Resume
                </h2>
                <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                  Upload your existing resume and choose a professional template to get started.
                </p>
                {/* --- LAUNCH BADGE FOR TEMPLATE PANEL --- */}
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wide w-fit">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  Launch Special: Free for first 100 users
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* File Upload */}
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Source File</label>
                  <label className={`group relative flex flex-col items-center justify-center w-full h-40 border border-dashed rounded-xl cursor-pointer transition-all ${resumeFile ? 'border-blue-500 bg-blue-50/30' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}`}>
                    {resumeFile ? (
                      <div className="flex flex-col items-center text-blue-600 animate-in zoom-in-50">
                        <CheckCircle2 className="w-6 h-6 mb-2" />
                        <span className="text-sm font-semibold">{resumeFile.name}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center text-slate-400 group-hover:text-slate-600">
                        <Upload className="w-6 h-6 mb-2" />
                        <span className="text-sm font-medium">Click to upload (PDF/DOCX)</span>
                      </div>
                    )}
                    <input type="file" className="hidden" accept=".pdf,.docx,.doc" onChange={(e) => e.target.files?.[0] && setResumeFile(e.target.files[0])} />
                  </label>
                </div>

                {/* Template Selection Indicator */}
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Selected Template</label>
                  </div>
                  {selectedTemplate ? (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 font-medium text-sm flex items-center gap-2 animate-in fade-in">
                      <Layout size={16} /> {selectedTemplate.name}
                    </div>
                  ) : (
                    <div className="p-4 border border-dashed rounded-xl text-sm text-slate-400 flex items-center gap-2 bg-slate-50">
                      <AlertCircle size={16} /> Select from right panel →
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-white">
                <button
                  onClick={handleExtractAndGenerate}
                  disabled={isProcessing || !resumeFile || !selectedTemplate}
                  className="w-full h-12 bg-slate-900 hover:bg-black text-white rounded-lg font-medium shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  {isProcessing ? <Loader2 className="animate-spin" /> : <span>Generate Resume</span>}
                </button>
              </div>
            </div>
          ) : (
            /* --- STEP 2: CHAT EDITOR --- */
            <div className="flex flex-col h-full bg-white animate-in slide-in-from-right-4 duration-300">
              {/* Header */}
              <div className="h-14 border-b border-slate-100 flex items-center justify-between px-5 bg-white shrink-0">
                <div className="flex items-center gap-2">
                  <button onClick={() => setStep(1)} className="text-slate-400 hover:text-slate-700 transition-colors"><ArrowLeft size={16} /></button>
                  <span className="font-semibold text-slate-700 text-sm">AI Editor</span>
                </div>
                <div className="flex items-center gap-3">
                  {isSaving ? (
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Saving...</span>
                  ) : (
                    <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={10} /> Saved</span>
                  )}
                  <div className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                    v{currentCodeVersionId}
                  </div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 scroll-smooth">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm ${msg.role === 'user' ? 'bg-white border-slate-200' : 'bg-indigo-600 text-white'}`}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed max-w-[85%] ${msg.role === 'user' ? 'bg-slate-100 text-slate-800' : 'bg-white border border-slate-100 text-slate-600'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {(isModifying || isGeneratingPreview) && (
                  <div className="flex gap-3"><div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white"><Loader2 className="animate-spin" size={14} /></div></div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area - Revamped */}
              <div className="p-6 bg-white border-t border-slate-100 shrink-0">
                <div className="relative bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md focus-within:shadow-lg focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all duration-300">
                  <textarea
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isModifying) handleSendMessage(); } }}
                    placeholder="Ask AI to adjust fonts, spacing, or content..."
                    className="w-full bg-transparent border-none focus:ring-0 text-sm text-slate-800 placeholder:text-slate-400 resize-none py-4 pl-4 pr-24 min-h-[60px] max-h-32 leading-relaxed"
                    disabled={isModifying}
                  />

                  {/* Action Buttons */}
                  <div className="absolute bottom-2 right-2 flex items-center gap-2">
                    <button
                      onClick={handleUndo}
                      disabled={codeHistory.findIndex(v => v.id === currentCodeVersionId) <= 0 || isSaving || isModifying}
                      className="p-2 bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900 hover:shadow-sm rounded-xl transition-all disabled:opacity-30 disabled:shadow-none group"
                      title="Undo last change"
                    >
                      <RotateCcw className="w-4 h-4 group-hover:-rotate-90 transition-transform duration-300" />
                    </button>

                    <button
                      onClick={handleSendMessage}
                      disabled={isModifying || !userPrompt.trim()}
                      className={`p-2 rounded-xl transition-all duration-300 flex items-center justify-center shadow-sm ${!userPrompt.trim() || isModifying
                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                        : 'bg-slate-900 text-white hover:bg-blue-600 hover:shadow-blue-600/20 active:scale-95'
                        }`}
                    >
                      {isModifying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="text-center mt-3">
                  <p className="text-[10px] text-slate-400 font-medium">
                    AI can make mistakes. Please review your resume.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL: MARKETPLACE / PREVIEW */}
        <div className="flex-1 bg-slate-100/50 relative flex flex-col">
          <div className="h-16 px-8 flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-6">
              {step === 1 ? (
                <h1 className="text-lg font-semibold text-slate-800">Template Gallery</h1>
              ) : (
                /* --- EDITABLE TITLE SECTION --- */
                <div className="flex items-center gap-2 group">
                  <input
                    value={resumeTitle}
                    onChange={(e) => setResumeTitle(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    className="text-lg font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none transition-all px-1 -ml-1 w-64 truncate"
                  />
                  <Edit3 size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}

              {/* --- LAUNCH BADGE --- */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wide">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Launch Special: Free for first 100 users
              </div>
            </div>

            {step === 2 && (
              <button onClick={handleDownloadPDF} className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-lg flex items-center gap-2 hover:bg-black transition-all active:scale-95">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            )}
          </div>

          <div className="flex-1 w-full overflow-hidden relative">
            {step === 1 ? (
              /* --- MARKETPLACE GRID --- */
              <div className="absolute inset-0 overflow-y-auto p-8 pt-2">
                {isLoadingTemplates ? (
                  <div className="flex flex-col items-center justify-center mt-20 text-slate-400">
                    <Loader2 className="animate-spin w-8 h-8 mb-2" />
                    <span>Loading templates...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                    {templates.map((t) => (
                      <div key={t.id} onClick={() => setSelectedTemplate(t)} className={`cursor-pointer group relative flex flex-col transition-all duration-300 ${selectedTemplate?.id === t.id ? '-translate-y-2' : 'hover:-translate-y-2'}`}>
                        <div className={`relative rounded-xl overflow-hidden bg-white border aspect-[1/1.414] shadow-sm pointer-events-none transition-all duration-300 ${selectedTemplate?.id === t.id ? 'ring-2 ring-blue-500 shadow-xl shadow-blue-500/10' : 'group-hover:shadow-lg'}`}>
                          <iframe srcDoc={getThumbnailHtml(t.rawHtml)} title={t.name} className="w-[400%] h-[400%] scale-[0.25] border-none origin-top-left" scrolling="no" tabIndex="-1" />
                          {selectedTemplate?.id === t.id && (
                            <div className="absolute top-3 right-3 bg-blue-600 text-white rounded-full p-1 shadow-md animate-in zoom-in"><CheckCircle2 size={16} /></div>
                          )}
                        </div>
                        <div className={`mt-3 text-center text-sm font-medium ${selectedTemplate?.id === t.id ? 'text-blue-600' : 'text-slate-600'}`}>{t.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* --- PDF PREVIEWER --- */
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-slate-200/50">
                {isGeneratingPreview || !pdfUrl ? (
                  <div className="flex flex-col items-center animate-pulse">
                    <div className="bg-white p-4 rounded-xl shadow-sm mb-4 border border-slate-100">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    </div>
                    <p className="text-slate-500 font-medium text-sm">Rendering PDF...</p>
                  </div>
                ) : (
                  <div className="relative w-full h-full max-w-3xl shadow-2xl rounded-lg overflow-hidden border border-slate-300 bg-white animate-in zoom-in-95 duration-500">
                    <iframe
                      key={pdfUrl} // FORCE RE-RENDER ON URL CHANGE
                      src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                      className="w-full h-full"
                      title="PDF Preview"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}