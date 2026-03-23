import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutGrid, 
  LayoutList, 
  CreditCard, 
  Calendar, 
  Moon, 
  Sun, 
  Newspaper, 
  ChevronRight, 
  Search, 
  RefreshCw, 
  X, 
  Settings, 
  Bell, 
  Languages, 
  Type 
} from 'lucide-react';

// --- Constants ---
const CATEGORIES = ["All", "Technology", "Business", "Politics", "Science", "Health", "Sports", "Entertainment"];
const apiKey = ""; // Provided by environment

export default function App() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [layout, setLayout] = useState("card");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);

  // Settings State
  const [settings, setSettings] = useState({
    aiEnhanced: true,
    compactView: false,
    notifications: true,
    language: 'English'
  });

  // --- AI News Generation ---
  const generateNews = async () => {
    setLoading(true);
    try {
      const systemPrompt = `Generate 8 diverse news articles for the date ${selectedDate}. 
      Respond ONLY with a JSON array of objects: 
      [{"title": "...", "category": "...", "tag": "...", "summary": "...", "content": "..."}]`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate news for ${selectedDate}` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No content generated");
      
      const generatedArticles = JSON.parse(text).map(article => ({
        ...article,
        id: crypto.randomUUID(),
        date: selectedDate,
        timestamp: Date.now()
      }));

      // Add to local state (simulating "saving" to database for current session)
      setNews(prev => [...generatedArticles, ...prev]);
    } catch (error) {
      console.error("Generation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredNews = useMemo(() => {
    // Filter by both Date and Category
    const dateFiltered = news.filter(item => item.date === selectedDate);
    if (selectedCategory === "All") return dateFiltered;
    return dateFiltered.filter(item => item.category === selectedCategory);
  }, [news, selectedCategory, selectedDate]);

  const getTagColor = (category) => {
    const colors = {
      Technology: "bg-indigo-500/90",
      Business: "bg-emerald-500/90",
      Politics: "bg-rose-500/90",
      Science: "bg-amber-500/90",
      Health: "bg-teal-500/90",
      Sports: "bg-orange-500/90",
      Entertainment: "bg-fuchsia-500/90"
    };
    return colors[category] || "bg-zinc-500";
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-zinc-950 text-zinc-400' : 'bg-zinc-100 text-zinc-800'}`}>
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-64 border-r transition-colors z-20 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} hidden md:flex flex-col`}>
        <div className="p-6 border-b border-inherit flex items-center gap-3">
          <div className={`${isDarkMode ? 'bg-zinc-100 text-black' : 'bg-zinc-800 text-white'} p-2 rounded-lg shadow-sm`}>
            <Newspaper size={24} />
          </div>
          <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>NewsPage</h1>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-3 mb-3">Categories</p>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between group text-sm font-medium ${
                selectedCategory === cat 
                ? (isDarkMode ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700' : 'bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300')
                : 'hover:bg-zinc-800/30 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span>{cat}</span>
              {selectedCategory === cat && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-inherit space-y-4">
          <button 
            onClick={() => setShowCalendar(true)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all ${
              isDarkMode ? 'border-zinc-800 hover:bg-zinc-800 bg-zinc-950/50 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-200 bg-white text-zinc-600'
            }`}
          >
            <Calendar size={18} />
            <div className="text-left">
              <p className="text-[10px] uppercase font-bold tracking-tighter opacity-60">Browse Date</p>
              <p className="text-xs font-bold">{selectedDate}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:ml-64 p-4 md:p-8 min-h-screen pb-24">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h2 className={`text-2xl font-black ${isDarkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>{selectedCategory} News</h2>
            <p className="text-sm text-zinc-500 font-medium">Session briefing for {selectedDate}</p>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowSettings(true)}
              className={`p-2 rounded-full border transition-colors ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-zinc-300 hover:bg-zinc-200 bg-white'}`}
            >
              <Settings size={18} />
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-full border transition-colors ${isDarkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-zinc-300 hover:bg-zinc-200 bg-white'}`}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              onClick={generateNews}
              disabled={loading}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-xs uppercase tracking-widest transition-all shadow-md ${
                isDarkMode ? 'bg-zinc-200 text-zinc-900 hover:bg-white' : 'bg-zinc-800 text-white hover:bg-zinc-900'
              } disabled:opacity-50 ml-2`}
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <Newspaper size={16} />}
              Generate
            </button>
          </div>
        </header>

        {/* News Feed */}
        {filteredNews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center space-y-4 opacity-40">
            <Search size={48} className="text-zinc-500" />
            <div>
              <h3 className="text-lg font-bold">No briefings for this date</h3>
              <p className="text-sm">Click Generate to create AI news for {selectedDate}.</p>
            </div>
          </div>
        ) : (
          <div className={`
            ${layout === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6' : ''}
            ${layout === 'card' ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : ''}
            ${layout === 'list' ? 'flex flex-col gap-4' : ''}
          `}>
            {filteredNews.map((item) => (
              <div 
                key={item.id}
                onClick={() => setSelectedArticle(item)}
                className={`group cursor-pointer rounded-2xl border transition-all hover:shadow-lg ${
                  isDarkMode 
                  ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-600' 
                  : 'bg-white border-zinc-200 hover:border-zinc-300'
                } ${layout === 'list' ? 'flex flex-col md:flex-row gap-4 p-4' : 'flex flex-col'}`}
              >
                <div className={`${settings.compactView ? 'p-4' : 'p-6'} flex flex-col flex-1 ${layout === 'list' ? 'md:py-2' : ''}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`text-[9px] font-black uppercase tracking-widest text-white px-2 py-0.5 rounded shadow-sm ${getTagColor(item.category)}`}>
                      {item.category}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 bg-zinc-500/10 px-2 py-0.5 rounded">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className={`${settings.compactView ? 'text-base' : 'text-lg'} font-bold mb-3 transition-colors leading-tight ${isDarkMode ? 'text-zinc-100 group-hover:text-white' : 'text-zinc-900'}`}>
                    {item.title}
                  </h3>
                  {!settings.compactView && (
                    <p className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'} line-clamp-3 mb-5 leading-relaxed`}>
                      {item.summary}
                    </p>
                  )}
                  <div className={`mt-auto flex items-center text-[10px] font-black uppercase tracking-widest transition-opacity group-hover:opacity-100 opacity-60 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-900'}`}>
                    Open Brief <ChevronRight size={12} className="ml-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Layout Switcher */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 md:left-[calc(50%+128px)] z-30">
          <div className={`flex items-center gap-1 p-1 rounded-full border shadow-xl backdrop-blur-lg ${
            isDarkMode ? 'bg-zinc-900/80 border-zinc-700 text-zinc-400' : 'bg-white/80 border-zinc-300 text-zinc-600'
          }`}>
            <button onClick={() => setLayout('grid')} className={`p-2.5 rounded-full transition-all ${layout === 'grid' ? (isDarkMode ? 'bg-zinc-100 text-black shadow-md' : 'bg-zinc-800 text-white shadow-md') : 'hover:bg-zinc-500/10'}`}><LayoutGrid size={16} /></button>
            <button onClick={() => setLayout('card')} className={`p-2.5 rounded-full transition-all ${layout === 'card' ? (isDarkMode ? 'bg-zinc-100 text-black shadow-md' : 'bg-zinc-800 text-white shadow-md') : 'hover:bg-zinc-500/10'}`}><CreditCard size={16} /></button>
            <button onClick={() => setLayout('list')} className={`p-2.5 rounded-full transition-all ${layout === 'list' ? (isDarkMode ? 'bg-zinc-100 text-black shadow-md' : 'bg-zinc-800 text-white shadow-md') : 'hover:bg-zinc-500/10'}`}><LayoutList size={16} /></button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className={`relative w-full max-w-md rounded-3xl shadow-2xl overflow-hidden ${
            isDarkMode ? 'bg-zinc-900 text-zinc-300 border border-zinc-800' : 'bg-white text-zinc-800 border border-zinc-200'
          }`}>
            <div className={`p-6 border-b ${isDarkMode ? 'border-zinc-800 bg-zinc-950/50' : 'border-zinc-100 bg-zinc-50'} flex justify-between items-center`}>
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-zinc-500" />
                <h3 className="text-base font-bold uppercase tracking-widest">Preferences</h3>
              </div>
              <button onClick={() => setShowSettings(false)} className="hover:opacity-50"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RefreshCw size={16} className="text-zinc-500" />
                    <span className="text-sm font-medium">AI Enhanced Mode</span>
                  </div>
                  <button onClick={() => setSettings(s => ({...s, aiEnhanced: !s.aiEnhanced}))} className={`w-9 h-5 rounded-full transition-all relative ${settings.aiEnhanced ? (isDarkMode ? 'bg-zinc-200' : 'bg-zinc-800') : 'bg-zinc-700'}`}>
                    <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${settings.aiEnhanced ? 'right-1 bg-zinc-500' : 'left-1 bg-zinc-400'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <LayoutList size={16} className="text-zinc-500" />
                    <span className="text-sm font-medium">Compact View</span>
                  </div>
                  <button onClick={() => setSettings(s => ({...s, compactView: !s.compactView}))} className={`w-9 h-5 rounded-full transition-all relative ${settings.compactView ? (isDarkMode ? 'bg-zinc-200' : 'bg-zinc-800') : 'bg-zinc-700'}`}>
                    <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${settings.compactView ? 'right-1 bg-zinc-500' : 'left-1 bg-zinc-400'}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Article Detail Modal */}
      {selectedArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setSelectedArticle(null)} />
          <div className={`relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl ${
            isDarkMode ? 'bg-zinc-900 text-zinc-300 border border-zinc-800' : 'bg-white text-zinc-800'
          }`}>
            <button onClick={() => setSelectedArticle(null)} className="absolute top-6 right-6 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 z-10 transition-colors"><X size={20} /></button>
            <div className={`p-8 pt-16 ${isDarkMode ? 'bg-zinc-950/50' : 'bg-zinc-100'}`}>
              <div className="mb-6">
                <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full mb-4 inline-block text-white shadow-sm ${getTagColor(selectedArticle.category)}`}>
                  {selectedArticle.category}
                </span>
                <h2 className={`text-3xl font-black leading-tight ${isDarkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                  {selectedArticle.title}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-zinc-500/20 px-3 py-1 rounded-full opacity-60">{selectedArticle.tag}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-zinc-500/20 px-3 py-1 rounded-full opacity-60">{selectedArticle.date}</span>
              </div>
            </div>
            <div className="p-8 space-y-8">
              <div className={`p-6 rounded-2xl border-l-4 ${isDarkMode ? 'bg-zinc-800 border-zinc-400' : 'bg-zinc-50 border-zinc-800'}`}>
                <p className={`text-xl font-medium leading-relaxed italic ${isDarkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>"{selectedArticle.summary}"</p>
              </div>
              <div className={`space-y-6 text-lg leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
                {selectedArticle.content.split('\n').map((para, i) => <p key={i}>{para}</p>)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Modal */}
      {showCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCalendar(false)} />
          <div className={`relative p-8 rounded-3xl shadow-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} max-w-sm w-full`}>
            <h3 className="text-sm font-black uppercase tracking-widest mb-6 opacity-60">Jump to Date</h3>
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setShowCalendar(false);
              }}
              className={`w-full p-4 rounded-xl border text-sm font-bold outline-none focus:ring-2 focus:ring-zinc-500 transition-all ${
                isDarkMode ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-zinc-50 border-zinc-200 text-black'
              }`}
            />
            <button onClick={() => setShowCalendar(false)} className={`mt-6 w-full py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${isDarkMode ? 'bg-zinc-200 text-zinc-900 hover:bg-white' : 'bg-zinc-800 text-white hover:bg-zinc-900'}`}>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}