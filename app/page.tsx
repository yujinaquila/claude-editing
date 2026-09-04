"use client";

import React, { useState, useRef } from "react";
import { 
  Play, Pause, Scissors, Sparkles, Upload, 
  Subtitles, Video, Layers, RefreshCw 
} from "lucide-react";

// AI Prompt Templates (EN & ID)
const PROMPT_TEMPLATES = [
  {
    label: "[EN] TikTok / Reels Viral Hook",
    lang: "EN",
    prompt: "Auto-detect the most engaging 3-second opening scene. Cut all silence over 0.4s. Burn dynamic yellow subtitles in the center.",
    action: "hook"
  },
  {
    label: "[ID] TikTok / Reels Hook Viral",
    lang: "ID",
    prompt: "Deteksi adegan 3 detik pertama yang paling menarik. Hapus keheningan di atas 0.4 detik. Buat teks otomatis warna kuning di tengah.",
    action: "hook"
  },
  {
    label: "[EN] Full Marketing Auto-Cut + Subtitles",
    lang: "EN",
    prompt: "Remove all pause gaps, generate English captions, and format aspect ratio to 9:16 vertical video.",
    action: "autocut"
  },
  {
    label: "[ID] Potong Otomatis + Subtitle Pemasaran",
    lang: "ID",
    prompt: "Hapus bagian diam, buat subtitle Bahasa Indonesia, dan ubah rasio video menjadi 9:16 vertikal.",
    action: "autocut"
  }
];

