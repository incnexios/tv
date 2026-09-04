import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import dashjs from 'dashjs';
import { 
  Tv, Volume2, VolumeX, Gamepad2, Plus, List, 
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  X, Play, FileUp, AlertTriangle, Delete,
  Power, Download
} from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

const CHANNELS = [
  { id: 1, name: "Sky Sports F1 HD", category: "Motorsport", url: "https://embedsports.me/fia-f1/sky-sports-f1-sky-f1-stream-1" },
  { id: 2, name: "NASA TV", category: "Science", url: "https://www.youtube.com/embed/uwXgcTc8oY8?autoplay=1" },
  { id: 3, name: "Sky News (UK)", category: "News", url: "https://www.youtube.com/watch?v=gQokE9zQM2E" },
  { id: 4, name: "Al Jazeera", category: "News", url: "https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8" },
  { id: 5, name: "BBC News", category: "News", url: "https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/t=3840/v=pv14/b=5070016/main.m3u8" },
  { id: 6, name: "Top Gear Live", category: "Automotive", url: "https://www.youtube.com/embed/Xw2Xu5wKQVw?autoplay=1" }
];

function InstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOS, setShowIOS] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button onClick={install} className="glass-panel px-4 py-2.5 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400 flex items-center gap-2 text-sm font-bold bg-cyan-900/40">
        <Download className="w-4 h-4 text-cyan-400" /> Install TV App
      </button>
    );
  }

  if (isIOS) {
    return (
      <button onClick={() => setShowIOS(true)} className="glass-panel px-4 py-2.5 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400 flex items-center gap-2 text-sm font-bold bg-cyan-900/40">
        <Download className="w-4 h-4 text-cyan-400" /> Install TV App
        {showIOS && (
          <div className="absolute top-16 right-0 bg-gray-900 border border-gray-700 p-4 rounded-xl shadow-xl w-64 z-50 text-xs font-normal">
            To install, tap the <strong className="text-white">Share</strong> button in Safari toolbar, then scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
            <button onClick={(e) => { e.stopPropagation(); setShowIOS(false); }} className="mt-3 w-full bg-gray-800 py-1.5 rounded-lg text-gray-300">Close</button>
          </div>
        )}
      </button>
    );
  }
  return null;
}

export default function App() {
  const [bootState, setBootState] = useState<'initial' | 'playing-video' | 'booted'>('initial');
  const [channels, setChannels] = useState(CHANNELS);
  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const [lastChannelIndex, setLastChannelIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState('All');
  
  const [isMuted, setIsMuted] = useState(false);
  const [showEPG, setShowEPG] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [showImport, setShowImport] = useState(false);
  
  const [zapDigits, setZapDigits] = useState('');
  const [showOSD, setShowOSD] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isStatic, setIsStatic] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const startupVideoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const zapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const osdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const staticAnimRef = useRef<number | null>(null);

  // -- Boot Sequence --
  const startBoot = () => {
    setBootState('playing-video');
    if (startupVideoRef.current) {
      startupVideoRef.current.play().catch(e => {
        console.warn("Video autoplay blocked", e);
        // Fallback if blocked
        setBootState('booted');
      });
    }
  };

  const handleStartupVideoEnd = () => {
    setBootState('booted');
  };

  // Skip video if error loading it
  const handleStartupVideoError = () => {
    console.warn("Startup video not found or error. Skipping to boot.");
    setBootState('booted');
  };

  useEffect(() => {
    if (bootState === 'booted') {
      playStream(channels[currentChannelIndex].url);
    }
  }, [bootState]);

  // -- Static Noise Canvas --
  useEffect(() => {
    if (isStatic && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const drawNoise = () => {
        const w = canvas.width;
        const h = canvas.height;
        const idata = ctx.createImageData(w, h);
        const buffer32 = new Uint32Array(idata.data.buffer);
        for (let i = 0; i < buffer32.length; i++) {
          if (Math.random() < 0.1) buffer32[i] = 0xffffffff;
        }
        ctx.putImageData(idata, 0, 0);
        staticAnimRef.current = requestAnimationFrame(drawNoise);
      };
      drawNoise();
    } else {
      if (staticAnimRef.current) cancelAnimationFrame(staticAnimRef.current);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    return () => {
      if (staticAnimRef.current) cancelAnimationFrame(staticAnimRef.current);
    };
  }, [isStatic]);

  // -- Player Logic --
  const getYouTubeEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.pathname === '/watch' && parsed.searchParams.get('v')) {
        return `https://www.youtube-nocookie.com/embed/${parsed.searchParams.get('v')}?autoplay=1`;
      }
      return url;
    } catch {
      return url;
    }
  };

  const playStream = (url: string) => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.src = '';
    
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (dashRef.current) { dashRef.current.reset(); dashRef.current = null; }
    
    setIsStatic(true);

    setTimeout(() => {
      setIsStatic(false);
      if (!url) return;

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        if (iframeRef.current) iframeRef.current.src = getYouTubeEmbedUrl(url);
        return;
      }
      if (iframeRef.current) iframeRef.current.src = ''; // clear iframe

      if (url.includes('.m3u8')) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          video.play().catch(console.warn);
        } else if (Hls.isSupported()) {
          const hls = new Hls();
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(console.warn));
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              hls.destroy();
              setIsStatic(true);
              setErrorMsg(`HLS Error: ${data.details}`);
            }
          });
        }
      } else if (url.includes('.mpd')) {
        const player = dashjs.MediaPlayer().create();
        dashRef.current = player;
        player.initialize(video, url, true);
      } else {
        video.src = url;
        video.load();
        video.play().catch(() => {
          setIsStatic(true);
          setErrorMsg("Direct playback restricted.");
        });
      }
    }, 600);
  };

  const triggerOSD = () => {
    setShowOSD(true);
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
    osdTimeoutRef.current = setTimeout(() => setShowOSD(false), 4000);
  };

  const switchChannel = (index: number) => {
    if (index < 0 || index >= channels.length) return;
    setLastChannelIndex(currentChannelIndex);
    setCurrentChannelIndex(index);
    playStream(channels[index].url);
    triggerOSD();
  };

  const channelUp = () => switchChannel((currentChannelIndex + 1) % channels.length);
  const channelDown = () => switchChannel((currentChannelIndex - 1 + channels.length) % channels.length);
  const recallLastChannel = () => switchChannel(lastChannelIndex);

  const pressDigit = (digit: number | string) => {
    const newDigits = zapDigits + digit;
    setZapDigits(newDigits);
    if (zapTimeoutRef.current) clearTimeout(zapTimeoutRef.current);
    zapTimeoutRef.current = setTimeout(() => {
      const chNum = parseInt(newDigits);
      const targetIdx = channels.findIndex(c => c.id === chNum);
      if (targetIdx !== -1) switchChannel(targetIdx);
      setZapDigits('');
    }, 1200);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (bootState !== 'booted') return;
      switch(e.key) {
        case 'ArrowUp': e.preventDefault(); channelUp(); break;
        case 'ArrowDown': e.preventDefault(); channelDown(); break;
        case 'Escape': setShowEPG(false); setShowImport(false); setZapDigits(''); break;
        case 'm': case 'M': setIsMuted(!isMuted); break;
        case 'r': case 'R': recallLastChannel(); break;
        case 'g': case 'G': setShowEPG(!showEPG); break;
        default:
          if (!isNaN(Number(e.key)) && e.key !== ' ') pressDigit(e.key);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bootState, currentChannelIndex, channels, zapDigits, isMuted, showEPG]);

  const currentChannel = channels[currentChannelIndex];
  const categories = ['All', ...Array.from(new Set(channels.map(c => c.category)))];
  const filteredChannels = activeCategory === 'All' ? channels : channels.filter(c => c.category === activeCategory);

  return (
    <div className="relative h-full w-full flex flex-col font-sans overflow-hidden bg-black text-white">
      {/* BOOTLOADER */}
      {bootState === 'initial' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-1000">
          <div className="absolute inset-0 bg-gradient-to-tr from-cyan-900/30 via-black to-blue-950/40 pointer-events-none"></div>
          <div className="glass-panel p-12 rounded-3xl flex flex-col items-center max-w-lg w-full mx-4 shadow-2xl relative border border-white/20">
            <div className="absolute -top-12 w-24 h-24 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 blur-2xl opacity-50 animate-pulse-slow"></div>
            <div className="text-4xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-200 to-indigo-400 bg-clip-text text-transparent mb-2 flex items-center gap-3">
              <Tv className="text-cyan-400 animate-spin w-10 h-10" style={{ animationDuration: '8s' }} />
              NexiosPLAY
            </div>
            <p className="text-xs font-medium tracking-widest text-cyan-400/80 uppercase mb-8 mono">Liquid Glass OS</p>
            <button onClick={startBoot} className="mt-8 px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/40 hover:to-blue-500/40 border border-cyan-400/40 text-cyan-300 font-semibold text-sm tracking-wide transition-all duration-300 flex items-center gap-2">
              <Power className="w-4 h-4" /> Boot System
            </button>
            <p className="mt-4 text-[10px] text-gray-500">Ensure your uploaded video is named "startup.mp4" in the public folder.</p>
          </div>
        </div>
      )}

      {/* STARTUP VIDEO */}
      {bootState === 'playing-video' && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
          <video 
            ref={startupVideoRef}
            src="/startup.mp4"
            className="w-full h-full object-cover"
            onEnded={handleStartupVideoEnd}
            onError={handleStartupVideoError}
            playsInline
          />
        </div>
      )}

      {/* MAIN APP SHELL */}
      <div className={`relative h-full w-full flex flex-col transition-opacity duration-700 ${bootState === 'booted' ? 'opacity-100 animate-crt pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        
        {/* VIEWPORT */}
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black overflow-hidden">
          <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full pointer-events-none z-10 transition-opacity duration-300 ${isStatic ? 'opacity-15' : 'opacity-0'}`} />
          <video ref={videoRef} className={`w-full h-full object-contain ${currentChannel?.url?.includes('youtube') ? 'hidden' : ''}`} playsInline autoPlay muted={isMuted} />
          <iframe ref={iframeRef} className={`w-full h-full border-0 absolute inset-0 ${!currentChannel?.url?.includes('youtube') ? 'hidden' : ''}`} allow="autoplay; fullscreen" />
          
          {errorMsg && (
            <div className="absolute bottom-24 z-30 glass-panel px-6 py-3 rounded-xl border border-red-500/40 text-red-300 text-xs flex items-center gap-3 shadow-2xl">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <div><span className="font-bold">Stream Error:</span> {errorMsg}</div>
            </div>
          )}
        </div>

        {/* TOP BAR */}
        <header className="absolute top-0 left-0 right-0 z-30 p-6 flex justify-between items-center pointer-events-none">
          <div className="glass-panel px-5 py-2.5 rounded-2xl flex items-center gap-4 pointer-events-auto shadow-lg">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-ping"></span>
              <span className="text-xs font-extrabold uppercase tracking-widest text-red-400 mono">LIVE</span>
            </div>
            <div className="h-4 w-[1px] bg-white/20"></div>
            <div className="flex items-center gap-2 text-sm font-bold tracking-wide">
              <span className="text-cyan-400 mono">{String(currentChannel?.id || 0).padStart(3, '0')}</span>
              <span className="text-white">{currentChannel?.name || 'No Channel'}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 pointer-events-auto">
            <InstallButton />
            <button onClick={() => setIsMuted(!isMuted)} className="glass-panel p-3 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400">
              {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <button onClick={() => setShowRemote(!showRemote)} className="glass-panel p-3 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400">
              <Gamepad2 className="w-5 h-5" />
            </button>
            <button onClick={() => setShowImport(true)} className="glass-panel p-3 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => setShowEPG(true)} className="glass-panel px-5 py-2.5 rounded-2xl glass-panel-interactive text-white hover:text-cyan-400 flex items-center gap-2 text-sm font-bold">
              <List className="w-4 h-4 text-cyan-400" /> EPG Guide
            </button>
          </div>
        </header>

        {/* BOTTOM OSD */}
        <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 transition-all duration-500 pointer-events-none ${showOSD ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <div className="glass-panel px-6 py-3.5 rounded-2xl flex items-center gap-6 shadow-2xl border border-white/20">
            <div className="text-2xl font-black text-cyan-400 mono">{String(currentChannel?.id || 0).padStart(3, '0')}</div>
            <div className="flex flex-col">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{currentChannel?.category || 'General'}</div>
              <div className="text-base font-bold text-white">{currentChannel?.name || 'Unknown'}</div>
            </div>
            <div className="h-8 w-[1px] bg-white/20"></div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 text-xs font-bold border border-cyan-500/30">1080p 60FPS</span>
            </div>
          </div>
        </div>

        {/* ZAPPING POPUP */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 glass-panel px-8 py-6 rounded-3xl shadow-2xl transition-all duration-300 flex flex-col items-center border border-cyan-400/40 ${zapDigits ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
          <div className="text-xs font-bold tracking-widest text-cyan-400 uppercase mb-1">Direct Tune</div>
          <div className="text-5xl font-black text-white mono tracking-widest my-2">{zapDigits || '--'}</div>
        </div>

        {/* EPG DRAWER */}
        <div className={`absolute inset-0 z-40 bg-black/60 backdrop-blur-xl flex items-center justify-end transition-all duration-500 ${showEPG ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <div className={`w-full max-w-2xl h-full glass-panel border-l border-white/20 flex flex-col p-8 transition-transform duration-500 shadow-2xl ${showEPG ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-cyan-400">
                  <Tv className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-white">Electronic Program Guide</h2>
                </div>
              </div>
              <button onClick={() => setShowEPG(false)} className="w-10 h-10 rounded-xl glass-panel glass-panel-interactive flex items-center justify-center text-white hover:text-red-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 shrink-0">
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-2 rounded-xl glass-panel text-xs font-bold transition whitespace-nowrap ${activeCategory === cat ? 'text-cyan-300 border-cyan-400/50 shadow-[0_0_15px_rgba(0,242,254,0.3)]' : 'text-gray-300'}`}>
                  {cat}
                </button>
              ))}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {filteredChannels.map((ch) => {
                const globalIdx = channels.findIndex(c => c.id === ch.id);
                const isPlaying = globalIdx === currentChannelIndex;
                return (
                  <div key={ch.id} onClick={() => { switchChannel(globalIdx); setShowEPG(false); }} className={`glass-panel p-4 rounded-2xl glass-panel-interactive flex items-center justify-between cursor-pointer ${isPlaying ? 'border-cyan-400 bg-white/15 shadow-[0_0_20px_rgba(0,242,254,0.3)]' : ''}`}>
                    <div className="flex items-center gap-4">
                      <span className="text-xl font-black text-cyan-400 mono w-12">{String(ch.id).padStart(3, '0')}</span>
                      <div>
                        <h4 className="text-base font-bold text-white flex items-center gap-2">
                          {ch.name}
                          {isPlaying && <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-400/30">PLAYING</span>}
                        </h4>
                        <span className="text-xs text-gray-400 uppercase tracking-wider">{ch.category}</span>
                      </div>
                    </div>
                    <button className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-cyan-300">
                      <Play className="w-4 h-4 ml-1" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* VIRTUAL REMOTE */}
        <div className={`absolute bottom-24 right-8 z-40 glass-panel p-6 rounded-3xl shadow-2xl w-80 transition-all duration-300 border border-white/20 ${showRemote ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
            <span className="text-xs font-extrabold uppercase tracking-widest text-cyan-400 mono flex items-center gap-2">
              <Gamepad2 className="w-4 h-4" /> Virtual Remote
            </span>
            <button onClick={() => setShowRemote(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-col items-center my-6">
            <button onClick={channelUp} className="w-12 h-12 rounded-2xl glass-panel glass-panel-interactive flex items-center justify-center text-white mb-1"><ChevronUp className="w-5 h-5" /></button>
            <div className="flex gap-10 my-1">
              <button className="w-12 h-12 rounded-2xl glass-panel glass-panel-interactive flex items-center justify-center text-white"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => setShowEPG(true)} className="w-12 h-12 rounded-full glass-panel glass-panel-interactive flex items-center justify-center text-cyan-400 font-bold border border-cyan-400/40 shadow-[0_0_15px_rgba(0,242,254,0.3)]">OK</button>
              <button className="w-12 h-12 rounded-2xl glass-panel glass-panel-interactive flex items-center justify-center text-white"><ChevronRight className="w-5 h-5" /></button>
            </div>
            <button onClick={channelDown} className="w-12 h-12 rounded-2xl glass-panel glass-panel-interactive flex items-center justify-center text-white mt-1"><ChevronDown className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button onClick={channelUp} className="py-2.5 rounded-xl glass-panel glass-panel-interactive text-xs font-bold text-cyan-300">CH +</button>
            <button onClick={recallLastChannel} className="py-2.5 rounded-xl glass-panel glass-panel-interactive text-xs font-bold text-yellow-300">Recall</button>
            <button onClick={channelDown} className="py-2.5 rounded-xl glass-panel glass-panel-interactive text-xs font-bold text-cyan-300">CH -</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3,4,5,6,7,8,9].map(num => (
              <button key={num} onClick={() => pressDigit(num)} className="py-2 rounded-xl glass-panel glass-panel-interactive text-sm font-bold mono">{num}</button>
            ))}
            <button onClick={() => setShowEPG(true)} className="py-2 rounded-xl glass-panel glass-panel-interactive text-xs font-bold text-cyan-400 flex items-center justify-center"><List className="w-4 h-4" /></button>
            <button onClick={() => pressDigit(0)} className="py-2 rounded-xl glass-panel glass-panel-interactive text-sm font-bold mono">0</button>
            <button onClick={() => setZapDigits('')} className="py-2 rounded-xl glass-panel glass-panel-interactive text-xs font-bold text-red-400 flex items-center justify-center"><Delete className="w-4 h-4" /></button>
          </div>
        </div>

        {/* IMPORT MODAL */}
        {showImport && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center pointer-events-auto">
            <div className="glass-panel p-8 rounded-3xl max-w-md w-full mx-4 shadow-2xl border border-white/20">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Plus className="w-6 h-6 text-cyan-400" /> Add Stream
                </h3>
                <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const name = fd.get('name') as string;
                const cat = fd.get('cat') as string || 'Custom';
                const url = fd.get('url') as string;
                if (!name || !url) return;
                const newId = Math.max(...channels.map(c=>c.id), 0) + 1;
                setChannels([...channels, { id: newId, name, category: cat, url }]);
                setShowImport(false);
                switchChannel(channels.length);
              }} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Name</label>
                  <input name="name" required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Category</label>
                  <input name="cat" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Stream URL</label>
                  <input name="url" required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-400" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(0,242,254,0.4)] transition">Add Channel</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