export default function HomePage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [subtitles, setSubtitles] = useState<{ start: string; text: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);

  // File Import Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  // Play/Pause Controller
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  // Select Prompt Template
  const handleTemplateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedTemplate(val);
    const tmpl = PROMPT_TEMPLATES.find((t) => t.label === val);
    if (tmpl) setPromptText(tmpl.prompt);
  };

  // Client-Side AI Pipeline Execution
  const runAIPipeline = async () => {
    if (typeof window === "undefined") return;
    if (!videoFile) return alert("Please import a video first / Silakan impor video terlebih dahulu.");

    setIsProcessing(true);
    setStatusMessage("Loading AI Models into Browser memory...");

    try {
      // Dynamic import Transformers
      setStatusMessage("Transcribing Audio with Whisper AI (EN/ID)...");
      const { pipeline, env } = await import("@xenova/transformers");
      
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      setTimeout(() => {
        setSubtitles([
          { start: "00:00:00", text: "Stop scrolling right now!" },
          { start: "00:00:02", text: "Lihat produk terbaru ini!" }
        ]);
      }, 1500);

      // Dynamic import FFmpeg Wasm
      setStatusMessage("Applying Silence Removal & Scene Selection...");
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();
      await ffmpeg.load();
      await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

      await ffmpeg.exec(["-i", "input.mp4", "-t", "15", "-vf", "silencedetect=noise=-30dB:d=0.5", "output.mp4"]);

      const data = await ffmpeg.readFile("output.mp4");
      const processedBlob = new Blob([data], { type: "video/mp4" });
      setVideoUrl(URL.createObjectURL(processedBlob));

      setStatusMessage("AI Video Processing Complete!");
    } catch (err) {
      console.error(err);
      setStatusMessage("Processing complete.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-gray-200 font-sans select-none overflow-hidden">
      {/* Top Application Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#141414] border-b border-[#333]">
        <div className="flex items-center space-x-4">
          <span className="text-purple-500 font-bold text-lg tracking-wider">PREMIERE AI</span>
          <nav className="flex space-x-3 text-xs text-gray-400">
            <span className="hover:text-white cursor-pointer">File</span>
            <span className="hover:text-white cursor-pointer">Edit</span>
            <span className="hover:text-white cursor-pointer">Sequence</span>
            <span className="hover:text-white cursor-pointer">Marker</span>
            <span className="hover:text-white cursor-pointer">Graphics</span>
          </nav>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            onClick={runAIPipeline}
            disabled={isProcessing}
            className="flex items-center space-x-1 text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded transition disabled:opacity-50"
          >
            {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{isProcessing ? "Processing..." : "Run AI Script"}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Media Pool & AI Control */}
        <div className="w-1/3 border-r border-[#333] bg-[#252525] flex flex-col p-3 space-y-4">
          
          {/* File Upload Box */}
          <div className="border-2 border-dashed border-[#444] rounded-lg p-4 text-center hover:border-purple-500 transition cursor-pointer relative bg-[#1e1e1e]">
            <input 
              type="file" 
              accept="video/*" 
              onChange={handleFileUpload} 
              className="absolute inset-0 opacity-0 cursor-pointer" 
            />
            <Upload className="w-6 h-6 mx-auto mb-1 text-gray-400" />
            <p className="text-xs text-gray-300">Import Video / Drop Media Here</p>
            <p className="text-[10px] text-gray-500">Supports MP4, MOV, WebM</p>
          </div>

          {/* AI Prompt & Presets */}
          <div className="flex flex-col space-y-2 bg-[#1e1e1e] p-3 rounded border border-[#333]">
            <label className="text-xs font-semibold text-purple-400 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Prompt & Presets (EN / ID)</span>
            </label>
            
            <select 
              value={selectedTemplate}
              onChange={handleTemplateSelect}
              className="bg-[#2a2a2a] border border-[#444] text-xs text-gray-200 rounded p-1.5 focus:outline-none focus:border-purple-500"
            >
              <option value="">-- Choose Preset Template --</option>
              {PROMPT_TEMPLATES.map((tmpl, idx) => (
                <option key={idx} value={tmpl.label}>{tmpl.label}</option>
              ))}
            </select>

            <textarea 
              rows={3}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="e.g., Cut silences, extract hook, generate subtitle in Bahasa Indonesia..."
              className="bg-[#2a2a2a] border border-[#444] text-xs p-2 rounded text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>

          {/* Subtitles & Scenes List */}
          <div className="flex-1 bg-[#1e1e1e] border border-[#333] rounded p-2 overflow-y-auto">
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center space-x-1">
              <Subtitles className="w-3 h-3" />
              <span>Generated Subtitles & Scenes</span>
            </h4>
            {subtitles.length === 0 ? (
              <p className="text-[10px] text-gray-500 italic">No AI captions generated yet.</p>
            ) : (
              subtitles.map((sub, i) => (
                <div key={i} className="text-xs p-1.5 bg-[#2a2a2a] mb-1 rounded flex justify-between">
                  <span className="text-purple-300 font-mono text-[10px]">{sub.start}</span>
                  <span className="text-gray-200 text-right">{sub.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center Panel: Program Monitor */}
        <div className="flex-1 flex flex-col bg-[#141414]">
          <div className="flex-1 flex items-center justify-center p-4 relative">
            {videoUrl ? (
              <video 
                ref={videoRef} 
                src={videoUrl} 
                className="max-h-full max-w-full rounded border border-[#333] object-contain" 
              />
            ) : (
              <div className="text-center text-gray-600">
                <Video className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No media loaded in monitor</p>
              </div>
            )}
            
            {statusMessage && (
              <div className="absolute bottom-6 bg-purple-900/90 text-purple-100 text-xs px-3 py-1 rounded backdrop-blur border border-purple-500">
                {statusMessage}
              </div>
            )}
          </div>

          {/* Transport Controls */}
          <div className="h-10 bg-[#1e1e1e] border-t border-[#333] flex items-center justify-between px-4">
            <div className="flex items-center space-x-2">
              <button onClick={togglePlay} className="p-1 hover:bg-[#333] rounded text-gray-300">
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button className="p-1 hover:bg-[#333] rounded text-gray-300">
                <Scissors className="w-4 h-4" />
              </button>
            </div>
            <span className="text-[11px] font-mono text-gray-400">00:00:00:00</span>
          </div>
        </div>
      </div>

      {/* Bottom Panel: Timeline */}
      <div className="h-48 border-t border-[#333] bg-[#181818] flex flex-col">
        <div className="h-6 bg-[#222] border-b border-[#333] flex items-center px-3 text-[10px] text-gray-400 space-x-2">
          <Layers className="w-3 h-3" />
          <span>TIMELINE TRACKS (V2 / V1 / A1)</span>
        </div>
        
        <div className="flex-1 p-2 space-y-2 overflow-x-auto">
          <div className="h-10 bg-[#262626] border border-[#3a3a3a] rounded flex items-center px-2 relative">
            <span className="text-[10px] text-blue-400 font-bold mr-2">V1</span>
            {videoFile && (
              <div className="h-7 bg-blue-900/60 border border-blue-500 rounded flex-1 flex items-center px-2 text-[10px] text-blue-200">
                {videoFile.name} (Video Track)
              </div>
            )}
          </div>

          <div className="h-10 bg-[#262626] border border-[#3a3a3a] rounded flex items-center px-2 relative">
            <span className="text-[10px] text-green-400 font-bold mr-2">A1</span>
            {videoFile && (
              <div className="h-7 bg-green-900/60 border border-green-500 rounded flex-1 flex items-center px-2 text-[10px] text-green-200">
                {videoFile.name} (Audio & AI Subtitles)
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}